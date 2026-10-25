// Modelo de estado do jogo (puro e serializável): a repetição aplica os eventos do Forge (sim.py, parse_game)
// um a um; no futuro, jogadas humanas usam o mesmo modelo. Nada aqui toca no DOM nem no React.
//
// O Forge não regista compras, a mão, o desvirar nem as mortes por dano letal: isso é inferido aqui, com honestidade
// (campos *Est / est marcam o que é estimativa):
// - desvirar e enjoo de invocação: no início do turno de cada jogador; dano, +X/+X e combate limpam no fim do turno;
// - compra do passo de compra: 1 por turno (exceto o 1.º turno do jogo); biblioteca = tamanho do deck − mão inicial;
// - mão conhecida: cartas que o jogador vai jogar/descartar neste turno (turn.reveal) — estavam lá de certeza;
// - morte por dano: dano ≥ resistência e o Forge nunca mais a mostra em jogo (damage.gone), ou toque mortífero;
// - marcadores ao entrar (Modular N, "enters with N … counters", lealdade inicial) lidos do texto da carta.
//
// Jogos exatos (game.exact: o nosso lançador do Forge, sim.py) trazem a verdade e nada disto é estimado:
// ev.hd {a: [nomes]} = a mão depois do evento, ev.lib = a biblioteca, ev.zn = mudanças de zona do Forge
// (id, de/para, de quem), turn.ut = o que desvirou, e tap/untap/counters/attach com x: 1. Aí os eventos do
// registo só animam a pilha e o combate; as zonas mudam só pelo zn.

import { tx } from './i18n.js'

export const PHASES = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end']
const N = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

// lados: 'a' (o teu deck) e 'b' num jogo a dois; com mais jogadores (setup.c / setup.d) também 'c' e 'd'
export const sidesOf = setup => ['a', 'b', ...['c', 'd'].filter(k => setup?.[k])]

export function initialState(life = 20, setup = null) {
  const sides = sidesOf(setup)
  const side = k => {
    const cmd = setup?.[k]?.commanders || []
    const size = setup?.[k]?.size
    return {
      life, poison: 0, energy: 0, monarch: false, initiative: false, emblems: [],
      hand: 7, known: [], library: size ? size - 7 : null, perms: [], graveyard: [], exile: [],
      command: cmd.map(name => ({ name, casts: 0, out: false })), cmdDmg: {},
    }
  }
  return { i: 0, turn: 0, active: null, phase: null, first: null, sides, ...Object.fromEntries(sides.map(k => [k, side(k)])), stack: [], seq: 0, last: null, fx: null, over: null }
}

export const lookup = (data, n) => (n ? data.byName.get(n) || data.byLower.get(String(n).toLowerCase()) : null)
const faces = n => String(n || '').split(' // ')
export const typeOf = (data, perm) => {
  const c = lookup(data, perm.name)
  const tl = c ? c.t.split(' // ')[perm.flipped && c.t.includes(' // ') ? 1 : 0] : ''
  return tl || (perm.token ? (perm.pt ? tx('Ficha de criatura') : tx('Ficha')) : '')
}
export const isCreature = (data, perm) => perm.crewed || /Creature/.test(typeOf(data, perm)) || (perm.token && !!perm.pt)
export const isLand = (data, perm) => perm.land || /\bLand\b/.test(typeOf(data, perm))

// P/R atual: base (do Forge ou da carta) + marcadores +1/+1 e −1/−1 + efeitos até ao fim do turno
export function powTough(data, perm) {
  const c = lookup(data, perm.name)
  const base = perm.pt || (c && /\//.test(c.pt) ? c.pt : null)
  if (!base) return null
  let [p, t] = base.split('/').map(x => parseInt(x, 10))
  if (Number.isNaN(p) || Number.isNaN(t)) return null
  const k = perm.counters || {}
  const plus = (k['+1/+1'] || 0) - (k['-1/-1'] || 0)
  p += plus + (perm.pump?.[0] || 0); t += plus + (perm.pump?.[1] || 0)
  return { p, t, boosted: plus > 0 || perm.pump?.[0] > 0 || perm.pump?.[1] > 0, hurt: plus < 0 || perm.pump?.[0] < 0 || perm.pump?.[1] < 0 }
}

function etbCounters(c) {
  const out = {}
  if (!c) return out
  const o = c.o.split('\n//\n')[0]
  const mod = o.match(/Modular (\d+)/)
  if (mod) out['+1/+1'] = +mod[1]
  const w = o.match(/enters(?: the battlefield)? with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([+-]\d\/[+-]\d|[a-z]+) counters? on/)
  if (w) out[w[2]] = (out[w[2]] || 0) + (N[w[1]] || +w[1] || 0)
  if (/Planeswalker/.test(c.t.split(' // ')[0]) && /^\d+$/.test(c.pt)) out.loyalty = +c.pt
  if (/Saga/.test(c.t)) out.lore = 1
  return out
}

// habilidade de lealdade usada: a linha do texto da carta com mais palavras em comum com o texto da resolução
function loyaltyCost(c, txt) {
  if (!c) return null
  const abil = c.o.split('\n').map(l => l.match(/^([+−-]?\d+|[+−-]X): (.*)$/)).filter(Boolean)
  if (!abil.length) return null
  const words = s => new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.map(w => w.slice(0, 5)) || [])
  const tw = words(txt)
  let best = null, bs = -1
  for (const a of abil) { const sc = [...words(a[2])].filter(w => tw.has(w)).length; if (sc > bs) { bs = sc; best = a } }
  const v = parseInt(best[1].replace('−', '-'), 10)
  return Number.isNaN(v) ? null : v
}

export function applyEvent(s0, ev, data) {
  const S = s0.sides || ['a', 'b']
  const s = { ...s0, ...Object.fromEntries(S.map(k => [k, { ...s0[k] }])), last: ev, i: s0.i + 1, fx: { keys: [], pops: [] } }
  const fx = s.fx
  const other = p => (S.length === 2 ? (p === 'a' ? 'b' : 'a') : null)  // com 3+ jogadores não há «o outro»
  const X = s.exact
  // o que morreu no passo anterior já fez a animação de saída
  for (const k of S) if (s[k].perms.some(x => x.dying)) s[k].perms = s[k].perms.filter(x => !x.dying)
  const look = n => lookup(data, n)
  const upd = (k, key, fn) => { s[k].perms = s[k].perms.map(x => (x.key === key ? fn({ ...x }) : x)) }
  const touch = (key, pop) => { if (key && !fx.keys.includes(key)) fx.keys.push(key); if (pop) fx.pops.push({ key, ...pop }) }
  const find = (id, name, pref, filt = () => true) => {
    if (id != null) for (const k of S) { const x = s[k].perms.find(y => y.fid === id && !y.dying); if (x) return [k, x] }
    if (!name) return null
    const order = pref ? [pref, ...S.filter(k => k !== pref)] : S
    for (const k of order) {
      const ok = s[k].perms.filter(y => !y.dying && y.name === name && (id == null || y.fid == null) && filt(y))
      if (ok.length) return [k, ok[0]]
    }
    return null
  }
  const make = (k, name, extra = {}) => {
    const c = look(name)
    const perm = {
      key: `${k}${++s.seq}`, fid: null, name, tapped: false, counters: extra.token ? {} : etbCounters(c), damage: 0, pump: null,
      token: false, flipped: false, attacking: null, blocking: null, sick: false, attachedTo: null, pt: null, kw: null, ...extra,
    }
    if (extra.sick == null) perm.sick = !perm.land && isCreature(data, perm) && !(c?.kw || perm.kw || []).includes('Haste')
    s[k].perms = [...s[k].perms, perm]
    s.ent = [...(s.ent || []), [k, perm.key]]  // entrou desde o último feitiço/habilidade (ver «tapped and attacking»)
    touch(perm.key)
    return perm
  }
  // garante que a permanente existe (o Forge mostra-a em jogo): adota uma sem id com o mesmo nome, ou cria-a
  const ensure = (id, name, pref, extra = {}) => {
    const f = find(id, name, pref)
    if (f) {
      if (id != null && f[1].fid == null) { upd(f[0], f[1].key, x => ({ ...x, fid: id })); return [f[0], { ...f[1], fid: id }] }
      return f
    }
    if (!name || X) return null  // exato: tudo o que está em jogo veio do Forge (zn); não se inventam cartas
    const k = pref || 'a'
    const c = look(name)
    // terreno procurado na biblioteca (fetch): o Forge só o nomeia quando dá mana
    if (c && /\bLand\b/.test(c.t.split(' // ')[0])) {
      const ph = s[k].perms.find(y => y.hidden)
      if (ph) { upd(k, ph.key, x => ({ ...x, hidden: false, name, fid: id ?? null })); touch(ph.key); return [k, { ...ph, name, fid: id }] }
    }
    return [k, make(k, name, { fid: id ?? null, est: true, sick: false, land: !!(c && /\bLand\b/.test(c.t.split(' // ')[0])), ...extra })]
  }
  const toZone = (k, name, zone, token) => {
    if (token || !k) return
    const z = s[k]
    const cmd = z.command.find(c => c.name === name)
    if (cmd && (zone === 'graveyard' || zone === 'exile')) { z.command = z.command.map(c => (c.name === name ? { ...c, out: false } : c)); return }
    if (zone === 'graveyard') z.graveyard = [...z.graveyard, name]
    else if (zone === 'exile') z.exile = [...z.exile, name]
    else if (zone === 'hand') { z.hand += 1; z.known = [...z.known, name] }
    else if (zone === 'library' && z.library != null) z.library += 1
  }
  const leave = (k, perm, zone, to = zone) => {  // zone null: só sai do campo (exato: a pilha de destino muda no zn)
    upd(k, perm.key, x => ({ ...x, dying: to }))
    touch(perm.key)
    // auras caem com a criatura; equipamentos ficam soltos
    for (const kk of S) for (const x of s[kk].perms) if (x.attachedTo === perm.key) {
      const isAura = !X && /Aura/.test(look(x.name)?.t || '')  // exato: a aura sai pela sua própria mudança de zona
      if (isAura) { upd(kk, x.key, y => ({ ...y, dying: 'graveyard' })); toZone(kk, x.name, 'graveyard', x.token) } else upd(kk, x.key, y => ({ ...y, attachedTo: null }))
    }
    toZone(k, perm.name, zone, perm.token)
  }
  const handOut = (k, name) => {
    const z = s[k]
    z.hand = Math.max(0, z.hand - 1)
    const j = z.known.indexOf(name)
    if (j >= 0) z.known = z.known.filter((_, x) => x !== j)
  }
  // mudança de zona exata do Forge: sai de onde estava (campo, cemitério, exílio, comando) e entra onde vai;
  // a mão e a biblioteca vêm inteiras em ev.hd / ev.lib
  const moveExact = z => {
    if (z.from === 'battlefield') { const f = find(z.id, null); if (f) leave(f[0], f[1], null, z.to) }
    else if ((z.from === 'graveyard' || z.from === 'exile') && s[z.fp]) {
      const pile = s[z.fp][z.from], j = pile.lastIndexOf(z.card)
      if (j >= 0) s[z.fp][z.from] = pile.filter((_, x) => x !== j)
    }
    if (z.to === 'battlefield' && s[z.tp] && !find(z.id, null)) {
      const c = look(z.card), host = z.att != null ? find(z.att, null) : null
      make(z.tp, z.card, { src: z.tok ? ev.card || s.stack.at(-1)?.card : undefined, fid: z.id, token: !!z.tok, pt: z.pt || null, kw: z.kw || null, counters: { ...z.ctr }, land: !!(c && /\bLand\b/.test(c.t.split(' // ')[0])), attachedTo: host ? host[1].key : null })
    } else if ((z.to === 'graveyard' || z.to === 'exile') && s[z.tp] && !z.tok) s[z.tp][z.to] = [...s[z.tp][z.to], z.card]
    for (const [k, out] of [[z.fp, false], [z.tp, true]]) {
      const zone = out ? z.to : z.from
      if (zone === 'command' && s[k]) s[k].command = s[k].command.map(c => (c.name === z.card ? { ...c, out: !out } : c))
    }
  }
  const me = S.includes(ev.p) ? ev.p : null
  if (ev.k === 'cast' || ev.k === 'trigger' || ev.k === 'activate') s.ent = []

  switch (ev.k) {
    case 'turn': {
      s.turn = ev.t; s.active = ev.p; s.phase = 'untap'; s.phn = (s.phn || 0) + 1
      if (s.stack.length) s.stack = []
      if (s.first == null) s.first = ev.p
      const ut = new Set(ev.ut || [])
      for (const k of S) {
        s[k].perms = s[k].perms.map(x => {
          const mine = k === ev.p
          const untap = mine && x.tapped && (!X || ut.has(x.fid))  // exato: só o que o Forge desvirou
          const lore = !X && mine && x.counters?.lore != null
          if (!x.damage && !x.pump && !x.attacking && !x.blocking && !x.crewed && !x.deathtouched && !untap && !(mine && x.sick) && !(x.goaded && x.goaded === ev.p) && !lore) return x
          const y = { ...x, damage: 0, pump: null, attacking: null, blocking: null, crewed: false, deathtouched: false }
          if (mine) y.sick = false
          if (untap) y.tapped = false
          if (y.goaded === ev.p) y.goaded = null
          if (lore && s.turn > 1) y.counters = { ...x.counters, lore: x.counters.lore + 1 }
          return y
        })
      }
      if (X) break
      // quem acabou o turno ficou com 7 ou menos (o Forge regista as descartas da limpeza): corrige a estimativa
      if (me && s0.active && s0.active !== me) { const z = s[s0.active]; z.hand = Math.min(z.hand, Math.max(7, z.known.length)) }
      if (me && ev.t > 1) { const z = s[me]; z.hand += 1; if (z.library != null) z.library -= 1 }
      for (const [k, names] of Object.entries(ev.reveal || {})) if (s[k]) {
        const z = s[k]
        z.known = [...z.known, ...names]
        z.hand = Math.max(z.hand, z.known.length)
      }
      break
    }
    // a pilha esvazia antes de a fase avançar; o Forge às vezes não regista o «resolve» (ex.: Solitude) e a carta
    // ficava no meio da mesa o jogo todo. O que sobrevive a uma fase inteira sai (o registo às vezes chega um passo
    // atrasado, por isso não à primeira); no turno seguinte a pilha começa vazia
    case 'phase': s.phase = ev.ph; s.phn = (s.phn || 0) + 1; if (s.stack.some(x => x.ph < s.phn - 1)) s.stack = s.stack.filter(x => x.ph >= s.phn - 1); break
    case 'mulligan': if (me && ev.n && !X) { const z = s[me]; if (z.library != null) z.library += z.hand - ev.n; z.hand = ev.n } break
    case 'land': if (me && !X) {
      handOut(me, ev.card)
      const f = ev.id != null && find(ev.id, null)
      if (!f) make(me, ev.card, { fid: ev.id ?? null, land: true, tapped: !!ev.tapped, flipped: !!ev.bk })
      break
    } break
    case 'tap': case 'untap': {
      const f = ev.x ? find(ev.id, null) : ensure(ev.id, ev.card, me)
      if (f) { upd(f[0], f[1].key, x => ({ ...x, tapped: ev.k === 'tap' })); touch(f[1].key) }
      break
    }
    case 'cast': if (me) {
      const z = s[me]
      const cmd = z.command.find(c => c.name === ev.card && !c.out)
      if (cmd) z.command = z.command.map(c => (c === cmd ? { ...c, casts: c.casts + 1, out: true } : c))
      else if (!X) handOut(me, ev.card)
      s.stack = [...s.stack, { uid: ++s.seq, p: me, card: ev.card, kind: 'cast', target: ev.target, ph: s.phn || 0 }]
      break
    } break
    case 'trigger': case 'activate': {
      s.stack = [...s.stack, { uid: ++s.seq, p: me, card: ev.card, kind: ev.k, target: ev.target, ph: s.phn || 0 }]
      if (ev.k === 'activate' && me && ev.card) {
        const f = find(ev.id, ev.card, me)
        const c = look(ev.card)
        if (f && c) {
          const costs = c.o.split('\n').map(l => l.match(/^([^:"]{1,60}):/)?.[1]).filter(x => x && !/^[+−-]?[\dX]+$/.test(x) && !/Add \{/.test(x))
          if (/Vehicle/.test(c.t)) { upd(f[0], f[1].key, x => ({ ...x, crewed: true, sick: false })); touch(f[1].key) }
          else if (costs.length && costs.every(x => x.includes('{T}'))) { upd(f[0], f[1].key, x => ({ ...x, tapped: true })); touch(f[1].key) }
        }
      }
      break
    }
    case 'resolve': case 'counter': {
      let j = -1
      for (let x = s.stack.length - 1; x >= 0; x--) if (ev.card ? s.stack[x].card === ev.card : s.stack[x].kind !== 'cast') { j = x; break }
      const top = j >= 0 ? s.stack[j] : null
      if (top) s.stack = s.stack.filter((_, x) => x !== j)
      const owner = top?.p || me
      if (top?.kind === 'cast' && owner && !X) {
        const c = look(top.card)
        const tl = c ? c.t.split(' // ')[0] : ''
        if (ev.k === 'resolve' && (/Creature|Artifact|Enchantment|Planeswalker|Battle|Land/.test(tl) || ev.pt)) {
          const ex = find(ev.id, null)
          if (!ex) make(owner, top.card, { fid: ev.id ?? null, pt: ev.pt || null })
        } else toZone(owner, top.card, 'graveyard')
      }
      // reanimar/recuperar em jogos antigos (Persist, Unearth…): o Forge só o diz no texto da resolução
      const rm = !X && /Return (.+?) \((\d+)\) from (?:\w+(?:'s)? )?graveyard to (?:\w+(?:'s)? )?(battlefield|hand)/.exec(ev.txt || '')
      if (rm) {
        const [, name, fid, dest] = rm
        const k = S.find(q => s[q].graveyard.includes(name)) || (s[owner]?.graveyard.includes(null) ? owner : null)
        if (k) {
          const gy = [...s[k].graveyard]; gy.splice(gy.lastIndexOf(gy.includes(name) ? name : null), 1); s[k].graveyard = gy
        }
        const to = k || owner
        if (dest === 'hand') { if (to) toZone(to, name, 'hand') } else if (to && !find(+fid, null)) make(owner || to, name, { fid: +fid })
      }
      // lealdade: a habilidade do planeswalker resolve agora (o Forge não diz o custo; lê-se do texto da carta)
      if (top?.kind === 'activate' && ev.card && !X) {
        const f = find(ev.id, ev.card, owner)
        if (f && f[1].counters?.loyalty != null) {
          const d = loyaltyCost(look(ev.card), ev.txt || '')
          if (d) { upd(f[0], f[1].key, x => ({ ...x, counters: { ...x.counters, loyalty: Math.max(0, x.counters.loyalty + d) } })); touch(f[1].key, { n: d, kind: 'loyalty' }) }
        }
      }
      break
    }
    case 'countered': {
      if (s.stack.length >= 2) {
        const j = s.stack.length - 2, x = s.stack[j]
        s.stack = s.stack.filter((_, y) => y !== j)
        if (x.kind === 'cast' && !X) toZone(x.p, x.card, ev.to === 'exile' ? 'exile' : 'graveyard')
      }
      break
    }
    case 'attack': {
      const f = ensure(ev.id, ev.card, me)
      if (f) {
        const vig = (look(ev.card)?.kw || f[1].kw || []).includes('Vigilance')
        upd(f[0], f[1].key, x => ({ ...x, attacking: ev.tid != null ? `#${ev.tid}` : ev.target || other(f[0]) || true, tapped: vig ? x.tapped : true, sick: false }))
        touch(f[1].key)
        const pw = ev.tid != null && find(ev.tid, ev.target)  // planeswalker ou batalha atacada
        if (pw) touch(pw[1].key)
      }
      break
    }
    case 'block': {
      const att = ev.tid != null ? find(ev.tid, ev.target) : null
      const f = ensure(ev.id, ev.card, me)
      if (f) { upd(f[0], f[1].key, x => ({ ...x, blocking: att ? att[1].key : true })); touch(f[1].key); if (att) touch(att[1].key) }
      break
    }
    case 'damage': {
      const src = ev.combat && ev.id != null ? ensure(ev.id, ev.card, me) : find(ev.id, ev.card, me)
      if (src) touch(src[1].key)
      if (S.includes(ev.target)) {
        fx.player = { p: ev.target, n: ev.n, psn: !!ev.psn }
        const z = s[ev.target]
        if (S.some(k => k !== ev.target && s[k].command.some(c => c.name === ev.card)) && ev.combat) z.cmdDmg = { ...z.cmdDmg, [ev.card]: (z.cmdDmg[ev.card] || 0) + ev.n }
      } else if (ev.tid != null || ev.target) {
        const t = ensure(ev.tid, ev.target, me ? other(me) : null)
        if (!t) break
        const [k, x] = t
        if (x.counters?.loyalty != null && !isCreature(data, x)) {
          const loy = X ? x.counters.loyalty : Math.max(0, x.counters.loyalty - ev.n)  // exato: o Forge tira os marcadores
          upd(k, x.key, y => ({ ...y, counters: { ...y.counters, loyalty: loy } }))
          touch(x.key, { n: -ev.n, kind: 'dmg' })
          if (loy <= 0 && ev.gone) leave(k, x, 'graveyard')
          break
        }
        const dmg = (x.damage || 0) + ev.n
        upd(k, x.key, y => ({ ...y, damage: dmg, deathtouched: y.deathtouched || !!ev.dt }))
        touch(x.key, { n: -ev.n, kind: 'dmg' })
        const pt = powTough(data, x)
        const indestr = (look(x.name)?.kw || []).includes('Indestructible')
        if (ev.gone && !indestr && (ev.dt || !pt || dmg >= pt.t)) leave(k, { ...x }, 'graveyard')
      }
      break
    }
    case 'poison': if (S.includes(ev.target)) { s[ev.target].poison += ev.n || 0; fx.player = { p: ev.target, n: ev.n, psn: true } } break
    case 'life': if (me && ev.n != null) { const z = s[me]; fx.life = { p: me, d: ev.n - z.life }; z.life = ev.n } break
    case 'destroy': case 'exile': case 'bounce': case 'other': {
      const m = !ev.x && /^battlefield>(\w+)$/.exec(ev.target || '')
      if (!m) break
      const zone = m[1]
      const f = find(ev.id, ev.card, me)
      if (f) leave(f[0], f[1], zone)
      else toZone(me, ev.card, zone, /\bToken$/.test(ev.card || ''))
      break
    }
    case 'discard': if (me && !X) { handOut(me, ev.card); toZone(me, ev.card, 'graveyard') } break
    case 'token': if (me && !ev.x && !/^(?!.*\bcreate).*\bCounter target\b/i.test((ev.txt || '').split('(Targeting:')[0])) {  // jogos antigos: o texto do alvo anulado não cria fichas
      for (let x = 0; x < Math.min(ev.n || 0, 40); x++) make(me, ev.card, { token: true, pt: ev.pt || null, kw: ev.kw || null, src: ev.src || s.stack.at(-1)?.card })
      break
    } break
    case 'counters': {
      const f = ev.x ? find(ev.id, null) : ev.card || ev.id != null ? ensure(ev.id, ev.card, me) : null
      if (f) {
        upd(f[0], f[1].key, x => {
          const c = { ...x.counters, [ev.ct]: ev.abs ?? (x.counters?.[ev.ct] || 0) + ev.n }
          if (c[ev.ct] <= 0) delete c[ev.ct]
          return { ...x, counters: c }
        })
        touch(f[1].key, { n: ev.n, kind: 'ctr', ct: ev.ct })
      }
      break
    }
    case 'pump': {
      const add = (ev.pt || '+0/+0').split('/').map(x => parseInt(x, 10) || 0)
      const apply = (k, x) => { upd(k, x.key, y => ({ ...y, pump: [(y.pump?.[0] || 0) + add[0], (y.pump?.[1] || 0) + add[1]] })); touch(x.key, { kind: 'pump', pt: ev.pt }) }
      if (ev.all && me) { for (const x of s[me].perms) if (!x.dying && isCreature(data, x)) apply(me, x) } else {
        const f = ensure(ev.id, ev.card, me)
        if (f) apply(f[0], f[1])
      }
      break
    }
    case 'attach': {
      const src = ev.x ? find(ev.id, null) : ensure(ev.id, ev.card, me)
      const tg = ev.x ? find(ev.tid, null) : ensure(ev.tid, ev.target, null)
      if (src && tg) { upd(src[0], src[1].key, x => ({ ...x, attachedTo: tg[1].key })); touch(src[1].key); touch(tg[1].key) }
      break
    }
    case 'transform': {
      const f = ensure(ev.id, ev.card, me)
      if (f) {
        const fs = faces(look(ev.card)?.n || ev.card)
        upd(f[0], f[1].key, x => ({ ...x, flipped: fs.length > 1 ? ev.to === fs[1] : !x.flipped, face: ev.to }))
        touch(f[1].key, { kind: 'flip' })
      }
      break
    }
    case 'goad': { const f = find(ev.id, ev.card, null); if (f) { upd(f[0], f[1].key, x => ({ ...x, goaded: s.active })); touch(f[1].key) } break }
    case 'draw': if (me && !ev.x) { const z = s[me]; z.hand += ev.n || 1; if (z.library != null) z.library = Math.max(0, z.library - (ev.n || 1)) } break
    case 'search': if (me) {
      const z = s[me]
      if (z.library != null) z.library = Math.max(0, z.library - 1)
      if (ev.to === 'battlefield') make(me, null, { hidden: true, land: true, est: true })
      else if (ev.to === 'hand') z.hand += 1
      else if (ev.to === 'graveyard') z.graveyard = [...z.graveyard, null]
      break
    } break
    case 'mill': if (me && !ev.x) {
      const z = s[me], n = ev.n || 1
      if (z.library != null) z.library = Math.max(0, z.library - n)
      z.graveyard = [...z.graveyard, ...Array(n).fill(null)]
      break
    } break
    case 'player': if (me) {
      const z = s[me]
      if (ev.to === 'monarch' || ev.to === 'initiative') { for (const k of S) if (k !== me) s[k] = { ...s[k], [ev.to]: false }; z[ev.to] = true }
      else if (ev.to === 'emblem') z.emblems = [...z.emblems, ev.card || 'Emblema']
      else if (ev.to === 'energy') z.energy += ev.n || 1
      break
    } break
    case 'outcome': if (me) {
      const won = / has won/.test(ev.txt || '')
      s.over = { ...s.over, [won ? 'winner' : 'loser']: me }
      if (!won && S.length > 2) s[me] = { ...s[me], out: ev.t || s.turn }  // eliminado a meio do jogo (multijogador)
      break
    } break
    default: break
  }
  if (X) {
    for (const [k, names] of Object.entries(ev.hd || {})) if (s[k]) { s[k].known = names; s[k].hand = names.length }
    for (const [k, n] of Object.entries(ev.lib || {})) if (s[k]) s[k].library = n
    for (const z of ev.zn || []) moveExact(z)
  }
  // ninjutsu, Kaalia, Mobilize, Hero of Bladehold…: o que a habilidade pôs em jogo entra virado e a atacar (o Forge não
  // regista ataque nem viragem): ataca quem o atacante da habilidade ataca; o ninja, quem atacava a criatura devolvida
  if (ev.k === 'resolve') {
    if (/tapped and attacking|onto the battlefield attacking/.test(ev.txt || '')) {
      const src = /\[Attacker: [^\]]*?\((\d+)\)\]/.exec(ev.txt)
      const by = src && find(+src[1], null)
      for (const [k, key] of s.ent || []) {
        const tgt = by?.[1].attacking || other(k) || s[k].perms.find(y => y.attacking)?.attacking || true
        upd(k, key, x => ({ ...x, tapped: true, attacking: tgt, sick: false }))
      }
    }
    s.ent = []
  }
  // marcadores com que a carta entra, ditos pelo Forge ("enters with three loyalty counters")
  if (ev.ctr) {
    const f = find(ev.id, ev.card, me)
    if (f) upd(f[0], f[1].key, x => ({ ...x, counters: { ...x.counters, ...ev.ctr } }))
  }
  return s
}

// todos os estados de um jogo (o índice i é o estado depois de i eventos)
export function replayStates(events, data, life = 20, setup = null, exact = false) {
  const out = [{ ...initialState(life, setup), exact }]
  for (const e of events) out.push(applyEvent(out[out.length - 1], e, data))
  return out
}

// Troca o lado `x` com 'a' em todo o jogo (eventos, vencedor, lugares, equipas, resumos…): o deck de quem vê fica em
// baixo, no lugar do jogador. Só mexe em textos que são exatamente uma letra de lado e em chaves de lado; o texto livre
// dos eventos (txt, card, name…) fica igual.
const SIDE_KEYS = new Set(['a', 'b', 'c', 'd']), KEEP = new Set(['txt', 'card', 'name', 'k', 'ph', 'reason', 'mc', 'pt'])
export function swapSide(v, x) {
  if (!x || x === 'a') return v
  const sw = s => (s === x ? 'a' : s === 'a' ? x : s)
  const walk = (o, key) => {
    if (typeof o === 'string') return KEEP.has(key) ? o : SIDE_KEYS.has(o) ? sw(o) : o
    if (Array.isArray(o)) return o.map(e => walk(e, key))
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, e]) => [SIDE_KEYS.has(k) ? sw(k) : k, KEEP.has(k) ? e : walk(e, k)]))
    return o
  }
  return walk(v, '')
}

// Torneio ao vivo: que jogo abrir quando o que se está a ver acaba. fl = jogos acabados por ordem (cada um com m = partida),
// i = índice do que se vê, mode = 'ultimo' | 'ordem' | 'mesa', home = { mid, gid } (a mesa seguida e o último jogo dela visto),
// done(mid) = a partida dessa mesa já acabou. Devolve { x, away } (away: espreita outra mesa e volta) ou null (esperar).
export function nextGame(fl, i, mode, home, done) {
  if (i < 0 || !fl[i]) return null
  if (mode === 'ordem') return fl[i + 1] ? { x: fl[i + 1] } : null
  if (mode === 'mesa') {
    const same = fl.find(x => x.m.id === home.mid && x.id > home.gid && x.id !== fl[i].id)
    if (same) return { x: same }
    return fl[i + 1] ? { x: fl[i + 1], away: !done(home.mid) } : null
  }
  const last = fl[fl.length - 1]
  return last.id !== fl[i].id ? { x: last } : null
}

// «Preencher» com mistura: pool = [[src, deck], …] já baralhado (src 'meus' ou 'meta'; deck.community = da comunidade),
// want = quantos faltam, w = {meu, com, meta} pesos (só os das fontes ligadas), minMeta = parte mínima do meta (0,2 nos
// torneios não casuais). Cada fonte leva a sua parte; se uma não tiver decks que cheguem, as outras completam.
export function mixTake(pool, want, w, minMeta = 0) {
  const kind = ([s, o]) => (s === 'meta' ? 'meta' : o.friend ? 'ami' : o.community ? 'com' : 'meu')
  const keys = Object.keys(w).filter(k => w[k] > 0), sum = keys.reduce((a, k) => a + w[k], 0) || 1
  const by = Object.fromEntries(keys.map(k => [k, pool.filter(x => kind(x) === k)]))
  const raw = keys.map(k => [k, (want * w[k]) / sum]), tgt = Object.fromEntries(raw.map(([k, x]) => [k, Math.floor(x)]))
  for (const [k] of raw.sort((a, b) => (b[1] % 1) - (a[1] % 1)).slice(0, want - Object.values(tgt).reduce((a, b) => a + b, 0))) tgt[k]++
  if (minMeta && 'meta' in tgt) {
    const need = Math.ceil(want * minMeta - 1e-9)
    while (tgt.meta < need) { const k = keys.filter(x => x !== 'meta' && tgt[x] > 0).sort((a, b) => tgt[b] - tgt[a])[0]; if (!k) break; tgt[k]--; tgt.meta++ }
  }
  const out = keys.flatMap(k => by[k].slice(0, tgt[k]))
  const rest = keys.sort((a, b) => w[b] - w[a]).flatMap(k => by[k].slice(tgt[k]))
  return [...out, ...rest].slice(0, want)
}

// Dados: um número leva traço por baixo se, virado ao contrário, se ler como outro número desse dado (6/9; no d100
// também 66, 68, 86, 89, 98, 99…), como nos dados a sério.
const TURN = { 0: '0', 1: '1', 6: '9', 8: '8', 9: '6' }
export function needsMark(v, n) {
  const s = String(v)
  if (s === '6' || s === '9') return true  // mesmo onde o outro não existe (num d8, um 6 virado lê-se «9»)
  if ([...s].some(d => !(d in TURN))) return false
  const r = [...s].reverse().map(d => TURN[d]).join('')
  return r[0] !== '0' && r !== s && +r >= 1 && +r <= n
}
