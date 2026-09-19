import type { ActivityLabel } from './types'

// Shared between the canvas skeleton overlay and the dashboard UI, so a
// person's color means the same thing everywhere in the app. Tuned for
// legibility against both a dark UI panel and a black video background.
export const ACTIVITY_COLORS: Record<ActivityLabel, string> = {
  standing: '#94a3b8',
  sitting: '#2dd4bf',
  walking: '#60a5fa',
  bending: '#fb923c',
  reaching: '#a78bfa',
  lingering: '#fbbf24',
  loitering: '#f87171',
}
