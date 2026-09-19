// Per-frame person/zone/activity/event logic, extracted out of CameraStage's
// live inference loop into a pure function — so the exact same logic can
// also drive a full-video batch analysis pass (see videoAnalyzer.ts), which
// needs to process sampled frames outside of any real-time rAF loop and
// can't reach into component refs or call a live onEvent callback. Given
// the same sequence of (poses, dt) inputs in order, this produces identical
// results to the old inline version — verified by running both the live
// loop and a batch analysis over the same video and comparing.
import { classifyActivity, getCentroid, pushHistory } from './activity'
import { pointInZone, LINGER_THRESHOLD_RATIO, ZONE_EXIT_GRACE_SEC, ZONE_REVISIT_ALERT_COUNT } from './zones'
import { mapPointCover, type CoverTransform } from './coverMap'
import type { Pose } from './pose'
import type { ActivityEvent, Point, TrackedPerson, Zone } from './types'

// A person can go briefly undetected (occlusion, a confidence dip, motion
// blur) well within the tracker's own missed-frame tolerance, which still
// recognizes them by the same id if they reappear. Wall-clock (not
// frame-count) grace before dropping their zone-dwell state, so a single
// missed detection doesn't wipe a loiter timer that the tracker itself
// hasn't given up on.
export const STALE_PERSON_GRACE_MS = 1200

export interface FrameUpdateResult {
  people: Map<number, TrackedPerson>
  keypoints: Map<number, Pose['keypoints']>
  events: ActivityEvent[]
}

/**
 * Advances tracked-person/zone/activity state by one frame. `now` is a
 * monotonic milliseconds clock — `performance.now()` for the live loop,
 * or a synthetic per-sample clock (sample time in ms) for batch analysis,
 * where it must still increase sample-to-sample for the exit-grace and
 * revisit logic to behave the same way it does live.
 */
export function processFrame(
  poses: Pose[],
  prevPeople: Map<number, TrackedPerson>,
  prevKeypoints: Map<number, Pose['keypoints']>,
  zones: Zone[],
  cover: CoverTransform,
  dt: number,
  now: number,
  loiterThresholdSec: number,
): FrameUpdateResult {
  const people = new Map(prevPeople)
  const keypoints = new Map(prevKeypoints)
  const events: ActivityEvent[] = []
  const seenIds = new Set<number>()

  for (const pose of poses) {
    const id = pose.id ?? -1
    if (id < 0) continue
    seenIds.add(id)

    const prev = people.get(id)
    const activityRaw = classifyActivity(pose, prev)

    const wristPoint = pose.keypoints
      .filter((k) => (k.name === 'left_wrist' || k.name === 'right_wrist') && (k.score ?? 0) > 0.3)
      .sort((a, b) => a.y - b.y)[0]
    // classifyActivity/history stay in native video-space (unaffected by canvas presentation size);
    // zones and drawing use the canvas-space point after the cover crop/scale.
    const centroid: Point = getCentroid(pose)
    const canvasCentroid = mapPointCover(centroid, cover)

    const loiterSec = loiterThresholdSec
    const lingerSec = loiterSec * LINGER_THRESHOLD_RATIO
    const zoneDwell = { ...(prev?.zoneDwell ?? {}) }
    const zoneLastInside = { ...(prev?.zoneLastInside ?? {}) }
    const zoneVisits = { ...(prev?.zoneVisits ?? {}) }
    for (const zone of zones) {
      const inside = pointInZone(canvasCentroid, zone)
      const key = zone.id
      const before = zoneDwell[key] ?? 0
      if (inside) {
        zoneDwell[key] = before + dt
        zoneLastInside[key] = now
        if (before === 0) {
          zoneVisits[key] = (zoneVisits[key] ?? 0) + 1
          if (zoneVisits[key] === ZONE_REVISIT_ALERT_COUNT) {
            events.push({
              id: `${Date.now()}-${id}-${key}-revisit`,
              timestamp: Date.now(),
              personId: id,
              message: `Person ${id} has revisited "${zone.label}" ${ZONE_REVISIT_ALERT_COUNT} times`,
              level: 'info',
            })
          }
        }
        if (before < lingerSec && zoneDwell[key] >= lingerSec) {
          events.push({
            id: `${Date.now()}-${id}-${key}-linger`,
            timestamp: Date.now(),
            personId: id,
            message: `Person ${id} lingering in "${zone.label}"`,
            level: 'info',
          })
        }
        if (before < loiterSec && zoneDwell[key] >= loiterSec) {
          events.push({
            id: `${Date.now()}-${id}-${key}`,
            timestamp: Date.now(),
            personId: id,
            message: `Person ${id} loitering in "${zone.label}" (${loiterSec}s+)`,
            level: 'warning',
          })
        }
      } else {
        const lastInside = zoneLastInside[key] ?? 0
        const sinceLeftSec = (now - lastInside) / 1000
        if (sinceLeftSec > ZONE_EXIT_GRACE_SEC) {
          zoneDwell[key] = 0
          zoneLastInside[key] = 0
        }
        // else: briefly outside (flicker/occlusion) — hold dwell steady until grace expires
      }
    }

    const anyLoitering = Object.values(zoneDwell).some((v) => v >= loiterSec)
    const anyLingering = Object.values(zoneDwell).some((v) => v >= lingerSec)
    const activity = anyLoitering ? 'loitering' : anyLingering ? 'lingering' : activityRaw

    const history = pushHistory(prev?.history ?? [], centroid)

    const person: TrackedPerson = {
      id,
      centroid: canvasCentroid,
      wrist: wristPoint ? mapPointCover({ x: wristPoint.x, y: wristPoint.y }, cover) : null,
      activity,
      lastSeen: now,
      zoneDwell,
      zoneLastInside,
      zoneVisits,
      history,
    }
    people.set(id, person)
    keypoints.set(id, pose.keypoints)
  }

  for (const [id, person] of Array.from(people)) {
    if (!seenIds.has(id) && now - person.lastSeen > STALE_PERSON_GRACE_MS) {
      people.delete(id)
      keypoints.delete(id)
    }
  }

  return { people, keypoints, events }
}
