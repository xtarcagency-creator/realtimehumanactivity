import { useEffect, useState } from 'react'
import { Check } from '@phosphor-icons/react'

const STEPS = ['Pose model', 'Tracking engine', 'Zone detection']
const BOOT_KEY = 'realtime-activity-analyzer.booted'

// A short, once-per-session boot sequence shown on first landing on the
// site — a system-status readout, not a logo spinner. Skipped on any
// subsequent mount (client-side nav back to "/") via sessionStorage.
export default function BootSequence() {
  const [visible, setVisible] = useState(() => {
    try {
      return !sessionStorage.getItem(BOOT_KEY)
    } catch {
      return false
    }
  })
  const [checked, setChecked] = useState(0)
  const [ready, setReady] = useState(false)
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
      timers.push(window.setTimeout(() => setChecked((n) => Math.max(n, i + 1)), 220 + i * 220))
    })
    timers.push(window.setTimeout(() => setReady(true), 900))
    timers.push(window.setTimeout(() => setFading(true), 1150))
    timers.push(window.setTimeout(() => setVisible(false), 1400))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [visible])

  if (!visible) return null

  return (
    <div className={`boot-screen ${fading ? 'boot-fade' : ''}`}>
      <div className="boot-panel">
        <p className="boot-title">Initializing vision engine</p>
        <ul className="boot-list">
          {STEPS.map((step, i) => (
            <li key={step} className={checked > i ? 'boot-done' : ''}>
              <span>{step}</span>
              {checked > i && <Check size={12} weight="bold" />}
            </li>
          ))}
        </ul>
        <p className={`boot-ready ${ready ? 'visible' : ''}`}>System ready</p>
      </div>
    </div>
  )
}
