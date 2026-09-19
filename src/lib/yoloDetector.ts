import * as ort from 'onnxruntime-web'

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

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    // WebGPU first, falling back to WASM (ONNX Runtime Web's own provider
    // list already skips to the next entry if a provider is unsupported in
    // this browser) — with an explicit WASM-only retry as a safety net in
    // case session creation fails outright instead of gracefully falling
    // back. Lower risk here than the earlier TF.js WebGPU attempt: this
    // pipeline builds its input tensor as a plain CPU-side Float32Array from
    // canvas pixel data (see detectPersons below), not a zero-copy GPU
    // texture import from the <video> element, which is what broke there.
    sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ['webgpu', 'wasm'] }).catch(
      (err) => {
        console.warn('[yolo] WebGPU session creation failed, falling back to WASM only', err)
        return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] })
      },
    )
  }
  return sessionPromise
}

/** Preload the model so the first detection call isn't slowed by the fetch/compile. */
export function preloadYoloModel(): Promise<ort.InferenceSession> {
  return getSession()
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
