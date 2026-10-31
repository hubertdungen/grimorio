// Rede de segurança do ecrã: um erro ao desenhar já não deixa a página toda azul e vazia — mostra o que aconteceu, deixa
// tentar outra vez ou recarregar, e manda o erro para o registo do servidor (<dados>/logs/client-errors.log).
import { Component } from 'react'
import { tx } from './i18n.js'

export function reportError(msg, stack = '', comp = '') {
  try {
    fetch('/api/clienterr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ msg: String(msg).slice(0, 2000), stack: String(stack || '').slice(0, 3000), comp: String(comp || '').slice(0, 3000), url: location.href, ua: navigator.userAgent }) }).catch(() => {})
  } catch { /* sem rede */ }
}

export class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error(err); reportError(err?.message || err, err?.stack, info?.componentStack) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <section className="card boundary" role="alert">
        <h3>{tx('Algo correu mal ao desenhar este ecrã')}</h3>
        <p className="muted small">{tx('O erro ficou registado para ser corrigido. Podes tentar outra vez ou recarregar a página.')}</p>
        <code className="small">{String(this.state.err?.message || this.state.err).slice(0, 300)}</code>
        <div className="row-btns"><button className="primary" onClick={() => this.setState({ err: null })}>{tx('Tentar outra vez')}</button>
          <button onClick={() => location.reload()}>{tx('Recarregar a página')}</button></div>
      </section>
    )
  }
}
