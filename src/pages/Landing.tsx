import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, GithubLogo } from '@phosphor-icons/react'
import Reveal from '../components/Reveal'
import DemoPanel from '../components/DemoPanel'
import SkeletonFigure from '../components/SkeletonFigure'
import BootSequence from '../components/BootSequence'
import './Landing.css'

const REPO_URL = 'https://github.com/xtarcagency-creator/realtime'

const SCROLL_STEPS = [
  {
    n: '01',
    tag: 'INITIALIZE',
    body: 'The feed comes online. The vision system activates and begins scanning for subjects.',
    stage: 0,
  },
  {
    n: '02',
    tag: 'DETECT',
    body: 'Multi-person pose estimation runs across the live frame — bounding box, skeleton, identity and confidence, per subject.',
    stage: 2,
  },
  {
    n: '03',
    tag: 'MAP',
    body: 'A spatial zone is drawn over the scene. Dwell time begins accumulating the moment a subject enters it.',
    stage: 3,
  },
  {
    n: '04',
    tag: 'RESPOND',
    body: 'Movement becomes a structured event — entry, dwell, loitering — timestamped and attributable to a subject.',
    stage: 5,
  },
]

const ARCHITECTURE = ['VIDEO INPUT', 'PERSON DETECTION', 'POSE ESTIMATION', 'TRACKING', 'ACTIVITY ENGINE', 'ZONE INTELLIGENCE']

const MODES = [
  {
    n: '01',
    name: 'FAST',
    model: 'MoveNet MultiPose',
    input: '256px input',
    note: 'Designed for speed',
  },
  {
    n: '02',
    name: 'BALANCED',
    model: 'MoveNet MultiPose',
    input: '384px input',
    note: 'Improved small-person recall',
  },
  {
    n: '03',
    name: 'HIGH',
    model: 'YOLO26-pose · top-down',
    input: 'Person detection + individual pose estimation',
    note: 'Higher compute cost',
  },
]

const TRACK_SEQUENCE = [
  { id: 'ID 01', pos: '(212, 348)', vel: '1.4 m/s', dwell: '00:06', conf: '0.91' },
  { id: 'ID 01', pos: '(238, 344)', vel: '1.6 m/s', dwell: '00:07', conf: '0.89' },
  { id: 'ID 01', pos: '(266, 336)', vel: '1.5 m/s', dwell: '00:08', conf: '0.93' },
  { id: 'ID 01', pos: '(297, 329)', vel: '1.3 m/s', dwell: '00:09', conf: '0.90' },
]

const PIPELINE = ['CAMERA', 'WEBGL / WEBGPU', 'MODEL', 'TRACKER', 'EVENT ENGINE']

const PERF_METRICS = [
  { label: 'VIDEO', value: '30', unit: 'FPS' },
  { label: 'AI INFERENCE', value: '9.8', unit: 'FPS' },
  { label: 'PEOPLE', value: '04', unit: '' },
  { label: 'BACKEND', value: 'WEBGPU', unit: '' },
  { label: 'UPLOADS', value: 'ZERO', unit: '' },
  { label: 'MODEL', value: 'YOLO26', unit: '' },
]

const LIMITATIONS = [
  {
    n: '01',
    title: 'Crowded scenes',
    body: 'Detection quality degrades as overlap increases. Dense crowds reduce per-subject pose accuracy.',
  },
  {
    n: '02',
    title: 'Low-resolution CCTV',
    body: 'Small, distant subjects on compressed feeds are the hardest case — High mode exists specifically for this.',
  },
  {
    n: '03',
    title: 'Occlusion & ID persistence',
    body: 'A subject fully blocked for longer than the tracker\'s grace window can be re-assigned a new ID on reappearance.',
  },
  {
    n: '04',
    title: 'Browser GPU limits',
    body: 'WebGPU is fastest but not universally available. The system falls back to WASM automatically, at a real cost to FPS.',
  },
  {
    n: '05',
    title: 'Model latency',
    body: 'Heavier detection (High) trades frame rate for accuracy. There is no free version of that trade.',
  },
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

function useActiveStep(count: number, reduced: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (reduced) return
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
  }, [count, reduced])

  return { containerRef, stepRefs, active }
}

function SplitCTA({
  to,
  href,
  children,
  size = 'md',
}: {
  to?: string
  href?: string
  children: string
  size?: 'md' | 'lg'
}) {
  const inner = (
    <>
      <span className="split-cta-main">{children}</span>
      <span className="split-cta-arrow">
        <ArrowUpRight size={size === 'lg' ? 16 : 14} weight="bold" />
      </span>
    </>
  )
  const cls = `split-cta ${size === 'lg' ? 'split-cta-lg' : ''}`
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
  const scrollStory = useActiveStep(SCROLL_STEPS.length, reduced)
  const archRef = useRef<HTMLDivElement>(null)
  const [archVisible, setArchVisible] = useState(false)
  const [trackIndex, setTrackIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackVisible, setTrackVisible] = useState(false)

  useEffect(() => {
    const el = archRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArchVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setTrackVisible(true)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!trackVisible || reduced) return
    const id = window.setInterval(() => {
      setTrackIndex((i) => (i + 1) % TRACK_SEQUENCE.length)
    }, 1400)
    return () => window.clearInterval(id)
  }, [trackVisible, reduced])

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
        {/* ---- HERO ---- */}
        <section className="hero">
          <div className="hero-grid">
            <div className="hero-col-index">
              <Reveal className="hero-index">
                <span className="hero-index-n">01</span>
                <span className="hero-index-label">COMPUTER VISION SYSTEM</span>
              </Reveal>
            </div>
            <div className="hero-col-main">
              <Reveal delay={60}>
                <h1 className="hero-h1">
                  Human activity,
                  <br />
                  understood in real time.
                </h1>
              </Reveal>
              <Reveal delay={140} className="hero-lower">
                <p className="hero-sub">
                  Multi-person tracking, pose estimation, zone intelligence and activity detection — running directly
                  in the browser.
                </p>
                <div className="hero-actions">
                  <SplitCTA to="/app" size="lg">
                    Launch Analyzer
                  </SplitCTA>
                  <a className="btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                    <GithubLogo size={15} weight="bold" />
                    View Source
                  </a>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---- PRODUCT HERO (real screenshot) ---- */}
        <section className="product-hero">
          <Reveal className="product-hero-frame">
            <div className="product-hero-bar">
              <span className="product-hero-dot" />
              <span className="product-hero-live">SYSTEM ONLINE</span>
            </div>
            <img
              className="product-hero-img"
              src="/landing/dashboard-preview.png"
              alt="Realtime Activity Analyzer interface showing multi-person pose tracking, detection zones and the live event log"
              width={1400}
              height={900}
            />
          </Reveal>
        </section>

        {/* ---- SCROLL STORY ---- */}
        <section className="scroll-story" ref={scrollStory.containerRef}>
          <div className="scroll-story-visual">
            <span className="scroll-story-caption">{SCROLL_STEPS[scrollStory.active].tag}</span>
            <DemoPanel stage={SCROLL_STEPS[scrollStory.active].stage} />
          </div>
          <div className="scroll-story-steps">
            {SCROLL_STEPS.map((step, i) => (
              <div
                key={step.n}
                ref={(el) => {
                  scrollStory.stepRefs.current[i] = el
                }}
                className={`scroll-story-step ${scrollStory.active === i ? 'is-active' : ''}`}
              >
                <span className="mono-index">{step.n} / {step.tag}</span>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- PROJECT INTRODUCTION ---- */}
        <section className="statement">
          <Reveal>
            <p className="statement-text">
              Video is easy to capture.
              <br />
              <span className="statement-dim">Understanding what happens inside it is harder.</span>
            </p>
          </Reveal>
          <Reveal delay={100} className="statement-body">
            <p>
              Real footage is rarely clean. Low-resolution CCTV, multiple overlapping people, partial occlusion,
              identity drift across frames — and a browser GPU budget, not a server rack, to work within. This
              project runs the full detection, tracking and zone-intelligence pipeline client-side, with no video
              ever leaving the device.
            </p>
          </Reveal>
        </section>

        {/* ---- SYSTEM ARCHITECTURE ---- */}
        <section className="architecture" ref={archRef}>
          <span className="section-index">02 / SYSTEM ARCHITECTURE</span>
          <div className={`architecture-flow ${archVisible ? 'is-visible' : ''}`}>
            {ARCHITECTURE.map((step, i) => (
              <div className="architecture-node" key={step}>
                <span className="architecture-box">
                  <span className="architecture-n">{String(i + 1).padStart(2, '0')}</span>
                  {step}
                </span>
                {i < ARCHITECTURE.length - 1 && <span className="architecture-connector" style={{ transitionDelay: `${i * 90}ms` }} />}
              </div>
            ))}
          </div>
        </section>

        {/* ---- DETECTION MODES ---- */}
        <section className="modes">
          <span className="section-index">03 / DETECTION MODES</span>
          <div className="modes-grid">
            {MODES.map((mode) => (
              <Reveal key={mode.n} className="mode-row">
                <span className="mode-n">{mode.n}</span>
                <span className="mode-name">{mode.name}</span>
                <span className="mode-model">{mode.model}</span>
                <span className="mode-input">{mode.input}</span>
                <span className="mode-note">{mode.note}</span>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---- TRACKING ---- */}
        <section className="tracking" ref={trackRef}>
          <span className="section-index">04 / TRACKING</span>
          <Reveal className="tracking-copy">
            <h2>The tracker predicts movement and associates detections across frames.</h2>
            <p>Each subject keeps a stable identity as it moves, even through brief gaps in detection.</p>
          </Reveal>
          <div className="tracking-sequence">
            {TRACK_SEQUENCE.map((_, i) => (
              <div key={i} className={`tracking-node ${i === trackIndex ? 'is-active' : ''} ${i < trackIndex ? 'is-past' : ''}`}>
                <span className="tracking-box" />
                {i < TRACK_SEQUENCE.length - 1 && <span className="tracking-arrow">&#8594;</span>}
              </div>
            ))}
          </div>
          <div className="tracking-meta">
            <span><b>ID</b> {TRACK_SEQUENCE[trackIndex].id}</span>
            <span><b>POS</b> {TRACK_SEQUENCE[trackIndex].pos}</span>
            <span><b>VEL</b> {TRACK_SEQUENCE[trackIndex].vel}</span>
            <span><b>DWELL</b> {TRACK_SEQUENCE[trackIndex].dwell}</span>
            <span><b>CONF</b> {TRACK_SEQUENCE[trackIndex].conf}</span>
          </div>
        </section>

        {/* ---- SIGNATURE VISUAL ---- */}
        <section className="signature">
          <Reveal className="signature-inner">
            <SkeletonFigure />
            <p className="signature-copy">
              17 keypoints.
              <br />
              One moving subject.
              <br />
              <span className="statement-dim">Continuous context.</span>
            </p>
          </Reveal>
        </section>

        {/* ---- BROWSER-NATIVE ---- */}
        <section className="browser-native">
          <Reveal>
            <h2 className="section-title-left">Your footage stays in the browser.</h2>
          </Reveal>
          <Reveal delay={80} className="pipeline-row">
            {PIPELINE.map((step, i) => (
              <div key={step} className="pipeline-item">
                <span className="pipeline-box">{step}</span>
                {i < PIPELINE.length - 1 && <span className="pipeline-line" />}
              </div>
            ))}
          </Reveal>
          <Reveal delay={140} className="pipeline-tags">
            <span className="pipeline-tag">LOCAL INFERENCE</span>
            <span className="pipeline-tag">NO VIDEO UPLOAD</span>
            <span className="pipeline-tag">CLIENT-SIDE PROCESSING</span>
          </Reveal>
        </section>

        {/* ---- PERFORMANCE ---- */}
        <section className="performance">
          <span className="section-index">05 / PERFORMANCE</span>
          <div className="performance-grid">
            {PERF_METRICS.map((m) => (
              <Reveal key={m.label} className="performance-cell">
                <span className="performance-value">
                  {m.value}
                  {m.unit && <span className="performance-unit">{m.unit}</span>}
                </span>
                <span className="performance-label">{m.label}</span>
              </Reveal>
            ))}
          </div>
          <p className="performance-note">Shown live in the analyzer&rsquo;s diagnostics panel — figures above are illustrative.</p>
        </section>

        {/* ---- KNOWN LIMITATIONS ---- */}
        <section className="limitations">
          <span className="section-index">06 / CONSTRAINTS</span>
          <h2 className="section-title-left">Built with constraints in mind.</h2>
          <div className="limitations-list">
            {LIMITATIONS.map((l) => (
              <Reveal key={l.n} className="limitation-row">
                <span className="limitation-n">{l.n}</span>
                <span className="limitation-title">{l.title}</span>
                <span className="limitation-body">{l.body}</span>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---- FINAL CTA ---- */}
        <section className="final-cta">
          <Reveal className="final-cta-inner">
            <h2>
              Building AI products
              <br />
              beyond the prototype.
            </h2>
            <p>
              We combine product design, AI engineering and frontend systems to turn complex technology into usable
              digital products.
            </p>
            <div className="final-cta-actions">
              <SplitCTA href="mailto:xtarcagency@gmail.com" size="lg">
                Start a Project
              </SplitCTA>
              <SplitCTA to="/app">Launch Analyzer</SplitCTA>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Realtime Activity Analyzer</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          <GithubLogo size={15} weight="bold" />
          GitHub
        </a>
        <span className="footer-built">Built with WebGL / WebGPU / WebAssembly</span>
        <span className="footer-copy">&copy; {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
