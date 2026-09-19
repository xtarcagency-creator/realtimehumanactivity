import * as poseDetection from '@tensorflow-models/pose-detection'
import type { DetectionQuality } from './types'
import { estimateTopDownPoses, estimateTopDownPosesDetailed, resetTopDownTracker, preloadTopDownModels } from './topDownPose'
import { createMoveNetDetector, warmMoveNetWeights, MOVENET_MULTIPOSE_LIGHTNING_URL } from './tfBackend'
import { createProgressAggregator } from './downloadProgress'

export type Pose = poseDetection.Pose
export type Detector = poseDetection.PoseDetector

type BottomUpQuality = 'fast' | 'balanced'

// Fast/Balanced use MoveNet MultiPose (one pass over the whole frame — cheap,
// good for a live webcam demo). The real speed/accuracy knob it exposes is
// multiPoseMaxDimension, the size input frames are scaled to before
// inference. Must be a multiple of 32.
const QUALITY_DIMENSION: Record<BottomUpQuality, number> = {
  fast: 256,
  balanced: 384,
}

let bottomUpCurrent: { quality: BottomUpQuality; detector: Promise<Detector> } | null = null

function getBottomUpDetector(quality: BottomUpQuality, onProgress?: (fraction: number) => void): Promise<Detector> {
  if (!bottomUpCurrent || bottomUpCurrent.quality !== quality) {
    const prevPromise = bottomUpCurrent?.detector ?? null
    const nextPromise = (async () => {
      const reporter = onProgress ? createProgressAggregator(onProgress) : undefined
      await warmMoveNetWeights(MOVENET_MULTIPOSE_LIGHTNING_URL, 'bottomup', reporter)
      const detector = await createMoveNetDetector({
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        modelUrl: MOVENET_MULTIPOSE_LIGHTNING_URL,
        enableTracking: true,
        trackerType: poseDetection.TrackerType.BoundingBox,
        // Default maxAge is 1000ms — raised to match the top-down pipeline's own
        // tracker (see tracker.ts) so a person briefly occluded or missed for a
        // frame doesn't get a new id (and a reset loiter timer) regardless of
        // which detection quality tier is active.
        trackerConfig: { maxTracks: 18, maxAge: 1200, minSimilarity: 0.15, boundingBoxTrackerParams: {} },
        multiPoseMaxDimension: QUALITY_DIMENSION[quality],
        // Default is 0.25 — lowered further so a second, less-confident person
        // (partially occluded, smaller in frame) still gets included as a
        // detection at all; our own per-keypoint score filtering still hides
        // noisy joints, so this only costs precision, not visible garbage.
        minPoseScore: 0.1,
      })
      if (prevPromise) {
        const prevDetector = await prevPromise
        prevDetector.dispose()
      }
      return detector
    })()
    bottomUpCurrent = { quality, detector: nextPromise }
  }
  return bottomUpCurrent.detector
}

/**
 * Fast/Balanced: single-pass MoveNet MultiPose over the whole frame.
 * High: top-down pipeline (person detector + per-person crop through MoveNet
 * Thunder) — much more accurate when people are small, close together, or
 * overlapping (e.g. low-res CCTV-style footage), at a real FPS cost.
 */
export async function estimatePoses(video: HTMLVideoElement, quality: DetectionQuality): Promise<Pose[]> {
  if (quality === 'high') {
    return estimateTopDownPoses(video)
  }
  const detector = await getBottomUpDetector(quality)
  return detector.estimatePoses(video, { flipHorizontal: false })
}

export function resetTracking() {
  resetTopDownTracker()
}

/**
 * Always runs the full top-down ensemble pipeline, uncapped and with a
 * forced fresh box detection, regardless of the currently selected quality
 * tier — meant for inspecting a single paused frame, where there's no
 * real-time FPS budget to protect. Loads the top-down models on first use if
 * the active quality tier hasn't already warmed them (a real, one-time delay
 * on Fast/Balanced the first time someone pauses).
 */
export async function estimateDetailedPoses(video: HTMLVideoElement): Promise<Pose[]> {
  await preloadTopDownModels()
  return estimateTopDownPosesDetailed(video)
}

/**
 * Start loading a quality tier's models ahead of the first frame that needs
 * them; resolves once ready. `onProgress` reports real download progress
 * (0-1) — 1 immediately if the tier's models are already cached from a
 * previous load.
 */
export function preloadModels(quality: DetectionQuality, onProgress?: (fraction: number) => void): Promise<void> {
  if (quality === 'high') {
    return preloadTopDownModels(onProgress)
  }
  return getBottomUpDetector(quality, onProgress).then(() => undefined)
}

export function keypoint(pose: Pose, name: string) {
  return pose.keypoints.find((k) => k.name === name)
}
