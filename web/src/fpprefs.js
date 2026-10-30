// Definições › Mesa (Forge Play): teclas, jogo mais solto (pagar sozinho, deixar resolver o que é teu), arrumação do teu
// lado (grelha, livre ou filas), perspetiva do lado do adversário (inclinação em graus), para onde estão viradas as cartas
// dos adversários. Tudo só no teu ecrã.
// Tamanho das cartas na mesa, em píxeis (Definições › Mesa e a barra das réplicas). Com um tamanho escolhido, criaturas,
// terrenos e as outras permanentes ficam todas com ele (no automático os terrenos são mais pequenos para caber tudo);
// quando não cabem numa fila, encostam-se e empilham-se (useOverlap, groups) em vez de saírem do lado do jogador.
export const CARD_PX = [0, 48, 56, 64, 72, 80, 96, 112, 128]
// --pk: no Forge Play e na mesa livre (mesa de tamanho fixo) o useOverlap encolhe um pouco se as filas não cabem na altura
export const cardVars = px => (px ? { '--px': `calc(${px}px * var(--pk, 1))`, '--cw': `calc(${px}px * var(--pk, 1))`, '--ow': `calc(${px}px * var(--pk, 1))`, '--lw': `calc(${px}px * var(--pk, 1))` } : null)
export const fpPrefs = () => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}') } catch { /* sem armazenamento */ }
  return { space: o.space !== false, flip: o.flip || 'f', tap: o.tap || 't',
    autopay: o.autopay === true, autoresolve: o.autoresolve !== false,  // pagar sozinho: desligado por omissão
    place: ['grid', 'free', 'rows'].includes(o.place) ? o.place : 'grid', persp: o.persp !== false, tilt: Number.isFinite(o.tilt) ? o.tilt : 30,
    oppFace: o.oppFace === 'far' ? 'far' : 'me',  // cartas dos adversários: viradas para mim (legíveis) ou para eles (180°, como numa mesa a sério)
    cardPx: CARD_PX.includes(o.cardPx) ? o.cardPx : 0 }  // tamanho das cartas na mesa (0 = automático)
}
export const setFpPrefs = v => { try { const o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}'); localStorage.setItem('grimorio.fp.prefs', JSON.stringify({ ...o, ...v })) } catch { /* sem armazenamento */ } }
