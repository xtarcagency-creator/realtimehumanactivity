import type { Point } from './types'

interface Track {
  id: number
  centroid: Point
  velocity: Point
  lastMatched: number
}

const MAX_MATCH_DIST_PX = 140
// Wall-clock (not frame-count) tolerance: High's per-person pipeline runs far
// fewer frames/sec than Fast/Balanced, so a fixed frame count would mean wildly
// different real time before a track is dropped depending on quality tier.
const MAX_MISSED_MS = 1200
// How much a new displacement updates the track's running velocity estimate
// (0 = never adapts, 1 = no smoothing/pure last-frame velocity).
const VELOCITY_SMOOTHING = 0.6

/**
 * Nearest-neighbor tracker for per-frame detections with no built-in identity.
 * Two things beyond a plain "closest centroid" match:
 *  - Matches against each track's *predicted* position (last centroid +
 *    running velocity), not its last-seen position, so tracking survives
 *    people walking at a steady pace much better than a static comparison.
 *  - Resolves all (detection, track) pairs globally smallest-distance-first,
 *    instead of matching detections one at a time in array order — the
 *    latter lets an earlier detection "steal" a track that was actually the
 *    better match for a detection processed later, which is exactly the
 *    failure mode when two tracked people are close together or cross paths.
 */
export class CentroidTracker {
  private tracks: Track[] = []
  private nextId = 1

  update(centroids: Point[], now: number): number[] {
    const n = centroids.length
    const m = this.tracks.length
    const assigned = new Array(n).fill(-1)

    const predicted: Point[] = this.tracks.map((t) => ({
      x: t.centroid.x + t.velocity.x,
      y: t.centroid.y + t.velocity.y,
    }))

    const pairs: { i: number; t: number; dist: number }[] = []
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < m; t++) {
        const dist = Math.hypot(centroids[i].x - predicted[t].x, centroids[i].y - predicted[t].y)
        if (dist < MAX_MATCH_DIST_PX) pairs.push({ i, t, dist })
      }
    }
    pairs.sort((a, b) => a.dist - b.dist)

    const usedDetections = new Set<number>()
    const usedTracks = new Set<number>()
    for (const { i, t } of pairs) {
      if (usedDetections.has(i) || usedTracks.has(t)) continue
      usedDetections.add(i)
      usedTracks.add(t)
      const track = this.tracks[t]
      const dx = centroids[i].x - track.centroid.x
      const dy = centroids[i].y - track.centroid.y
      track.velocity = {
        x: track.velocity.x + (dx - track.velocity.x) * VELOCITY_SMOOTHING,
        y: track.velocity.y + (dy - track.velocity.y) * VELOCITY_SMOOTHING,
      }
      track.centroid = centroids[i]
      track.lastMatched = now
      assigned[i] = track.id
    }

    for (let i = 0; i < n; i++) {
      if (assigned[i] === -1) {
        const id = this.nextId++
        this.tracks.push({ id, centroid: centroids[i], velocity: { x: 0, y: 0 }, lastMatched: now })
        assigned[i] = id
      }
    }

    this.tracks = this.tracks.filter((t) => now - t.lastMatched <= MAX_MISSED_MS)

    return assigned
  }

  reset() {
    this.tracks = []
    this.nextId = 1
  }
}
