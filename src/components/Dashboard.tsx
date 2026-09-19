import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  MapPinArea,
  ListBullets,
  PencilSimple,
  Trash,
  X,
  Minus,
  Plus,
  DownloadSimple,
  CircleNotch,
  CheckCircle,
  UsersThree,
  Info,
  CaretDown,
} from '@phosphor-icons/react'
import { ACTIVITY_COLORS } from '../lib/activityColors'
import type { ActivityEvent, DetectionQuality, TrackedPerson, Zone } from '../lib/types'

const QUALITY_OPTIONS: { value: DetectionQuality; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'High' },
]

const QUALITY_DETAIL =
  'Fast/Balanced scan the whole frame at once. High switches to a per-person pipeline (detect each person, then a sharper pose model on just their crop) — much better for small, close, or overlapping people (e.g. CCTV footage), at a real FPS cost. First use of High downloads the model (~40MB), cached after.'

function formatDwell(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m ${s}s`
}

function currentZoneInfo(p: TrackedPerson, zones: Zone[]): { label: string; dwell: number } | null {
  const entry = Object.entries(p.zoneDwell).find(([, dwell]) => dwell > 0)
  if (!entry) return null
  const [zoneId, dwell] = entry
  return { label: zones.find((z) => z.id === zoneId)?.label ?? 'Zone', dwell }
}

interface Props {
  people: TrackedPerson[]
  events: ActivityEvent[]
  zones: Zone[]
  fps: number
  drawMode: boolean
  onToggleDraw: () => void
  onClearZones: () => void
  onRenameZone: (id: string, label: string) => void
  onDeleteZone: (id: string) => void
  quality: DetectionQuality
  onQualityChange: (quality: DetectionQuality) => void
  onExportEvents: () => void
  loiterThresholdSec: number
  onLoiterThresholdChange: (sec: number) => void
  modelLoading: boolean
}

type SectionKey = 'live' | 'detection' | 'zones' | 'people' | 'events'

export default function Dashboard({
  people,
  events,
  zones,
  fps,
  drawMode,
  onToggleDraw,
  onClearZones,
  onRenameZone,
  onDeleteZone,
  quality,
  onQualityChange,
  onExportEvents,
  loiterThresholdSec,
  onLoiterThresholdChange,
  modelLoading,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    live: false,
    detection: false,
    zones: false,
    people: false,
    events: false,
  })
  // Switching quality mid-load abandons the model currently downloading —
  // worth a confirmation since that's real bytes/time thrown away, unlike a
  // normal switch once a model is already loaded. Cleared automatically if
  // loading finishes (or the target changes) before the user decides.
  const [pendingQuality, setPendingQuality] = useState<DetectionQuality | null>(null)

  useEffect(() => {
    if (!modelLoading) setPendingQuality(null)
  }, [modelLoading])

  function toggle(key: SectionKey) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleQualityClick(value: DetectionQuality) {
    if (value === quality) return
    if (modelLoading) {
      setPendingQuality(value)
      return
    }
    onQualityChange(value)
  }

  function confirmSwitch() {
    if (pendingQuality) onQualityChange(pendingQuality)
    setPendingQuality(null)
  }

  return (
    <aside className="dashboard">
      <Section
        title="Live Monitoring"
        collapsed={collapsed.live}
        onToggle={() => toggle('live')}
      >
        <div className="stat-row">
          <div className="stat">
            <span className="stat-value">{people.length}</span>
            <span className="stat-label">people</span>
          </div>
          <div className="stat">
            <span className="stat-value">{fps}</span>
            <span className="stat-label">fps</span>
          </div>
          <div className="stat">
            <span className="stat-value stat-value-status">
              {modelLoading ? (
                <CircleNotch size={13} weight="bold" className="spin" />
              ) : (
                <CheckCircle size={13} weight="fill" style={{ color: 'var(--good)' }} />
              )}
              {modelLoading ? 'Loading' : 'Ready'}
            </span>
            <span className="stat-label">status</span>
          </div>
        </div>
      </Section>

      <Section
        title="Detection Model"
        collapsed={collapsed.detection}
        onToggle={() => toggle('detection')}
      >
        <div className="segmented">
          {QUALITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={quality === opt.value ? 'active' : ''}
              onClick={() => handleQualityClick(opt.value)}
              title={modelLoading && quality !== opt.value ? `Switch to ${opt.label} (cancels current load)` : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {pendingQuality && (
          <div className="switch-confirm">
            <span>
              Still loading {QUALITY_OPTIONS.find((o) => o.value === quality)?.label}. Switch to{' '}
              {QUALITY_OPTIONS.find((o) => o.value === pendingQuality)?.label} now and cancel it?
            </span>
            <div className="switch-confirm-actions">
              <button className="btn btn-sm active" onClick={confirmSwitch}>
                Switch now
              </button>
              <button className="btn btn-sm" onClick={() => setPendingQuality(null)}>
                Keep waiting
              </button>
            </div>
          </div>
        )}
        <p className="panel-note">
          High trades speed for accuracy on small or overlapping people.
          <span className="info-tooltip" tabIndex={0}>
            <Info size={13} weight="bold" />
            <span className="info-tooltip-body">{QUALITY_DETAIL}</span>
          </span>
        </p>
      </Section>

      <Section
        title="Detection Zones"
        collapsed={collapsed.zones}
        onToggle={() => toggle('zones')}
      >
        <div className="panel-actions" style={{ marginBottom: 12 }}>
          <button className={drawMode ? 'btn active' : 'btn'} onClick={onToggleDraw}>
            <PencilSimple size={13} weight="bold" />
            {drawMode ? 'Drawing…' : 'Draw zone'}
          </button>
          <button className="btn" onClick={onClearZones} disabled={!zones.length}>
            <Trash size={13} weight="bold" />
            Clear
          </button>
        </div>
        <div className="loiter-control">
          <span className="loiter-label">Loiter threshold</span>
          <div className="stepper">
            <button
              className="btn btn-icon"
              onClick={() => onLoiterThresholdChange(Math.max(2, loiterThresholdSec - 2))}
              aria-label="Decrease loiter threshold"
            >
              <Minus size={12} weight="bold" />
            </button>
            <span className="stepper-value">{loiterThresholdSec}s</span>
            <button
              className="btn btn-icon"
              onClick={() => onLoiterThresholdChange(Math.min(60, loiterThresholdSec + 2))}
              aria-label="Increase loiter threshold"
            >
              <Plus size={12} weight="bold" />
            </button>
          </div>
        </div>
        {drawMode && (
          <div className="empty" style={{ marginBottom: 8 }}>
            Click to place each corner (3+), then click the first point again — or use "Finish zone" above the
            video — to close it.
          </div>
        )}
        {!zones.length && !drawMode && (
          <div className="empty-state">
            <MapPinArea size={20} weight="light" />
            <span>Draw a zone to mark a shelf/aisle.</span>
          </div>
        )}
        <ul className="zone-list">
          {zones.map((z) => {
            const dwell = Math.max(0, ...people.map((p) => p.zoneDwell[z.id] ?? 0))
            const occupied = dwell > 0
            return (
              <li key={z.id} className="zone-row">
                <div className="zone-row-main">
                  <input
                    value={z.label}
                    onChange={(e) => onRenameZone(z.id, e.target.value)}
                    className="zone-input"
                  />
                  <button
                    className="zone-remove"
                    onClick={() => onDeleteZone(z.id)}
                    aria-label={`Delete ${z.label}`}
                    title="Delete zone"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
                <div className="zone-row-meta">
                  <span className={occupied ? 'zone-status-dot occupied' : 'zone-status-dot'} />
                  <span>{occupied ? 'Occupied' : 'Empty'}</span>
                  {occupied && <span className="zone-dwell">{formatDwell(dwell)}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section
        title="Tracked People"
        collapsed={collapsed.people}
        onToggle={() => toggle('people')}
      >
        {!people.length && (
          <div className="empty-state">
            <UsersThree size={20} weight="light" />
            <span>No one detected yet.</span>
          </div>
        )}
        <ul className="people-list">
          {people.map((p) => {
            const zoneInfo = currentZoneInfo(p, zones)
            return (
              <li key={p.id} className={`activity-${p.activity}`}>
                <span className="activity-dot" style={{ background: ACTIVITY_COLORS[p.activity] }} />
                <span className="pill">#{p.id}</span>
                <span className="person-zone">{zoneInfo ? zoneInfo.label : 'No zone'}</span>
                {zoneInfo && <span className="person-dwell">{formatDwell(zoneInfo.dwell)}</span>}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section
        title="Activity"
        collapsed={collapsed.events}
        onToggle={() => toggle('events')}
        grow
      >
        <div className="panel-actions" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={onExportEvents} disabled={!events.length}>
            <DownloadSimple size={13} weight="bold" />
            Export CSV
          </button>
        </div>
        {!events.length && (
          <div className="empty-state">
            <ListBullets size={20} weight="light" />
            <span>Zone entries, exits, and loitering appear here.</span>
          </div>
        )}
        <ul className="event-list">
          {events.map((e) => (
            <li key={e.id} className={e.level}>
              <span className={`event-dot ${e.level}`} />
              <div className="event-body">
                <span className="event-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span>{e.message}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  )
}

interface SectionProps {
  title: string
  collapsed: boolean
  onToggle: () => void
  grow?: boolean
  children: ReactNode
}

function Section({ title, collapsed, onToggle, grow, children }: SectionProps) {
  return (
    <div className={grow ? 'panel panel-grow' : 'panel'}>
      <button className="panel-header" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="panel-title">{title}</span>
        <CaretDown size={11} weight="bold" className={collapsed ? 'panel-chevron collapsed' : 'panel-chevron'} />
      </button>
      {!collapsed && <div className="panel-body">{children}</div>}
    </div>
  )
}
