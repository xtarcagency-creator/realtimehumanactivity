import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import * as poseDetection from '@tensorflow-models/pose-detection'
import { fetchBuffer, type ProgressReporter } from './downloadProgress'

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

// Exact sizes of the bundled files above, used only as a progress-bar
// fallback (see warmMoveNetWeights/fetchBuffer) when a CDN drops
// Content-Length in flight. Update these if the model files themselves are
// ever replaced.
const MOVENET_FILE_SIZES: Record<string, { json: number; bin: number }> = {
  [MOVENET_MULTIPOSE_LIGHTNING_URL]: { json: 240464, bin: 9448838 },
  [MOVENET_SINGLEPOSE_THUNDER_URL]: { json: 161923, bin: 12477112 },
}

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

interface WeightsManifestEntry {
  paths: string[]
}

// pose-detection's own MoveNet loader doesn't expose download progress, so
// this fetches the model's json + weight files ourselves first (reporting
// real bytes as they arrive) purely to prime the browser's HTTP cache —
// createMoveNetDetector's own subsequent fetch of the same URLs then hits
// that cache and resolves near-instantly instead of downloading again.
const warmedModelUrls = new Set<string>()

export async function warmMoveNetWeights(modelUrl: string, key: string, reporter?: ProgressReporter): Promise<void> {
  if (warmedModelUrls.has(modelUrl)) return
  const knownSizes = MOVENET_FILE_SIZES[modelUrl]
  const jsonBuf = await fetchBuffer(modelUrl, `${key}-json`, reporter, knownSizes?.json)
  const manifest = JSON.parse(new TextDecoder().decode(jsonBuf)) as { weightsManifest: WeightsManifestEntry[] }
  const base = modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1)
  const binPaths = manifest.weightsManifest.flatMap((group) => group.paths)
  await Promise.all(binPaths.map((path) => fetchBuffer(base + path, `${key}-${path}`, reporter, knownSizes?.bin)))
  warmedModelUrls.add(modelUrl)
}
