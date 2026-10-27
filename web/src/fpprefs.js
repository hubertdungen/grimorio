// Definições › Mesa (Forge Play): Espaço = Enter e a tecla que vira a carta debaixo do rato (só no teu ecrã)
export const fpPrefs = () => { let o = {}; try { o = JSON.parse(localStorage.getItem('grimorio.fp.prefs') || '{}') } catch { /* sem armazenamento */ } return { space: o.space !== false, flip: o.flip || 'f', tap: o.tap || 't' } }
