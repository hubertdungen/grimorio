// Efeitos sonoros procedimentais (Web Audio): nada de ficheiros, nada de licenças, cada som é sintetizado na hora
// com osciladores, ruído filtrado e envelopes. Liga-se à repetição do tabuleiro por playEvent(ev, s, data, {speed}).
//
// Preferências em localStorage 'grimorio.sfx' = {on, vol}. Por omissão: ligado a 0,5 — com a curva vol² é metade do
// ganho máximo: discreto ao lado de música ou de um vídeo, mas ouve-se; desliga-se num toque.
// O AudioContext só nasce depois do primeiro gesto do utilizador (os browsers bloqueiam o autoplay); até lá, play()
// não faz nada. Fora do browser (node, SSR) tudo é no-op.

const KEY = 'grimorio.sfx'
const HAS = typeof window !== 'undefined'
let cfg = { on: true, vol: 0.5 }
try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY)) } } catch { /* sem armazenamento */ }
let ctx = null, master = null

// ---------- síntese ----------
const hz = m => 440 * 2 ** ((m - 69) / 12)  // nota MIDI → Hz (69 = Lá4)
const NOISE = new WeakMap()
function noiseBuf(c) {
  let b = NOISE.get(c)
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    NOISE.set(c, b)
  }
  return b
}
// envelope: sobe em `a` até `g`, cai exponencialmente até ao fim de `dur`
function env(c, t, a, g, dur) {
  const v = c.createGain()
  v.gain.setValueAtTime(0, t)
  v.gain.linearRampToValueAtTime(g, t + a)
  v.gain.exponentialRampToValueAtTime(1e-4, t + dur)
  return v
}
function filt(c, t, type, f, f2, dur, q = 0.7) {
  const fl = c.createBiquadFilter()
  fl.type = type; fl.Q.value = q
  fl.frequency.setValueAtTime(f, t)
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur)
  return fl
}
// tom: oscilador com glissando opcional (f → f2) e passa-baixo opcional (lp → lp2)
function tone(c, out, t, { f, f2, type = 'sine', dur = 0.2, a = 0.005, g = 0.1, lp, lp2, det = 0 }) {
  const o = c.createOscillator()
  o.type = type; o.detune.value = det
  o.frequency.setValueAtTime(f, t)
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur)
  const v = env(c, t, a, g, dur)
  if (lp) o.connect(filt(c, t, 'lowpass', lp, lp2, dur)).connect(v)
  else o.connect(v)
  v.connect(out)
  o.start(t); o.stop(t + dur + 0.02)
}
// ruído filtrado (folha de papel, espada no ar, crepitar…)
function noise(c, out, t, { f = 1000, f2, q = 1, type = 'bandpass', dur = 0.15, a = 0.004, g = 0.1 }) {
  const s = c.createBufferSource()
  s.buffer = noiseBuf(c)
  const v = env(c, t, a, g, dur)
  s.connect(filt(c, t, type, f, f2, dur, q)).connect(v).connect(out)
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02)
}
// carta: o estalo do papel a soltar-se + o deslizar na mesa
function card(c, out, t, g = 0.08) {
  noise(c, out, t, { type: 'highpass', f: 3000, dur: 0.035, a: 0.001, g })
  noise(c, out, t + 0.01, { f: 1800, f2: 3800, q: 0.7, dur: 0.12, a: 0.03, g: g * 0.5 })
}
// baque: pancada surda na mesa / tambor (seno a cair + ruído grave)
function thud(c, out, t, g = 0.2, f = 110, dur = 0.2) {
  tone(c, out, t, { f, f2: f * 0.42, dur, a: 0.002, g })
  noise(c, out, t, { type: 'lowpass', f: 700, dur: 0.06, a: 0.001, g: g * 0.45 })
}
// sopro: ruído com o filtro a varrer (espada, magia a passar), a crescer até meio
const whoosh = (c, out, t, f, f2, dur, g, q = 1.2) => noise(c, out, t, { f, f2, q, dur, a: dur * 0.45, g })
// metal: ruído por filtros estreitos (escudo, fivela) — soa a metal sem ser um apito
function clank(c, out, t, g = 0.1, fs = [1700, 2950, 4300]) { fs.forEach((f, i) => noise(c, out, t, { f, q: 18, dur: 0.18 - i * 0.03, a: 0.001, g: g * (1 - i * 0.25) })) }
// metais: dentes-de-serra desafinados com o filtro a fechar (trompa, fanfarra)
function brass(c, out, t, notes, dur = 0.5, g = 0.035) {
  for (const m of notes) for (const det of [-7, 6]) tone(c, out, t, { type: 'sawtooth', f: hz(m), dur, a: 0.04, g, lp: 2400, lp2: 700, det })
}
const ticks = (c, out, t, n, gap, o) => { for (let i = 0; i < n; i++) noise(c, out, t + i * gap, { ...o, g: o.g * (1 - i / (n + 2)) }) }

// magia: um acorde suave que cresce (a cor da carta) + a textura da cor (W brilho, U água, B sombra, R fogo, G madeira)
const CHORD = { W: [76, 83, 88], U: [69, 76, 81], B: [45, 52, 57], R: [57, 64, 69], G: [55, 62, 67], M: [64, 71, 76, 83], C: [72, 79] }
function magic(c, out, t, col, g = 0.03, dur = 0.55) {
  ;(CHORD[col] || CHORD.C).forEach((m, i) => tone(c, out, t + i * 0.015, { type: 'triangle', f: hz(m), dur, a: dur * 0.35, g: g / (1 + i * 0.3), det: i % 2 ? 7 : -7 }))
  if (col === 'W') noise(c, out, t, { type: 'highpass', f: 7000, dur: 0.45, a: 0.15, g: 0.02 })
  else if (col === 'U') whoosh(c, out, t, 400, 1200, 0.45, 0.05, 2)
  else if (col === 'B') noise(c, out, t, { type: 'lowpass', f: 250, dur: 0.5, a: 0.15, g: 0.08 })
  else if (col === 'R') { whoosh(c, out, t, 600, 2800, 0.35, 0.07); ticks(c, out, t + 0.05, 5, 0.05, { f: 2600, q: 3, dur: 0.025, g: 0.04 }) }
  else if (col === 'G') thud(c, out, t, 0.08, 220, 0.12)
}
const colOf = col => (!col ? 'C' : col.length > 1 ? 'M' : col)

// receitas: (c, out, t, o) → duração nominal em segundos. o = {amount, colour, type, side}
const R = {
  click: (c, out, t) => (noise(c, out, t, { type: 'highpass', f: 2500, dur: 0.025, a: 0.001, g: 0.05 }), 0.03),
  zoom: (c, out, t) => (whoosh(c, out, t, 500, 2200, 0.16, 0.05), 0.16),
  tap: (c, out, t) => (card(c, out, t, 0.035), 0.12),
  untap: (c, out, t) => (card(c, out, t, 0.02), 0.12),
  draw: (c, out, t, o) => { const n = Math.min(o.amount || 1, 4); for (let i = 0; i < n; i++) noise(c, out, t + i * 0.08, { f: 1500, f2: 3200, q: 0.8, dur: 0.11, a: 0.03, g: 0.07 }); return 0.11 + (n - 1) * 0.08 },
  land: (c, out, t) => (card(c, out, t, 0.04), thud(c, out, t + 0.02, 0.2, 95), 0.22),
  cast: (c, out, t, o) => {
    const ty = o.type || ''
    card(c, out, t, 0.05); magic(c, out, t + 0.03, colOf(o.colour))
    if (/Creature/.test(ty)) thud(c, out, t + 0.32, 0.16, 120)  // a criatura chega à mesa
    else if (/Planeswalker/.test(ty)) brass(c, out, t + 0.1, [45, 52], 0.6, 0.025)
    else if (/Artifact/.test(ty)) clank(c, out, t + 0.3, 0.05)
    else if (/Instant|Sorcery/.test(ty)) whoosh(c, out, t, 600, 3000, 0.3, 0.06)
    return 0.6
  },
  resolve: (c, out, t) => (noise(c, out, t, { type: 'lowpass', f: 1500, f2: 400, dur: 0.2, a: 0.02, g: 0.05 }), 0.2),
  counter: (c, out, t) => (whoosh(c, out, t, 3000, 500, 0.22, 0.09, 2), clank(c, out, t + 0.12, 0.07), 0.32),
  countered: (c, out, t) => (noise(c, out, t, { type: 'highpass', f: 4000, f2: 600, dur: 0.38, a: 0.01, g: 0.07 }), ticks(c, out, t + 0.03, 6, 0.05, { f: 3500, q: 4, dur: 0.02, g: 0.05 }), 0.4),
  trigger: (c, out, t) => (noise(c, out, t, { f: 5200, q: 8, dur: 0.14, a: 0.03, g: 0.025 }), 0.14),
  activate: (c, out, t) => (card(c, out, t, 0.03), whoosh(c, out, t + 0.02, 700, 1800, 0.14, 0.04), 0.16),
  attack: (c, out, t) => (whoosh(c, out, t, 500, 2600, 0.24, 0.14, 1.5), thud(c, out, t + 0.14, 0.14, 75), 0.34),
  block: (c, out, t) => (thud(c, out, t, 0.14, 140), clank(c, out, t, 0.09), 0.25),
  damage: (c, out, t, o) => {  // escala com a quantidade (1–10+): mais grave, mais forte, mais longo
    const n = Math.min(Math.max(o.amount || 1, 1), 10)
    thud(c, out, t, 0.18 + n * 0.02, 105 - n * 4, 0.18 + n * 0.02)
    noise(c, out, t, { type: 'lowpass', f: 2600, dur: 0.05, a: 0.001, g: 0.08 + n * 0.01 })
    if (n >= 5) tone(c, out, t, { f: 55, f2: 35, dur: 0.4, a: 0.01, g: 0.12 })
    return n >= 5 ? 0.4 : 0.18 + n * 0.02
  },
  poison: (c, out, t) => { [0, 0.08, 0.15].forEach((d, i) => noise(c, out, t + d, { f: 350 + i * 90, f2: 900 + i * 150, q: 14, dur: 0.07, a: 0.005, g: 0.09 })); noise(c, out, t, { type: 'lowpass', f: 300, dur: 0.4, a: 0.1, g: 0.05 }); return 0.42 },
  lifegain: (c, out, t) => (magic(c, out, t, 'W', 0.035, 0.6), 0.6),
  lifeloss: (c, out, t) => (thud(c, out, t, 0.1, 90), whoosh(c, out, t, 1200, 300, 0.3, 0.04), 0.3),
  destroy: (c, out, t) => (noise(c, out, t, { type: 'lowpass', f: 3000, f2: 200, dur: 0.4, a: 0.002, g: 0.16 }), ticks(c, out, t + 0.02, 5, 0.04, { f: 1800, q: 2, dur: 0.04, g: 0.07 }), thud(c, out, t, 0.18, 80), 0.42),
  exile: (c, out, t) => (whoosh(c, out, t, 300, 6000, 0.55, 0.09, 3), noise(c, out, t + 0.25, { type: 'highpass', f: 6500, dur: 0.35, a: 0.05, g: 0.025 }), 0.6),
  bounce: (c, out, t) => (whoosh(c, out, t, 400, 2400, 0.2, 0.08), card(c, out, t + 0.15, 0.03), 0.27),
  token: (c, out, t, o) => { const n = Math.min(o.amount || 1, 3); for (let i = 0; i < n; i++) { thud(c, out, t + i * 0.08, 0.08, 240, 0.12); noise(c, out, t + i * 0.08, { f: 2500, q: 3, dur: 0.04, a: 0.001, g: 0.04 }) } return 0.12 + (n - 1) * 0.08 },
  counters: (c, out, t, o) => (noise(c, out, t, { f: (o.amount ?? 1) >= 0 ? 3200 : 2200, q: 6, dur: 0.035, a: 0.001, g: 0.06 }), 0.05),
  pump: (c, out, t) => (tone(c, out, t, { type: 'sawtooth', f: 90, f2: 180, dur: 0.3, a: 0.06, g: 0.05, lp: 250, lp2: 1400 }), whoosh(c, out, t, 300, 1500, 0.3, 0.04), 0.3),
  attach: (c, out, t) => (card(c, out, t, 0.03), clank(c, out, t + 0.05, 0.05, [2400, 3900]), 0.2),
  transform: (c, out, t) => (whoosh(c, out, t, 300, 3000, 0.5, 0.07, 2), magic(c, out, t + 0.1, 'M', 0.03, 0.5), 0.6),
  discard: (c, out, t) => (card(c, out, t, 0.05), noise(c, out, t + 0.03, { f: 2200, f2: 900, dur: 0.12, a: 0.01, g: 0.04 }), 0.15),
  mill: (c, out, t, o) => { const n = Math.min(o.amount || 1, 5); for (let i = 0; i < n; i++) noise(c, out, t + i * 0.05, { f: 2200, f2: 3600, q: 0.8, dur: 0.07, a: 0.01, g: 0.05 }); return 0.07 + (n - 1) * 0.05 },
  shuffle: (c, out, t) => (ticks(c, out, t, 10, 0.022, { f: 3200, q: 1, dur: 0.025, g: 0.045 }), 0.24),
  mulligan: (c, out, t) => (R.shuffle(c, out, t), R.shuffle(c, out, t + 0.28), 0.52),
  turn: (c, out, t, o) => (whoosh(c, out, t, 250, 900, 0.3, 0.035), thud(c, out, t + 0.12, o.side === 'a' ? 0.1 : 0.07, o.side === 'a' ? 70 : 60, 0.3), 0.42),
  combat: (c, out, t) => (thud(c, out, t, 0.16, 70, 0.3), thud(c, out, t + 0.16, 0.12, 65, 0.3), 0.46),  // tambores de guerra; as outras fases não soam
  goad: (c, out, t) => (brass(c, out, t, [45, 52], 0.35, 0.03), 0.35),
  crown: (c, out, t) => (brass(c, out, t, [67, 74], 0.45, 0.025), magic(c, out, t, 'W', 0.025, 0.5), 0.5),  // monarca, iniciativa, emblema
  energy: (c, out, t) => (noise(c, out, t, { type: 'highpass', f: 3500, dur: 0.08, a: 0.002, g: 0.05 }), tone(c, out, t, { type: 'sawtooth', f: 200, f2: 1600, dur: 0.12, g: 0.03, lp: 2500 }), 0.13),
  eliminated: (c, out, t) => (brass(c, out, t, [50, 57], 0.5, 0.035), brass(c, out, t + 0.3, [45, 52], 0.7, 0.035), thud(c, out, t + 0.3, 0.16, 55, 0.5), 1),
  win: (c, out, t) => {
    brass(c, out, t, [60, 67], 0.22, 0.04); brass(c, out, t + 0.18, [64, 72], 0.22, 0.04)
    brass(c, out, t + 0.36, [60, 67, 72, 76], 1, 0.035); thud(c, out, t + 0.36, 0.2, 70, 0.6)
    noise(c, out, t + 0.36, { type: 'highpass', f: 6000, dur: 1, a: 0.01, g: 0.04 })  // prato
    return 1.36
  },
  loss: (c, out, t) => (brass(c, out, t, [57, 64], 0.5, 0.035), brass(c, out, t + 0.4, [53, 60], 0.5, 0.035), brass(c, out, t + 0.8, [50, 57], 0.9, 0.03), thud(c, out, t + 0.8, 0.16, 50, 0.6), 1.7),
  tie: (c, out, t) => (brass(c, out, t, [62, 69], 0.5, 0.035), thud(c, out, t, 0.12, 70, 0.4), thud(c, out, t + 0.25, 0.1, 70, 0.4), 0.65),
  match: (c, out, t) => (brass(c, out, t, [67, 74], 0.25, 0.035), brass(c, out, t + 0.2, [72, 79], 0.5, 0.035), thud(c, out, t + 0.2, 0.14, 70, 0.4), 0.7),  // partida de torneio acabada
  champion: (c, out, t) => {
    brass(c, out, t, [60, 67], 0.18, 0.04); brass(c, out, t + 0.15, [60, 67], 0.18, 0.04); brass(c, out, t + 0.3, [64, 72], 0.18, 0.04)
    brass(c, out, t + 0.45, [60, 67, 72, 76, 79], 1.3, 0.03); thud(c, out, t + 0.3, 0.12, 65, 0.3); thud(c, out, t + 0.45, 0.22, 65, 0.8)
    noise(c, out, t + 0.45, { type: 'highpass', f: 5500, dur: 1.4, a: 0.01, g: 0.05 })
    return 1.85
  },
}
export const kinds = Object.keys(R)

// ---------- cadeia de saída e contexto ----------
// volume (curva vol², ×2 de ganho) → passa-baixo (tira o agudo que cansa) → compressor/limitador → saída;
// cada voz manda ainda um pouco para uma sala (reverb de ruído a decair): os sons ficam com espaço, não «secos»
const amp = v => 2 * v * v
function room(c, secs = 1.1) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3.5 }
  return b
}
function chain(c, vol) {
  const g = c.createGain(), lp = c.createBiquadFilter(), comp = c.createDynamicsCompressor(), rev = c.createConvolver(), send = c.createGain()
  g.gain.value = amp(vol)
  lp.type = 'lowpass'; lp.frequency.value = 9000
  comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.15
  g.connect(lp).connect(comp).connect(c.destination)
  rev.buffer = room(c); send.gain.value = 0.22
  send.connect(rev).connect(g)
  g.send = send
  return g
}
function ensure() {
  if (!HAS || !cfg.on) return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC({ latencyHint: 'interactive' })
    master = chain(ctx, cfg.vol)
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
  return ctx
}
if (HAS) {
  // o primeiro gesto desbloqueia o áudio; voltar ao separador retoma-o (iOS/Chrome suspendem-no)
  for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, ensure, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else ensure() })
}

// ---------- limite de ritmo ----------
// no máximo MAX sons por 100 ms; o mesmo tipo repetido dentro do seu intervalo junta-se ao anterior (não soa)
const MAX = 3, GAP = { tap: 70, untap: 70, draw: 60, damage: 50, counters: 60, pump: 60, mill: 80, token: 80, trigger: 60, shuffle: 120, combat: 300 }
const VIP = new Set(['turn', 'win', 'loss', 'tie', 'eliminated', 'match', 'champion'])  // passam sempre (exceto repetição < 1,2 s)
const recent = [], lastAt = {}
function admit(kind, now) {
  if (now - (lastAt[kind] ?? -1e9) < (VIP.has(kind) ? 1200 : GAP[kind] ?? 35)) return false
  while (recent.length && now - recent[0] > 100) recent.shift()
  if (!VIP.has(kind) && recent.length >= MAX) return false
  recent.push(now); lastAt[kind] = now
  return true
}

const PAN = { a: -0.2, b: 0.2, c: 0.35, d: -0.35 }
function voice(c, dest, side) {  // panorâmica por jogador; liga ao seco e à sala
  const v = side && c.createStereoPanner ? c.createStereoPanner() : c.createGain()
  if (v.pan) v.pan.value = PAN[side] ?? 0
  v.connect(dest); if (dest.send) v.connect(dest.send)
  return v
}

// play('damage', {amount: 3, side: 'b'}); opts: amount, colour ('R', 'WU'…), type (linha de tipo), side ('a'…'d')
export function play(kind, opts = {}) {
  const fn = R[kind], c = fn && ensure()
  if (!c || c.state !== 'running') return false  // suspenso: não se acumula para soar tudo de uma vez depois
  if (!admit(kind, performance.now())) return false
  try { fn(c, voice(c, master, opts.side), c.currentTime + 0.005, opts) } catch { return false }
  return true
}

// ---------- eventos do tabuleiro ----------
// a alta velocidade (≥ 4×) calam-se os sons miúdos; o que muda o jogo continua a soar
const MINOR = new Set(['tap', 'untap', 'phase', 'draw', 'trigger', 'activate', 'resolve', 'counters', 'pump', 'mill', 'search', 'attach', 'goad', 'player'])
const SIMPLE = { land: 'land', counter: 'counter', countered: 'countered', trigger: 'trigger', activate: 'activate', attack: 'attack', block: 'block', poison: 'poison', destroy: 'destroy', exile: 'exile', bounce: 'bounce', discard: 'discard', pump: 'pump', attach: 'attach', transform: 'transform', search: 'shuffle', goad: 'goad', tap: 'tap' }  // destapar (tudo de uma vez, todos os turnos) fica calado
let prevEv = null

// ev = o evento acabado de aplicar; s = o estado depois dele (states[i]); data = cartas (byName) para cor e tipo
// opts.speed: a velocidade da repetição. Não chamar nos saltos (pos.jump): aí não há som nenhum.
export function playEvent(ev, s, data, { speed = 1 } = {}) {
  const last = prevEv
  prevEv = ev
  if (!ev || !cfg.on || (speed >= 4 && MINOR.has(ev.k))) return false
  const side = ev.p, card = ev.card && data?.byName?.get(ev.card)
  const o = { side, colour: card?.co ?? card?.ci, type: card?.t?.split(' // ')[0] }
  switch (ev.k) {
    case 'turn': return play('turn', { side })
    case 'phase': return ev.ph === 'combat' && play('combat', { side })
    case 'mulligan': return ev.card !== 'kept' && play('mulligan', { side })
    case 'cast': return play('cast', o)
    case 'resolve': return play('resolve', o)
    case 'damage': return play('damage', { amount: ev.n, side: ev.target in PAN ? ev.target : side })
    case 'life': {
      const d = s?.fx?.life?.d ?? 0
      if (d > 0) return play('lifegain', { side })
      // a perda logo a seguir ao dano no mesmo jogador já soou como dano
      return d < 0 && !(last && (last.k === 'damage' || last.k === 'poison') && last.target === side) && play('lifeloss', { side })
    }
    case 'token': return play('token', { amount: ev.n || 1, side })
    case 'counters': return play('counters', { amount: ev.n, side })
    case 'draw': return play('draw', { amount: ev.n || 1, side })
    case 'mill': return play('mill', { amount: ev.n || 1, side })
    case 'player': return play(ev.to === 'energy' ? 'energy' : 'crown', { side })
    case 'outcome': {
      const won = / has won/.test(ev.txt || ''), multi = (s?.sides?.length || 2) > 2
      if (side === 'a') return play(won ? 'win' : 'loss')
      if (won) return play('loss')
      return play(multi && !s?.over?.winner ? 'eliminated' : 'win', { side })
    }
    default: return SIMPLE[ev.k] ? play(SIMPLE[ev.k], o) : false
  }
}

// ---------- preferências ----------
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)) } catch { /* sem armazenamento */ } }
export const getSettings = () => ({ ...cfg })
export function setEnabled(on) {
  cfg.on = !!on; save()
  if (!ctx) { if (on) ensure(); return }
  if (on) ctx.resume().catch(() => {}); else ctx.suspend().catch(() => {})
}
export function setVolume(v) {
  cfg.vol = Math.max(0, Math.min(1, +v || 0)); save()
  if (master) master.gain.setTargetAtTime(amp(cfg.vol), ctx.currentTime, 0.02)
}

// testes: desenha um som num OfflineAudioContext (com a mesma cadeia) → {buffer, dur nominal}
export async function render(kind, opts = {}, vol = 1, rate = 48000) {
  const c = new OfflineAudioContext(2, rate * 2, rate)
  const dur = R[kind](c, voice(c, chain(c, vol), opts.side), 0, opts)
  return { buffer: await c.startRendering(), dur }
}
