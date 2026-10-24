// Posição de uma repetição (estado do game.js) -> corpo de POST /api/play/from-state (play.py), para continuar
// o jogo no Forge com um dos lados nas tuas mãos. Puro: não toca no DOM nem no React.
//
// O que a repetição não sabe sai do resto da lista do deck, baralhado: a ordem da biblioteca e, em jogos não exatos,
// as cartas da mão que nunca foram vistas. Cartas desconhecidas no cemitério (null) ficam de fora.
// decks = { a: {main, commanders}, b: {...} } — os decks que jogaram (o teu e o do adversário).

function shuffle(xs, rng) {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export function toForgeState(s, decks, { control = 'a', difficulty = 'default', format, rng = Math.random } = {}) {
  const live = k => s[k].perms.filter(p => !p.dying && !p.hidden && p.name)
  const onField = new Set([...live('a'), ...live('b')].map(p => p.key))
  const side = k => {
    const z = s[k]
    const pool = { ...(decks?.[k]?.main || {}) }  // cartas do deck ainda por localizar
    const take = n => { if (n && pool[n] > 0) pool[n] -= 1 }
    const perms = live(k)
    const cmdNames = new Set(z.command.map(c => c.name))
    const battlefield = perms.map(p => ({
      id: p.key, name: p.name, tapped: !!p.tapped, sick: !!p.sick, flipped: !!p.flipped, token: !!p.token,
      pt: p.pt || null, kw: p.kw || null, counters: p.counters || {}, damage: p.damage || 0,
      attacking: p.attacking || null, attachedTo: onField.has(p.attachedTo) ? p.attachedTo : null,
      commander: !p.token && cmdNames.has(p.name),
    }))
    for (const p of perms) if (!p.token) take(p.name)
    const known = z.known.slice(0, z.hand)
    for (const n of [...known, ...z.graveyard, ...z.exile]) take(n)
    const rest = shuffle(Object.entries(pool).flatMap(([n, q]) => Array(Math.max(0, q)).fill(n)), rng)
    const hand = [...known, ...rest.splice(0, Math.max(0, z.hand - known.length))]
    return {
      life: z.life, poison: z.poison || 0, energy: z.energy || 0, hand,
      graveyard: z.graveyard.filter(Boolean), exile: z.exile.filter(Boolean),
      library: z.library == null ? rest : rest.slice(0, z.library),
      battlefield,
      command: z.command.filter(c => !battlefield.some(p => p.commander && p.name === c.name)).map(c => c.name),
      commanders: z.command.map(c => ({ name: c.name, casts: c.casts || 0 })),
    }
  }
  return {
    state: { turn: s.turn || 1, active: s.active || control, phase: s.phase || 'main1', a: side('a'), b: side('b') },
    control, difficulty, format,
  }
}
