export interface Point {
  x: number
  y: number
}

export interface Zone {
  id: string
  label: string
  points: Point[]
}

export type ActivityLabel =
  | 'standing'
  | 'sitting'
  | 'walking'
  | 'bending'
  | 'reaching'
  | 'lingering'
  | 'loitering'

export interface TrackedPerson {
  id: number
  centroid: Point
  wrist: Point | null
  activity: ActivityLabel
  lastSeen: number
  zoneDwell: Record<string, number>
  /** ms timestamp a person was last confirmed inside each zone — drives the exit grace period. */
  zoneLastInside: Record<string, number>
  /** Count of distinct times a person has fully entered each zone (not incremented across the exit grace window). */
  zoneVisits: Record<string, number>
  history: Point[]
}

export interface ActivityEvent {
  id: string
  timestamp: number
  personId: number
  message: string
  level: 'info' | 'warning'
}

export type Source = { kind: 'camera' } | { kind: 'upload'; file: File }

export type DetectionQuality = 'fast' | 'balanced' | 'high'

export type OverlayMode = 'full' | 'minimal'
