import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'

// The dashboard pulls in TensorFlow.js, pose-detection, and onnxruntime-web
// (~475KB gzipped combined) — code-split so a visitor landing on "/" never
// downloads any of that, only someone who actually opens "/app" does.
const Analyser = lazy(() => import('./pages/Analyser'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/app"
        element={
          <Suspense fallback={<div className="route-loading" />}>
            <Analyser />
          </Suspense>
        }
      />
    </Routes>
  )
}

export default App
