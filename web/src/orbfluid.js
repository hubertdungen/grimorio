// Fluido de partículas dentro da esfera da vida (à maneira do Powder Toy, em 3D): uma fonte no centro produz matéria
// de vários tipos — líquidos com viscosidade e coesão, gases que sobem, pó e micro-sólidos com atrito, partículas de luz
// em onda — e cada partícula tem física: gravidade (no referencial da esfera, com a inércia de a arrastar/atirar),
// pressão e viscosidade entre vizinhas (double density relaxation, Clavet et al. 2005), choque com o vidro. Materiais
// mais densos assentam por baixo dos leves; o que muda (as cores do campo, um golpe, veneno…) entra pela fonte ou
// pelo ponto do golpe e o que sobra dissolve-se devagar: nada muda de repente. Com fendas, verte por elas para fora;
// ao curar, as fendas fecham com crostas do material que lá estava (o sangue faz crosta de ferrugem). Partida, verte
// tudo para o chão. Só cálculo (sem three.js): orb3d.js desenha.

// k: rigidez (pressão), kn: pressão próxima, rho: densidade de repouso, s/b: viscosidade linear/quadrática,
// g: gravidade (negativa sobe), drag: arrasto do ar, fr: atrito no vidro (0 escorrega, 1 cola), sz: tamanho,
// glow: 0 opaco … 1 luz, a: opacidade, wave: ondula (luz), solid: pó/grão (sem coesão), stick: cola ao vidro
export const MAT = {
  water: { k: 0.6, kn: 0.9, rho: 0.8, s: 0.25, b: 0.05, g: 1, drag: 0.02, fr: 0.05, sz: 1, glow: 0.1, a: 0.85, col: [0.15, 0.55, 0.95] },
  light: { k: 0.05, kn: 0.15, rho: 0.3, s: 0.05, b: 0, g: -0.12, drag: 0.6, fr: 0, sz: 0.8, glow: 1, a: 0.42, wave: 1, col: [0.95, 0.66, 0.22] },
  smoke: { k: 0.04, kn: 0.1, rho: 0.2, s: 0.1, b: 0, g: -0.45, drag: 1.4, fr: 0, sz: 2.1, glow: 0.05, a: 0.5, col: [0.46, 0.38, 0.54] },
  mud: { k: 0.7, kn: 1.1, rho: 0.9, s: 0.9, b: 0.25, g: 1.25, drag: 0.04, fr: 0.5, sz: 1.05, glow: 0.05, a: 0.95, col: [0.42, 0.29, 0.15] },
  spore: { k: 0.1, kn: 0.2, rho: 0.375, s: 0.1, b: 0, g: 0.15, drag: 0.9, fr: 0.6, sz: 0.7, glow: 0.3, a: 0.95, solid: 1, col: [0.55, 0.25, 0.65] },
  lava: { k: 0.55, kn: 0.9, rho: 0.85, s: 1.1, b: 0.3, g: 0.8, drag: 0.03, fr: 0.3, sz: 1.1, glow: 0.75, a: 1, col: [1, 0.33, 0.06] },
  ember: { k: 0.02, kn: 0.05, rho: 0.25, s: 0, b: 0, g: -0.7, drag: 0.5, fr: 0, sz: 0.5, glow: 1, a: 1, col: [1, 0.75, 0.3] },
  paste: { k: 0.8, kn: 1.2, rho: 0.85, s: 1.8, b: 0.6, g: 0.75, drag: 0.05, fr: 0.8, sz: 1.15, glow: 0.05, a: 0.95, stick: 0.4, col: [0.22, 0.62, 0.28] },
  metal: { k: 0.4, kn: 0.6, rho: 0.65, s: 0.02, b: 0, g: 1.5, drag: 0.02, fr: 0.9, sz: 0.6, glow: 0.2, a: 1, solid: 1, col: [0.66, 0.69, 0.75] },
  blood: { k: 0.6, kn: 0.9, rho: 0.825, s: 0.45, b: 0.1, g: 1.1, drag: 0.03, fr: 0.2, sz: 1, glow: 0.05, a: 0.95, col: [0.62, 0.02, 0.06] },
  poison: { k: 0.05, kn: 0.12, rho: 0.225, s: 0.1, b: 0, g: -0.3, drag: 1, fr: 0, sz: 1.3, glow: 0.45, a: 0.55, col: [0.38, 0.95, 0.22] },
  rock: { k: 0.3, kn: 0.5, rho: 0.7, s: 0.02, b: 0, g: 1.8, drag: 0.02, fr: 0.95, sz: 0.9, glow: 0, a: 1, solid: 1, col: [0.42, 0.36, 0.3] },
  frost: { k: 0.15, kn: 0.3, rho: 0.45, s: 0.2, b: 0, g: 0.35, drag: 0.4, fr: 0.7, sz: 0.6, glow: 0.4, a: 0.9, solid: 1, col: [0.8, 0.93, 1] },
  // montanha (vermelho): fogo que sobe e se apaga, carvão, magma super viscoso, raios vermelhos
  fire: { k: 0.03, kn: 0.08, rho: 0.2, s: 0.05, b: 0, g: -0.8, drag: 0.7, fr: 0, sz: 1.2, glow: 1, a: 0.55, ttl: 2.2, col: [1, 0.45, 0.08] },
  carbon: { k: 0.3, kn: 0.5, rho: 0.6, s: 0.05, b: 0, g: 1.2, drag: 0.05, fr: 0.9, sz: 0.6, glow: 0, a: 1, solid: 1, col: [0.12, 0.1, 0.1] },
  magma: { k: 0.6, kn: 1, rho: 0.9, s: 3.2, b: 1.2, g: 1, drag: 0.08, fr: 0.6, sz: 1.2, glow: 0.65, a: 1, col: [0.85, 0.2, 0.03] },
  zapR: { k: 0, kn: 0, rho: 0.1, s: 0, b: 0, g: 0, drag: 6, fr: 0, sz: 1.1, glow: 1, a: 1, ttl: 0.22, zap: 1, shape: 3, col: [1, 0.55, 0.35] },
  // ilha (azul): nuvens, eletricidade/raios azulados
  cloud: { k: 0.05, kn: 0.1, rho: 0.2, s: 0.15, b: 0, g: -0.3, drag: 1.2, fr: 0, sz: 2, glow: 0.15, a: 0.42, charge: 1, col: [0.85, 0.92, 1] },
  zapU: { k: 0, kn: 0, rho: 0.1, s: 0, b: 0, g: 0, drag: 6, fr: 0, sz: 1.1, glow: 1, a: 1, ttl: 0.22, zap: 1, shape: 3, col: [0.55, 0.85, 1] },
  // pântano (preto): água suja, areia movediça, magia negra, pó negro, nuvens escuras, trovão negro
  dirty: { k: 0.6, kn: 0.9, rho: 0.82, s: 0.5, b: 0.1, g: 1, drag: 0.03, fr: 0.2, sz: 1, glow: 0, a: 0.9, col: [0.28, 0.3, 0.16] },
  quicksand: { k: 0.5, kn: 0.8, rho: 0.95, s: 2.6, b: 0.9, g: 1.6, drag: 0.1, fr: 0.95, sz: 0.95, glow: 0, a: 1, solid: 1, col: [0.5, 0.4, 0.22] },
  voidm: { k: 0.06, kn: 0.15, rho: 0.3, s: 0.2, b: 0, g: 0, drag: 0.6, fr: 0, sz: 1.3, glow: 0.35, a: 0.8, col: [0.32, 0.05, 0.42] },
  soot: { k: 0.05, kn: 0.1, rho: 0.25, s: 0.05, b: 0, g: 0.1, drag: 1, fr: 0.5, sz: 0.5, glow: 0, a: 0.95, solid: 1, col: [0.06, 0.05, 0.07] },
  darkcloud: { k: 0.05, kn: 0.1, rho: 0.2, s: 0.15, b: 0, g: -0.3, drag: 1.2, fr: 0, sz: 2, glow: 0, a: 0.55, charge: 1, col: [0.16, 0.12, 0.2] },
  zapB: { k: 0, kn: 0, rho: 0.1, s: 0, b: 0, g: 0, drag: 6, fr: 0, sz: 1.2, glow: 1, a: 1, ttl: 0.25, zap: 1, shape: 3, col: [0.62, 0.3, 0.9] },
  // branco: faíscas sagradas e penas
  holy: { k: 0.03, kn: 0.08, rho: 0.2, s: 0, b: 0, g: -0.05, drag: 0.8, fr: 0, sz: 0.75, glow: 1, a: 0.9, wave: 1, shape: 2, col: [1, 0.95, 0.75] },
  feather: { k: 0.05, kn: 0.1, rho: 0.25, s: 0.05, b: 0, g: 0.1, drag: 1.6, fr: 0.3, sz: 1.25, glow: 0.2, a: 0.95, wave: 1, shape: 1, col: [0.97, 0.95, 0.9] },
  // verde: pólen
  pollen: { k: 0.04, kn: 0.08, rho: 0.2, s: 0.05, b: 0, g: -0.05, drag: 1, fr: 0.2, sz: 0.4, glow: 0.4, a: 0.95, wave: 1, col: [1, 0.85, 0.25] },
  // incolor/artefactos: óleo e cristais
  oil: { k: 0.55, kn: 0.85, rho: 0.7, s: 0.6, b: 0.15, g: 0.6, drag: 0.03, fr: 0.1, sz: 1, glow: 0.1, a: 0.95, col: [0.08, 0.08, 0.1] },
  crystal: { k: 0.2, kn: 0.4, rho: 0.5, s: 0.02, b: 0, g: 0.8, drag: 0.1, fr: 0.9, sz: 0.55, glow: 0.7, a: 1, solid: 1, prism: 1, shape: 2, col: [0.8, 0.85, 1] },
  // das reações: vapor e o clarão de um choque forte
  steam: { k: 0.03, kn: 0.06, rho: 0.15, s: 0.05, b: 0, g: -0.6, drag: 1.2, fr: 0, sz: 1.7, glow: 0.15, a: 0.4, ttl: 3, col: [0.92, 0.94, 0.97] },
  flash: { k: 0, kn: 0, rho: 0.1, s: 0, b: 0, g: 0, drag: 5, fr: 0, sz: 1.4, glow: 1, a: 1, ttl: 0.35, shape: 2, col: [1, 1, 0.9] },
  crust: { k: 0, kn: 0, rho: 0.25, s: 0, b: 0, g: 0, drag: 0, fr: 1, sz: 1.1, glow: 0, a: 1, solid: 1, col: [0.45, 0.2, 0.08] },
}
// a gravidade é o centro da esfera: cada matéria é puxada para lá com força própria (os pesados fazem o núcleo, os
// gases e a luz ficam por fora) e roda à volta do centro com velocidade própria (as camadas raspam e misturam-se)
const CENTER = { metal: 7, rock: 7, quicksand: 6.5, magma: 6, mud: 5.5, carbon: 5, lava: 4.5, paste: 4.2, blood: 4, oil: 3.6, dirty: 3.4, water: 3.2, crystal: 3,
  frost: 2.4, spore: 1.6, voidm: 1.4, soot: 1.4, ember: 1, light: 0.9, holy: 0.8, feather: 0.9, pollen: 0.8, poison: 0.7, cloud: 0.6, darkcloud: 0.6, fire: 0.6,
  smoke: 0.5, steam: 0.4, zapR: 0, zapU: 0, zapB: 0, flash: 0, crust: 0 }
// rotação: velocidade e eixo de cada matéria — eixos e sentidos diferentes (há correntes contrárias que se cruzam e chocam)
const SWIRL = { water: 1.5, light: 2.3, smoke: 1.7, mud: 0.5, spore: 1.1, lava: 0.7, ember: 2.1, paste: 0.3, metal: 0.25, blood: 1.2, poison: 1.6, rock: 0.2, frost: 0.9,
  fire: 2.4, carbon: 0.4, magma: 0.15, cloud: 1.4, dirty: 1, quicksand: 0.1, voidm: 2.2, soot: 0.8, darkcloud: 1.6, holy: 2.6, feather: 1, pollen: 1.4, oil: 0.9, crystal: 0.5,
  steam: 1.5, zapR: 0, zapU: 0, zapB: 0, flash: 0, crust: 0 }
const AXIS = { water: [0, 1, 0], light: [0.5, 0.8, 0.3], smoke: [0, -1, 0.2], mud: [0, 1, 0], spore: [0.3, -0.9, 0], lava: [0, 1, 0], ember: [-0.4, 0.8, 0.4],
  paste: [0, 1, 0], metal: [0, 1, 0], blood: [0.2, 1, 0], poison: [0.6, -0.7, 0.3], rock: [0, 1, 0], frost: [-0.5, 0.8, 0], fire: [0.3, 0.9, -0.3], carbon: [0, 1, 0],
  magma: [0, 1, 0], cloud: [0.7, -0.6, 0.2], dirty: [0, -1, 0.1], quicksand: [0, 1, 0], voidm: [-0.6, -0.6, 0.5], soot: [0, -1, 0], darkcloud: [0.5, -0.8, -0.3],
  holy: [-0.4, 0.9, 0.2], feather: [0.2, 1, 0.3], pollen: [0.5, 0.7, -0.5], oil: [0, -1, 0], crystal: [0.3, 1, 0], steam: [0, 1, 0.4] }
// as cores de mana → que matéria a fonte produz (proporções dentro da cor)
export const MANA_MAT = { W: [['light', 0.65], ['holy', 0.2], ['feather', 0.15]], U: [['water', 0.55], ['cloud', 0.25], ['frost', 0.2]],
  B: [['dirty', 0.25], ['mud', 0.12], ['quicksand', 0.1], ['voidm', 0.18], ['spore', 0.1], ['soot', 0.1], ['darkcloud', 0.15]],
  R: [['lava', 0.3], ['magma', 0.15], ['fire', 0.25], ['carbon', 0.1], ['ember', 0.2]], G: [['paste', 0.6], ['pollen', 0.2], ['spore', 0.2]],
  C: [['metal', 0.45], ['oil', 0.25], ['rock', 0.15], ['crystal', 0.15]] }
// reações quando duas matérias chocam (o par, por ordem alfabética): no que cada uma se torna ('' = fica) e o clarão
// (a luz do choque); qualquer choque forte entre matérias diferentes também emite luz
const REACT = {
  'lava|water': ['carbon', 'steam', 1], 'magma|water': ['rock', 'steam', 1], 'fire|water': ['steam', '', 0.6], 'frost|lava': ['water', 'rock', 0.8], 'frost|magma': ['water', 'rock', 0.8],
  'fire|frost': ['steam', 'water', 0.5], 'light|poison': ['', 'flash', 0.8], 'holy|poison': ['', 'flash', 1], 'light|voidm': ['flash', 'flash', 1.5], 'holy|voidm': ['flash', 'flash', 1.6],
  'blood|voidm': ['voidm', '', 0.4], 'voidm|water': ['', 'dirty', 0.3], 'dirty|light': ['water', '', 0.6], 'dirty|holy': ['water', '', 0.8], 'paste|poison': ['spore', '', 0.3],
  'fire|pollen': ['', 'ember', 0.7], 'fire|oil': ['fire', 'fire', 1], 'fire|feather': ['', 'ember', 0.6], 'metal|zapB': ['', '', 1], 'metal|zapU': ['', '', 1], 'metal|zapR': ['', '', 1],
  'cloud|fire': ['steam', '', 0.4], 'crystal|light': ['', '', 1.2], 'quicksand|water': ['dirty', '', 0.2],
}
// as nuvens carregadas disparam raios da cor delas
const ZAP_OF = { cloud: 'zapU', darkcloud: 'zapB', fire: 'zapR', magma: 'zapR' }
// o remendo de cada matéria quando a fenda fecha (a crosta): sangue → ferrugem, água → calcário, lava → obsidiana…
const PATCH = { fire: [0.12, 0.1, 0.1], carbon: [0.12, 0.1, 0.1], magma: [0.08, 0.06, 0.08], dirty: [0.35, 0.3, 0.18], quicksand: [0.5, 0.4, 0.22], voidm: [0.25, 0.08, 0.3],
  oil: [0.1, 0.1, 0.12], crystal: [0.75, 0.8, 0.95], cloud: [0.86, 0.9, 0.95], blood: [0.5, 0.22, 0.08], water: [0.86, 0.86, 0.8], frost: [0.86, 0.9, 0.95], lava: [0.08, 0.06, 0.08], ember: [0.08, 0.06, 0.08], paste: [0.55, 0.42, 0.12],
  mud: [0.3, 0.22, 0.12], metal: [0.78, 0.8, 0.84], rock: [0.4, 0.36, 0.3], light: [0.95, 0.85, 0.5], spore: [0.3, 0.4, 0.18], smoke: [0.25, 0.22, 0.28], poison: [0.3, 0.55, 0.15] }

const R = 0.84
// o alcance entre vizinhas acompanha o número de partículas (poucas = mais afastadas), para encherem sempre a esfera;
// cada simulador tem o seu e passa a ser o em uso no início de cada passo (as esferas correm uma de cada vez)
let H = 0.24, H2 = H * H, GN = 12  // raio da esfera (por dentro do vidro), alcance das vizinhas
const NAMES = Object.keys(MAT), CRUST = NAMES.indexOf('crust'), FLASH = NAMES.indexOf('flash')
// como cada matéria se desenha: 0 líquido (superfície contínua), 1 sólido (grãos/formas), 2 gás (baforadas), 3 luz (somada)
const LIQ = ['water', 'mud', 'lava', 'paste', 'blood', 'magma', 'dirty', 'oil', 'quicksand'], GAS = ['smoke', 'poison', 'cloud', 'darkcloud', 'steam', 'voidm']
export const KIND = NAMES.map(k => (LIQ.includes(k) ? 0 : GAS.includes(k) ? 2 : MAT[k].glow >= 0.5 ? 3 : 1))
const SHAPE_GAS = 4, SHAPE_FIRE = 5
const TK = NAMES.map(k => MAT[k].k), TKN = NAMES.map(k => MAT[k].kn), TRHO = NAMES.map(k => MAT[k].rho), TS = NAMES.map(k => MAT[k].s), TB = NAMES.map(k => MAT[k].b)

export class FluidSim {
  constructor(n = 600, seed = 1) {
    this.max = n
    this.x = new Float32Array(n * 3); this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3)
    this.m = new Uint8Array(n); this.alive = new Uint8Array(n); this.age = new Float32Array(n); this.fade = new Float32Array(n)  // fade>0: a dissolver-se
    this.out = new Uint8Array(n); this.outT = new Float32Array(n)  // 1: já verteu para fora do vidro (outT: há quanto tempo)
    this.count = 0; this.t = 0; this.want = {}; this.holes = []; this.rnd = mulberry(seed)
    this.H = Math.max(0.2, Math.cbrt(2.48 / (n * 0.95)) * 1.5); this.GN = Math.max(6, Math.floor(3.2 / this.H))
    this.head = new Int32Array(this.GN ** 3); this.next = new Int32Array(n)
    this.pi = new Int32Array(n * 40); this.pj = new Int32Array(n * 40); this.np = 0  // os pares de vizinhas (uma procura por passo)
    this.rho = new Float32Array(n); this.rhn = new Float32Array(n)
  }
  // o que a esfera deve ter (fração de cada matéria, soma ≈ 1) e quanta matéria no total (0..1 do máximo)
  setTargets(frac, fill = 0.7) {
    const tot = Math.round(this.max * fill), want = {}
    for (const [k, f] of Object.entries(frac)) if (f > 0.005) want[k] = Math.round(tot * f)
    this.want = want
  }
  // matéria que entra de fora (um golpe, um feitiço): n partículas no ponto dir (direção no vidro), a entrar
  inject(mat, n, dir = [0, 1, 0]) {
    const L = Math.hypot(...dir) || 1, d = dir.map(x => x / L)
    for (let k = 0; k < n; k++) {
      const i = this.spawn(mat, d[0] * R * 0.9, d[1] * R * 0.9, d[2] * R * 0.9)
      if (i < 0) break
      const sp = 1.6 + this.rnd() * 1.5
      this.v[i * 3] = -d[0] * sp + (this.rnd() - 0.5); this.v[i * 3 + 1] = -d[1] * sp + (this.rnd() - 0.5); this.v[i * 3 + 2] = -d[2] * sp + (this.rnd() - 0.5)
    }
  }
  spawn(mat, x = 0, y = 0, z = 0) {
    let i = -1
    if (this.count < this.max) i = this.count++
    else if (MAT[mat].ttl && MAT[mat].ttl < 1) return -1  // clarões e raios só em lugares livres (antes tiravam o lugar à matéria)
    else {  // cheio: substitui a partícula mais velha que já se estiver a dissolver (ou a mais velha de todas)
      let best = -1, ba = -1
      for (let k = 0; k < this.count; k++) { const sc = this.age[k] + (this.fade[k] > 0 ? 1e3 : 0) + (this.out[k] ? 2e3 : 0); if (this.m[k] !== NAMES.indexOf('crust') && sc > ba) { ba = sc; best = k } }
      i = best
    }
    if (i < 0) return -1
    const j = this.rnd, s = 0.05
    this.x[i * 3] = x + (j() - 0.5) * s; this.x[i * 3 + 1] = y + (j() - 0.5) * s; this.x[i * 3 + 2] = z + (j() - 0.5) * s
    this.v[i * 3] = (j() - 0.5) * 0.6; this.v[i * 3 + 1] = (j() - 0.5) * 0.6; this.v[i * 3 + 2] = (j() - 0.5) * 0.6
    this.m[i] = NAMES.indexOf(mat); this.alive[i] = 1; this.age[i] = 0; this.fade[i] = 0; this.out[i] = 0; this.outT[i] = 0
    if (this.tint) this.tint[i] = 0
    return i
  }
  // um golpe/choque: empurra o fluido a partir do ponto (dir no vidro) e agita-o (força 0..1)
  kick(dir = [0, 1, 0], f = 1) {
    const L = Math.hypot(...dir) || 1, d = dir.map(x => (x / L) * R)
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.out[i]) continue
      const o = i * 3, dx = this.x[o] - d[0], dy = this.x[o + 1] - d[1], dz = this.x[o + 2] - d[2], r = Math.hypot(dx, dy, dz) || 1, k = f * 4.5 * Math.max(0, 1.6 - r)
      this.v[o] += (dx / r) * k + (this.rnd() - 0.5) * f * 2; this.v[o + 1] += (dy / r) * k + (this.rnd() - 0.5) * f * 2; this.v[o + 2] += (dz / r) * k + (this.rnd() - 0.5) * f * 2
    }
  }
  // um raio: uma cadeia de faíscas em zigue-zague a partir da partícula i
  bolt(i, kind) {
    this.zaps++
    const o = i * 3
    let x = this.x[o], y = this.x[o + 1], z = this.x[o + 2]
    const dx = this.rnd() - 0.5, dy = this.rnd() - 0.5, dz = this.rnd() - 0.5, L = Math.hypot(dx, dy, dz) || 1
    for (let k = 0; k < 7; k++) {
      x += (dx / L) * 0.09 + (this.rnd() - 0.5) * 0.08; y += (dy / L) * 0.09 + (this.rnd() - 0.5) * 0.08; z += (dz / L) * 0.09 + (this.rnd() - 0.5) * 0.08
      if (Math.hypot(x, y, z) > R) break
      const j = this.spawn(kind, x, y, z); if (j < 0) break
      this.v[j * 3] = this.v[j * 3 + 1] = this.v[j * 3 + 2] = 0; this.age[j] = k * 0.012
    }
  }
  // a luz de um choque: um clarão e umas faíscas (col: a cor, se não for branca)
  burst(x, y, z, f = 1, col = null) {
    let alive = 0
    for (let i = 0; i < this.count; i++) if (this.alive[i] && this.m[i] === FLASH) alive++
    if (alive > 24) return  // um teto: a luz dos choques não enche a esfera
    const n = Math.round(1 + f * 2)
    for (let k = 0; k < n; k++) {
      const j = this.spawn('flash', x, y, z); if (j < 0) break
      const sp = 0.8 + f * 1.5
      this.v[j * 3] = (this.rnd() - 0.5) * sp; this.v[j * 3 + 1] = (this.rnd() - 0.5) * sp; this.v[j * 3 + 2] = (this.rnd() - 0.5) * sp
      if (col) { this.crustCol = this.crustCol || new Float32Array(this.max * 3); this.crustCol.set(col, j * 3); this.tint = this.tint || new Uint8Array(this.max); this.tint[j] = 1 }
    }
  }
  // fendas: direções no vidro por onde verte (força 0..1); curar fecha-as com crosta do que lá estava
  setCracks(list) { this.holes = list }
  heal(amount = 1) {
    for (const h of this.holes) {
      if (h.patched) continue
      // a matéria mais perto da fenda decide o remendo
      let best = null, bd = 1e9
      for (let i = 0; i < this.count; i++) { if (!this.alive[i] || this.out[i]) continue; const dx = this.x[i * 3] - h.d[0] * R, dy = this.x[i * 3 + 1] - h.d[1] * R, dz = this.x[i * 3 + 2] - h.d[2] * R, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = NAMES[this.m[i]] } }
      h.patched = PATCH[best] || PATCH.blood; h.patchT = 0
      const n = Math.round(8 + 10 * amount)
      for (let k = 0; k < n; k++) {  // a crosta: grãos colados ao vidro à volta da fenda
        const a = this.rnd() * Math.PI * 2, rr = this.rnd() * 0.12, u = perp(h.d), w = cross(h.d, u)
        const px = h.d[0] * R * 0.97 + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * rr, py = h.d[1] * R * 0.97 + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * rr, pz = h.d[2] * R * 0.97 + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * rr
        const i = this.spawn('crust', px, py, pz); if (i < 0) break
        this.v[i * 3] = this.v[i * 3 + 1] = this.v[i * 3 + 2] = 0; this.crustCol = this.crustCol || new Float32Array(this.max * 3); this.crustCol.set(h.patched, i * 3)
      }
    }
  }
  // um passo: g = gravidade no referencial da esfera (inclui a inércia), dead = partida (verte tudo para o chão)
  step(dt, g, opts = {}) {
    H = this.H; H2 = H * H; GN = this.GN
    let n = this.count
    const X = this.x, P = this.p, V = this.v, Mi = this.m, dead = !!opts.dead, stir = opts.stir || 0
    dt = Math.min(dt, 1 / 30); this.t += dt
    // a fonte: o que falta sai do centro, devagar; o que sobra dissolve-se (fade) — sem mudanças de repente
    if (opts.freeze) return 0  // pedra: tudo parado onde estava
    if (!dead && !opts.hold) {
      const have = {}
      for (let i = 0; i < n; i++) if (this.alive[i] && !this.out[i] && !this.fade[i]) { const k = NAMES[Mi[i]]; have[k] = (have[k] || 0) + 1 }
      let budget = this.t < 1.2 ? 60 : Math.max(2, Math.round(70 * dt * 6))  // ao aparecer enche depressa; depois, devagar
      for (const [k, w] of Object.entries(this.want)) while ((have[k] || 0) < w && budget-- > 0) { const i = this.spawn(k, 0, 0, 0); if (i < 0) break; have[k] = (have[k] || 0) + 1 }
      for (const k of Object.keys(have)) {
        if (k === 'crust') continue
        let extra = have[k] - (this.want[k] || 0)
        for (let i = 0; i < n && extra > 0; i++) if (this.alive[i] && NAMES[Mi[i]] === k && !this.fade[i] && !this.out[i] && this.rnd() < 0.08) { this.fade[i] = 1e-3; extra-- }
      }
    }
    n = this.count  // a fonte pode ter criado partículas neste passo
    this.zaps = 0
    // forças: gravidade (por matéria), arrasto, a luz ondula, mexer agita
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue
      const M = MAT[NAMES[Mi[i]]], o = i * 3
      this.age[i] += dt
      if (this.fade[i] > 0) { this.fade[i] += dt / 1.6; if (this.fade[i] >= 1) { this.alive[i] = 0; continue } }
      if (NAMES[Mi[i]] === 'crust') { V[o] = V[o + 1] = V[o + 2] = 0; if (this.age[i] > 30 && !this.fade[i]) this.fade[i] = 1e-3; continue }
      if (M.ttl && this.age[i] > M.ttl && !this.fade[i]) this.fade[i] = 0.5  // vida curta (fogo, vapor, raios, clarões)
      if (M.zap) { V[o] += (this.rnd() - 0.5) * 30 * dt; V[o + 1] += (this.rnd() - 0.5) * 30 * dt; V[o + 2] += (this.rnd() - 0.5) * 30 * dt }  // o raio tremeluz
      const zk = ZAP_OF[NAMES[Mi[i]]]
      if (zk && !this.out[i] && this.zaps < 3 && this.rnd() < (M.charge ? 0.012 : 0.002) * (1 + (opts.charge || 0))) this.bolt(i, zk)
      const nm = NAMES[Mi[i]]
      if (this.out[i]) {  // já fora: o que pesa cai para o chão; o gás sobe e desfaz-se; a luz espalha-se e apaga-se
        const kd = KIND[Mi[i]]; this.outT[i] += dt
        if (kd === 2) { V[o + 1] += 2.2 * dt; V[o] *= 0.985; V[o + 2] *= 0.985; if (!this.fade[i] && this.outT[i] > 1.5 + (i % 7) * 0.4) this.fade[i] = 1e-3 }
        else if (kd === 3) { V[o] *= 0.97; V[o + 1] = V[o + 1] * 0.97 + 0.6 * dt; V[o + 2] *= 0.97; if (!this.fade[i] && this.outT[i] > 0.8 + (i % 5) * 0.3) this.fade[i] = 1e-3 }
        else { V[o] += g[0] * dt; V[o + 1] += (g[1] - 3.2) * dt; V[o + 2] += g[2] * dt }
      }
      else {
        // puxado para o centro (força da matéria), a rodar à volta do eixo (que muda devagar), mais a inércia da esfera
        const kc = (CENTER[nm] ?? 1) * (opts.pull ?? 1), sw = SWIRL[nm] ?? 0, A = AXIS[nm] || [0, 1, 0], wob = Math.sin(this.t * 0.11) * 0.3, aL = Math.hypot(A[0] + wob, A[1], A[2] - wob) || 1
        const ux = (A[0] + wob) / aL, uy = A[1] / aL, uz = (A[2] - wob) / aL, x = X[o], y = X[o + 1], z = X[o + 2]
        V[o] += (-kc * x + g[0]) * dt; V[o + 1] += (-kc * y + g[1]) * dt; V[o + 2] += (-kc * z + g[2]) * dt
        // a rotação é uma velocidade a que tende (não uma força que se acumula: colava tudo ao vidro, oco por dentro)
        const kr = Math.min(1, dt * 1.8) * 0.5, tx = sw * (uy * z - uz * y) * 0.7, ty = sw * (uz * x - ux * z) * 0.7, tz = sw * (ux * y - uy * x) * 0.7
        V[o] += (tx - V[o]) * kr; V[o + 1] += (ty - V[o + 1]) * kr; V[o + 2] += (tz - V[o + 2]) * kr
      }
      if (M.wave) { V[o] += Math.sin(this.t * 2.2 + X[o + 1] * 7) * 0.9 * dt; V[o + 2] += Math.cos(this.t * 1.7 + X[o] * 6) * 0.9 * dt; V[o + 1] += Math.sin(this.t * 3 + X[o] * 5) * 0.4 * dt }
      if (stir) { V[o] += -X[o + 2] * stir * dt; V[o + 2] += X[o] * stir * dt }
      const dr = Math.max(0, 1 - M.drag * dt); V[o] *= dr; V[o + 1] *= dr; V[o + 2] *= dr
    }
    // viscosidade entre vizinhas (os pares do passo anterior: chega e poupa uma procura) e as reações dos choques
    let reacts = 0
    for (let k = 0; k < this.np; k++) {
      const i = this.pi[k], j = this.pj[k]
      if (i >= n || j >= n || !this.alive[i] || !this.alive[j]) continue
      const o = i * 3, p = j * 3, dx = X[p] - X[o], dy = X[p + 1] - X[o + 1], dz = X[p + 2] - X[o + 2], d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= H2 || d2 < 1e-9) continue
      const r = Math.sqrt(d2), q = 1 - r / H, a = Mi[i], b = Mi[j], sv = (TS[a] + TS[b]) / 2, bb = (TB[a] + TB[b]) / 2, nx = dx / r, ny = dy / r, nz = dz / r
      const u = (V[o] - V[p]) * nx + (V[o + 1] - V[p + 1]) * ny + (V[o + 2] - V[p + 2]) * nz
      if (u > 0) { const I = dt * q * (sv * u + bb * u * u) * 0.5; V[o] -= I * nx; V[o + 1] -= I * ny; V[o + 2] -= I * nz; V[p] += I * nx; V[p + 1] += I * ny; V[p + 2] += I * nz }
      if (a !== b && reacts < 10) {  // choque entre matérias diferentes: reação (se a houver) e luz se for forte
        const na = NAMES[a], nb = NAMES[b], key = na < nb ? `${na}|${nb}` : `${nb}|${na}`, rx = REACT[key], first = na < nb
        if (rx && this.rnd() < 0.08 + Math.max(0, u) * 0.25) {
          reacts++
          const toA = first ? rx[0] : rx[1], toB = first ? rx[1] : rx[0]
          if (toA) { Mi[i] = NAMES.indexOf(toA); this.age[i] = 0 }
          if (toB) { Mi[j] = NAMES.indexOf(toB); this.age[j] = 0 }
          if (rx[2] > 0.7) this.burst((X[o] + X[p]) / 2, (X[o + 1] + X[p + 1]) / 2, (X[o + 2] + X[p + 2]) / 2, rx[2], na === 'voidm' || nb === 'voidm' ? [0.75, 0.4, 1] : null)
        } else if (u > 3.2 && this.rnd() < 0.06) { reacts++; this.burst((X[o] + X[p]) / 2, (X[o + 1] + X[p + 1]) / 2, (X[o + 2] + X[p + 2]) / 2, Math.min(1, u / 4)) }
      }
    }
    for (let i = 0; i < n; i++) { if (!this.alive[i]) continue; const o = i * 3; P[o] = X[o]; P[o + 1] = X[o + 1]; P[o + 2] = X[o + 2]; X[o] += V[o] * dt; X[o + 1] += V[o + 1] * dt; X[o + 2] += V[o + 2] * dt }
    // pressão: double density relaxation (cada par com a média das duas matérias); uma procura de vizinhas por passo
    this.grid(); this.collect(n)
    const rho = this.rho, rhn = this.rhn
    rho.fill(0); rhn.fill(0)
    for (let k = 0; k < this.np; k++) {
      const i = this.pi[k], j = this.pj[k], o = i * 3, p = j * 3, dx = X[p] - X[o], dy = X[p + 1] - X[o + 1], dz = X[p + 2] - X[o + 2], q = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / H
      if (q <= 0) continue
      rho[i] += q * q; rho[j] += q * q; rhn[i] += q * q * q; rhn[j] += q * q * q
    }
    for (let k = 0; k < this.np; k++) {
      const i = this.pi[k], j = this.pj[k], o = i * 3, p = j * 3, dx = X[p] - X[o], dy = X[p + 1] - X[o + 1], dz = X[p + 2] - X[o + 2], d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= H2 || d2 < 1e-9) continue
      const r = Math.sqrt(d2), q = 1 - r / H, a = Mi[i], b = Mi[j]
      const Pi = TK[a] * (rho[i] - TRHO[a]), Pj = TK[b] * (rho[j] - TRHO[b]), Pn = (TKN[a] * rhn[i] + TKN[b] * rhn[j]) / 2
      const D = dt * dt * ((Pi + Pj) / 2 * q + Pn * q * q) * 0.5 * 60, nx = dx / r, ny = dy / r, nz = dz / r
      const ci = a === CRUST ? 0 : 1, cj = b === CRUST ? 0 : 1, w = (ci + cj || 1) / 2
      X[o] -= D * nx * ci / w; X[o + 1] -= D * ny * ci / w; X[o + 2] -= D * nz * ci / w
      X[p] += D * nx * cj / w; X[p + 1] += D * ny * cj / w; X[p + 2] += D * nz * cj / w
    }
    // o vidro (ou as fendas, ou o chão depois de partida) e a velocidade nova
    const FLOOR = -1.1
    let leaked = 0
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue
      const o = i * 3, M = MAT[NAMES[Mi[i]]]
      if (this.out[i] || dead) {
        this.out[i] = 1
        if (X[o + 1] < FLOOR) { X[o + 1] = FLOOR; const f = 1 - Math.min(1, M.fr + 0.4); V[o] *= f; V[o + 2] *= f }
        if (this.outT[i] > (dead ? 30 : 12) && !this.fade[i]) this.fade[i] = 1e-3
      } else {
        const r = Math.hypot(X[o], X[o + 1], X[o + 2])
        if (r > R) {
          const nx = X[o] / r, ny = X[o + 1] / r, nz = X[o + 2] / r
          const hole = this.holes.find(h => !h.patched && h.d[0] * nx + h.d[1] * ny + h.d[2] * nz > 1 - 0.02 * h.k)
          if (hole && this.rnd() < 0.6 * hole.k && !M.wave) { this.out[i] = 1; leaked++ }  // verte pela fenda
          else {
            X[o] = nx * R; X[o + 1] = ny * R; X[o + 2] = nz * R
            const stick = M.stick || 0
            if (stick && this.rnd() < stick * dt * 4) { /* cola um instante ao vidro */ }
          }
        }
      }
      // velocidade pela posição; atrito tangencial no vidro para os grãos e pastas
      V[o] = (X[o] - P[o]) / dt; V[o + 1] = (X[o + 1] - P[o + 1]) / dt; V[o + 2] = (X[o + 2] - P[o + 2]) / dt
      const r2 = Math.hypot(X[o], X[o + 1], X[o + 2])
      if (!this.out[i] && r2 > R * 0.98 && M.fr) { const f = 1 - M.fr * 0.35; V[o] *= f; V[o + 1] *= f; V[o + 2] *= f }
      const sp = Math.hypot(V[o], V[o + 1], V[o + 2]); if (sp > 6) { V[o] *= 6 / sp; V[o + 1] *= 6 / sp; V[o + 2] *= 6 / sp }
    }
    // compacta (tira as mortas)
    if (n > 40 && this.rnd() < 0.2) this.compact()
    return leaked
  }
  grid() {
    this.head.fill(-1)
    for (let i = 0; i < this.count; i++) { if (!this.alive[i]) continue; const c = this.cell(i); this.next[i] = this.head[c]; this.head[c] = i }
  }
  collect(n) {  // os pares de vizinhas (i < j) para este passo
    const X = this.x, max = this.pi.length
    let c = 0
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue
      const o = i * 3, cx = gc(X[o]), cy = gc(X[o + 1]), cz = gc(X[o + 2])
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        const x = cx + a, y = cy + b, z = cz + d
        if (x < 0 || y < 0 || z < 0 || x > GN - 1 || y > GN - 1 || z > GN - 1) continue
        for (let j = this.head[x + y * GN + z * GN * GN]; j >= 0; j = this.next[j]) {
          if (j <= i) continue
          const p = j * 3, dx = X[p] - X[o], dy = X[p + 1] - X[o + 1], dz = X[p + 2] - X[o + 2]
          if (dx * dx + dy * dy + dz * dz < H2 && c < max) { this.pi[c] = i; this.pj[c] = j; c++ }
        }
      }
    }
    this.np = c
  }
  cell(i) { const o = i * 3; return gc(this.x[o]) + gc(this.x[o + 1]) * GN + gc(this.x[o + 2]) * GN * GN }
  pairs(fn) {
    const X = this.x
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue
      const o = i * 3, cx = gc(X[o]), cy = gc(X[o + 1]), cz = gc(X[o + 2])
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const x = cx + a, y = cy + b, z = cz + c
        if (x < 0 || y < 0 || z < 0 || x > GN - 1 || y > GN - 1 || z > GN - 1) continue
        for (let j = this.head[x + y * GN + z * GN * GN]; j >= 0; j = this.next[j]) {
          if (j <= i) continue
          const p = j * 3, dx = X[p] - X[o], dy = X[p + 1] - X[o + 1], dz = X[p + 2] - X[o + 2], d2 = dx * dx + dy * dy + dz * dz
          if (d2 < H2 && d2 > 1e-9) fn(i, j, dx, dy, dz, Math.sqrt(d2))
        }
      }
    }
  }
  release(xf = null, kick = 1, mode = 'burst') {
    const xs = xf?.s || [1, 1, 1], xo = xf?.o || [0, 0, 0]
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.out[i]) continue
      const o = i * 3, M = MAT[NAMES[this.m[i]]], vis = 1 / (1 + (M.s || 0) * 0.5)
      for (let q = 0; q < 3; q++) { const x = this.x[o + q] * xs[q] + xo[q], d = x - this.x[o + q]; this.x[o + q] = x; this.p[o + q] += d }
      const rx = this.x[o] - xo[0], ry = this.x[o + 1] - xo[1], rz = this.x[o + 2] - xo[2], L = Math.hypot(rx, ry, rz) || 1, sp = kick * (1.5 + this.rnd() * 2.5) * vis
      if (mode === 'split') { this.v[o] = Math.sign(rx || this.rnd() - 0.5) * sp * 1.2; this.v[o + 1] = sp * 0.5 + ry; this.v[o + 2] = rz / L * sp * 0.4 }
      else { this.v[o] = rx / L * sp; this.v[o + 1] = ry / L * sp + kick * 1.6; this.v[o + 2] = rz / L * sp * 0.6 }
      this.p[o] = this.x[o] - this.v[o] / 60; this.p[o + 1] = this.x[o + 1] - this.v[o + 1] / 60; this.p[o + 2] = this.x[o + 2] - this.v[o + 2] / 60
      this.out[i] = 1; this.outT[i] = 0
    }
  }
  // arrastar o dedo pelo que verteu empurra-o (coordenadas da cena)
  poke(x, y, vx, vy) {
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || !this.out[i]) continue
      const o = i * 3, d = Math.hypot(this.x[o] - x, this.x[o + 1] - y)
      if (d < 0.6) { const k = (1 - d / 0.6) * 0.01; this.x[o] += vx * k * 0.016; this.p[o] -= vx * k * 0.016; this.x[o + 1] += Math.max(0, -vy * k) * 0.016 + 0.004; this.p[o + 1] -= Math.max(0.5, -vy * k) * 0.016 }
    }
  }
  compact() {
    let w = 0
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue
      if (w !== i) {
        this.x.copyWithin(w * 3, i * 3, i * 3 + 3); this.p.copyWithin(w * 3, i * 3, i * 3 + 3); this.v.copyWithin(w * 3, i * 3, i * 3 + 3)
        this.m[w] = this.m[i]; this.alive[w] = 1; this.age[w] = this.age[i]; this.fade[w] = this.fade[i]; this.out[w] = this.out[i]; this.outT[w] = this.outT[i]
        if (this.crustCol) this.crustCol.copyWithin(w * 3, i * 3, i * 3 + 3)
        if (this.tint) this.tint[w] = this.tint[i]
      }
      w++
    }
    this.count = w
  }
  // para desenhar: posição, cor, tamanho, brilho e opacidade de cada partícula viva
  fill(pos, col, size, glow, alpha, now = 0, shape = null, rot = null, kind = null, xf = null) {
    let k = 0
    const xs = xf?.s || [1, 1, 1], xo = xf?.o || [0, 0, 0], cz = Math.cos(xf?.rz || 0), sz = Math.sin(xf?.rz || 0), tc = xf?.col, tk = xf?.k || 0, sm = Math.min(xs[0], xs[1], xs[2])
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue
      const M = MAT[NAMES[this.m[i]]], o = i * 3
      if (xf && !this.out[i]) { const x = this.x[o] * xs[0], y = this.x[o + 1] * xs[1]; pos[k * 3] = x * cz - y * sz + xo[0]; pos[k * 3 + 1] = x * sz + y * cz + xo[1]; pos[k * 3 + 2] = this.x[o + 2] * xs[2] + xo[2] }
      else { pos[k * 3] = this.x[o]; pos[k * 3 + 1] = this.x[o + 1]; pos[k * 3 + 2] = this.x[o + 2] }
      const nmi = NAMES[this.m[i]]
      const c = (nmi === 'crust' || (nmi === 'flash' && this.tint?.[i])) && this.crustCol ? [this.crustCol[o], this.crustCol[o + 1], this.crustCol[o + 2]]
        : M.prism ? [0.6 + 0.4 * Math.sin(now * 2 + i), 0.6 + 0.4 * Math.sin(now * 2 + i + 2.1), 0.6 + 0.4 * Math.sin(now * 2 + i + 4.2)] : M.col
      const tw = M.wave ? 0.75 + 0.25 * Math.sin(now * 4 + i) : 1
      col[k * 3] = c[0] * tw; col[k * 3 + 1] = c[1] * tw; col[k * 3 + 2] = c[2] * tw
      if (tc && tk > 0) for (let q = 0; q < 3; q++) col[k * 3 + q] += (tc[q] - col[k * 3 + q]) * tk
      if (shape) { shape[k] = M.shape || (KIND[this.m[i]] === 2 ? SHAPE_GAS : nmi === 'fire' || nmi === 'ember' ? SHAPE_FIRE : 0); rot[k] = (M.shape === 3 ? Math.atan2(this.v[o + 1], this.v[o]) : i * 1.7 + now * (M.wave ? 0.6 : 0.2)) }
      if (kind) kind[k] = KIND[this.m[i]]
      size[k] = M.sz * (this.H / 0.24) * (M.wave ? 0.8 + 0.4 * Math.sin(now * 3 + i * 1.7) : 1); glow[k] = M.glow  // poucas partículas = gotas maiores
      if (xf && !this.out[i]) size[k] *= sm  // encolhe com o vidro (implodir)
      alpha[k] = M.a * (this.fade[i] > 0 ? 1 - this.fade[i] : 1) * (this.age[i] < 0.25 ? this.age[i] / 0.25 : 1)
      k++
    }
    return k
  }
}

const gc = v => Math.max(0, Math.min(GN - 1, ((v + 1.6) / 3.2 * GN) | 0))
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function perp(d) { const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], c = cross(d, a), L = Math.hypot(...c) || 1; return c.map(x => x / L) }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }

// verificação rápida (node orbfluid.js): a fonte enche, a água assenta por baixo do fumo, a fenda verte, curar remenda
export function selfcheck() {
  const f = new FluidSim(300, 7)
  f.setTargets({ water: 0.6, smoke: 0.4 }, 0.8)
  for (let s = 0; s < 240; s++) f.step(1 / 60, [0, 0, 0])
  const avg = k => { let y = 0, c = 0; for (let i = 0; i < f.count; i++) if (f.alive[i] && NAMES[f.m[i]] === k && !f.out[i]) { y += Math.hypot(f.x[i * 3], f.x[i * 3 + 1], f.x[i * 3 + 2]); c++ } return c ? y / c : 0 }
  const live = () => { let c = 0; for (let i = 0; i < f.count; i++) if (f.alive[i] && !f.out[i]) c++; return c }
  if (!(live() > 150)) throw new Error('a fonte não encheu: ' + live())
  if (!(avg('water') < avg('smoke'))) throw new Error('a água não ficou por dentro do fumo (o centro é a gravidade)')
  f.setCracks([{ d: [0, -1, 0], k: 1 }])
  let out = 0
  for (let s = 0; s < 120; s++) out += f.step(1 / 60, [0, -6, 0])  // a esfera abanada para baixo: verte pela fenda de baixo
  if (!(out > 0)) throw new Error('a fenda não verteu')
  f.heal(1)
  if (!f.holes[0].patched) throw new Error('curar não remendou')
  return 'selfcheck fluido ok'
}
// node -e "import('./orbfluid.js').then(m => console.log(m.selfcheck()))"
