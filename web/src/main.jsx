import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Sliders: a parte preenchida do trilho segue o valor (--p); o Firefox tem ::-moz-range-progress, o Chrome precisa disto
const fill = el => { const lo = +el.min || 0, hi = +el.max || 100; el.style.setProperty('--p', `${((el.value - lo) / (hi - lo || 1)) * 100}%`) }
const scan = n => n.nodeType === 1 && (n.matches('input[type=range]') ? fill(n) : n.querySelectorAll('input[type=range]').forEach(fill))
document.addEventListener('input', e => { if (e.target.type === 'range') fill(e.target) })
new MutationObserver(ms => ms.forEach(m => (m.type === 'attributes' ? m.target.type === 'range' && fill(m.target) : m.addedNodes.forEach(scan))))
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'min', 'max'] })

// App instalável (PWA): o browser só permite service workers em HTTPS ou em localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}))
}
