import { Link } from 'react-router-dom'
import {
  ArrowRight,
  GithubLogo,
  UsersThree,
  MapPinArea,
  Cpu,
  VideoCamera,
  Waveform,
  Bell,
  CheckCircle,
} from '@phosphor-icons/react'
import Reveal from '../components/Reveal'
import './Landing.css'

const REPO_URL = 'https://github.com/xtarcagency-creator/realtime'

const TRUST_ROW = ['WebGL', 'WebAssembly', 'Local inference', 'No video uploads']

const FEATURES = [
  {
    n: '01',
    icon: UsersThree,
    title: 'Multi-person tracking',
    body: 'Track multiple people and maintain persistent identities across the frame.',
  },
  {
    n: '02',
    icon: MapPinArea,
    title: 'Zone intelligence',
    body: 'Draw custom regions and measure dwell time, entries, exits, and loitering.',
  },
  {
    n: '03',
    icon: Cpu,
    title: 'Browser-native inference',
    body: 'Run pose analysis locally using WebGL and WebAssembly without uploading footage.',
  },
]

const WORKFLOW = [
  { n: '01', icon: VideoCamera, title: 'Input', body: 'Live camera or uploaded video' },
  { n: '02', icon: Waveform, title: 'Analyze', body: 'Pose tracking + zone logic' },
  { n: '03', icon: Bell, title: 'Detect', body: 'Activity events and dwell behavior' },
]

const PRIVACY_POINTS = ['No server upload', 'No external processing', 'Local inference']

const ARCHITECTURE = ['Camera / Video', 'Browser', 'Pose Model', 'Activity Engine', 'Insights']

export default function Landing() {
  return (
    <div className="landing">
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
              <span className="accent-word">In real time.</span>
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
          <Reveal delay={220} className="trust-row">
            {TRUST_ROW.map((item, i) => (
              <span key={item} className="trust-item">
                {i > 0 && <span className="trust-sep" />}
                {item}
              </span>
            ))}
          </Reveal>
        </section>

        <Reveal delay={100} className="preview">
          <div className="hero-frame">
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
                    <div className="demo-box" style={{ top: '20%', left: '10%', width: '20%', height: '58%' }}>
                      <span className="demo-box-label">#1</span>
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
                      className="demo-box demo-box-muted"
                      style={{ top: '26%', left: '56%', width: '17%', height: '48%' }}
                    >
                      <span className="demo-box-label">#2</span>
                    </div>
                    <svg className="demo-zone" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <polygon points="4,58 42,52 45,94 2,96" />
                    </svg>
                    <span className="demo-zone-label" style={{ top: '58%', left: '9%' }}>
                      Zone A
                    </span>
                    <span className="demo-fps">32 FPS</span>
                    <div className="demo-toast">
                      <span className="demo-toast-dot" />
                      Person #1 entered Zone A
                    </div>
                  </div>
                </div>
                <div className="demo-inspector">
                  <div className="demo-stat-row">
                    <div className="demo-stat">
                      <b>2</b>
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
                    <div className="demo-mini-row">
                      <span className="demo-dot demo-dot-warn" />
                      Zone A · 14s
                    </div>
                  </div>
                  <div className="demo-mini">
                    <span className="demo-mini-title">Activity</span>
                    <div className="demo-mini-row">
                      <span className="demo-dot demo-dot-warn" />
                      Person #1 entered Zone A
                    </div>
                    <div className="demo-mini-row">
                      <span className="demo-dot demo-dot-info" />
                      Person #2 exited Zone B
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <section className="features">
          <div className="feature-grid">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80} className="feature-item">
                <span className="feature-n">{f.n}</span>
                <f.icon size={20} weight="bold" className="feature-icon" />
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="workflow">
          <Reveal>
            <h2 className="section-title">From camera to activity insight.</h2>
          </Reveal>
          <div className="workflow-row">
            {WORKFLOW.map((step, i) => (
              <Reveal key={step.title} delay={i * 100} className="workflow-step">
                <div className="workflow-head">
                  <span className="workflow-n">{step.n}</span>
                  <step.icon size={16} weight="bold" />
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {i < WORKFLOW.length - 1 && <ArrowRight className="workflow-arrow" size={16} weight="bold" />}
              </Reveal>
            ))}
          </div>
        </section>

        <section className="privacy">
          <div className="privacy-grid">
            <Reveal className="privacy-copy">
              <h2 className="section-title section-title-left">Your footage stays on your device.</h2>
              <p>
                Every frame is analyzed in the same browser tab that captured it. Pose estimation, zone logic, and
                event detection all run locally — nothing is uploaded or streamed to a server.
              </p>
              <ul className="privacy-points">
                {PRIVACY_POINTS.map((point) => (
                  <li key={point}>
                    <CheckCircle size={15} weight="fill" />
                    {point}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={80} className="privacy-diagram">
              {ARCHITECTURE.map((step, i) => (
                <div key={step} className="diagram-row">
                  <span className="diagram-box">{step}</span>
                  {i < ARCHITECTURE.length - 1 && <ArrowRight size={14} weight="bold" className="diagram-arrow" />}
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="cta-banner">
          <Reveal>
            <h2>See the analyzer in action.</h2>
            <p>Open the live workspace and test pose tracking, zones, and activity detection.</p>
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
