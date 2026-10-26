// Importar vários decks: perfil do Archidekt, links colados, ou o favorito na página de perfil/deck do TappedOut.
// Cada link pode trazer a capa («link|imagem», do favorito); decks que já tens (mesmo nome) só recebem a capa e as artes das cartas.
import { useEffect, useState } from 'react'
import { parseList } from './deck.js'
import { FORMAT, fixFormat } from './formats.js'
import { img, importExtras } from './data.js'
import { tx } from './i18n.js'

const LINK = /https?:\/\/(?:www\.)?(?:tappedout\.net\/mtg-decks\/[\w-]+|moxfield\.com\/decks\/[\w-]+|archidekt\.com\/decks\/\d+[\w/-]*|mtggoldfish\.com\/(?:deck|archetype)\/[\w/-]+|deckstats\.net\/decks\/\d+\/[\w-]+|mtgtop8\.com\/event\?[^\s"'|]+|scryfall\.com\/@[\w-]+\/decks\/[\w-]+)\/?/i
const nameOf = u => decodeURIComponent(u.replace(/\/$/, '').split('/').pop().split('?')[0]).replace(/^\d+-/, '').replace(/[-_]/g, ' ')
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
// «link» ou «link|imagem» separados por espaços/linhas; sem repetidos
const parseTokens = src => {
  const seen = new Set(), out = []
  for (const t of src.split(/\s+/)) {
    const [u, img = ''] = t.split('|'), m = u && u.match(LINK)
    if (!m || seen.has(m[0])) continue
    seen.add(m[0])
    out.push({ url: m[0], name: nameOf(m[0]), img: /^https:\/\/\S+$/.test(img) ? img : '' })
  }
  return out
}

// Favorito: corre no teu browser no TappedOut (passa o Cloudflare). Numa página de deck leva esse deck e a sua imagem
// (og:image); numa página de perfil leva todos os decks com a imagem de cada um. Abre o Grimório com a lista.
const bookmarklet = origin => `javascript:(()=>{const R=/https:\\/\\/tappedout\\.net\\/mtg-decks\\/[\\w-]+\\//,X=/\\/mtg-decks\\/(search|latest|top|new)\\//;const pic=a=>{let n=a;for(let k=0;k<5&&n&&n!==document.body;k++,n=n.parentElement){const i=n.querySelector&&n.querySelector('img');const s=i&&(i.dataset.src||i.currentSrc||i.src);if(s&&!/avatar|gravatar|logo|icon/i.test(s))return s;const b=getComputedStyle(n).backgroundImage;if(b&&b.startsWith('url('))return b.slice(5,-2)}return''};let l;const og=document.querySelector('meta[property="og:image"]');const here=(location.href.match(R)||[])[0];if(here&&!X.test(here))l=[here+'|'+(og?og.content:'')];else{const m=new Map();for(const a of document.querySelectorAll('a[href*="/mtg-decks/"]')){const u=(a.href.match(R)||[])[0];if(!u||X.test(u))continue;const p=pic(a);if(!m.has(u)||(!m.get(u)&&p))m.set(u,p)}l=[...m].map(([u,p])=>u+'|'+p)}if(!l.length){alert(${JSON.stringify(tx('Não encontrei decks nesta página.'))});return}window.open('${origin}/#importar='+encodeURIComponent(l.join(' ')))})()`

export default function ProfileImport({ data, initial = '', onDone, say }) {
  const [text, setText] = useState(initial)
  const [list, setList] = useState([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [mine, setMine] = useState([])
  useEffect(() => { fetch('/api/decks').then(r => r.json()).then(setMine).catch(() => {}) }, [])
  // de quem são os decks importados: meus, da comunidade (de outra pessoa) ou de um amigo (fica com o nome dele)
  const [who, setWho] = useState('meus'), [friends, setFriends] = useState([])
  useEffect(() => { fetch('/api/friends').then(r => (r.ok ? r.json() : { friends: [] })).then(d => setFriends(d.friends || [])).catch(() => {}) }, [])
  const fr = who.startsWith('f:') && friends.find(f => f.id === who.slice(2))
  const owner = who === 'com' ? { community: true } : fr ? { friend: fr.id, friendName: fr.name } : {}
  useEffect(() => { if (initial) listDecks(initial) }, [initial, mine.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const withMine = ds => ds.map(d => { const ex = mine.find(m => norm(m.name) === norm(d.name)); return { ...d, ex, capa: !!ex, on: true } })
  const upd = (url, f) => setList(l => l.map(x => (x.url === url ? { ...x, ...f(x) } : x)))
  // lê cada deck logo a seguir à lista (3 de cada vez): formato detetado, nº de cartas e cartas para a capa
  const prefetch = async ds => {
    const q = [...ds]
    const one = async () => {
      for (let d; (d = q.shift());) {
        try {
          const r = await fetch(`/api/import?url=${encodeURIComponent(d.url)}`); const j = await r.json()
          if (!r.ok) throw new Error(j.erro)
          const p = parseList(j.text, data)
          const cards = Object.entries(p.main).map(([n, k]) => [data.byName.get(n), k]).filter(([c]) => c && c.mt !== 'Land')
            .sort((a, b) => b[1] - a[1] || b[0].cmc - a[0].cmc).map(([c]) => c)
          const ex = d.ex || mine.find(m => norm(m.name) === norm(j.name))
          upd(d.url, () => ({ j, p, fmt: fixFormat(data, p, j.format).format, count: Object.values(p.main).reduce((a, b) => a + b, 0) + p.commanders.length,
            cards: [...p.commanders.map(n => data.byName.get(n)).filter(Boolean), ...cards], img: d.img || j.cover || '', name: j.name || d.name, ex, capa: !!ex }))
        } catch (e) { upd(d.url, () => ({ fail: e.message })) }
      }
    }
    await Promise.all([one(), one(), one()])
  }
  async function listDecks(src = text) {
    setErr(''); setList([])
    const profile = src.match(/https?:\/\/(?:www\.)?archidekt\.com\/(?:u|user)\/[^\s/]+/i)
    if (profile) {
      setBusy(tx('A ler o perfil…'))
      try {
        const r = await fetch(`/api/import/profile?url=${encodeURIComponent(profile[0])}`); const j = await r.json()
        if (!r.ok) throw new Error(j.erro)
        const ds = withMine(j.decks); setList(ds); prefetch(ds)
      } catch (e) { setErr(e.message) }
      setBusy(''); return
    }
    const items = parseTokens(src)
    if (/tappedout\.net\/users\//i.test(src) && !items.length) { setErr(tx('O TappedOut não deixa o servidor ler perfis. Usa o favorito abaixo na tua página de perfil, ou cola os links dos decks.')); return }
    if (!items.length) { setErr(tx('Não encontrei links de decks nem um perfil do Archidekt.')); return }
    const ds = withMine(items); setList(ds); prefetch(ds)
  }

  const setCover = (id, url) => fetch(`/api/decks/${id}/cover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
  const run = async () => {
    const sel = list.filter(d => d.on)
    let ok = 0, capas = 0
    const fails = []
    for (let k = 0; k < sel.length; k++) {
      const d = sel[k]
      setBusy(tx(d.capa ? 'A atualizar capa e artes {k}/{n}: {name}' : 'A importar {k}/{n}: {name}', { k: k + 1, n: sel.length, name: d.name }))
      try {
        const pickImg = d.pick ? img(data.byName.get(d.pick), 'art_crop') : null
        let j = d.j
        if (!j) { const r = await fetch(`/api/import?url=${encodeURIComponent(d.url)}`); j = await r.json(); if (!r.ok) throw new Error(j.erro) }
        const cover = pickImg || d.img || j.cover || null
        const p = parseList(j.text, data)
        const { art, prints } = await importExtras(data, p, j)
        if (d.capa && d.ex) {  // deck que já tens: artes do site (TappedOut), edições e capa; a lista fica como está
          const full = await (await fetch(`/api/decks/${d.ex.id}`)).json()
          await fetch(`/api/decks/${d.ex.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...full, art, prints: { ...(full.prints || {}), ...prints }, source: d.url }) })
          if (cover) await setCover(d.ex.id, cover)
          capas++; continue
        }
        const fmt = fixFormat(data, p, j.format).format
        await fetch('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          name: j.name || d.name, format: fmt, commanders: p.commanders, main: p.main, side: p.side, maybe: p.maybe, seeds: [], prints, art, source: d.url, groups: [],
          notes: tx('Importado de {src}: {url}', { src: j.source, url: d.url }), cover: d.pick || undefined, coverImg: d.pick ? null : cover, count: Object.values(p.main).reduce((a, b) => a + b, 0) + p.commanders.length,
          ...owner,
        }) })
        ok++
      } catch (e) { fails.push(`${d.name}: ${e.message}`) }
    }
    setBusy('')
    setErr(fails.length ? tx('Falharam {n}: {list}', { n: fails.length, list: fails.slice(0, 3).join(' · ') }) : '')
    if (!fails.length) { setList([]); setText('') }  // tudo importado: a janela volta a ficar limpa
    say?.([ok && tx('Importados {n} decks.', { n: ok }), capas && tx('Capas e artes atualizadas: {n}.', { n: capas })].filter(Boolean).join(' ') || tx('Nada importado.'))
    onDone?.(ok + capas)
  }

  const origin = window.location.origin
  return (
    <div className="pimport">
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={`${tx('Perfil do Archidekt (archidekt.com/u/nome)')}\n${tx('ou vários links de decks (TappedOut, Moxfield, Archidekt, MTGGoldfish, Deckstats, MTGTop8, Scryfall), um por linha')}`} />
      <div className="row-btns"><button onClick={() => listDecks()} disabled={!text.trim() || !!busy}>{tx('Listar decks')}</button>{(text || list.length > 0) && !busy && <button className="link small" onClick={() => { setText(''); setList([]); setErr('') }}>{tx('limpar')}</button>}{busy && <span className="small"><span className="spin-dot" /> {busy}</span>}</div>
      {err && <p className="small bad-t">{err}</p>}
      {list.length > 0 && (
        <>
          <div className="row-btns pi-who"><span className="small">{tx('De quem são estes decks:')}</span>
            <span className="seg small">{[['meus', tx('🧙 Meus')], ['com', tx('🌐 Comunidade')]].map(([k, l]) => <button key={k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l}</button>)}
              <button className={fr ? 'on' : ''} disabled={!friends.length} onClick={() => setWho(`f:${friends[0].id}`)} title={friends.length ? undefined : tx('Ainda não tens amigos (Definições › Amigos).')}>{tx('🤝 De um amigo')}</button></span>
            {fr && <select className="small" value={who} onChange={e => setWho(e.target.value)} aria-label={tx('Amigo')}>{friends.map(f => <option key={f.id} value={`f:${f.id}`}>{f.name}</option>)}</select>}
            <span className="muted small">{who === 'com' ? tx('Decks de outra pessoa: entram nos torneios e na Arena como «comunidade».') : fr ? tx('Ficam marcados como decks de {n}.', { n: fr.name }) : tx('Ficam como decks teus.')}</span></div>
          <div className="row-btns small"><button className="link" onClick={() => setList(l => l.map(d => ({ ...d, on: true })))}>{tx('todos')}</button><button className="link" onClick={() => setList(l => l.map(d => ({ ...d, on: false })))}>{tx('nenhum')}</button><span className="muted">{tx('{k} de {n} escolhidos', { k: list.filter(d => d.on).length, n: list.length })}</span></div>
          <ul className="lib-list pi-list">{list.map((d, k) => (
            <li key={d.url}>
              <button className="pi-cov" onClick={() => upd(d.url, x => ({ open: !x.open }))} title={tx('Escolher a capa')} disabled={!d.cards}>
                {d.pick ? <img className="pi-img" src={img(data.byName.get(d.pick), 'art_crop')} alt="" /> : d.img ? <img className="pi-img" src={d.img} alt="" loading="lazy" /> : d.cards?.[0] ? <img className="pi-img" src={img(d.cards[0], 'art_crop')} alt="" /> : <span className="pi-img" />}
                {d.cards && <i>🖼</i>}
              </button>
              <label className="chk"><input type="checkbox" checked={d.on} onChange={() => setList(l => l.map((x, j) => (j === k ? { ...x, on: !x.on } : x)))} /> <b>{d.name}</b></label>
              <span className="muted small">{d.fail ? <span className="bad-t">{d.fail}</span> : (d.fmt || d.format) ? <span className="chip">{FORMAT[d.fmt || d.format]?.name || d.fmt || d.format}</span> : d.j ? '' : <><span className="spin-dot" /> {tx('a ler…')}</>}{d.count ? ` · ${tx('{n} carta|{n} cartas', { n: d.count })}` : ''}</span>
              {d.ex && <select className="small" value={d.capa ? 'capa' : 'novo'} onChange={e => setList(l => l.map((x, j) => (j === k ? { ...x, capa: e.target.value === 'capa' } : x)))}>
                <option value="capa">{tx('Já tens «{name}»: atualizar capa e artes das cartas', { name: d.ex.name })}</option><option value="novo">{tx('Importar como deck novo')}</option></select>}
              {d.open && d.cards && <div className="pi-pick">
                {d.img && <button className={!d.pick ? 'on' : ''} onClick={() => upd(d.url, () => ({ pick: null, open: false }))} title={tx('Imagem do site')}><img src={d.img} alt="" /><small>{tx('do site')}</small></button>}
                {d.cards.slice(0, 40).map(c => <button key={c.n} className={d.pick === c.n ? 'on' : ''} onClick={() => upd(d.url, () => ({ pick: c.n, open: false }))} title={c.n}><img src={img(c, 'small')} alt={c.n} loading="lazy" /></button>)}
              </div>}
            </li>
          ))}</ul>
          <button className="primary" onClick={run} disabled={!!busy || !list.some(d => d.on)}>{tx('Importar {n} decks', { n: list.filter(d => d.on).length })}</button>
        </>
      )}
      <details className="small pi-tips"><summary>💡 {tx('Como trazer vários decks de cada site com um só link (e as capas)')}</summary>
        <ul>
          <li><b>Archidekt</b>: {tx('cola o link do perfil')} (<i>archidekt.com/u/{tx('o-teu-nome')}</i>) {tx('e escolhe os decks. Vem também a capa de cada deck (a imagem que puseste no Archidekt, ou a carta em destaque).')}</li>
          <li><b>TappedOut</b>: {tx('o site não deixa o servidor entrar, por isso usa o favorito abaixo, que corre no teu browser. Na')} <b>{tx('página de perfil')}</b> (<i>tappedout.net/users/{tx('o-teu-nome')}/mtg-decks/</i>) {tx('traz todos os decks com a imagem de cada um; na')} <b>{tx('página de um deck')}</b> {tx('traz só esse, com a imagem. Se o deck já existir aqui com o mesmo nome, só lhe atualiza a capa e as artes das cartas (as imagens que escolheste no TappedOut, alteradas incluídas).')}</li>
          <li><b>Moxfield</b>: {tx('cola os links dos decks, um por linha (o perfil não é público pela API). Vem a arte da carta em destaque.')}</li>
          <li><b>MTGGoldfish, Deckstats, MTGTop8, Scryfall</b>: {tx('cola os links, um por linha. Estes sites não têm capa; escolhe-a depois na Biblioteca (🖼).')}</li>
          <li>{tx('Qualquer deck: na Biblioteca, 🖼 deixa escolher uma carta do deck, colar o link de uma imagem ou carregar uma imagem tua.')}</li>
        </ul>
      </details>
      <details className="small"><summary>{tx('TappedOut: favorito para levar os decks (e as imagens)')}</summary>
        <p>{tx('Arrasta este link para a barra de favoritos:')} <a className="bm" ref={el => { if (el) el.setAttribute('href', bookmarklet(origin)) }} onClick={e => e.preventDefault()}>{tx('Grimório: levar decks')}</a>. {tx('Depois abre a tua página de decks no TappedOut')} (tappedout.net/users/<i>{tx('o-teu-nome')}</i>/mtg-decks/) {tx('ou a página de um deck e carrega no favorito: o Grimório abre com esses decks para escolheres. No telemóvel ou tablet: cria um favorito qualquer, edita-o e cola este endereço no lugar do link (copia-o com toque longo).')}</p>
      </details>
    </div>
  )
}
