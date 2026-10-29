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
function meshOf(kind, colors, words) {
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
    mats.push(new THREE.MeshStandardMaterial({ map: faceTexture(kind, S.labels[i], colors, corners, words), roughness: kind === 'coin' ? 0.3 : 0.42, metalness: kind === 'coin' ? 0.45 : 0.04 }))
  })
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const mesh = new THREE.Mesh(geo, mats); mesh.castShadow = true
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }))
  mesh.add(edges)
  return mesh
}

export function createTray(el, { colors, words = ['Cara', 'Coroa'], onHit, onSettle, view = VIEW }) {  // view maior = dados mais pequenos
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.className = 'dc-gl'; el.appendChild(renderer.domElement)
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x302040, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-6, 18, 8); sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 }); scene.add(sun)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.32 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
  let world = makeWorld(), groups = [], meshes = [], raf = 0, X = 6, Z = 4, settled = true

  const fit = () => {
    const w = el.clientWidth || 300, h = el.clientHeight || 300, a = w / h
    // abertura horizontal até 50°: numa mesa larga e baixa a câmara afasta-se em vez de ficar grande angular (dados deformados nas pontas)
    camera.fov = Math.min(32, (2 * Math.atan(Math.tan((25 * Math.PI) / 180) / a) * 180) / Math.PI)
    const halfH = view / Math.min(1, a), dist = halfH / Math.tan((camera.fov * Math.PI) / 360)
    camera.aspect = a; camera.position.set(0, dist, dist * 0.12); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    X = halfH * a * 0.94; Z = halfH * 0.86; world.setBox(X, Z)
    render()
  }
  const render = () => renderer.render(scene, camera)
  const sync = () => meshes.forEach(({ mesh, b }) => { mesh.position.set(...b.x); mesh.quaternion.set(...b.q) })
  let lastHit = 0
  const hit = sp => { const now = performance.now(); if (now - lastHit > 60) { lastHit = now; onHit?.(Math.min(1, sp / 14)) } }
  const report = () => onSettle?.(groups.map(g => {
    const vs = g.bodies.map(readValue)
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
    for (const { mesh } of meshes) { scene.remove(mesh); mesh.geometry.dispose(); [].concat(mesh.material).forEach(m => { m.map?.dispose(); m.dispose() }) }
    meshes = []; groups = []; world = makeWorld({ X, Z }); render()
  }
  const roll = types => {
    clear()
    const all = types.flatMap(t => KINDS[t].map(k => [t, k]))
    let i = 0
    for (const t of types) {
      const g = { type: t, bodies: [] }
      for (const k of KINDS[t]) {
        const b = world.throwDie(k, i++, all.length), mesh = meshOf(k, colors[k === 'd10t' ? 'd100' : t] || colors.d6, words)
        mesh.userData.b = b; scene.add(mesh); meshes.push({ mesh, b }); g.bodies.push(b)
      }
      groups.push(g)
    }
    kick()
  }

  // agarrar e atirar
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.4), at = new THREE.Vector3()
  let drag = null
  const pick = e => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera) }
  const onDown = e => {
    pick(e)
    const h = ray.intersectObjects(meshes.map(m => m.mesh), false)[0]
    if (!h) return
    e.preventDefault(); renderer.domElement.setPointerCapture?.(e.pointerId)
    const b = h.object.userData.b
    world.hold(b); drag = { b, hist: [] }
    if (ray.ray.intersectPlane(plane, at)) world.moveTo(b, [at.x, 2.4, at.z], [0, 0, 0])
    kick()
  }
  const onMove = e => {
    if (!drag) return
    pick(e)
    if (!ray.ray.intersectPlane(plane, at)) return
    const now = performance.now(), b = drag.b
    drag.hist.push([now, at.x, at.z]); drag.hist = drag.hist.filter(x => now - x[0] < 90)
    world.moveTo(b, [at.x, 2.4, at.z], [0, 0, 0])
    const w = 0.05; b.q = new THREE.Quaternion(...b.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(w, w * 0.7, 0))).toArray()  // a rodar na mão
  }
  const onUp = () => {
    if (!drag) return
    const h = drag.hist, b = drag.b
    let v = [0, 0, 0]
    if (h.length > 1) { const [t0, x0, z0] = h[0], [t1, x1, z1] = h[h.length - 1], dt = Math.max(0.016, (t1 - t0) / 1000); v = [(x1 - x0) / dt, 1.5, (z1 - z0) / dt] }
    world.release(b, v); drag = null; kick()
  }
  const cv = renderer.domElement
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp)
  const ro = new ResizeObserver(fit); ro.observe(el); fit()
  return {
    roll, clear,
    dispose: () => { clear(); ro.disconnect(); renderer.dispose(); cv.remove() },
  }
}

export const webglOk = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } }
