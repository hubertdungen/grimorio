// Grãos na placa gráfica: dezenas de milhares (65 mil no PC) em vez dos 5 mil do processador. O processador continua a
// correr a física (orbfluid.js: ~600 partículas, reações, sangue, fendas); daqui só sai, por fotograma, um retrato em
// três grelhas 16×16×16 — velocidade + densidade, cor + luz, gás — que sobe para a GPU (umas dezenas de KB). Na GPU, cada
// grão é um texel de duas texturas (posição, velocidade) que se atualizam numa passagem de shader: seguem o campo, são
// atraídos para onde há matéria (o gradiente da densidade), agitam-se mais no gás e renascem perto da matéria quando
// envelhecem. Desenham-se como os grãos do processador (GVS/GFS no orb3d.js): o mesmo aspeto, muito mais denso.
// Tudo corre neste aparelho (PC, telemóvel ou browser), também online: o servidor só manda o estado do jogo.
import * as THREE from 'three'
import { MAT } from './orbfluid.js'
import { blackbody, GK } from './orbgrain.js'

const NAMES = Object.keys(MAT), G = 16, BOX = 0.9, ATL = 64, R_IN = 0.86
const HOT = { fire: 1, lava: 1, magma: 1, ember: 1 }

// as grelhas no atlas 64×64 (16 fatias de 16×16, 4×4) e a interpolação trilinear à mão (as texturas são NEAREST)
const FIELD = `uniform sampler2D fV; uniform sampler2D fC; uniform sampler2D fM;
vec4 cellAt(sampler2D t, vec3 c){ c = clamp(c, 0., ${G - 1}.); float tx = mod(c.z, 4.), ty = floor(c.z / 4.); return texture2D(t, (vec2(tx * ${G}. + c.x, ty * ${G}. + c.y) + .5) / ${ATL}.); }
vec4 tri(sampler2D t, vec3 p){ vec3 g = (p + ${BOX}) / ${2 * BOX} * ${G}. - .5, i = floor(g), f = g - i;
  vec4 a = mix(mix(cellAt(t, i), cellAt(t, i + vec3(1., 0., 0.)), f.x), mix(cellAt(t, i + vec3(0., 1., 0.)), cellAt(t, i + vec3(1., 1., 0.)), f.x), f.y);
  vec4 b = mix(mix(cellAt(t, i + vec3(0., 0., 1.)), cellAt(t, i + vec3(1., 0., 1.)), f.x), mix(cellAt(t, i + vec3(0., 1., 1.)), cellAt(t, i + vec3(1., 1., 1.)), f.x), f.y);
  return mix(a, b, f.z); }
float hsh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 hsh3(vec2 p){ return vec3(hsh(p), hsh(p + 17.31), hsh(p + 41.7)); }
vec3 inBall(vec2 s){ vec3 q = hsh3(s) * 2. - 1.; return q / max(1., length(q)) * ${R_IN * 0.98}; }
`
const QV = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }'

// a velocidade: o campo + subir para onde há matéria + agitação (mais no gás); um pouco de inércia
const VEL = FIELD + `uniform sampler2D posT; uniform sampler2D velT; uniform float dt; uniform float t; varying vec2 vUv;
void main(){
  vec4 P = texture2D(posT, vUv); vec3 v = texture2D(velT, vUv).xyz, p = P.xyz;
  vec4 F = tri(fV, p); float gas = tri(fM, p).r, e = .06;
  vec3 gr = vec3(tri(fV, p + vec3(e, 0., 0.)).a - tri(fV, p - vec3(e, 0., 0.)).a, tri(fV, p + vec3(0., e, 0.)).a - tri(fV, p - vec3(0., e, 0.)).a, tri(fV, p + vec3(0., 0., e)).a - tri(fV, p - vec3(0., 0., e)).a) / (2. * e);
  vec3 nz = (hsh3(vUv * 91.7 + t * 3.1) - .5) * (.35 + 2.6 * gas);
  vec3 tv = F.xyz + gr * .9 + nz;
  v += (tv - v) * min(1., dt * 10.);
  gl_FragColor = vec4(clamp(v, -6., 6.), 1.);
}`
// a posição: anda, fica dentro do vidro; ao envelhecer (ou perdido no vazio) renasce no melhor de três sítios ao acaso
const POS = FIELD + `uniform sampler2D posT; uniform sampler2D velT; uniform float dt; uniform float t; varying vec2 vUv;
void main(){
  vec4 P = texture2D(posT, vUv); vec3 v = texture2D(velT, vUv).xyz, p = P.xyz + v * dt;
  float r = length(p); if (r > ${R_IN}) p *= ${R_IN} / r;
  float age = P.w + dt, life = 4. + 6. * hsh(vUv * 7.3), d = tri(fV, p).a;
  if (age > life || (d < .01 && age > .6)) {
    vec3 a = inBall(vUv + t), b = inBall(vUv * 1.7 + t + 3.), c = inBall(vUv * 2.3 + t + 7.);
    float da = tri(fV, a).a, db = tri(fV, b).a, dc = tri(fV, c).a;
    p = da >= db && da >= dc ? a : db >= dc ? b : c; age = 0.;
  }
  gl_FragColor = vec4(p, age);
}`
const INIT = FIELD + 'varying vec2 vUv; void main(){ gl_FragColor = vec4(inBall(vUv * 3.7), hsh(vUv) * 4.); }'
// desenhar: cada vértice lê a posição e a velocidade da textura e a cor/luz/gás do campo onde está
const RVS = FIELD + `attribute vec2 ref; uniform sampler2D posT; uniform sampler2D velT; uniform float scale; uniform float zc; uniform float blur; uniform float glowPass;
varying vec3 vC; varying float vA; varying float vSh; varying vec2 vDir; varying float vLen; varying float vRad;
void main(){
  vec4 P = texture2D(posT, ref); vec3 p = P.xyz, vel = texture2D(velT, ref).xyz;
  vec4 C = tri(fC, p), F = tri(fV, p); float gas = tri(fM, p).r, h = hsh(ref * 13.1), tone = .8 + .38 * h;
  float vis = smoothstep(.015, .09, F.a) * smoothstep(0., .35, P.w);
  vA = glowPass > .5 ? vis * C.a * .6 : vis * (1. - C.a) * mix(1., .4, gas);
  vC = C.rgb * vec3(tone + (h - .5) * .1, tone, tone - (h - .5) * .1) * (glowPass > .5 ? 1. : 1. - .32 * smoothstep(.2, .6, F.a));
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vec4 c0 = projectionMatrix * mv, c1 = projectionMatrix * (modelViewMatrix * vec4(p + vel * blur, 1.));
  vec2 dpx = (c1.xy / c1.w - c0.xy / c0.w) * 150.;
  float size = mix(.085, .2, gas) * (.8 + .4 * fract(h * 7.)), base = max(1.3, size * scale / -mv.z), L = min(length(dpx), base * 1.6);
  vDir = L > .3 ? normalize(dpx) * vec2(1., -1.) : vec2(1., 0.); vLen = L / (base + L); vRad = .5 * base / (base + L);
  float dz = clamp((-mv.z - (zc - 1.)) / 2., 0., 1.); vec3 n = normalize(p + vec3(1e-4));
  vSh = (.62 + .48 * max(dot(n, normalize(vec3(-.4, .75, .55))), 0.)) * mix(1.12, .5, dz);
  vA *= .6 + .4 * base / (base + L);
  gl_PointSize = vA < .02 ? 0. : base + L;
  gl_Position = c0;
}`

// a cor e a luz de uma partícula-motor (como no orbgrain.js, sem o tom de cada grão)
function carrierColor(fs, j, now, out) {
  const m = fs.m[j], nm = NAMES[m], M = MAT[nm]
  let T = -1
  if (nm === 'fire') T = 1 - Math.min(1, fs.age[j] / (M.ttl || 2)) * 0.95
  else if (nm === 'ember') T = 0.8
  else if (nm === 'lava') T = 0.64 + 0.26 * Math.sin(now * 0.7 + j * 1.3)
  else if (nm === 'magma') T = 0.3 + 0.35 * Math.max(0, Math.sin(now * 0.45 + j * 0.9))
  if (T >= 0) { blackbody(T, out); out[3] = T > 0.45 ? 1 : 0; return out }
  const e = GK[m] === 2 ? 0.9 + 1.1 * M.glow : 1
  if (M.prism) { const h = now * 0.6 + j; out[0] = 0.72 + 0.12 * Math.sin(h); out[1] = 0.76 + 0.12 * Math.sin(h + 2.1); out[2] = 0.86 + 0.12 * Math.sin(h + 4.2) } else { out[0] = M.col[0] * e; out[1] = M.col[1] * e; out[2] = M.col[2] * e }
  if (nm === 'crust' && fs.crustCol) { out[0] = fs.crustCol[j * 3]; out[1] = fs.crustCol[j * 3 + 1]; out[2] = fs.crustCol[j * 3 + 2] }
  out[3] = GK[m] === 2 ? 1 : 0
  return out
}

// pode correr aqui? (WebGL2 e alvos de render em meia-precisão)
export function gpuOk(renderer) {
  return !!(renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')))
}

export class GpuGrains {
  constructor(renderer, side, pass) {
    this.side = side; this.n = side * side; this.pass = pass
    globalThis.__orbGpu = (globalThis.__orbGpu || 0) + 1  // quantas esferas estão na GPU (para os testes)
    const rt = () => new THREE.WebGLRenderTarget(side, side, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false })
    this.pos = [rt(), rt()]; this.vel = [rt(), rt()]; this.cur = 0
    const dtex = () => { const t = new THREE.DataTexture(new Float32Array(ATL * ATL * 4), ATL, ATL, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t }
    this.fV = dtex(); this.fC = dtex(); this.fM = dtex(); this.W = new Float32Array(G * G * G)
    const fu = () => ({ fV: { value: this.fV }, fC: { value: this.fC }, fM: { value: this.fM } })
    const sm = (f, u) => new THREE.ShaderMaterial({ vertexShader: QV, fragmentShader: f, uniforms: u, depthTest: false, depthWrite: false, blending: THREE.NoBlending })
    this.mInit = sm(INIT, fu())
    this.mVel = sm(VEL, { ...fu(), posT: { value: null }, velT: { value: null }, dt: { value: 0 }, t: { value: 0 } })
    this.mPos = sm(POS, { ...fu(), posT: { value: null }, velT: { value: null }, dt: { value: 0 }, t: { value: 0 } })
    pass(this.mInit, this.pos[0]); pass(this.mInit, this.pos[1])
    const zero = sm('void main(){ gl_FragColor = vec4(0.); }', {}); pass(zero, this.vel[0]); pass(zero, this.vel[1])
    // os pontos: só a referência ao texel (a posição vem da textura)
    const g = new THREE.BufferGeometry(), ref = new Float32Array(this.n * 2)
    for (let i = 0; i < this.n; i++) { ref[i * 2] = ((i % side) + 0.5) / side; ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.n * 3), 3)); g.setAttribute('ref', new THREE.BufferAttribute(ref, 2))
    this.geo = g
  }
  // os pontos para desenhar (dois: os opacos, com profundidade, e os de luz, somados) com os FS dos grãos do orb3d.js
  points(scene, frags, scale) {
    const mk = (k, ord) => {
      const m = new THREE.ShaderMaterial({ vertexShader: RVS, fragmentShader: frags[k], transparent: true, depthTest: true, depthWrite: k === 0,
        blending: k === 2 ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { fV: { value: this.fV }, fC: { value: this.fC }, fM: { value: this.fM }, posT: { value: null }, velT: { value: null }, scale, zc: { value: 6 }, blur: { value: 0.022 }, glowPass: { value: k === 2 ? 1 : 0 } } })
      const p = new THREE.Points(this.geo, m); p.frustumCulled = false; p.renderOrder = ord; p.visible = false; scene.add(p); return p
    }
    this.pts = [mk(0, 1.35), mk(2, 1.75)]
    return this.pts
  }
  // o retrato do fluido nas três grelhas (só o que está dentro do vidro; o que verteu fica com os grãos do processador)
  splat(fs, now) {
    const V = this.fV.image.data, C = this.fC.image.data, Mx = this.fM.image.data, W = this.W, c = [0, 0, 0, 0]
    V.fill(0); C.fill(0); Mx.fill(0); W.fill(0)
    const idx = (x, y, z) => { const tx = z % 4, ty = (z / 4) | 0; return ((ty * G + y) * ATL + tx * G + x) * 4 }
    for (let j = 0; j < fs.count; j++) {
      if (!fs.alive[j] || fs.out[j] || (MAT[NAMES[fs.m[j]]].ttl || 9) < 1) continue
      const o = j * 3, fade = fs.fade[j] > 0 ? 1 - fs.fade[j] : 1
      carrierColor(fs, j, now, c)
      const gas = GK[fs.m[j]] === 1 ? 1 : 0
      const gx = (fs.x[o] + BOX) / (2 * BOX) * G - 0.5, gy = (fs.x[o + 1] + BOX) / (2 * BOX) * G - 0.5, gz = (fs.x[o + 2] + BOX) / (2 * BOX) * G - 0.5
      const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz), fx = gx - ix, fy = gy - iy, fz = gz - iz
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) {
        const x = ix + a, y = iy + b, z = iz + d
        if (x < 0 || y < 0 || z < 0 || x >= G || y >= G || z >= G) continue
        const w = (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (d ? fz : 1 - fz) * fade
        if (w <= 0) continue
        const k = idx(x, y, z), wi = (z * G + y) * G + x
        W[wi] += w; V[k] += fs.v[o] * w; V[k + 1] += fs.v[o + 1] * w; V[k + 2] += fs.v[o + 2] * w; V[k + 3] += w * 0.33
        C[k] += c[0] * w; C[k + 1] += c[1] * w; C[k + 2] += c[2] * w; C[k + 3] += c[3] * w; Mx[k] += gas * w
      }
    }
    for (let z = 0; z < G; z++) for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const w = W[(z * G + y) * G + x]; if (!w) continue
      const k = idx(x, y, z)
      V[k] /= w; V[k + 1] /= w; V[k + 2] /= w; C[k] /= w; C[k + 1] /= w; C[k + 2] /= w; C[k + 3] /= w; Mx[k] /= w
    }
    this.fV.needsUpdate = this.fC.needsUpdate = this.fM.needsUpdate = true
  }
  step(fs, dt, now) {
    this.splat(fs, now)
    const a = this.cur, b = 1 - a
    for (const m of [this.mVel, this.mPos]) { m.uniforms.dt.value = Math.min(dt, 1 / 30); m.uniforms.t.value = now % 1000 }
    this.mVel.uniforms.posT.value = this.pos[a].texture; this.mVel.uniforms.velT.value = this.vel[a].texture; this.pass(this.mVel, this.vel[b])
    this.mPos.uniforms.posT.value = this.pos[a].texture; this.mPos.uniforms.velT.value = this.vel[b].texture; this.pass(this.mPos, this.pos[b])
    this.cur = b
    for (const p of this.pts) { p.material.uniforms.posT.value = this.pos[b].texture; p.material.uniforms.velT.value = this.vel[b].texture }
  }
  show(on, zc) { for (const p of this.pts) { p.visible = on; p.material.uniforms.zc.value = zc } }
}
