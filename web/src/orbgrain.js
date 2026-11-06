// Grãos: o que se vê do fluido no modo realista. As ~600 partículas do orbfluid.js são o motor (pressão, viscosidade,
// reações); aqui milhares de grãos finos são levados pelo campo de velocidade delas, à maneira do Powder Toy: cada
// grão tem a matéria da sua partícula-âncora, um tom próprio um pouco diferente dos vizinhos, calor (os quentes têm a
// cor do corpo negro: branco-amarelo → laranja → vermelho → escuro) e luz própria (cores acima de 1 → bloom no orb3d.js).
import { MAT, KIND } from './orbfluid.js'

const NAMES = Object.keys(MAT), R_IN = 0.86, FLOOR = -1.1
const TRANSIENT = NAMES.map(k => !!(MAT[k].ttl && MAT[k].ttl < 1))  // raios e clarões: desenhados à parte, não levam grãos
const IDX = k => NAMES.indexOf(k)
const FIRE = IDX('fire'), LAVA = IDX('lava'), MAGMA = IDX('magma'), EMBER = IDX('ember'), FLASH = IDX('flash'), METAL = IDX('metal'), CRYSTAL = IDX('crystal'), CRUST = IDX('crust')
// como cada matéria se desenha em grão: 0 opaco (líquido, pó, sólido), 1 gás (fofo, translúcido), 2 luz (soma, brilha)
export const GK = NAMES.map((k, i) => (KIND[i] === 2 ? 1 : KIND[i] === 3 ? 2 : 0))
// tamanho do grão por matéria (mundo): os gases fofos, o pó fino
const GS = NAMES.map((k, i) => (GK[i] === 1 ? 0.36 : MAT[k].solid ? 0.13 : GK[i] === 2 ? 0.14 : 0.19))
// agitação própria (browniano): o gás e a luz espalham-se, o líquido quase não, o sólido nada
const BR = NAMES.map((k, i) => (GK[i] === 1 ? 0.45 : GK[i] === 2 ? 0.3 : MAT[k].solid ? 0.02 : 0.06))

// a luz que cada matéria espalha à volta (as que brilham): a lava e o fogo alaranjam a água e o fumo ao pé deles
const EMC = new Float32Array(NAMES.length * 3)  // números simples (misturar null com listas tirava a otimização: 7× mais lento)
NAMES.forEach((k, i) => { const M = MAT[k]
  const c = k === 'lava' || k === 'magma' || k === 'fire' || k === 'ember' ? [1, 0.42, 0.1].map(x => x * (k === 'magma' ? 0.6 : 1)) : M.glow >= 0.5 ? M.col.map(x => x * M.glow * 0.8) : [0, 0, 0]
  EMC.set(c, i * 3) })
// cor do corpo negro (0 frio … 1 branco-quente) e quanto brilha (HDR)
export function blackbody(T, out = [0, 0, 0]) {
  const t = Math.max(0, Math.min(1, T))
  out[0] = Math.min(1, 0.08 + t * 2.2); out[1] = Math.max(0, Math.min(1, (t - 0.28) * 1.55)); out[2] = Math.max(0, Math.min(1, (t - 0.62) * 2.2))
  const e = 0.35 + 1.5 * t * t  // somados uns aos outros já fazem muito: mais do que isto rebentava para branco
  out[0] *= e; out[1] *= e; out[2] *= e
  return out
}

export class Grains {
  constructor(n, seed = 1) {
    this.n = n; let s = seed | 0
    this.rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    this.x = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.a = new Int32Array(n).fill(-1)
    this.lit = new Float32Array(n * 3); this.dens = new Float32Array(n)
    this.age = new Float32Array(n); this.fl = new Float32Array(n)  // fl: luz de um clarão perto
    this.tone = new Float32Array(n * 3); this.ph = new Float32Array(n)
    for (let i = 0; i < n; i++) {  // o tom de cada grão: um pouco mais claro/escuro e um nada de outra cor (heterogéneo)
      const k = 0.8 + this.rnd() * 0.38, h = (this.rnd() - 0.5) * 0.08
      this.tone[i * 3] = k + h; this.tone[i * 3 + 1] = k; this.tone[i * 3 + 2] = k - h; this.ph[i] = this.rnd() * 6.283
    }
    this.GN = 0; this.head = null; this.next = null
  }
  // a grelha das partículas-âncora (para o campo de velocidade)
  grid(fs) {
    const H = fs.H, GN = Math.ceil(6 / H)
    if (GN !== this.GN) { this.GN = GN; this.head = new Int32Array(GN * GN * GN) }
    if (!this.next || this.next.length < fs.max) this.next = new Int32Array(fs.max)
    this.head.fill(-1)
    for (let i = 0; i < fs.count; i++) { if (!fs.alive[i] || TRANSIENT[fs.m[i]]) continue; const c = this.cell(fs.x[i * 3], fs.x[i * 3 + 1], fs.x[i * 3 + 2], H); this.next[i] = this.head[c]; this.head[c] = i }
  }
  cell(x, y, z, H) { const G = this.GN, f = v => Math.max(0, Math.min(G - 1, Math.floor((v + 3) / H))); return (f(x) * G + f(y)) * G + f(z) }
  ok(fs, j) { return j >= 0 && j < fs.count && fs.alive[j] && !TRANSIENT[fs.m[j]] && fs.fade[j] <= 0.5 && (!this.outOnly || fs.out[j]) }  // outOnly: com a GPU, só o que verteu
  anchor(fs, g) {  // uma âncora nova: primeiro as que têm grãos a menos (a quota), senão ao acaso; o grão nasce perto dela
    for (let t = 0; t < 10; t++) {
      const j = this.def && this.def.length ? this.def.pop() : (this.rnd() * fs.count) | 0
      if (!this.ok(fs, j)) continue
      if (this.cnt) this.cnt[j]++
      const o = g * 3, p = j * 3, r = fs.H * 0.45
      this.x[o] = fs.x[p] + (this.rnd() - 0.5) * r; this.x[o + 1] = fs.x[p + 1] + (this.rnd() - 0.5) * r; this.x[o + 2] = fs.x[p + 2] + (this.rnd() - 0.5) * r
      this.v[o] = fs.v[p]; this.v[o + 1] = fs.v[p + 1]; this.v[o + 2] = fs.v[p + 2]
      this.a[g] = j; this.age[g] = 0; return true
    }
    this.a[g] = -1; return false
  }
  step(fs, dt) {
    if (!fs.count) return
    dt = Math.min(dt, 1 / 30)
    this.grid(fs)
    const H = fs.H, G = this.GN, X = this.x, V = this.v, FX = fs.x, FV = fs.v
    // os clarões das reações: iluminam os grãos à volta
    const fl = []
    for (let i = 0; i < fs.count && fl.length < 24; i++) if (fs.alive[i] && fs.m[i] === FLASH) fl.push(FX[i * 3], FX[i * 3 + 1], FX[i * 3 + 2], 1 - fs.age[i] / 0.35)
    // a quota: cada partícula leva ~n/vivas grãos (senão ficavam todos na primeira matéria que apareceu); as que têm a
    // mais cedem alguns por passo às que têm a menos (o grão renasce lá, a aparecer devagar)
    if (!this.cnt || this.cnt.length < fs.max) this.cnt = new Int32Array(fs.max)
    const cnt = this.cnt; cnt.fill(0)
    let C = 0
    for (let i = 0; i < fs.count; i++) if (this.ok(fs, i)) C++
    for (let g = 0; g < this.n; g++) if (this.ok(fs, this.a[g])) cnt[this.a[g]]++
    const quota = C ? this.n / C : 0
    this.def = []
    for (let i = 0; i < fs.count; i++) if (this.ok(fs, i)) for (let d = Math.floor(quota) - cnt[i]; d > 0; d--) this.def.push(i)
    for (let i = this.def.length - 1; i > 0; i--) { const k = (this.rnd() * (i + 1)) | 0, t = this.def[i]; this.def[i] = this.def[k]; this.def[k] = t }
    let moves = Math.max(6, Math.round(this.n * 0.02))
    const g0 = (this.rnd() * this.n) | 0
    for (let q = 0; q < this.n && moves > 0 && this.def.length; q++) { const g = (g0 + q) % this.n, a = this.a[g]; if (this.ok(fs, a) && cnt[a] > Math.ceil(quota)) { cnt[a]--; this.anchor(fs, g); moves-- } }
    for (let g = 0; g < this.n; g++) {
      let j = this.a[g]
      if (j < 0 || j >= fs.count || !fs.alive[j] || TRANSIENT[fs.m[j]] || fs.fade[j] > 0.7) { if (!this.anchor(fs, g)) continue; j = this.a[g] }
      this.age[g] += dt
      const o = g * 3, x = X[o], y = X[o + 1], z = X[o + 2]
      // o campo de velocidade: média pesada das âncoras perto (o bloco 2×2×2 de células mais próximo)
      const fx = (x + 3) / H, fy = (y + 3) / H, fz = (z + 3) / H
      const cx = Math.floor(fx - 0.5), cy = Math.floor(fy - 0.5), cz = Math.floor(fz - 0.5)
      let sw = 0, vx = 0, vy = 0, vz = 0, lr = 0, lg = 0, lb = 0
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
        const ix = cx + a, iy = cy + b, iz = cz + c
        if (ix < 0 || iy < 0 || iz < 0 || ix >= G || iy >= G || iz >= G) continue
        for (let k = this.head[(ix * G + iy) * G + iz]; k >= 0; k = this.next[k]) {
          const p = k * 3, dx = FX[p] - x, dy = FX[p + 1] - y, dz = FX[p + 2] - z, d2 = dx * dx + dy * dy + dz * dz
          if (d2 >= H * H) continue
          const q = 1 - Math.sqrt(d2) / H, w = q * q
          sw += w; vx += FV[p] * w; vy += FV[p + 1] * w; vz += FV[p + 2] * w
          const mk = fs.m[k] * 3; lr += EMC[mk] * w; lg += EMC[mk + 1] * w; lb += EMC[mk + 2] * w
        }
      }
      // a luz que recebe das matérias que brilham à volta (lava, fogo, luz, raios) e a sombra do que é denso
      const kl = 1 / (sw + 1.5); this.lit[g * 3] = lr * kl; this.lit[g * 3 + 1] = lg * kl; this.lit[g * 3 + 2] = lb * kl; this.dens[g] = sw
      const p = j * 3, m = fs.m[j]
      if (sw > 0) { vx /= sw; vy /= sw; vz /= sw } else { vx = FV[p]; vy = FV[p + 1]; vz = FV[p + 2] }
      // a mola para a âncora (os grãos repartem-se pelas partículas, sem se juntarem num sítio) e a agitação própria
      const ax = FX[p] - x, ay = FX[p + 1] - y, az = FX[p + 2] - z, ad = Math.hypot(ax, ay, az)
      if (ad > H * 3) { this.anchor(fs, g); continue }  // ficou longe de mais (a âncora foi atirada): renasce ao pé dela
      const ks = ad > H * 1.2 ? 9 : 3, br = BR[m]
      const tvx = vx + ax * ks + (this.rnd() - 0.5) * br * 6, tvy = vy + ay * ks + (this.rnd() - 0.5) * br * 6, tvz = vz + az * ks + (this.rnd() - 0.5) * br * 6
      const rl = Math.min(1, dt * 12)  // a inércia do grão: segue o campo com um pouco de atraso
      V[o] += (tvx - V[o]) * rl; V[o + 1] += (tvy - V[o + 1]) * rl; V[o + 2] += (tvz - V[o + 2]) * rl
      X[o] += V[o] * dt; X[o + 1] += V[o + 1] * dt; X[o + 2] += V[o + 2] * dt
      if (!fs.out[j]) { const r = Math.hypot(X[o], X[o + 1], X[o + 2]); if (r > R_IN) { const k = R_IN / r; X[o] *= k; X[o + 1] *= k; X[o + 2] *= k } }
      else if (X[o + 1] < FLOOR) X[o + 1] = FLOOR
      // a luz dos clarões
      let f = 0
      for (let q = 0; q < fl.length; q += 4) { const d = Math.hypot(X[o] - fl[q], X[o + 1] - fl[q + 1], X[o + 2] - fl[q + 2]); if (d < 0.35) f = Math.max(f, (1 - d / 0.35) * fl[q + 3]) }
      this.fl[g] = Math.max(f, this.fl[g] - dt * 3)
    }
  }
  // a esfera partiu-se onde estava: os grãos passam para o mundo como as partículas (orbfluid.release)
  release(xf) {
    const xs = xf?.s || [1, 1, 1], xo = xf?.o || [0, 0, 0]
    for (let g = 0; g < this.n; g++) for (let q = 0; q < 3; q++) this.x[g * 3 + q] = this.x[g * 3 + q] * xs[q] + xo[q]
  }
  // para desenhar: posição, cor (HDR), tamanho, opacidade e o grupo (0 opaco, 1 gás, 2 luz); devolve quantos
  fill(fs, pos, col, size, alpha, grp, now, xf = null, vel = null) {
    const xs = xf?.s || [1, 1, 1], xo = xf?.o || [0, 0, 0], cz = Math.cos(xf?.rz || 0), sz = Math.sin(xf?.rz || 0), tc = xf?.col, tk = xf?.k || 0
    const sm = Math.min(xs[0], xs[1], xs[2]), bb = [0, 0, 0]
    let k = 0
    for (let g = 0; g < this.n; g++) {
      const j = this.a[g]
      if (j < 0 || j >= fs.count || !fs.alive[j]) continue
      const m = fs.m[j], M = MAT[NAMES[m]], o = g * 3, out = fs.out[j]
      if (xf && !out) { const x = this.x[o] * xs[0], y = this.x[o + 1] * xs[1]; pos[k * 3] = x * cz - y * sz + xo[0]; pos[k * 3 + 1] = x * sz + y * cz + xo[1]; pos[k * 3 + 2] = this.x[o + 2] * xs[2] + xo[2] }
      else { pos[k * 3] = this.x[o]; pos[k * 3 + 1] = this.x[o + 1]; pos[k * 3 + 2] = this.x[o + 2] }
      let r = M.col[0], gg = M.col[1], b = M.col[2], gr = GK[m], e = 1
      const ph = this.ph[g]
      if (m === CRUST && fs.crustCol) { r = fs.crustCol[j * 3]; gg = fs.crustCol[j * 3 + 1]; b = fs.crustCol[j * 3 + 2] }
      // o calor: fogo arrefece com a idade; lava e magma têm crosta e veios quentes que mudam devagar
      let T = -1
      if (m === FIRE) T = 1 - Math.min(1, fs.age[j] / (M.ttl || 2)) * 0.95
      else if (m === EMBER) T = 0.75 + 0.2 * Math.sin(now * 5 + ph)
      else if (m === LAVA) T = 0.64 + 0.26 * Math.sin(now * 0.7 + ph * 3 + this.x[o] * 9)
      else if (m === MAGMA) T = 0.3 + 0.35 * Math.max(0, Math.sin(now * 0.45 + ph * 2 + this.x[o + 1] * 7))
      if (T >= 0) {
        blackbody(T, bb); r = bb[0]; gg = bb[1]; b = bb[2]
        gr = m === FIRE ? (T > 0.3 ? 2 : 1) : T > 0.45 ? 2 : 0  // o fogo frio já é fumo; a lava fria é crosta opaca
      } else if (gr === 2) e = (0.9 + 1.1 * M.glow) * (M.wave ? 0.75 + 0.35 * Math.sin(now * 4 + ph) : 1)
      if (M.prism) { const h = now * 0.6 + ph; r = 0.72 + 0.12 * Math.sin(h); gg = 0.76 + 0.12 * Math.sin(h + 2.1); b = 0.86 + 0.12 * Math.sin(h + 4.2) }
      // brilhos: o metal e os cristais apanham a luz de vez em quando (cintilam a sério, em vez de estrelas desenhadas)
      if (m === METAL || m === CRYSTAL) { const gl = Math.pow(Math.max(0, Math.sin(now * 1.7 + ph * 5)), 24); if (gl > 0.2) { e = 1 + gl * 4; gr = 2 } }
      r *= this.tone[o] * e; gg *= this.tone[o + 1] * e; b *= this.tone[o + 2] * e
      if (gr !== 2) {  // sombra no que é denso (lê-se o volume) e a luz que chega das matérias acesas ao pé (a lava alaranja a água)
        const oc = Math.max(0, Math.min(1, (this.dens[g] - 0.8) / 1.4)) * 0.4, L = this.lit
        r = r * (1 - oc) + L[o] * 1.4; gg = gg * (1 - oc) + L[o + 1] * 1.4; b = b * (1 - oc) + L[o + 2] * 1.4
      }
      const f = this.fl[g]
      if (f > 0.05) { r += 1.5 * f; gg += 1.4 * f; b += 1.2 * f; if (f > 0.25) gr = 2 }
      if (tc && tk > 0) { r += (tc[0] - r) * tk; gg += (tc[1] - gg) * tk; b += (tc[2] - b) * tk }
      col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b
      if (vel) { vel[k * 3] = this.v[o]; vel[k * 3 + 1] = this.v[o + 1]; vel[k * 3 + 2] = this.v[o + 2] }
      size[k] = GS[m] * (0.8 + 0.4 * ((ph * 7) % 1)) * (xf && !out ? sm : 1)
      alpha[k] = M.a * (fs.fade[j] > 0 ? 1 - fs.fade[j] : 1) * Math.min(1, this.age[g] / 0.3) * (gr === 1 ? 0.45 : gr === 2 ? 0.7 : 1)
      grp[k] = gr
      k++
    }
    return k
  }
}

// verificação rápida: os grãos seguem o fluido, ficam dentro do vidro e repartem-se por todas as matérias
export function selfcheck(FluidSim) {
  const f = new FluidSim(400, 3); f.setTargets({ water: 0.5, lava: 0.3, smoke: 0.2 }, 0.9)
  const gr = new Grains(2000, 5)
  for (let s = 0; s < 200; s++) { f.step(1 / 60, [0, 0, 0]); gr.step(f, 1 / 60) }
  const n = 2000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), al = new Float32Array(n), grp = new Float32Array(n)
  const k = gr.fill(f, pos, col, size, al, grp, 3)
  if (k < 1800) throw new Error('grãos a menos: ' + k)
  let far = 0, nan = 0, hot = 0
  for (let i = 0; i < k; i++) { const r = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); if (r > 0.9) far++; if (!isFinite(r)) nan++; if (col[i * 3] > 1.2) hot++ }
  if (nan) throw new Error('NaN nos grãos')
  if (far > k * 0.02) throw new Error('grãos fora do vidro: ' + far)
  if (!hot) throw new Error('a lava não brilha')
  return 'grãos ok (' + k + ', quentes ' + hot + ')'
}
