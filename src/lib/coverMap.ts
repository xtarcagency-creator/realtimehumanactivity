import type { Point } from './types'

export interface CoverTransform {
  scale: number
  sx: number
  sy: number
  sw: number
  sh: number
}

/** Like CSS `object-fit: cover`: fills dw x dh by cropping the source, no letterboxing. */
export function computeCoverTransform(vw: number, vh: number, dw: number, dh: number): CoverTransform {
  const scale = Math.max(dw / vw, dh / vh)
  const sw = dw / scale
  const sh = dh / scale
  return { scale, sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh }
}

export function mapPointCover(p: Point, t: CoverTransform): Point {
  return { x: (p.x - t.sx) * t.scale, y: (p.y - t.sy) * t.scale }
}
