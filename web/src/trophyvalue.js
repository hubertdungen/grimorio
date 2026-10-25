// Valor dos troféus (galeria, Biblioteca «troféus», pontos de cada deck). Funções puras: o auto-teste importa-as.
// Valor de um troféu = pontos do lugar × peso do tipo de torneio (mais jogos e mais difícil de ganhar = mais), a metade
// se for azul (casual ou não ranked). Ordena a galeria e a Biblioteca («troféus»); a tabela aparece na galeria.
export const TIER_PTS = { plat: 1000, safira: 300, rubi: 150, 1: 100, 2: 40, 3: 15 }
export const KIND_W = { grupos: 1.3, dupla: 1.25, suico: 1.2, liga: 1.15, elim: 1, mesas: 1, equipas: 0.9, rei: 0.8, gauntlet: 0.7 }
export const BLUE_W = 0.5
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
// jogadores: √(decks ÷ 8), entre ×0,6 e ×1,6 — mais decks, mais difícil de ganhar
export const playersW = n => (n ? clamp(Math.sqrt(n / 8), 0.6, 1.6) : 1)
// duração, só onde as rondas se escolhem (rei da colina, suíço, mesas): partidas jogadas ÷ as típicas para esse tamanho,
// √ e entre ×0,5 e ×1,5 (um rei da colina de 3 partidas não vale um de 30); nos outros tipos o tamanho já diz tudo
const TYPICAL = { rei: n => 2 * (n - 1), suico: n => Math.ceil(Math.log2(n)) * Math.floor(n / 2), mesas: n => 3 * Math.ceil(n / 4) }
export const lengthW = (kind, n, m) => (TYPICAL[kind] && n > 1 && m ? clamp(Math.sqrt(m / TYPICAL[kind](n)), 0.5, 1.5) : 1)
export const trophyValue = ({ tier, kind, casual, n, m }) => Math.round((TIER_PTS[tier] || 0) * (KIND_W[kind] ?? 1) * playersW(n) * lengthW(kind, n, m) * (casual ? BLUE_W : 1))

// Troféus de um deck (os de /api/tournaments/trophies): o lugar de cada um e a soma dos que ainda contam (valid)
export const trophyTier = x => (x.platinum ? 'plat' : x.champions ? { 1: 'plat', 2: 'safira', 3: 'rubi' }[x.place] : x.place)
export const itemValue = x => trophyValue({ tier: trophyTier(x), kind: x.type, casual: x.casual, n: x.n, m: x.m })
export const deckPoints = list => (list || []).filter(x => x.valid !== false).reduce((t, x) => t + itemValue(x), 0)
// Estrelas brancas (0–6) a partir dos pontos de troféus, em escala logarítmica: os primeiros troféus sobem depressa e as
// 6★ ficam para coleções enormes (STAR_MAX pontos)
export const STAR_MAX = 3000
const LOG = Math.log10(1 + STAR_MAX / 20)
export const trophyStars = p => (p > 0 ? Math.min(6, Math.round(((6 * Math.log10(1 + p / 20)) / LOG) * 10) / 10) : 0)
export const starPoints = k => Math.round(20 * (10 ** ((k / 6) * LOG) - 1))  // pontos para k estrelas (tabela)
// a divisão: pontos dos troféus normais (ranked) e dos azuis (casual ou não ranked)
export const deckSplit = list => (list || []).filter(x => x.valid !== false).reduce((o, x) => { o[x.casual ? 'blue' : 'normal'] += itemValue(x); return o }, { normal: 0, blue: 0 })
