// Esfera da vida em 3D (WebGL, three.js como os dados). Um só renderizador para todas as esferas do ecrã: a cada frame
// desenha cada esfera e copia a imagem para o <canvas> dela (no telemóvel não se abre um contexto WebGL por esfera).
// O que a esfera mostra vem do elemento .orb que já existe (estilo, estado, reação, pouca/muita vida, rebentada): as
// cores lêem-se das variáveis CSS (--core, --deep, --smoke, --smoke2, --glow) e as classes/data-* dizem o resto.
// Vidro: shader próprio — borda luminosa (fresnel), reflexo de janela e brilho especular, a face de trás para dar
// espessura; rachas desenhadas NA superfície (seguem a curva da esfera) a crescer do ponto de impacto: um pouco com
// pouca vida, todas na casca, a crescer enquanto carrega para rebentar e num golpe que racha/parte (data-fx3).
// Dentro: o líquido luminoso (mais escuro para as bordas) e o fumo; uma cáustica clara em baixo. À volta: o brilho com
// as cores do deck (data-cols). As reações por cima (sangue, luz, vento…) continuam a ser as da esfera clássica.
// Sem WebGL: fica a esfera clássica (CSS).
import * as THREE from 'three'

const COL = { W: '#fff3c4', U: '#4cc9f0', B: '#a78bfa', R: '#ff5c3a', G: '#4ade80', C: '#cbd5e1' }
const SIZE = 192
let R = null
const orbs = new Set()
let raf = 0, t0 = performance.now()

export const webgl3d = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } }

const NOISE = `
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int k=0;k<4;k++){ s+=a*n(p); p*=2.1; a*=.5; } return s; }`
const VS = 'varying vec3 vN; varying vec3 vP; varying vec2 vUv; varying vec3 vO; void main(){ vUv = uv; vO = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); vP = mv.xyz; gl_Position = projectionMatrix * mv; }'
// o líquido: cor do estilo com fumo a mexer, brilho de dentro (mais forte no centro) e mais escuro para as bordas
const CORE_FS = `${NOISE}
uniform float t; uniform vec3 c1; uniform vec3 c2; uniform vec3 core; uniform vec3 deep; uniform float speed; uniform float dens; uniform float glow; uniform float rot; uniform float frost;
varying vec3 vN; varying vec3 vP; varying vec3 vO;
void main(){
  vec3 V = normalize(-vP); float facing = max(dot(normalize(vN), V), 0.);
  vec3 p = vO*2.4 + vec3(0., t*speed*.35, t*speed*.2);
  float s = fbm(p + fbm(p + t*speed*.15));
  vec3 col = mix(deep, core, .3 + .7*facing);
  col = mix(col, mix(c2, c1, s), smoothstep(.35, .9, s) * dens);
  col += core * pow(facing, 3.) * glow * .9;                           // brilho de dentro, no centro
  col *= .5 + glow*.8;
  float spots = smoothstep(.55, .75, fbm(vO*5. + 3.));
  col = mix(col, mix(vec3(.18,.24,.05), vec3(.03,.02,.02), spots), rot*.85);
  col = mix(col, vec3(.75,.9,1.), frost*.6);
  gl_FragColor = vec4(col, 1.);
}`
const GLASS_FS = `
uniform vec3 tint; uniform float crack; uniform sampler2D crackTex; uniform float back; uniform float dim;
varying vec3 vN; varying vec3 vP; varying vec2 vUv;
void main(){
  vec3 N = normalize(vN) * (back > .5 ? -1. : 1.), V = normalize(-vP), R = reflect(-V, N);
  float fr = pow(1. - max(dot(N, V), 0.), 2.6);
  float win = smoothstep(.82, .97, dot(R, normalize(vec3(-.55, .62, .55)))) * smoothstep(.0, .3, abs(R.y - R.x * .3));
  float spec = pow(max(dot(R, normalize(vec3(-.35, .75, .6))), 0.), 90.);
  float spec2 = pow(max(dot(R, normalize(vec3(.6, -.5, .6))), 0.), 40.) * .5;
  vec3 col = mix(tint * .35, vec3(1.), fr * .85) + win * .9 + spec * 1.6 + spec2;
  float a = .05 + fr * (back > .5 ? .35 : .8) + win * .55 + spec + spec2;
  vec4 c = texture2D(crackTex, vUv);
  float on = step(c.r, crack) * step(.01, crack);
  float line = c.g * on, dark = c.b * on * (1. - c.g);
  col = mix(col, vec3(.02), dark * .7) + line * vec3(1.15);
  a = clamp(a + line * .95 + dark * .55, 0., 1.) * dim;
  gl_FragColor = vec4(col, a);
}`

function crackTexture() {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d'), u0 = 0.28 * W, v0 = 0.44 * H, segs = []
  const branch = (x, y, ang, len, d, depth) => {
    for (let k = 0; k < len; k++) {
      const step = 14 + Math.random() * 18, nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step * 0.6
      segs.push([x, y, nx, ny, Math.min(1, d / 260)]); d += step; x = nx; y = ny; ang += (Math.random() - 0.5) * 0.9
      if (depth < 2 && Math.random() < 0.18) branch(x, y, ang + (Math.random() < 0.5 ? 0.9 : -0.9), Math.floor(len * 0.5), d, depth + 1)
      if (y < 30 || y > H - 30) break
    }
  }
  for (let i = 0; i < 9; i++) branch(u0, v0, (i / 9) * Math.PI * 2 + Math.random() * 0.4, 9 + Math.floor(Math.random() * 6), 0, 0)
  for (let i = 0; i < 14; i++) { const a0 = (i / 14) * Math.PI * 2, a1 = a0 + Math.PI / 7, rr = 26 + Math.random() * 10
    segs.push([u0 + Math.cos(a0) * rr, v0 + Math.sin(a0) * rr * 0.6, u0 + Math.cos(a1) * rr, v0 + Math.sin(a1) * rr * 0.6, 0.05]) }
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (const [w, gch, bch] of [[7, 0, 255], [2.2, 255, 0]]) for (const [x, y, nx, ny, d] of segs) {
    g.strokeStyle = `rgb(${Math.round(d * 255)},${gch},${bch})`; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke()
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter
  return tex
}

function init() {
  if (R) return R
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(SIZE, SIZE, false); renderer.setPixelRatio(1)
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  cam.position.set(0, 0.2, 6); cam.lookAt(0, 0, 0)
  const coreU = { t: { value: 0 }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, core: { value: new THREE.Color() }, deep: { value: new THREE.Color() },
    speed: { value: 1 }, dens: { value: 0.9 }, glow: { value: 0.6 }, rot: { value: 0 }, frost: { value: 0 } }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 64, 48), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: CORE_FS, uniforms: coreU }))
  const crackTex = crackTexture(), glassU = back => ({ tint: { value: new THREE.Color() }, crack: { value: 0 }, crackTex: { value: crackTex }, back: { value: back }, dim: { value: 1 } })
  const glassMat = back => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: GLASS_FS, uniforms: glassU(back), transparent: true, depthWrite: false, side: back ? THREE.BackSide : THREE.FrontSide })
  const glassBack = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), glassMat(1)), glass = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), glassMat(0))
  const sprite = (stops, sz) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(sz, sz, 1); return s }
  const glow = sprite([[0, '#ffffffcc'], [0.4, '#ffffff44'], [1, '#ffffff00']], 3.4); glow.position.z = -1.5
  const glow2 = sprite([[0, '#ffffffaa'], [0.45, '#ffffff33'], [1, '#ffffff00']], 3); glow2.position.set(0.35, -0.2, -1.4)
  const caustic = sprite([[0, '#ffffffdd'], [0.5, '#ffffff22'], [1, '#ffffff00']], 0.9); caustic.position.set(0.18, -0.62, 0.8)
  const ball = new THREE.Group(); ball.add(core)
  scene.add(glow, glow2, ball, glassBack, caustic, glass)
  // física a sério: a esfera parte-se em cacos que caem e saltam no chão (e lá ficam), ou cai inteira, rola e desfaz-se;
  // partir ao meio abre duas metades; uma dentada verte gotas que fazem uma poça; o chão racha onde ela cai
  const shards = new THREE.Group(), parts = []
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const gg = new THREE.SphereGeometry(1, 6, 4, j * Math.PI / 2, Math.PI / 2, i * Math.PI / 4, Math.PI / 4)
    const cg = new THREE.SphereGeometry(0.9, 6, 4, j * Math.PI / 2, Math.PI / 2, i * Math.PI / 4, Math.PI / 4)
    const gm = glassMat(0); gm.side = THREE.DoubleSide
    const piece = new THREE.Group(), g1 = new THREE.Mesh(gg, gm), c1 = new THREE.Mesh(cg, core.material)
    piece.add(c1, g1); shards.add(piece); parts.push(piece)
  }
  shards.visible = false
  const half = side => { const h = new THREE.Group(), gm = glassMat(0); gm.side = THREE.DoubleSide
    h.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 24, side * Math.PI, Math.PI), core.material), new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24, side * Math.PI, Math.PI), gm)); return h }
  const halves = [half(0), half(1)]; halves.forEach(h => { h.visible = false })
  const drops = new THREE.Group()
  for (let i = 0; i < 10; i++) drops.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff2a3a' })))
  drops.visible = false
  const floorMat = new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false, color: '#ffffff' })
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.8, 40), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.12
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({ color: '#ff2a3a', transparent: true, opacity: 0, depthWrite: false }))
  puddle.rotation.x = -Math.PI / 2; puddle.position.y = -1.11
  scene.add(floor, puddle, shards, ...halves, drops)
  R = { renderer, scene, cam, core, coreU, glass, glassBack, glow, glow2, caustic, ball, shards, parts, halves, drops, floor, puddle }
  return R
}

function read(o) {
  const el = o.el, cs = getComputedStyle(el), v = k => cs.getPropertyValue(k).trim()
  const col = (x, d) => { try { return new THREE.Color((x || d).replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, '$1')) } catch { return new THREE.Color(d) } }
  o.st = {
    core: col(v('--core'), '#5ee08a'), deep: col(v('--deep'), '#06301a'), s1: col(v('--smoke'), '#c8ffd9'), s2: col(v('--smoke2'), '#3ddc84'), glow: col(v('--glow'), '#22c55e'),
    low: el.classList.contains('low'), dead: el.classList.contains('dead'), burst: el.classList.contains('bursting'), mood: el.dataset.mood || '', react: el.dataset.react || '',
    anim: el.dataset.a || 'calmo', ab: +(cs.getPropertyValue('--ab') || 0) || 0, cols: (el.dataset.cols || '').split('').filter(c => COL[c]), fx: el.dataset.fx3 || '',
  }
  if (o.st.burst && !o.burstAt) o.burstAt = performance.now()
  if (!o.st.burst) o.burstAt = 0
  if (o.st.fx && o.st.fx !== o.fx) o.fxAt = performance.now()
  o.fx = o.st.fx
  o.at = performance.now()
}

const FLOOR = -1.1, GREY = new THREE.Color('#9a958f'), TOXIC = new THREE.Color('#5fd13a'), STONE = new THREE.Color('#6b6b70')
// cada derrota morre à sua maneira: vida a 0 estilhaça (cacos no chão) ou cai inteira e rola (ao acaso, com semente:
// igual em todos os ecrãs); veneno derrete numa poça verde; moer escoa o líquido e o vidro vazio desfaz-se em pó;
// comandante corta-a em duas metades que caem; «perdes o jogo»/vitória do outro implode; desistir rola para longe;
// empate fica de pedra
const DEATH3 = { psn: 'melt', mill: 'drain', cmd: 'split', lose: 'implode', alt: 'implode', concede: 'drop', draw: 'stone' }
function startFracture(o, now) {
  let h = [...String(o.el.dataset.seed || 'x')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0
  const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296 }
  const mode = DEATH3[(o.el.className.match(/\bdead-(\w+)/) || [])[1]] || (rnd() < 0.6 ? 'shatter' : 'drop'), slow = mode === 'drain' ? 0.22 : 1
  o.fr = { t0: now, last: now, mode, ball: { p: [0, 0, 0], v: [(rnd() - 0.5) * 2, 2.5, 0.4], rz: 0 },
    parts: Array.from({ length: 16 }, (_, k) => { const i = Math.floor(k / 4), j = k % 4, th = (i + 0.5) * Math.PI / 4, ph = (j + 0.5) * Math.PI / 2
      const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)], sp = (1.6 + rnd() * 2.4) * slow
      return { p: [0, 0, 0], v: [n[0] * sp, (n[1] * sp + 2.2) * slow, n[2] * sp * 0.6 + 0.6 * slow], r: [0, 0, 0], w: [(rnd() - 0.5) * 9 * slow, (rnd() - 0.5) * 9 * slow, (rnd() - 0.5) * 9 * slow] } }),
    halves: [-1, 1].map(k => ({ p: [0, 0, 0], v: [k * (0.9 + rnd() * 0.4), 1.2, 0.3], r: [0, 0, 0], w: [0, 0, k * (1.5 + rnd())] })) }
}
function stepBody(b, dt, rad = 0.12) {  // gravidade, chão com ressalto e atrito
  b.v[1] -= 9 * dt
  for (let k = 0; k < 3; k++) b.p[k] += b.v[k] * dt
  if (b.p[1] < FLOOR + rad) { b.p[1] = FLOOR + rad; if (b.v[1] < 0) b.v[1] *= -0.32; b.v[0] *= 0.82; b.v[2] *= 0.82; if (b.w) b.w = b.w.map(x => x * 0.75) }
  if (b.w) for (let k = 0; k < 3; k++) b.r[k] += b.w[k] * dt
}
function draw(now) {
  raf = 0
  if (!orbs.size) return
  const r = init(), t = (now - t0) / 1000
  for (const o of orbs) {
    if (!o.el.isConnected) { orbs.delete(o); continue }
    if (!o.st || now - o.at > 160) read(o)
    const s = o.st, fast = s.anim === 'turbilhao' ? 3 : s.anim === 'calmo' ? 0.45 : 1, u = r.coreU
    u.t.value = t + o.seed; u.c1.value.copy(s.s1); u.c2.value.copy(s.s2); u.core.value.copy(s.core); u.deep.value.copy(s.deep)
    u.speed.value = (s.mood ? 3.5 : s.low ? 2.2 : 1) * fast; u.dens.value = s.dead ? 0.1 : s.mood ? 1.3 : 0.85
    // o brilho de dentro reage: golpe/vida/veneno acende, pulsar respira, muita vida brilha mais, a casca apaga-se
    const breath = s.anim === 'pulsar' ? 0.25 * (0.5 + 0.5 * Math.sin(t * 2.6)) : 0
    u.glow.value = s.dead ? 0.05 : s.mood || s.react ? 1.2 : (s.ab > 0 ? 0.7 + 0.45 * s.ab : 0.6) + breath
    const fxk = s.fx && now - (o.fxAt || 0) < 1500 ? 1 - (now - o.fxAt) / 1500 : 0
    u.rot.value = s.fx === 'rot' ? fxk : 0; u.frost.value = s.fx === 'frost' ? fxk : 0
    const burstK = o.burstAt ? Math.min(1, (now - o.burstAt) / 700) : 0
    const crack = s.dead ? 1 : Math.max(s.low ? 0.32 : 0, burstK, (s.fx === 'crack' || s.fx === 'split') ? 0.75 * fxk : 0)
    for (const g of [r.glass, r.glassBack]) { g.material.uniforms.crack.value = crack; g.material.uniforms.tint.value.copy(s.core); g.material.uniforms.dim.value = s.dead ? 0.85 : 1 }
    const bt = o.el._beat, ph = bt ? ((now - bt.t0) % bt.P) / bt.P : 0  // o mesmo relógio do som do coração
    const heart = ph < 0.05 ? ph / 0.05 * 0.07 : ph < 0.11 ? 0.07 - (ph - 0.05) / 0.06 * 0.08 : ph < 0.17 ? -0.01 + (ph - 0.11) / 0.06 * 0.06 : ph < 0.26 ? 0.05 - (ph - 0.17) / 0.09 * 0.05 : 0
    const beat = s.low && !s.dead && bt ? 1 + heart : 1, fat = 1 + 0.25 * s.ab, wob = s.burst ? 1 + 0.035 * Math.sin(t * 60) : 1
    const sc = beat * fat * wob
    r.ball.scale.setScalar(sc); r.glass.scale.setScalar(sc); r.glassBack.scale.setScalar(sc)
    const split = s.fx === 'split' ? Math.sin(Math.min(1, fxk * 1.4) * Math.PI) * 0.12 : 0
    r.ball.scale.x = sc * (1 + split); r.glass.scale.x = sc * (1 + split * 0.6)
    const px = o.el._proxy, sl = px ? [parseFloat(px.style.getPropertyValue('--slx')) || 0, parseFloat(px.style.getPropertyValue('--sly')) || 0] : [0, 0]
    r.ball.rotation.set(sl[1] * 0.06, t * 0.3 * fast + o.seed, -sl[0] * 0.06)
    const cols = s.cols.length ? s.cols : null
    if (cols) r.glow.material.color.set(COL[cols[0]]); else r.glow.material.color.copy(s.glow)
    r.glow2.material.color.set(cols ? COL[cols[1] || cols[0]] : '#000000')
    const ga = s.dead ? 0 : s.mood || s.react ? 0.95 : s.ab > 0 ? 0.55 + 0.35 * s.ab : 0.4
    r.glow.material.opacity = ga; r.glow2.material.opacity = cols && cols.length > 1 ? ga * 0.8 : 0
    r.caustic.material.color.copy(s.core).lerp(new THREE.Color('#ffffff'), 0.5); r.caustic.material.opacity = s.dead ? 0 : 0.55
    // a casca rebentada: a física dos cacos (ou da esfera inteira a cair e rolar) e o chão rachado; câmara mais alta
    if (s.dead && !o.fr) startFracture(o, now)
    if (!s.dead) o.fr = null
    const fr = o.fr, dt = fr ? Math.min(0.033, (now - fr.last) / 1000) : 0
    if (fr) fr.last = now
    r.cam.position.set(0, fr ? 2.4 : 0.2, fr ? 11.5 : 6); r.cam.lookAt(0, fr ? -0.5 : 0, 0)
    const age = fr ? (now - fr.t0) / 1000 : 0, md = fr?.mode
    r.glass.rotation.y = r.glassBack.rotation.y = 0  // as malhas são partilhadas: o rodopio do implodir não passa para a esfera seguinte
    const crumble = md === 'shatter' || (md === 'drain' && age > 1.5)  // moer: primeiro escoa, depois o vidro vazio desfaz-se
    r.shards.visible = !!fr && crumble
    const showWhole = !fr || md === 'drop' || md === 'melt' || md === 'implode' || md === 'stone' || (md === 'drain' && !crumble)
    r.ball.visible = r.glass.visible = r.glassBack.visible = showWhole
    r.parts.forEach(m => { m.children[0].visible = md !== 'drain' })  // os cacos do moer já não têm líquido
    if (fr && crumble) fr.parts.forEach((b, k) => { stepBody(b, dt); const m = r.parts[k]; m.position.set(...b.p); m.rotation.set(...b.r)
      const u2 = m.children[1].material.uniforms; u2.tint.value.copy(md === 'drain' ? GREY : s.core); u2.crack.value = 1
      if (md === 'drain') m.scale.setScalar(Math.max(0.001, 1 - Math.max(0, age - 2.6) / 1.4)); else m.scale.setScalar(1) })
    if (md === 'drain' && !crumble) {  // o líquido escoa: fica ralo e cinzento até ao vidro vazio, que estala
      const k = Math.min(1, age / 1.4)
      u.dens.value = 0.1 * (1 - k); for (const c of [u.c1, u.c2, u.core, u.deep]) c.value.lerp(GREY, k)
      r.ball.scale.setScalar(sc * (1 - 0.85 * k)); r.ball.position.y = -0.55 * k
      for (const g of [r.glass, r.glassBack]) { g.material.uniforms.crack.value = 0.4 + 0.6 * k; g.material.uniforms.tint.value.copy(GREY) }
    }
    if (md === 'melt' || md === 'stone') {  // veneno: o líquido fica tóxico e derrete; empate: pedra cinzenta, parada
      const k = md === 'stone' ? Math.min(1, age / 0.8) : Math.min(1, age / 2.4), to = md === 'stone' ? STONE : TOXIC
      for (const c of [u.c1, u.c2, u.core, u.deep]) c.value.lerp(to, k)
      u.speed.value = md === 'stone' ? 0.0001 : 4 * (1 - k) + 0.3
      if (md === 'melt') { const y = 1 - 0.78 * k, w = 1 + 0.45 * k
        for (const m of [r.ball, r.glass, r.glassBack]) { m.scale.set(sc * w, sc * y, sc * w); m.position.y = -(1 - y) * 0.95 }
        for (const g of [r.glass, r.glassBack]) g.material.uniforms.dim.value = Math.max(0.05, 1 - k) }
      else for (const g of [r.glass, r.glassBack]) { g.material.uniforms.crack.value = 0.35; g.material.uniforms.tint.value.copy(STONE); g.material.uniforms.dim.value = 0.55 }
    }
    if (md === 'implode') {  // engolida: roda cada vez mais depressa e encolhe até um ponto
      const k = Math.min(1, age / 1.1), z = Math.max(0.001, 1 - k * k)
      for (const m of [r.ball, r.glass, r.glassBack]) { m.scale.setScalar(sc * z); m.rotation.y = age * age * 14 }
    }
    r.halves.forEach(h => { const u2 = h.children[1].material.uniforms; u2.tint.value.copy(s.core); u2.crack.value = 0.6 })
    if (fr?.mode === 'drop') {  // cai, salta, rola para o lado e desfaz-se em pó
      const b = fr.ball; stepBody(b, dt, 1); b.rz -= b.v[0] * dt
      const age = (now - fr.t0) / 1000, k = Math.max(0, 1 - Math.max(0, age - 1.6) / 1.2)
      for (const m of [r.ball, r.glass, r.glassBack]) { m.position.set(...b.p); m.rotation.z = b.rz; m.scale.setScalar(Math.max(0.001, k) * sc) }
      r.glass.material.uniforms.dim.value = k; r.glassBack.material.uniforms.dim.value = k
    } else if (md !== 'melt' && md !== 'drain') for (const m of [r.ball, r.glass, r.glassBack]) { m.position.set(0, 0, 0); m.rotation.z = 0 }
    if (!fr) r.ball.position.y = 0
    r.floor.material.opacity = fr && md !== 'implode' && md !== 'stone' ? Math.min(0.85, (now - fr.t0) / 600) : 0
    r.glow.visible = r.glow2.visible = r.caustic.visible = !fr
    // partir ao meio: as duas metades afastam-se e voltam a juntar-se
    const opening = s.fx === 'split' && fxk > 0 && !fr
    r.halves.forEach((h, k) => { h.visible = opening || md === 'split'; if (opening) { h.position.set((k ? 1 : -1) * Math.sin(Math.min(1, fxk * 1.3) * Math.PI) * 0.45, 0, 0); h.rotation.set(0, 0, 0); h.scale.setScalar(sc) } })
    if (md === 'split') r.halves.forEach((h, k) => {  // comandante: cortada ao meio, as metades caem para os lados e ficam no chão
      const b = fr.halves[k]; if (age > 0.25) stepBody(b, dt, 0.5); h.position.set(...b.p); h.rotation.set(...b.r); h.scale.setScalar(sc)
      const u2 = h.children[1].material.uniforms; u2.tint.value.copy(s.core); u2.crack.value = 0.5 })
    if (opening || md === 'split') r.ball.visible = r.glass.visible = r.glassBack.visible = false
    // verter (dentada, sangue): gotas da cor do líquido caem pelo lado e fazem uma poça
    const spill = s.fx === 'spill' && !fr
    if (spill && !o.drops) o.drops = Array.from({ length: 10 }, () => ({ p: [0.75 + Math.random() * 0.2, Math.random() * 0.4, 0.4], v: [0.6 + Math.random(), 0.6 + Math.random(), (Math.random() - 0.5)] }))
    if (!s.fx) o.drops = null
    r.drops.visible = !!o.drops
    if (o.drops) o.drops.forEach((b, k) => { stepBody(b, 0.016, 0.05); const m = r.drops.children[k]; m.position.set(...b.p); m.material.color.copy(s.core) })
    r.puddle.material.opacity = o.drops ? 0.75 * Math.min(1, (1 - fxk) * 2) : 0; r.puddle.material.color.copy(s.core); r.puddle.position.x = 1.2; r.puddle.scale.setScalar(1)
    if (md === 'melt') { const k = Math.min(1, age / 2.4); r.puddle.material.opacity = 0.85 * k; r.puddle.material.color.copy(TOXIC); r.puddle.position.x = 0; r.puddle.scale.setScalar(0.4 + 1.6 * k) }
    r.renderer.render(r.scene, r.cam)
    const cv = (px && px.querySelector('canvas.orb3d')) || o.cv, g = cv.getContext('2d')
    if (cv.width !== SIZE) { cv.width = SIZE; cv.height = SIZE }
    g.clearRect(0, 0, SIZE, SIZE); g.drawImage(r.renderer.domElement, 0, 0)
    if (!o.ready) { o.ready = true; o.el.dataset.o3 = '1' }  // já há desenho 3D: só agora a esfera clássica sai do caminho
  }
  if (orbs.size) raf = requestAnimationFrame(draw)
}

export function attachOrb3d(el, cv) {
  const o = { el, cv, seed: Math.random() * 10 }
  // partida: arrastar empurra os cacos perto do dedo (em vez de mexer a esfera toda) — coordenadas do ecrã → da cena
  el._poke = (x, y, vx, vy) => {
    if (!o.fr || o.fr.mode !== 'shatter') return
    const r = (el._proxy?.querySelector('canvas.orb3d') || cv).getBoundingClientRect(), span = 2 * Math.tan(Math.PI / 12) * 11.5
    const wx = ((x - r.left) / r.width - 0.5) * span, wy = -((y - r.top) / r.height - 0.5) * span - 0.5
    for (const b of o.fr.parts) {
      const d = Math.hypot(b.p[0] - wx, b.p[1] - wy)
      if (d < 0.9) { const k = (1 - d / 0.9) * 0.012; b.v[0] += vx * k; b.v[1] += Math.max(1, -vy * k); b.w = b.w.map(w => w + (Math.random() - 0.5) * 6) }
    }
  }
  orbs.add(o)
  if (!raf) raf = requestAnimationFrame(draw)
  return () => { orbs.delete(o) }
}
