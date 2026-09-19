import { useEffect, useRef, useState } from 'react'
import {
  Check,
  X,
  Eye,
  EyeClosed,
  Camera,
  Play,
  Pause,
  CircleNotch,
  UploadSimple,
  VideoCameraSlash,
  CornersOut,
  CornersIn,
} from '@phosphor-icons/react'
import { estimatePoses, estimateDetailedPoses, preloadModels, resetTracking } from '../lib/pose'
import type { Pose } from '../lib/pose'
import { classifyActivity, getCentroid, pushHistory } from '../lib/activity'
import {
  pointInZone,
  zoneCentroid,
  LINGER_THRESHOLD_RATIO,
  ZONE_EXIT_GRACE_SEC,
  ZONE_REVISIT_ALERT_COUNT,
  MIN_ZONE_POINTS,
  CLOSE_POINT_RADIUS_PX,
} from '../lib/zones'
import { computeCoverTransform, mapPointCover } from '../lib/coverMap'
import { ACTIVITY_COLORS } from '../lib/activityColors'
import type { ActivityEvent, DetectionQuality, OverlayMode, Point, Source, TrackedPerson, Zone } from '../lib/types'

// Fixed internal canvas/capture resolution — not the displayed size (CSS
// scales it down to fit the viewport). Every frame does a full drawImage +
// skeleton/zone redraw at this resolution regardless of how small it's
// actually shown, so this is a direct FPS lever. 720p is already well above
// what any quality tier's model actually consumes (Fast/Balanced downscale
// to 256-384px, High's YOLO input is 640px letterboxed, Thunder crops are
// 256px) — the extra source detail past that doesn't improve detection, it
// only costs more per-frame canvas/camera-decode work. Kept fixed (not
// responsive to viewport size) so zone coordinates, stored in this same
// canvas-space, stay stable across window resizes.
const CANVAS_W = 1280
const CANVAS_H = 720
// A person can go briefly undetected (occlusion, a confidence dip, motion
// blur) well within the tracker's own missed-frame tolerance, which still
// recognizes them by the same id if they reappear. Wall-clock (not
// frame-count) grace before dropping their zone-dwell state, so a single
// missed detection doesn't wipe a loiter timer that the tracker itself
// hasn't given up on.
const STALE_PERSON_GRACE_MS = 1200
// Drawing sizes below were tuned at a 1280-wide reference canvas; scale them
// with the actual canvas width so the overlay stays legible at any resolution.
const DRAW_SCALE = CANVAS_W / 1280

const SKELETON_EDGES: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]

interface Props {
  source: Source
  zones: Zone[]
  onZonesChange: (zones: Zone[]) => void
  onPeopleUpdate: (people: TrackedPerson[]) => void
  onEvent: (event: ActivityEvent) => void
  onFps: (fps: number) => void
  fps: number
  peopleCount: number
  drawMode: boolean
  quality: DetectionQuality
  alertPulse: number
  loiterThresholdSec: number
  onModelLoadingChange: (loading: boolean) => void
  onModelLoadProgress: (fraction: number) => void
  onModelLoadError: (message: string | null) => void
  modelRetryToken: number
  onFileDrop: (file: File) => void
  onRequestUpload: () => void
}

export default function CameraStage({
  source,
  zones,
  onZonesChange,
  onPeopleUpdate,
  onEvent,
  onFps,
  fps,
  peopleCount,
  drawMode,
  quality,
  alertPulse,
  loiterThresholdSec,
  onModelLoadingChange,
  onModelLoadProgress,
  onModelLoadError,
  modelRetryToken,
  onFileDrop,
  onRequestUpload,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageFrameRef = useRef<HTMLDivElement>(null)
  const peopleRef = useRef<Map<number, TrackedPerson>>(new Map())
  // Raw keypoints per tracked id, kept separately from TrackedPerson (whose
  // shape is shared with the dashboard/events UI). The draw loop below runs
  // independently of inference now, so it needs somewhere to read the last
  // known skeleton from on ticks where inference hasn't produced a new one.
  const keypointsRef = useRef<Map<number, Pose['keypoints']>>(new Map())
  const zonesRef = useRef(zones)
  const qualityRef = useRef(quality)
  const loiterThresholdRef = useRef(loiterThresholdSec)
  const overlayModeRef = useRef<OverlayMode>('full')
  const [status, setStatus] = useState('Starting…')
  const [running, setRunning] = useState(true)
  const [draftPoints, setDraftPoints] = useState<Point[]>([])
  const [cursorPos, setCursorPos] = useState<Point | null>(null)
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('full')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement === stageFrameRef.current)
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      stageFrameRef.current?.requestFullscreen()
    }
  }
  const dragDepth = useRef(0)
  const [inspecting, setInspecting] = useState(false)

  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  useEffect(() => {
    overlayModeRef.current = overlayMode
  }, [overlayMode])

  useEffect(() => {
    qualityRef.current = quality
    let cancelled = false
    onModelLoadingChange(true)
    onModelLoadProgress(0)
    onModelLoadError(null)
    // A flat deadline from the start of the whole load was wrong: High
    // pulls ~90MB combined (YOLO + its wasm runtime + two MoveNet models),
    // and on a slower connection that alone can take longer than any
    // reasonable fixed cap — a load that's genuinely still progressing byte
    // by byte isn't stuck, it's just slow, and shouldn't be killed for it.
    // What actually indicates a real hang is bytes no longer arriving, or
    // the post-download compile step (which has no progress signal of its
    // own — parsing each model's graph, uploading weights to WebGL,
    // compiling the wasm module) running far longer than that step should
    // reasonably take on working hardware. So: watch for a stall in
    // progress during the download phase, and cap only the untracked
    // compile phase once downloads are done — never the download phase
    // itself, which can take as long as the connection needs.
    const DOWNLOAD_STALL_MS = 20000
    const COMPILE_PHASE_MS = 30000
    let lastProgressAt = performance.now()
    let sawDownloadStart = false
    let enteredCompilePhase = false
    let compilePhaseStartedAt = 0
    let watchdogTimer = 0
    const stallWatchdog = new Promise<never>((_, reject) => {
      const check = () => {
        const now = performance.now()
        if (!enteredCompilePhase && sawDownloadStart && now - lastProgressAt > DOWNLOAD_STALL_MS) {
          reject(new Error(`Download stalled while loading the ${quality} model — no data received for ${DOWNLOAD_STALL_MS / 1000}s.`))
          return
        }
        if (enteredCompilePhase && now - compilePhaseStartedAt > COMPILE_PHASE_MS) {
          reject(
            new Error(
              `Timed out initializing the ${quality} model — downloads finished but setup didn't complete after ${COMPILE_PHASE_MS / 1000}s.`,
            ),
          )
          return
        }
        watchdogTimer = window.setTimeout(check, 2000)
      }
      watchdogTimer = window.setTimeout(check, 2000)
    })
    Promise.race([
      preloadModels(quality, (fraction) => {
        if (cancelled) return
        sawDownloadStart = true
        lastProgressAt = performance.now()
        if (fraction >= 0.99 && !enteredCompilePhase) {
          enteredCompilePhase = true
          compilePhaseStartedAt = performance.now()
        }
        onModelLoadProgress(fraction)
      }),
      stallWatchdog,
    ])
      .then(() => {
        if (!cancelled) onModelLoadProgress(1)
      })
      .catch((err) => {
        // Previously swallowed entirely — modelLoading still flipped back to
        // false via the finally below, so a real failure (network, backend
        // init, a bad model file) looked identical to a successful load with
        // no way to tell the two apart from the UI.
        console.error(`[CameraStage] failed to load ${quality} models`, err)
        if (!cancelled) {
          onModelLoadError(err instanceof Error ? err.message : `Failed to load the ${quality} detection model.`)
        }
      })
      .finally(() => {
        window.clearTimeout(watchdogTimer)
        if (!cancelled) onModelLoadingChange(false)
      })
    return () => {
      cancelled = true
      window.clearTimeout(watchdogTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, modelRetryToken])

  useEffect(() => {
    loiterThresholdRef.current = loiterThresholdSec
  }, [loiterThresholdSec])

  // Restart the feed (camera re-request or upload re-play) whenever the source changes.
  useEffect(() => {
    setRunning(true)
    resetTracking()
  }, [source])

  // Leaving draw mode (or switching source) clears any in-progress zone.
  useEffect(() => {
    if (!drawMode) {
      setDraftPoints([])
      setCursorPos(null)
    }
  }, [drawMode])

  useEffect(() => {
    let stream: MediaStream | null = null
    let objectUrl: string | null = null
    let raf = 0
    let inferRaf = 0
    let stopped = false
    let lastFrameTime = performance.now()
    let lastLoggedPoseCount = -1
    let frameCount = 0
    let fpsTimer = performance.now()
    let detachPlaybackListeners: (() => void) | null = null

    async function start() {
      const video = videoRef.current!
      const canvas = canvasRef.current!
      canvas.width = CANVAS_W
      canvas.height = CANVAS_H
      peopleRef.current = new Map()
      keypointsRef.current = new Map()

      if (!running) {
        setStatus('Feed stopped')
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
        onPeopleUpdate([])
        onFps(0)
        setResolution(null)
        return
      }

      if (source.kind === 'camera') {
        setStatus('Requesting camera…')
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: CANVAS_W, height: CANVAS_H }, audio: false })
        } catch {
          setStatus('Camera access denied or unavailable.')
          return
        }
        video.srcObject = stream
        video.loop = false
      } else {
        setStatus('Loading video…')
        objectUrl = URL.createObjectURL(source.file)
        video.srcObject = null
        video.src = objectUrl
        video.loop = true
      }

      try {
        await new Promise<void>((resolve, reject) => {
          if (video.readyState >= 1) {
            resolve()
            return
          }
          // Without an error/timeout path, a video the browser can't decode
          // (unsupported codec/container, a corrupted file) just hangs here
          // forever — loadedmetadata never fires, but nothing ever told the
          // user why, so the UI sat stuck on "Loading video…" indefinitely.
          const timeout = window.setTimeout(() => reject(new Error('timeout')), 15000)
          video.onloadedmetadata = () => {
            window.clearTimeout(timeout)
            resolve()
          }
          video.onerror = () => {
            window.clearTimeout(timeout)
            reject(new Error('media-error'))
          }
        })
        await video.play()
      } catch {
        setStatus(
          source.kind === 'upload'
            ? "Couldn't load this video — it may be corrupted or in a format this browser can't play. Try an MP4 (H.264) or WebM file."
            : 'Camera access denied or unavailable.',
        )
        return
      }
      if (stopped) return
      setResolution({ w: video.videoWidth, h: video.videoHeight })

      const ctx = canvas.getContext('2d')!
      const cover = computeCoverTransform(video.videoWidth, video.videoHeight, CANVAS_W, CANVAS_H)

      setStatus('')

      // Paused, there's no real-time FPS budget to protect — run the full
      // top-down ensemble uncapped with a forced-fresh box detection on just
      // this one frame, instead of the live loop's throttled/capped pass.
      // Superseded (via inspectToken) by a newer pause/seek before it
      // resolves, so a slow inspection can't clobber a fresher one.
      let inspectToken = 0
      // Mirrors `inspecting` React state into a plain variable the draw loop
      // (a non-reactive rAF callback) can read synchronously every tick,
      // so it knows to leave this function's own canvas render alone
      // instead of immediately overdrawing it with the live video+overlay.
      let isInspecting = false
      const inspectPausedFrame = async () => {
        const token = ++inspectToken
        isInspecting = true
        setInspecting(true)
        try {
          const poses = await estimateDetailedPoses(video)
          if (stopped || token !== inspectToken) return
          ctx.save()
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(video, cover.sx, cover.sy, cover.sw, cover.sh, 0, 0, canvas.width, canvas.height)
          const INSPECT_COLOR = '#ffffff'
          ctx.strokeStyle = INSPECT_COLOR
          ctx.fillStyle = INSPECT_COLOR
          ctx.lineWidth = 5 * DRAW_SCALE
          for (const pose of poses) {
            for (const [a, b] of SKELETON_EDGES) {
              const ka = pose.keypoints.find((k) => k.name === a)
              const kb = pose.keypoints.find((k) => k.name === b)
              if (ka && kb && (ka.score ?? 0) > 0.3 && (kb.score ?? 0) > 0.3) {
                const pa = mapPointCover(ka, cover)
                const pb = mapPointCover(kb, cover)
                ctx.beginPath()
                ctx.moveTo(pa.x, pa.y)
                ctx.lineTo(pb.x, pb.y)
                ctx.stroke()
              }
            }
            for (const k of pose.keypoints) {
              if ((k.score ?? 0) > 0.3) {
                const pk = mapPointCover(k, cover)
                ctx.beginPath()
                ctx.arc(pk.x, pk.y, 6 * DRAW_SCALE, 0, Math.PI * 2)
                ctx.fill()
              }
            }
          }
          ctx.restore()
        } catch (err) {
          console.error('[CameraStage] paused-frame inspection failed', err)
        } finally {
          if (token === inspectToken) {
            isInspecting = false
            setInspecting(false)
          }
        }
      }

      if (source.kind === 'upload') {
        const handleTimeUpdate = () => setCurrentTime(video.currentTime)
        const handlePlay = () => {
          setVideoPlaying(true)
          // Invalidate any inspection still in flight so a slow analysis
          // can't land after playback resumed and overwrite a live frame.
          inspectToken++
          isInspecting = false
          setInspecting(false)
        }
        const handlePause = () => {
          setVideoPlaying(false)
          inspectPausedFrame()
        }
        const handleSeeked = () => {
          if (video.paused) {
            inspectPausedFrame()
          }
          // While playing, the always-on draw loop below picks up the new
          // frame on its next tick (~16ms) — no manual redraw needed here
          // anymore now that drawing isn't gated behind inference.
        }
        video.addEventListener('timeupdate', handleTimeUpdate)
        video.addEventListener('play', handlePlay)
        video.addEventListener('pause', handlePause)
        video.addEventListener('seeked', handleSeeked)
        setDuration(video.duration || 0)
        setCurrentTime(video.currentTime)
        setVideoPlaying(!video.paused)
        detachPlaybackListeners = () => {
          video.removeEventListener('timeupdate', handleTimeUpdate)
          video.removeEventListener('play', handlePlay)
          video.removeEventListener('pause', handlePause)
          video.removeEventListener('seeked', handleSeeked)
        }
      }

      // ---- Rendering: reads only the *latest already-known* tracked-people
      // and zone state — never runs a model, never awaits anything. This is
      // what decouples visible video smoothness from inference speed: the
      // draw loop below runs every animation frame regardless of how fast
      // (or slow) the inference loop further down is currently completing.
      const drawOverlays = () => {
        const people = Array.from(peopleRef.current.values())

        for (const person of people) {
          const keypoints = keypointsRef.current.get(person.id)
          const color = ACTIVITY_COLORS[person.activity] ?? '#94a3b8'
          if (keypoints && overlayModeRef.current === 'full') {
            ctx.strokeStyle = color
            ctx.lineWidth = 5 * DRAW_SCALE
            for (const [a, b] of SKELETON_EDGES) {
              const ka = keypoints.find((k) => k.name === a)
              const kb = keypoints.find((k) => k.name === b)
              if (ka && kb && (ka.score ?? 0) > 0.3 && (kb.score ?? 0) > 0.3) {
                const pa = mapPointCover(ka, cover)
                const pb = mapPointCover(kb, cover)
                ctx.beginPath()
                ctx.moveTo(pa.x, pa.y)
                ctx.lineTo(pb.x, pb.y)
                ctx.stroke()
              }
            }
            for (const k of keypoints) {
              if ((k.score ?? 0) > 0.3) {
                const pk = mapPointCover(k, cover)
                ctx.beginPath()
                ctx.arc(pk.x, pk.y, 6 * DRAW_SCALE, 0, Math.PI * 2)
                ctx.fillStyle = color
                ctx.fill()
              }
            }
          } else {
            // minimal mode (or no keypoints yet): just a marker at the person's tracked position
            ctx.beginPath()
            ctx.arc(person.centroid.x, person.centroid.y, 7 * DRAW_SCALE, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.fill()
          }
          const label = `#${person.id} ${person.activity}`
          ctx.font = `bold ${22 * DRAW_SCALE}px system-ui, sans-serif`
          const labelX = person.centroid.x + 12 * DRAW_SCALE
          const labelY = person.centroid.y - 14 * DRAW_SCALE
          const labelW = ctx.measureText(label).width
          ctx.fillStyle = 'rgba(0,0,0,0.55)'
          ctx.fillRect(labelX - 6 * DRAW_SCALE, labelY - 22 * DRAW_SCALE, labelW + 12 * DRAW_SCALE, 30 * DRAW_SCALE)
          ctx.fillStyle = color
          ctx.fillText(label, labelX, labelY)
        }

        for (const zone of zonesRef.current) {
          if (zone.points.length < MIN_ZONE_POINTS) continue
          const occupied = people.some((p) => (p.zoneDwell[zone.id] ?? 0) > 0)
          const zoneColor = occupied ? '#c58b2a' : '#22b8cf'
          ctx.strokeStyle = zoneColor
          ctx.fillStyle = occupied ? 'rgba(197,139,42,0.12)' : 'rgba(34,184,207,0.1)'
          ctx.lineWidth = 3 * DRAW_SCALE
          ctx.beginPath()
          zone.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
          ctx.closePath()
          ctx.fill()
          ctx.stroke()

          const c = zoneCentroid(zone)
          ctx.font = `bold ${18 * DRAW_SCALE}px system-ui, sans-serif`
          const labelW = ctx.measureText(zone.label).width
          ctx.fillStyle = zoneColor
          ctx.fillText(zone.label, c.x - labelW / 2, c.y)
        }
      }

      // A frame that throws (a transient inference hiccup, a decode error) must
      // not permanently kill the loop — without the try/catch below, that
      // exception happened before the final requestAnimationFrame call at the
      // bottom, so the loop simply stopped scheduling itself forever: the
      // canvas froze on the last successfully drawn frame while the <video>
      // element itself, whose playback isn't tied to this loop at all, kept
      // right on playing — exactly the "video plays but the frame is stuck"
      // symptom this fixes.
      const drawLoop = () => {
        if (stopped) return
        // While a paused-frame inspection is computing/showing, its own
        // render owns the canvas — drawing here would just immediately
        // overwrite it with the plain video + stale overlays every tick.
        if (!isInspecting) {
          try {
            ctx.save()
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(video, cover.sx, cover.sy, cover.sw, cover.sh, 0, 0, canvas.width, canvas.height)
            drawOverlays()
            ctx.restore()
          } catch (err) {
            console.error('[CameraStage] draw frame failed, retrying next frame', err)
            // restore() on an empty/already-balanced stack is a documented
            // no-op, so this is always safe to call even if the failure
            // happened between save() and restore() above.
            ctx.restore()
          }
        }
        raf = requestAnimationFrame(drawLoop)
      }

      // ---- Inference: runs on its own rAF-gated cadence, independent of the
      // draw loop above. `inferenceBusy` guarantees at most one estimatePoses
      // call in flight at a time — if a pass is still running when the next
      // tick arrives, that tick just no-ops and checks again next frame.
      // Nothing is ever queued: whenever a pass finishes, the *next* tick
      // reads whatever the video's current frame is by then, so slow
      // inference means fewer, freshest updates rather than a growing
      // backlog of stale ones.
      let inferenceBusy = false
      const runInferencePass = async () => {
        const now = performance.now()
        const dt = (now - lastFrameTime) / 1000
        lastFrameTime = now

        const poses = await estimatePoses(video, qualityRef.current)
        if (stopped) return
        if (poses.length !== lastLoggedPoseCount) {
          console.info(`[detect] ${qualityRef.current}: ${poses.length} pose(s) this frame`, poses)
          lastLoggedPoseCount = poses.length
        }

        const seenIds = new Set<number>()

        for (const pose of poses) {
          const id = pose.id ?? -1
          if (id < 0) continue
          seenIds.add(id)

          const prev = peopleRef.current.get(id)
          const activityRaw = classifyActivity(pose, prev)

          const wristPoint = pose.keypoints
            .filter((k) => (k.name === 'left_wrist' || k.name === 'right_wrist') && (k.score ?? 0) > 0.3)
            .sort((a, b) => a.y - b.y)[0]
          // classifyActivity/history stay in native video-space (unaffected by canvas presentation size);
          // zones and drawing use the canvas-space point after the cover crop/scale.
          const centroid: Point = getCentroid(pose)
          const canvasCentroid = mapPointCover(centroid, cover)

          const loiterSec = loiterThresholdRef.current
          const lingerSec = loiterSec * LINGER_THRESHOLD_RATIO
          const zoneDwell = { ...(prev?.zoneDwell ?? {}) }
          const zoneLastInside = { ...(prev?.zoneLastInside ?? {}) }
          const zoneVisits = { ...(prev?.zoneVisits ?? {}) }
          for (const zone of zonesRef.current) {
            const inside = pointInZone(canvasCentroid, zone)
            const key = zone.id
            const before = zoneDwell[key] ?? 0
            if (inside) {
              zoneDwell[key] = before + dt
              zoneLastInside[key] = now
              if (before === 0) {
                zoneVisits[key] = (zoneVisits[key] ?? 0) + 1
                if (zoneVisits[key] === ZONE_REVISIT_ALERT_COUNT) {
                  onEvent({
                    id: `${Date.now()}-${id}-${key}-revisit`,
                    timestamp: Date.now(),
                    personId: id,
                    message: `Person ${id} has revisited "${zone.label}" ${ZONE_REVISIT_ALERT_COUNT} times`,
                    level: 'info',
                  })
                }
              }
              if (before < lingerSec && zoneDwell[key] >= lingerSec) {
                onEvent({
                  id: `${Date.now()}-${id}-${key}-linger`,
                  timestamp: Date.now(),
                  personId: id,
                  message: `Person ${id} lingering in "${zone.label}"`,
                  level: 'info',
                })
              }
              if (before < loiterSec && zoneDwell[key] >= loiterSec) {
                onEvent({
                  id: `${Date.now()}-${id}-${key}`,
                  timestamp: Date.now(),
                  personId: id,
                  message: `Person ${id} loitering in "${zone.label}" (${loiterSec}s+)`,
                  level: 'warning',
                })
              }
            } else {
              const lastInside = zoneLastInside[key] ?? 0
              const sinceLeftSec = (now - lastInside) / 1000
              if (sinceLeftSec > ZONE_EXIT_GRACE_SEC) {
                zoneDwell[key] = 0
                zoneLastInside[key] = 0
              }
              // else: briefly outside (flicker/occlusion) — hold dwell steady until grace expires
            }
          }

          const anyLoitering = Object.values(zoneDwell).some((v) => v >= loiterSec)
          const anyLingering = Object.values(zoneDwell).some((v) => v >= lingerSec)
          const activity = anyLoitering ? 'loitering' : anyLingering ? 'lingering' : activityRaw

          const history = pushHistory(prev?.history ?? [], centroid)

          const person: TrackedPerson = {
            id,
            centroid: canvasCentroid,
            wrist: wristPoint ? mapPointCover({ x: wristPoint.x, y: wristPoint.y }, cover) : null,
            activity,
            lastSeen: now,
            zoneDwell,
            zoneLastInside,
            zoneVisits,
            history,
          }
          peopleRef.current.set(id, person)
          keypointsRef.current.set(id, pose.keypoints)
        }

        for (const [id, person] of Array.from(peopleRef.current)) {
          if (!seenIds.has(id) && now - person.lastSeen > STALE_PERSON_GRACE_MS) {
            peopleRef.current.delete(id)
            keypointsRef.current.delete(id)
          }
        }

        onPeopleUpdate(Array.from(peopleRef.current.values()))

        frameCount++
        if (now - fpsTimer > 1000) {
          onFps(Math.round((frameCount * 1000) / (now - fpsTimer)))
          frameCount = 0
          fpsTimer = now
        }
      }

      const inferenceLoop = () => {
        if (stopped) return
        if (!inferenceBusy && !video.paused && !video.ended && !isInspecting) {
          inferenceBusy = true
          runInferencePass()
            .catch((err) => console.error('[CameraStage] inference frame failed, retrying next frame', err))
            .finally(() => {
              inferenceBusy = false
            })
        }
        inferRaf = requestAnimationFrame(inferenceLoop)
      }

      raf = requestAnimationFrame(drawLoop)
      inferRaf = requestAnimationFrame(inferenceLoop)
    }

    start()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(inferRaf)
      detachPlaybackListeners?.()
      stream?.getTracks().forEach((t) => t.stop())
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setResolution(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, running, retryTick])

  function toCanvasCoords(e: React.MouseEvent) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function finishZone(points: Point[]) {
    if (points.length < MIN_ZONE_POINTS) return
    const n = zones.length + 1
    onZonesChange([...zones, { id: `zone-${Date.now()}`, label: `Zone ${n}`, points }])
    setDraftPoints([])
    setCursorPos(null)
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (!drawMode) return
    const p = toCanvasCoords(e)
    if (draftPoints.length >= MIN_ZONE_POINTS) {
      const first = draftPoints[0]
      const dist = Math.hypot(p.x - first.x, p.y - first.y)
      if (dist < CLOSE_POINT_RADIUS_PX * DRAW_SCALE) {
        finishZone(draftPoints)
        return
      }
    }
    setDraftPoints((prev) => [...prev, p])
  }

  function handleCanvasMouseMove(e: React.MouseEvent) {
    if (!drawMode) return
    setCursorPos(toCanvasCoords(e))
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragDepth.current++
    setIsDragOver(true)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragOver(false)
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('video/'))
    if (file) onFileDrop(file)
  }

  function handleCapture() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `activity-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  function togglePlayPause() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play()
    else video.pause()
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current
    if (!video) return
    const t = Number(e.target.value)
    video.currentTime = t
    setCurrentTime(t)
  }

  function formatTime(t: number) {
    if (!Number.isFinite(t)) return '0:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const draftLine = cursorPos ? [...draftPoints, cursorPos] : draftPoints

  return (
    <div className="stage">
      <div className="stage-toolbar">
        {drawMode && (
          <div className="toolbar-group">
            <button className="btn" onClick={() => finishZone(draftPoints)} disabled={draftPoints.length < MIN_ZONE_POINTS}>
              <Check size={13} weight="bold" />
              Finish zone
            </button>
            <button className="btn" onClick={() => setDraftPoints([])} disabled={!draftPoints.length}>
              <X size={13} weight="bold" />
              Cancel zone
            </button>
          </div>
        )}
        <div className="toolbar-group">
          <button
            className="btn"
            onClick={() => setOverlayMode((m) => (m === 'full' ? 'minimal' : 'full'))}
            title="Toggle skeleton overlay"
          >
            {overlayMode === 'full' ? <Eye size={13} weight="bold" /> : <EyeClosed size={13} weight="bold" />}
            {overlayMode === 'full' ? 'Overlay: Full' : 'Overlay: Minimal'}
          </button>
          <button className="btn" onClick={handleCapture}>
            <Camera size={13} weight="bold" />
            Capture frame
          </button>
          <label className="toggle" title={running ? 'Stop feed' : 'Start feed'}>
            <input type="checkbox" checked={running} onChange={() => setRunning((r) => !r)} />
            <span className="toggle-track" />
            <span className="toggle-label">Feed</span>
          </label>
          <button
            className="btn btn-icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <CornersIn size={13} weight="bold" /> : <CornersOut size={13} weight="bold" />}
          </button>
        </div>
      </div>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <div
        ref={stageFrameRef}
        className={isDragOver ? 'stage-frame drag-over' : 'stage-frame'}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          className={drawMode ? 'draw-cursor' : ''}
        />
        {isDragOver && (
          <div className="drop-overlay">
            <UploadSimple size={28} weight="bold" />
            Drop video to upload
          </div>
        )}
        {running && !status && source.kind === 'camera' && (
          <div className="live-badge">
            <span className="live-dot" />
            Live
          </div>
        )}
        {running && !status && (
          <div className="hud-stats">
            <span>{fps} FPS</span>
            <span className="hud-sep" />
            <span>
              {peopleCount} tracked
            </span>
            {resolution && (
              <>
                <span className="hud-sep" />
                <span>
                  {resolution.w}×{resolution.h}
                </span>
              </>
            )}
          </div>
        )}
        {inspecting && (
          <div className="live-badge">
            <CircleNotch size={12} weight="bold" className="spin" />
            Analyzing frame
          </div>
        )}
        {drawMode && draftPoints.length > 0 && (
          <svg className="zone-draft-overlay" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} preserveAspectRatio="none">
            <polyline
              points={draftLine.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#22b8cf"
              strokeWidth={3 * DRAW_SCALE}
              strokeDasharray={`${8 * DRAW_SCALE} ${6 * DRAW_SCALE}`}
            />
            {draftPoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={7 * DRAW_SCALE} fill={i === 0 ? '#2f8f5b' : '#22b8cf'} />
            ))}
          </svg>
        )}
        {alertPulse > 0 && <div key={alertPulse} className="alert-flash" />}
        {status && status.endsWith('…') && (
          <div className="stage-status stage-status-loading">
            <CircleNotch size={16} weight="bold" className="spin" />
            {status}
          </div>
        )}
        {status === 'Camera access denied or unavailable.' && (
          <div className="stage-status">
            <span className="stage-status-icon">
              <VideoCameraSlash size={20} weight="bold" />
            </span>
            <span className="stage-status-title">Camera access unavailable</span>
            <span className="stage-status-body">
              Grant camera permission in your browser, or use a video file instead.
            </span>
            <div className="stage-status-actions">
              <button className="btn active" onClick={() => setRetryTick((n) => n + 1)}>
                <Camera size={13} weight="bold" />
                Enable camera
              </button>
              <button className="btn" onClick={onRequestUpload}>
                <UploadSimple size={13} weight="bold" />
                Upload video
              </button>
            </div>
          </div>
        )}
        {status && status !== 'Camera access denied or unavailable.' && !status.endsWith('…') && (
          <div className="stage-status">
            <span className="stage-status-title">{status}</span>
          </div>
        )}
      </div>
      {source.kind === 'upload' && running && (
        <div className="video-scrubber">
          <button className="btn btn-icon" onClick={togglePlayPause} aria-label={videoPlaying ? 'Pause' : 'Play'}>
            {videoPlaying ? <Pause size={13} weight="bold" /> : <Play size={13} weight="bold" />}
          </button>
          <input
            type="range"
            className="scrub-range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
          />
          <span className="scrub-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      )}
    </div>
  )
}
