import { CheckCircle } from '@phosphor-icons/react'

// A decorative, hand-built stand-in for the real Analyser UI — not the live
// app. `stage` drives a progressive reveal of overlays (0 = idle video only,
// 5 = full activity event) so the same markup can serve both the scroll-tied
// hero preview and the sticky product-demonstration section.
export interface DemoPanelProps {
  stage: number
  className?: string
}

export default function DemoPanel({ stage, className = '' }: DemoPanelProps) {
  const showPerson = stage >= 1
  const showId = stage >= 2
  const showZone = stage >= 3
  const showDwell = stage >= 4
  const showEvent = stage >= 5

  return (
    <div className={`hero-frame ${className}`}>
      <div className="hero-frame-bar">
        <span />
        <span />
        <span />
      </div>
      <div className="demo-app" aria-hidden="true">
        <div className="demo-nav">
          <span className="demo-brand">Realtime Activity Analyzer</span>
          <span className="demo-status">
            <CheckCircle size={11} weight="fill" />
            Ready
          </span>
        </div>
        <div className="demo-body">
          <div className="demo-stage">
            <div className="demo-video">
              <div
                className={`demo-box demo-reveal ${showPerson ? 'visible' : ''}`}
                style={{ top: '20%', left: '10%', width: '20%', height: '58%' }}
              >
                <span className={`demo-box-label demo-reveal ${showId ? 'visible' : ''}`}>Person 01</span>
                <svg className="demo-skeleton" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <circle cx="50" cy="12" r="7" />
                  <line x1="50" y1="19" x2="50" y2="56" />
                  <line x1="28" y1="28" x2="72" y2="28" />
                  <line x1="28" y1="28" x2="18" y2="50" />
                  <line x1="72" y1="28" x2="84" y2="46" />
                  <line x1="34" y1="56" x2="66" y2="56" />
                  <line x1="34" y1="56" x2="26" y2="94" />
                  <line x1="66" y1="56" x2="74" y2="94" />
                </svg>
              </div>
              <div
                className={`demo-box demo-box-muted demo-reveal ${showPerson ? 'visible' : ''}`}
                style={{ top: '26%', left: '56%', width: '17%', height: '48%' }}
              >
                <span className={`demo-box-label demo-reveal ${showId ? 'visible' : ''}`}>Person 02</span>
              </div>
              <svg className={`demo-zone demo-reveal ${showZone ? 'visible' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points="4,58 42,52 45,94 2,96" />
              </svg>
              <span className={`demo-zone-label demo-reveal ${showZone ? 'visible' : ''}`} style={{ top: '58%', left: '9%' }}>
                Zone A{showDwell ? ' · 6s' : ''}
              </span>
              <span className="demo-fps">32 FPS</span>
              <div className={`demo-toast demo-reveal ${showEvent ? 'visible' : ''}`}>
                <span className="demo-toast-dot" />
                Person 01 entered Zone A
              </div>
            </div>
          </div>
          <div className="demo-inspector">
            <div className="demo-stat-row">
              <div className="demo-stat">
                <b>{showPerson ? 2 : 0}</b>
                <span>people</span>
              </div>
              <div className="demo-stat">
                <b>32</b>
                <span>fps</span>
              </div>
              <div className="demo-stat">
                <b>Ready</b>
                <span>status</span>
              </div>
            </div>
            <div className="demo-mini">
              <span className="demo-mini-title">Detection Zones</span>
              <div className={`demo-mini-row demo-reveal ${showZone ? 'visible' : ''}`}>
                <span className="demo-dot demo-dot-warn" />
                Zone A{showDwell ? ' · 6s' : ''}
              </div>
            </div>
            <div className="demo-mini">
              <span className="demo-mini-title">Activity</span>
              <div className={`demo-mini-row demo-reveal ${showEvent ? 'visible' : ''}`}>
                <span className="demo-dot demo-dot-warn" />
                Person 01 entered Zone A
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
