import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import * as poseDetection from '@tensorflow-models/pose-detection'

// MoveNet weights, bundled locally — same as YOLO (see yoloDetector.ts) and
// for the same reason: no runtime dependency on a model-hosting CDN. These
// otherwise default to fetching from tfhub.dev on every cold load, which is
// what made switching to High (which loads two MoveNet variants on top of
// YOLO) noticeably slow to warm up, especially on a slow/blocked path to
// that CDN. Re-hosted by the TF.js community (vladmandic/human-models,
// itself just a re-conversion of the same original Google MoveNet weights —
// same modelType/version, confirmed via each file's own `generatedBy` field
// pointing at the exact tfhub.dev URLs this project used to load from
// directly) since tfhub.dev isn't reachable from every network.
export const MOVENET_MULTIPOSE_LIGHTNING_URL = '/models/movenet-multipose.json'
export const MOVENET_SINGLEPOSE_THUNDER_URL = '/models/movenet-thunder.json'

// WebGPU was tried here and reverted: its video-frame import
// (importExternalTexture) hit a real "doesn't have back resource" failure
// on real hardware, on every single frame, effectively producing zero
// detections despite running without crashing. WebGL has been reliable
// through this entire project — not worth chasing WebGPU's speed at the
// cost of detection silently going dark on browsers/videos it doesn't like.
let backendPromise: Promise<void> | null = null

function ensureBackend(): Promise<void> {
  if (!backendPromise) {
    backendPromise = (async () => {
      await tf.setBackend('webgl')
      await tf.ready()
    })()
  }
  return backendPromise
}

export async function createMoveNetDetector(
  config: poseDetection.MoveNetModelConfig,
): Promise<poseDetection.PoseDetector> {
  await ensureBackend()
  return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, config)
}
