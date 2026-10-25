// Amigos (Definições): cada amigo tem um link de convite pessoal. Quem o abre fica convidado neste Grimório (guests.py):
// os decks dele ficam aqui marcados «🤝 nome», entra nos torneios e nas arenas e aposta com a sua carteira.
// Em casa: link da rede local + QR para o telemóvel; pela internet: o endereço público (se houver).
import { useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import { ask } from './confirm.jsx'
import { tx, LOCALE } from './i18n.js'

async function j(url, opts) {
  const r = await fetch(url, opts), d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(tx(d.erro || `HTTP ${r.status}`))
  return d
}
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })

function QR({ text }) {
  const q = qrcode(0, 'M'); q.addData(text); q.make()
  return <span className="fr-qr" dangerouslySetInnerHTML={{ __html: q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }} />  // SVG gerado localmente, só com o link
}

export default function Friends() {
  const [d, setD] = useState(null), [name, setName] = useState(''), [err, setErr] = useState(''), [qr, setQr] = useState(null), [copied, setCopied] = useState('')
  const load = () => j('/api/friends').then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  if (!d) return err ? <p className="small bad-t">{err}</p> : null
  const add = async () => { setErr(''); try { await post('/api/friends', { name: name.trim() }); setName(''); load() } catch (e) { setErr(e.message) } }
  const revoke = async f => (await ask('amigo', { title: tx('Revogar o convite de {n}?', { n: f.name }), body: tx('O link deixa de entrar. Os decks dele ficam cá.'), ok: tx('Revogar') })) && post(`/api/friends/${f.id}/revoke`).then(load)
  const remove = async f => (await ask('amigo', { title: tx('Tirar {n} dos amigos?', { n: f.name }), body: tx('O link deixa de entrar. Os decks dele ficam na tua Biblioteca, marcados com o nome.'), ok: tx('Tirar') })) && j(`/api/friends/${f.id}`, { method: 'DELETE' }).then(load)
  const copy = async (url, k) => { try { await navigator.clipboard.writeText(url); setCopied(k); setTimeout(() => setCopied(''), 1500) } catch { window.prompt(tx('Copia o link:'), url) } }
  const links = f => [['casa', tx('🏠 Em casa (mesma rede)'), `${d.lan}/convite/${f.token}`], ...(d.public ? [['net', tx('🌍 Pela internet'), `${d.public}/convite/${f.token}`]] : [])]
  return (
    <div className="friends">
      <p className="small muted">{tx('Cada amigo recebe um link pessoal. Ao abri-lo fica convidado neste Grimório: os decks dele ficam aqui marcados com o nome, entra nos teus torneios e arenas e aposta com a sua carteira. Não vê nem mexe em mais nada, e podes revogar o link quando quiseres.')}</p>
      <div className="row-btns">
        <input value={name} onChange={e => setName(e.target.value)} placeholder={tx('Nome do amigo')} maxLength={40} onKeyDown={e => e.key === 'Enter' && name.trim() && add()} />
        <button className="primary" onClick={add} disabled={!name.trim()}>＋ {tx('Convidar')}</button>
        {err && <span className="small bad-t">{err}</span>}
      </div>
      {!d.friends.length && <p className="small muted">{tx('Ainda não convidaste ninguém.')}</p>}
      <ul className="fr-list">{d.friends.map(f => (
        <li key={f.id} className={f.revoked ? 'off' : ''}>
          <div className="fr-h"><b>🤝 {f.name}</b><span className="small muted">{tx('{n} decks', { n: f.decks })} · {new Date(f.created * 1000).toLocaleDateString(LOCALE)}</span>
            <span className="row-btns">{!f.revoked && <button className="link small" onClick={() => revoke(f)}>{tx('revogar')}</button>}<button className="link small" onClick={() => remove(f)}>{tx('tirar')}</button></span></div>
          {f.revoked ? <p className="small muted">{tx('Convite revogado.')}</p> : links(f).map(([k, l, url]) => (
            <div key={k} className="fr-link">
              <span className="small">{l}</span><code>{url}</code>
              <button className="small" onClick={() => copy(url, f.id + k)}>{copied === f.id + k ? tx('copiado ✓') : tx('copiar')}</button>
              <button className="small" onClick={() => setQr(qr === f.id + k ? null : f.id + k)} aria-pressed={qr === f.id + k}>QR</button>
              {qr === f.id + k && <QR text={url} />}
            </div>))}
        </li>))}</ul>
      {!d.public && <p className="small muted">{tx('Para convidar pela internet é preciso um endereço público (o Grimório num servidor com domínio, ou a partilha pela internet que vem a seguir). Em casa basta o link da rede local ou o QR.')}</p>}
    </div>
  )
}
