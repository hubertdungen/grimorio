// Golpes na esfera da vida «à maneira de quem bateu»: garras de uma fera, espadas de um soldado, flechas de um arqueiro,
// dentadas de um vampiro, cornadas, atropelar que esmaga pedra, voo picado, raio com trovão, fogo, gelo, folhas e
// espinhos, halo de luz (encantamentos brancos), ataque multicolor, metal e engrenagens (artefactos), gosma negra.
// Escolhe-se pela carta (subtipos, cores, palavras-chave, tipo) e ao acaso entre os que lhe servem, para não ser
// sempre igual; às vezes (≈30 %) fica o golpe simples. Cada estilo tem desenho (camada por cima da esfera), som
// (sfx.js atk*) e um efeito na esfera 3D (orb3d.js lê data-fx3: rachar, partir ao meio, abrir e verter, apodrecer,
// espinhos).
import { play } from './sfx.js'

const SUB = (c, re) => re.test(String(c?.t || '').split('—')[1] || '')
export function attackStyle(c, kind, kw) {
  if (!c || Math.random() < 0.3) return null
  const o = String(c.o || ''), t = String(c.t || ''), cols = [...new Set(String(c.co ?? c.ci ?? '').replace(/[^WUBRG]/g, ''))]
  const opts = []
  if (kw === 'zap') opts.push('thunder', 'thunder')
  if (SUB(c, /\b(Vampire|Bat)\b/)) opts.push('bite', 'blood')
  if (SUB(c, /\b(Beast|Cat|Bear|Wolf|Dog|Dinosaur|Dragon|Hydra|Wurm|Lizard|Rat|Hound|Elemental|Kavu|Hellion|Nightmare|Horror)\b/)) opts.push('claws', 'claws')
  if (SUB(c, /\b(Soldier|Knight|Warrior|Samurai|Berserker|Pirate|Mercenary|Barbarian)\b/)) opts.push('sword', 'sword')
  if (SUB(c, /\b(Archer|Scout|Ranger)\b/) || /\breach\b/i.test(o)) opts.push('arrow')
  if (SUB(c, /\b(Minotaur|Rhino|Goat|Ox|Elk|Boar|Bull|Unicorn|Satyr)\b/)) opts.push('horn', 'horn')
  if (SUB(c, /\b(Snake|Spider|Insect|Zombie|Shark|Crocodile|Fish)\b/)) opts.push('bite')
  if (kw === 'trample' || /\bTrample\b/.test(o)) opts.push('smash')
  if (kw === 'flying' || /\bFlying\b/.test(o)) opts.push('dive')
  if (kw === 'deathtouch' || kw === 'infect' || kind === 'psn') opts.push('goo', 'rot')
  if (/Artifact/.test(t) || /\baffinity\b/i.test(o)) opts.push('metal')
  if (/Enchantment/.test(t) && cols.includes('W')) opts.push('holy')
  if (cols.length >= 2) opts.push('prism')
  const bycol = { R: 'fire', U: 'ice', G: 'leaf', B: 'goo', W: 'holy' }
  for (const k of cols) opts.push(bycol[k])
  if (!opts.length) return null
  return opts[Math.floor(Math.random() * opts.length)]
}
// o efeito na esfera 3D (e na clássica, por CSS) de cada estilo
const FX3 = { claws: 'crack', sword: 'split', arrow: 'spikes', bite: 'spill', blood: 'spill', horn: 'crack', smash: 'split', dive: 'crack', thunder: 'crack',
  fire: 'burn', ice: 'frost', leaf: 'spikes', holy: 'glow', prism: 'glow', metal: 'spikes', goo: 'rot', rot: 'rot' }
const GLYPH = { claws: '', sword: '🗡', arrow: '➶', bite: '', blood: '🩸', horn: '', smash: '🪨', dive: '🦅', thunder: '⚡', fire: '🔥', ice: '❄', leaf: '🍃', holy: '✦', prism: '✧', metal: '⚙', goo: '', rot: '☣' }
const N = { claws: 3, sword: 2, arrow: 4, bite: 2, blood: 8, horn: 2, smash: 9, dive: 1, thunder: 3, fire: 8, ice: 9, leaf: 9, holy: 1, prism: 6, metal: 7, goo: 7, rot: 6 }

// a camada do golpe por cima da esfera (posição do ecrã; dx/dy = de onde veio)
export function attackFx(orb, style, dx = 0, dy = 1) {
  const el = orb?._proxy || orb, r = el?.getBoundingClientRect()
  if (!r?.width) return
  const host = document.fullscreenElement || document.webkitFullscreenElement || document.body, box = document.createElement('div')
  box.className = `atkfx atk-${style}`
  const L = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy / L, dx / L) * 180 / Math.PI
  Object.assign(box.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px`, width: `${r.width}px`, height: `${r.height}px` })
  box.style.setProperty('--ang', `${ang}deg`)
  for (let i = 0; i < (N[style] || 4); i++) {
    const p = document.createElement('i')
    p.style.setProperty('--i', i); p.style.setProperty('--rx', (Math.random() - 0.5).toFixed(2)); p.style.setProperty('--ry', (Math.random() - 0.5).toFixed(2))
    if (GLYPH[style]) p.textContent = GLYPH[style]
    box.append(p)
  }
  host.append(box)
  setTimeout(() => box.remove(), 1600)
  // a esfera reage (3D e clássica): rachar, partir ao meio, verter, apodrecer, espinhos, gelar, arder, brilhar
  const fx = FX3[style]
  if (fx && orb) { orb.dataset.fx3 = fx; clearTimeout(orb._fx3); orb._fx3 = setTimeout(() => { delete orb.dataset.fx3 }, 1500) }
  play(`atk_${style}`)
}
