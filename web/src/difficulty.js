// Explicação dos perfis da IA do Forge, comparados com o Normal (Default). Usamos cópias nossas dos res/ai/*.ai
// (build/forge/build.sh) em que nenhuma chance fica em 0% ou 100%: passam a 10% e 90%, porque há sempre
// situações em que não compensa (menos as chances de contrariar, que ficam como no Forge). Os perfis são estilos
// de jogo; só a Forte acrescenta uma verificação por simulação.
export const DIFF_INFO = {
  default: {
    label: 'Normal',
    resumo: 'O perfil de referência do Forge: equilibrado entre atacar e defender.',
    pontos: [
      'Evita atacar para bloqueios certos e raramente ataca só para trocar criaturas (≈10%).',
      'Guarda truques de combate até haver bloqueios (≈65% das vezes).',
      'Contraria sempre feitiços de custo 3 ou mais, muitas vezes os de custo 2 (≈75%) e às vezes os de custo 1 (≈30%).',
      'Encadeia feitiços de dano para matar (≈90%).',
      'Faz mulligan com mãos fracas (limiar normal).',
    ],
  },
  cautious: {
    label: 'Cautelosa',
    resumo: 'Defensiva: troca menos criaturas, gasta menos recursos e protege-se.',
    pontos: [
      'Quase nunca ataca para trocar criaturas quando o adversário tem mana aberta (≈10% em vez de 30%).',
      'Só troca criaturas se não ficar com menos no campo; não usa ataques arriscados.',
      'Contraria menos: de custo 1 só dano, remoção e outros contra-feitiços; metade dos de custo 2.',
      'Raramente encadeia dois feitiços de dano (≈25% em vez de 90%).',
      'Sente-se em perigo mais cedo e protege mais os planeswalkers (troca para os salvar ≈90%).',
      'Paga energia só para se defender; scry/surveil mais conservadores.',
    ],
  },
  reckless: {
    label: 'Imprudente',
    resumo: 'Agressiva: ataca sempre que pode, troca criaturas sem medo e arrisca mãos curtas.',
    pontos: [
      'Joga em modo agressivo: ataca para trocar criaturas quase sempre (≈90%), mesmo com o adversário de mana aberta.',
      'Ataca mesmo quando fica sem mana para responder.',
      'Aceita mãos piores (limiar de mulligan mais baixo).',
      'Contraria muito mais: quase tudo de custo 1 (≈80%) e tudo de custo 2 ou mais.',
      'Gasta feitiços de dano X mais cedo, com menos dano acumulado.',
      'Lança mais cartas com flash cedo e move equipamentos para as melhores criaturas.',
    ],
  },
  experimental: {
    label: 'Experimental',
    resumo: 'Perfil de testes do Forge: mais oportunista e arriscado em várias decisões.',
    pontos: [
      'Sente-se em perigo mais tarde e aceita mais risco antes de defender.',
      'Encadeia quase sempre dois feitiços de dano para matar (≈90%).',
      'Usa quase sempre habilidades que criam fichas (≈90%) e responde mais vezes à pilha com flash.',
      'Move equipamentos sempre para a melhor criatura e reaproveita planeswalkers com blink.',
      'Troca criaturas para salvar planeswalkers mesmo perdendo (≈40%).',
      'Faz sideboard por vezes mesmo depois de ganhar (≈25%).',
    ],
  },
  forte: {
    label: 'Forte (verifica jogadas)',
    resumo: 'O perfil Normal com uma verificação do Forge: antes de cada jogada simula-a e põe de lado as que deixam o jogo pior.',
    pontos: [
      'Decide como a Normal (as mesmas regras por carta: contra-feitiços, reanimação, combate) e veta as jogadas que perdem valor.',
      'Respostas na pilha (contrariar, truques) seguem a Normal: a simulação do Forge não vê a pilha.',
      'Não é mais lenta do que a Normal na prática; o relógio do Forge estica para o triplo por segurança.',
      'A pesquisa completa do Forge ficou de fora: não dava valor ao cemitério nem às respostas e esgotava a memória.',
    ],
  },
  random: {
    label: 'Aleatória',
    resumo: 'Cada jogo sorteia um dos perfis acima: bom para testar contra estilos variados.',
    pontos: ['Útil em séries longas para não afinar o deck contra um único estilo de jogo.'],
  },
}
