import type { Point, Zone } from './types'

/** Ray-casting point-in-polygon test. */
export function pointInZone(p: Point, z: Zone): boolean {
  const pts = z.points
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    const intersects = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

export function zoneCentroid(z: Zone): Point {
  const n = z.points.length
  return {
    x: z.points.reduce((s, p) => s + p.x, 0) / n,
    y: z.points.reduce((s, p) => s + p.y, 0) / n,
  }
}

export const DEFAULT_LOITER_THRESHOLD_SEC = 6
// "Lingering" (a softer, informational signal) fires at this fraction of the
// full loitering threshold, so there's a graded warning before the hard alert.
export const LINGER_THRESHOLD_RATIO = 0.5
// A person briefly leaving a zone (detection flicker, a quick step out and
// back, momentary occlusion) shouldn't reset accumulated dwell time to zero —
// only reset once they've been continuously outside the zone longer than this.
export const ZONE_EXIT_GRACE_SEC = 1.5
export const MIN_ZONE_POINTS = 3
export const CLOSE_POINT_RADIUS_PX = 18
// A person leaving and returning to the same zone repeatedly (browsing back
// and forth, circling a shelf) is a real suspicious-behavior signal distinct
// from one long continuous dwell — flag it once a person has fully entered
// the same zone this many times.
export const ZONE_REVISIT_ALERT_COUNT = 3
