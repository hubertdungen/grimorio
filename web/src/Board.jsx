// Tabuleiro (repetição e ao vivo), ao estilo de uma mesa digital: aplica os eventos do Forge ao modelo de estado
// (game.js) e anima só o que mudou em cada passo (a carta que entrou/virou/atacou/morreu, a vida que mudou).
// Controlos: pausa, velocidade, passo, salto de turno, linha do tempo com marcas por tipo de evento.
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { img } from './data.js'
import { tokenCard } from './tokens.js'
import { PHASES, replayStates, lookup, isCreature, isLand, powTough, typeOf } from './game.js'

const PH_LABEL = { untap: 'Desvirar', upkeep: 'Manutenção', draw: 'Compra', main1: 'Principal 1', combat: 'Combate', main2: 'Principal 2', end: 'Final' }
const PH_SHORT = { untap: 'Desvirar', upkeep: 'Manut.', draw: 'Compra', main1: 'Princ. 1', combat: 'Combate', main2: 'Princ. 2', end: 'Final' }
const KW = {
  Flying: ['➶', 'Voar'], 'First strike': ['¹', 'Iniciativa (first strike)'], 'Double strike': ['²', 'Golpe duplo'],
  Deathtouch: ['☠', 'Toque mortífero'], Lifelink: ['♥', 'Vínculo com a vida'], Trample: ['⇶', 'Atropelar'],
  Vigilance: ['◉', 'Vigilância'], Haste: ['ϟ', 'Ímpeto'], Hexproof: ['◈', 'Resistência a magia'],
  Indestructible: ['✚', 'Indestrutível'], Menace: ['‼', 'Ameaçar'], Reach: ['↥', 'Alcance'], Infect: ['☣', 'Infetar'],
}
const CT = { '+1/+1': '+1/+1', '-1/-1': '−1/−1', loyalty: 'lealdade', lore: 'capítulo', charge: 'carga', stun: 'atordoamento', shield: 'escudo', oil: 'óleo', time: 'tempo', defense: 'defesa', poison: 'veneno' }
const CT_SHORT = { lore: 'cap.', charge: 'carga', stun: 'atord.', shield: 'escudo', time: 'tempo', defense: 'defesa', oil: 'óleo' }
const PACE = { turn: 2, phase: 0.45, tap: 0.3, untap: 0.3, land: 0.9, cast: 1.2, resolve: 0.8, counter: 1, countered: 0.8, trigger: 0.7, activate: 0.8, attack: 0.9, block: 0.9, damage: 0.8, poison: 0.8, life: 0.6, token: 1, counters: 0.8, pump: 0.7, attach: 0.9, transform: 1.3, destroy: 1, exile: 1, bounce: 1, discard: 0.8, mulligan: 0.8, draw: 0.5, mill: 0.6, search: 0.6, player: 1, goad: 0.8, outcome: 2, other: 0.3 }
// cor da marca na linha do tempo
const MARK = { cast: 'm-cast', land: 'm-land', attack: 'm-atk', block: 'm-atk', damage: 'm-dmg', poison: 'm-dmg', destroy: 'm-die', exile: 'm-die', token: 'm-new', counters: 'm-new', transform: 'm-new', outcome: 'm-end' }
const QUIET = new Set(['other', 'phase'])
const ZN = { hand: 'mão', library: 'biblioteca', graveyard: 'cemitério', exile: 'exílio', battlefield: 'campo', stack: 'pilha', command: 'zona de comando', none: 'fora do jogo' }
const EST = 'Estimativa: este jogo foi gravado antes de o Forge dar as zonas exatas, por isso a posição desta carta foi deduzida do registo.' 
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`
const short = n => String(n || '').split(' // ')[0]

// Frase em português para cada evento (o texto original do Forge fica no título)
function describe(ev, who) {
  if (!ev) return ''
  const P = who[ev.p] || 'Alguém', c = short(ev.card), T = who[ev.target] || short(ev.target)
  switch (ev.k) {
    case 'turn': return `Turno ${ev.t} — ${P}`
    case 'phase': return `Fase: ${PH_LABEL[ev.ph] || ev.ph}`
    case 'mulligan': return ev.card === 'kept' ? `${P} fica com ${plural(ev.n, 'carta', 'cartas')}` : `${P} faz mulligan para ${ev.n}`
    case 'land': return `${P} joga o terreno ${c}${ev.tapped ? ' (entra virado)' : ''}`
    case 'tap': return `${c} vira${ev.txt?.includes('Add') ? ' para dar mana' : ''}`
    case 'untap': return `${c} desvira`
    case 'cast': {  // custo alternativo (Force of Negation, Solitude…): a carta exilada/descartada da mão vem no zn
      const paid = (ev.zn || []).filter(z => z.from === 'hand' && z.card !== ev.card && (z.to === 'exile' || z.to === 'graveyard')).map(z => short(z.card))
      return `${P} lança ${c}${T ? ` → ${T.length > 40 ? 'um feitiço na pilha' : T}` : ''}${paid.length ? ` (paga ${ev.zn.find(z => z.from === 'hand' && z.card !== ev.card).to === 'exile' ? 'exilando' : 'descartando'} ${paid.join(', ')})` : ''}`
    }  // jogos antigos: alvo descrito pelo texto
    case 'trigger': return `Habilidade desencadeada${c ? `: ${c}` : ''}`
    case 'activate': return `${P} ativa ${c}${T ? ` → ${T}` : ''}`
    case 'resolve': return c ? `${c} resolve${ev.pt ? ` (${ev.pt})` : ''}` : 'A habilidade resolve'
    case 'counter': return `${c} anula um feitiço`
    case 'countered': return `Feitiço anulado (vai para o ${ev.to === 'exile' ? 'exílio' : 'cemitério'})`
    case 'attack': return `${c} ataca ${T || ''}`
    case 'block': return `${c} bloqueia ${T}`
    case 'damage': return `${c || 'Dano'}: ${ev.n} de dano a ${T}${ev.psn ? ' (veneno)' : ''}${ev.dt ? ' (toque mortífero)' : ''}`
    case 'poison': return `${T} recebe ${plural(ev.n, 'marcador', 'marcadores')} de veneno`
    case 'life': return `${P}: vida ${ev.n}`
    case 'destroy': return ev.target === 'battlefield>graveyard' ? `${c} vai para o cemitério` : `${c} sai do campo`
    case 'exile': return `${c} é exilada`
    case 'bounce': return `${c} volta para a mão`
    case 'discard': return `${P} descarta ${c}`
    case 'token': return `${P} cria ${ev.n == null ? 'fichas' : ev.n === 1 ? 'uma ficha' : `${ev.n} fichas`} ${short(ev.card).replace(/ Token$/, '')}${ev.pt ? ` ${ev.pt}` : ''}`
    case 'counters': return `${c}: ${ev.n > 0 ? '+' : '−'}${plural(Math.abs(ev.n), 'marcador', 'marcadores')} ${CT[ev.ct] || ev.ct}`
    case 'pump': return ev.all ? `As criaturas de ${P} recebem ${ev.pt} até ao fim do turno` : `${c} recebe ${ev.pt} até ao fim do turno`
    case 'attach': return `${c} fica anexada a ${T}`
    case 'transform': return `${c} transforma-se em ${ev.to}`
    case 'goad': return `${c} fica incitada`
    case 'draw': return ev.card && ev.p === 'a' ? `${P} compra ${c}` : `${P} compra ${plural(ev.n || 1, 'carta', 'cartas')}`
    case 'mill': return ev.card ? `${P}: ${c} da biblioteca para o cemitério` : `${P}: ${plural(ev.n || 1, 'carta', 'cartas')} da biblioteca para o cemitério`
    case 'search': return `${P} procura na biblioteca (${ev.to === 'battlefield' ? 'para o campo' : ev.to === 'hand' ? 'para a mão' : 'para o cemitério'})`
    case 'player': return ev.to === 'monarch' ? `${P} torna-se o monarca` : ev.to === 'initiative' ? `${P} toma a iniciativa` : ev.to === 'emblem' ? `${P} recebe um emblema` : `${P} recebe ${ev.n || 1} de energia`
    case 'outcome': return / has won/.test(ev.txt || '') ? `${P} ganha o jogo` : `${P} perde o jogo`
    default: {
      if (ev.x && ev.target) {  // mudança de zona exata sem frase própria (zone/other)
        const [fr, to] = ev.target.split('>')
        const hidden = ev.p !== 'a' && [fr, to].every(z => z === 'hand' || z === 'library')  // a mão dos adversários não se mostra
        return `${hidden ? 'Uma carta' : c}: ${ZN[fr] || fr} → ${ZN[to] || to}`
      }
      // linhas informativas do Forge (em inglês): traduz as mais comuns
      const t = ev.txt || ''
      let m = t.match(/^.+? (scried|surveiled) (\d+) card\(s\) to the (top|bottom) of the library(?: and (\d+) card\(s\) to the (bottom of the library|graveyard))?/)
      if (m) return `${P}: ${m[1] === 'scried' ? 'vidência' : 'vigiar'} — ${m[2]} para ${m[3] === 'top' ? 'o topo' : 'o fundo'}${m[4] ? `, ${m[4]} para ${m[5] === 'graveyard' ? 'o cemitério' : 'o fundo'}` : ''}`
      m = t.match(/^.+? (scried|surveiled) (\d+) card\(s\) to the (bottom of the library|graveyard)/)
      if (m) return `${P}: ${m[1] === 'scried' ? 'vidência' : 'vigiar'} — ${m[2]} para ${m[3] === 'graveyard' ? 'o cemitério' : 'o fundo'}`
      m = t.match(/^(.+?) enters tapped\.$/)
      if (m) return `${short(m[1])} entra virado`
      m = t.match(/^As (.+?) enters, you may pay (\d+) life\. If you don't, it enters tapped\.$/)
      if (m) return `${short(m[1])}: pagar ${m[2]} de vida ou entrar virado`
      return t
    }
  }
}

// animação de entrada decidida no momento em que o elemento aparece (não volta a correr quando a velocidade muda)
function In({ as, quiet, className = '', ...p }) {
  const [a] = useState(() => !quiet)
  const Tag = as || 'div'
  return <Tag className={`${className}${a ? ' in' : ''}`} {...p} />
}

// arte própria dos decks (ex.: alteradas no TappedOut): arts = {a: {nome: link}, b: …}; k = lado (o Side diz qual);
// sem lado, a de qualquer deck que a tenha. Sem arte própria, a da Scryfall.
const Arts = createContext({ arts: null, k: null })
const artOf = (arts, k, c) => c && arts && (k ? arts[k]?.[c.n] : Object.values(arts).map(x => x?.[c.n]).find(Boolean))
const useImg = () => { const { arts, k } = useContext(Arts); return (c, size, back, side = k) => img(c, size, back, artOf(arts, side, c)) }

// ---------- uma carta no campo ----------
const kwsOf = (c, p) => [...new Set([...(c?.kw || []), ...(p.kw || [])])].filter(k => KW[k])

function Face({ p, c, back, size = 'small' }) {
  const im = useImg()
  if (p.hidden) return <div className="pc-back" />
  if (!c && p.token) c = tokenCard(p.name, p.pt, p.src)
  if (c) return <img src={im(c, size, back && !!c.df)} alt={short(p.face || p.name)} loading="lazy" draggable="false" />
  return (
    <div className="pc-token">
      <small>{p.token ? 'FICHA' : ''}</small>
      <b>{short(p.name).replace(/ Token$/, '')}</b>
      {p.pt && <i>{p.pt}</i>}
    </div>
  )
}

const Perm = memo(function Perm({ p, data, hl, pop, att, n, quiet, tgt }) {  // tgt: [lado, nome] do jogador atacado (3+ jogadores)
  const [enter] = useState(() => !quiet)
  const c = lookup(data, p.name)
  const creature = isCreature(data, p)
  const pt = creature ? powTough(data, p) : null
  const kws = kwsOf(c, p)
  const ctr = Object.entries(p.counters || {}).filter(([k]) => k !== 'loyalty')
  const cls = ['pc', p.tapped && 'tapped', p.attacking && 'atk', p.blocking && 'blk', p.dying && 'dying', p.token && 'tok', hl && `hl${hl}`, p.sick && 'sick', creature && 'cre', enter && 'in'].filter(Boolean).join(' ')
  const title = [short(p.face || p.name), p.sick && 'enjoo de invocação', p.tapped && 'virada'].filter(Boolean).join(' · ')
  return (
    <div className={cls} data-z={`k:${p.key}`} title={title}>
      {att?.length > 0 && <div className="pc-att">{att.map(a => <div key={a.key} className="pc-attc" data-z={`k:${a.key}`}><Face p={a} c={lookup(data, a.name)} /></div>)}</div>}
      <div className="pc-rot">
        <div className={`pc-flip ${p.flipped ? 'on' : ''}`}>
          <div className="pc-f"><Face p={p} c={c} /></div>
          {c?.df ? <div className="pc-b"><Face p={p} c={c} back /></div> : null}
        </div>
      </div>
      <div className="pc-ov">
        {p.damage > 0 && <b className="pc-dmg" title="Dano marcado até ao fim do turno">{p.damage}</b>}
        {pt && <b className={`pc-pt ${pt.boosted ? 'up' : ''} ${pt.hurt ? 'down' : ''}`}>{pt.p}/{pt.t}</b>}
        {p.counters?.loyalty != null && <b key={`l${p.counters.loyalty}`} className="pc-loy" title="Lealdade">{p.counters.loyalty}</b>}
        {ctr.length > 0 && <span className="pc-ctr">{ctr.map(([k, v]) => <b key={`${k}${v}`} title={`${v} ${v === 1 ? 'marcador' : 'marcadores'} ${CT[k] || k}`}>{k === '+1/+1' ? `+${v}` : k === '-1/-1' ? `−${v}` : `${CT_SHORT[k] || (CT[k] || k).slice(0, 5)} ${v}`}</b>)}</span>}
        {kws.length > 0 && <span className="pc-kw">{kws.map(k => <i key={k} title={KW[k][1]}>{KW[k][0]}</i>)}</span>}
        {p.sick && <i className="pc-zz" title="Enjoo de invocação: entrou neste turno">z<sup>z</sup></i>}
        {p.goaded && <i className="pc-goad" title="Incitada">⚑</i>}
        {n > 1 && <b className="pc-n">×{n}</b>}
        {tgt && <i className={`pc-tgt t-${tgt[0]}`} title={`Ataca ${tgt[1]}`}>⚔ {tgt[1]}</i>}
        {(p.est || p.hidden) && <i className="pc-est" title={p.hidden ? 'Estimativa: terreno procurado na biblioteca; o registo deste jogo (antigo) não diz qual.' : EST}>≈</i>}
      </div>
      {pop && !quiet && <i key={pop.i} className={`pc-pop ${pop.kind}`}>{pop.kind === 'flip' ? '⟲' : pop.kind === 'pump' ? pop.pt : `${pop.n > 0 ? '+' : '−'}${Math.abs(pop.n)}`}</i>}
    </div>
  )
})

// fichas e terrenos iguais ficam empilhados (×N); o resto um a um
function groups(perms, groupable) {
  const out = [], by = new Map()
  for (const p of perms) {
    const simple = groupable(p) && !p.attacking && !p.blocking && !p.damage && !p.pump && !Object.keys(p.counters || {}).length && !p.hidden
    const k = simple ? `${p.name}|${p.flipped ? 1 : 0}` : p.key
    if (by.has(k)) by.get(k).items.push(p)
    else { const g = { key: p.key, items: [p] }; by.set(k, g); out.push(g) }
  }
  return out
}

function Row({ perms, data, fx, att, cls, groupable, empty, quiet, who }) {  // who: nomes por lado, só com 3+ jogadores
  const gs = groups(perms, groupable)
  return (
    <div className={`brow ${cls}`}>
      {gs.map(g => (
        <div key={g.key} className={`grp ${g.items.length > 1 ? 'many' : ''}`}>
          {g.items.map((p, j) => <Perm key={p.key} p={p} data={data} hl={fx.hl.has(p.key) ? fx.par : 0} pop={fx.pops.get(p.key) || null} att={att.get(p.key)} n={j === g.items.length - 1 ? g.items.length : 0} quiet={quiet} tgt={who?.[p.attacking] ? [p.attacking, short(who[p.attacking])] : null} />)}
        </div>
      ))}
      {!gs.length && empty && <span className="brow-empty">{empty}</span>}
    </div>
  )
}

// ---------- vida (o número conta até ao valor novo; o anel pisca vermelho/verde) ----------
function Orb({ life, d, step, hit, fast, start }) {
  const ref = useRef(null), prev = useRef(life)
  useEffect(() => {
    const el = ref.current, from = prev.current
    prev.current = life
    if (!el) return
    if (fast || from === life || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.textContent = life; return }
    let raf, t0
    const tick = t => {
      t0 ??= t
      const k = Math.min(1, (t - t0) / 450)
      el.textContent = Math.round(from + (life - from) * k)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.textContent = life }
  }, [life, fast])
  const low = life <= Math.max(5, Math.round(start / 4))
  return (
    <div className={`orb ${low ? 'low' : ''}`} title={`${life} de vida`}>
      <b ref={ref}>{life}</b><small>vida</small>
      {d && !fast ? <i key={step} className={`orb-flash ${d < 0 ? 'loss' : 'gain'}`} /> : null}
      {d && !fast ? <i key={`f${step}`} className={`float ${d < 0 ? 'loss' : 'gain'}`}>{d > 0 ? '+' : '−'}{Math.abs(d)}</i> : null}
      {hit && !fast ? <i key={`h${step}`} className="orb-hit" /> : null}
    </div>
  )
}

function Pile({ label, icon, cards, count, onOpen, data, est, back, quiet }) {  // est: jogo antigo, contagem deduzida
  const top = cards?.length ? cards[cards.length - 1] : null
  const c = top && lookup(data, top), im = useImg()
  const n = count ?? cards?.length ?? 0
  return (
    <button className={`pile ${n ? '' : 'empty'}`} onClick={onOpen} title={`${label}: ${n}${est ? ' (estimativa: o Forge não regista as compras)' : ''}`} disabled={!onOpen}>
      <span className="pile-c">{back || !c ? <span className={n ? 'pc-back' : 'pile-0'} /> : <In as="img" key={`${n}`} quiet={quiet} src={im(c, 'small')} alt={top} />}</span>
      <small>{icon} {n == null ? '?' : `${est ? '≈' : ''}${n}`}</small>
    </button>
  )
}

function Hud({ k, z, name, fmt, s, data, fx, fast, start, openZone, top, hand }) {  // hand: a mão fica nesta linha, ao centro (em baixo a nossa, em cima a do adversário)
  const cmdDmg = Object.entries(z.cmdDmg || {}), im = useImg()
  return (
    <div className={`bhud ${hand ? 'withhand' : ''}`}>
      <Orb life={z.life} d={fx.life?.p === k ? fx.life.d : 0} hit={fx.player?.p === k} step={s.i} fast={fast} start={start} />
      <div className="bname">
        <b title={name}>{name}</b>
        <span className="chips">
          {fmt && <span className="fmt-tag">{fmt}</span>}
          {s.active === k && !z.out && <span className="turnpill">a jogar</span>}
          {z.poison > 0 && <span className="chip psn" title="Marcadores de veneno (10 = derrota)">☠ {z.poison}</span>}
          {z.energy > 0 && <span className="chip" title="Energia">ϟ {z.energy}</span>}
          {z.monarch && <span className="chip gold" title="Monarca: compra uma carta extra no fim do turno">♛ monarca</span>}
          {z.initiative && <span className="chip gold" title="Iniciativa (Masmorra Subterrânea)">⚑ iniciativa</span>}
          {z.emblems.length > 0 && <span className="chip" title={z.emblems.map(short).join(', ')}>✦ {z.emblems.length} emblema{z.emblems.length > 1 ? 's' : ''}</span>}
          {cmdDmg.map(([n, v]) => <span key={n} className={`chip ${v >= 15 ? 'psn' : ''}`} title={`Dano de comandante de ${short(n)} (21 = derrota)`}>⚔ {v}/21</span>)}
          {z.out ? <span className="chip psn">eliminado no turno {z.out}</span> : s.over?.loser === k ? <span className="chip psn">derrota</span> : null}
        </span>
      </div>
      {hand}
      <div className="zones">
        {z.command.map(c => {
          const cc = lookup(data, c.name)
          return (
            <div key={c.name} className={`cmdz ${c.out ? 'out' : ''}`} title={`Zona de comando: ${short(c.name)}${c.casts ? ` · lançado ${c.casts}× · imposto +${2 * c.casts}` : ''}${c.out ? ' (está em jogo ou na pilha)' : ''}`} data-z={`n:${c.name}`}>
              {cc ? <img src={im(cc, 'art_crop')} alt={c.name} /> : <span>{short(c.name)}</span>}
              <small>{c.casts ? `+${2 * c.casts}` : 'cmd'}</small>
            </div>
          )
        })}
        <Pile label="Biblioteca" icon="▤" count={z.library} back est={!s.exact} data={data} />
        {(k !== 'a' || top) && !s.exact && <div className="bhand" title={`${plural(z.hand, 'carta', 'cartas')} na mão${s.exact ? '' : ' (estimativa)'}`}>{Array.from({ length: Math.min(8, z.hand) }).map((_, j) => <span key={j} className="back" />)}<small>✋ {s.exact ? '' : '≈'}{z.hand}</small></div>}
        <Pile label="Cemitério" icon="⚰" cards={z.graveyard} data={data} quiet={fast} onOpen={() => openZone(k, 'graveyard')} />
        <Pile label="Exílio" icon="⌀" cards={z.exile} data={data} quiet={fast} onOpen={() => openZone(k, 'exile')} />
      </div>
    </div>
  )
}

function Side({ k, name, s, data, fx, att, top, fast, start, openZone, hand, compact, who, hit, formats }) {  // hand: a mão vai ao centro da faixa dos terrenos
  const z = s[k]  // compact: um de 3–4 jogadores (cartas mais pequenas); hit: está a ser atacado
  const all = s.sides.flatMap(x => s[x].perms)
  const live = z.perms.filter(p => !p.attachedTo || !all.some(x => x.key === p.attachedTo))
  const creatures = [], lands = [], others = []
  for (const p of live) (isCreature(data, p) ? creatures : isLand(data, p) ? lands : others).push(p)
  const front = <Row perms={creatures} data={data} fx={fx} att={att} cls="front" groupable={p => p.token} empty="sem criaturas" quiet={fast} who={who} />
  const back = (
    <div className="brow rear">
      <Row perms={lands} data={data} fx={fx} att={att} cls="lands" groupable={() => true} quiet={fast} />
      {others.length > 0 && <Row perms={others} data={data} fx={fx} att={att} cls="others" groupable={p => p.token} quiet={fast} />}
    </div>
  )
  const hud = <Hud k={k} z={z} name={name} fmt={formats?.[k]} s={s} data={data} fx={fx} fast={fast} start={start} openZone={openZone} top={top} hand={hand} />
  const { arts } = useContext(Arts), art = useMemo(() => ({ arts, k }), [arts, k])
  return (
    <Arts.Provider value={art}><div className={`bside ${top ? 'top' : 'bottom'} ${s.active === k ? 'act' : ''} ${compact ? 'compact' : ''} ${z.out ? 'out' : ''} ${hit ? 'hit' : ''} p-${k}`}>
      {top ? <>{hud}{back}{front}</> : <>{front}{back}{hud}</>}
    </div></Arts.Provider>
  )
}

// a nossa mão, virada para cima: num jogo exato, a mão verdadeira (o Forge diz cada compra); num jogo antigo,
// as cartas que sabemos que lá estavam + o resto de costas
function Hand({ z, data, quiet, exact, opp, hidden, label }) {  // opp: mão do adversário (jogos exatos; num teste entre bots não há nada a esconder)
  const seen = {}, im = useImg()
  const unknown = Math.max(0, z.hand - z.known.length)
  const n = z.known.length + Math.min(unknown, 10)
  return (
    <div className={`myhand ${exact ? 'exact' : ''} ${opp ? 'opp' : ''}`}>
      <div className="fan">
        {z.known.map((nm, j) => {
          seen[nm] = (seen[nm] || 0) + 1
          const c = lookup(data, nm), rot = (j - (n - 1) / 2) * Math.min(5, 40 / Math.max(1, n))
          if (hidden) return <In key={`${nm}-${seen[nm]}`} quiet={quiet} className="hc unk" style={{ '--r': `${rot}deg` }}><span className="pc-back" /></In>
          return <In key={`${nm}-${seen[nm]}`} quiet={quiet} className="hc" style={{ '--r': `${rot}deg` }} data-z={`n:${nm}`}>{c ? <img src={im(c, 'small')} alt={nm} draggable="false" /> : <span>{short(nm)}</span>}</In>
        })}
        {Array.from({ length: Math.min(unknown, 10) }).map((_, j) => <In key={`u${j}`} quiet={quiet} className="hc unk" style={{ '--r': `${(z.known.length + j - (n - 1) / 2) * Math.min(5, 40 / Math.max(1, n))}deg` }}><span className="pc-back" /></In>)}
      </div>
      {exact
        ? <small className="muted">{label || (opp ? 'Mão do adversário' : 'Mão')} · {plural(z.hand, 'carta', 'cartas')}</small>
        : <small className="muted">Mão ≈{z.hand}{z.known.length ? ` · ${z.known.length} conhecida${z.known.length > 1 ? 's' : ''}` : ''} <i className="est-i" title="Estimativa: este jogo foi gravado antes de o Forge dar as compras; as cartas à vista são as que o jogador joga ou descarta neste turno.">≈</i></small>}
    </div>
  )
}

// ---------- ampliação: rato por cima = pré-visualização; toque/clique = cartão grande ----------
function zoomInfo(z, s, data) {
  if (!z) return null
  if (z.startsWith('k:')) {
    const key = z.slice(2)
    const all = s.sides.flatMap(x => s[x].perms)
    for (const k of s.sides) {
      const p = s[k].perms.find(x => x.key === key)
      if (p) {
        const c = lookup(data, p.name)
        const att = all.filter(x => x.attachedTo === key)
        const host = p.attachedTo && all.find(x => x.key === p.attachedTo)
        const pt = isCreature(data, p) ? powTough(data, p) : null
        const lines = [
          typeOf(data, p),
          pt && `${pt.p}/${pt.t}${p.damage ? ` · ${p.damage} de dano` : ''}`,
          ...Object.entries(p.counters || {}).map(([t, v]) => `${v} ${v === 1 ? 'marcador' : 'marcadores'} ${CT[t] || t}`),
          p.pump && `${p.pump[0] >= 0 ? '+' : ''}${p.pump[0]}/${p.pump[1] >= 0 ? '+' : ''}${p.pump[1]} até ao fim do turno`,
          att.length && `Anexadas: ${att.map(x => short(x.name)).join(', ')}`,
          host && `Anexada a ${short(host.name)}`,
          kwsOf(c, p).map(k => KW[k][1]).join(' · '),
          [p.tapped && 'virada', p.sick && 'enjoo de invocação', p.attacking && 'a atacar', p.blocking && 'a bloquear', p.token && 'ficha', p.goaded && 'incitada'].filter(Boolean).join(' · '),
        ].filter(Boolean)
        return { c: c || (p.token ? tokenCard(p.name, p.pt, p.src) : null), side: k, back: p.flipped && !!c?.df, name: short(p.face || p.name) || 'Terreno', lines, p }
      }
    }
    return null
  }
  const name = z.slice(2)
  const c = lookup(data, name)
  return { c, back: false, name: short(name), lines: c ? [c.t] : [] }
}

function ZoomCard({ info, big }) {
  const im = useImg()
  if (!info) return null
  return (
    <div className={`zoomcard ${big ? 'big' : ''}`}>
      {info.c ? <img src={im(info.c, 'normal', info.back, info.side)} alt={info.name} /> : <div className="pc-token zt"><b>{info.name}</b>{info.p?.pt && <i>{info.p.pt}</i>}</div>}
      <div className="zinfo"><b>{info.name}</b>{info.lines.map((l, j) => <span key={j}>{l}</span>)}</div>
    </div>
  )
}

// ---------- linha do tempo: uma marca por evento importante, riscos nos turnos ----------
const Timeline = memo(function Timeline({ evs, i, onSeek }) {
  const n = Math.max(1, evs.length)
  const marks = useMemo(() => evs.map((e, j) => (MARK[e.k] ? { j, c: MARK[e.k] } : null)).filter(Boolean), [evs])
  const turns = useMemo(() => evs.map((e, j) => (e.k === 'turn' ? { j, t: e.t, p: e.p } : null)).filter(Boolean), [evs])
  const seek = e => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.round(((e.clientX - r.left) / r.width) * n)) }
  return (
    <svg className="tline" viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" onClick={seek} role="img" aria-label="Linha do tempo do jogo">
      {turns.map(x => <rect key={`t${x.j}`} x={x.j} y="0" width={n / 400 + 0.3} height="20" className={`tt ${x.p}`} />)}
      {marks.map(x => <rect key={x.j} x={x.j} y="6" width={Math.max(0.6, n / 300)} height="10" className={x.c} />)}
      <rect x={Math.min(i, n) - n / 300} y="0" width={n / 150} height="20" className="tnow" />
    </svg>
  )
})

// contagem decrescente até ao jogo seguinte (montada só enquanto há para onde avançar)
function Countdown({ secs, onDone }) {
  const [left, setLeft] = useState(secs)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  useEffect(() => {
    if (left <= 0) { done.current(); return }
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return <span className="muted small">próximo jogo em {left} s</span>
}

// next: { has, go, secs, auto } — fila de jogos do Laboratório (sem next: só o resultado)
// Placar: série e sessão; o jogo em curso só conta quando acaba (não estraga o resultado)
const lost = w => !!w && w !== 'a' && w !== 'draw'  // com 3+ jogadores ganha qualquer um dos outros
function Score({ sc, ended, winner, a, b, fa, fb }) {
  const wa = sc.a + (ended && winner === 'a' ? 1 : 0), wb = sc.b + (ended && lost(winner) ? 1 : 0)
  const sw = sc.sw + (ended && winner === 'a' ? 1 : 0), sl = sc.sl + (ended && lost(winner) ? 1 : 0)
  const need = Math.ceil(sc.bo / 2), done = wa >= need || wb >= need
  const lead = wa > wb ? 'a' : wb > wa ? 'b' : ''
  return (
    <div className="score" role="status">
      <span className={`sc-n a ${lead === 'a' ? 'lead' : ''}`} title={a}>{fa}{a}</span>
      <span className={`sc-box ${ended ? 'bump' : ''}`} key={`${wa}-${wb}`}><b className={lead === 'a' ? 'lead' : ''}>{wa}</b><i>–</i><b className={lead === 'b' ? 'lead' : ''}>{wb}</b></span>
      <span className={`sc-n b ${lead === 'b' ? 'lead' : ''}`} title={b}>{fb}{b}</span>
      <span className="sc-meta">
        {sc.bo > 1 ? <>Jogo <b>{sc.g}</b> de {sc.bo} · melhor de {sc.bo} (ganha quem chegar a {need}){done && <> · <b className={wa > wb ? 'ok-t' : 'bad-t'}>série {wa > wb ? 'ganha' : 'perdida'}</b></>}</> : <>Jogo único</>}
        {sc.series > 1 && <> · Série <b>{sc.serie}</b> de {sc.series}</>}
        {sc.total > 1 && <> · Sessão: <b className="ok-t">{sw} V</b> – <b className="bad-t">{sl} D</b> ({sc.k}/{sc.total} jogos)</>}
      </span>
    </div>
  )
}

// Placar de todos contra todos: vitórias (1.º lugar) de cada jogador na sessão e o lugar neste jogo
function ScoreN({ sc, ended, game, who, fm }) {
  const S = Object.keys(sc.wins)
  const w = k => sc.wins[k] + (ended && game.winner === k ? 1 : 0)
  const place = k => (ended && game.places ? game.places.indexOf(k) + 1 : 0)
  const pl = sc.places.concat(ended && game.places ? [game.places.indexOf('a') + 1] : []).filter(Boolean)
  return (
    <div className="score multi" role="status">
      <span className="sc-ps">{S.map(k => <span key={k} className={`sc-p p-${k} ${ended && game.winner === k ? 'lead' : ''}`} title={who[k]}><b>{who[k]}</b>{fm(k)}<i key={w(k)} className={ended && game.winner === k ? 'bump' : ''}>{w(k)}</i>{place(k) ? <small>{place(k)}.º</small> : null}</span>)}</span>
      <span className="sc-meta">{sc.label} · Jogo <b>{sc.k}</b> de {sc.total} · vitórias = 1.º lugar{pl.length > 0 && <> · o teu lugar médio: <b>{(pl.reduce((x, y) => x + y, 0) / pl.length).toFixed(1).replace('.', ',')}.º</b></>}</span>
    </div>
  )
}

export const HANDS = [['ambas', 'Mãos: ambas visíveis'], ['minha', 'Mãos: só a minha'], ['nenhuma', 'Mãos: ambas escondidas']]

export default function Replay({ data, game, onBack, backLabel = '← Relatório', deckName, live = false, next, speed0, onSpeed, hands: hands0, onHands, onPlayFrom, score, arts: arts0, formats }) {  // arts: {a: {nome: link}, b: …} arte própria de cada deck (torneio: game.arts; Laboratório: game.decks); formats: {a: 'Pauper', b: …} (modo casual)
  const art = useMemo(() => ({ arts: arts0 || game.arts || (game.decks && Object.fromEntries(Object.entries(game.decks).map(([k, d]) => [k, d?.art]))), k: null }), [arts0, game]), arts = art.arts
  const [hands, setHandsS] = useState(hands0 || 'ambas')
  // No Coliseu o tabuleiro escala as cartas (--fit) para caber na altura do ecrã: ao abrir, ao redimensionar e em ecrã inteiro
  const boardRef = useRef(null), fitRef = useRef(null)
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el?.closest('.coliseu')) return
    // altura livre = do sítio onde o tabuleiro começa (com a página no topo, ou o ecrã inteiro no topo) até ao fundo do ecrã
    const avail = () => {
      const fe = document.fullscreenElement || document.webkitFullscreenElement, sc = fe?.contains(el) ? fe : null
      const top = el.getBoundingClientRect().top + (sc ? sc.scrollTop - sc.getBoundingClientRect().top : scrollY)
      return (window.visualViewport?.height || innerHeight) - top - 8  // altura visível real (barra do browser no tablet)
    }
    const fit = () => {
      if (innerWidth < 901) return el.style.removeProperty('--fit')
      let f = 1
      el.style.setProperty('--fit', f)
      for (let n = 0; n < 4; n++) { f = Math.max(0.4, Math.min(1.6, f * avail() / el.offsetHeight)); el.style.setProperty('--fit', f) }
    }
    fit()
    fitRef.current = () => {  // segurança: se uma jogada fizer crescer o tabuleiro (terrenos a mudar de linha), só encolhe
      if (innerWidth < 901) return
      const a = avail(), h = el.offsetHeight
      if (h > a + 4) el.style.setProperty('--fit', Math.max(0.4, (+el.style.getPropertyValue('--fit') || 1) * a / h))
    }
    // no tablet o tamanho final chega atrasado (ecrã inteiro, rodar, barra do browser): volta a medir pouco depois
    let tm = []
    const later = () => { fit(); tm.forEach(clearTimeout); tm = [150, 450, 1000].map(t => setTimeout(fit, t)) }
    const evs = ['fullscreenchange', 'webkitfullscreenchange']
    addEventListener('resize', later); addEventListener('orientationchange', later); window.visualViewport?.addEventListener('resize', later)
    evs.forEach(e => document.addEventListener(e, later))
    return () => {
      tm.forEach(clearTimeout); removeEventListener('resize', later); removeEventListener('orientationchange', later)
      window.visualViewport?.removeEventListener('resize', later); evs.forEach(e => document.removeEventListener(e, later))
    }
  }, [game])
  useLayoutEffect(() => { fitRef.current?.() })
  const setHands = v => { setHandsS(v); onHands?.(v) }
  const evs = useMemo(() => game.events || [], [game])
  const [pos, setPos] = useState({ i: 0, jump: true })
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeedS] = useState(speed0 ?? (live ? 3 : 2))
  const setSpeed = v => { setSpeedS(v); onSpeed?.(v) }  // o ritmo escolhido passa para o jogo seguinte
  const [zoom, setZoom] = useState(null)
  const [zone, setZone] = useState(null)
  const logRef = useRef(null)
  const start = game.startLife || 20
  const states = useMemo(() => replayStates(evs, data, start, game.setup || null, !!game.exact), [evs, data, start, game.setup, game.exact])
  const i = Math.min(pos.i, evs.length)
  const go = (n, jump = true) => setPos({ i: Math.max(0, Math.min(evs.length, n)), jump })
  useEffect(() => {
    if (!playing || i >= evs.length) return
    const k = evs[i]?.k
    const t = setTimeout(() => setPos(p => ({ i: Math.min(evs.length, p.i + 1), jump: false })), Math.max(30, (900 / speed) * (PACE[k] ?? 0.7)))
    return () => clearTimeout(t)
  }, [playing, i, speed, evs])
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [i])
  const s = states[i]
  const ended = evs.length > 0 && i >= evs.length && !game.inProgress  // ao vivo: só acaba quando o Forge acaba
  const fast = speed >= 4
  const who = { a: deckName, b: game.opp, ...game.opps }  // opps: {b, c, d} com 3+ jogadores
  const fx = useMemo(() => ({ hl: new Set(s.fx?.keys || []), par: (s.i % 2) + 1, pops: new Map((s.fx?.pops || []).map(x => [x.key, { ...x, i: s.i }])), life: s.fx?.life, player: s.fx?.player }), [s])
  const att = useMemo(() => {
    const m = new Map()
    for (const p of s.sides.flatMap(x => s[x].perms)) if (p.attachedTo) m.set(p.attachedTo, [...(m.get(p.attachedTo) || []), p])
    return m
  }, [s])
  const turns = useMemo(() => [...new Set(evs.map(e => e.t).filter(Boolean))], [evs])
  const ph = PHASES.indexOf(s.phase)
  const openZone = (k, which) => setZone({ k, which })
  const zinfo = zoom && zoomInfo(zoom.z, s, data)
  // ampliação por delegação: um só conjunto de handlers para todas as cartas (as cartas memorizadas não mudam)
  const pType = useRef('mouse')
  const onOver = e => {
    if (e.pointerType !== 'mouse') return
    const el = e.target.closest('[data-z]')
    if (!el) { if (zoom && !zoom.pin) setZoom(null); return }
    if (zoom?.z === el.dataset.z && !zoom.pin) return
    if (!zoom?.pin) setZoom({ z: el.dataset.z, r: el.getBoundingClientRect() })
  }
  const onTap = e => {
    if (pType.current !== 'mouse') return  // no toque, o zoom é com toque longo (onPress)
    const el = e.target.closest('[data-z]')
    if (el) { e.preventDefault(); setZoom({ z: el.dataset.z, pin: true }) }
  }
  const press = useRef(null)
  const onPress = e => {  // toque longo (~0,45 s) numa carta -> zoom; mexer o dedo cancela
    pType.current = e.pointerType
    clearTimeout(press.current?.t)
    const el = e.pointerType !== 'mouse' && e.target.closest('[data-z]')
    if (el) press.current = { x: e.clientX, y: e.clientY, t: setTimeout(() => setZoom({ z: el.dataset.z, pin: true }), 450) }
  }
  const unPress = e => { if (press.current && (e.type !== 'pointermove' || Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10)) { clearTimeout(press.current.t); press.current = null } }
  const hoverStyle = zoom && !zoom.pin && zoom.r ? (() => {
    const W = 230, H = 420, r = zoom.r, vw = window.innerWidth, vh = window.innerHeight
    const left = r.right + W + 14 < vw ? r.right + 10 : Math.max(6, r.left - W - 10)
    return { left, top: Math.max(6, Math.min(vh - H - 6, r.top + r.height / 2 - H / 2)), width: W }
  })() : null
  const zoneCards = zone ? s[zone.k][zone.which] : []
  let ri = i
  while (ri > 0 && QUIET.has(evs[ri - 1].k)) ri--
  const rev = evs[ri - 1]
  const actor = s.sides.includes(rev?.p) ? rev.p : null
  // 3–4 jogadores: adversários em colunas em cima; o parceiro de equipa (game.teams) ao lado do teu deck, em baixo
  const S = s.sides, multi = S.length > 2
  const mates = multi && game.teams ? S.filter(k => k !== 'a' && game.teams[k] === game.teams.a) : []
  const tops = S.filter(k => k !== 'a' && !mates.includes(k))
  const hit = new Set(multi ? S.flatMap(k => s[k].perms.map(p => p.attacking)).filter(x => S.includes(x)) : [])
  const fm = k => (formats?.[k] ? <span className="fmt-tag">{formats[k]}</span> : null)
  const sp = { formats, s, data, fx, att, fast: fast || pos.jump, start, openZone }
  const oppHand = k => game.exact && <Hand z={s[k]} data={data} quiet={fast || pos.jump} exact opp hidden={hands !== 'ambas'} label={mates.includes(k) ? 'Mão do parceiro' : null} />
  return (
    <Arts.Provider value={art}><div ref={boardRef} className={`view board ${live ? 'live' : ''} ${fast ? 'fast' : ''} ${pos.jump ? 'instant' : ''} ${fast || pos.jump ? 'quiet' : ''}`}
      onPointerOver={onOver} onPointerLeave={() => zoom && !zoom.pin && setZoom(null)}
      onPointerDown={onPress} onPointerUp={unPress} onPointerCancel={unPress} onPointerMove={unPress} onClick={onTap} onContextMenu={e => { if (e.target.closest('[data-z]')) e.preventDefault() }}>
      <div className="rp-bar">
        {onBack && <button onClick={onBack}>{backLabel}</button>}
        {score?.wins ? <ScoreN sc={score} ended={ended} game={game} who={who} fm={fm} /> : score ? <Score sc={score} ended={ended} winner={game.winner} a={mates.length ? [deckName, ...mates.map(k => who[k])].join(' + ') : deckName} b={mates.length ? tops.map(k => who[k]).join(' + ') : game.opp} fa={!mates.length && fm('a')} fb={!mates.length && fm('b')} />
          : formats ? <b>{S.map((k, j) => <span key={k}>{j ? (multi ? ' · ' : ' vs ') : ''}{who[k]} {fm(k)}</span>)}</b> : <b>{multi ? S.map(k => who[k]).join(' · ') : `${deckName} vs ${game.opp}`}</b>}
        {live && <span className="livepill">● a jogar</span>}
        {!score && ended && <span className="muted small">jogo {game.g} · {game.winner === 'a' ? 'vitória' : lost(game.winner) ? 'derrota' : 'empate'} no turno {game.turns}</span>}
      </div>
      <div className="rp-ctrl">
        <button onClick={() => go(0)} title="Início" aria-label="Início">⏮</button>
        <button onClick={() => go(i - 1, false)} title="Passo atrás" aria-label="Passo atrás">◀</button>
        <button className="primary" onClick={() => setPlaying(!playing)}>{playing ? '❚❚ Pausa' : '▶ Continuar'}</button>
        <button onClick={() => go(i + 1, false)} title="Passo à frente" aria-label="Passo à frente">▶</button>
        <button onClick={() => go(evs.length)} title={live ? 'Ir para o momento atual' : 'Fim'} aria-label="Fim">⏭</button>
        <label className="sl rp-speed"><span>Velocidade <b>{speed}×</b></span><input type="range" min="0.5" max="8" step="0.5" value={speed} onChange={e => setSpeed(+e.target.value)} /></label>
        {onPlayFrom && !live && !multi && <button onClick={() => { setPlaying(false); onPlayFrom(s, game) }} title="Abre esta posição no Forge e jogas tu com o teu deck">🎮 Jogar daqui</button>}
        <select value={hands} onChange={e => setHands(e.target.value)} aria-label="Mãos à vista">{HANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={s.turn || ''} onChange={e => go(evs.findIndex(x => x.t === +e.target.value))} aria-label="Ir para o turno">{turns.map(t => <option key={t} value={t}>Turno {t}</option>)}</select>
        <div className="rp-time">
          <Timeline evs={evs} i={i} onSeek={n => { setPlaying(false); go(n) }} />
          <input type="range" className="rp-scrub" min="0" max={evs.length} value={i} onChange={e => { setPlaying(false); go(+e.target.value) }} aria-label="Posição no jogo" />
        </div>
        <span className="muted small">{i}/{evs.length}</span>
      </div>
      <div className="bwrap">
        <div className={`table ${multi ? 'multi' : ''}`}>
          {multi
            ? <div className="opps" style={{ '--np': tops.length }}>{tops.map(k => <Side key={k} k={k} name={who[k]} {...sp} top compact who={who} hit={hit.has(k)} hand={oppHand(k)} />)}</div>
            : <Side k="b" name={game.opp} {...sp} top hand={oppHand('b')} />}
          <div className="bmid">
            <div className="phases" style={{ '--n': PHASES.length, '--x': Math.max(0, ph) }}>
              <span className="turnno">T{s.turn || 0}</span>
              <div className="phtrack">
                {ph >= 0 && <i className={`phmark ${s.active || ''}`} />}
                {PHASES.map((x, j) => <span key={x} className={j === ph ? 'on' : j < ph ? 'past' : ''} title={PH_LABEL[x]}>{PH_SHORT[x]}</span>)}
              </div>
            </div>
            <div className="stack" title="Pilha">
              {s.stack.map((x, j) => {
                const c = lookup(data, x.card)
                return <In key={x.uid} quiet={fast || pos.jump} className={`stk ${x.p || ''} ${x.kind}`} style={{ '--j': j }} data-z={x.card ? `n:${x.card}` : undefined} title={`${x.kind === 'cast' ? 'Feitiço' : 'Habilidade'}: ${short(x.card) || '?'}${x.target ? ` → ${short(x.target)}` : ''}`}>
                  {c ? <img src={img(c, x.kind === 'cast' ? 'small' : 'art_crop', false, artOf(arts, x.p, c))} alt={x.card} /> : <span>{short(x.card) || 'habilidade'}</span>}
                </In>
              })}
            </div>
            <div className={`ribbon ${actor ? `by-${actor}` : ''} k-${rev?.k || ''}`} aria-live="polite">
              <span key={ri}>{actor && <i className="arrow">{actor === 'a' || mates.includes(actor) ? '▼' : '▲'}</i>}{rev ? describe(rev, who) : live ? 'À espera do Forge…' : 'O jogo vai começar…'}</span>
            </div>
          </div>
          {(() => {
            const me = <Side k="a" name={deckName} {...sp} who={multi ? who : null} hit={hit.has('a')} hand={<Hand z={s.a} data={data} quiet={fast || pos.jump} exact={!!game.exact} hidden={hands === 'nenhuma'} />} />
            return mates.length ? <div className="mine withmate">{me}{mates.map(k => <Side key={k} k={k} name={who[k]} {...sp} compact who={who} hit={hit.has(k)} hand={oppHand(k)} />)}</div> : me
          })()}
          {ended && (
            <div className={`endbanner ${game.winner === 'a' ? 'win' : lost(game.winner) ? 'loss' : 'draw'}`} role="status">
              <b>{game.winner === 'a' ? `Vitória${mates.length ? ' da equipa' : ''} no turno ${game.turns}` : !lost(game.winner) ? 'Empate' : mates.length ? `Derrota da equipa no turno ${game.turns}` : multi ? `${game.places ? `${game.places.indexOf('a') + 1}.º lugar` : 'Derrota'}${s.a.out ? ` — eliminado no turno ${s.a.out}` : ''}` : `Derrota no turno ${game.turns}`}</b>
              {multi && game.places && !mates.length && <span>{game.places.map((k, j) => `${j + 1}.º ${short(who[k])}`).join(' · ')}</span>}
              <span>Vida final: {S.map(k => `${who[k]} ${s[k].life}`).join(' · ')}</span>
              <span className="row-btns">
                {next?.has && playing && next.auto && <Countdown key={`${game.g}-${next.secs}`} secs={next.secs} onDone={next.go} />}
                <button onClick={() => go(0)}>⏮ ver de novo</button>
                {next?.has && <button className="primary" onClick={next.go}>seguinte ▶</button>}
                {!next?.has && live && <span className="muted small">o próximo jogo ainda está a ser jogado…</span>}
              </span>
            </div>
          )}
        </div>
        <ol className="blog" ref={logRef}>
          {evs.slice(Math.max(0, i - 60), i).map((e, k) => {
            const j = Math.max(0, i - 60) + k
            return <li key={j} className={`p-${e.p || ''} k-${e.k} ${j === i - 1 ? 'now' : ''}`} title={e.txt} onClick={() => { setPlaying(false); go(j + 1) }}>{describe(e, who)}</li>
          })}
        </ol>
      </div>
      {hoverStyle && zinfo && <div className="zoomhover" style={hoverStyle}><ZoomCard info={zinfo} /></div>}
      {zoom?.pin && zinfo && <div className="zoomover" onClick={e => { e.stopPropagation(); setZoom(null) }}><ZoomCard info={zinfo} big /></div>}
      {zone && (
        <div className="zoomover zonelist" onClick={e => { if (e.target === e.currentTarget) setZone(null) }}>
          <div className="zl-box">
            <div className="row-btns"><b>{zone.which === 'graveyard' ? 'Cemitério' : 'Exílio'} de {who[zone.k]} · {zoneCards.length}</b><button onClick={() => setZone(null)}>Fechar</button></div>
            <div className="zl-grid">{zoneCards.map((n, j) => { const c = lookup(data, n); return <div key={j} className="zl-c" data-z={n ? `n:${n}` : undefined} title={n || 'Carta desconhecida (o Forge não diz qual)'}>{c ? <img src={img(c, 'small', false, artOf(arts, zone.k, c))} alt={n} /> : <span className="pc-back" />}</div> })}</div>
            {zoneCards.includes(null) && <p className="muted small">As cartas de costas foram para lá sem o Forge dizer quais (vigiar, moer, procurar).</p>}
          </div>
        </div>
      )}
    </div></Arts.Provider>
  )
}
