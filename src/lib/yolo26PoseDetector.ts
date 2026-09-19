// YOLO26n-pose (Ultralytics, COCO), exported to ONNX at 640x640 input,
// bundled locally at public/models/yolo26n-pose.onnx. Replaces the old
// three-model High pipeline (YOLO11s box detector + MoveNet Thunder +
// MoveNet MultiPose as a second box proposal) with a single pass: one model
// outputs both person boxes and all 17 keypoints directly, at under a third
// of the combined download size (~12MB vs ~74MB) and — critically — no
// WebGL involved at all, just ONNX Runtime/WASM (the same runtime already
// used for the old box-only YOLO11s), so none of the WebGL model-creation
// contention/hangs that pipeline kept hitting apply here.
//
// Verified against the reference PyTorch model (Ultralytics' own
// model.predict, not just the export step) on a real photo before wiring
// this in: decoded boxes and keypoints from this exact letterbox+decode
// logic matched the reference output closely (same detections, same
// confidence range, keypoint coordinates within ~1px).
import * as ort from 'onnxruntime-web/wasm'
import { fetchBuffer, type ProgressReporter } from './downloadProgress'
import type { Pose } from './pose'

const MODEL_URL = '/models/yolo26n-pose.onnx'
// Exact size of the bundled file above, used only as a progress-bar
// fallback (see fetchBuffer) when a CDN drops Content-Length in flight.
// Update if the model file is ever replaced.
const MODEL_EXPECTED_BYTES = 12111334
const WASM_URL = '/models/ort-wasm-simd-threaded.wasm'
const WASM_EXPECTED_BYTES = 14239897
const INPUT_SIZE = 640
// Lowered from the library's typical 0.25 default — recall matters more
// than precision here, matching the same reasoning as the old box-only
// YOLO detector this replaces.
const CONF_THRESHOLD = 0.15
const NMS_IOU_THRESHOLD = 0.45
// Output layout: rows 0-3 are box (cx,cy,w,h) in letterboxed pixel space,
// row 4 is the single-class (person) confidence, already sigmoid-activated
// by the export graph, rows 5-55 are 17 keypoints x (x,y,visibility).
const NUM_KEYPOINTS = 17
const BOX_ROWS = 4
const SCORE_ROWS = 1

// Order must match the model's own training keypoint order (standard COCO
// pose), and matches @tensorflow-models/pose-detection's COCO_KEYPOINTS
// exactly so downstream code (skeleton drawing, activity classification)
// that matches on keypoint name works unchanged regardless of which
// detector produced the pose.
const COCO_KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
]

export interface RawPersonDetection {
  x0: number
  y0: number
  x1: number
  y1: number
  score: number
  keypoints: Pose['keypoints']
}

let sessionPromise: Promise<ort.InferenceSession> | null = null
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
let letterboxCanvas: HTMLCanvasElement | null = null

function loadWasmBinary(reporter?: ProgressReporter): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fetchBuffer(WASM_URL, 'yolo26-wasm', reporter, WASM_EXPECTED_BYTES)
  }
  return wasmBinaryPromise
}

function getSession(reporter?: ProgressReporter): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = Promise.all([
      fetchBuffer(MODEL_URL, 'yolo26', reporter, MODEL_EXPECTED_BYTES),
      loadWasmBinary(reporter),
    ]).then(([modelBuf, wasmBuf]) => {
      ort.env.wasm.wasmBinary = wasmBuf
      return ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] })
    })
  }
  return sessionPromise
}

/** Preload the model so the first detection call isn't slowed by the fetch/compile. */
export function preloadYolo26PoseModel(reporter?: ProgressReporter): Promise<ort.InferenceSession> {
  return getSession(reporter)
}

interface Letterbox {
  scale: number
  padX: number
  padY: number
}

function computeLetterbox(vw: number, vh: number): Letterbox {
  const scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh)
  const nw = Math.round(vw * scale)
  const nh = Math.round(vh * scale)
  return { scale, padX: Math.floor((INPUT_SIZE - nw) / 2), padY: Math.floor((INPUT_SIZE - nh) / 2) }
}

function iou(a: RawPersonDetection, b: RawPersonDetection): number {
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

function nms(boxes: RawPersonDetection[]): RawPersonDetection[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: RawPersonDetection[] = []
  for (const box of sorted) {
    if (!kept.some((k) => iou(k, box) > NMS_IOU_THRESHOLD)) kept.push(box)
  }
  return kept
}

export async function detectPoses(video: HTMLVideoElement): Promise<RawPersonDetection[]> {
  const session = await getSession()
  const vw = video.videoWidth
  const vh = video.videoHeight
  const { scale, padX, padY } = computeLetterbox(vw, vh)
  const nw = Math.round(vw * scale)
  const nh = Math.round(vh * scale)

  if (!letterboxCanvas) letterboxCanvas = document.createElement('canvas')
  letterboxCanvas.width = INPUT_SIZE
  letterboxCanvas.height = INPUT_SIZE
  const ctx = letterboxCanvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = 'rgb(114,114,114)' // YOLO's standard letterbox pad color
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  ctx.drawImage(video, 0, 0, vw, vh, padX, padY, nw, nh)

  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
  const plane = INPUT_SIZE * INPUT_SIZE
  for (let i = 0; i < plane; i++) {
    const o = i * 4
    chw[i] = data[o] / 255 // R
    chw[plane + i] = data[o + 1] / 255 // G
    chw[2 * plane + i] = data[o + 2] / 255 // B
  }

  const inputTensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const outputs = await session.run({ [session.inputNames[0]]: inputTensor })
  const raw = outputs[session.outputNames[0]]
  // Output shape [1, 56, 8400]: 4 box rows + 1 score row + 17*3 keypoint rows.
  const numAnchors = raw.dims[2]
  const values = raw.data as Float32Array
  const scoreRowOffset = BOX_ROWS * numAnchors

  const candidates: RawPersonDetection[] = []
  for (let i = 0; i < numAnchors; i++) {
    const score = values[scoreRowOffset + i]
    if (score < CONF_THRESHOLD) continue
    const cx = values[i]
    const cy = values[numAnchors + i]
    const w = values[2 * numAnchors + i]
    const h = values[3 * numAnchors + i]
    const ox = (cx - padX) / scale
    const oy = (cy - padY) / scale
    const ow = w / scale
    const oh = h / scale

    const keypoints: Pose['keypoints'] = []
    const kptRowOffset = (BOX_ROWS + SCORE_ROWS) * numAnchors
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const kx = values[kptRowOffset + (k * 3) * numAnchors + i]
      const ky = values[kptRowOffset + (k * 3 + 1) * numAnchors + i]
      const kv = values[kptRowOffset + (k * 3 + 2) * numAnchors + i]
      keypoints.push({
        x: (kx - padX) / scale,
        y: (ky - padY) / scale,
        score: kv,
        name: COCO_KEYPOINT_NAMES[k],
      })
    }

    candidates.push({ x0: ox - ow / 2, y0: oy - oh / 2, x1: ox + ow / 2, y1: oy + oh / 2, score, keypoints })
  }

  return nms(candidates)
}
