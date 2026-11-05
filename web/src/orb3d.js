// Esfera da vida em 3D (WebGL, three.js como os dados). Um só renderizador para todas as esferas do ecrã: a cada frame
// desenha cada esfera e copia a imagem para o <canvas> dela (no telemóvel não se abre um contexto WebGL por esfera).
// O que a esfera mostra vem do elemento .orb que já existe (estilo, estado, reação, pouca/muita vida, rebentada): as
// cores lêem-se das variáveis CSS (--core, --deep, --smoke, --smoke2, --glow) e as classes/data-* dizem o resto. Assim a
// lógica toda (golpes, física, online) continua a mesma e o 3D só a desenha.
// O halo do deck: anéis à volta com as cores do deck (data-cols, p.ex. «WG») e o movimento do estilo (data-a).
// Sem WebGL: fica a esfera clássica (CSS).
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const COL = { W: '#fff3c4', U: '#4cc9f0', B: '#a78bfa', R: '#ff5c3a', G: '#4ade80', C: '#cbd5e1' }
const SIZE = 192  // px do desenho (a esfera tem ~56 px; com halo e densidade de ecrã chega)
let R = null  // {renderer, scene, cam, glass, smoke, halo, glow, env}
const orbs = new Set()
let raf = 0, t0 = performance.now()

export const webgl3d = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } }

const SMOKE_FS = `
uniform float t; uniform vec3 c1; uniform vec3 c2; uniform float speed; uniform float dens; varying vec3 vp;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int k=0;k<4;k++){ s+=a*n(p); p*=2.1; a*=.5; } return s; }
void main(){
  vec3 p = vp*2.2 + vec3(0., t*speed*.35, t*speed*.2);
  float s = fbm(p + fbm(p + t*speed*.15));
  float edge = smoothstep(1.0, .55, length(vp));
  float a = smoothstep(.35, .85, s) * edge * dens;
  gl_FragColor = vec4(mix(c2, c1, s), a);
}`
const SMOKE_VS = 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }'

function init() {
  if (R) return R
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(SIZE, SIZE, false); renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  cam.position.set(0, 0.35, 6); cam.lookAt(0, 0, 0)
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = env
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-2, 3, 4); scene.add(key)
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  // o núcleo colorido (o líquido), o fumo (shader), o vidro (transmissão, reflexos) e o halo do deck
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.74, 48, 32), new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 0.55, roughness: 0.35 }))
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 32), new THREE.ShaderMaterial({ vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { t: { value: 0 }, c1: { value: new THREE.Color('#c8ffd9') }, c2: { value: new THREE.Color('#3ddc84') }, speed: { value: 1 }, dens: { value: 0.9 } } }))
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.03,
    clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.18, envMapIntensity: 2.2, specularIntensity: 1, depthWrite: false }))  // vidro fino: deixa ver o líquido, guarda os reflexos
  const halo = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.32 + i * 0.07, 0.022, 10, 96), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.35; ring.rotation.y = (i - 1) * 0.5; halo.add(ring)
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, '#ffffffff'); gr.addColorStop(0.35, '#ffffff66'); gr.addColorStop(1, '#ffffff00'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c) })()
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#22c55e', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
  glow.scale.set(3.6, 3.6, 1); glow.position.z = -1.2
  const ball = new THREE.Group(); ball.add(core, smoke, glass)
  scene.add(glow, ball, halo)
  R = { renderer, scene, cam, core, smoke, glass, halo, glow, ball }
  return R
}

// cores e estado de cada esfera, relidos do elemento de vez em quando (o CSS manda: estilos, humor, reações)
function read(o) {
  const el = o.el, cs = getComputedStyle(el), v = k => cs.getPropertyValue(k).trim()
  const safe = (x, d) => { try { return new THREE.Color(x || d) } catch { return new THREE.Color(d) } }
  const strip = x => (x || '').replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, '$1')
  o.st = {
    core: safe(strip(v('--core')), '#5ee08a'), deep: safe(strip(v('--deep')), '#06301a'), s1: safe(strip(v('--smoke')), '#c8ffd9'), s2: safe(strip(v('--smoke2')), '#3ddc84'), glow: safe(strip(v('--glow')), '#22c55e'),
    low: el.classList.contains('low'), dead: el.classList.contains('dead'), burst: el.classList.contains('bursting'), mood: el.dataset.mood || '', react: el.dataset.react || '',
    anim: el.dataset.a || 'calmo', ab: +(cs.getPropertyValue('--ab') || 0) || 0, cols: (el.dataset.cols || '').split('').filter(c => COL[c]),
  }
  o.at = performance.now()
}

function draw(now) {
  raf = 0
  if (!orbs.size) return
  const r = init(), t = (now - t0) / 1000
  for (const o of orbs) {
    if (!o.el.isConnected) { orbs.delete(o); continue }
    if (!o.st || now - o.at > 220) read(o)
    const s = o.st, fast = s.anim === 'turbilhao' ? 3 : s.anim === 'calmo' ? 0.45 : 1
    // o núcleo e o fumo com as cores do estilo/estado; pouca vida bate, muita vida incha, rebentada fica escura
    r.core.material.color.copy(s.core).lerp(s.deep, 0.35); r.core.material.emissive.copy(s.core).lerp(s.deep, 0.5)
    r.core.material.emissiveIntensity = s.dead ? 0.05 : s.mood || s.react ? 1.1 : 0.55
    const u = r.smoke.material.uniforms
    u.t.value = t + o.seed; u.c1.value.copy(s.s1); u.c2.value.copy(s.s2)
    u.speed.value = (s.mood ? 3.5 : s.low ? 2.2 : 1) * fast; u.dens.value = s.dead ? 0.15 : s.mood ? 1.4 : 0.9
    const beat = s.low && !s.dead ? 1 + 0.06 * Math.max(0, Math.sin(t * 7.5)) ** 8 : 1
    const fat = 1 + 0.25 * s.ab, wob = s.burst ? 1 + 0.04 * Math.sin(t * 60) : 1
    r.ball.scale.setScalar(beat * fat * wob)
    // a esfera roda devagar e balança com o movimento (vem da física: --slx/--sly na cópia que voa)
    const px = o.el._proxy, sl = px ? [parseFloat(px.style.getPropertyValue('--slx')) || 0, parseFloat(px.style.getPropertyValue('--sly')) || 0] : [0, 0]
    r.ball.rotation.set(sl[1] * 0.05, t * 0.25 * fast + o.seed, -sl[0] * 0.05)
    r.glass.material.roughness = s.dead ? 0.35 : 0.03; r.glass.material.opacity = s.dead ? 0.7 : 0.18
    // o halo do deck: um anel por cor do deck (as cores dos custos), a rodar ao ritmo do estilo; brilha mais com reações
    const cols = s.cols.length ? s.cols : ['C']
    r.halo.children.forEach((ring, i) => {
      const c = COL[cols[i % cols.length]] || COL.C
      ring.visible = !s.dead && i < Math.max(1, Math.min(3, cols.length))
      ring.material.color.set(c); ring.material.opacity = (s.react || s.mood ? 1 : 0.65) * (0.7 + 0.3 * Math.sin(t * 2 + i))
      ring.rotation.z = t * (0.4 + 0.25 * i) * fast * (i % 2 ? -1 : 1)
    })
    r.halo.scale.setScalar(fat * (s.ab > 0 ? 1.08 : 1))
    r.glow.material.color.copy(s.glow); r.glow.material.opacity = s.dead ? 0 : s.mood || s.react ? 0.95 : s.ab > 0 ? 0.6 + 0.35 * s.ab : 0.45
    r.renderer.render(r.scene, r.cam)
    // a imagem vai para o canvas da esfera (ou da cópia que está a voar)
    const cv = (px && px.querySelector('canvas.orb3d')) || o.cv, g = cv.getContext('2d')
    if (cv.width !== SIZE) { cv.width = SIZE; cv.height = SIZE }
    g.clearRect(0, 0, SIZE, SIZE); g.drawImage(r.renderer.domElement, 0, 0)
  }
  if (orbs.size) raf = requestAnimationFrame(draw)
}

// liga uma esfera (o elemento .orb e o seu canvas); devolve a função para a desligar
export function attachOrb3d(el, cv) {
  const o = { el, cv, seed: Math.random() * 10 }
  orbs.add(o)
  if (!raf) raf = requestAnimationFrame(draw)
  return () => { orbs.delete(o) }
}
