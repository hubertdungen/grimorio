// O estado do Forge (GrimorioNet) -> o tabuleiro do Grimório (Board.jsx): usado pelo Forge Play e pelas réplicas dos
// jogos jogados por pessoas (as fotografias do estado guardadas pelo playnet)
const CTR = { P1P1: '+1/+1', M1M1: '-1/-1' }
export const ctrs = o => Object.fromEntries(Object.entries(o || {}).map(([k, n]) => [CTR[k] || (/^[+-]/.test(k) ? k : String(k).toLowerCase()), n]))
export function toPerm(c, combat) {
  const counters = ctrs(c.counters)
  if (c.loyalty != null && counters.loyalty == null) counters.loyalty = +c.loyalty || 0  // o marcador «Loyalty» do Forge manda; «loyalty» da carta vem em texto («4»)
  const plus = (counters['+1/+1'] || 0) - (counters['-1/-1'] || 0)  // o Forge já soma os marcadores ao P/R; o tabuleiro volta a somá-los
  const at = combat?.find(x => x.att === c.id)
  return {
    key: String(c.id), name: c.name || '', hidden: !!c.hidden, tapped: !!c.tapped, sick: !!c.sick, token: !!c.token, flipped: !!c.flipped, col: c.col,  // col: as cores da ficha (escolher a imagem certa)
    land: !!c.land, crewed: !!c.creature, notCre: !c.creature && !c.hidden && !c.faceDown, attachedTo: c.attachedTo != null ? String(c.attachedTo) : undefined, sel: !!c.sel, damage: c.dmg || 0, counters,
    pt: c.pt ? `${c.pt[0] - plus}/${c.pt[1] - plus}` : undefined, faceDown: !!c.faceDown, phased: !!c.phased, goaded: !!c.goad, copy: !!c.copy, merged: c.merged,
    attacking: at ? 'x' : undefined, atkName: at?.defc, atkKey: at?.defc ? String(at.def) : undefined, pw: c.pw, prot: c.prot, blocking: (b => (b ? String(b.att) : undefined))(combat?.find(x => x.blockers?.includes(c.id))),  // a chave do atacante: o par (⚔ n / 🛡 n) e a linha
  }
}
export function zoneOf(p, combat) {
  const { poison = 0, energy = 0, ...pctr } = ctrs(p.counters), cz = p.command || []
  return {
    life: p.life, library: p.library, libTop: p.top || null, hand: p.hand?.length || 0, known: [], graveyard: (p.graveyard || []).map(c => c.name), exile: (p.exile || []).map(c => c.name),
    // comandantes: o imposto (vezes lançado) e o dano de comandante vêm do Forge (cmdrs/cdmg); fora da zona de comando = .out
    command: [...cz.filter(c => !c.emblem).map(c => ({ name: c.name, room: c.room, casts: p.cmdrs?.find(x => x.id === c.id)?.casts || 0 })),
      ...(p.cmdrs || []).filter(x => !cz.some(c => c.id === x.id)).map(x => ({ name: x.name, casts: x.casts || 0, out: true }))], cmdDmg: p.cdmg || {}, poison, energy, pctr, emblems: cz.filter(c => c.emblem).map(c => c.name),
    monarch: !!p.monarch, initiative: !!p.initiative, blessing: !!p.blessing, speed: p.speed || 0, out: false, perms: (p.battlefield || []).map(c => toPerm(c, combat)),
  }
}

// uma fotografia do estado do Forge -> um estado do tabuleiro (a = quem jogava neste ecrã, b = o outro)
export function snapBoard(st, i = 0) {
  const ps = st?.players || [], me = ps.find(p => p.me) || ps[0] || {}, opp = ps.find(p => p !== me) || {}
  return { i, turn: st?.turn || 0, phase: st?.phase || null, first: null, sides: ['a', 'b'], a: zoneOf(me, st?.combat), b: zoneOf(opp, st?.combat),
    active: st?.active == null ? null : st.active === me.id ? 'a' : 'b', stack: [], seq: i, last: null, fx: null, over: null, exact: true }
}

// uma fotografia da mesa livre (freetable._snap) -> um estado do tabuleiro: o lugar i é o lado 'abcd'[i]
const SK = 'abcd'
export function ftBoard(st, i = 0) {
  const seats = st?.seats || [], sides = seats.map((_, k) => SK[k])
  const zone = p => ({
    life: p.life, library: p.lib || 0, libTop: null, hand: p.hand || 0, known: [], graveyard: p.gy || [], exile: p.ex || [], command: [], cmdDmg: {}, poison: p.psn || 0, energy: 0, pctr: {},
    emblems: [], out: !!p.out, perms: (p.bf || []).map(c => ({
      key: String(c.id), name: c.n || '', hidden: c.n == null, faceDown: c.n == null, tapped: !!c.t, token: !!c.tok, counters: c.k || {}, damage: 0,
      attachedTo: c.at != null ? String(c.at) : undefined, attacking: c.atk != null ? SK[c.atk] : undefined, blocking: c.blk != null ? String(c.blk) : undefined,
    })),
  })
  return { i, turn: st?.turn || 0, phase: null, first: null, sides, ...Object.fromEntries(seats.map((p, k) => [SK[k], zone(p)])),
    active: st?.active == null ? null : SK[st.active], stack: [], seq: i, last: null, fx: null, over: null, exact: true }
}

// o passo de uma fotografia da mesa livre ([turno, quem, tipo, carta]) -> texto traduzido
const FT_K = { attach: 'anexa', attack: 'ataca', block: 'bloqueia', cast: 'lança', cmdmg: 'dano de comandante', concede: 'desiste', day: 'dia/noite', dice: 'dados', draw: 'compra', face: 'vira a carta', flip: 'transforma', gf: 'vida', life: 'vida', lookhand: 'vê a mão', mark: 'marca', move: 'mexe', mulligan: 'mulligan', newturn: 'novo turno', pass: 'passa a vez', phase: 'fase', resolve: 'resolve', result: 'fim do jogo', reveal: 'revela', revealhand: 'revela a mão', revealtop: 'revela o topo', search: 'procura no grimório', showlib: 'mostra o grimório', shuffle: 'baralha', side: 'sideboard', token: 'ficha', untapall: 'desvira tudo', tap: 'vira', counter: 'marcador', mill: 'moe', poison: 'veneno' }
export const ftTxt = (ev, tx) => { const [t, who, k, n] = ev || []; return [`T${t}`, who, FT_K[k] ? tx(FT_K[k]) : '', n].filter(Boolean).join(' · ') }
