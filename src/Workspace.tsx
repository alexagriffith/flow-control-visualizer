import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'
import './components/progress.css'

const Progress = lazy(() => import('./components/Progress').then(module => ({ default: module.Progress })))
export function Workspace() {
  const [progress, setProgress] = useState(location.hash === '#progress')
  useEffect(() => {
    const change = () => setProgress(location.hash === '#progress')
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return <>
    <nav className="workspace-nav" aria-label="Workspace">
      <a href="#replay" aria-current={!progress ? 'page' : undefined}>Replay</a>
      <a href="#progress" aria-current={progress ? 'page' : undefined}>Benchmark progress</a>
    </nav>
    {progress ? <Suspense fallback={<p role="status">Loading progress…</p>}><Progress /></Suspense> : <App />}
  </>
}
