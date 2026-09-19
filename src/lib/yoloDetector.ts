// The wasm-only entry point, not the bare 'onnxruntime-web' package — the
// default import bundles WebGPU (JSEP) support unconditionally, which pulls
// in its own ~28MB wasm runtime binary regardless of which
// executionProviders are actually requested at runtime (the binary is fixed
// by which JS entry point gets imported, not by the runtime option below).
// Since only 'wasm' is ever used (see the note further down), this entry
// point ships the plain ~14MB runtime instead — half the size, and it was
// the real reason the progress bar looked "stuck": that runtime is fetched
// by ORT itself inside InferenceSession.create(), entirely outside our own
// tracked download, so a bigger untracked file just meant a longer stall
// with no visible progress after our own bytes finished.
import * as ort from 'onnxruntime-web/wasm'
import { fetchBuffer, type ProgressReporter } from './downloadProgress'

// YOLO11s (COCO), exported to ONNX at 640x640 input, bundled locally at
// public/models/yolo11s.onnx — no runtime dependency on a model-hosting CDN.
// Upgraded from YOLOv8n (the smallest/fastest variant) for meaningfully
// better recall, at the cost of a larger download (~38MB vs ~13MB) and more
// per-frame compute. Same output tensor shape/semantics as YOLOv8n
// ([1, 84, 8400], same box/class-score layout), confirmed by running this
// exact letterbox+decode+NMS logic in Python against the raw ONNX session
// and diffing against Ultralytics' own high-level prediction on the same
// images before swapping the model file — no decode logic changes needed.
const MODEL_URL = '/models/yolo11s.onnx'
// Exact size of the bundled file above, used only as a progress-bar
// fallback (see fetchBuffer) when a CDN drops Content-Length in flight.
// Update if the model file is ever replaced.
const MODEL_EXPECTED_BYTES = 38051718
// ONNX Runtime's own wasm runtime, bundled locally here (copied from
// node_modules/onnxruntime-web/dist/) instead of left for ORT to fetch
// itself from wherever it resolves relative to its own script — same
// reasoning as the model file above, and it lets this download join the
// same tracked progress instead of being an invisible stall after our own
// bytes finish (see loadWasmBinary below).
const WASM_URL = '/models/ort-wasm-simd-threaded.wasm'
const WASM_EXPECTED_BYTES = 14239897
const INPUT_SIZE = 640
const PERSON_CLASS_INDEX = 0 // COCO class 0 = person
// Lowered from 0.25 — this is only the primary detector; MultiPose's own box
// output is unioned in afterward, but a person YOLO drops below threshold
// never gets a second chance from that ensemble. A missed person is a worse
// failure than an extra low-confidence box, which just gets deduped/ignored
// downstream.
const CONF_THRESHOLD = 0.15
const NMS_IOU_THRESHOLD = 0.45

export interface YoloBox {
  x0: number
  y0: number
  x1: number
  y1: number
  score: number
}

let sessionPromise: Promise<ort.InferenceSession> | null = null
let letterboxCanvas: HTMLCanvasElement | null = null

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null

function loadWasmBinary(reporter?: ProgressReporter): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fetchBuffer(WASM_URL, 'yolo-wasm', reporter, WASM_EXPECTED_BYTES)
  }
  return wasmBinaryPromise
}

function getSession(reporter?: ProgressReporter): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    // Both the model and ORT's own wasm runtime are fetched as plain
    // ArrayBuffers ourselves (see downloadProgress.ts) so real download
    // progress is available for the whole thing, then handed to ORT
    // directly — InferenceSession.create/env.wasm.wasmBinary both accept a
    // buffer, so neither of these costs a second fetch.
    //
    // WASM only. WebGPU was tried here too and dropped: ONNX Runtime's
    // WebGPU backend needs its own much larger wasm binary (~28MB vs ~14MB
    // for plain WASM) fetched and a GPU pipeline compiled before the first
    // detection even runs — real cost on every cold switch to High — for no
    // measured speed benefit, and this project already hit real WebGPU
    // reliability problems elsewhere (see tfBackend.ts). Not worth paying
    // the extra download for an unproven win.
    sessionPromise = Promise.all([
      fetchBuffer(MODEL_URL, 'yolo', reporter, MODEL_EXPECTED_BYTES),
      loadWasmBinary(reporter),
    ]).then(([modelBuf, wasmBuf]) => {
      ort.env.wasm.wasmBinary = wasmBuf
      return ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] })
    })
  }
  return sessionPromise
}

/** Preload the model so the first detection call isn't slowed by the fetch/compile. */
export function preloadYoloModel(reporter?: ProgressReporter): Promise<ort.InferenceSession> {
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

function iou(a: YoloBox, b: YoloBox): number {
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

function nms(boxes: YoloBox[]): YoloBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: YoloBox[] = []
  for (const box of sorted) {
    if (!kept.some((k) => iou(k, box) > NMS_IOU_THRESHOLD)) kept.push(box)
  }
  return kept
}

export async function detectPersons(video: HTMLVideoElement): Promise<YoloBox[]> {
  const session = await getSession()
  const vw = video.videoWidth
  const vh = video.videoHeight
  const { scale, padX, padY } = computeLetterbox(vw, vh)
  const nw = Math.round(vw * scale)
  const nh = Math.round(vh * scale)

  if (!letterboxCanvas) letterboxCanvas = document.createElement('canvas')
  letterboxCanvas.width = INPUT_SIZE
  letterboxCanvas.height = INPUT_SIZE
  // getImageData runs every refresh frame — willReadFrequently tells the
  // browser to back this canvas for fast CPU readback instead of the GPU-
  // composited path it'd otherwise pick, which Chrome was flagging as slow.
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
  // Output shape [1, 84, 8400]: rows 0-3 are box (cx,cy,w,h) in letterboxed
  // pixel space, rows 4-83 are per-class confidence (already sigmoid-activated
  // by the export graph). Only class 0 (person) is used here.
  const numAnchors = raw.dims[2]
  const values = raw.data as Float32Array

  const candidates: YoloBox[] = []
  const scoreRowOffset = (4 + PERSON_CLASS_INDEX) * numAnchors
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
    candidates.push({ x0: ox - ow / 2, y0: oy - oh / 2, x1: ox + ow / 2, y1: oy + oh / 2, score })
  }

  return nms(candidates)
}
