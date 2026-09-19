import { detectPoses, preloadYolo26PoseModel, type RawPersonDetection } from './yolo26PoseDetector'
import { createProgressAggregator } from './downloadProgress'
import { CentroidTracker } from './tracker'
import type { Pose } from './pose'

// High used to be a three-model ensemble (YOLO11s box detector + MoveNet
// Thunder per-person pose + MoveNet MultiPose as a second box proposal) —
// replaced with a single YOLO26n-pose pass (see yolo26PoseDetector.ts) that
// outputs boxes and all 17 keypoints directly per person in one forward
// pass. That old pipeline repeatedly hit real, hard-to-diagnose stalls
// creating two separate WebGL graph models concurrently (plus a third,
// separate WASM runtime, all contending at once) — this one has no WebGL
// involved at all, just the same ONNX Runtime/WASM path the old box-only
// YOLO detector already used reliably. Simpler too: no separate
// box-detection-then-crop-then-pose stages to keep synchronized, no
// box-refresh-interval caching to amortize an expensive box-detection step
// that no longer exists — one pass gives both boxes and poses together,
// every frame.
const MAX_TRACKED_PEOPLE = 10

const tracker = new CentroidTracker()

export function resetTopDownTracker() {
  tracker.reset()
}

/**
 * Warm the model so switching to High doesn't stall the first frame. Two
 * downloads (the model + ONNX Runtime's own wasm runtime — see
 * yolo26PoseDetector.ts), combined into one byte-weighted fraction rather
 * than the old three-model pipeline's aggregator, but the same weighting
 * logic since it's still more than one file.
 */
export function preloadTopDownModels(onProgress?: (fraction: number) => void): Promise<void> {
  const reporter = onProgress ? createProgressAggregator(onProgress) : undefined
  return preloadYolo26PoseModel(reporter).then(() => undefined)
}

function centroidOf(det: RawPersonDetection): { x: number; y: number } {
  const hip = det.keypoints.find((k) => (k.name === 'left_hip' || k.name === 'right_hip') && (k.score ?? 0) > 0.3)
  if (hip) return { x: hip.x, y: hip.y }
  return { x: (det.x0 + det.x1) / 2, y: (det.y0 + det.y1) / 2 }
}

function capMostProminent(detections: RawPersonDetection[]): RawPersonDetection[] {
  if (detections.length <= MAX_TRACKED_PEOPLE) return detections
  return [...detections]
    .sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
    .slice(0, MAX_TRACKED_PEOPLE)
}

/** Live-loop path: capped person count, persistent tracker ids. */
export async function estimateTopDownPoses(video: HTMLVideoElement): Promise<Pose[]> {
  const detections = capMostProminent(await detectPoses(video))
  const ids = tracker.update(
    detections.map(centroidOf),
    performance.now(),
  )
  return detections.map((d, i) => ({ id: ids[i], keypoints: d.keypoints }))
}

/**
 * One-shot "inspect this paused frame" path: no person cap, since there's no
 * real-time budget to protect for a single still frame. Deliberately
 * bypasses the persistent tracker — this is a disconnected snapshot, not a
 * continuation of the tracked sequence, so it gets its own throwaway
 * per-call ids instead of ids that could collide with or confuse ongoing
 * tracking.
 */
export async function estimateTopDownPosesDetailed(video: HTMLVideoElement): Promise<Pose[]> {
  const detections = await detectPoses(video)
  return detections.map((d, i) => ({ id: i + 1, keypoints: d.keypoints }))
}
