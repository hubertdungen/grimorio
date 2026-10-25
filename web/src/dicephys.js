// Física dos dados 3D (sem dependências, corre no browser e no Node): sólidos convexos (d4–d20, moeda) que caem numa
// caixa (chão + 4 paredes), com ressalto, atrito e rotação. O resultado é a face virada para cima (no d4, o vértice).
// ponytail: inércia isotrópica (esfera) e choques entre dados como esferas; chega para dados e poupa um motor inteiro.

const PHI = (1 + Math.sqrt(5)) / 2
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = a => Math.hypot(a[0], a[1], a[2])
const norm = a => mul(a, 1 / (len(a) || 1))
// quaterniões [x, y, z, w]
export const qrot = (q, v) => {
  const [x, y, z, w] = q, u = [x, y, z], t = mul(cross(u, v), 2)
  return add(add(v, mul(t, w)), cross(u, t))
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
const qnorm = q => { const l = Math.hypot(...q) || 1; return q.map(x => x / l) }
export function randQuat(r = Math.random) {  // uniforme (Shoemake)
  const u1 = r(), u2 = r() * 2 * Math.PI, u3 = r() * 2 * Math.PI, a = Math.sqrt(1 - u1), b = Math.sqrt(u1)
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)]
}

// faces a partir das normais: os vértices mais avançados nessa direção, por ordem à volta da normal
function facesBy(verts, normals) {
  return normals.map(n0 => {
    const n = norm(n0), top = Math.max(...verts.map(v => dot(v, n)))
    const ids = verts.map((v, i) => i).filter(i => dot(verts[i], n) > top - 1e-6)
    return sortRound(verts, ids, n)
  })
}
function sortRound(verts, ids, n) {
  const c = mul(ids.reduce((a, i) => add(a, verts[i]), [0, 0, 0]), 1 / ids.length)
  const u = norm(sub(verts[ids[0]], c)), w = cross(n, u)
  return [...ids].sort((a, b) => { const p = sub(verts[a], c), q = sub(verts[b], c); return Math.atan2(dot(p, w), dot(p, u)) - Math.atan2(dot(q, w), dot(q, u)) })
}
const scaleTo = (verts, R) => { const m = Math.max(...verts.map(len)); return verts.map(v => mul(v, R / m)) }
const signs3 = [-1, 1].flatMap(a => [-1, 1].flatMap(b => [-1, 1].map(c => [a, b, c])))
const cyc = (a, b, c) => [[a, b, c], [b, c, a], [c, a, b]]
const icoV = () => [-1, 1].flatMap(s => [-1, 1].flatMap(t => cyc(0, s, t * PHI)))  // vértices do d20
const dodV = () => [...signs3, ...[-1, 1].flatMap(s => [-1, 1].flatMap(t => cyc(0, s / PHI, t * PHI)))]  // vértices do d12
const dodN = () => [-1, 1].flatMap(s => [-1, 1].flatMap(t => cyc(0, s * PHI, t)))  // normais das faces do d12
const icoN = () => [...signs3, ...[-1, 1].flatMap(s => [-1, 1].flatMap(t => cyc(0, s * PHI, t / PHI)))]  // normais das faces do d20
// pares de faces opostas somam n+1 (como nos dados a sério); devolve o valor de cada face
function opposite(normals, n, zero = false) {
  const out = Array(normals.length).fill(0)
  let v = 1
  normals.forEach((a, i) => {
    if (out[i]) return
    const j = normals.findIndex((b, k) => k !== i && dot(norm(a), norm(b)) < -0.999)
    out[i] = v; if (j >= 0) out[j] = n + 1 - v; v++
  })
  return zero ? out.map(x => x % n) : out  // d10: 1..10 → 1..9, 0
}

function build(kind) {
  let verts, faces, labels
  if (kind === 'd4') {
    verts = scaleTo([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], 1.05)
    faces = verts.map((v, i) => sortRound(verts, [0, 1, 2, 3].filter(k => k !== i), mul(norm(v), -1)))
    labels = [1, 2, 3, 4]  // por vértice
  } else if (kind === 'd6') {
    verts = signs3.map(v => mul(v, 0.62))
    const ns = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
    faces = facesBy(verts, ns); labels = [1, 6, 2, 5, 3, 4]
  } else if (kind === 'd8') {
    verts = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(v => mul(v, 0.95))
    const ns = signs3; faces = facesBy(verts, ns); labels = opposite(ns, 8)
  } else if (kind === 'd12') {
    verts = scaleTo(dodV(), 1.0); const ns = dodN(); faces = facesBy(verts, ns); labels = opposite(ns, 12)
  } else if (kind === 'd20') {
    verts = scaleTo(icoV(), 1.0); const ns = icoN(); faces = facesBy(verts, ns); labels = opposite(ns, 20)
  } else if (kind === 'd10' || kind === 'd10t') {  // trapezoedro pentagonal: H = a(1+cos36)/(1-cos36) para os papagaios serem planos
    const a = 0.1, H = (a * (1 + Math.cos(Math.PI / 5))) / (1 - Math.cos(Math.PI / 5)), ring = k => [Math.cos((k * Math.PI) / 5), (k % 2 ? -a : a), Math.sin((k * Math.PI) / 5)]
    verts = [[0, H, 0], [0, -H, 0], ...Array.from({ length: 10 }, (_, k) => ring(k))]
    verts = scaleTo(verts.map(v => [v[0] * 0.95, v[1], v[2] * 0.95]), 1.0)
    const R = k => 2 + (k % 10)
    faces = [...Array.from({ length: 5 }, (_, i) => [0, R(2 * i + 2), R(2 * i + 1), R(2 * i)]), ...Array.from({ length: 5 }, (_, i) => [1, R(2 * i + 1), R(2 * i + 2), R(2 * i + 3)])]
    const ns = faces.map(f => norm(cross(sub(verts[f[1]], verts[f[0]]), sub(verts[f[2]], verts[f[0]]))))
    faces = faces.map((f, k) => (dot(ns[k], verts[f[0]]) < 0 ? [...f].reverse() : f)).map(f => (f[0] > 1 ? [f.find(i => i < 2), ...f.filter(i => i > 1)] : f))
    labels = opposite(faces.map(f => mul(add(add(verts[f[0]], verts[f[1]]), add(verts[f[2]], verts[f[3]])), 0.25)), 10, true)
    if (kind === 'd10t') labels = labels.map(x => x * 10)  // dezenas do d100: 00, 10 … 90
  } else if (kind === 'coin') {
    const N = 20, r = 1, h = 0.09
    verts = [h, -h].flatMap(y => Array.from({ length: N }, (_, k) => [r * Math.cos((2 * k * Math.PI) / N), y, r * Math.sin((2 * k * Math.PI) / N)]))
    faces = [sortRound(verts, Array.from({ length: N }, (_, k) => k), [0, 1, 0]), sortRound(verts, Array.from({ length: N }, (_, k) => N + k), [0, -1, 0]),
      ...Array.from({ length: N }, (_, k) => [k, (k + 1) % N, N + ((k + 1) % N), N + k])]
    labels = [1, 2]  // cara, coroa; o resto é o rebordo
  }
  // normais e centros das faces (para ler o resultado e desenhar os números)
  const info = faces.map(f => {
    const c = mul(f.reduce((s, i) => add(s, verts[i]), [0, 0, 0]), 1 / f.length)
    let n = norm(cross(sub(verts[f[1]], verts[f[0]]), sub(verts[f[2]], verts[f[0]])))
    if (dot(n, c) < 0) n = mul(n, -1)
    return { c, n }
  })
  const R = Math.max(...verts.map(len))
  return { kind, verts, faces, labels, info, R }
}
const CACHE = {}
export const solid = kind => (CACHE[kind] ??= build(kind))

// o valor: a face mais virada para cima (d4: o vértice mais alto; moeda: cara ou coroa)
export function readValue(b) {
  const S = solid(b.kind)
  if (b.kind === 'd4') { let k = 0, best = -1e9; S.verts.forEach((v, i) => { const y = qrot(b.q, v)[1]; if (y > best) { best = y; k = i } }); return S.labels[k] }
  let k = 0, best = -2
  S.info.forEach((f, i) => { if (i < S.labels.length || b.kind !== 'coin') { const y = qrot(b.q, f.n)[1]; if (y > best) { best = y; k = i } } })
  return S.labels[k]
}

// ---------- mundo ----------
const G = -32, E = 0.32, MU = 0.45, DT = 1 / 240
export function makeWorld({ X = 6, Z = 4, rng = Math.random } = {}) {
  const planes = [[[0, 1, 0], 0], [[1, 0, 0], -X], [[-1, 0, 0], -X], [[0, 0, 1], -Z], [[0, 0, -1], -Z], [[0, -1, 0], -14]]  // n·p ≥ d
  const bodies = []
  const throwDie = (kind, k, n) => {
    const S = solid(kind), side = rng() < 0.5 ? -1 : 1
    const b = { kind, S, x: [side * (X - 1.4), 2.5 + rng() * 2.5, ((k + 0.5) / n - 0.5) * Z * 1.2], q: randQuat(rng),
      v: [-side * (7 + rng() * 6), 2 + rng() * 3, (rng() - 0.5) * 6], w: [(rng() - 0.5) * 30, (rng() - 0.5) * 30, (rng() - 0.5) * 30],
      m: 1, I: 0.4 * (S.R * 0.85) ** 2, rest: 0, asleep: false, rs: S.R * (kind === 'coin' ? 0.95 : 0.82) }
    bodies.push(b); return b
  }
  let t = 0
  const step = onHit => {
    t += DT
    for (const b of bodies) {
      if (b.asleep || b.held) continue  // held: agarrado pelo rato/dedo (a posição vem de fora)
      b.v[1] += G * DT
      b.x = add(b.x, mul(b.v, DT))
      const wl = len(b.w)
      if (wl > 1e-9) { const h = (wl * DT) / 2, s = Math.sin(h) / wl; b.q = qnorm(qmul([b.w[0] * s, b.w[1] * s, b.w[2] * s, Math.cos(h)], b.q)) }
      // contactos com a caixa: cada vértice que entrou num plano leva um impulso (normal + atrito)
      let touch = false
      for (const [n, d] of planes) {
        let deep = 0
        for (const vl of b.S.verts) {
          const r = qrot(b.q, vl), p = add(b.x, r), pen = d - dot(p, n)
          if (pen <= 0) continue
          touch = true; deep = Math.max(deep, pen)
          const vp = add(b.v, cross(b.w, r)), vn = dot(vp, n)
          if (vn >= 0) continue
          const rn = cross(r, n), j = (-(1 + (vn < -1.2 ? E : 0)) * vn) / (1 / b.m + dot(rn, rn) / b.I)
          b.v = add(b.v, mul(n, j / b.m)); b.w = add(b.w, mul(rn, j / b.I))
          if (vn < -2.5 && onHit) onHit(-vn)
          const vp2 = add(b.v, cross(b.w, r)), vt = sub(vp2, mul(n, dot(vp2, n))), vtl = len(vt)
          if (vtl > 1e-6) {
            const tdir = mul(vt, 1 / vtl), rt = cross(r, tdir), jt = Math.min(vtl / (1 / b.m + dot(rt, rt) / b.I), MU * j)
            b.v = sub(b.v, mul(tdir, jt / b.m)); b.w = sub(b.w, mul(rt, jt / b.I))
          }
        }
        if (deep > 0) b.x = add(b.x, mul(n, deep * 0.8))
      }
      if (touch) {  // rolar gasta energia; já devagar, trava mais (senão fica a abanar numa aresta)
        const slow = len(b.v) < 0.6 && len(b.w) < 1.5
        b.w = mul(b.w, 1 - (slow ? 6 : 1.6) * DT); b.v = mul(b.v, 1 - (slow ? 3 : 0.6) * DT)
      }
      const still = len(b.v) < 0.25 && len(b.w) < 0.35 && touch  // a gravidade sozinha dá 0,13 por passo
      b.rest = still ? b.rest + DT : 0
      if (b.rest > 0.25) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0] }
    }
    // choques entre dados (esferas)
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i], B = bodies[j], dlt = sub(B.x, A.x), dist = len(dlt), min = A.rs + B.rs
      if (dist >= min || dist < 1e-9) continue
      const n = mul(dlt, 1 / dist), rel = dot(sub(A.v, B.v), n), push = (min - dist) / 2
      const fa = A.asleep || A.held, fb = B.asleep || B.held
      if (rel <= 0 && fa && fb) continue
      A.x = sub(A.x, mul(n, fa ? 0 : fb ? push * 2 : push)); B.x = add(B.x, mul(n, fb ? 0 : fa ? push * 2 : push))
      if (rel > 0) {
        if (rel > 0.6) { A.asleep = B.asleep = false; A.rest = B.rest = 0 }
        const k = rel * 0.8
        if (!A.held) A.v = sub(A.v, mul(n, k))
        if (!B.held) B.v = add(B.v, mul(n, k))
        A.w = add(A.w, mul(cross(n, [0, 1, 0]), k * 2)); B.w = sub(B.w, mul(cross(n, [0, 1, 0]), k * 2))
        if (rel > 2 && onHit) onHit(rel)
      }
    }
  }
  const done = () => bodies.every(b => b.asleep && !b.held) || t > 9
  // agarrar e atirar à mão: enquanto agarrado segue o ponteiro; ao largar leva a velocidade do gesto e um pouco de rotação
  const hold = b => { b.held = true; b.asleep = false; b.rest = 0 }
  const moveTo = (b, x, v) => { b.x = [Math.max(-X + b.S.R, Math.min(X - b.S.R, x[0])), x[1], Math.max(-Z + b.S.R, Math.min(Z - b.S.R, x[2]))]; b.v = v }
  const release = (b, v) => {
    b.held = false; t = 0
    const sp = Math.min(30, len(v)); b.v = sp > 0.01 ? mul(v, sp / len(v)) : [0, 0, 0]
    b.w = [(rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2].map(x => x * (8 + sp * 1.2))
  }
  const restart = () => { t = 0 }
  const setBox = (x, z) => { X = x; Z = z; planes[1][1] = planes[2][1] = -X; planes[3][1] = planes[4][1] = -Z }  // a mesa mudou de tamanho
  return { bodies, throwDie, step, done, time: () => t, box: () => [X, Z], DT, hold, moveTo, release, restart, setBox }
}

// lançamento completo sem desenhar (testes): devolve os valores
export function simulate(kinds, opts) {
  const w = makeWorld(opts)
  kinds.forEach((k, i) => w.throwDie(k, i, kinds.length))
  while (!w.done()) w.step()
  return { values: w.bodies.map(readValue), t: w.time(), bodies: w.bodies }
}
