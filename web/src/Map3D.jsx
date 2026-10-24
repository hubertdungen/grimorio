import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { tx } from './i18n.js'

const CI = { W: [0.96, 0.92, 0.78], U: [0.31, 0.64, 1], B: [0.66, 0.55, 0.85], R: [1, 0.36, 0.29], G: [0.24, 0.81, 0.48] }
const GOLD = [0.95, 0.72, 0.29], GREY = [0.6, 0.64, 0.7], LAND = [0.69, 0.55, 0.42]
const LINE = { combo: [1, 0.78, 0.3], inter: [0.43, 0.9, 0.98], sugg: [0.75, 0.95, 1] }

function baseColor(c) {
  if (c.mt === 'Land') return LAND
  if (!c.ci) return GREY
  if (c.ci.length > 1) return GOLD
  return CI[c.ci]
}

// Pontos: tamanho por atributo, "pulse" faz as sugestões respirarem e o deck cintilar.
const VERT = `
uniform float uTime;
attribute float size; attribute vec3 color; attribute float pulse;
varying vec3 vColor; varying float vSize;
void main() {
  vColor = color;
  float ph = position.x * 0.37 + position.y * 0.21;
  float s = size;
  if (pulse > 0.5 && pulse < 1.5) s *= 1.0 + 0.32 * sin(uTime * 3.2 + ph);
  if (pulse > 1.5) s *= 1.0 + 0.08 * sin(uTime * 1.7 + ph);
  vSize = s;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = s * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const FRAG = `
varying vec3 vColor; varying float vSize;
void main() {
  vec2 p = gl_PointCoord - 0.5; float d = length(p);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float ring = vSize > 2.5 ? smoothstep(0.36, 0.42, d) * smoothstep(0.5, 0.44, d) : 0.0;
  gl_FragColor = vec4(vColor * (0.55 + 0.6 * core) + ring * 0.6, core * 0.95 + ring);
}`
// Linhas: tracejado que corre de "a" (quem alimenta) para "b" (quem aproveita); combos sólidos.
const LVERT = `
attribute float dist; attribute vec3 color; attribute float dash;
varying float vDist; varying vec3 vColor; varying float vDash;
void main() { vDist = dist; vColor = color; vDash = dash; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const LFRAG = `
uniform float uTime; uniform float uOpacity;
varying float vDist; varying vec3 vColor; varying float vDash;
void main() {
  float a = uOpacity;
  if (vDash > 0.5) { float f = fract((vDist - uTime * 6.0) / 5.0); a *= smoothstep(0.0, 0.15, f) * (1.0 - smoothstep(0.5, 0.65, f)); }
  gl_FragColor = vec4(vColor, a);
}`
// Explosão quando uma carta entra no deck: anel que cresce e desvanece.
const BVERT = `
attribute float age; varying float vAge;
void main() { vAge = age; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (14.0 + 130.0 * age) * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`
const BFRAG = `
varying float vAge;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float ring = smoothstep(0.30, 0.45, d) * smoothstep(0.5, 0.45, d);
  float core = smoothstep(0.25, 0.0, d) * (1.0 - vAge);
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.5) * 1.4, (ring * 1.3 + core) * (1.0 - vAge));
}`

/**
 * marks: Map(i -> 'deck'|'seed'|'sugg'|'focus'|'hover'); dim(c) apaga; links: [{a, b, kind}];
 * onPick(i) clique; onAdd(i) duplo clique; focus: voar até i; frame: índices a enquadrar quando follow;
 * tips: Map(i -> texto extra no tooltip).
 */
export default function Map3D({ data, marks, dim, links, onPick, onAdd, focus, frame, follow, tips }) {
  const host = useRef(null)
  const st = useRef({})
  const [hover, setHover] = useState(null)
  const [labels, setLabels] = useState([])

  useEffect(() => {
    const el = host.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
    camera.position.set(0, 40, 210)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.25
    let idleAt = performance.now()
    controls.addEventListener('start', () => { controls.autoRotate = false; st.current.fly = null })
    controls.addEventListener('end', () => { idleAt = performance.now() })
    const uTime = { value: 0 }

    const N = data.cards.length
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1))
    geo.setAttribute('pulse', new THREE.BufferAttribute(new Float32Array(N), 1))
    const points = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: { uTime }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    scene.add(points)

    const lineGeo = new THREE.BufferGeometry()
    const lineMat = new THREE.ShaderMaterial({ uniforms: { uTime, uOpacity: { value: 0 } }, vertexShader: LVERT, fragmentShader: LFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    scene.add(new THREE.LineSegments(lineGeo, lineMat))

    const MAXB = 32
    const bGeo = new THREE.BufferGeometry()
    bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXB * 3), 3))
    bGeo.setAttribute('age', new THREE.BufferAttribute(new Float32Array(MAXB).fill(1), 1))
    scene.add(new THREE.Points(bGeo, new THREE.ShaderMaterial({ vertexShader: BVERT, fragmentShader: BFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })))
    const bursts = []

    const ray = new THREE.Raycaster()
    ray.params.Points.threshold = 1.2
    const mouse = new THREE.Vector2()
    let down = null, lastClick = { t: 0, i: null }
    const pick = e => {
      const r = renderer.domElement.getBoundingClientRect()
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(mouse, camera)
      const hit = ray.intersectObject(points).filter(h => !st.current.dimmed?.[h.index])
      // prefere pontos em destaque (deck, sugestões) quando há empate de distância
      hit.sort((a, b) => (st.current.marks?.has(b.index) ? 1 : 0) - (st.current.marks?.has(a.index) ? 1 : 0) || a.distanceToRay - b.distanceToRay)
      return hit.length ? hit[0].index : null
    }
    const onMove = e => {
      const i = pick(e)
      setHover(i == null ? null : { i, x: e.offsetX, y: e.offsetY })
      renderer.domElement.style.cursor = i == null ? 'grab' : 'pointer'
    }
    const onDown = e => { down = [e.clientX, e.clientY] }
    const onUp = e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
      const i = pick(e)
      if (i == null) return
      const now = performance.now()
      if (lastClick.i === i && now - lastClick.t < 380) { st.current.onAdd?.(i); lastClick = { t: 0, i: null } }
      else { st.current.onPick?.(i); lastClick = { t: now, i } }
    }
    const cvs = renderer.domElement
    cvs.addEventListener('pointermove', onMove)
    cvs.addEventListener('pointerdown', onDown)
    cvs.addEventListener('pointerup', onUp)

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    const flyTo = (target, dist) => {
      const t1 = target.clone()
      const dir = camera.position.clone().sub(controls.target).normalize()
      controls.autoRotate = false
      st.current.fly = { t: 0, t0: controls.target.clone(), t1, c0: camera.position.clone(), c1: t1.clone().add(dir.multiplyScalar(dist)) }
    }
    const P = i => new THREE.Vector3(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2])

    let raf, frame = 0, last = performance.now()
    const v = new THREE.Vector3()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000)
      last = now
      uTime.value += dt
      lineMat.uniforms.uOpacity.value += ((st.current.linesOn ? 0.75 : 0) - lineMat.uniforms.uOpacity.value) * 0.08
      const fly = st.current.fly
      if (fly) {
        fly.t = Math.min(1, fly.t + dt * 1.1)
        const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2
        controls.target.lerpVectors(fly.t0, fly.t1, e)
        camera.position.lerpVectors(fly.c0, fly.c1, e)
        if (fly.t >= 1) { st.current.fly = null; idleAt = now }
      } else if (st.current.follow && now - idleAt > 2500) controls.autoRotate = true
      // explosões
      const bp = bGeo.attributes.position.array, ba = bGeo.attributes.age.array
      for (let k = bursts.length - 1; k >= 0; k--) { bursts[k].age += dt * 0.75; if (bursts[k].age >= 1) bursts.splice(k, 1) }
      for (let k = 0; k < MAXB; k++) {
        const b = bursts[k]
        ba[k] = b ? b.age : 1
        if (b) { bp[k * 3] = data.pos[b.i * 3]; bp[k * 3 + 1] = data.pos[b.i * 3 + 1]; bp[k * 3 + 2] = data.pos[b.i * 3 + 2] }
      }
      bGeo.attributes.position.needsUpdate = true
      bGeo.attributes.age.needsUpdate = true
      controls.update()
      renderer.render(scene, camera)
      if (++frame % 3 === 0) {
        const w = el.clientWidth, h = el.clientHeight
        const out = []
        for (const i of st.current.labelIdx || []) {
          v.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]).project(camera)
          if (v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05)
            out.push({ i, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, kind: st.current.marks.get(i) })
        }
        setLabels(prev => (prev.length || out.length ? out : prev))
      }
    }
    loop()

    Object.assign(st.current, {
      geo, lineGeo, P,
      flyTo: i => flyTo(P(i), 45),
      frameOn: idxs => {
        if (!idxs.length) return
        const c = new THREE.Vector3()
        for (const i of idxs) c.add(P(i))
        c.divideScalar(idxs.length)
        let r = 0
        for (const i of idxs) r = Math.max(r, P(i).distanceTo(c))
        flyTo(c, Math.max(30, Math.min(220, r * 2.4)))
      },
      burst: i => { bursts.push({ i, age: 0 }); if (bursts.length > MAXB) bursts.shift() },
    })
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); geo.dispose(); lineGeo.dispose(); bGeo.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [data])

  // Cores, tamanhos e pulsação conforme o que está em destaque; explosão para cartas acabadas de entrar.
  useEffect(() => {
    const { geo } = st.current
    if (!geo) return
    const col = geo.attributes.color.array, size = geo.attributes.size.array, pulse = geo.attributes.pulse.array
    const dimmed = new Uint8Array(data.cards.length)
    const anyMark = marks.size > 0
    const prevDeck = st.current.deckSet || new Set()
    const deckSet = new Set()
    data.cards.forEach((c, i) => {
      const m = marks.get(i)
      let rgb = baseColor(c), s = 1.6, k = anyMark ? 0.45 : 0.8, p = 0
      if (dim?.(c) && !m) { dimmed[i] = 1; k = 0.06; s = 1 }
      if (m === 'mine') { s = 2.6; k = 1; rgb = [0.78, 0.58, 1] }
      if (m === 'deck') { s = 4.2; k = 1.15; p = 2; deckSet.add(i) }
      if (m === 'seed') { s = 6; k = 1.3; rgb = [1, 0.85, 0.45]; p = 2; deckSet.add(i) }
      if (m === 'sugg') { s = 4.6; k = 1.2; rgb = [0.45, 0.95, 1]; p = 1 }
      if (m === 'hover') { s = 7; k = 1.5; rgb = [0.6, 1, 1]; p = 1 }
      if (m === 'focus') { s = 8; k = 1.5; rgb = [1, 1, 1] }
      col[i * 3] = rgb[0] * k; col[i * 3 + 1] = rgb[1] * k; col[i * 3 + 2] = rgb[2] * k
      size[i] = s
      pulse[i] = p
    })
    geo.attributes.color.needsUpdate = true
    geo.attributes.size.needsUpdate = true
    geo.attributes.pulse.needsUpdate = true
    if (st.current.deckSet) for (const i of deckSet) if (!prevDeck.has(i)) st.current.burst(i)
    st.current.deckSet = deckSet
    st.current.dimmed = dimmed
    st.current.marks = marks
    if (!marks.size) setLabels([])
    const pri = { focus: 0, hover: 0, seed: 1, sugg: 2, deck: 3, mine: 9 }
    st.current.labelIdx = [...marks.entries()].filter(([, m]) => m !== 'mine' && (m !== 'deck' || marks.size < 25)).sort((a, b) => pri[a[1]] - pri[b[1]]).map(([i]) => i).slice(0, 60)
  }, [data, marks, dim])

  // Linhas com distância acumulada (para o tracejado correr) e cor por tipo.
  useEffect(() => {
    const { lineGeo } = st.current
    if (!lineGeo) return
    const n = links.length
    const pos = new Float32Array(n * 6), col = new Float32Array(n * 6), dist = new Float32Array(n * 2), dash = new Float32Array(n * 2)
    links.forEach(({ a, b, kind }, k) => {
      for (let d = 0; d < 3; d++) { pos[k * 6 + d] = data.pos[a * 3 + d]; pos[k * 6 + 3 + d] = data.pos[b * 3 + d] }
      const c = LINE[kind] || LINE.inter
      col.set(c, k * 6); col.set(c, k * 6 + 3)
      dist[k * 2 + 1] = Math.hypot(pos[k * 6 + 3] - pos[k * 6], pos[k * 6 + 4] - pos[k * 6 + 1], pos[k * 6 + 5] - pos[k * 6 + 2])
      dash[k * 2] = dash[k * 2 + 1] = kind === 'combo' ? 0 : 1
    })
    lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    lineGeo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    lineGeo.setAttribute('dist', new THREE.BufferAttribute(dist, 1))
    lineGeo.setAttribute('dash', new THREE.BufferAttribute(dash, 1))
    st.current.linesOn = n > 0
  }, [data, links])

  useEffect(() => { st.current.onPick = onPick; st.current.onAdd = onAdd }, [onPick, onAdd])
  useEffect(() => { st.current.follow = follow }, [follow])
  useEffect(() => { if (focus != null) st.current.flyTo?.(focus) }, [focus])
  const frameKey = (frame || []).length
  useEffect(() => { if (follow && frame?.length) st.current.frameOn?.(frame) }, [frameKey, follow]) // eslint-disable-line react-hooks/exhaustive-deps

  const hc = hover && data.cards[hover.i]
  return (
    <div className="map" ref={host}>
      {labels.map(l => (
        <button key={l.i} className={`map-label ${l.kind}`} style={{ left: l.x, top: l.y }} onClick={() => onPick(l.i)} onDoubleClick={() => onAdd?.(l.i)}>
          {data.cards[l.i].n}
        </button>
      ))}
      {hc && (
        <div className="map-tip" style={{ left: Math.min(hover.x + 14, (host.current?.clientWidth || 9999) - 260), top: hover.y + 10 }}>
          <b>{hc.n}</b><small>{hc.t}</small>
          {tips?.get(hover.i) && <em>{tips.get(hover.i)}</em>}
          <small className="map-tip-k">{tx('clique: ver · duplo clique: juntar ao deck')}</small>
        </div>
      )}
      <div className="map-legend">
        <span><i style={{ background: '#f5ebc7' }} />W</span><span><i style={{ background: '#4fa3ff' }} />U</span>
        <span><i style={{ background: '#a88cd9' }} />B</span><span><i style={{ background: '#ff5c4a' }} />R</span>
        <span><i style={{ background: '#3dcf7a' }} />G</span><span><i style={{ background: '#f2b84b' }} />{tx('Multicor')}</span>
        <span><i style={{ background: '#9aa3b2' }} />{tx('Incolor')}</span><span><i style={{ background: '#b08c6b' }} />{tx('Terreno')}</span>
        <span><i style={{ background: '#c794ff' }} />{tx('os teus decks')}</span><span className="lg-line lg-combo">combo</span><span className="lg-line lg-inter">{tx('alimenta → aproveita')}</span>
      </div>
    </div>
  )
}
