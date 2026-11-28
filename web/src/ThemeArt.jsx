// 🎨 Artes do tema: escolher o universo/edição (o do comandante, o do «Gosto de…» ou qualquer um pela pesquisa) e ver
// quantas cartas mudam antes de aplicar (themeart.js)
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { tx } from './i18n.js'
import { VOC } from './vocab.js'
import { useBackClose } from './backnav.js'
import { themeOptions, findThemes, themePlan, artThemes } from './themeart.js'

const FROM = { like: tx('do «Gosto de…»'), cmd: tx('do comandante'), cmdset: tx('edição do comandante'), set: '' }

export default function ThemeArtDialog({ data, deck, onApply, onClose }) {
  useBackClose(true, onClose)
  const [q, setQ] = useState(''), [replace, setReplace] = useState(false)
  const base = useMemo(() => themeOptions(data, deck), [data, deck])
  const found = useMemo(() => findThemes(q).filter(t => !base.some(b => b.v === t.v)), [q, base])
  const rows = [...base, ...found].map(th => ({ th, plan: themePlan(data, deck, th, { replace }) }))
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal tart" onClick={e => e.stopPropagation()} role="dialog" aria-label={tx('Artes do tema')}>
        <button className="close" onClick={onClose} aria-label={tx('Fechar')}>×</button>
        <h3>🎨 {tx('Artes do tema')}</h3>
        <p className="muted small">{tx('As cartas do deck que têm impressão no universo escolhido passam a usá-la (moldura normal, sem foil). As artes próprias ficam sempre; desfaz-se com ↶.')}</p>
        {!VOC.on ? <p className="bad-t small">{tx('Faltam os dados das edições (vocab.json): atualiza os dados do Grimório para usar as artes do tema.')}</p> : <>
          {offline && <p className="bad-t small">{tx('Sem ligação à internet: as impressões vêm da Scryfall, tenta quando houver rede.')}</p>}
          <input className="tart-q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tx('Outra edição ou universo (nome ou código)…')} aria-label={tx('Procurar edição ou universo')} />
          {!rows.length && <p className="muted small">{q.trim().length >= 2 ? tx('Nenhuma edição com esse nome.') : tx('Este deck não tem tema detetado: procura uma edição ou um universo.')}</p>}
          <ul className="tart-list">{rows.map(({ th, plan }) => (
            <li key={th.v}>
              <button className={plan.items.length ? 'primary' : ''} disabled={!plan.items.length || offline} onClick={() => onApply(th, replace)}>
                <b>{th.name}</b>{th.tag !== th.name && <span className="muted"> · {th.tag}</span>}
              </button>
              <small className="muted">
                {[FROM[th.from], tx('{n} carta muda|{n} cartas mudam', { n: plan.items.length }),
                  plan.skip.have ? tx('{n} já com esta arte', { n: plan.skip.have }) : '',
                  plan.skip.chosen ? tx('{n} escolhida à mão fica|{n} escolhidas à mão ficam', { n: plan.skip.chosen }) : '',
                  plan.skip.own ? tx('{n} com arte própria', { n: plan.skip.own }) : ''].filter(Boolean).join(' · ')}
              </small>
              {plan.skip.favs.length > 0 && <small className="tart-note">{tx('{l}: ficam com as tuas artes favoritas de básicos; marca «Substituir também as escolhidas» para usar as do tema.', { l: plan.skip.favs.join(', ') })}</small>}
              {plan.lands.deck > 0 && !plan.lands.theme && <small className="tart-note">{tx('Os terrenos ficam como estão: {u} não tem terrenos impressos (nem básicos).', { u: th.name })}</small>}
            </li>
          ))}</ul>
          <label className="chk small"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> {tx('Substituir também as escolhidas')}</label>
        </>}
      </div>
    </div>, document.body)
}

// o botão da barra do deck: «🎨 Artes do tema (40K)» com o tema detetado; abre a janela de escolha
export function ThemeArtBtn({ data, deck, act, className = '' }) {
  const th = useMemo(() => (data ? artThemes(data, deck)[0] : null), [data, deck])
  if (!act?.themeArtsOpen) return null
  return <button className={className} onClick={act.themeArtsOpen} title={tx('Usar as impressões do universo do deck (o do comandante ou do «Gosto de…») nas cartas que as têm')}>🎨 {tx('Artes do tema')}{th ? ` (${th.tag})` : ''}</button>
}
