// Pesquisa por intenção «contra X»: «sideboard para mill», «anti encantamentos», «graveyard hate», «gegen Planeswalker»,
// «反附魔». parseThreats lê a frase (pt, en, es, de, zh) e diz que ameaças percebeu; hateMatch diz se uma carta responde a
// uma ameaça, com que força (as respostas diretas e com alvo primeiro, as largas depois) e porquê. Tudo regras sobre o
// texto das cartas, no browser.
import { tx } from './i18n.js'

// texto sem lembretes, em minúsculas (calculado uma vez por carta)
const ot = c => (c._ho ??= (c.o || '').replace(/\([^)]*\)/g, '').toLowerCase())
const kw = (c, k) => (c.kw || []).includes(k)
const isCreature = c => /Creature/.test((c.t || '').split(' // ')[0])
const tough = c => parseInt(String(c.pt || '').split('/')[1]) || 0
const W = String.raw`(?:[\w+/-]+(?:,| or| and|, or|, and)? ){0,4}`  // «target artifact, enchantment, or planeswalker»
const NOTYOU = String.raw`(?![^.]*\byou control\b)(?!(?:[\w-]+ )?cards?\b)`  // os teus não contam; «target enchantment card» (cemitério) também não
const BLINK = String.raw`(?![^.]*\breturn (?:it|that card|them|those cards)\b)`  // «exile target creature, then return it»: blink, não resposta
const kill = x => new RegExp(String.raw`(?:destroy|exile) (?:up to (?:one|two|three|x|\w+) )?(?:another )?target ${NOTYOU}${BLINK}${W}${x}\b`)
const killAll = x => new RegExp(String.raw`(?:destroy|exile) (?:all|each) ${W}${x}(?! you control)\b`)
const counterOf = x => new RegExp(String.raw`counter target ${W}(?:${x}) spells?`)
const bounce = x => new RegExp(String.raw`return (?:up to \w+ )?target ${NOTYOU}${W}(?:${x}) to (?:its|their) owners?'?s?'? hands?`)
const edictOf = x => new RegExp(String.raw`(?:target player|target opponent|each opponent|each player|that player) sacrifices (?:an?|one|two|x) ${W}${x}`)

// regras partilhadas
const R = {
  anyPerm: [6, tx('remove uma permanente'), kill(String.raw`(?:non[\w-]+ |nonland, nontoken )*permanent`)],
  bouncePerm: [4, tx('devolve à mão'), bounce(String.raw`(?:nonland |noncreature )?permanent`)],
  counterAny: [3, tx('anula qualquer feitiço'), /counter target spell\b/],
  wrath: [10, tx('destrói todas as criaturas'), /(?:destroy|exile) (?:all|each) (?:other )?(?:non-?[\w]+ )?(?:creatures|nonland permanents|creature)\b(?! you control| cards?\b| blocked| exiled| dealt| with flying)|each player sacrifices all creatures|return all (?:nonland permanents|creatures) to their owners'? hands/],
  sweep: [10, tx('dano a cada criatura'), /damage to each (?:other )?(?:non-?\w+ )?creature(?: and each (?:player|planeswalker))?(?!s? (?:blocking|blocked|that|it|with flying|you control|target|dealt))\b|damage to each creature (?:your opponents control|you don't control)/],
  shrink: [9, tx('-X/-X a todas as criaturas'), /(?:all|each) (?:other )?(?:non-?\w+ )?creatures?(?: your opponents control| you don't control)? gets? -(?:\d+|x)\/-(?:\d+|x)|creatures your opponents control get -(?:\d+|x)\/-(?:\d+|x)/],
  lifeBig: [7, tx('ganha muita vida'), /you gain (?:[3-9]|\d\d+|x) life|gain life equal to/],
  lifelink: [4, tx('vínculo com a vida'), c => isCreature(c) && kw(c, 'Lifelink')],
  youHexproof: [8, tx('ficas com resistência a magia'), /you have (?:hexproof|shroud|protection)/],
  discardOpp: [7, tx('descarte do adversário'), /target (?:player|opponent) reveals (?:their|his or her) hand[^.]*\.[^.]*(?:discards|exiles?)|(?:target (?:player|opponent)|each opponent) discards (?:a|two|three|x|that many) (?:non\w+ )?cards?|target (?:player|opponent) reveals (?:their|his or her) hand\. you choose/],
}
const sweepers = w => [R.wrath, R.sweep, R.shrink].map(([, why, re]) => [w, why, re])
const perm = (x, why) => [
  [10, why[0], kill(`${x}s?`)],
  [8, why[1], killAll(`${x}s`)],
  R.anyPerm,
  [5, why[2], counterOf(`${x}|noncreature|permanent|nonland`)],
  [4, why[3], bounce(`${x}s?|nonland permanent|permanent`)],
  [4, why[4], edictOf(`${x}s?`)],
  R.counterAny,
]

// ameaça: [nome, regras [peso, porquê, RegExp | (carta, texto) => bool]]
export const THREATS = {
  enchantment: { label: tx('encantamentos'), rules: perm('enchantment', [tx('destrói ou exila encantamentos'), tx('destrói todos os encantamentos'),
    tx('anula feitiços de encantamento'), tx('devolve encantamentos à mão'), tx('obriga a sacrificar um encantamento')]) },
  artifact: { label: tx('artefactos'), rules: [...perm('artifact', [tx('destrói ou exila artefactos'), tx('destrói todos os artefactos'),
    tx('anula feitiços de artefacto'), tx('devolve artefactos à mão'), tx('obriga a sacrificar um artefacto')]),
    [7, tx('trava os artefactos'), /activated abilities of artifacts[^.]*can't be activated|artifacts? (?:your opponents control )?(?:don't|can't) untap|artifacts? (?:have no|lose all) abilities|artifact spells (?:your opponents cast )?cost/],
    [7, tx('devolve os artefactos à mão'), /return all artifacts/]] },
  planeswalker: { label: tx('planeswalkers'), rules: [
    [10, tx('destrói ou exila planeswalkers'), kill('planeswalkers?')],
    [9, tx('dano a planeswalkers'), /damage to (?:target|each|up to \w+ target|any number of target) (?:[\w-]+(?:,| or| and)? ){0,3}planeswalkers?\b/],
    [8, tx('dano a qualquer alvo'), /damage to any target|damage divided as you choose among (?:one, two, or three|any number of) targets/],
    [8, tx('destrói todos os planeswalkers'), killAll('planeswalkers')],
    R.anyPerm,
    [5, tx('anula feitiços de planeswalker'), counterOf('planeswalker|noncreature|permanent|nonland')],
    [4, tx('tira marcadores de lealdade'), /remove (?:all|x|\w+) loyalty counters|loyalty abilities[^.]*can't be activated/],
    R.bouncePerm, R.counterAny] },
  graveyard: { label: tx('cemitério'), rules: [
    [10, tx('exila cemitérios'), /exile (?:all|each|target player's|target opponent's|each opponent's|that player's|an opponent's) graveyards?|exile all cards from (?:all |each |target player's |target opponent's |each opponent's |that player's |an opponent's )?graveyards?|exiles? all cards from (?:their|his or her) graveyard|exile (?:all|each) [\w-]* ?cards? (?:from|in) (?:all|each|target player's|target opponent's|an opponent's|each opponent's|that player's) graveyards?/],
    [10, tx('exila em vez de ir para o cemitério'), /\b(?:a card|a card or token|cards|one or more cards|a nontoken [\w ]{1,30}|an? [\w]+ card)(?: [^.]{0,40})? would be put into (?:a|an opponent's|any|your opponents'?) graveyards?(?: from anywhere)?[^.]*exile (?:it|that card|them) instead/],
    [9, tx('o cemitério deixa de funcionar'), /cards in graveyards (?:can't|lose)|can't (?:cast|play) [^.]{0,40}from (?:graveyards|their graveyards|a graveyard)|cards? in graveyards and libraries can't enter|cards in (?:your )?opponents'? graveyards (?:can't|lose)/],
    [7, tx('exila o que morre'), /(?:an opponent controls|your opponents control) would die, exile/],
    [5, tx('exila cartas de um cemitério'), /exile (?:up to (?:one|two|three|four|x|\w+) )?(?:another )?target (?:[\w-]+ )?cards? from (?:a|an opponent's|target player's|any|that player's) graveyards?|exile (?:up to \w+ )?target cards? from graveyards/]] },
  mill: { label: tx('moer (mill)'), rules: [
    [10, tx('baralha o cemitério no grimório'), /shuffles? (?:[\w ]{0,20} and )?(?:your|their|his or her|its owner's|target player's)? ?graveyard(?: and [^.]{0,30})? into (?:your|their|his or her|its owner's|their owner's|that player's) library/],
    [8, tx('devolve cartas do cemitério ao grimório'), /shuffles? (?:up to \w+ |any number of )?(?:target )?cards? from (?:your|their|his or her) graveyard into (?:your|their|his or her) library|put (?:up to \w+ |any number of )?(?:target )?cards? from (?:your|their) graveyard (?:on (?:the )?(?:top|bottom) of|into) (?:your|their) library/],
    [6, tx('não perdes o jogo'), /you can't lose the game|you don't lose the game for drawing/]] },
  tokens: { label: tx('fichas (go-wide)'), rules: [...sweepers(10),
    [7, tx('trava as fichas'), /(?:creature )?tokens? (?:your opponents control )?(?:can't|don't|get -)|if one or more tokens would be created under an opponent's control|(?:destroy|exile) (?:all|each) [\w-]* ?tokens/]] },
  flyers: { label: tx('voadores'), rules: [
    [10, tx('remove voadores'), /target (?:attacking |tapped |blocking )?creatures? with flying/],
    [10, tx('dano aos voadores'), /damage to each (?:attacking )?creature with flying|(?:destroy|exile) all creatures with flying|creatures? with flying (?:your opponents control )?gets? -|creatures with flying (?:can't|don't)/],
    [6, tx('tem alcance'), c => isCreature(c) && kw(c, 'Reach')],
    [5, tx('tira o voar'), /(?:lose|loses) flying/],
    [4, tx('bloqueia voadores'), /can block [^.]*flying|as though it had reach/]] },
  combo: { label: tx('combo'), rules: [
    [10, tx('trava feitiços e habilidades'), /can't cast more than one|(?:each player|players|your opponents|each opponent) can't cast (?:spells|noncreature|instant|sorcery|more than)|(?:players|your opponents|each opponent) can't (?:search|activate|draw more than)|abilities[^.]* can't be activated|spells (?:your opponents cast |cast by your opponents )?cost \{?\d+\}? more|costs \{1\} more to cast for each other spell/],
    [9, tx('anula feitiços e habilidades'), /counter (?:up to \w+ )?target (?:[\w-]+(?:,| or| and)? ){0,3}(?:spell|ability|abilities)\b|exile (?:any number of |up to \w+ )?target spells?/],
    [7, ...R.discardOpp.slice(1)],
    [6, tx('exila cemitérios'), /exile (?:all|each|target player's) graveyards?|exile all cards from target player's graveyard/]] },
  control: { label: tx('controlo e contra-feitiços'), rules: [
    [10, tx('não pode ser anulado'), /can't be countered|uncounterable/],
    [8, tx('fração de segundo'), c => kw(c, 'Split second')],
    [7, tx('resistência a magia'), c => kw(c, 'Hexproof') || kw(c, 'Ward') || /(?:has|have|gains?|gain) hexproof/.test(ot(c))],
    [6, tx('pune quem anula'), /whenever a spell or ability an opponent controls counters|when(?:ever)? [^.]{0,40} is countered/],
    [5, tx('ameaça com lampejo'), c => isCreature(c) && kw(c, 'Flash')],
    [4, ...R.discardOpp.slice(1)]] },
  aggro: { label: tx('aggro'), rules: [...sweepers(9), R.lifeBig,
    [6, tx('remoção barata'), c => c.cmc <= 2 && (c.tg || []).includes('removal')],
    [5, tx('previne o dano de combate'), /prevent all combat damage/],
    [5, tx('bloqueador resistente'), c => isCreature(c) && c.cmc <= 3 && (tough(c) >= 4 || kw(c, 'Defender') && tough(c) >= 3)],
    R.lifelink] },
  burn: { label: tx('dano direto (burn)'), rules: [
    [10, tx('previne o dano'), /prevent [^.]{0,40}damage[^.]{0,60}(?:to you|you would)|damage that would be dealt to you|would deal damage to you/],
    R.youHexproof, R.lifeBig,
    [6, tx('proteção contra vermelho'), /protection from red|hexproof from (?:red|each color)/],
    [5, tx('anula instantâneos'), counterOf('instant|noncreature|red|instant or sorcery')],
    R.lifelink] },
  discard: { label: tx('descarte'), rules: [
    [10, tx('castiga o descarte'), /(?:a|if a) spell or ability an opponent controls causes you to discard/],
    [8, ...R.youHexproof.slice(1)],
    [5, tx('aproveita o descarte'), c => kw(c, 'Madness') || /whenever you discard/.test(ot(c))]] },
  lifegain: { label: tx('ganho de vida'), rules: [
    [10, tx('impede ganhar vida'), /can't gain life|gains? no life/],
    [9, tx('a vida ganha passa a perda'), /would gain life[^.]*(?:instead|loses)|life totals? can't (?:change|increase)/]] },
  ramp: { label: tx('ramp e terrenos especiais'), rules: [
    [10, tx('destrói terrenos'), /(?:destroy|exile) (?:up to \w+ )?target (?:nonbasic )?lands?\b(?![^.]*you control)|destroy all (?:nonbasic )?lands|(?:each player|target player|each opponent) sacrifices (?:a|two|x|one) lands?/],
    [9, tx('trava os terrenos'), /nonbasic lands (?:are|don't|can't|enter)|lands (?:your opponents control )?(?:don't untap|enter tapped)/],
    [8, tx('impede procurar no grimório'), /(?:players|your opponents|each opponent) can't (?:search|play more than one land)|can't play more than one land|if an opponent would search a library/],
    [5, tx('pune terrenos e buscas'), /whenever (?:an opponent|a player) (?:plays a land|taps a land|searches)/]] },
  hexproof: { label: tx('resistência a magia (hexproof)'), rules: [
    [10, tx('obriga a sacrificar'), edictOf('(?:attacking )?(?:creature|permanent)s?')],
    ...sweepers(8),
    [7, tx('tira a resistência a magia'), /loses? hexproof|can't have or gain hexproof|lose all abilities/]] },
}

// regras que anulam feitiços (para «counterspell for enchantments»: só essas)
const isCtr = re => re instanceof RegExp && re.source.startsWith('counter ')
/** A carta responde à ameaça? {s, why} (s: força, para ordenar) ou null. ctr: só as maneiras de anular. */
export function hateMatch(c, t, ctr = false) {
  const memo = (c._hm ||= {}), key = ctr ? `${t}!` : t
  if (key in memo) return memo[key]
  const o = ot(c)
  let best = null, n = 0
  for (const [w, why, re] of THREATS[t]?.rules || []) {
    if (ctr && !isCtr(re)) continue
    if (typeof re === 'function' ? re(c, o) : re.test(o)) { n++; if (!best || w > best[0]) best = [w, why] }
  }
  // a mais: várias maneiras de responder; a menos: cara de mais para o sideboard
  return (memo[key] = best && { s: best[0] + (n > 1 ? 1 : 0) - (c.cmc >= 6 ? 2 : c.cmc >= 4 ? 1 : 0), why: best[1] })
}
export const hateScore = (c, vs, ctr) => vs.reduce((a, t) => a + (hateMatch(c, t, ctr)?.s || 0), 0)

// --- as palavras: ameaça → maneiras de a dizer (sem acentos, minúsculas; singular e plural) ---
const VOCAB = {
  enchantment: ['encantamentos', 'encantamento', 'enchantments', 'enchantment', 'encantamientos', 'encantamiento', 'verzauberungen', 'verzauberung', 'auras', 'aura', 'auren'],
  artifact: ['artefactos', 'artefacto', 'artefatos', 'artefato', 'artifacts', 'artifact', 'artefakten', 'artefakte', 'artefakt', 'equipamentos', 'equipment', 'equipos'],
  planeswalker: ['planeswalkers', 'planeswalkern', 'planeswalker', 'walkers', 'caminhantes de planos', 'caminantes de planos', 'pws'],
  graveyard: ['cemiterios', 'cemiterio', 'graveyards', 'graveyard', 'cementerios', 'cementerio', 'friedhofe', 'friedhofs', 'friedhof', 'reanimator', 'reanimacao', 'reanimacion', 'reanimation', 'dredge', 'recursao', 'recursion'],
  mill: ['mill', 'milling', 'moer', 'moagem', 'moler', 'molienda', 'mahlen'],
  tokens: ['tokens', 'token', 'fichas', 'ficha', 'spielsteine', 'spielstein', 'go wide', 'go-wide', 'enxames', 'swarm', 'criaturas pequenas', 'small creatures', 'kleine kreaturen'],
  flyers: ['criaturas voadoras', 'criaturas com voar', 'criaturas que voam', 'voadores', 'voadoras', 'flying creatures', 'flyers', 'fliers', 'flying', 'voar', 'criaturas voladoras', 'criaturas con volar', 'voladores', 'fliegende kreaturen', 'flieger', 'fliegende', 'flugfahigkeit'],
  combo: ['combos', 'combo', 'kombos', 'kombo', 'storm', 'tempestade', 'tormenta'],
  control: ['controlo', 'controle', 'control', 'kontrolle', 'counterspells', 'counterspell', 'contramagicas', 'contramagica', 'contra-feiticos', 'contrafeiticos', 'contrahechizos', 'kontermagie', 'konterzauber', 'permission'],
  aggro: ['aggro', 'agro', 'aggressive decks', 'agressivos', 'agresivos', 'aggressive', 'aggressiv', 'aggressive decks', 'decks rapidos', 'mazos rapidos'],
  burn: ['burn', 'dano direto', 'dano directo', 'direct damage', 'queima', 'quema', 'direktschaden', 'brand'],
  discard: ['descarte', 'discard', 'abwerfen', 'ablegen', 'hand disruption'],
  lifegain: ['ganho de vida', 'ganhar vida', 'lifegain', 'life gain', 'ganancia de vida', 'ganar vida', 'lebensgewinn', 'lifelink'],
  ramp: ['ramp', 'rampa', 'aceleracao de mana', 'aceleracion de mana', 'beschleunigung', 'terrenos nao basicos', 'nonbasic lands', 'nonbasics', 'tierras no basicas', 'nichtstandardlander'],
  hexproof: ['hexproof', 'resistencia a magia', 'antimaleficio', 'fluchsicher', 'voltron'],
}
const ZH_VOCAB = [['附魔', 'enchantment'], ['结界', 'enchantment'], ['神器', 'artifact'], ['鹏洛客', 'planeswalker'], ['旅法师', 'planeswalker'], ['坟墓场', 'graveyard'], ['坟场', 'graveyard'],
  ['墓地', 'graveyard'], ['磨牌', 'mill'], ['衍生物', 'tokens'], ['铺场', 'tokens'], ['飞行生物', 'flyers'], ['飞行', 'flyers'], ['组合技', 'combo'], ['康波', 'combo'], ['风暴', 'combo'],
  ['反击咒语', 'control'], ['反制咒语', 'control'], ['控制', 'control'], ['快攻', 'aggro'], ['速攻', 'aggro'], ['直伤', 'burn'], ['烧牌', 'burn'], ['弃牌', 'discard'], ['获得生命', 'lifegain'],
  ['回血', 'lifegain'], ['加速', 'ramp'], ['辟邪', 'hexproof']]
const WORD = new Map(Object.entries(VOCAB).flatMap(([t, ws]) => ws.map(w => [w, t])))
const alt = ws => ws.map(w => w.replace(/[-+/]/g, c => `\\${c}`)).join('|')
const TW = `(${alt([...WORD.keys()].sort((a, b) => b.length - a.length))})`
const FILL = String.raw`(?:(?:o|a|os|as|ao|aos|el|la|los|las|al|die|der|den|dem|the|um|uma|de|do|da|dos|das|del|um|decks?|baralhos?|mazos?|estrategias?|strategies|strategy|cartas?|cards?|spielen)\s+){0,3}`
// antes da ameaça: «sideboard para», «anti», «resposta a», «bom contra», «ódio a», «remoção de», «answers to», «good against»…
const PRE = String.raw`(?:sideboard|side|banquillo)(?:\s+(?:para|contra|vs|versus|against|for|gegen|fur|de))?|respostas?(?:\s+(?:a|ao|aos|as|para|contra))?|answers?\s+(?:to|for|against)|counters?\s+(?:to|for|against)|respuestas?\s+(?:a|al|para|contra)|antworten?\s+(?:auf|gegen|fur)|bo[ma]s?\s+contra|buen[oa]s?\s+contra|(?:good|great|best)\s+(?:against|vs|versus)|(?:gut|stark)\s+gegen|odio\s+(?:a|ao|aos|as|al|de|contra)|hate\s+(?:de|a|ao|para|contra|for|against|on|vs)|hass\s+(?:auf|gegen)|remocao\s+(?:de|para)|removal\s+(?:for|of|against)|eliminacion\s+de|entfernung\s+(?:von|fur)|destruir|destroy|zerstoren|exilar|protecao\s+contra|proteccion\s+contra|protection\s+against|schutz\s+(?:gegen|vor)|para\s+(?:parar|travar|segurar|bater|vencer|frenar|ganar\s+a)|to\s+(?:beat|stop|fight|hose)|beats|hosers?\s+(?:for|against)|contra|vs|versus|against|gegen`
const POST = String.raw`hate|hosers?|removal|answers?|sideboard|side|killers?|hass|entfernung`
const PRE_RE = new RegExp(String.raw`(?:^|\s)(?:(?:${PRE})\s+|anti-?\s*)${FILL}${TW}(?=\s|$)`)
const POST_RE = new RegExp(String.raw`(?:^|\s)${TW}\s+(?:${POST})(?=\s|$)`)
const GLUE_RE = new RegExp(String.raw`(?:^|\s)${TW}s?(?:hass|schutz|entfernung|abwehr)(?=\s|$)`)  // «Friedhofsschutz», «Artefaktentfernung»
const NEXT_RE = new RegExp(String.raw`^\s*(?:e|y|and|und|ou|o|or|oder)?\s*${FILL}${TW}(?=\s|$)`)
// «counterspell for enchantments»: contra-feitiços que apanham esse tipo de feitiço (a palavra fica para a função Contra-feitiço)
const CTR_RE = new RegExp(String.raw`(?:^|\s)(counterspells?|contra-?feiticos?|contramagicas?|contrahechizos?|konterzauber|kontermagie)\s+(?:for|against|vs|para|contra|de|gegen|fur)\s+${FILL}${TW}(?=\s|$)`)
const ZH_W = `(${ZH_VOCAB.map(x => x[0]).join('|')})`
const ZH_PRE_RE = new RegExp(`(?:备牌)?(?:反|对抗|克制|针对|应对|对付|防御|防|抗)${ZH_W}(?:的)?(?:备牌|仇恨|对策)?`)
const ZH_POST_RE = new RegExp(`${ZH_W}(?:仇恨|克制|杀手|对策|的备牌|备牌)`)
const ZH_MAP = new Map(ZH_VOCAB)
// «flying», «voar»: sozinhos (sem «contra») ficam para a habilidade

/** Lê as ameaças da frase (já sem acentos e em minúsculas, com espaços à volta). {s: o resto, vs: [ameaças], ctr, words: as palavras
 * das ameaças tal como vieram (para quem tira o «contra» e quer a frase sem ele: «anti encantamentos» → «encantamentos»)} ou null. */
export function parseThreats(s) {
  const vs = [], words = []
  const add = (t, w) => { if (!t) return; words.push(w); if (!vs.includes(t)) vs.push(t) }
  let m, guard = 0, ctr = false
  while ((m = s.match(CTR_RE)) && guard++ < 4) { add(WORD.get(m[2]), m[2]); s = s.replace(m[0], ` ${m[1]} `); ctr = true }
  for (const re of [PRE_RE, POST_RE, GLUE_RE]) {
    while ((m = s.match(re)) && guard++ < 12) {
      const w = m.slice(1).find(Boolean), i = m.index
      add(WORD.get(w), w)
      s = `${s.slice(0, i)} ${s.slice(i + m[0].length)}`
      // «contra artefactos e encantamentos», «anti tokens y voladores»: as ameaças logo a seguir também contam
      let k
      while ((k = s.slice(i).match(NEXT_RE)) && guard++ < 16) { add(WORD.get(k[1]), k[1]); s = `${s.slice(0, i)} ${s.slice(i + k[0].length)}` }
    }
  }
  for (const re of [ZH_PRE_RE, ZH_POST_RE]) while ((m = s.match(re)) && guard++ < 20) { add(ZH_MAP.get(m[1]), m[1]); s = s.replace(m[0], ' ') }
  return vs.length ? { s: ` ${s.trim()} `, vs, ctr, words } : null
}
