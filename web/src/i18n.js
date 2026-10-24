// Línguas caseiras: a chave é o próprio texto em pt-PT; lang/<código>.js traduz (en, es, de, zh). O inglês é a omissão.
// tx('Faltam {n} cartas', { n }) interpola {nome}; com vars.n, 'forma 1|forma n' escolhe o singular quando n === 1.
// Só se descarrega o dicionário da língua ativa (main.jsx espera por `ready` antes de carregar a app) e mudar de
// língua recarrega a página: assim as tabelas fixas dos módulos (rótulos, explicações) também usam tx().
export const LANGS = [['en', 'English', 'en-US'], ['pt', 'Português', 'pt-PT'], ['es', 'Español', 'es-ES'], ['de', 'Deutsch', 'de-DE'], ['zh', '简体中文', 'zh-CN']]

const KEY = 'grimorio.lang'
const ok = l => LANGS.some(x => x[0] === l)
const saved = (() => { try { return globalThis.localStorage?.getItem(KEY) } catch { return null } })()
// sem escolha guardada: a primeira língua do browser que existir aqui, senão inglês; no node (selfcheck) fica o pt
const browser = () => (globalThis.navigator?.languages || []).map(l => l.slice(0, 2).toLowerCase()).find(ok)
export const LANG = ok(saved) ? saved : globalThis.window ? browser() || 'en' : 'pt'
export const LOCALE = LANGS.find(x => x[0] === LANG)[2]
if (globalThis.document) document.documentElement.lang = LOCALE

let DICT = {}
export const ready = LANG === 'pt' ? Promise.resolve() : import(`./lang/${LANG}.js`).then(m => { DICT = m.default })

export function tx(s, v) {
  if (typeof s !== 'string') return s
  let r = DICT[s] ?? (s.includes('§') ? s.slice(s.indexOf('§') + 1) : s)  // 'contexto§texto': o mesmo pt com dois sentidos
  if (v?.n != null && r.includes('|')) { const f = r.split('|'); r = f[Math.abs(v.n) === 1 ? 0 : f.length - 1] }
  return v ? r.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : r
}

/** Número com d casas decimais na língua ativa (vírgula decimal em pt, es e de). */
export const num = (x, d = 1) => Number(x).toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d })

export function setLang(l) {
  try { localStorage.setItem(KEY, l) } catch { /* sem storage: fica só nesta sessão */ }
  window.location.reload()
}
