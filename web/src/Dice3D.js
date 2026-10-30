// Dados em 3D (three.js) sobre a física de dicephys.js: lançar, agarrar e atirar com o rato ou o dedo.
// createTray(el, {colors, onHit, onSettle}) -> {roll(types), clear(), dispose()}. onSettle([{type, v}]) quando todos param.
import * as THREE from 'three'
import { solid, makeWorld, readValue } from './dicephys.js'
import { needsMark } from './game.js'

const KINDS = { d4: ['d4'], d6: ['d6'], d8: ['d8'], d10: ['d10'], d12: ['d12'], d20: ['d20'], d100: ['d10t', 'd10'], moeda: ['coin'] }
const SIZE = { d4: 0.23, d8: 0.42, d10: 0.38, d10t: 0.3, d12: 0.46, d20: 0.36, coin: 0.2 }
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }
const VIEW = 5.2  // meia-largura visível do lado mais curto da mesa, em unidades do mundo (um dado ≈ 2)

// textura de uma face: fundo em gradiente e o número (ou pintas, ou cara/coroa), virado para `up`
function faceTexture(kind, label, colors, corners, words) {
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N
  const g = cv.getContext('2d'), [c0, c1, ink] = colors
  const grd = g.createRadialGradient(N * 0.4, N * 0.35, N * 0.05, N / 2, N / 2, N * 0.75); grd.addColorStop(0, c0); grd.addColorStop(1, c1)
  g.fillStyle = grd; g.fillRect(0, 0, N, N)
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'
  const text = (t, x, y, size, rot = 0, n = 0) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `800 ${Math.round(size * N)}px system-ui, sans-serif`; g.fillText(t, 0, 0)
    if (n && needsMark(t, n)) { const w = g.measureText(t).width; g.fillRect(-w / 2, size * N * 0.42, w, size * N * 0.09) }
    g.restore()
  }
  if (kind === 'd6') for (const [x, y] of PIPS[label]) { g.beginPath(); g.arc(N / 2 + x * N * 0.24, N / 2 + y * N * 0.24, N * 0.075, 0, 7); g.fill() }
  else if (kind === 'd4') corners.forEach(([u, v, lab]) => text(String(lab), N / 2 + u * N * 0.27, N / 2 - v * N * 0.27, SIZE.d4, Math.atan2(u, v)))  // cada número a apontar para o seu vértice
  else if (kind === 'coin') { g.strokeStyle = ink; g.lineWidth = N * 0.025; g.beginPath(); g.arc(N / 2, N / 2, N * 0.4, 0, 7); g.stroke(); text(label === 1 ? '♛' : '✦', N / 2, N * 0.42, 0.24); text(words[label - 1], N / 2, N * 0.66, 0.11) }
  else text(kind === 'd10t' ? String(label).padStart(2, '0') : String(label), N / 2, N / 2, SIZE[kind], 0, { d8: 8, d10: 10, d10t: 100, d12: 12, d20: 20 }[kind])
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
  return tex
}

// malha de um sólido: uma face = um grupo com a sua textura; UV no plano da face, com o «cima» a apontar para o 1.º vértice
// sw = [a, b]: as faces a e b trocam de número (um dado que cai no a mostra o b): é assim que o dado assenta num valor dado
const swap = (sw, v) => (!sw ? v : v === sw[0] ? sw[1] : v === sw[1] ? sw[0] : v)
const rng32 = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }  // mulberry32
function meshOf(kind, colors, words, sw) {
  const S = solid(kind), pos = [], uv = [], nor = [], geo = new THREE.BufferGeometry(), mats = []
  const side = new THREE.MeshStandardMaterial({ color: colors[1], roughness: 0.35, metalness: kind === 'coin' ? 0.55 : 0.05 })
  S.faces.forEach((f, i) => {
    const { c, n } = S.info[i], P = k => S.verts[f[k]]
    const d = v => [v[0] - c[0], v[1] - c[1], v[2] - c[2]], dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    // d6: o «cima» aponta para o meio de um lado e o quadrado ocupa a textura toda (pintas alinhadas); os outros apontam para um vértice
    const u0 = kind === 'd6' ? d(P(0).map((x, j) => (x + P(1)[j]) / 2)) : d(P(0)), L = Math.hypot(...u0), up = u0.map(x => x / L), rt = [n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]]
    const R = kind === 'd6' ? L : Math.max(...f.map((_, k) => Math.hypot(...d(P(k)))))
    const UV = v => { const q = d(v); return [0.5 + (0.5 * dt(q, rt)) / R, 0.5 + (0.5 * dt(q, up)) / R] }
    const start = pos.length / 3
    for (let k = 1; k < f.length - 1; k++) {
      let tri = [P(0), P(k), P(k + 1)]
      const e1 = d(tri[1]).map((x, j) => x - d(tri[0])[j]), e2 = d(tri[2]).map((x, j) => x - d(tri[0])[j])
      if (dt([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], n) < 0) tri = [tri[0], tri[2], tri[1]]
      for (const v of tri) { pos.push(...v); uv.push(...UV(v)); nor.push(...n) }
    }
    geo.addGroup(start, pos.length / 3 - start, i)
    const labelled = kind !== 'coin' || i < 2
    if (!labelled) { mats.push(side); return }
    const corners = kind === 'd4' ? f.map(vi => { const [a, b] = UV(S.verts[vi]); return [(a - 0.5) * 2, (b - 0.5) * 2, S.labels[vi]] }) : null
    mats.push(new THREE.MeshStandardMaterial({ map: faceTexture(kind, swap(sw, S.labels[i]), colors, corners, words), roughness: kind === 'coin' ? 0.3 : 0.42, metalness: kind === 'coin' ? 0.45 : 0.04 }))
  })
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const mesh = new THREE.Mesh(geo, mats); mesh.castShadow = true
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }))
  mesh.add(edges)
  return mesh
}

// box = [X, Z]: caixa fixa (mesa livre: igual em todos os ecrãs, para a mesma física dar o mesmo lançamento); rot: rodar a
// vista (o adversário vê a mesa do lado dele); onThrow(types, {x, v}): agarrar e largar um dado não o lança já — pede o
// lançamento (o servidor sorteia e devolve-o a todos) e o dado fica na mão até chegar
export function createTray(el, { colors, words = ['Cara', 'Coroa'], onHit, onSettle, view = VIEW, box = null, rot = 0, onThrow = null, cloth = false }) {  // cloth: o pano com aro onde os dados assentam (mesas do Forge Play e livre); view maior = dados mais pequenos
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.className = 'dc-gl'; el.appendChild(renderer.domElement)
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x302040, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-6, 18, 8); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 }); scene.add(sun)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.32 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
  const table = new THREE.Group(); table.rotation.y = rot; scene.add(table)
  // o tabuleiro dos dados: um pano escuro com aro dourado do tamanho da caixa da física (onde os dados batem e assentam),
  // só à vista enquanto há dados na mesa
  const tray = new THREE.Group(), flat = g => { g.rotateX(-Math.PI / 2); return g }
  tray.add(new THREE.Mesh(flat(new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ color: 0x0d1424, transparent: true, opacity: 0.22, depthWrite: false })))
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(flat(new THREE.PlaneGeometry(1, 1))), new THREE.LineBasicMaterial({ color: 0xf2b84b, transparent: true, opacity: 0.5 })); rim.position.y = 0.01; tray.add(rim)
  tray.visible = false; table.add(tray)
  let world = makeWorld(box ? { X: box[0], Z: box[1] } : {}), groups = [], meshes = [], raf = 0, X = box?.[0] ?? 6, Z = box?.[1] ?? 4, settled = true
  const ext = () => { const c = Math.abs(Math.cos(table.rotation.y)), s = Math.abs(Math.sin(table.rotation.y)); return [c * X + s * Z, s * X + c * Z] }  // meias-medidas da caixa no ecrã

  const fit = () => {
    const w = el.clientWidth || 300, h = el.clientHeight || 300, a = w / h
    // abertura horizontal até 50°: numa mesa larga e baixa a câmara afasta-se em vez de ficar grande angular (dados deformados nas pontas)
    camera.fov = Math.min(32, (2 * Math.atan(Math.tan((25 * Math.PI) / 180) / a) * 180) / Math.PI)
    const [hx, hz] = ext(), halfH = box ? Math.max(hz / 0.9, hx / a / 0.94) : view / Math.min(1, a), dist = halfH / Math.tan((camera.fov * Math.PI) / 360)
    camera.aspect = a; camera.position.set(0, dist, dist * 0.12); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    if (!box) { X = halfH * a * 0.94; Z = halfH * 0.86; world.setBox(X, Z) }
    tray.scale.set(2 * X, 1, 2 * Z)
    render()
  }
  const render = () => renderer.render(scene, camera)
  const sync = () => meshes.forEach(({ mesh, b }) => { mesh.position.set(...b.x); mesh.quaternion.set(...b.q) })
  let lastHit = 0
  const hit = sp => { const now = performance.now(); if (now - lastHit > 60) { lastHit = now; onHit?.(Math.min(1, sp / 14)) } }
  const report = () => onSettle?.(groups.map(g => {
    const vs = g.bodies.map(b => swap(b.sw, readValue(b)))
    return { type: g.type, v: g.type === 'd100' ? (vs[0] + vs[1] || 100) : g.type === 'd10' ? vs[0] || 10 : vs[0], ...(g.type === 'd100' && { parts: vs }) }
  }))
  let tPrev = 0
  const loop = now => {
    const n = tPrev ? Math.max(1, Math.min(16, Math.round((now - tPrev) / 1000 / world.DT))) : 4; tPrev = now  // pelo tempo real (aparelhos lentos não ficam em câmara lenta)
    for (let k = 0; k < n; k++) world.step(hit)
    sync(); render()
    if (world.done() && !drag) { tPrev = 0; if (!settled) { settled = true; report() } return }
    raf = requestAnimationFrame(loop)
  }
  const kick = () => { settled = false; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) }
  const clear = () => {
    cancelAnimationFrame(raf)
    for (const { mesh } of meshes) { table.remove(mesh); mesh.geometry.dispose(); [].concat(mesh.material).forEach(m => { m.map?.dispose(); m.dispose() }) }
    meshes = []; groups = []; world = makeWorld({ X, Z }); tray.visible = false; render()
  }
  // want = [valor por tipo] (só dados de um corpo: d6, d20, moeda…): o lançamento corre primeiro sem desenhar com uma
  // semente, vê-se em que face cada dado cai e essa face troca de número com a pedida; depois corre a sério com a mesma
  // semente (a física é determinista) e o dado assenta mesmo no valor pedido
  // opt = {seed, thr: {x, v}}: a mesma semente e o mesmo gesto dão o mesmo lançamento em todos os ecrãs (caixa fixa)
  const throwAll = (w, all, seed, thr) => {
    const jr = rng32(seed ^ 0x5bd1e995)
    return all.map(([, k], j) => {
      const b = w.throwDie(k, j, all.length)
      if (thr) {  // do sítio onde o largaste, com a velocidade do gesto (vários dados lado a lado, cada um um pouco diferente)
        const off = (j - (all.length - 1) / 2) * 1.1, lim = (L, v) => Math.max(-L + b.S.R, Math.min(L - b.S.R, v))
        b.x = [lim(X, thr.x[0] + off), Math.max(1.2, thr.x[1]), lim(Z, thr.x[2] + off * 0.4)]
        b.v = thr.v.map((v, d) => v * (0.92 + jr() * 0.16) + (d === 1 ? 0 : (jr() - 0.5) * 1.5))
      }
      return b
    })
  }
  const roll = (types, want, opt = {}) => {
    clear()
    const all = types.flatMap(t => KINDS[t].map(k => [t, k]))
    let sws = [], bodies = null
    const seed = opt.seed ?? (Math.random() * 2 ** 32) >>> 0, thr = opt.thr?.x && opt.thr?.v ? opt.thr : null
    if (want || opt.seed != null) {
      if (want) {
        const pre = makeWorld({ X, Z, rng: rng32(seed) })
        throwAll(pre, all, seed, thr)
        while (!pre.done()) pre.step()
        sws = pre.bodies.map((b, j) => [readValue(b), want[j]])
      }
      world = makeWorld({ X, Z, rng: rng32(seed) })
      bodies = throwAll(world, all, seed, thr)
    }
    let i = 0
    for (const t of types) {
      const g = { type: t, bodies: [] }
      for (const k of KINDS[t]) {
        const sw = sws[i], b = bodies ? bodies[i] : world.throwDie(k, i, all.length), mesh = meshOf(k, colors[k === 'd10t' ? 'd100' : t] || colors.d6, words, sw)
        i++
        b.sw = sw
        mesh.userData.b = b; table.add(mesh); meshes.push({ mesh, b }); g.bodies.push(b)
      }
      groups.push(g)
    }
    tray.visible = cloth
    kick()
  }

  // agarrar e atirar
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.4), at = new THREE.Vector3()
  let drag = null
  const pick = e => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera) }
  const onPlane = () => (ray.ray.intersectPlane(plane, at) ? table.worldToLocal(at.clone()) : null)  // na mesa (rodada), não no ecrã
  const onDown = (e, capture = true) => {
    pick(e)
    const h = ray.intersectObjects(meshes.map(m => m.mesh), false)[0]
    if (!h || pending) return false
    e.preventDefault(); if (capture) renderer.domElement.setPointerCapture?.(e.pointerId)
    const b = h.object.userData.b
    world.hold(b); drag = { b, hist: [] }
    const p = onPlane()
    if (p) world.moveTo(b, [p.x, 2.4, p.z], [0, 0, 0])
    kick()
    return true
  }
  const onMove = e => {
    if (!drag) return
    pick(e)
    const p = onPlane()
    if (!p) return
    const now = performance.now(), b = drag.b
    drag.hist.push([now, p.x, p.z]); drag.hist = drag.hist.filter((x, k, a) => now - x[0] < 90 || k >= a.length - 3)  // os últimos ~90 ms do gesto (pelo menos 3 pontos: num aparelho lento os eventos vêm espaçados)
    world.moveTo(b, [p.x, 2.4, p.z], [0, 0, 0])
    const w = 0.05; b.q = new THREE.Quaternion(...b.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(w, w * 0.7, 0))).toArray()  // a rodar na mão
  }
  const onUp = () => {
    if (!drag) return
    const h = drag.hist, b = drag.b
    let v = [0, 0, 0]
    if (h.length > 1) { const [t0, x0, z0] = h[0], [t1, x1, z1] = h[h.length - 1], dt = Math.max(0.016, (t1 - t0) / 1000); v = [(x1 - x0) / dt, 1.5, (z1 - z0) / dt] }
    drag = null
    if (!onThrow) { world.release(b, v); kick(); return }
    // lançamento partilhado: o dado fica na mão até o servidor devolver o lançamento (roll limpa-o e lança a sério)
    const sp = Math.hypot(v[0], v[2]), k = sp < 6 ? 6 / Math.max(0.01, sp) : sp > 40 ? 40 / sp : 1  // um pousar quase parado ainda rola um pouco
    const thr = { x: b.x.map(n => +n.toFixed(3)), v: [v[0] * k, 1.5 + Math.min(4, sp / 10), v[2] * k].map(n => +n.toFixed(3)) }
    if (sp < 0.01) thr.v = [0, 2, -6]
    pending = b
    Promise.resolve(onThrow(groups.map(g => g.type), thr)).catch(() => { if (pending === b) { world.release(b, v); kick() } }).finally(() => { if (pending === b) pending = null })
  }
  let pending = null
  // agarrar a partir de um toque fora da camada (a camada não apanha o rato para as cartas responderem por baixo)
  const grab = e => {
    if (!onDown(e, false)) return false
    const up = ev => { removeEventListener('pointermove', onMove); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); onUp(ev) }
    addEventListener('pointermove', onMove); addEventListener('pointerup', up); addEventListener('pointercancel', up)
    return true
  }
  // o lançamento de um botão: do teu lado da mesa (em baixo no teu ecrã) para a frente, com um pouco de acaso
  const throwFrom = () => {
    const [, hz] = ext(), Y = new THREE.Vector3(0, 1, 0), r = -table.rotation.y
    const p = new THREE.Vector3((Math.random() - 0.5) * 3, 3, hz * 0.8).applyAxisAngle(Y, r), v = new THREE.Vector3((Math.random() - 0.5) * 8, 2, -(18 + Math.random() * 8)).applyAxisAngle(Y, r)
    return { x: p.toArray().map(n => +n.toFixed(3)), v: v.toArray().map(n => +n.toFixed(3)) }
  }
  const setRot = a => { if (table.rotation.y !== a) { table.rotation.y = a; fit() } }
  const cv = renderer.domElement
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp)
  const ro = new ResizeObserver(fit); ro.observe(el); fit()
  return {
    roll, clear, grab, throwFrom, setRot, has: () => meshes.length > 0,
    dispose: () => { clear(); ro.disconnect(); renderer.dispose(); cv.remove() },
  }
}

export const webglOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } }
