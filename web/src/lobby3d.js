// Lobby 3D da mesa livre (antes de começar): uma mesa com a caixa do deck de cada jogador (altura pelo número de cartas,
// lados nas cores do deck, a capa na tampa). As caixas agarram-se, atiram-se e chocam umas com as outras; clicar numa
// caixa (sem a arrastar) avisa o componente (abrir o deck, se o dono deixar). Aberta, as cartas saltam da caixa e
// espalham-se na mesa e cada uma agarra-se e atira-se (à maneira do Tabletop Simulator). A moeda de quem começa vai ao
// ar e cai ao pé da caixa de quem começa.
import * as THREE from 'three'

const COL = { W: '#f5c451', U: '#38a8f0', B: '#6b4a8a', R: '#e2452f', G: '#3fa65a', C: '#9aa3ad' }
const BX = 5.2, BZ = 3.1  // a mesa: meia largura e meia fundura
const load = new THREE.TextureLoader()
const texCache = new Map()
// uma imagem (capa, carta): enquanto carrega ou se falhar, o material fica com a cor de reserva (não preto)
const tex = (url, mat, fallback) => {
  if (!url) return null
  if (!texCache.has(url)) texCache.set(url, new Promise(ok => load.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; ok(t) }, undefined, () => ok(null))))
  texCache.get(url).then(t => { if (mat) { mat.map = t || fallback || null; mat.needsUpdate = true } })
  return null
}
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t }

export function createLobby(el, { onClick } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  el.append(renderer.domElement)
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(38, 1, 0.1, 60)
  cam.position.set(0, 6.6, 5.4); cam.lookAt(0, 0, 0.3)
  scene.add(new THREE.AmbientLight('#ffffff', 0.75))
  const sun = new THREE.DirectionalLight('#fff4e0', 1.25); sun.position.set(3, 9, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 5, bottom: -5 }); scene.add(sun)
  const felt = canvasTex(512, 320, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.7); gr.addColorStop(0, '#2c5a43'); gr.addColorStop(1, '#14301f'); g.fillStyle = gr; g.fillRect(0, 0, w, h)
    g.strokeStyle = '#d6b36a55'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20) })
  const table = new THREE.Mesh(new THREE.PlaneGeometry(BX * 2 + 0.6, BZ * 2 + 0.6), new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95 }))
  table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table)

  // ---- corpos: caixas e cartas (física no plano da mesa; a altura é só desenho) ----
  const boxes = new Map(), cards = []
  let coin = null
  const label = (s, d) => canvasTex(256, 96, (g, w, h) => {
    const cs = s.cols.length ? s.cols : ['C'], gr = g.createLinearGradient(0, 0, w, 0)
    cs.forEach((c, i) => gr.addColorStop(cs.length > 1 ? i / (cs.length - 1) : 0, COL[c] || COL.C)); if (cs.length === 1) gr.addColorStop(1, COL[cs[0]] || COL.C)
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#0d1018cc'; g.fillRect(6, 6, w - 12, h - 12)
    g.fillStyle = '#f2b84b'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'
    g.fillText(String(s.name).slice(0, 18), w / 2, 36); g.fillStyle = '#cbd5e1'; g.font = '20px sans-serif'
    g.fillText(`${s.show || s.mine ? (s.show ? '👁' : '🔒') : '🔒'} ${s.n} · ${String(d || '').slice(0, 16)}`, w / 2, 72)
  })
  const sideTex = cols => canvasTex(64, 64, (g, w, h) => { const cs = cols.length ? cols : ['C']; cs.forEach((c, i) => { g.fillStyle = COL[c] || COL.C; g.fillRect(0, (i * h) / cs.length, w, h / cs.length + 1) }) })
  const makeBox = s => {
    const H = 0.22 + Math.min(1, (s.n || 60) / 100) * 0.55, side = new THREE.MeshStandardMaterial({ map: sideTex(s.cols), roughness: 0.6 })
    const st = sideTex(s.cols), top = new THREE.MeshStandardMaterial({ map: st, roughness: 0.5 }); tex(s.cover, top, st)
    const front = new THREE.MeshStandardMaterial({ map: label(s, s.deck), roughness: 0.7 })
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.15, H * 1.2, 1.6), [side, side, top, side, front, side])
    m.castShadow = true; m.userData = { key: s.key, kind: 'box', H: H * 1.2 }; scene.add(m)
    return m
  }
  const setSeats = list => {
    const keep = new Set(list.map(s => s.key))
    for (const [k, b] of boxes) if (!keep.has(k)) { scene.remove(b.mesh); boxes.delete(k) }
    list.forEach((s, i) => {
      const sig = `${s.name}|${s.deck}|${s.n}|${s.show}|${s.cover}|${s.cols.join('')}`
      let b = boxes.get(s.key)
      if (b && b.sig !== sig) { const p = b.b; scene.remove(b.mesh); b = { mesh: makeBox(s), b: p, sig, s }; boxes.set(s.key, b) }
      if (!b) {  // à volta da mesa, por ordem de chegada
        const a = (i / Math.max(2, list.length)) * Math.PI * 2 + Math.PI / 2
        b = { mesh: makeBox(s), b: { x: Math.cos(a) * 2.6, z: Math.sin(a) * 1.5, vx: 0, vz: 0, r: (Math.random() - 0.5) * 0.4, vr: 0, R: 0.78 }, sig, s }
        boxes.set(s.key, b)
      }
      b.s = s
    })
  }
  // ---- abrir um deck: as cartas saltam da caixa e espalham-se ----
  const cardGeo = new THREE.PlaneGeometry(0.63, 0.88)
  const nameTex = n => canvasTex(128, 178, (g, w, h) => { g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3a2a14'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6)
    g.fillStyle = '#1a1208'; g.font = 'bold 15px serif'; g.textAlign = 'center'; String(n).split(/\s+/).reduce((l, w2) => { const t = l.length && (l[l.length - 1] + ' ' + w2).length < 14 ? (l[l.length - 1] += ' ' + w2, l) : [...l, w2]; return t }, []).slice(0, 5).forEach((t, i) => g.fillText(t, w / 2, 30 + i * 20)) })
  const back = canvasTex(64, 90, (g, w, h) => { g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c8a46a'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8) })
  const openDeck = (key, list) => {
    closeDeck(true)
    const b = boxes.get(key)
    if (!b) return
    let i = 0
    for (const c of list) for (let k = 0; k < Math.min(4, c.n || 1) && i < 80; k++, i++) {
      const g = new THREE.Group()
      const fm = new THREE.MeshStandardMaterial({ map: back, roughness: 0.55 }); tex(c.url, fm, nameTex(c.name))
      const face = new THREE.Mesh(cardGeo, fm)
      const rear = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: back, roughness: 0.6 })); rear.rotation.y = Math.PI
      g.add(face, rear); g.rotation.x = -Math.PI / 2; face.castShadow = true
      g.userData = { kind: 'card', name: c.name }; scene.add(g)
      const a = i * 2.39996, sp = 2.2 + Math.random() * 3.2  // espiral de ouro: espalham-se sem se amontoar
      cards.push({ mesh: g, b: { x: b.b.x, z: b.b.z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp * 0.7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 9, R: 0.36, up: 1.2 + Math.random() * 0.8, flip: false }, i })
    }
  }
  let closing = 0
  const closeDeck = now => {
    if (now) { for (const c of cards) scene.remove(c.mesh); cards.length = 0; return }
    closing = performance.now()
  }
  // ---- a moeda de quem começa ----
  const coinMat = [new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.8, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w) => { g.fillStyle = '#e8c24a'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill(); g.fillStyle = '#6b4a00'; g.font = 'bold 70px serif'; g.textAlign = 'center'; g.fillText('★', w / 2, w / 2 + 25) }), metalness: 0.6, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w) => { g.fillStyle = '#bfc5cc'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill(); g.fillStyle = '#3c4148'; g.font = 'bold 64px serif'; g.textAlign = 'center'; g.fillText('☾', w / 2, w / 2 + 22) }), metalness: 0.6, roughness: 0.35 })]
  const toss = key => {
    const b = boxes.get(key)
    if (!b) return
    if (coin) scene.remove(coin.mesh)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 40), coinMat); m.castShadow = true; scene.add(m)
    const tx = b.b.x * 0.7, tz = b.b.z * 0.7 + 0.2
    coin = { mesh: m, t0: performance.now(), to: [tx, tz] }
  }

  // ---- arrastar (raio até ao plano da mesa) ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3()
  let drag = null
  const at = e => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam) }
  const pick = e => {
    at(e)
    const objs = [...cards.map(c => c.mesh), ...[...boxes.values()].map(b => b.mesh)]
    const h = ray.intersectObjects(objs, true)[0]
    if (!h) return null
    let o = h.object; while (o.parent && !o.userData.kind) o = o.parent
    return o.userData.kind === 'card' ? cards.find(c => c.mesh === o) : [...boxes.values()].find(b => b.mesh === o)
  }
  const down = e => {
    const t = pick(e)
    if (!t) return
    renderer.domElement.setPointerCapture?.(e.pointerId)
    at(e); ray.ray.intersectPlane(plane, hit)
    drag = { t, ox: t.b.x - hit.x, oz: t.b.z - hit.z, h: [[performance.now(), hit.x, hit.z]], moved: 0, x0: e.clientX, y0: e.clientY }
    t.b.vx = t.b.vz = 0
  }
  const move = e => {
    if (!drag) { renderer.domElement.style.cursor = pick(e) ? 'grab' : ''; return }
    at(e); if (!ray.ray.intersectPlane(plane, hit)) return
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0))
    drag.t.b.x = Math.max(-BX, Math.min(BX, hit.x + drag.ox)); drag.t.b.z = Math.max(-BZ, Math.min(BZ, hit.z + drag.oz))
    drag.h.push([performance.now(), hit.x, hit.z]); drag.h = drag.h.slice(-6)
  }
  const up = () => {
    if (!drag) return
    const { t, h, moved } = drag
    drag = null
    if (moved < 6) {  // um clique: caixa → o componente decide (abrir/deixar ver); carta → vira-se
      if (t.mesh.userData.kind === 'card') t.b.flip = !t.b.flip
      else onClick?.(t.mesh.userData.key)
      return
    }
    const a = h[0], z = h[h.length - 1], dt = Math.max(0.016, (z[0] - a[0]) / 1000)
    t.b.vx = Math.max(-14, Math.min(14, (z[1] - a[1]) / dt)); t.b.vz = Math.max(-14, Math.min(14, (z[2] - a[2]) / dt)); t.b.vr = (Math.random() - 0.5) * Math.hypot(t.b.vx, t.b.vz)
  }
  const cv = renderer.domElement
  cv.style.touchAction = 'none'
  cv.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up)

  // ---- física e desenho ----
  const step = (b, dt, held) => {
    if (!held) {
      b.x += b.vx * dt; b.z += b.vz * dt; b.r += b.vr * dt
      const f = Math.pow(0.12, dt); b.vx *= f; b.vz *= f; b.vr *= Math.pow(0.08, dt)
    }
    if (b.x < -BX) { b.x = -BX; b.vx = Math.abs(b.vx) * 0.55 } else if (b.x > BX) { b.x = BX; b.vx = -Math.abs(b.vx) * 0.55 }
    if (b.z < -BZ) { b.z = -BZ; b.vz = Math.abs(b.vz) * 0.55 } else if (b.z > BZ) { b.z = BZ; b.vz = -Math.abs(b.vz) * 0.55 }
  }
  const collide = (A, B) => {  // círculos: separam-se e trocam um pouco de velocidade
    const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.001, m = A.R + B.R - d
    if (m <= 0) return
    const nx = dx / d, nz = dz / d
    A.x -= nx * m / 2; A.z -= nz * m / 2; B.x += nx * m / 2; B.z += nz * m / 2
    const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz
    if (rv < 0) { const j = -rv * 0.8; A.vx -= j * nx; A.vz -= j * nz; B.vx += j * nx; B.vz += j * nz }
  }
  let raf = 0, last = performance.now(), alive = true
  const frame = now => {
    if (!alive) return
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    const bs = [...boxes.values()]
    for (const b of bs) step(b.b, dt, drag?.t === b)
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) collide(bs[i].b, bs[j].b)
    for (const c of cards) { step(c.b, dt, drag?.t === c); for (const b of bs) collide(b.b, c.b) }
    for (const b of bs) { b.mesh.position.set(b.b.x, b.mesh.userData.H / 2 + (drag?.t === b ? 0.35 : 0), b.b.z); b.mesh.rotation.y = b.b.r }
    const cl = closing ? Math.min(1, (now - closing) / 600) : 0
    cards.forEach((c, k) => {
      const held = drag?.t === c, b = c.b
      if (b.up > 0) { b.up = Math.max(0, b.up - dt * 2.2) }  // o salto ao sair da caixa
      let x = b.x, z = b.z, y = 0.012 + k * 0.0016 + b.up * b.up * 0.9 + (held ? 0.4 : 0)
      if (cl) { const o = boxes.get(openKey)?.b; if (o) { x += (o.x - x) * cl; z += (o.z - z) * cl; y += cl * 0.6 } }
      c.mesh.position.set(x, y, z); c.mesh.rotation.set(-Math.PI / 2, 0, b.r)
      c.mesh.children[0].visible = !b.flip; c.mesh.children[1].visible = true
      if (b.flip) c.mesh.rotation.x = Math.PI / 2
    })
    if (cl >= 1) { closeDeck(true); closing = 0 }
    if (coin) {  // sobe a rodar e cai ao pé de quem começa, com a face da estrela para cima
      const k = Math.min(1, (now - coin.t0) / 1700), e = 1 - (1 - k) ** 3
      coin.mesh.position.set(coin.to[0] * e, 0.04 + Math.sin(Math.min(1, k * 1.15) * Math.PI) * 2.6, coin.to[1] * e)
      coin.mesh.rotation.set((1 - e) * 26 + 0, 0, (1 - e) * 4)
    }
    renderer.render(scene, cam)
    raf = requestAnimationFrame(frame)
  }
  const fit = () => { const w = el.clientWidth || 600, h = el.clientHeight || 320; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix() }
  const ro = new ResizeObserver(fit); ro.observe(el); fit()
  raf = requestAnimationFrame(frame)
  let openKey = null
  return {
    setSeats, toss,
    openDeck: (key, list) => { openKey = key; openDeck(key, list) },
    closeDeck: () => closeDeck(false),
    dispose: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); renderer.dispose(); cv.remove() },
  }
}
