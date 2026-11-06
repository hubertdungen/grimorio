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
import { FluidSim, MANA_MAT } from './orbfluid.js'

const COL = { W: '#f5c451', U: '#4cc9f0', B: '#a78bfa', R: '#ff5c3a', G: '#4ade80', C: '#cbd5e1' }
const SIZE = 300  // o quadro é 2,5× a esfera (CSS .orb3d): espaço para o halo e o que verte
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
uniform float elem; uniform vec3 wA; uniform vec3 wB; uniform float wlite; uniform float tox; uniform vec4 env1; uniform float exl; uniform vec2 slosh; uniform vec4 stain; uniform vec3 ink; uniform vec4 inkP; uniform float inkK;
varying vec3 vN; varying vec3 vP; varying vec3 vO;
float ridge(float x){ return 1. - abs(2.*x - 1.); }
// um líquido por cor de mana, cada um com a sua viscosidade (tt já vem com a velocidade da mistura)
vec3 lightF(vec3 q, float tt){  // branco: luz dourada líquida em ondas (honra, cura); os feitiços puxam para branco
  float w = .5 + .5*sin(q.y*5.5 + q.x*1.4 + tt*1.7 + fbm(q*1.3 + tt*.12)*4.);
  vec3 a = mix(vec3(.55,.37,.07), vec3(.82,.8,.74), wlite), b = mix(vec3(1.,.8,.34), vec3(1.,.98,.92), wlite);
  return mix(a, b, w) + smoothstep(.6, 1., w)*vec3(1.,.93,.7)*.6; }
vec3 waterF(vec3 q, float tt){  // azul: água a correr, com cristas claras
  vec3 f = q + vec3(tt*.6, sin(q.x*1.3 + tt)*.18, 0.);
  float a = fbm(f*1.3 + fbm(f*.9 - tt*.25)), c = pow(ridge(n(f*3.1 + vec3(0., tt*.9, 0.))), 6.);
  return mix(vec3(.02,.1,.3), vec3(.12,.58,.95), a) + c*vec3(.55,.85,1.)*.7; }
vec3 swampF(vec3 q, float tt){  // preto: pântano — fumo escuro, água lamacenta castanha, manchas de fungos verde-escuro e roxo
  vec3 f = q*.9 + vec3(0., tt*.1, tt*.06);
  float sm = fbm(f + fbm(f*1.7 + tt*.07)), mud = fbm(q*2.2 - tt*.04), spots = smoothstep(.56, .68, n(q*6.5 + tt*.06));
  vec3 c = mix(vec3(.03,.02,.03), vec3(.26,.16,.07), smoothstep(.25, .7, mud));
  c = mix(c, vec3(.27,.23,.31), smoothstep(.45, .85, sm)*.8);
  return mix(c, mix(vec3(.07,.2,.06), vec3(.3,.09,.36), n(q*3. + 7.)), spots*.75); }
vec3 lavaF(vec3 q, float tt){  // vermelho: lava a subir, veios incandescentes
  vec3 f = q*1.4 + vec3(0., -tt*.7, 0.);
  float a = fbm(f + fbm(f*1.5)), c = pow(ridge(fbm(q*2.6 - vec3(0., tt*1., 0.))), 5.);
  return mix(vec3(.22,.03,0.), vec3(1.,.32,.06), a) + c*vec3(1.,.78,.38); }
vec3 mossF(vec3 q, float tt){  // verde: pastoso, devagar, como plantas a mexer, com veios de seiva
  vec3 f = q*1.1 + vec3(sin(tt*.3)*.3, tt*.05, 0.);
  float a = fbm(f + .6*fbm(f*1.3 + tt*.05)), v = 1. - smoothstep(0., .045, abs(n(q*3.5 + vec3(tt*.06)) - .5));
  return mix(mix(vec3(.04,.18,.06), vec3(.3,.78,.36), a), vec3(.02,.09,.03), v*.8) + vec3(.6,1.,.3)*pow(a, 4.)*.4; }
vec3 metalF(vec3 q, float tt){  // incolor: cinzentos e metal escovado (artefactos, mechs, eldrazi)
  float b = .5 + .5*sin(q.y*9. + q.x*2. + fbm(q*2.2 + tt*.06)*6.), a = fbm(q*1.6 + tt*.08);
  return mix(vec3(.2,.21,.25), vec3(.68,.71,.78), a*.85 + b*.12) + pow(b, 18.)*vec3(.22); }
// a mistura: cada cor ocupa correntes próprias que se enrolam umas nas outras (não uma média lamacenta);
// o peso de cada uma é o que está em campo
vec3 elemCol(vec3 q, float tt){
  vec3 g = q*1.2 + vec3(fbm(q*.8 + tt*.05), fbm(q*.8 + 3.1 - tt*.04), 0.)*1.6;
  float k = 7.;
  float e0 = wA.x > 0. ? exp(k*(fbm(g + vec3(1.7,0.,0.)) + .35*log(wA.x))) : 0.;
  float e1 = wA.y > 0. ? exp(k*(fbm(g + vec3(0.,4.3,0.)) + .35*log(wA.y))) : 0.;
  float e2 = wA.z > 0. ? exp(k*(fbm(g + vec3(0.,0.,8.9)) + .35*log(wA.z))) : 0.;
  float e3 = wB.x > 0. ? exp(k*(fbm(g + vec3(5.2,2.,0.)) + .35*log(wB.x))) : 0.;
  float e4 = wB.y > 0. ? exp(k*(fbm(g + vec3(2.,7.5,1.)) + .35*log(wB.y))) : 0.;
  float e5 = wB.z > 0. ? exp(k*(fbm(g + vec3(9.,1.,3.)) + .35*log(wB.z))) : 0.;
  float S = e0 + e1 + e2 + e3 + e4 + e5 + 1e-5;
  vec3 c = vec3(0.);
  if (e0 > 0.) c += lightF(q, tt) * e0; if (e1 > 0.) c += waterF(q, tt) * e1; if (e2 > 0.) c += swampF(q, tt) * e2;
  if (e3 > 0.) c += lavaF(q, tt) * e3; if (e4 > 0.) c += mossF(q, tt) * e4; if (e5 > 0.) c += metalF(q, tt) * e5;
  return c / S; }
void main(){
  vec3 V = normalize(-vP); float facing = max(dot(normalize(vN), V), 0.);
  // o líquido com inércia: fica para trás quando a esfera acelera (arrastar, atirar, golpes) e volta a assentar
  vec3 vQ = vO - vec3(slosh, 0.)*.9;
  vec3 p = vQ*2.4 + vec3(0., t*speed*.35, t*speed*.2);
  float s = fbm(p + fbm(p + t*speed*.15));
  vec3 col = mix(deep, core, .3 + .7*facing);
  col = mix(col, mix(c2, c1, s), smoothstep(.35, .9, s) * dens);
  if (elem > .5) { vec3 e = elemCol(vQ*2.2, t*speed*.5); col = e * (.45 + .55*facing) * (dens > .2 ? 1. : .35); }
  col += core * pow(facing, 3.) * glow * (elem > .5 ? .45 : .9);       // brilho de dentro, no centro
  col *= .5 + glow*.8;
  // dano levado: o líquido fica pisado, com capilares vermelhos
  if (env1.x > 0.) { float cap = pow(ridge(fbm(vQ*3.2 + t*.05)), 7.); col = mix(col, col*vec3(.78,.5,.5), env1.x*.45) + cap*env1.x*vec3(.75,.05,.08); }
  // feitiços a favor: faíscas douradas a subir; contra: gavinhas escuras a entrar pelas bordas
  if (env1.y > 0.) col += smoothstep(.965, .99, n(vQ*12. - vec3(0., t*.9, 0.)))*env1.y*vec3(1.,.88,.55)*1.4;
  if (env1.z > 0.) { float te = smoothstep(.45, .7, fbm(vQ*2.8 + vec3(t*.12, 0., 0.)) + (1. - facing)*.5); col = mix(col, vec3(.06,.02,.08), te*env1.z*.75); }
  // cemitério: sedimento escuro no fundo, mais alto com mais cartas; exílio: fantasmas pálidos a subir
  if (env1.w > 0.) { float lvl = -.9 + env1.w*.6, sed = 1. - smoothstep(lvl - .06, lvl + .04, vQ.y + (n(vQ*8. + t*.05) - .5)*.08);
    col = mix(col, vec3(.13,.11,.1)*(.6 + .8*n(vQ*22.)), sed*.85); }
  if (exl > 0.) col += smoothstep(.62, .82, fbm(vQ*3. + vec3(0., -t*.3, t*.05)))*exl*vec3(.65,.75,.95)*.55;
  // veneno: veios tóxicos e bolhas a subir, mais com mais veneno; o líquido puxa para verde-roxo
  if (tox > 0.) {
    float tv = 1. - smoothstep(0., .05, abs(fbm(vQ*2.5 + t*.2) - .5)), bub = smoothstep(.78, .82, n(vQ*7. + vec3(0., -t*(1. + 2.*tox), 0.)));
    col = mix(col, vec3(.3,.12,.42), tox*.25); col = mix(col, vec3(.38,.95,.22), tv*tox*.7) + bub*tox*vec3(.45,1.,.3)*.7; }
  // a mancha do que entrou: assentou no fundo (inclina com o chapinhar porque usa vQ)
  if (stain.w > 0.) col = mix(col, stain.rgb * (.55 + .5*n(vQ*6. + t*.08)), stain.w * (1. - smoothstep(-.95, .15, vQ.y + (fbm(vQ*3.) - .5)*.3)) * .7);
  // o que entrou com um golpe (sangue, pedra, lascas de metal, brasas…): uma pluma da cor dele a espalhar-se e a assentar
  if (inkK > 0.) {
    float d = distance(vQ, inkP.xyz) - inkP.w + (fbm(vQ*4. + t*.3) - .5)*.7, pl = 1. - smoothstep(0., .35, d);
    float fl = smoothstep(.9, .95, n(vQ*10. + vec3(0., t*1.4, 0.)));
    col = mix(col, ink, pl*inkK*.8) + fl*pl*inkK*ink*.5; }
  float spots = smoothstep(.55, .75, fbm(vQ*5. + 3.));
  col = mix(col, mix(vec3(.18,.24,.05), vec3(.03,.02,.02), spots), rot*.85);
  col = mix(col, vec3(.75,.9,1.), frost*.6);
  gl_FragColor = vec4(col, 1.);
}`
const GLASS_FS = `${NOISE}
uniform vec3 tint; uniform float crack; uniform sampler2D crackTex; uniform float back; uniform float dim; uniform float sweat; uniform float frostG; uniform float gt;
varying vec3 vN; varying vec3 vP; varying vec2 vUv; varying vec3 vO;
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
  // suor: gotas no vidro que escorrem devagar; geada: cristais brancos a partir da borda
  if (sweat > 0. && back < .5) { float bead = smoothstep(.9, .96, n(vec3(vO.x*16., vO.y*9. + gt*.25, vO.z*16.))); col += bead*sweat*vec3(.9); a += bead*sweat*.55; }
  if (frostG > 0.) { float fz = smoothstep(.7, 1., fbm(vO*7.)*.6 + fr*.9) * frostG; col = mix(col, vec3(.88,.95,1.), fz*.7); a += fz*.4; }
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
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(46, 1, 0.1, 50)
  cam.position.set(0, 1.35, 5.85); cam.lookAt(0, 0, 0)  // um pouco por cima: vê-se que é uma esfera e a fundura do que tem dentro
  const coreU = { t: { value: 0 }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, core: { value: new THREE.Color() }, deep: { value: new THREE.Color() },
    speed: { value: 1 }, dens: { value: 0.9 }, glow: { value: 0.6 }, rot: { value: 0 }, frost: { value: 0 },
    env1: { value: new THREE.Vector4() }, exl: { value: 0 }, stain: { value: new THREE.Vector4() }, slosh: { value: new THREE.Vector2() }, elem: { value: 0 }, wA: { value: new THREE.Vector3() }, wB: { value: new THREE.Vector3() }, wlite: { value: 0 }, tox: { value: 0 }, ink: { value: new THREE.Color() }, inkP: { value: new THREE.Vector4() }, inkK: { value: 0 } }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 64, 48), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: CORE_FS, uniforms: coreU }))
  const crackTex = crackTexture(), glassU = back => ({ tint: { value: new THREE.Color() }, crack: { value: 0 }, crackTex: { value: crackTex }, back: { value: back }, dim: { value: 1 }, sweat: { value: 0 }, frostG: { value: 0 }, gt: { value: 0 } })
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
  // a sombra no chão por baixo da esfera (ajuda a ler o volume)
  const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64)
    gr.addColorStop(0, '#000000aa'); gr.addColorStop(0.6, '#00000033'); gr.addColorStop(1, '#00000000'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c) })()
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.02; scene.add(shadow)
  glassBack.renderOrder = 0; glass.renderOrder = 3  // as partículas do fluido desenham-se entre a parte de trás e a da frente do vidro
  const ptVS = 'attribute float size; attribute float alpha; attribute vec3 color; attribute float shape; attribute float rot; varying vec3 vC; varying float vA; varying float vS; varying float vR; uniform float scale; void main(){ vC = color; vA = alpha; vS = shape; vR = rot; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = size * scale / -mv.z * (shape > .5 ? 1.6 : 1.); gl_Position = projectionMatrix * mv; }'
  // formas: 0 gota (sombreada), 1 pena (oval com haste), 2 estrela de quatro pontas, 3 raio (traço em zigue-zague)
  const ptFS = `varying vec3 vC; varying float vA; varying float vS; varying float vR; uniform float add;
void main(){
  vec2 d = gl_PointCoord - .5; float c = cos(vR), s = sin(vR); vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  float a, sh = 1.;
  if (vS > 2.5) { float w = abs(q.y + sin(q.x * 38.) * .05); a = (1. - smoothstep(.015, .06, w)) * (1. - smoothstep(.3, .5, abs(q.x))); sh = 1.6; }
  else if (vS > 1.5) { float st = min(abs(q.x), abs(q.y)) * 6. + length(q) * 1.4; a = 1. - smoothstep(.25, .75, st); sh = 1.5; }
  else if (vS > .5) { vec2 e = q / vec2(.17, .46); float r2 = dot(e, e); a = (1. - smoothstep(.75, 1., r2)) * (1. - .45 * (1. - smoothstep(.0, .02, abs(q.x)))); sh = .85 + .4 * (.2 - q.y); }
  else { float r = length(d); if (r > .5) discard; a = 1. - smoothstep(.18, .5, r); sh = add > .5 ? 1.5 : .78 + .55 * (.2 - d.y) - r * .35; }
  if (a < .01) discard;
  gl_FragColor = vec4(vC * sh, a * vA);
}`
  const ptMat = additive => new THREE.ShaderMaterial({ vertexShader: ptVS, fragmentShader: ptFS, uniforms: { scale: { value: 150 * (300 / 192) * (Math.tan(15 * Math.PI / 180) / Math.tan(23 * Math.PI / 180)) }, add: { value: additive ? 1 : 0 } }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
  const ptMats = [ptMat(false), ptMat(true)]
  // gás: baforada irregular (ruído) e chama: gota alongada a tremer (as funções de ruído antes do main)
  ptMats.forEach(m => {
    m.fragmentShader = m.fragmentShader.replace('void main(){', `float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
void main(){`).replace('if (vS > 2.5) {', `if (vS > 4.5) { vec2 e = q / vec2(.22, .48); e.y += .25; float r2 = dot(e, e); a = (1. - smoothstep(.3, 1., r2)) * (.7 + .3 * nn(q * 9. + vR * 3.)); sh = 1.3 + .5 * (1. - r2); }
  else if (vS > 3.5) { float r = length(d); float n2 = nn(q * 5. + vR) * .6 + nn(q * 11. - vR) * .4; a = (1. - smoothstep(.1, .5, r + (n2 - .5) * .25)) * (.55 + .45 * n2); sh = .8 + .35 * n2; }
  else if (vS > 2.5) {`)
  })
  // líquidos: cada partícula soma uma mancha gaussiana (cor × peso, peso) numa imagem à parte; depois um quadrado no ecrã
  // desenha só onde o peso passa o limiar — a superfície contínua do líquido — com reflexo, brilho e borda pela inclinação
  const liqMat = new THREE.ShaderMaterial({ vertexShader: ptVS, fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - .5; float k = exp(-dot(d, d) * 14.) * vA; gl_FragColor = vec4(vC * k, k); }',
    uniforms: { scale: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor })
  const LQ = 160, liqRT = new THREE.WebGLRenderTarget(LQ, LQ, { type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType })
  const liqScene = new THREE.Scene()
  const comp = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
    uniforms: { tex: { value: liqRT.texture }, px: { value: 1 / LQ }, thr: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D tex; uniform float px; uniform float thr; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tex, vUv); float w = c.a; if (w < thr * .7) discard;
  vec3 col = c.rgb / max(w, 1e-3);
  float gx = texture2D(tex, vUv + vec2(px, 0.)).a - texture2D(tex, vUv - vec2(px, 0.)).a, gy = texture2D(tex, vUv + vec2(0., px)).a - texture2D(tex, vUv - vec2(0., px)).a;
  vec3 N = normalize(vec3(-gx * 2.2, -gy * 2.2, 1.)), L = normalize(vec3(-.45, .65, .6)), H = normalize(L + vec3(0., 0., 1.));
  float dif = .55 + .5 * max(dot(N, L), 0.), spec = pow(max(dot(N, H), 0.), 40.) * .9, rim = pow(1. - N.z, 2.) * .55, deep = smoothstep(thr, thr * 3.5, w);
  vec3 o = col * dif * (.75 + .35 * deep) + spec + rim * col * .8;
  gl_FragColor = vec4(o, smoothstep(thr * .7, thr * 1.15, w) * (.82 + .15 * deep));
}` }))
  comp.frustumCulled = false; comp.renderOrder = 1; comp.visible = false; scene.add(comp)
  glass.layers.set(1)  // o vidro da frente desenha-se por último, por cima do líquido (Orb: camada 1)
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
  R = { renderer, scene, cam, core, coreU, glass, glassBack, glow, glow2, caustic, ball, shards, parts, halves, drops, floor, puddle, ptMats, shadow, liqMat, liqRT, liqScene, comp }
  return R
}

function read(o) {
  const el = o.el, cs = getComputedStyle(el), v = k => cs.getPropertyValue(k).trim()
  const col = (x, d) => { try { return new THREE.Color((x || d).replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, '$1')) } catch { return new THREE.Color(d) } }
  o.st = {
    core: col(v('--core'), '#5ee08a'), deep: col(v('--deep'), '#06301a'), s1: col(v('--smoke'), '#c8ffd9'), s2: col(v('--smoke2'), '#3ddc84'), glow: col(v('--glow'), '#22c55e'),
    low: el.classList.contains('low'), dead: el.classList.contains('dead'), burst: el.classList.contains('bursting'), mood: el.dataset.mood || '', react: el.dataset.react || '',
    anim: el.dataset.a || 'calmo', ab: +(cs.getPropertyValue('--ab') || 0) || 0, cols: (el.dataset.cols || '').split('').filter(c => COL[c]), fx: el.dataset.fx3 || '',
    w: el.dataset.w ? el.dataset.w.split(',').map(Number) : null, env: el.dataset.env ? el.dataset.env.split(',').map(Number) : [0, 0, 0, 0, 0, 0, 0, 0, 0], tox: +el.dataset.psn || 0, ink: el.dataset.ink || '',
  }
  if (o.st.ink && o.st.ink !== o.ink) { o.inkAt = performance.now(); o.inkDir = el._inkDir || [0, 0]; o.inkCol = null; o.inkAmt = 0.6
    if (o.fs) { const d = o.inkDir; for (const [m, k] of STYLE_MAT[o.st.ink] || []) o.fs.inject(m, k, [-d[0], d[1], 0.5]) } }  // o que entra com o golpe
  o.ink = o.st.ink
  if (o.st.burst && !o.burstAt) o.burstAt = performance.now()
  if (!o.st.burst) o.burstAt = 0
  if (o.st.fx && o.st.fx !== o.fx) o.fxAt = performance.now()
  o.fx = o.st.fx
  o.at = performance.now()
}

// a cor do que entra no líquido com cada estilo de golpe (orbfx.js)
const INK = { bite: '#7a0010', blood: '#8a0012', claws: '#5a0a0a', sword: '#9ca3af', arrow: '#6b4423', horn: '#5c4033', smash: '#6b5b4b', dive: '#475569', thunder: '#e0f2fe',
  fire: '#ff7a1a', ice: '#bfe9ff', leaf: '#2f7a2f', holy: '#ffe08a', prism: '#f0abfc', metal: '#a1a1aa', goo: '#3f6212', rot: '#4d5d1a' }
const ECOLH = ['#f2b84b', '#38a8f0', '#4a3a2a', '#ff6a2a', '#4caf50', '#9aa3ad'], ECOL = ECOLH.map(c => new THREE.Color(c)), MIX = new THREE.Color(), TMP = new THREE.Color()
const HOT = new THREE.Color('#ff6a1a'), COLD = new THREE.Color('#9fdcff')
const STC = new THREE.Color()
// o que cada estilo de golpe mete no fluido (matéria, quantas)
const STYLE_MAT = { bite: [['blood', 22]], blood: [['blood', 30]], claws: [['blood', 18]], sword: [['metal', 10], ['blood', 12]], arrow: [['blood', 10], ['rock', 4]],
  horn: [['blood', 12], ['rock', 8]], smash: [['rock', 22]], dive: [['blood', 10], ['smoke', 8]], thunder: [['light', 16], ['ember', 10]], fire: [['ember', 16], ['lava', 12]],
  ice: [['frost', 22]], leaf: [['spore', 18], ['paste', 6]], holy: [['light', 24]], prism: [['light', 12], ['frost', 8], ['ember', 6]], metal: [['metal', 22]],
  goo: [['mud', 16], ['poison', 10]], rot: [['poison', 18], ['spore', 8]] }
// aparelhos fracos (telemóvel): menos partículas
const LOW = typeof navigator !== 'undefined' && ((navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent || ''))
// as fendas da esfera: direções fixas por esfera (com semente), mais com mais rachas
function holesFor(o, crack) {
  let h = Math.floor(o.seed * 1e6) >>> 0
  const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296 }
  return Array.from({ length: crack > 0.8 ? 4 : crack > 0.5 ? 3 : 2 }, () => { const a = rnd() * Math.PI * 2, y = -0.2 - rnd() * 0.75, c = Math.sqrt(1 - y * y); return { d: [Math.cos(a) * c, y, Math.sin(a) * c], k: crack } })
}
// desenhar o fluido: partículas opacas/normais e as de luz (aditivas), com o tamanho e a cor de cada uma
function drawFluid(r, o, fs, now) {
  if (!o.pts) {
    const mk = (mat, sc, ord) => { const g = new THREE.BufferGeometry(), n = fs.max
      for (const [k, d] of [['position', 3], ['color', 3], ['size', 1], ['alpha', 1], ['shape', 1], ['rot', 1]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * d), d).setUsage(THREE.DynamicDrawUsage))
      const p = new THREE.Points(g, mat); p.frustumCulled = false; p.renderOrder = ord; p.visible = false; (sc || r.scene).add(p); return p }
    o.pts = { objs: [mk(r.liqMat, r.liqScene, 0), mk(r.ptMats[0], null, 1.5), mk(r.ptMats[0], null, 1.7), mk(r.ptMats[1], null, 2)],
      tmp: { pos: new Float32Array(fs.max * 3), col: new Float32Array(fs.max * 3), size: new Float32Array(fs.max), glow: new Float32Array(fs.max), alpha: new Float32Array(fs.max), shape: new Float32Array(fs.max), rot: new Float32Array(fs.max), kind: new Float32Array(fs.max) } }
  }
  const T = o.pts.tmp, n = fs.fill(T.pos, T.col, T.size, T.glow, T.alpha, now, T.shape, T.rot, T.kind), cnt = [0, 0, 0, 0]
  const A = o.pts.objs.map(p => p.geometry.attributes)
  r.liqMat.uniforms.scale.value = r.ptMats[0].uniforms.scale.value * (r.liqRT.width / SIZE) * 2.1  // na imagem à parte: manchas maiores (fundem-se)
  for (let i = 0; i < n; i++) {
    const s = T.kind[i], a = A[s], k = cnt[s]++
    a.position.array[k * 3] = T.pos[i * 3]; a.position.array[k * 3 + 1] = T.pos[i * 3 + 1]; a.position.array[k * 3 + 2] = T.pos[i * 3 + 2]
    a.color.array[k * 3] = T.col[i * 3]; a.color.array[k * 3 + 1] = T.col[i * 3 + 1]; a.color.array[k * 3 + 2] = T.col[i * 3 + 2]
    a.size.array[k] = T.size[i]; a.alpha.array[k] = T.alpha[i]; a.shape.array[k] = T.shape[i]; a.rot.array[k] = T.rot[i]
  }
  o.pts.objs.forEach((p, s) => { const a = A[s]; for (const k of ['position', 'color', 'size', 'alpha', 'shape', 'rot']) a[k].needsUpdate = true; p.geometry.setDrawRange(0, cnt[s]); p.visible = cnt[s] > 0 })
  // o líquido: as manchas somadas na imagem à parte; o quadrado no ecrã desenha a superfície
  const rr = r.renderer, prev = rr.getRenderTarget()
  rr.setRenderTarget(r.liqRT); rr.setClearColor(0x000000, 0); rr.clear(); if (cnt[0]) rr.render(r.liqScene, r.cam); rr.setRenderTarget(prev)
  r.comp.visible = cnt[0] > 0
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
    // inércia do líquido: mola amortecida movida pela aceleração da esfera (useOrbPhysics expõe el._phys); a água
    // balança mais tempo, o pastoso (verde) assenta depressa; mexer agita o líquido (stir avança o fluxo)
    const P = o.el._phys, sl = o.sl || (o.sl = { x: 0, y: 0, vx: 0, vy: 0, pvx: 0, pvy: 0, last: now, stir: 0, react: '' })
    const dts = Math.min(0.05, Math.max(0.001, (now - sl.last) / 1000)); sl.last = now
    const pvx = P ? P.vx : 0, pvy = P ? P.vy : 0, ax = (pvx - sl.pvx) / dts, ay = (pvy - sl.pvy) / dts; sl.pvx = pvx; sl.pvy = pvy
    if (s.react && s.react !== sl.react) { sl.vx += (Math.random() - 0.5) * 5; sl.vy += 2 + Math.random() * 2 }  // um golpe abana-o
    sl.react = s.react
    const wv = s.w && s.w.length >= 6 ? s.w[0] * 0.8 + s.w[1] * 1.25 + s.w[2] * 0.5 + s.w[3] * 1 + s.w[4] * 0.3 + s.w[5] * 0.4 : 0.9
    const SK = 70, SC = 3 + 10 * Math.max(0, 1.25 - wv), SM = 1 / 2500
    sl.vx += (-SK * sl.x - SC * sl.vx - Math.max(-6e4, Math.min(6e4, ax)) * SM) * dts; sl.vy += (-SK * sl.y - SC * sl.vy + Math.max(-6e4, Math.min(6e4, ay)) * SM) * dts
    sl.x = Math.max(-0.6, Math.min(0.6, sl.x + sl.vx * dts)); sl.y = Math.max(-0.6, Math.min(0.6, sl.y + sl.vy * dts))
    sl.stir += Math.min(3, Math.hypot(sl.vx, sl.vy)) * dts * 0.8
    u.slosh.value.set(sl.x, sl.y)
    u.t.value = t + o.seed + sl.stir; u.c1.value.copy(s.s1); u.c2.value.copy(s.s2); u.core.value.copy(s.core); u.deep.value.copy(s.deep)
    u.speed.value = (s.mood ? 3.5 : s.low ? 2.2 : 1) * fast; u.dens.value = s.dead ? 0.1 : s.mood ? 1.3 : 0.85
    // o brilho de dentro reage: golpe/vida/veneno acende, pulsar respira, muita vida brilha mais, a casca apaga-se
    const breath = s.anim === 'pulsar' ? 0.25 * (0.5 + 0.5 * Math.sin(t * 2.6)) : 0
    u.glow.value = s.dead ? 0.05 : s.mood || s.react ? 1.2 : (s.ab > 0 ? 0.7 + 0.45 * s.ab : 0.6) + breath
    const fxk = s.fx && now - (o.fxAt || 0) < 1500 ? 1 - (now - o.fxAt) / 1500 : 0
    u.rot.value = s.fx === 'rot' ? fxk : 0; u.frost.value = s.fx === 'frost' ? fxk : 0
    // os fluidos por cor (estilo automático): pesos W U B R G C do que está em campo, a viscosidade é a da mistura
    // nada muda de repente: as cores do campo e o ambiente aproximam-se do novo valor (constante ~2,5 s / ~1,5 s), e a
    // cor de quem bateu (o._inject: golpes e feitiços, pela cor da carta de origem) mistura-se e dilui-se em ~30 s
    const fdt = Math.min(0.1, Math.max(0.001, (now - (o.lastF || now)) / 1000)); o.lastF = now
    const kW = 1 - Math.exp(-fdt / 2.5), kE = 1 - Math.exp(-fdt / 1.5), kI = Math.exp(-fdt / 30)
    o.inj = (o.inj || [0, 0, 0, 0, 0, 0]).map(x => x * kI)
    const injT = o.inj.reduce((a, b) => a + b, 0)
    let w = null
    if (s.w && s.w.length >= 6) {
      const tgt = s.w.slice(0, 6).map((x, i) => x + o.inj[i]), sum = tgt.reduce((a, b) => a + b, 0) || 1
      o.wS = o.wS ? o.wS.map((x, i) => x + (tgt[i] / sum - x) * kW) : tgt.map(x => x / sum)
      o.wlS = (o.wlS ?? s.w[6] ?? 0) + ((s.w[6] || 0) - (o.wlS ?? 0)) * kW
      w = [...o.wS.map(x => (x < 0.02 ? 0 : x)), o.wlS]
    } else o.wS = null
    u.elem.value = w ? 1 : 0
    if (w) { u.wA.value.set(w[0], w[1], w[2]); u.wB.value.set(w[3], w[4], w[5]); u.wlite.value = w[6] || 0
      const visc = w[0] * 0.8 + w[1] * 1.25 + w[2] * 0.5 + w[3] * 1 + w[4] * 0.3 + w[5] * 0.4
      u.speed.value *= Math.max(0.25, visc)
      // o brilho de dentro com a cor da mistura (antes vinha do estilo CSS: o pântano ficava roxo)
      MIX.setRGB(0, 0, 0); w.slice(0, 6).forEach((x, i) => { if (x) MIX.add(TMP.copy(ECOL[i]).multiplyScalar(x)) }); u.core.value.copy(MIX); u.deep.value.copy(MIX).multiplyScalar(0.25) }
    u.tox.value = s.dead ? 0 : Math.min(1, s.tox)
    const Et = s.dead ? [0, 0, 0, 0, 0, 0, 0, 0, 0] : s.env
    o.envS = o.envS ? o.envS.map((x, i) => x + ((Et[i] || 0) - x) * kE) : Et.slice()
    const E = o.envS
    // estilo do tema (sem fluidos por cor): a cor de quem bateu tinge o líquido na mesma
    if (!w && injT > 0.02) { MIX.setRGB(0, 0, 0); o.inj.forEach((x, i) => { if (x) MIX.add(TMP.copy(ECOL[i]).multiplyScalar(x / injT)) }); const k = Math.min(0.55, injT); u.c1.value.lerp(MIX, k); u.c2.value.lerp(MIX, k * 0.7); u.core.value.lerp(MIX, k * 0.5) }
    u.env1.value.set(E[0], E[1], E[2], E[3]); u.exl.value = E[4]
    const sweat = Math.max(E[6] > 0.35 ? (E[6] - 0.35) * 1.5 : 0, s.low ? 0.45 : 0), frostG = E[7] > 0.3 ? (E[7] - 0.3) * 1.4 : 0
    for (const g of [r.glass, r.glassBack]) { const gu = g.material.uniforms; gu.sweat.value = Math.min(1, sweat); gu.frostG.value = Math.min(1, frostG); gu.gt.value = t }
    const ik = o.inkAt ? (now - o.inkAt) / 1000 : 99  // o que entrou espalha-se, cai com o peso (~6 s) e assenta como mancha
    u.inkK.value = ik < 6 ? Math.min(1, ik * 4) * (1 - ik / 6) : 0
    if (u.inkK.value > 0) { u.ink.value.set(o.inkCol || INK[o.ink] || '#7a0010'); const d = o.inkDir || [0, 0], L = Math.hypot(d[0], d[1]) || 1
      const fall = Math.min(1, ik / 5) ** 1.5  // a pluma desce até ao fundo enquanto se espalha
      u.inkP.value.set(-d[0] / L * 0.75 * (1 - fall * 0.6), d[1] / L * 0.75 * (1 - fall) - fall * 0.85, 0.45 * (1 - fall * 0.5), 0.15 + ik * 0.18) }
    // a mancha: a cor do que entrou fica no fundo e desvanece devagar (~40 s)
    const stK = o.inkAt ? Math.min(1, ik / 3) * Math.exp(-Math.max(0, ik - 3) / 40) * (o.inkAmt || 0.5) : 0
    u.stain.value.set(...(STC.set(o.inkCol || INK[o.ink] || '#7a0010').toArray()), s.dead ? 0 : stK)
    const burstK = o.burstAt ? Math.min(1, (now - o.burstAt) / 700) : 0
    const crack = s.dead ? 1 : Math.max(s.low ? 0.32 : 0, burstK, (s.fx === 'crack' || s.fx === 'split') ? 0.75 * fxk : 0)
    for (const g of [r.glass, r.glassBack]) { g.material.uniforms.crack.value = crack; g.material.uniforms.tint.value.copy(w ? MIX : s.core); g.material.uniforms.dim.value = s.dead ? 0.85 : 1 }
    const bt = o.el._beat, ph = bt ? ((now - bt.t0) % bt.P) / bt.P : 0  // o mesmo relógio do som do coração
    const heart = ph < 0.05 ? ph / 0.05 * 0.07 : ph < 0.11 ? 0.07 - (ph - 0.05) / 0.06 * 0.08 : ph < 0.17 ? -0.01 + (ph - 0.11) / 0.06 * 0.06 : ph < 0.26 ? 0.05 - (ph - 0.17) / 0.09 * 0.05 : 0
    const beat = s.low && !s.dead && bt ? 1 + heart : 1, fat = 1 + 0.25 * s.ab, wob = s.burst ? 1 + 0.035 * Math.sin(t * 60) : 1
    const sc = beat * fat * wob
    r.ball.scale.setScalar(sc); r.glass.scale.setScalar(sc); r.glassBack.scale.setScalar(sc)
    const split = s.fx === 'split' ? Math.sin(Math.min(1, fxk * 1.4) * Math.PI) * 0.12 : 0
    r.ball.scale.x = sc * (1 + split); r.glass.scale.x = sc * (1 + split * 0.6)
    const px = o.el._proxy, tl = px ? [parseFloat(px.style.getPropertyValue('--slx')) || 0, parseFloat(px.style.getPropertyValue('--sly')) || 0] : [0, 0]
    r.ball.rotation.set(tl[1] * 0.06, t * 0.3 * fast + o.seed, -tl[0] * 0.06)
    const cols = s.cols.length ? s.cols : null
    if (cols) r.glow.material.color.set(COL[cols[0]]); else r.glow.material.color.copy(s.glow)
    r.glow2.material.color.set(cols ? COL[cols[1] || cols[0]] : '#000000')
    const ga = s.dead ? 0 : s.mood || s.react ? 0.95 : s.ab > 0 ? 0.55 + 0.35 * s.ab : 0.4
    // presença na mesa (E[8]): o halo cresce e acende, suave como o resto
    // o quadro do canvas vê ~4 unidades à profundidade do halo: maior do que isso, a borda cortava-o a direito (a «máscara
    // quadrada»); cresce pouco e o resto da presença vai para a intensidade
    const pr = s.dead ? 0 : E[8] || 0, gs = Math.min(5.2, 3.4 * (1 + 0.4 * pr))  // com o quadro maior o halo pode crescer sem bater na borda
    r.glow.scale.set(gs, gs, 1); r.glow2.scale.set(gs * 0.85, gs * 0.85, 1)
    r.glow.material.opacity = Math.min(1, ga + 0.3 * pr); r.glow2.material.opacity = cols && cols.length > 1 ? Math.min(1, ga + 0.3 * pr) * 0.8 : 0
    const hc = E[6] - E[7]  // calor e frio: o halo puxa para laranja-brasa ou azul-gelo e cresce
    if (Math.abs(hc) > 0.15 && !s.dead) { r.glow.material.color.lerp(hc > 0 ? HOT : COLD, Math.min(0.75, Math.abs(hc))); r.glow.material.opacity = Math.min(1, ga + Math.abs(hc) * 0.45) }
    r.caustic.material.color.copy(w ? MIX : s.core).lerp(new THREE.Color('#ffffff'), 0.5); r.caustic.material.opacity = s.dead ? 0 : 0.55
    // a casca rebentada: a física dos cacos (ou da esfera inteira a cair e rolar) e o chão rachado; câmara mais alta
    if (s.dead && !o.fr) startFracture(o, now)
    if (!s.dead) o.fr = null
    const fr = o.fr, dt = fr ? Math.min(0.033, (now - fr.last) / 1000) : 0
    if (fr) fr.last = now
    r.cam.position.set(0, fr ? 1.52 : 1.35, fr ? 7.26 : 5.85); r.cam.lookAt(0, fr ? -0.5 : 0, 0)  // partida: a mesma moldura de antes com a abertura nova
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
    r.shadow.visible = !fr
    r.glow.visible = r.glow2.visible = r.caustic.visible = !fr
    // partir ao meio: as duas metades afastam-se e voltam a juntar-se
    const opening = s.fx === 'split' && fxk > 0 && !fr
    r.halves.forEach((h, k) => { h.visible = opening || md === 'split'; if (opening) { h.position.set((k ? 1 : -1) * Math.sin(Math.min(1, fxk * 1.3) * Math.PI) * 0.45, 0, 0); h.rotation.set(0, 0, 0); h.scale.setScalar(sc) } })
    if (md === 'split') r.halves.forEach((h, k) => {  // comandante: cortada ao meio, as metades caem para os lados e ficam no chão
      const b = fr.halves[k]; if (age > 0.25) stepBody(b, dt, 0.5); h.position.set(...b.p); h.rotation.set(...b.r); h.scale.setScalar(sc)
      const u2 = h.children[1].material.uniforms; u2.tint.value.copy(s.core); u2.crack.value = 0.5 })
    if (opening || md === 'split') r.ball.visible = r.glass.visible = r.glassBack.visible = false
    // verter (dentada, sangue): gotas da cor do líquido caem pelo lado e fazem uma poça
    const leak = !fr && E[5] > 0  // biblioteca a acabar: gotas a pingar por baixo, mais depressa quanto menos cartas
    if (leak && !o.drops && now - (o.leakAt || 0) > 2600 - 2000 * E[5]) { o.leakAt = now; o.drip = { p: [0.05, -0.95, 0.35], v: [0, -0.2, 0] } }
    const spill = s.fx === 'spill' && !fr
    if (spill && !o.drops) o.drops = Array.from({ length: 10 }, () => ({ p: [0.75 + Math.random() * 0.2, Math.random() * 0.4, 0.4], v: [0.6 + Math.random(), 0.6 + Math.random(), (Math.random() - 0.5)] }))
    if (!s.fx) o.drops = null
    r.drops.visible = !!o.drops || !!o.drip
    if (o.drip && !o.drops) { stepBody(o.drip, 0.016, 0.05); r.drops.children.forEach((m, k) => { m.visible = k === 0 }); r.drops.children[0].position.set(...o.drip.p); r.drops.children[0].material.color.copy(w ? MIX : s.core)
      if (o.drip.p[1] <= FLOOR + 0.06) o.drip = null }
    else r.drops.children.forEach(m => { m.visible = true })
    if (o.drops) o.drops.forEach((b, k) => { stepBody(b, 0.016, 0.05); const m = r.drops.children[k]; m.position.set(...b.p); m.material.color.copy(s.core) })
    r.puddle.material.opacity = o.drops ? 0.75 * Math.min(1, (1 - fxk) * 2) : 0; r.puddle.material.color.copy(s.core); r.puddle.position.x = 1.2; r.puddle.scale.setScalar(1)
    if (md === 'melt') { const k = Math.min(1, age / 2.4); r.puddle.material.opacity = 0.85 * k; r.puddle.material.color.copy(TOXIC); r.puddle.position.x = 0; r.puddle.scale.setScalar(0.4 + 1.6 * k) }
    // o fluido de partículas (data-pf="1"): a fonte no centro pede a mistura das cores do campo e do que pesa no jogador;
    // gravidade com a inércia de a arrastar/atirar; fendas que vertem; ganhar vida fecha-as com crosta; partida, verte tudo
    const fsOn = o.el.dataset.pf === '1'
    if (fsOn && !o.fs) o.fs = new FluidSim(LOW ? 340 : 600, Math.floor(o.seed * 1e6))
    r.core.visible = !(fsOn && o.fs)
    if (fsOn && o.fs) {
      const fs = o.fs, frac = {}, put = (k, f) => { if (f > 0) frac[k] = (frac[k] || 0) + f }
      const cw = w ? w.slice(0, 6) : s.cols.length ? 'WUBRGC'.split('').map(c => (s.cols.includes(c) ? 1 / s.cols.length : 0)) : [0, 1, 0, 0, 0, 0]
      'WUBRGC'.split('').forEach((c, i) => { if (cw[i] > 0) for (const [m, f] of MANA_MAT[c]) put(m, cw[i] * f) })
      put('blood', E[0] * 0.3); put('poison', Math.min(0.4, (s.tox || 0) * 0.5)); put('rock', E[3] * 0.12); put('light', E[4] * 0.1)
      const sum = Object.values(frac).reduce((a, b) => a + b, 0) || 1
      for (const k in frac) frac[k] /= sum
      const life = +o.el.dataset.life || 20
      fs.setTargets(frac, Math.min(0.98, 0.84 + 0.1 * Math.min(1, life / 20) + 0.05 * (s.ab || 0)))  // sempre bem cheia; a vida só tira um pouco
      if (crack > 0.3 && !s.dead) {  // fendas (as mesmas direções enquanto durarem; a força acompanha as rachas)
        if (!fs.holes.length || fs.holes.every(h => h.patched)) fs.setCracks(holesFor(o, crack))
        fs.holes.forEach(h => { if (!h.patched) h.k = crack })
      }
      if (o.lastLife != null && life > o.lastLife) fs.heal(Math.min(1, (life - o.lastLife) / 5))  // curar: remendos com crosta
      o.lastLife = life
      // reage: um golpe empurra-o do lado de onde veio; quase a rebentar agita-se; arrastar/atirar/chocar mexe-o pela inércia
      if (s.react && s.react !== o.fsReact) { const d = o.el._inkDir || [Math.random() - 0.5, -1]; fs.kick([-d[0], d[1], 0.4], s.react === 'gain' ? 0.35 : 0.9) }
      o.fsReact = s.react
      if (s.burst) fs.kick([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], 0.25)
      const gx = Math.max(-16, Math.min(16, -ax * 0.0014)), gy = Math.max(-16, Math.min(16, ay * 0.0014))
      fs.step(dts, [gx, gy, 0], { dead: s.dead, stir: s.mood ? 5 : s.react ? 2 : 0 })
      drawFluid(r, o, fs, now / 1000)
    }
    r.cam.layers.set(0); r.renderer.render(r.scene, r.cam)
    r.renderer.autoClear = false; r.cam.layers.set(1); r.renderer.render(r.scene, r.cam); r.renderer.autoClear = true; r.cam.layers.set(0)  // o vidro da frente por cima de tudo
    r.comp.visible = false
    if (o.pts) for (const p of o.pts.objs) p.visible = false
    const cv = (px && px.querySelector('canvas.orb3d')) || o.cv, g = cv.getContext('2d')
    if (cv.width !== SIZE || cv.height !== SIZE) { cv.width = SIZE; cv.height = SIZE }  // um canvas novo é 300×150: a largura já batia certo e a altura ficava a meio
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
  // golpes e feitiços: a cor da carta de origem entra no líquido (cols = «WUBRG» da carta; n = quanto fez); sem estilo de
  // golpe, a pluma é dessa cor (fogo vermelho, sombra preta, luz branca…)
  el._inject = (cols, n = 1, dir) => {
    const cs = String(cols || '').replace(/[^WUBRG]/g, '').split('').filter(Boolean), list = cs.length ? cs : ['C']
    o.inj = o.inj || [0, 0, 0, 0, 0, 0]
    for (const c of list) o.inj['WUBRGC'.indexOf(c)] += Math.min(0.5, 0.06 + 0.035 * n) / list.length
    const tot = o.inj.reduce((a, b) => a + b, 0); if (tot > 0.8) o.inj = o.inj.map(x => x * 0.8 / tot)
    if (o.fs) { const d = dir || [0, 1], k = Math.min(36, 6 + 4 * n); list.forEach(c => o.fs.inject(MANA_MAT[c][0][0], Math.round(k / list.length), [-d[0], d[1], 0.5])) }
    if (!el.dataset.ink) { o.inkAt = performance.now(); o.inkDir = dir || [0, 1]; o.inkCol = list.map(c => ECOLH['WUBRGC'.indexOf(c)]).reduce((a, h) => a.lerp(TMP.set(h), 0.5), new THREE.Color(ECOLH['WUBRGC'.indexOf(list[0])])).getHex(); o.inkAmt = Math.min(1, 0.3 + 0.1 * n) }
  }
  orbs.add(o)
  if (!raf) raf = requestAnimationFrame(draw)
  return () => { orbs.delete(o) }
}
