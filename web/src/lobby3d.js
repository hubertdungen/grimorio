// Lobby 3D da mesa livre (antes de começar): uma mesa com a caixa do deck de cada jogador (altura pelo número de cartas,
// lados nas cores do deck, a capa na tampa). As caixas e as cartas agarram-se, atiram-se e chocam (física no plano da
// mesa) e o que cada um mexe vê-se igual nos outros ecrãs (Lobby3D.jsx manda e recebe pelo canal ao vivo da sala).
// Um deck aberto espalha as cartas viradas para baixo, na mesma disposição em todos os ecrãs; um toque vira uma carta
// (para todos); para a ver a sério, larga-se na faixa de baixo (a tua mão). A moeda de quem começa cai ao pé da caixa.
import { drawPlayerCoin } from './Dice3D.js'
import * as THREE from 'three'

const COL = { W: '#f5c451', U: '#38a8f0', B: '#6b4a8a', R: '#e2452f', G: '#3fa65a', C: '#9aa3ad' }
const BX = 5.2, BZ = 3.1  // a mesa: meia largura e meia fundura
const HAND = 0.84  // abaixo desta fração da altura do ecrã é a mão (largar lá uma carta = pegar nela)
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
const rng = seed => { let h = [...String(seed)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0; return () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296 } }

export function createLobby(el, { onClick, onMove, onHand } = {}) {
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
  const boxes = new Map(), cards = new Map()  // id -> {mesh, b}
  let coin = null
  const label = s => canvasTex(256, 96, (g, w, h) => {
    const cs = s.cols.length ? s.cols : ['C'], gr = g.createLinearGradient(0, 0, w, 0)
    cs.forEach((c, i) => gr.addColorStop(cs.length > 1 ? i / (cs.length - 1) : 0, COL[c] || COL.C)); if (cs.length === 1) gr.addColorStop(1, COL[cs[0]] || COL.C)
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#0d1018cc'; g.fillRect(6, 6, w - 12, h - 12)
    g.fillStyle = '#f2b84b'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'
    g.fillText(String(s.name).slice(0, 18), w / 2, 36); g.fillStyle = '#cbd5e1'; g.font = '20px sans-serif'
    g.fillText(`${s.show ? '👁' : '🔒'} ${s.n} · ${String(s.deck || '').slice(0, 16)}`, w / 2, 72)
  })
  const sideTex = cols => canvasTex(64, 64, (g, w, h) => { const cs = cols.length ? cols : ['C']; cs.forEach((c, i) => { g.fillStyle = COL[c] || COL.C; g.fillRect(0, (i * h) / cs.length, w, h / cs.length + 1) }) })
  const makeBox = s => {
    const H = (0.22 + Math.min(1, (s.n || 60) / 100) * 0.55) * 1.2, side = new THREE.MeshStandardMaterial({ map: sideTex(s.cols), roughness: 0.6 })
    const st = sideTex(s.cols), top = new THREE.MeshStandardMaterial({ map: st, roughness: 0.5 }); tex(s.cover, top, st)
    const front = new THREE.MeshStandardMaterial({ map: label(s), roughness: 0.7 })
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.15, H, 1.6), [side, side, top, side, front, side])
    m.castShadow = true; m.userData = { id: s.key, kind: 'box', H }; scene.add(m)
    return m
  }
  const setSeats = list => {
    const keep = new Set(list.map(s => s.key))
    for (const [k, b] of boxes) if (!keep.has(k)) { scene.remove(b.mesh); boxes.delete(k) }
    list.forEach((s, i) => {
      const sig = `${s.name}|${s.deck}|${s.n}|${s.show}|${s.cover}|${s.cols.join('')}`
      let b = boxes.get(s.key)
      if (b && b.sig !== sig) { scene.remove(b.mesh); b.mesh = makeBox(s); b.sig = sig }
      if (!b) {  // à volta da mesa, por ordem de chegada (igual em todos os ecrãs)
        const a = (i / Math.max(2, list.length)) * Math.PI * 2 + Math.PI / 2
        b = { mesh: makeBox(s), b: { x: Math.cos(a) * 2.6, z: Math.sin(a) * 1.5, vx: 0, vz: 0, r: 0, vr: 0, R: 0.78 }, sig }
        boxes.set(s.key, b)
      }
    })
  }
  // ---- abrir um deck: as cartas saem da caixa para uma disposição fixa (a mesma em todos os ecrãs), viradas para baixo ----
  const cardGeo = new THREE.PlaneGeometry(0.63, 0.88)
  const back = canvasTex(64, 90, (g, w, h) => { g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c8a46a'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8); g.fillStyle = '#c8a46a'; g.font = 'bold 30px serif'; g.textAlign = 'center'; g.fillText('✦', w / 2, h / 2 + 10) })
  const nameTex = n => canvasTex(128, 178, (g, w, h) => { g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3a2a14'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6)
    g.fillStyle = '#1a1208'; g.font = 'bold 15px serif'; g.textAlign = 'center'
    const ws = String(n).split(/\s+/), ls = []; for (const w2 of ws) { if (ls.length && (ls[ls.length - 1] + ' ' + w2).length < 14) ls[ls.length - 1] += ' ' + w2; else ls.push(w2) }
    ls.slice(0, 5).forEach((t, i) => g.fillText(t, w / 2, 30 + i * 20)) })
  let openKey = null, openT = 0
  const openDeck = (key, list) => {
    for (const c of cards.values()) scene.remove(c.mesh)
    cards.clear()
    const b = boxes.get(key)
    openKey = key; openT = performance.now()
    if (!b) return
    const rnd = rng(key), all = []
    for (const c of list) for (let k = 0; k < Math.min(4, c.n || 1) && all.length < 80; k++) all.push(c)
    all.forEach((c, i) => {
      const g = new THREE.Group()
      const fm = new THREE.MeshStandardMaterial({ map: nameTex(c.name), roughness: 0.55 }); tex(c.url, fm, nameTex(c.name))
      const face = new THREE.Mesh(cardGeo, fm), rear = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: back, roughness: 0.6 }))
      rear.rotation.y = Math.PI; face.castShadow = true
      g.add(face, rear); g.userData = { id: `${key}#${i}`, kind: 'card', name: c.name, url: c.url }; scene.add(g)
      const a = i * 2.39996, rr = 0.55 + Math.sqrt(i) * 0.36  // espiral de ouro à volta do centro da mesa
      cards.set(g.userData.id, { mesh: g, b: { x: b.b.x, z: b.b.z, tx: Math.cos(a) * rr * 1.25, tz: Math.sin(a) * rr * 0.75, vx: 0, vz: 0, r: (rnd() - 0.5) * 0.6, vr: 0, R: 0.36, f: false, delay: i * 18 } })
    })
  }
  const closeDeck = () => { for (const c of cards.values()) scene.remove(c.mesh); cards.clear(); openKey = null }
  // ---- a moeda de quem começa ----
  const coinMat = [new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.8, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w) => { g.fillStyle = '#e8c24a'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill(); g.fillStyle = '#6b4a00'; g.font = 'bold 70px serif'; g.textAlign = 'center'; g.fillText('★', w / 2, w / 2 + 25) }), metalness: 0.6, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w) => { g.fillStyle = '#bfc5cc'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill(); g.fillStyle = '#3c4148'; g.font = 'bold 64px serif'; g.textAlign = 'center'; g.fillText('☾', w / 2, w / 2 + 22) }), metalness: 0.6, roughness: 0.35 })]
  const toss = (key, face, face2) => {
    const b = boxes.get(key)
    if (!b) return
    if (coin) scene.remove(coin.mesh)
    const mats = face ? [coinMat[0], new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w) => { g.save(); g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.clip(); drawPlayerCoin(g, w, face); g.restore() }), metalness: 0.55, roughness: 0.32 }),
      face2 ? new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w) => { g.save(); g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.clip(); drawPlayerCoin(g, w, face2); g.restore() }), metalness: 0.55, roughness: 0.32 }) : coinMat[2]] : coinMat
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 40), mats); m.castShadow = true; scene.add(m)
    coin = { mesh: m, t0: performance.now(), to: [b.b.x * 0.7, b.b.z * 0.7 + 0.2] }
  }

  // ---- arrastar (raio até ao plano da mesa); o que eu mexo é «meu» até parar (só eu o mando) ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3()
  let drag = null
  const at = e => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam) }
  const all = () => [...cards.values(), ...boxes.values()]
  const pick = e => {
    at(e)
    const h = ray.intersectObjects(all().filter(o => o.mesh.visible).map(o => o.mesh), true)[0]
    if (!h) return null
    let o = h.object; while (o.parent && !o.userData.kind) o = o.parent
    return all().find(x => x.mesh === o) || null
  }
  const down = e => {
    const t = pick(e)
    if (!t) return
    renderer.domElement.setPointerCapture?.(e.pointerId)
    at(e); ray.ray.intersectPlane(plane, hit)
    drag = { t, ox: t.b.x - hit.x, oz: t.b.z - hit.z, h: [[performance.now(), hit.x, hit.z]], moved: 0, x0: e.clientX, y0: e.clientY }
    t.b.vx = t.b.vz = 0; t.b.mine = true; t.b.tx = undefined
  }
  const move = e => {
    if (!drag) { renderer.domElement.style.cursor = pick(e) ? 'grab' : ''; return }
    at(e); if (!ray.ray.intersectPlane(plane, hit)) return
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0))
    drag.t.b.x = Math.max(-BX, Math.min(BX, hit.x + drag.ox)); drag.t.b.z = Math.max(-BZ, Math.min(BZ, hit.z + drag.oz))
    drag.h.push([performance.now(), hit.x, hit.z]); drag.h = drag.h.slice(-6)
    drag.y = e.clientY
  }
  const up = e => {
    if (!drag) return
    const { t, h, moved } = drag
    drag = null
    const kind = t.mesh.userData.kind, r = renderer.domElement.getBoundingClientRect()
    if (moved < 6) {  // um clique: caixa → o componente decide (abrir/deixar ver); carta → vira-se (para todos)
      if (kind === 'card') { t.b.f = !t.b.f; t.b.mine = true; t.b.dirty = true } else onClick?.(t.mesh.userData.id)
      return
    }
    if (kind === 'card' && e && (e.clientY - r.top) / r.height > HAND) {  // largada na faixa de baixo: vai para a minha mão
      t.mesh.visible = false; t.b.hand = true; t.b.mine = true; t.b.dirty = true
      onHand?.(t.mesh.userData.id, t.mesh.userData.name, t.mesh.userData.url)
      return
    }
    const a = h[0], z = h[h.length - 1], dt = Math.max(0.016, (z[0] - a[0]) / 1000)
    t.b.vx = Math.max(-14, Math.min(14, (z[1] - a[1]) / dt)); t.b.vz = Math.max(-14, Math.min(14, (z[2] - a[2]) / dt)); t.b.vr = (Math.random() - 0.5) * Math.hypot(t.b.vx, t.b.vz)
  }
  const cv = renderer.domElement
  cv.style.touchAction = 'none'
  cv.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up)

  // ---- o que chega dos outros: cada objeto desliza até onde o outro o pôs (o que eu estou a mexer não) ----
  const setRemote = (objs, me) => {
    for (const [id, o] of Object.entries(objs || {})) {
      const t = boxes.get(id) || cards.get(id)
      if (!t || o.by === me || drag?.t === t) continue
      t.b.rx = o.x; t.b.rz = o.z; t.b.rr = o.r; t.b.f = !!o.f; t.b.mine = false; t.b.tx = undefined
      t.b.vx = t.b.vz = 0
      if (t.mesh.userData.kind === 'card') t.mesh.visible = !o.hand
    }
  }
  const returnCard = (id, x = 0, z = 0) => { const t = cards.get(id); if (!t) return; t.mesh.visible = true; t.b.hand = false; t.b.x = x; t.b.z = z; t.b.f = true; t.b.mine = true; t.b.dirty = true }

  // ---- física e desenho ----
  const step = (b, dt, held) => {
    if (b.rx != null && !held) {  // vindo de outro ecrã: desliza até lá
      b.x += (b.rx - b.x) * Math.min(1, dt * 10); b.z += (b.rz - b.z) * Math.min(1, dt * 10); b.r += (b.rr - b.r) * Math.min(1, dt * 10)
      if (Math.hypot(b.rx - b.x, b.rz - b.z) < 0.005) { b.x = b.rx; b.z = b.rz; b.rx = null }
      return
    }
    if (b.tx != null) {  // a sair da caixa para o sítio dela na disposição
      if ((b.delay -= dt * 1000) > 0) return
      b.x += (b.tx - b.x) * Math.min(1, dt * 6); b.z += (b.tz - b.z) * Math.min(1, dt * 6)
      if (Math.hypot(b.tx - b.x, b.tz - b.z) < 0.01) { b.x = b.tx; b.z = b.tz; b.tx = undefined }
      return
    }
    if (!held) {
      b.x += b.vx * dt; b.z += b.vz * dt; b.r += b.vr * dt
      const f = Math.pow(0.12, dt); b.vx *= f; b.vz *= f; b.vr *= Math.pow(0.08, dt)
    }
    if (b.x < -BX) { b.x = -BX; b.vx = Math.abs(b.vx) * 0.55 } else if (b.x > BX) { b.x = BX; b.vx = -Math.abs(b.vx) * 0.55 }
    if (b.z < -BZ) { b.z = -BZ; b.vz = Math.abs(b.vz) * 0.55 } else if (b.z > BZ) { b.z = BZ; b.vz = -Math.abs(b.vz) * 0.55 }
  }
  const collide = (A, B) => {  // círculos: separam-se e trocam um pouco de velocidade (só o que é meu ou está parado)
    if (A.tx != null || B.tx != null || A.rx != null || B.rx != null) return
    const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 0.001, m = A.R + B.R - d
    if (m <= 0) return
    const nx = dx / d, nz = dz / d
    A.x -= nx * m / 2; A.z -= nz * m / 2; B.x += nx * m / 2; B.z += nz * m / 2
    const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz
    if (rv < 0) { const j = -rv * 0.8; A.vx -= j * nx; A.vz -= j * nz; B.vx += j * nx; B.vz += j * nz }
    if (A.mine || B.mine) { A.mine = B.mine = true }  // o que eu empurrei passa a ser meu até parar
  }
  let raf = 0, last = performance.now(), alive = true, sentAt = 0
  const frame = now => {
    if (!alive) return
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    const bs = [...boxes.values()], cs = [...cards.values()].filter(c => !c.b.hand)
    for (const b of bs) step(b.b, dt, drag?.t === b)
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) collide(bs[i].b, bs[j].b)
    for (const c of cs) { step(c.b, dt, drag?.t === c); for (const b of bs) collide(b.b, c.b) }
    for (const b of bs) { b.mesh.position.set(b.b.x, b.mesh.userData.H / 2 + (drag?.t === b ? 0.35 : 0), b.b.z); b.mesh.rotation.y = b.b.r }
    cs.forEach((c, k) => {
      const held = drag?.t === c, b = c.b, lift = b.tx != null && b.delay <= 0 ? 0.5 * Math.sin(Math.min(1, Math.hypot(b.tx - b.x, b.tz - b.z) / 2) * Math.PI) : 0
      c.mesh.position.set(b.x, 0.012 + k * 0.0016 + lift + (held ? 0.4 : 0), b.z)
      c.mesh.rotation.set(b.f ? -Math.PI / 2 : Math.PI / 2, 0, b.f ? b.r : -b.r)  // virada para baixo (as costas) até alguém a virar
    })
    if (coin) {  // sobe a rodar e cai ao pé de quem começa, com a face da estrela para cima
      const k = Math.min(1, (now - coin.t0) / 1700), e = 1 - (1 - k) ** 3
      coin.mesh.position.set(coin.to[0] * e, 0.04 + Math.sin(Math.min(1, k * 1.15) * Math.PI) * 2.6, coin.to[1] * e)
      coin.mesh.rotation.set((1 - e) * 26, 0, (1 - e) * 4)
    }
    renderer.render(scene, cam)
    // o que mudou e é meu: manda (10 vezes por segundo enquanto anda; uma última vez quando pára)
    if (onMove && now - sentAt > 100) {
      const out = []
      for (const [id, t] of [...boxes.entries(), ...cards.entries()]) {
        const b = t.b, moving = drag?.t === t || Math.hypot(b.vx, b.vz) > 0.03
        if (!b.mine || (!moving && !b.dirty && !b.wasMoving)) continue
        out.push({ id, x: +b.x.toFixed(3), z: +b.z.toFixed(3), r: +b.r.toFixed(3), f: !!b.f, ...(t.mesh.userData.kind === 'card' ? { hand: !!b.hand } : {}) })
        b.dirty = false; b.wasMoving = moving
        if (!moving && !drag) b.mine = false
      }
      if (out.length) { sentAt = now; onMove(out) }
    }
    raf = requestAnimationFrame(frame)
  }
  const fit = () => { const w = el.clientWidth || 600, h = el.clientHeight || 320; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix() }
  const ro = new ResizeObserver(fit); ro.observe(el); fit()
  raf = requestAnimationFrame(frame)
  return {
    setSeats, toss, setRemote, returnCard,
    openDeck, closeDeck, openKey: () => openKey, openT: () => openT,
    dispose: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); renderer.dispose(); cv.remove() },
  }
}
