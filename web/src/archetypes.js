// Estratégias e arquétipos («control», «burn», «limpar a mesa», «aristocratas»…): vocabulário nas 5 línguas e o que
// conta numa carta para cada um. Cada sinal soma um peso: funções (c.tg, data.js/build_data.py), habilidades (c.kw),
// texto (re, sem lembretes) e tipo (ty); fn para o que não cabe aí (custo, poder, combos). ≥ 1 = a carta serve a estratégia.
// w: frases (pt/en/es/de); zh: bocados em chinês; of/kwOf: a função ou habilidade com o mesmo nome passa a ser
// a estratégia no «Gosto de…» («burn» = ♟ Burn, mais largo do que a função Dano direto).
import { tx } from './i18n.js'

const SPELL_PAY = /whenever you cast (an|a|your first|your second) (instant|sorcery|noncreature)|magecraft/
const SELF_FILL = /\bmills?\b|discard (a|two|three|x|any number of) cards?|surveil|cards? from the top of your library into your graveyard/
const EXTRA_LANDS = /play an additional land|you may play (two|three) additional lands|put (a|that|up to \w+)[^.]*land cards?[^.]* onto the battlefield/
const spell = c => /Instant|Sorcery/.test(c.t)
const pow = c => parseInt(c.pt) || 0

export const ARCH = {
  control: { l: tx('Controlo'), w: ['control', 'controlo', 'controle', 'controlar', 'controlar o jogo', 'controlar a mesa', 'deck de controlo', 'control deck', 'draw go', 'draw-go', 'kontrolle', 'kontrolldeck', 'kontrollieren'], zh: ['控制'],
    tg: { counter: 2, wipe: 2, removal: 1.5, draw: 1.2, bounce: 0.5, selection: 0.3 }, kw: { Flash: 0.3 } },
  burn: { l: tx('Burn (dano direto)'), of: 'burn', w: ['queimar', 'queima', 'quemar', 'quema', 'verbrennen', 'face damage', 'go face', 'red deck wins', 'rdw', 'dano a cara', 'dano aos adversarios', 'damage to players'], zh: ['火烧', '烧牌'],
    tg: { burn: 2, drain: 1.2 }, re: [[/deals? (\d+|x|that much) damage to (each opponent|each player|target player|target opponent|any target)/, 1]] },
  wipe: { l: tx('Limpar a mesa'), of: 'wipe', w: ['wipe everything', 'wipes', 'board wipes', 'boardwipe', 'wrath', 'wraths', 'sweeper', 'sweepers', 'mass removal', 'mass destruction', 'destruction', 'destroy everything', 'destroy all',
    'destruir tudo', 'limpar tudo', 'arrasar a mesa', 'limpeza da mesa', 'destruir todo', 'barrer la mesa', 'destruccion masiva', 'alles zerstoren', 'alles vernichten', 'brett leeren'], zh: ['全灭', '天谴'],
    tg: { wipe: 2.5 }, re: [[/all (other )?(creatures|nonland permanents|permanents) get -\d|destroy each (creature|nonland|permanent)|exile each (creature|nonland)|each player sacrifices (all|x|two|three|half)/, 2]] },
  removal: { l: tx('Remoção'), of: 'removal', w: ['destruicao', 'spot removal', 'kill spells', 'destruccion', 'eliminacion', 'zerstorung', 'entfernung'], zh: ['解场'],
    tg: { removal: 2, wipe: 1, bounce: 0.5, steal: 0.5 }, re: [[/(each|target) (opponent|player) sacrifices (a|an|two|that many)? ?(creature|attacking|nonland|permanent)/, 1.5]] },
  stax: { l: tx('Stax / prisão'), of: 'stax', w: ['prison', 'prisao', 'prision', 'gefangnis', 'impedir', 'lock', 'lockdown', 'tax', 'taxes', 'taxas', 'impostos', 'impuestos', 'steuern', "can't", 'hatebears', 'hate bears'], zh: ['锁场', '税'],
    tg: { stax: 2, hate: 0.8 }, re: [[/can't (cast|untap|activate|search|draw|play|be cast|attack unless)|(spells|abilities) (your opponents cast )?cost \{\d+\} more|don't untap|doesn't untap|skip (their|your) untap|players can't|your opponents can't|can't cast more than one|opponents control enter (the battlefield )?tapped/, 1.5]] },
  aggro: { l: tx('Aggro'), w: ['aggro', 'agressivo', 'agressiva', 'agresivo', 'agresiva', 'aggressive', 'aggressiv', 'beatdown', 'zoo', 'weenie', 'white weenie', 'sligh', 'atacar depressa', 'ataque rapido'], zh: ['快攻'],
    kw: { Haste: 0.8, Prowess: 0.3, 'Double strike': 0.3 }, tg: { pump: 0.5, burn: 0.6, ramp: -1 },
    fn: c => (c.mt === 'Creature' && c.cmc <= 2 && pow(c) >= Math.max(1, c.cmc) ? 1 + (c.cmc === 1 && pow(c) >= 2 ? 0.3 : 0) : 0) },
  tempo: { l: tx('Tempo'), w: ['tempo', 'flash deck', 'tempo deck'], zh: ['节奏'],
    kw: { Flash: 1, Ninjutsu: 1.2 }, tg: { bounce: 1.2 }, re: [[/tap target (creature|permanent)[^.]*(doesn't|don't) untap/, 1]],
    fn: c => (c.tg.includes('counter') && c.cmc <= 3 ? 0.8 : 0) + (c.mt === 'Creature' && c.cmc <= 2 && c.kw?.includes('Flying') ? 0.5 : 0) },
  midrange: { l: tx('Midrange'), w: ['midrange', 'mid range', 'meio termo', 'rango medio', 'mittelfeld'], zh: ['中速'],
    fn: c => (c.cmc < 2 || c.cmc > 4 ? 0 : c.mt === 'Creature' ? (['etb', 'draw', 'removal'].some(t => c.tg.includes(t)) ? 1.2 : pow(c) >= 3 ? 0.6 : 0) : c.tg.includes('removal') ? 0.8 : 0) },
  combo: { l: tx('Combo'), w: ['combo', 'combos', 'combinacao', 'combinacoes', 'combinacion', 'kombo', 'kombination', 'infinite', 'infinito', 'infinitos', 'combo infinito', 'unendlich'], zh: ['组合技', '无限'],
    tg: { tutor: 1.2, untap: 0.8 }, fn: c => (c.cx ? 1.5 : 0) },
  mill: { l: tx('Moer (mill)'), of: 'mill', w: ['milling', 'mill deck', 'turbo mill', 'moer o grimorio', 'moer o adversario', 'moler la biblioteca'], zh: [],
    tg: { mill: 2.5 }, re: [[/library has no cards|opponent's graveyard|cards in (each|target) (opponent's|player's) graveyard/, 0.5]] },
  discard: { l: tx('Descarte'), of: 'discard', w: ['hand disruption', 'disrupcao', 'disrupcion', 'mind rot', 'tirar cartas da mao', 'handzerstorung'], zh: [],
    tg: { discard: 0.3 }, re: [[/that player discards|(target|each) (player|opponent) discards|each opponent discards|(target|each) opponent reveals|whenever an opponent discards|look at target (player|opponent)'s hand/, 2]] },
  voltron: { l: tx('Voltron'), w: ['voltron', 'one big creature', 'uma criatura grande', 'equipment and auras', 'equipamentos e auras', 'equipamiento y auras', 'ausrustung und auren', 'commander damage', 'dano de comandante', 'dano do comandante'], zh: ['装备流'],
    ty: [[/Equipment/, 1.5]], tg: { protection: 0.8 }, kw: { 'Double strike': 0.6, Hexproof: 0.3, Shroud: 0.3 },
    re: [[/(equipped|enchanted) creature (gets|has)/, 1], [/for each (aura|equipment)|attached to|auras? (and|or) equipment|whenever an? (aura|equipment)|equip abilities/, 1]] },
  aristocrats: { l: tx('Aristocratas'), of: 'sacrifice', w: ['aristocrats', 'aristocratas', 'aristokraten', 'sacrifice deck', 'death triggers', 'morte e sacrificio', 'sacrificio e morte'], zh: ['贵族'],
    re: [[/sacrifice (a|another|an|x|any number of) [^:.]*:|, sacrifice (a|another) (creature|artifact|permanent)[^.]*:/, 1.5], [/whenever [^.]*(creature|creatures|permanent)[^.]*(dies|die|is put into a graveyard from the battlefield)/, 2]],
    tg: { drain: 0.8, sacrifice: 0.6, tokens: 0.3 } },
  tokens: { l: tx('Fichas (go wide)'), of: 'tokens', w: ['go wide', 'go-wide', 'token deck', 'swarm', 'enxame', 'muitas criaturas', 'muchas criaturas', 'viele kreaturen', 'breit gehen'], zh: ['铺场'],
    tg: { tokens: 1.5, pump: 0.5 }, kw: { Convoke: 0.6, Populate: 0.8 },
    re: [[/whenever (a|one or more)[^.]*tokens?[^.]*(enter|created)|tokens? you control (get|have)|for each (creature|artifact) you control|creatures you control get \+|populate|if an effect would create|one or more tokens/, 1.5]] },
  reanimator: { l: tx('Reanimator'), of: 'reanimate', w: ['reanimator', 'reanimation', 'necromancia', 'necromancy', 'wiederbeleben', 'reanimador'], zh: ['重生'],
    tg: { reanimate: 2.5, recursion: 0.5 }, re: [[/from a graveyard onto the battlefield under your control|creature cards? from (a|your|any) graveyard (onto|to) the battlefield/, 1.5], [/search your library for a card[^.]*put (it|that card) into your graveyard|discard (a|two|x) cards?|\bmills?\b/, 0.8]] },
  spellslinger: { l: tx('Instantâneos e feitiços'), of: 'spellslinger', w: ['spellslinger', 'spells matter', 'instants and sorceries', 'instantaneos e feiticos', 'instantaneos y conjuros', 'spontanzauber und hexereien', 'magias'], zh: ['法术流'],
    tg: { spellslinger: 1.5 }, kw: { Prowess: 1 }, re: [[SPELL_PAY, 2]], fn: c => (spell(c) ? 0.4 + (c.tg.includes('copy') ? 0.6 : 0) : 0) },
  lifegain: { l: tx('Ganho de vida'), of: 'lifegain', w: ['soul sisters', 'lifelink deck', 'vida a mais', 'muita vida'], zh: [],
    tg: { lifegain: 1.2 }, re: [[/whenever you gain life|if you would gain life|each time you gain life|life you gained|gained life this turn|you gain life for the first time/, 2]] },
  landfall: { l: 'Landfall', of: 'landfall', w: ['lands matter', 'terrenos importam', 'tierras importan', 'lander zahlen'], zh: [],
    tg: { landfall: 2, ramp: 0.3 }, re: [[EXTRA_LANDS, 1.5], [/return (target |a |up to \w+ )?land cards? from your graveyard|play lands from your graveyard/, 1]] },
  blink: { l: tx('Piscar (blink)'), of: 'blink', w: ['flickering', 'blinking', 'flackern', 'exilar e voltar'], zh: [],
    tg: { blink: 2.5 }, re: [[/exile (target|another|up to)[^.]*return (it|that card|them|those cards|the exiled card)[^.]* to the battlefield/, 2]], fn: c => (c.mt === 'Creature' && c.tg.includes('etb') ? 0.6 : 0) },
  counters: { l: tx('Marcadores +1/+1'), of: 'counters', w: ['+1/+1 deck', 'counters matter', 'marcadores +1/+1', 'contadores +1/+1'], zh: [],
    tg: { counters: 1.2 }, kw: { Evolve: 0.6, Outlast: 0.6, Mentor: 0.6, Adapt: 0.6, Bolster: 0.6, Backup: 0.6, Modular: 0.6, Graft: 0.6 },
    re: [[/proliferate|twice that many|additional \+1\/\+1 counter|for each \+1\/\+1 counter|with (a|one or more) \+1\/\+1 counters? on|counters? on a (creature|permanent) you control/, 1.5]] },
  superfriends: { l: tx('Superfriends (planeswalkers)'), w: ['superfriends', 'super friends', 'superamigos', 'planeswalkers matter', 'deck de planeswalkers', 'planeswalker deck', 'walkers', 'superfreunde'], zh: ['鹏洛客流'],
    ty: [[/Planeswalker/, 1.5]], re: [[/planeswalkers? you control|loyalty abilit|loyalty counters? on|proliferate|counters on a permanent you control/, 1.5]] },
  grouphug: { l: tx('Group hug'), w: ['group hug', 'grouphug', 'abraco de grupo', 'abrazo de grupo', 'gruppenumarmung', 'gruppenkuscheln', 'ajudar toda a mesa'], zh: ['群体拥抱'],
    re: [[/each player (may )?(draws?|puts?|adds?|creates?|gains?|searches|returns)|each (other player|opponent) (may )?(draws?|creates?|gains?|puts?)|target player (draws|creates|gains|adds)/, 2]] },
  pillowfort: { l: tx('Pillowfort'), w: ['pillowfort', 'pillow fort', 'forte de almofadas', 'fortaleza', 'fortaleza de almohadas', 'kissenfort', 'nao me ataquem', 'ninguem me ataca'], zh: ['枕头堡'],
    tg: { protection: 0.3, lifegain: 0.2 }, re: [[/can't attack you|prevent all combat damage|unless (its|their) controller pays \{[\dx]\} for each/, 2.5]] },
  storm: { l: tx('Storm'), kwOf: 'storm', w: ['storm count', 'spell storm', 'sturm', 'rituais', 'rituals', 'rituales'], zh: ['风暴'],
    kw: { Storm: 3 }, tg: { cost: 0.8 }, re: [[SPELL_PAY, 0.8]], fn: c => (spell(c) && /add \{/.test(c.o) ? 1.5 : 0) },
  ramp: { l: tx('Ramp / big mana'), of: 'ramp', w: ['big mana', 'mana grande', 'muita mana', 'gran mana', 'mucho mana', 'viel mana', 'ramp deck'], zh: ['大魔法'],
    tg: { ramp: 2 }, re: [[EXTRA_LANDS, 1], [/untap all lands|double the amount of mana|whenever (you tap )?a land (you control )?(is tapped|for mana)|add (x mana|mana equal to)/, 1.5]] },
  artifacts: { l: tx('Artefactos'), of: 'artifacts', w: ['artifacts matter', 'artifact deck', 'artifact synergy', 'deck de artefactos', 'artefactos importam', 'sinergia de artefactos', 'artefaktdeck', 'artefakte zahlen'], zh: ['神器流'],
    tg: { artifacts: 1.5 }, kw: { Affinity: 1, Improvise: 1, Metalcraft: 1, Fabricate: 1, Modular: 0.6 }, ty: [[/Artifact/, 0.4]],
    re: [[/(?<!enchant )artifacts? you control|whenever[^.]*artifact[^.]*enters|affinity for artifacts/, 1], [/create[^.]*(treasure|clue|food|blood|map|thopter|servo|construct|artifact)/, 0.8]] },
  enchantress: { l: tx('Enchantress (encantamentos)'), of: 'enchantments', w: ['enchantress', 'encantadora', 'enchantments matter', 'encantamentos importam', 'deck de encantamentos', 'encantamientos importan', 'verzauberungsdeck'], zh: ['结界流'],
    tg: { enchantments: 2 }, kw: { Constellation: 1 }, ty: [[/Enchantment/, 0.4]], re: [[/whenever you cast an enchantment|enchantment spells? (you cast )?cost/, 1]] },
  graveyard: { l: tx('Cemitério (self-mill)'), of: 'graveyard', w: ['self-mill', 'self mill', 'automoer', 'auto-moer', 'moer-me', 'graveyard matters', 'cemiterio importa', 'automolienda', 'selbstmahlen'], zh: ['自磨'],
    tg: { graveyard: 0.5 }, kw: { Dredge: 1.5, Delve: 1, Flashback: 1, Escape: 1, Threshold: 0.8, Unearth: 1, Disturb: 0.8, Embalm: 0.8, Eternalize: 0.8 },
    re: [[SELF_FILL, 1.2], [/return[^.]*from your graveyard|from your graveyard to the battlefield|cast [^.]*from your graveyard/, 1.5]] },
  steal: { l: tx('Roubar (ganhar controlo)'), of: 'steal', w: ['theft', 'roubo', 'roubos', 'ladroagem', 'diebstahl'], zh: [],
    tg: { steal: 2.5 }, re: [[/gain control of|exchange control of|spells? you don't own|cards? you don't own|exile the top card of (each|target) (player's|opponent's) library[^.]*you may (cast|play)|you may (cast|play) [^.]*(an opponent|they) owns?/, 1.5]] },
  copy: { l: tx('Clones e cópias'), of: 'copy', w: ['clones', 'clone', 'copias', 'clonar', 'kopien', 'klone', 'klonen'], zh: ['克隆'],
    tg: { copy: 2 }, re: [[/becomes a copy|enters? as a copy|token that's a copy|copy target|copy it/, 1]] },
  extraturn: { l: tx('Turnos extra'), of: 'extraturn', w: ['extra turns', 'turnos extra', 'turnos adicionais', 'turnos adicionales', 'zusatzliche zuge', 'mais turnos'], zh: [],
    tg: { extraturn: 3 }, re: [[/additional combat phase|untap all creatures you control/, 0.8]] },
  infect: { l: tx('Infect / veneno'), kwOf: 'infect', w: ['poison', 'poison counters', 'veneno', 'marcadores de veneno', 'contadores de veneno', 'giftmarken', 'vergiften'], zh: ['侵染', '中毒'],
    kw: { Infect: 3, Toxic: 2.5, Poisonous: 2 }, tg: { pump: 0.4 }, re: [[/poison counter/, 2], [/proliferate/, 1]] },
}
// a função ou a habilidade (os nomes do parseQuery) que, no «Gosto de…», vale a estratégia
export const ARCH_OF_TAG = Object.fromEntries(Object.entries(ARCH).filter(([, a]) => a.of).map(([k, a]) => [a.of, k]))
export const ARCH_OF_KW = Object.fromEntries(Object.entries(ARCH).filter(([, a]) => a.kwOf).map(([k, a]) => [a.kwOf, k]))

/** Quanto a carta serve a estratégia k (≥ 1 = serve); em cache na carta. */
export function archScore(c, k) {
  const m = (c._as ||= {})
  if (m[k] != null) return m[k]
  const a = ARCH[k], o = (c._ao ??= (c.o || '').toLowerCase().replace(/\([^)]*\)/g, ''))
  let s = 0
  for (const t in a.tg) if (c.tg?.includes(t)) s += a.tg[t]
  for (const x in a.kw) if (c.kw?.includes(x)) s += a.kw[x]
  for (const [re, w] of a.re || []) if (re.test(o)) s += w
  for (const [re, w] of a.ty || []) if (re.test(c.t)) s += w
  if (a.fn) s += a.fn(c, o)
  return (m[k] = s)
}
// para ordenar: o que serve bem a estratégia empata (≤ 2) e desempata a popularidade
export const archRank = (c, ks) => ks.reduce((a, k) => a + Math.min(2, archScore(c, k)), 0)
