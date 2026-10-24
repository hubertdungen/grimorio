// Efeitos sonoros procedimentais (Web Audio): nada de ficheiros, nada de licenças, cada som é sintetizado na hora
// com osciladores, ruído filtrado e envelopes. Liga-se à repetição do tabuleiro por playEvent(ev, s, data, {speed}).
//
// Preferências em localStorage 'grimorio.sfx' = {on, vol}. Por omissão: ligado a 0,5 — com a curva vol² é metade do
// ganho máximo (picos ~−19 dBFS): discreto ao lado de música ou de um vídeo, mas ouve-se; desliga-se num toque.
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
// sino: parciais inarmónicos (r) com amplitudes (k) — dá o timbre de campainha/metal
function bell(c, out, t, f, g = 0.08, dur = 0.4, r = [1, 2.76, 5.4], k = [1, 0.35, 0.12]) {
  r.forEach((x, i) => tone(c, out, t, { f: f * x, dur: dur / (1 + i * 0.6), a: 0.003, g: g * k[i] }))
}
const ticks = (c, out, t, n, gap, o) => { for (let i = 0; i < n; i++) noise(c, out, t + i * gap, { ...o, g: o.g * (1 - i / (n + 2)) }) }

// cor dominante e tipo da carta: o feitiço lançado soa à cor (W claro, U água, B sombra, R fogo, G madeira)
function castColour(c, out, t, col) {
  switch (col) {
    case 'W': bell(c, out, t, hz(81), 0.09, 0.5); bell(c, out, t + 0.06, hz(88), 0.06, 0.45); noise(c, out, t, { type: 'highpass', f: 6000, dur: 0.3, g: 0.025 }); break
    case 'U': tone(c, out, t, { f: hz(76), f2: hz(83), dur: 0.42, a: 0.03, g: 0.1, lp: 1800 }); tone(c, out, t + 0.04, { f: hz(71), f2: hz(76), dur: 0.38, a: 0.03, g: 0.06, det: 8 }); break
    case 'B': tone(c, out, t, { type: 'triangle', f: hz(50), f2: hz(45), dur: 0.48, a: 0.02, g: 0.16, lp: 700 }); tone(c, out, t + 0.03, { f: hz(53), dur: 0.42, a: 0.03, g: 0.07 }); noise(c, out, t, { type: 'lowpass', f: 300, dur: 0.4, a: 0.05, g: 0.06 }); break
    case 'R': noise(c, out, t, { f: 1200, f2: 3200, q: 1.5, dur: 0.32, g: 0.11 }); ticks(c, out, t + 0.02, 5, 0.045, { f: 2500, q: 3, dur: 0.03, g: 0.05 }); tone(c, out, t, { type: 'sawtooth', f: hz(57), f2: hz(69), dur: 0.32, g: 0.06, lp: 1400 }); break
    case 'G': tone(c, out, t, { type: 'triangle', f: hz(67), dur: 0.32, a: 0.003, g: 0.14 }); tone(c, out, t + 0.05, { type: 'triangle', f: hz(74), dur: 0.3, a: 0.003, g: 0.08 }); tone(c, out, t, { f: 110, f2: 60, dur: 0.22, g: 0.1 }); break
    case 'M': [72, 79, 88].forEach((m, i) => bell(c, out, t + i * 0.04, hz(m), 0.055, 0.5)); break
    default: bell(c, out, t, 523, 0.08, 0.45, [1, 1.47, 2.09], [1, 0.5, 0.25])  // incolor: metal
  }
}
function castType(c, out, t, ty) {
  if (/Creature/.test(ty)) tone(c, out, t, { f: 130, f2: 62, dur: 0.26, g: 0.14 })  // invocação: um baque grave
  else if (/Instant|Sorcery/.test(ty)) noise(c, out, t, { f: 500, f2: 3500, q: 1.2, dur: 0.28, a: 0.02, g: 0.07 })
  else if (/Planeswalker/.test(ty)) { tone(c, out, t, { type: 'triangle', f: hz(45), dur: 0.55, a: 0.04, g: 0.07 }); tone(c, out, t, { type: 'triangle', f: hz(52), dur: 0.55, a: 0.04, g: 0.05 }) }
  else if (/Artifact/.test(ty)) bell(c, out, t + 0.08, 1400, 0.045, 0.16, [1, 1.47], [1, 0.4])
  else if (/Enchantment/.test(ty)) { bell(c, out, t + 0.1, hz(93), 0.03, 0.3); bell(c, out, t + 0.16, hz(96), 0.025, 0.3) }
}
const colOf = col => (!col ? 'C' : col.length > 1 ? 'M' : col)
const TURN = { a: [76, 83], b: [69, 76], c: [79, 86], d: [72, 79] }  // cada jogador tem o seu intervalo

// receitas: (c, out, t, o) → duração nominal em segundos. o = {amount, colour, type, side}
const R = {
  click: (c, out, t) => (tone(c, out, t, { f: 1800, f2: 1200, dur: 0.03, a: 0.001, g: 0.05 }), 0.04),
  zoom: (c, out, t) => (noise(c, out, t, { f: 600, f2: 3000, dur: 0.18, a: 0.03, g: 0.06 }), tone(c, out, t, { f: 660, f2: 990, dur: 0.15, a: 0.02, g: 0.03 }), 0.18),
  tap: (c, out, t) => (tone(c, out, t, { type: 'triangle', f: 900, f2: 500, dur: 0.05, a: 0.001, g: 0.1 }), noise(c, out, t, { f: 2500, dur: 0.03, g: 0.04 }), 0.06),
  untap: (c, out, t) => (tone(c, out, t, { type: 'triangle', f: 500, f2: 900, dur: 0.06, a: 0.004, g: 0.07 }), 0.07),
  draw: (c, out, t, o) => { const n = Math.min(o.amount || 1, 4); ticks(c, out, t, n, 0.06, { f: 1200, f2: 3500, q: 0.8, dur: 0.14, a: 0.02, g: 0.1 }); return 0.14 + (n - 1) * 0.06 },
  land: (c, out, t) => (tone(c, out, t, { f: 110, f2: 55, dur: 0.25, g: 0.32 }), noise(c, out, t, { type: 'lowpass', f: 400, dur: 0.12, g: 0.12 }), tone(c, out, t, { type: 'triangle', f: 220, dur: 0.2, g: 0.05 }), 0.25),
  cast: (c, out, t, o) => (castColour(c, out, t, colOf(o.colour)), castType(c, out, t, o.type || ''), 0.5),
  resolve: (c, out, t, o) => { const f = { W: 81, U: 76, B: 62, R: 69, G: 67 }[colOf(o.colour)] || 72; bell(c, out, t, hz(f), 0.08, 0.35); bell(c, out, t + 0.05, hz(f + 7), 0.05, 0.3); return 0.4 },
  counter: (c, out, t) => (tone(c, out, t, { type: 'square', f: 880, f2: 110, dur: 0.22, g: 0.06, lp: 2500, lp2: 600 }), noise(c, out, t, { type: 'highpass', f: 3000, dur: 0.1, g: 0.05 }), 0.25),
  countered: (c, out, t) => (noise(c, out, t, { f: 3000, f2: 300, q: 2, dur: 0.4, a: 0.01, g: 0.1 }), tone(c, out, t, { f: 600, f2: 200, dur: 0.3, g: 0.05 }), 0.4),
  trigger: (c, out, t) => (bell(c, out, t, hz(88), 0.05, 0.2), bell(c, out, t + 0.05, hz(95), 0.04, 0.2), 0.25),
  activate: (c, out, t) => (R.tap(c, out, t), tone(c, out, t + 0.02, { type: 'triangle', f: 400, f2: 800, dur: 0.12, a: 0.01, g: 0.08 }), 0.15),
  attack: (c, out, t) => (noise(c, out, t, { f: 800, f2: 4000, q: 2, dur: 0.22, a: 0.04, g: 0.16 }), tone(c, out, t, { f: 180, f2: 90, dur: 0.2, a: 0.02, g: 0.1 }), 0.25),
  block: (c, out, t) => (bell(c, out, t, 320, 0.13, 0.3, [1, 2.4, 3.9], [1, 0.5, 0.3]), noise(c, out, t, { f: 1800, dur: 0.06, g: 0.12 }), 0.3),
  damage: (c, out, t, o) => {  // escala com a quantidade (1–10+): mais grave, mais forte, mais longo
    const n = Math.min(Math.max(o.amount || 1, 1), 10), dur = 0.16 + n * 0.022
    tone(c, out, t, { f: 170 - n * 6, f2: 45, dur, g: 0.16 + n * 0.022 })
    noise(c, out, t, { type: 'lowpass', f: 1400 - n * 60, dur: 0.08 + n * 0.01, g: 0.09 + n * 0.012 })
    return dur
  },
  poison: (c, out, t) => { [0, 0.07, 0.15].forEach((d, i) => tone(c, out, t + d, { f: 300 + i * 70, f2: 520 + i * 60, dur: 0.07, a: 0.01, g: 0.06, lp: 1200 })); tone(c, out, t, { type: 'triangle', f: 90, dur: 0.42, a: 0.05, g: 0.06 }); return 0.45 },
  lifegain: (c, out, t) => ([72, 76, 79].forEach((m, i) => bell(c, out, t + i * 0.07, hz(m), 0.07, 0.32)), 0.46),
  lifeloss: (c, out, t) => (tone(c, out, t, { type: 'triangle', f: 330, f2: 165, dur: 0.35, a: 0.01, g: 0.09, lp: 1200 }), 0.35),
  destroy: (c, out, t) => (noise(c, out, t, { type: 'lowpass', f: 2000, f2: 200, dur: 0.4, g: 0.16 }), tone(c, out, t, { f: 140, f2: 40, dur: 0.45, g: 0.16 }), 0.45),
  exile: (c, out, t) => (noise(c, out, t, { f: 400, f2: 6000, q: 4, dur: 0.5, a: 0.08, g: 0.1 }), tone(c, out, t, { f: 500, f2: 1500, dur: 0.45, a: 0.06, g: 0.035 }), 0.5),
  bounce: (c, out, t) => (tone(c, out, t, { f: 250, f2: 800, dur: 0.18, a: 0.01, g: 0.09 }), noise(c, out, t, { f: 1500, dur: 0.1, g: 0.04 }), 0.2),
  token: (c, out, t, o) => {
    const n = Math.min(o.amount || 1, 3)
    for (let i = 0; i < n; i++) { tone(c, out, t + i * 0.07, { f: 500 * 1.12 ** i, f2: 1000 * 1.12 ** i, dur: 0.08, a: 0.002, g: 0.1 }); bell(c, out, t + i * 0.07 + 0.04, 1320 * 1.12 ** i, 0.04, 0.2) }
    return 0.24 + (n - 1) * 0.07
  },
  counters: (c, out, t, o) => { const up = (o.amount ?? 1) >= 0; tone(c, out, t, { type: 'triangle', f: up ? 700 : 1000, f2: up ? 1000 : 700, dur: 0.1, g: 0.08 }); bell(c, out, t + 0.05, up ? 1500 : 900, 0.035, 0.15); return 0.2 },
  pump: (c, out, t) => (tone(c, out, t, { type: 'sawtooth', f: 110, f2: 220, dur: 0.35, a: 0.08, g: 0.08, lp: 300, lp2: 1600 }), 0.35),
  attach: (c, out, t) => (tone(c, out, t, { type: 'triangle', f: 600, f2: 300, dur: 0.08, a: 0.002, g: 0.08 }), bell(c, out, t + 0.05, 900, 0.06, 0.2, [1, 1.47], [1, 0.4]), 0.25),
  transform: (c, out, t) => (tone(c, out, t, { f: 300, f2: 900, dur: 0.5, a: 0.1, g: 0.05 }), tone(c, out, t, { f: 450, f2: 1350, dur: 0.5, a: 0.1, g: 0.04, det: 12 }), noise(c, out, t, { f: 500, f2: 3000, q: 2, dur: 0.5, a: 0.1, g: 0.05 }), 0.55),
  discard: (c, out, t) => (noise(c, out, t, { f: 2500, f2: 800, dur: 0.12, a: 0.01, g: 0.1 }), 0.12),
  mill: (c, out, t, o) => { const n = Math.min(o.amount || 1, 5); ticks(c, out, t, n, 0.045, { f: 2000, dur: 0.06, g: 0.07 }); return 0.06 + (n - 1) * 0.045 },
  shuffle: (c, out, t) => (ticks(c, out, t, 8, 0.025, { f: 3000, q: 1.5, dur: 0.03, g: 0.06 }), 0.23),
  mulligan: (c, out, t) => (ticks(c, out, t, 12, 0.025, { f: 2800, q: 1.5, dur: 0.03, g: 0.06 }), tone(c, out, t + 0.1, { type: 'triangle', f: 220, f2: 196, dur: 0.25, g: 0.05 }), 0.35),
  turn: (c, out, t, o) => { const [x, y] = TURN[o.side] || TURN.a; bell(c, out, t, hz(x), 0.08, 0.45); bell(c, out, t + 0.12, hz(y), 0.07, 0.45); return 0.57 },
  combat: (c, out, t) => (tone(c, out, t, { f: 90, f2: 60, dur: 0.15, a: 0.004, g: 0.12 }), 0.15),  // fase de combate: tambor discreto; as outras fases não soam
  goad: (c, out, t) => ([0, 0.12].forEach(d => tone(c, out, t + d, { type: 'square', f: 300, f2: 450, dur: 0.1, g: 0.04, lp: 1500 })), 0.22),
  crown: (c, out, t) => ([79, 86, 91].forEach((m, i) => bell(c, out, t + i * 0.06, hz(m), 0.06, 0.35)), 0.47),  // monarca, iniciativa, emblema
  energy: (c, out, t) => (tone(c, out, t, { type: 'triangle', f: 1500, f2: 3000, dur: 0.1, g: 0.05 }), noise(c, out, t, { type: 'highpass', f: 4000, dur: 0.08, g: 0.04 }), 0.1),
  eliminated: (c, out, t) => ([62, 57, 50].forEach((m, i) => tone(c, out, t + i * 0.18, { type: 'triangle', f: hz(m), dur: 0.32, a: 0.01, g: 0.1, lp: 1200 })), 0.7),
  win: (c, out, t) => {
    [72, 76, 79, 84].forEach((m, i) => bell(c, out, t + i * 0.1, hz(m), 0.08, 0.5))
    ;[60, 64, 67].forEach(m => tone(c, out, t + 0.3, { type: 'triangle', f: hz(m), dur: 0.7, a: 0.05, g: 0.05 }))
    return 1
  },
  loss: (c, out, t) => {
    [69, 65, 62].forEach((m, i) => tone(c, out, t + i * 0.2, { type: 'triangle', f: hz(m), dur: 0.4, a: 0.01, g: 0.09, lp: 1400 }))
    tone(c, out, t + 0.4, { f: hz(38), dur: 0.55, a: 0.05, g: 0.1 })
    return 0.95
  },
  tie: (c, out, t) => (bell(c, out, t, hz(74), 0.07, 0.4), bell(c, out, t + 0.18, hz(74), 0.06, 0.4), 0.58),
  match: (c, out, t) => (bell(c, out, t, hz(79), 0.08, 0.4), bell(c, out, t + 0.1, hz(84), 0.08, 0.45), 0.55),  // partida de torneio acabada
  champion: (c, out, t) => {
    [67, 72, 76, 79].forEach((m, i) => bell(c, out, t + i * 0.09, hz(m), 0.07, 0.4))
    ;[72, 76, 79, 84].forEach(m => tone(c, out, t + 0.4, { type: 'triangle', f: hz(m), dur: 1.1, a: 0.06, g: 0.045 }))
    bell(c, out, t + 0.4, hz(96), 0.05, 0.9)
    noise(c, out, t + 0.4, { type: 'highpass', f: 7000, dur: 1, a: 0.2, g: 0.02 })
    return 1.5
  },
}
export const kinds = Object.keys(R)

// ---------- cadeia de saída e contexto ----------
// volume (curva vol², ×2 de ganho: as receitas têm picos ≤ 0,27) → compressor/limitador → saída
const amp = v => 2 * v * v
function chain(c, vol) {
  const g = c.createGain(), comp = c.createDynamicsCompressor()
  g.gain.value = amp(vol)
  comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.15
  g.connect(comp).connect(c.destination)
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
function voice(c, dest, side) {
  if (!side || !c.createStereoPanner) return dest
  const p = c.createStereoPanner()
  p.pan.value = PAN[side] ?? 0
  p.connect(dest)
  return p
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
const SIMPLE = { land: 'land', counter: 'counter', countered: 'countered', trigger: 'trigger', activate: 'activate', attack: 'attack', block: 'block', poison: 'poison', destroy: 'destroy', exile: 'exile', bounce: 'bounce', discard: 'discard', pump: 'pump', attach: 'attach', transform: 'transform', search: 'shuffle', goad: 'goad', tap: 'tap', untap: 'untap' }
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
