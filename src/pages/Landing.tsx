import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, GithubLogo } from '@phosphor-icons/react'
import Reveal from '../components/Reveal'
import DemoPanel from '../components/DemoPanel'
import BootSequence from '../components/BootSequence'
import './Landing.css'

const REPO_URL = 'https://github.com/xtarcagency-creator/realtime'

const TRUST_ROW = ['WebGL', 'WebAssembly', 'Local inference', 'No video uploads']

const ARCHITECTURE = ['Camera / Video', 'Browser', 'Pose Model', 'Activity Engine', 'Events']

const DEMO_STEPS = [
  {
    n: '01',
    title: 'Multi-person tracking',
    body: 'Track multiple people across the frame using pose-based detection and persistent tracking.',
    stage: 2,
  },
  {
    n: '02',
    title: 'Detection zones',
    body: 'Define regions inside the video feed and measure occupancy and dwell behavior.',
    stage: 3,
  },
  {
    n: '03',
    title: 'Activity events',
    body: 'Turn movement into useful events such as entry, exit, and loitering detection.',
    stage: 5,
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

// Ties the hero preview's scale/position and its progressive overlay reveal
// to how far the page has scrolled from the very top — a one-shot "coming
// alive" moment as the user begins scrolling, not a pinned/scrubbed section.
// Driven by scrollY directly (not element position) so it reliably starts
// at 0 on load regardless of how tall the hero copy above it is.
const HERO_REVEAL_DISTANCE = 420

function useHeroScroll(reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(reduced ? 1 : 0)

  useEffect(() => {
    if (reduced) {
      setProgress(1)
      return
    }
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const p = window.scrollY / HERO_REVEAL_DISTANCE
        setProgress(Math.min(1, Math.max(0, p)))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [reduced])

  return { ref, progress }
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

export default function Landing() {
  const reduced = usePrefersReducedMotion()
  const hero = useHeroScroll(reduced)
  const demoStory = useActiveStep(DEMO_STEPS.length, reduced)

  const heroScale = 0.93 + 0.07 * hero.progress
  const heroTranslate = (1 - hero.progress) * 22
  const heroStage = Math.ceil(hero.progress * 5)

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
            <Link className="btn-cta btn-cta-sm" to="/app">
              Launch Analyzer
              <ArrowRight size={12} weight="bold" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <Reveal className="eyebrow">
            <span className="eyebrow-dot" />
            Browser-native computer vision
          </Reveal>
          <Reveal delay={60}>
            <h1>
              Understand human activity.
              <br />
              In real time.
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="hero-sub">
              Multi-person pose tracking, zone monitoring and activity detection processed directly in your browser.
            </p>
          </Reveal>
          <Reveal delay={180} className="hero-actions">
            <Link className="btn-cta" to="/app">
              Launch Analyzer
              <ArrowRight size={14} weight="bold" />
            </Link>
            <a className="btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
              <GithubLogo size={15} weight="bold" />
              View Source
            </a>
          </Reveal>
          <div className="trust-row">
            {TRUST_ROW.map((item) => (
              <span key={item} className="trust-item">
                <span className="trust-dot" />
                {item}
              </span>
            ))}
          </div>
        </section>

        <div className="preview">
          <div
            ref={hero.ref}
            className="preview-scale"
            style={{ transform: `scale(${heroScale}) translateY(${heroTranslate}px)` }}
          >
            <DemoPanel stage={heroStage} className="preview-glow" />
          </div>
        </div>

        <section className="demo-story" ref={demoStory.containerRef}>
          <div className="demo-story-visual">
            <DemoPanel stage={DEMO_STEPS[demoStory.active].stage} />
          </div>
          <div className="demo-story-steps">
            {DEMO_STEPS.map((step, i) => (
              <div
                key={step.n}
                ref={(el) => {
                  demoStory.stepRefs.current[i] = el
                }}
                className={`demo-story-step ${demoStory.active === i ? 'is-active' : ''}`}
              >
                <span className="workflow-n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="privacy">
          <Reveal>
            <h2 className="section-title">Your footage stays in your browser.</h2>
            <p className="privacy-sub">
              Video analysis runs locally through the browser without requiring footage to be sent to an external
              processing server.
            </p>
          </Reveal>
          <Reveal delay={80} className="privacy-diagram">
            {ARCHITECTURE.map((step, i) => (
              <div key={step} className="diagram-row">
                <span className="diagram-box">{step}</span>
                {i < ARCHITECTURE.length - 1 && <span className="diagram-line" />}
              </div>
            ))}
          </Reveal>
        </section>

        <section className="cta-banner">
          <div className="cta-banner-bg" aria-hidden="true">
            <DemoPanel stage={5} />
          </div>
          <Reveal className="cta-banner-content">
            <h2>See the analyzer in action.</h2>
            <p>Test real-time tracking, detection zones and activity monitoring directly in your browser.</p>
            <Link className="btn-cta btn-cta-lg" to="/app">
              Launch Analyzer
              <ArrowRight size={16} weight="bold" />
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Realtime Activity Analyzer</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          <GithubLogo size={15} weight="bold" />
          GitHub
        </a>
        <span className="footer-built">Built with WebGL / WebAssembly</span>
        <span className="footer-copy">&copy; {new Date().getFullYear()}</span>
      </footer>
    </div>
  )
}
