// Os ícones do Grimório: traço fino na cor do texto e um pormenor a dourado (.acc) que acende com o separador ativo —
// a mesma linguagem do logótipo (livro dourado, pontos de mana). SVG 24×24 desenhado à mão; sem biblioteca.
const ICONS = {
  // pena a escrever num livro aberto
  construir: '<path d="M2.5 17.2c3-1.4 6.3-1.4 9.5.6 3.2-2 6.5-2 9.5-.6v3.4c-3-1.3-6.3-1.3-9.5.6-3.2-1.9-6.5-1.9-9.5-.6z"/><path d="M12 17.8v3.4"/><path class="acc" d="M19.6 2.8c-4.6.4-7.6 3.7-8.3 8.6 4.1-.9 7.1-4 8.3-8.6z"/><path d="M19.6 2.8 9.4 14.6"/>',
  // estante de grimórios, um deitado; fecho dourado no do meio
  biblioteca: '<path d="M3 20.5h18"/><rect x="4" y="5" width="3.6" height="15.5" rx=".8"/><rect x="8.6" y="3.5" width="4" height="17" rx=".8"/><path d="m14.2 7.4 3.3-.9 3.4 13.1-3.3.9z"/><path d="M4 8h3.6M4 17h3.6M8.6 6.5h4M8.6 17.5h4"/><circle class="acc" cx="10.6" cy="12" r="1.3"/>',
  // espadas cruzadas e uma faísca dourada por cima
  coliseu: '<path d="M4 3.5 14.6 14.1M20 3.5 9.4 14.1"/><path d="M12.4 16.3l4.4-4.4M7.2 11.9l4.4 4.4"/><path d="M15.7 15.2 19.5 19M8.3 15.2 4.5 19"/><circle cx="20" cy="19.5" r="1"/><circle cx="4" cy="19.5" r="1"/><path class="acc" d="M12 2.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/>',
  // pergaminho enrolado com selo de cera
  regras: '<path d="M6.5 4h11a2 2 0 0 1 2 2v1.5h-2"/><path d="M17.5 6v12.5a2 2 0 0 1-2 2h-10a2 2 0 0 1 0-4h8"/><path d="M6.5 4a2 2 0 0 0-2 2v10.5"/><path d="M8 8.5h6.5M8 11.5h6.5M8 14.5h3.5"/><circle class="acc" cx="15.6" cy="17.6" r="2.1"/>',
  // autómato: cabeça com antena de cristal e olhos acesos
  bots: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5.3"/><path d="M2.8 12.5V15M21.2 12.5V15"/><path d="M9 16h6"/><circle class="acc" cx="12" cy="3.8" r="1.5"/><circle class="acc" cx="9.3" cy="12.3" r="1.3"/><circle class="acc" cx="14.7" cy="12.3" r="1.3"/>',
  // bigorna (o Forge) com faíscas
  forge: '<path d="M3 8.5h12.5c1.8 0 3.6.9 5 2.3-1.7.4-3.4.6-5 .5-.7 1.8-2.3 3-4.2 3.3v3H14v2.4H5.8v-2.4h2.9v-3C5.6 13.8 3.7 11.6 3 8.5z"/><path class="acc" d="M18.3 2.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/><circle class="acc" cx="14.2" cy="4.6" r=".9"/>',
  // cálice de troféu com estrela
  torneio: '<path d="M7 3.5h10V8a5 5 0 0 1-10 0z"/><path d="M7 5.2H4.6c0 2.4 1.2 3.9 3 4.3M17 5.2h2.4c0 2.4-1.2 3.9-3 4.3"/><path d="M12 13v3.4M8.5 20.5h7M9.5 16.5h5l.7 4h-6.4z"/><path class="acc" d="m12 5.1.75 1.5 1.65.25-1.2 1.15.3 1.65-1.5-.8-1.5.8.3-1.65-1.2-1.15 1.65-.25z"/>',
  // leque de três cartas, ponto de mana na da frente
  draft: '<rect x="3.4" y="5.6" width="8.4" height="12.6" rx="1.3" transform="rotate(-16 7.6 11.9)"/><rect x="12.2" y="5.6" width="8.4" height="12.6" rx="1.3" transform="rotate(16 16.4 11.9)"/><rect x="7.8" y="4.2" width="8.4" height="13.2" rx="1.3"/><circle class="acc" cx="12" cy="8.6" r="1.6"/><path d="M10 12.6h4M10 14.8h4"/>',
  // globo com uma órbita e dois jogadores nela
  online: '<circle cx="12" cy="12" r="6.6"/><path d="M5.4 12h13.2M12 5.4c-2.2 2-2.2 11.2 0 13.2M12 5.4c2.2 2 2.2 11.2 0 13.2"/><ellipse cx="12" cy="12" rx="10.3" ry="3.6" transform="rotate(-24 12 12)"/><circle class="acc" cx="3.2" cy="15.7" r="1.3"/><circle class="acc" cx="20.8" cy="8.3" r="1.3"/>',
  // estrela grande com duas pequenas (as estrelas dos ratings)
  ratings: '<path d="m10 4.5 1.9 3.9 4.3.6-3.1 3 .7 4.3L10 14.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/><path class="acc" d="m18.2 13.6.8 1.6 1.7.25-1.25 1.2.3 1.7-1.55-.8-1.55.8.3-1.7-1.25-1.2 1.7-.25z"/><circle class="acc" cx="19" cy="5" r="1"/>',
  // engrenagem com uma gema ao centro
  gear: '<path d="M10.3 2.8h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.9l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6v-1.9L4.2 8.2l1.7-2.9 2.3.8 1.6-.9z"/><circle class="acc" cx="12" cy="11.9" r="2.6"/>',
  // contador de vida: coração com a gota de veneno ao lado
  vida: '<path d="M10 19.6S3.2 15.6 3.2 10.4A3.7 3.7 0 0 1 10 8.3a3.7 3.7 0 0 1 6.8 2.1c0 .7-.1 1.4-.4 2"/><path d="M14.2 16.3c-2 1.9-4.2 3.3-4.2 3.3"/><path class="acc" d="M18.4 12.6c1.4 1.9 2.2 3.1 2.2 4.2a2.2 2.2 0 0 1-4.4 0c0-1.1.8-2.3 2.2-4.2z"/>',
  // ler carta: o visor da câmara com uma carta lá dentro
  scan: '<path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16"/><rect x="8.6" y="6.6" width="6.8" height="10.8" rx="1"/><circle class="acc" cx="12" cy="10.2" r="1.5"/>',
  // dado de vinte faces
  dados: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z"/><path d="M12 7.6 16.3 15H7.7z"/><path d="M12 2.8v4.8M20 7.4l-3.7 7.6M4 7.4l3.7 7.6M7.7 15 4 16.6M16.3 15l3.7 1.6M7.7 15 12 21.2 16.3 15"/><circle class="acc" cx="12" cy="12.3" r="1.1"/>',
  // criar: estrela de quatro pontas e um mais
  criar: '<path class="acc" d="M11 3.5l1.6 5.2 5.2 1.6-5.2 1.6L11 17.1l-1.6-5.2-5.2-1.6 5.2-1.6z"/><path d="M18.5 15.5v5M16 18h5"/>',
  // salas: porta em arco de duas folhas
  porta: '<path d="M5.5 21V9.5a6.5 6.5 0 0 1 13 0V21"/><path d="M3 21h18M12 3.2V21"/><circle class="acc" cx="10.2" cy="13.5" r=".9"/><circle class="acc" cx="13.8" cy="13.5" r=".9"/>',
  // registo: livro de assentos com fita
  registo: '<path d="M5 19.5V5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12"/><path d="M8.5 7h4.5M8.5 10h6.5M8.5 13h6.5"/><path class="acc" d="M15.3 3v5.4l1.45-1.1 1.45 1.1V3z"/>',
  // apostas: pilha de moedas e uma à frente
  moeda: '<ellipse cx="9.5" cy="6.5" rx="6" ry="2.5"/><path d="M3.5 6.5v4c0 1.4 2.7 2.5 6 2.5 1 0 2-.1 2.8-.3M15.5 6.5v3.2"/><path d="M3.5 10.5v4c0 1.4 2.7 2.5 6 2.5"/><circle class="acc" cx="16.5" cy="15.5" r="4.6"/><circle cx="16.5" cy="15.5" r="2.4" stroke="#1b1405" stroke-width="1.1"/>',
  // meus: chapéu de mago com estrela
  mago: '<path d="M3.5 19.5h17"/><path d="M6.5 19.5 10.6 5c.4-1.4 2.2-1.6 2.9-.3l1.7 3.2-2.1 1.3 3.9 10.3"/><path class="acc" d="m11.4 12.2.65 1.3 1.45.2-1.05 1 .25 1.45-1.3-.7-1.3.7.25-1.45-1.05-1 1.45-.2z"/>',
  // amigos: duas pessoas
  amigos: '<circle cx="8.5" cy="8.2" r="3.1"/><path d="M2.8 19.5c.5-3.4 2.7-5.2 5.7-5.2s5.2 1.8 5.7 5.2"/><circle cx="16.2" cy="9.2" r="2.5"/><path d="M15.6 14.4c2.9 0 4.9 1.7 5.4 4.8"/><circle class="acc" cx="12.4" cy="3.6" r="1.1"/>',
  // meta: gráfico a subir com os pontos acesos
  meta: '<path d="M3.5 20.5h17"/><path d="M4.5 16.5 9.5 11.5l3.5 3 6.5-7.5"/><path d="M15.5 7h4v4"/><circle class="acc" cx="9.5" cy="11.5" r="1.4"/><circle class="acc" cx="13" cy="14.5" r="1.4"/>',
}

// um rótulo com ícone: a frase traduzida pode trazer um emoji à frente (a chave das traduções fica igual); sai na hora
const EMO = /^(?:\p{Extended_Pictographic}|[✦★☰▦⛶])\uFE0F?\s*/u
export function IL({ n, t }) {
  return <><Icon n={n} />{String(t).replace(EMO, '')}</>
}

export function Icon({ n, size }) {
  return <svg className="ic" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[n] || '' }} />
}
