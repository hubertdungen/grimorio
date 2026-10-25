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
