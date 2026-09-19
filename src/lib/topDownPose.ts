import * as poseDetection from '@tensorflow-models/pose-detection'
import { detectPersons, preloadYoloModel, type YoloBox } from './yoloDetector'
import { CentroidTracker } from './tracker'
import { createMoveNetDetector } from './tfBackend'
import type { Pose } from './pose'

// Bottom-up multi-pose models (MoveNet MultiPose) estimate every joint for
// every person in one pass over the whole frame, which is fast but breaks
// down exactly when people are small, close together, or overlapping — a
// single "person center" heatmap can't cleanly separate them. This top-down
// pipeline instead detects each person as their own bounding box first, then
// runs a much more accurate single-person model (MoveNet Thunder) on that
// person's own cropped, upscaled region.
//
// Person boxes come from two independent detectors, unioned and deduped:
// YOLOv8n (a modern, locally-bundled detector — see yoloDetector.ts; this
// specific pipeline was validated in Python against Ultralytics' own
// reference implementation before being ported) and MoveNet MultiPose's own
// per-instance box output (decoded from a person-center heatmap, a
// different mechanism with different failure modes than YOLO's NMS). Either
// detector catching a person is enough, which matters because any single
// detector's NMS can collapse two heavily-overlapping "person" boxes into
// one — exactly the case of two people standing close together.

// Lowered from the library's typical 0.2-0.25 defaults — recall matters more
// than precision here, since a missed person is invisible to the rest of the
// pipeline while a spurious low-confidence box just gets deduped/ignored.
const MULTIPOSE_PROPOSAL_SCORE_MIN = 0.1
// Traded down to 384 for speed, then reverted: recall on smaller/farther
// people matters more than the per-refresh speedup was worth.
const MULTIPOSE_PROPOSAL_DIMENSION = 512 // top of MoveNet's documented recommended range
const DEDUPE_IOU_THRESHOLD = 0.4
const CROP_SIZE = 256 // MoveNet SinglePose Thunder's native input size
const PAD_RATIO = 0.25 // padding around each detected box so joints near the edge aren't cut off
// Person boxes barely move frame to frame at video framerate, but detecting
// them costs two full model passes (YOLO + the MultiPose proposal detector).
// Only refresh boxes every Nth frame and reuse the cached ones between
// refreshes — Thunder still re-runs on every frame regardless, so the actual
// joint positions users see stay smooth; only the crop box itself goes
// briefly stale, which a few pixels of padding already absorbs. Raised to 5
// for speed, then brought back down: a new person entering frame has to wait
// up to this many frames before they're even considered.
const BOX_REFRESH_INTERVAL = 3
// Cap the worst-case cost of a crowded frame: each additional person here is
// one more full Thunder pass this frame, so an unbounded count can tank FPS
// exactly when there's the most going on. Keeps the largest (closest/most
// prominent) people.
const MAX_TRACKED_PEOPLE = 10

interface BoxProposal {
  x0: number
  y0: number
  x1: number
  y1: number
}

let singlePoseDetectorPromise: Promise<poseDetection.PoseDetector> | null = null
let proposalDetectorPromise: Promise<poseDetection.PoseDetector> | null = null
let cropCanvas: HTMLCanvasElement | null = null
const tracker = new CentroidTracker()
let cachedBoxes: BoxProposal[] = []
let framesSinceRefresh = BOX_REFRESH_INTERVAL // force a refresh on the first call

function getSinglePoseDetector() {
  if (!singlePoseDetectorPromise) {
    singlePoseDetectorPromise = createMoveNetDetector({
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
    })
  }
  return singlePoseDetectorPromise
}

function getProposalDetector() {
  if (!proposalDetectorPromise) {
    proposalDetectorPromise = createMoveNetDetector({
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: false,
      multiPoseMaxDimension: MULTIPOSE_PROPOSAL_DIMENSION,
      minPoseScore: 0.1,
    })
  }
  return proposalDetectorPromise
}

export function resetTopDownTracker() {
  tracker.reset()
  cachedBoxes = []
  framesSinceRefresh = BOX_REFRESH_INTERVAL
}

/** Warm all three models (YOLO, Thunder, MultiPose-proposal) so switching to High doesn't stall the first frame. */
export function preloadTopDownModels(): Promise<void> {
  return Promise.all([preloadYoloModel(), getSinglePoseDetector(), getProposalDetector()]).then(() => undefined)
}

function iou(a: BoxProposal, b: BoxProposal): number {
  const ix0 = Math.max(a.x0, b.x0)
  const iy0 = Math.max(a.y0, b.y0)
  const ix1 = Math.min(a.x1, b.x1)
  const iy1 = Math.min(a.y1, b.y1)
  const interArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0)
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0)
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0)
  const union = areaA + areaB - interArea
  return union > 0 ? interArea / union : 0
}

/** Keeps every box that doesn't heavily overlap one already kept, so the two detectors' proposals merge without double-counting the same person. */
function dedupeBoxes(boxes: BoxProposal[]): BoxProposal[] {
  const kept: BoxProposal[] = []
  for (const box of boxes) {
    if (!kept.some((k) => iou(k, box) > DEDUPE_IOU_THRESHOLD)) kept.push(box)
  }
  return kept
}

interface RawPose {
  keypoints: poseDetection.Keypoint[]
  centroid: { x: number; y: number }
}

async function detectRawPoses(
  video: HTMLVideoElement,
  opts: { forceRefresh: boolean; uncapped: boolean },
): Promise<RawPose[]> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const poseDetector = await getSinglePoseDetector()

  let people: BoxProposal[]
  const didRefresh = opts.forceRefresh || framesSinceRefresh >= BOX_REFRESH_INTERVAL
  if (didRefresh) {
    // YOLO (ONNX Runtime/WASM) and the MultiPose proposal detector (TF.js/
    // WebGL or WebGPU) are independent runtimes that don't contend for the
    // same execution resource, so run them concurrently instead of awaiting
    // one after the other.
    const proposalPosesPromise = getProposalDetector().then((d) => d.estimatePoses(video, { flipHorizontal: false }))
    const [yoloBoxes, proposalPoses] = await Promise.all([detectPersons(video), proposalPosesPromise])

    const yoloProposals: BoxProposal[] = yoloBoxes.map((b: YoloBox) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }))

    // MultiPose's box output is normalized [0,1] (unlike its keypoints, which
    // the library already scales to pixel space) — scale it ourselves.
    const poseBoxes: BoxProposal[] = proposalPoses
      .filter((p) => (p.score ?? 0) >= MULTIPOSE_PROPOSAL_SCORE_MIN && p.box)
      .map((p) => ({
        x0: p.box!.xMin * vw,
        y0: p.box!.yMin * vh,
        x1: p.box!.xMax * vw,
        y1: p.box!.yMax * vh,
      }))

    people = dedupeBoxes([...yoloProposals, ...poseBoxes])
    console.info(
      `[topdown] yolo boxes: ${yoloProposals.length}, proposal boxes: ${poseBoxes.length}, deduped: ${people.length}`,
    )
    // A one-shot detailed inspection (paused frame) must not disturb the live
    // loop's own refresh cycle — only the normal cached/throttled path
    // updates the shared cache, so resuming playback picks its own cadence
    // back up instead of inheriting a box set from wherever the user paused.
    if (!opts.forceRefresh) {
      cachedBoxes = people
      framesSinceRefresh = 0
    }
  } else {
    people = cachedBoxes
    framesSinceRefresh++
  }

  if (!opts.uncapped && people.length > MAX_TRACKED_PEOPLE) {
    people = [...people]
      .sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
      .slice(0, MAX_TRACKED_PEOPLE)
  }

  if (!cropCanvas) cropCanvas = document.createElement('canvas')
  cropCanvas.width = CROP_SIZE
  cropCanvas.height = CROP_SIZE
  const cropCtx = cropCanvas.getContext('2d')!

  const rawPoses: { keypoints: poseDetection.Keypoint[]; centroid: { x: number; y: number } }[] = []

  for (const box of people) {
    const bw = box.x1 - box.x0
    const bh = box.y1 - box.y0
    // Pad to a *square* crop (MoveNet's own expected input shape) instead of
    // stretching the box to fit — non-uniform scaling distorts body
    // proportions and measurably hurts keypoint accuracy.
    const cx = box.x0 + bw / 2
    const cy = box.y0 + bh / 2
    let side = Math.max(bw, bh) * (1 + PAD_RATIO * 2)
    // Cap the crop so it doesn't reach past a neighboring person's center —
    // for two people standing close together, an uncapped padded crop
    // around one can include the other's body, confusing the single-person
    // pose model (which assumes one dominant person in frame) even though
    // both got correctly detected as separate boxes.
    for (const other of people) {
      if (other === box) continue
      const ocx = other.x0 + (other.x1 - other.x0) / 2
      const ocy = other.y0 + (other.y1 - other.y0) / 2
      const dist = Math.hypot(cx - ocx, cy - ocy)
      side = Math.min(side, dist * 1.3)
    }
    const x0 = Math.max(0, cx - side / 2)
    const y0 = Math.max(0, cy - side / 2)
    const x1 = Math.min(vw, cx + side / 2)
    const y1 = Math.min(vh, cy + side / 2)
    const cropW = x1 - x0
    const cropH = y1 - y0
    if (cropW < 10 || cropH < 10) continue

    cropCtx.clearRect(0, 0, CROP_SIZE, CROP_SIZE)
    cropCtx.drawImage(video, x0, y0, cropW, cropH, 0, 0, CROP_SIZE, CROP_SIZE)

    // eslint-disable-next-line no-await-in-loop
    const [pose] = await poseDetector.estimatePoses(cropCanvas, { flipHorizontal: false })
    if (!pose) continue

    const keypoints = pose.keypoints.map((k) => ({
      ...k,
      x: x0 + (k.x / CROP_SIZE) * cropW,
      y: y0 + (k.y / CROP_SIZE) * cropH,
    }))
    const hip = keypoints.find((k) => (k.name === 'left_hip' || k.name === 'right_hip') && (k.score ?? 0) > 0.3)
    const centroid = hip ? { x: hip.x, y: hip.y } : { x: x0 + cropW / 2, y: y0 + cropH / 2 }
    rawPoses.push({ keypoints, centroid })
  }

  if (didRefresh) {
    console.info(`[topdown] people boxes after cap: ${people.length}, poses after crop+Thunder: ${rawPoses.length}`)
  }

  return rawPoses
}

/** Live-loop path: cached/throttled box refresh, capped person count, persistent tracker ids. */
export async function estimateTopDownPoses(video: HTMLVideoElement): Promise<Pose[]> {
  const rawPoses = await detectRawPoses(video, { forceRefresh: false, uncapped: false })
  const ids = tracker.update(
    rawPoses.map((p) => p.centroid),
    performance.now(),
  )
  return rawPoses.map((p, i) => ({ id: ids[i], keypoints: p.keypoints }))
}

/**
 * One-shot "inspect this paused frame" path: always fresh box detection, no
 * person cap, since there's no real-time budget to protect for a single
 * still frame. Deliberately bypasses the persistent tracker (and the live
 * loop's box cache) — this is a disconnected snapshot, not a continuation of
 * the tracked sequence, so it gets its own throwaway per-call ids instead of
 * ids that could collide with or confuse ongoing tracking.
 */
export async function estimateTopDownPosesDetailed(video: HTMLVideoElement): Promise<Pose[]> {
  const rawPoses = await detectRawPoses(video, { forceRefresh: true, uncapped: true })
  return rawPoses.map((p, i) => ({ id: i + 1, keypoints: p.keypoints }))
}
