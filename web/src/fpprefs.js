// Definições › Mesa (Forge Play): teclas, jogo mais solto (pagar sozinho, deixar resolver o que é teu), arrumação do teu
// lado (grelha, livre ou filas), perspetiva do lado do adversário (inclinação em graus), para onde estão viradas as cartas
// dos adversários. Tudo só no teu ecrã.
export const fpPrefs = () => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}') } catch { /* sem armazenamento */ }
  return { space: o.space !== false, flip: o.flip || 'f', tap: o.tap || 't', autopay: o.autopay === true,  // pagar sozinho: desligado por omissão autoresolve: o.autoresolve !== false,
    place: ['grid', 'free', 'rows'].includes(o.place) ? o.place : 'grid', persp: o.persp !== false, tilt: Number.isFinite(o.tilt) ? o.tilt : 30,
    oppFace: o.oppFace === 'far' ? 'far' : 'me' }  // cartas dos adversários: viradas para mim (legíveis) ou para eles (180°, como numa mesa a sério)
}
export const setFpPrefs = v => { try { const o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}'); localStorage.setItem('grimorio.fp.prefs', JSON.stringify({ ...o, ...v })) } catch { /* sem armazenamento */ } }
