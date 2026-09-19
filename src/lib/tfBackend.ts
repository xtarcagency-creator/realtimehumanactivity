import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import * as poseDetection from '@tensorflow-models/pose-detection'

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
