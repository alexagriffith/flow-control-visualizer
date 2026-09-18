import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'
import './components/progress.css'

const Progress = lazy(() => import('./components/Progress').then(module => ({ default: module.Progress })))
export function Workspace() {
  const [progress, setProgress] = useState(['#progress', '#progress-main'].includes(location.hash))
  useEffect(() => {
    const change = () => setProgress(['#progress', '#progress-main'].includes(location.hash))
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return <>
    {progress ? <a className="skip-link" href="#progress-main">Skip to progress</a> : null}
    <nav className={`workspace-nav${progress ? ' progress-nav' : ''}`} aria-label="Workspace">
      <a href="#replay" aria-current={!progress ? 'page' : undefined}>Replay</a>
      <a href="#progress" aria-current={progress ? 'page' : undefined}>Benchmark progress</a>
    </nav>
    {progress ? <Suspense fallback={<p role="status">Loading progress…</p>}><Progress /></Suspense> : <App />}
  </>
}
