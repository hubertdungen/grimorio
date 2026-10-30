// keywords das regras (em inglês) que aparecem em textos de cartas e explicações: ligam às Regras
export const KW = /\b(Flying|Trample|Deathtouch|Lifelink|Haste|Vigilance|First strike|Double strike|Reach|Hexproof|Indestructible|Flash|Menace|Defender|Ward|Protection|Equip|Enchant|Scry|Mill|Cycling|Flashback|Kicker|Prowess|Convoke|Cascade|Delve|Crew|Surveil|Shroud|Persist|Undying|Storm|Affinity|Dredge|Madness|Morph|Evoke|Infect|Proliferate|Transform|Explore|Adapt|Ninjutsu|Toxic|Landfall|Treasure|Food|Clue|Monarch|Initiative|Mutate|Foretell|Disturb|Training|Connive|Blitz|Casualty|Bargain|Craft|Discover|Offspring|Gift)\b/g
// como o rules.py: minúsculas, sem acentos nem pontuação
export const normKw = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim()

// a regra de um termo (/api/rules): {name, num, text}; uma vez por termo (KwPeek e a conversa da mesa livre)
const ruleCache = new Map()
export const define = term => {
  if (!ruleCache.has(term)) ruleCache.set(term, fetch(`/api/rules?q=${encodeURIComponent(term)}`).then(r => (r.ok ? r.json() : null)).then(d => {
    const r = d?.results?.find(x => x.kind === 'rule'), g = d?.results?.find(x => x.kind === 'gloss')
    const sub = r?.rules?.find(([n]) => /[a-z]$/.test(n))  // a primeira alínea (702.19a …) diz o que é
    return { name: d?.translated || r?.title || g?.term || term, num: r?.num, text: sub?.[1] || g?.text || '' }
  }).catch(() => null))
  return ruleCache.get(term)
}
