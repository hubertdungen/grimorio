// Definições › Mesa (Forge Play): teclas, jogo mais solto (pagar sozinho, deixar resolver o que é teu), arrumação do teu
// lado (grelha, livre ou filas), perspetiva do lado do adversário (inclinação em graus), para onde estão viradas as cartas
// dos adversários. Tudo só no teu ecrã.
// Tamanho das cartas na mesa, em píxeis (Definições › Mesa e a barra das réplicas). Com um tamanho escolhido, criaturas,
// terrenos e as outras permanentes ficam todas com ele (no automático os terrenos são mais pequenos para caber tudo);
// quando não cabem numa fila, encostam-se e empilham-se (useOverlap, groups) em vez de saírem do lado do jogador.
export const CARD_PX = [0, 48, 56, 64, 72, 80, 96, 112, 128]
// padrões do tapete (desenho em index.css, .bside[data-mat]; a mesma lista em freetable.py MATS)
export const MATS = ['pontos', 'riscas', 'xadrez', 'grelha', 'linho', 'escamas', 'arcano', 'oceano', 'brasas', 'floresta']
// a esfera da vida: estilo (cores) e animação; «auto» = pelas cores e pelo estilo do deck (a mesma lista em freetable.py)
export const ORB_T = ['verde', 'oceano', 'brasa', 'vazio', 'ouro', 'gelo', 'prisma', 'tempestade', 'sangue']
export const ORB_A = ['calmo', 'turbilhao', 'pulsar', 'faiscas']
// --pk: no Forge Play e na mesa livre (mesa de tamanho fixo) o useOverlap encolhe um pouco se as filas não cabem na altura
// k: o fator que escala o tamanho escolhido — na mesa fixa o --pk do useOverlap; nas réplicas do Coliseu o --fit do zoom (−/⤢/+)
export const cardVars = (px, k = 'var(--pk, 1)') => (px ? { '--px': `calc(${px}px * ${k})`, '--cw': `calc(${px}px * ${k})`, '--ow': `calc(${px}px * ${k})`, '--lw': `calc(${px}px * ${k})` } : null)
export const fpPrefs = () => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}') } catch { /* sem armazenamento */ }
  return { space: o.space !== false, shiftSpace: o.shiftSpace !== false,  // Shift+Espaço = acabar o turno (ligado por omissão)
    // relógio de torneio: a responder ao adversário tens clockSec s e depois passa sozinho; Stop (clockKey) dá mais clockExtra s
    clock: o.clock !== false, clockSec: Math.max(3, Math.min(30, +o.clockSec || 8)), clockExtra: Math.max(5, Math.min(90, +o.clockExtra || 20)), clockKey: /^[a-z0-9]$/.test(o.clockKey || '') ? o.clockKey : 's',
    flip: o.flip || 'f', tap: o.tap || 't',
    autopay: o.autopay === true, autoresolve: o.autoresolve === true,  // pagar sozinho: desligado por omissão
    place: ['grid', 'free', 'rows'].includes(o.place) ? o.place : 'grid', persp: o.persp !== false, tilt: Number.isFinite(o.tilt) ? o.tilt : 30,
    oppFace: o.oppFace === 'far' ? 'far' : 'me',  // cartas dos adversários: viradas para mim (legíveis) ou para eles (180°, como numa mesa a sério)
    cardPx: CARD_PX.includes(o.cardPx) ? o.cardPx : 0,  // tamanho das cartas na mesa (0 = automático)
    mat: MATS.includes(o.mat) ? o.mat : null, mats: o.mats !== false,  // o meu tapete; ver os tapetes dos outros (desligado: vejo o meu em todos os lados)
    orb: { t: ORB_T.includes(o.orb?.t) ? o.orb.t : 'auto', a: ORB_A.includes(o.orb?.a) ? o.orb.a : 'auto' },  // a minha esfera da vida
    botOrb: o.botOrb === 'random' ? 'random' : 'deck',
    orb3d: o.orb3d !== false,  // esfera em 3D (WebGL); desligado = a clássica
    orbFluid: o.orbFluid !== false,  // fluidos por cor pelo que está em campo (só no estilo automático); desligado = o líquido do estilo
    orbParticles: o.orbParticles !== false,  // fluido de partículas com física; desligado = o líquido simplificado, por shader
    orbGrain: o.orbGrain === 'fx' ? 'fx' : 'real',
    orbQuality: ['gpu', 'cpu', 'leve'].includes(o.orbQuality) ? o.orbQuality : 'auto',  // onde se simulam os grãos: automática (a GPU se der), placa gráfica, processador, leve  // o aspeto das partículas: grãos com luz própria (realista) ou formas e brilhos (o de antes)
    orbScale: Number.isFinite(o.orbScale) ? Math.max(0.8, Math.min(1.6, o.orbScale)) : 1 }  // tamanho das esferas da vida (80–160 %)
}
export const setFpPrefs = v => { try { const o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}'); localStorage.setItem('grimorio.fp.prefs', JSON.stringify({ ...o, ...v })) } catch { /* sem armazenamento */ } }
