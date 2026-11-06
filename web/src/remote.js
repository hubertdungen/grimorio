// Salas de amigos: o teu Grimório (exe, pacote Linux, APK ou browser) mostra a sala de OUTRO Grimório com os teus ecrãs,
// as tuas preferências e os teus decks. Enquanto o ecrã «Sala de um amigo» está aberto, os pedidos às salas e às mesas
// livres (/api/rooms, /api/freetables, /api/guest/me) vão para o Grimório de quem aloja, com o convite em
// «Authorization: Bearer» e sem cookies (guests.BEARER lá). Ao sentares-te com um deck teu, a lista vai nesse momento
// para lá (fica no perfil de convidado, com o mesmo id de cada vez: atualiza-se em vez de duplicar).
import { tx } from './i18n.js'

export const API = 1  // = guests.API no servidor
let R = null  // { base, token }
export const remoteOn = () => !!R
export const setRemote = r => { R = r }
const ROOM = /^\/api\/(rooms|freetables|guest\/me)(\/|$)/
const JOIN = /^\/api\/rooms\/[a-z0-9]+\/join$/

const auth = (init = {}) => { const h = new Headers(init.headers); h.set('Authorization', `Bearer ${R.token}`); return { ...init, headers: h, credentials: 'omit' } }

// fetch -> o pedido reescrito para o anfitrião, ou null (fica cá)
export async function remoteFetch(_fetch, [input, init]) {
  if (!R) return null
  let u
  try { u = new URL(String(input?.url || input), location.href) } catch { return null }
  if (u.origin !== location.origin || !ROOM.test(u.pathname)) return null
  let body = init?.body
  if (JOIN.test(u.pathname) && typeof body === 'string') body = await bringDeck(_fetch, body)
  return _fetch(R.base + u.pathname + u.search, auth({ ...init, body }))
}

// sentar-me com um deck meu (daqui): leva a lista para lá e entra com o id de lá
async function bringDeck(_fetch, body) {
  const b = JSON.parse(body)
  if (!b.deck || (b.src && b.src !== 'meus')) return body  // emprestado ou do meta: já é de lá
  const r = await _fetch(`./api/decks/${encodeURIComponent(b.deck)}`)
  if (!r.ok) return body
  const out = await _fetch(`${R.base}/api/guest/decks`, auth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decks: [await r.json()] }) }))
  const id = out.ok && (await out.json()).ids?.[b.deck]
  if (!id) throw new Error(tx('Não consegui levar este deck para a sala do teu amigo.'))
  return JSON.stringify({ ...b, deck: id, src: 'meus' })
}

// as salas de amigos onde já entraste (para voltar sem o link): [{ base, token, name, ts }]
const K = 'grimorio.salasAmigos'
export const rooms = () => { try { return JSON.parse(localStorage.getItem(K)) || [] } catch { return [] } }
export const saveRoom = x => { try { localStorage.setItem(K, JSON.stringify([{ ...x, ts: Date.now() }, ...rooms().filter(y => y.base !== x.base || y.token !== x.token)].slice(0, 10))) } catch { /* sem armazenamento */ } }
export const dropRoom = x => { try { localStorage.setItem(K, JSON.stringify(rooms().filter(y => y.base !== x.base || y.token !== x.token))) } catch { /* sem armazenamento */ } }

// a página de quem aloja na janela inteira (versões diferentes, torneios e Forge Play): com «← O meu Grimório»
export const hostPage = (base, token) => `${base}/convite/${token}?entrar=1&volta=${encodeURIComponent(location.origin + location.pathname)}`
