// YOLO26s-pose (Ultralytics, COCO), exported to ONNX at 640x640 input,
// bundled locally at public/models/yolo26s-pose.onnx. Replaces the old
// three-model High pipeline (YOLO11s box detector + MoveNet Thunder +
// MoveNet MultiPose as a second box proposal) with a single pass: one model
// outputs both person boxes and all 17 keypoints directly, and — critically
// — no WebGL involved at all, just ONNX Runtime/WASM (the same runtime
// already used for the old box-only YOLO11s), so none of the WebGL
// model-creation contention/hangs that pipeline kept hitting apply here.
//
// The "s" (small) size, not "n" (nano) — nano loaded fast but had real
// accuracy headroom given up for that speed; small trades some of that
// speed back for meaningfully better detection, particularly on smaller or
// more distant people. Same architecture family and output layout as nano
// (same decode logic below), just a larger backbone.
//
// Verified against the reference PyTorch model (Ultralytics' own
// model.predict, not just the export step) on a real photo before wiring
// this in: decoded boxes and keypoints from this exact letterbox+decode
// logic matched the reference output closely (same detections, same
// confidence range, box coordinates within ~6px on this size, keypoints
// within ~1px on nano).
import * as ortWasm from 'onnxruntime-web/wasm'
import * as ortWebgpu from 'onnxruntime-web/webgpu'
import { fetchBuffer, type ProgressReporter } from './downloadProgress'
import type { Pose } from './pose'

type Ort = typeof ortWasm
type OrtSession = Awaited<ReturnType<Ort['InferenceSession']['create']>>

const MODEL_URL = '/models/yolo26s-pose.onnx'
// Exact size of the bundled file above, used only as a progress-bar
// fallback (see fetchBuffer) when a CDN drops Content-Length in flight.
// Update if the model file is ever replaced.
const MODEL_EXPECTED_BYTES = 41844706
// The plain (smaller, single-threaded-only) wasm runtime, used whenever
// WebGPU isn't attempted or fails.
const WASM_URL = '/models/ort-wasm-simd-threaded.wasm'
const WASM_EXPECTED_BYTES = 14239897
// WebGPU needs ONNX Runtime's "asyncify" wasm variant instead — a real ~12MB
// heavier download, only fetched when `navigator.gpu` exists at all (so a
// browser with no WebGPU support, e.g. Safari, never pays for it) and
// discarded in favor of the plain runtime above if session creation with it
// still fails for any reason.
const WEBGPU_WASM_URL = '/models/ort-wasm-simd-threaded.asyncify.wasm'
const WEBGPU_WASM_EXPECTED_BYTES = 26781914
const INPUT_SIZE = 640
// Raised well above the library's typical 0.25 default. The old box-only
// YOLO detector this replaces ran permissively (0.15) because it was one of
// two detectors being unioned together — a low-confidence false positive
// from YOLO alone still needed MoveNet's independent box output to agree
// before surviving the union, so noise got filtered downstream. YOLO26-pose
// is the only detector now: nothing unions its output with a second
// opinion, so every low-confidence guess that clears the threshold becomes
// a real, visible false detection instead of being caught later. 0.4 cuts
// that noise while still comfortably catching real people, who scored
// 0.7-0.9+ in every validation test run against this model.
const CONF_THRESHOLD = 0.4
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

let sessionPromise: Promise<OrtSession> | null = null
let letterboxCanvas: HTMLCanvasElement | null = null
// Whichever module (wasm-only or webgpu-capable) actually created the
// working session — inference calls below need its own Tensor class to
// build the input, matching whatever backend ended up running.
let activeOrt: Ort = ortWasm

// Explicitly single-threaded on both paths. The bundled runtimes are the
// "simd-threaded" family, which — unless told otherwise — try to spawn Web
// Workers backed by a shared WebAssembly.Memory (SharedArrayBuffer). That
// only works on a cross-origin-isolated page (Cross-Origin-Opener-Policy/
// Cross-Origin-Embedder-Policy response headers), which this app doesn't
// set and Vercel doesn't add by default — without it, thread setup can hang
// instead of failing cleanly. numThreads: 1 skips that path entirely on
// both the WASM execution provider and WebGPU's own wasm-side glue code.
function configureSingleThreaded(ort: Ort) {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
}

async function createWasmOnlySession(reporter?: ProgressReporter): Promise<OrtSession> {
  configureSingleThreaded(ortWasm)
  const [modelBuf, wasmBuf] = await Promise.all([
    fetchBuffer(MODEL_URL, 'yolo26', reporter, MODEL_EXPECTED_BYTES),
    fetchBuffer(WASM_URL, 'yolo26-wasm', reporter, WASM_EXPECTED_BYTES),
  ])
  ortWasm.env.wasm.wasmBinary = wasmBuf
  const session = await ortWasm.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] })
  activeOrt = ortWasm
  return session
}

async function createWebgpuSession(reporter?: ProgressReporter): Promise<OrtSession> {
  configureSingleThreaded(ortWebgpu)
  const [modelBuf, wasmBuf] = await Promise.all([
    fetchBuffer(MODEL_URL, 'yolo26', reporter, MODEL_EXPECTED_BYTES),
    fetchBuffer(WEBGPU_WASM_URL, 'yolo26-wasm-webgpu', reporter, WEBGPU_WASM_EXPECTED_BYTES),
  ])
  ortWebgpu.env.wasm.wasmBinary = wasmBuf
  // 'wasm' listed as a fallback provider too — ONNX Runtime's own provider
  // list already skips to the next entry if 'webgpu' turns out unsupported
  // partway through, on top of the explicit catch below for when session
  // creation fails outright instead of gracefully falling back internally.
  const session = await ortWebgpu.InferenceSession.create(modelBuf, { executionProviders: ['webgpu', 'wasm'] })
  activeOrt = ortWebgpu
  return session
}

function getSession(reporter?: ProgressReporter): Promise<OrtSession> {
  if (!sessionPromise) {
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
    sessionPromise = hasWebGPU
      ? createWebgpuSession(reporter).catch((err) => {
          console.warn('[yolo26] WebGPU session creation failed, falling back to single-threaded WASM', err)
          return createWasmOnlySession(reporter)
        })
      : createWasmOnlySession(reporter)
  }
  return sessionPromise
}

/** Preload the model so the first detection call isn't slowed by the fetch/compile. */
export function preloadYolo26PoseModel(reporter?: ProgressReporter): Promise<OrtSession> {
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

  const inputTensor = new activeOrt.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE])
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
