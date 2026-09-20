import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, GithubLogo } from '@phosphor-icons/react'
import Reveal from '../components/Reveal'
import SkeletonFigure from '../components/SkeletonFigure'
import BootSequence from '../components/BootSequence'
import './Landing.css'

const REPO_URL = 'https://github.com/xtarcagency-creator/realtime'
const XTARC_URL = 'https://xtarc.agency/'

const ARCHITECTURE = [
  { n: '01', label: 'VIDEO INPUT', detail: 'Camera stream or an uploaded file, decoded natively by the browser.' },
  { n: '02', label: 'PERSON DETECTION', detail: 'A top-down pass isolates each human subject before pose runs.' },
  { n: '03', label: 'POSE ESTIMATION', detail: '17 COCO keypoints per subject, per frame.' },
  { n: '04', label: 'TRACKING', detail: 'A centroid tracker assigns and holds a stable ID across frames.' },
  { n: '05', label: 'ACTIVITY ENGINE', detail: 'Pose sequences classify standing, walking, bending, reaching.' },
  { n: '06', label: 'ZONE INTELLIGENCE', detail: 'Spatial polygons turn presence and dwell into events.' },
]

const MODES = [
  { n: '01', name: 'FAST', model: 'MoveNet MultiPose', input: '256px', pos: 0.06 },
  { n: '02', name: 'BALANCED', model: 'MoveNet MultiPose', input: '384px', pos: 0.5 },
  { n: '03', name: 'HIGH', model: 'Top-down detection + per-person pose', input: 'variable', pos: 0.94 },
]

const CONDITIONS = [
  { n: '01', title: 'LOW LIGHT' },
  { n: '02', title: 'OCCLUSION' },
  { n: '03', title: 'MOTION BLUR' },
  { n: '04', title: 'DISTANT SUBJECTS' },
]

const PERF_METRICS = [
  { value: '30', label: 'VIDEO FPS' },
  { value: '09.8', label: 'AI FPS' },
  { value: '17', label: 'POSE KEYPOINTS' },
  { value: '00', label: 'VIDEO UPLOADS' },
]

const PIPELINE = ['CAMERA', 'BROWSER', 'MODEL', 'TRACKER', 'EVENT ENGINE']

const CONSTRAINTS = [
  { n: '01', title: 'Crowded scenes', body: 'Detection quality degrades as overlap increases between subjects.' },
  { n: '02', title: 'Small people', body: 'Distant, low-pixel subjects are the hardest case for any pose model.' },
  { n: '03', title: 'Occlusion', body: 'A partially hidden subject yields a lower-confidence, noisier pose.' },
  { n: '04', title: 'Identity persistence', body: 'A subject blocked past the tracker’s grace window can re-enter as a new ID.' },
  { n: '05', title: 'Low-quality CCTV', body: 'Compression artifacts and low resolution both reduce recall.' },
  { n: '06', title: 'Browser inference latency', body: 'No server GPU to fall back on — the trade against accuracy is real and visible.' },
]

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = () => setReduced(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

/** Scroll progress (0..1) of a tall section: 0 as its top reaches the viewport top, 1 as its bottom does. */
function useSectionScrollProgress(reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (reduced) {
      setProgress(1)
      return
    }
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const total = rect.height - window.innerHeight
        const p = total > 0 ? (-rect.top) / total : 0
        setProgress(Math.min(1, Math.max(0, p)))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [reduced])

  return { ref, progress }
}

// Active-step highlighting is informational state, not motion — it keeps
// updating under prefers-reduced-motion (only the CSS transitions that ride
// on it are what gets muted, via the existing reduced-motion media queries).
function useActiveStep(count: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const i = stepRefs.current.indexOf(entry.target as HTMLDivElement)
            if (i >= 0) setActive(i)
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    stepRefs.current.slice(0, count).forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [count])

  return { containerRef, stepRefs, active }
}

function SplitCTA({
  to,
  href,
  children,
  size = 'md',
  dark = false,
}: {
  to?: string
  href?: string
  children: string
  size?: 'md' | 'lg'
  dark?: boolean
}) {
  const inner = (
    <>
      <span className="split-cta-main">{children}</span>
      <span className="split-cta-arrow">
        <ArrowUpRight size={size === 'lg' ? 17 : 14} weight="bold" />
      </span>
    </>
  )
  const cls = `split-cta ${size === 'lg' ? 'split-cta-lg' : ''} ${dark ? 'split-cta-onlight' : ''}`
  if (to) {
    return (
      <Link className={cls} to={to}>
        {inner}
      </Link>
    )
  }
  return (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  )
}

export default function Landing() {
  const reduced = usePrefersReducedMotion()
  const hero = useSectionScrollProgress(reduced)
  const heroP = hero.progress
  const heroScale = 0.92 + 0.08 * heroP
  const heroSpread = heroP * 14

  const arch = useActiveStep(ARCHITECTURE.length)
  const modesStory = useActiveStep(MODES.length)
  const signature = useSectionScrollProgress(reduced)
  const sigP = signature.progress
  const sigPhase1 = Math.min(1, sigP / 0.5)
  const sigPhase2 = Math.max(0, Math.min(1, (sigP - 0.5) / 0.5))

  return (
    <div className="landing">
      <BootSequence />
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">Realtime Activity Analyzer</span>
          <div className="landing-nav-actions">
            <a className="nav-link" href={REPO_URL} target="_blank" rel="noreferrer">
              <GithubLogo size={15} weight="bold" />
              <span className="nav-link-word">Source</span>
            </a>
            <SplitCTA to="/app">Launch Analyzer</SplitCTA>
          </div>
        </div>
      </header>

      <main>
        {/* ================= HERO + CINEMATIC SCROLL TRANSITION ================= */}
        <section className={`lt-dark hero-block ${reduced ? 'is-static' : ''}`} ref={hero.ref}>
          <div className="hero-sticky container">
            <div className="hero-meta-row">
              <span className="hero-meta">XTARC</span>
              <span className="hero-meta hero-meta-center">COMPUTER VISION SYSTEM</span>
              <span className="hero-meta">2026</span>
            </div>

            <h1 className="hero-h1" style={{ letterSpacing: `${-0.03 - heroSpread * 0.0006}em`, gap: `${heroSpread * 0.5}px` }}>
              <span className="hero-h1-line" style={{ transform: `translateY(${-heroSpread * 0.3}px)` }}>
                Human activity,
              </span>
              <span className="hero-h1-line" style={{ transform: `translateY(${heroSpread * 0.3}px)` }}>
                understood in real time.
              </span>
            </h1>

            <div className="hero-lower">
              <p className="hero-sub">
                A browser-native vision system for multi-person tracking, pose estimation, zone intelligence and
                activity detection.
              </p>
              <SplitCTA to="/app" size="lg">
                Enter the analyzer
              </SplitCTA>
            </div>

            <div
              className="hero-product"
              style={{ transform: `scale(${heroScale}) translateY(${(1 - heroP) * 26}px)` }}
            >
              <div className="finale-frame">
                <div className="finale-bar">
                  <span className="finale-live mono">SYSTEM ONLINE</span>
                </div>
                <img
                  className="finale-img"
                  src="/landing/dashboard-preview.png"
                  alt="Realtime Activity Analyzer interface showing multi-person pose tracking, detection zones and the live event log"
                  width={1400}
                  height={900}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ================= THE QUESTION ================= */}
        <section className="lt-light question">
          <div className="container">
            <Reveal className="question-text">
              <span className="statement-serif">Cameras see everything.</span>
              <br />
              Understanding what happens inside the frame is harder.
            </Reveal>
            <Reveal delay={100} className="question-body">
              <p>
                We set out to build a real-time system capable of detecting, tracking and interpreting multiple
                people without sending video to a remote processing server.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ================= EDITORIAL GRID ================= */}
        <section className="lt-light egrid">
          <div className="container">
            <Reveal className="egrid-lede">
              <p>
                Every number below is a real constraint the system was built around — not a marketing figure.
              </p>
            </Reveal>
            <div className="egrid-cols">
              <Reveal className="egrid-cell">
                <span className="egrid-value mono">WEBGL</span>
                <span className="egrid-label">Client-side inference</span>
              </Reveal>
              <Reveal delay={60} className="egrid-cell">
                <span className="egrid-value mono">17</span>
                <span className="egrid-label">Pose keypoints</span>
              </Reveal>
              <Reveal delay={120} className="egrid-cell egrid-cell-visual">
                <div className="egrid-loop" aria-hidden="true">
                  <span className="egrid-loop-box" />
                  <span className="egrid-loop-dot" />
                </div>
              </Reveal>
              <Reveal delay={180} className="egrid-cell">
                <span className="egrid-value mono">ZERO</span>
                <span className="egrid-label">Video uploads</span>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ================= SYSTEM ARCHITECTURE ================= */}
        <section className="lt-dark architecture" ref={arch.containerRef}>
          <div className="container">
            <span className="section-index">SYSTEM ARCHITECTURE</span>
            <div className="architecture-list">
              {ARCHITECTURE.map((stage, i) => (
                <div
                  key={stage.n}
                  ref={(el) => {
                    arch.stepRefs.current[i] = el
                  }}
                  className={`architecture-stage ${arch.active === i ? 'is-active' : ''}`}
                >
                  <span className="architecture-stage-n mono">{stage.n}</span>
                  <span className="architecture-stage-label">{stage.label}</span>
                  <span className="architecture-stage-detail">{stage.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= TRACKING VISUAL ================= */}
        <section className="lt-dark tracking-visual">
          <div className="container">
            <span className="section-index">TRACKING</span>
            <div className="tv-composition">
              <span className="tv-tag tv-tag-tl mono">
                TRACK AGE
                <b>00:17.82</b>
              </span>
              <span className="tv-tag tv-tag-tr mono">
                ZONE
                <b>A</b>
              </span>
              <div className="tv-subject">
                <span className="tv-p01">P-01</span>
                <SkeletonFigure />
              </div>
              <span className="tv-tag tv-tag-bl mono">
                DWELL
                <b>00:06.40</b>
              </span>
              <span className="tv-tag tv-tag-bm mono">
                VELOCITY
                <b>18.4 PX</b>
              </span>
              <span className="tv-tag tv-tag-br mono">
                CONFIDENCE
                <b>.94</b>
              </span>
              <span className="tv-tag tv-tag-pos mono">
                POSITION
                <b>X 428 &nbsp; Y 217</b>
              </span>
            </div>
          </div>
        </section>

        {/* ================= DETECTION MODES ================= */}
        <section className="lt-light modes" ref={modesStory.containerRef}>
          <div className="container">
            <span className="section-index section-index-onlight">DETECTION MODES</span>
            <div className="modes-continuum">
              <span className="modes-rail-label">SPEED</span>
              <div className="modes-rail">
                <span
                  className="modes-rail-fill"
                  style={{ width: `${MODES[modesStory.active].pos * 100}%` }}
                />
                <span className="modes-rail-dot" style={{ left: `${MODES[modesStory.active].pos * 100}%` }} />
              </div>
              <span className="modes-rail-label">PRECISION</span>
            </div>
            <div className="modes-steps">
              {MODES.map((mode, i) => (
                <div
                  key={mode.n}
                  ref={(el) => {
                    modesStory.stepRefs.current[i] = el
                  }}
                  className={`modes-step ${modesStory.active === i ? 'is-active' : ''}`}
                >
                  <span className="mono modes-step-n">{mode.n}</span>
                  <span className="modes-step-name">{mode.name}</span>
                  <span className="modes-step-model">{mode.model}</span>
                  <span className="mono modes-step-input">{mode.input}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= SIGNATURE VISUAL MOMENT ================= */}
        <section className={`lt-dark signature ${reduced ? 'is-static' : ''}`} ref={signature.ref}>
          <div className="signature-sticky">
            <div className="signature-visual" style={{ opacity: 0.25 + sigPhase1 * 0.75 }}>
              <SkeletonFigure spread={sigPhase1} />
              {sigPhase2 > 0.05 && (
                <svg className="signature-zone" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <polygon
                    points="10,60 55,54 58,96 8,98"
                    style={{ strokeDashoffset: `${(1 - sigPhase2) * 260}` }}
                  />
                </svg>
              )}
            </div>
            <div className="signature-copy">
              <h2 className={sigPhase2 < 0.5 ? 'is-visible' : ''}>
                FROM PIXELS
                <br />
                TO PRESENCE.
              </h2>
              <h2 className={sigPhase2 >= 0.5 ? 'is-visible' : ''}>
                FROM PRESENCE
                <br />
                TO BEHAVIOR.
              </h2>
            </div>
            {sigPhase1 > 0.4 && (
              <div className="signature-coords mono" style={{ opacity: Math.min(1, (sigPhase1 - 0.4) * 2.4) }}>
                <span>NOSE 50,8</span>
                <span>L_WRIST 26,54</span>
                <span>R_ANKLE 62,94</span>
              </div>
            )}
            {sigPhase2 > 0.6 && (
              <div className="signature-event mono" style={{ opacity: Math.min(1, (sigPhase2 - 0.6) * 2.5) }}>
                Person 01 entered Zone A · dwell 00:06
              </div>
            )}
          </div>
        </section>

        {/* ================= REAL WORLD CONDITIONS ================= */}
        <section className="lt-light conditions">
          <div className="container">
            <Reveal>
              <h2 className="section-title-editorial">Real footage isn&rsquo;t clean.</h2>
            </Reveal>
            <div className="conditions-list">
              {CONDITIONS.map((c) => (
                <Reveal key={c.n} className="conditions-item">
                  <span className="mono conditions-n">{c.n}</span>
                  <span className="conditions-title">{c.title}</span>
                </Reveal>
              ))}
            </div>
            <Reveal delay={100} className="conditions-note">
              <p>These conditions informed the model architecture and the three quality tiers directly — not as an afterthought.</p>
            </Reveal>
          </div>
        </section>

        {/* ================= PERFORMANCE ================= */}
        <section className="lt-dark performance">
          <div className="container">
            <span className="section-index">PERFORMANCE</span>
            <div className="performance-grid">
              {PERF_METRICS.map((m) => (
                <Reveal key={m.label} className="performance-cell">
                  <span className="performance-value mono">{m.value}</span>
                  <span className="performance-label mono">{m.label}</span>
                </Reveal>
              ))}
            </div>
            <p className="performance-note">Shown live in the analyzer&rsquo;s diagnostics panel &mdash; figures above are illustrative, not invented.</p>
          </div>
        </section>

        {/* ================= PRIVACY / LOCAL COMPUTE ================= */}
        <section className="lt-dark privacy">
          <div className="container">
            <Reveal>
              <h2 className="section-title-editorial">
                THE FOOTAGE
                <br />
                NEVER LEAVES
                <br />
                THE BROWSER.
              </h2>
            </Reveal>
            <Reveal delay={80} className="pipeline-row">
              {PIPELINE.map((step, i) => (
                <div key={step} className="pipeline-item">
                  <span className="pipeline-box mono">{step}</span>
                  {i < PIPELINE.length - 1 && <span className="pipeline-line" />}
                </div>
              ))}
            </Reveal>
            <Reveal delay={140} className="pipeline-tags">
              <span className="pipeline-tag mono">LOCAL INFERENCE</span>
              <span className="pipeline-tag mono">WEBGL / WEBGPU</span>
              <span className="pipeline-tag mono">ZERO FRAME UPLOADS</span>
            </Reveal>
          </div>
        </section>

        {/* ================= ENGINEERING CONSTRAINTS ================= */}
        <section className="lt-light constraints">
          <div className="container">
            <span className="section-index section-index-onlight">CONSTRAINTS</span>
            <h2 className="section-title-editorial">
              BUILT WITH
              <br />
              CONSTRAINTS IN MIND.
            </h2>
            <div className="constraints-list">
              {CONSTRAINTS.map((c) => (
                <Reveal key={c.n} className="constraints-row">
                  <span className="mono constraints-n">{c.n}</span>
                  <span className="constraints-title">{c.title}</span>
                  <span className="constraints-body">{c.body}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= PRODUCT FINALE ================= */}
        <section className="lt-dark finale">
          <div className="container">
            <Reveal className="finale-frame">
              <div className="finale-bar">
                <span className="finale-live mono">SYSTEM ONLINE</span>
              </div>
              <img
                className="finale-img"
                src="/landing/dashboard-preview.png"
                alt="Realtime Activity Analyzer interface showing multi-person pose tracking, detection zones and the live event log"
                width={1400}
                height={900}
              />
            </Reveal>
            <Reveal delay={100} className="finale-cta">
              <SplitCTA to="/app" size="lg">
                Launch analyzer
              </SplitCTA>
            </Reveal>
          </div>
        </section>

        {/* ================= AGENCY CTA ================= */}
        <section className="lt-dark agency-cta">
          <div className="container">
            <Reveal className="agency-cta-inner">
              <h2>
                THE NEXT SYSTEM
                <br />
                COULD BE YOURS.
              </h2>
              <p>We design and engineer digital products where interface, intelligence and technology work as one.</p>
              <div className="agency-cta-actions">
                <SplitCTA href="mailto:xtarcagency@gmail.com" size="lg">
                  Start a project
                </SplitCTA>
                <a className="btn-ghost" href={XTARC_URL} target="_blank" rel="noreferrer">
                  View Xtarc
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="container landing-footer-inner">
          <span className="mono">REALTIME ACTIVITY ANALYZER</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            <GithubLogo size={15} weight="bold" />
            GitHub
          </a>
          <span className="mono footer-built">XTARC</span>
          <span className="mono footer-copy">{new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  )
}
