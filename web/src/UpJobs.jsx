// O aviso pequeno no canto enquanto há ampliações a correr em segundo plano (upjobs.js): a percentagem, e no fim ✓
import { useUpJobs } from './upjobs.js'
import { tx } from './i18n.js'

export default function UpscaleJobs() {
  const jobs = useUpJobs()
  if (!jobs.length) return null
  return (
    <div className="upjobs" role="status" aria-live="polite">{jobs.map(j => (
      <div key={j.key} className={j.err ? 'bad' : j.done ? 'ok' : ''} title={j.label}>
        {j.err ? `⚠ ${j.label}: ${j.err}` : j.done ? `✓ ${tx('Arte ampliada: {c}', { c: j.label })}`
          : <>⤢ {j.label} ×{j.scale} <b>{j.ep ? `${Math.round(j.f * 100)}%` : '…'}</b><i style={{ width: `${Math.round(j.f * 100)}%` }} /></>}
      </div>))}
    </div>
  )
}
