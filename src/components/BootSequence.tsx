import { useEffect, useState } from 'react'

const STEPS = ['MODEL', 'TRACKER', 'ZONE ENGINE', 'RENDERER']
const BOOT_KEY = 'realtime-activity-analyzer.booted'

// A short, once-per-session boot sequence shown on first landing on the
// site — a system-status readout with a single scanline pass, not a logo
// spinner or glowing orb. Skipped on any subsequent mount (client-side nav
// back to "/") via sessionStorage.
export default function BootSequence() {
  const [visible, setVisible] = useState(() => {
    try {
      return !sessionStorage.getItem(BOOT_KEY)
    } catch {
      return false
    }
  })
  const [checked, setChecked] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (!visible) return
    try {
      sessionStorage.setItem(BOOT_KEY, '1')
    } catch {
      // sessionStorage unavailable (private browsing) — boot just won't be remembered.
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(false)
      return
    }

    const timers: number[] = []
    STEPS.forEach((_, i) => {
      timers.push(window.setTimeout(() => setChecked((n) => Math.max(n, i + 1)), 120 + i * 190))
    })
    timers.push(window.setTimeout(() => setFading(true), 1050))
    timers.push(window.setTimeout(() => setVisible(false), 1300))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [visible])

  if (!visible) return null

  return (
    <div className={`boot-screen ${fading ? 'boot-fade' : ''}`}>
      <div className="boot-scan" />
      <div className="boot-panel">
        <p className="boot-title">INITIALIZING VISION SYSTEM</p>
        <ul className="boot-list">
          {STEPS.map((step, i) => (
            <li key={step} className={checked > i ? 'boot-done' : ''}>
              <span>{step}</span>
              <span className="boot-state">{checked > i ? 'READY' : '···'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
