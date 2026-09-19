// Full-video batch analysis for uploaded footage: instead of running
// inference live while the video plays (capped by however fast the active
// model can go), seek through the whole file once, run detection at each
// sampled timestamp, and record the result. Playback afterward just looks
// up the precomputed frame nearest the current time — smooth regardless of
// model speed, and correct at any scrub position, not just "whatever's
// currently visible."
import { estimatePoses, resetTracking } from './pose'
import { processFrame } from './frameProcessor'
import type { CoverTransform } from './coverMap'
import type { ActivityEvent, DetectionQuality, TrackedPerson, Zone } from './types'
import type { Pose } from './pose'

// 10 samples/sec — close enough together that playback looks as smooth as
// the live loop already does (which updates at whatever FPS the model
// manages, typically well under this), without paying for every single
// native video frame (30fps would be 3x the analysis time for essentially
// the same visible result, since detections don't change meaningfully
// frame-to-frame at video framerate).
const SAMPLE_INTERVAL_SEC = 0.1

export interface AnalyzedFrame {
  time: number
  people: TrackedPerson[]
  keypoints: Map<number, Pose['keypoints']>
}

export interface VideoAnalysisResult {
  frames: AnalyzedFrame[]
  events: ActivityEvent[]
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      video.removeEventListener('seeked', handler)
      resolve()
    }
    video.addEventListener('seeked', handler)
    video.currentTime = t
  })
}

export async function analyzeVideo(
  video: HTMLVideoElement,
  zones: Zone[],
  cover: CoverTransform,
  quality: DetectionQuality,
  loiterThresholdSec: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<VideoAnalysisResult> {
  const duration = video.duration
  resetTracking()

  let people = new Map<number, TrackedPerson>()
  let keypoints = new Map<number, Pose['keypoints']>()
  const frames: AnalyzedFrame[] = []
  const events: ActivityEvent[] = []
  // A synthetic clock, not wall-clock time — this pass runs far faster or
  // slower than real playback depending on the model, but the zone
  // exit-grace/revisit logic (see frameProcessor.ts) needs a clock that
  // advances in step with the *video's* timeline, not however long each
  // sample actually took to compute.
  let simulatedNowMs = 0
  let lastT = 0

  for (let t = 0; t <= duration; t += SAMPLE_INTERVAL_SEC) {
    if (signal?.aborted) break
    // eslint-disable-next-line no-await-in-loop
    await seekTo(video, Math.min(t, duration))
    if (signal?.aborted) break
    // eslint-disable-next-line no-await-in-loop
    const poses = await estimatePoses(video, quality)
    if (signal?.aborted) break

    const dt = t - lastT
    simulatedNowMs += dt * 1000
    lastT = t

    const result = processFrame(poses, people, keypoints, zones, cover, dt, simulatedNowMs, loiterThresholdSec)
    people = result.people
    keypoints = result.keypoints
    events.push(...result.events)
    frames.push({ time: t, people: Array.from(people.values()), keypoints: new Map(keypoints) })

    onProgress(duration > 0 ? Math.min(1, t / duration) : 1)
  }

  onProgress(1)
  return { frames, events }
}

/** Nearest sample at or before `time` — frames are in ascending time order. */
export function findAnalyzedFrame(frames: AnalyzedFrame[], time: number): AnalyzedFrame | null {
  if (frames.length === 0) return null
  let lo = 0
  let hi = frames.length - 1
  if (time <= frames[0].time) return frames[0]
  if (time >= frames[hi].time) return frames[hi]
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid].time <= time) lo = mid
    else hi = mid - 1
  }
  return frames[lo]
}
