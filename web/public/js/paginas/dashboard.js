import { get } from '../api.js';
import { h, s, cabecalho, moeda, moedaCurta, numero, dataHora, data, rotuloStatus, seloPedido, hojeIso, acessoNegado } from '../ui.js';
import { linha } from '../grafico.js';
import { MESES } from '../idioma.js';

const ACOES = {
  INCLUSAO: 'incluiu', ALTERACAO: 'alterou', INATIVACAO: 'inativou', REATIVACAO: 'reativou', EXCLUSAO: 'excluiu',
  ENTRADA: 'registrou entrada em', SAIDA: 'registrou saída em', LIQUIDACAO: 'liquidou', LOGIN: 'entrou no sistema',
  AUTOCADASTRO: 'criou a própria conta',
};
const ENTIDADES = { CLIENTE: 'cliente', PRODUTO: 'produto', PEDIDO: 'pedido', ESTOQUE: 'estoque do produto', TITULO: 'título', PARAMETRO: 'parâmetro', SESSAO: '', USUARIO: 'usuário' };

// Ícones de traço fino dos indicadores principais.
const ICONES = {
  faturamento: 'M4 19h16M6 15l4-4 3 3 5-6M15 8h3v3',
  ticket: 'M4 8.5V6h16v2.5a2.5 2.5 0 0 0 0 5V18H4v-4.5a2.5 2.5 0 0 0 0-5zM10 6v12',
  itens: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12v9m0-9 8-4.5M12 12 4 7.5',
  receber: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM14.6 9.3c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 1.9s1 1.6 2.6 2 2.6.9 2.6 2-1.1 1.9-2.6 1.9c-1.3 0-2.3-.6-2.7-1.6M12 6.3v1.6m0 8.2v1.6',
  calendario: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4',
};
const icone = (d, tam = 20) => s('svg', { viewBox: '0 0 24 24', width: tam, height: tam, 'aria-hidden': 'true', class: 'ic' },
  s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

function descreverAtividade(a) {
  if (a.acao.startsWith('STATUS_')) return `Pedido ${a.detalhes.numero}: ${rotuloStatus(a.detalhes.de)} → ${rotuloStatus(a.acao.slice(7))}`;
  const alvo = a.detalhes.numero || a.detalhes.codigo || a.detalhes.chave || (a.entidade_id ? `#${a.entidade_id}` : '');
  return `${a.usuario} ${ACOES[a.acao] || a.acao.toLowerCase()} ${ENTIDADES[a.entidade] ?? a.entidade.toLowerCase()} ${alvo}`.trim();
}

// Períodos prontos calculados a partir da data de hoje (fuso do navegador).
function periodos() {
  const hoje = hojeIso();
  const [a, m] = hoje.split('-').map(Number);
  const iso = (d) => d.toLocaleDateString('sv-SE');
  const menos30 = new Date(`${hoje}T12:00:00`); menos30.setDate(menos30.getDate() - 29);
  return {
    mes: ['Este mês', hoje.slice(0, 8) + '01', hoje],
    anterior: ['Mês anterior', iso(new Date(a, m - 2, 1)), iso(new Date(a, m - 1, 0))],
    dias30: ['Últimos 30 dias', iso(menos30), hoje],
    ano: ['Este ano', `${a}-01-01`, hoje],
  };
}

// Valor monetário com "R$" pequeno e número em destaque.
const valorMoeda = (v) => {
  const txt = moeda(v).replace(/^R\$\s?/, '');
  return h('span', { class: 'vg-num' }, h('small', { class: 'vg-moeda' }, 'R$'), txt);
};

// Painel executivo: resultados estratégicos, somente com a permissão 'painel_executivo.ler'.
// Sem ela a tela nem consulta o servidor; e o servidor também nega (403) quem chamar a API direto.
const RESTRITO = 'Os resultados estratégicos são restritos à alta gestão. Peça acesso ao administrador.';

export async function render(ctx) {
  if (!ctx.pode('painel_executivo.ler')) return acessoNegado(RESTRITO);
  const raiz = h('div', { class: 'visao-geral' });
  const opcoes = periodos();
  let r;
  try {
    r = await get('/api/painel-executivo', { de: ctx.query.de, ate: ctx.query.ate });
  } catch (e) {
    if (e.status === 403 || e.status === 401) return acessoNegado(RESTRITO); // na dúvida, nega
    throw e;
  }
  const k = r.indicadores;
  // Tolera resposta de servidor mais antigo (sem os campos novos da visão geral).
  r.por_grupo = r.por_grupo || []; r.evolucao = r.evolucao || []; r.alertas = r.alertas || [];
  // atividades = null quando o usuário não pode ver a auditoria: o bloco não é exibido.
  if (r.pedidos_recentes === undefined) r.pedidos_recentes = null;
  const atual = Object.keys(opcoes).find((c) => opcoes[c][1] === r.periodo.de && opcoes[c][2] === r.periodo.ate) || 'personalizado';

  // Controle de período: atalhos + datas livres.
  const de = h('input', { type: 'date', value: r.periodo.de, 'aria-label': 'Data inicial' });
  const ate = h('input', { type: 'date', value: r.periodo.ate, 'aria-label': 'Data final' });
  const aplicar = () => { if (de.value && ate.value) ctx.navegar(`#/painel-executivo?de=${de.value}&ate=${ate.value}`); };
  const atalho = h('select', { 'aria-label': 'Período', onchange: (ev) => {
    const o = opcoes[ev.target.value];
    if (o) ctx.navegar(`#/painel-executivo?de=${o[1]}&ate=${o[2]}`); else de.focus();
  } }, ...Object.entries(opcoes).map(([c, [rot]]) => h('option', { value: c, selected: c === atual }, rot)),
  h('option', { value: 'personalizado', selected: atual === 'personalizado' }, 'Personalizado'));
  const periodo = h('div', { class: 'vg-periodo' },
    h('span', { class: 'vg-periodo-ic' }, icone(ICONES.calendario, 18)), atalho, de, h('span', { class: 'muted' }, '–'), ate,
    h('button', { class: 'btn', onclick: aplicar }, 'Aplicar'));

  // Indicadores principais (integrados ao fundo, separados por linhas finas).
  const destaque = (ic, rot, val, det, href) => h(href ? 'a' : 'div', { class: 'vg-kpi', href },
    h('div', { class: 'vg-kpi-rot' }, icone(ic), h('span', {}, rot)), h('div', { class: 'vg-kpi-val' }, val), h('div', { class: 'vg-kpi-det' }, det));
  const linhaKpi = h('section', { class: 'vg-kpis', 'aria-label': 'Indicadores principais' },
    destaque(ICONES.faturamento, 'Faturamento', valorMoeda(k.faturamento), `${numero(k.pedidos_faturados)} pedido(s) faturado(s)`, ctx.pode('relatorios.ler') ? '#/relatorios?r=vendas' : null),
    destaque(ICONES.ticket, 'Ticket médio', valorMoeda(k.ticket_medio), 'faturamento ÷ pedidos faturados', null),
    destaque(ICONES.itens, 'Itens vendidos', h('span', { class: 'vg-num' }, numero(k.itens_vendidos)), 'unidades em pedidos faturados', null),
    destaque(ICONES.receber, 'A receber', valorMoeda(k.receber_aberto), `${numero(k.receber_qtd)} título(s) em aberto`, ctx.pode('financeiro.ler') ? '#/financeiro/receber?situacao=ABERTO' : null));

  // Indicadores secundários, em linha compacta.
  const mini = (rot, val, det, href, nivel = '') => h(href ? 'a' : 'div', { class: `vg-mini ${nivel}`, href },
    h('span', { class: 'vg-mini-rot' }, rot), h('strong', {}, val), det ? h('span', { class: 'vg-mini-det' }, det) : null);
  const secundarios = h('section', { class: 'vg-minis', 'aria-label': 'Outros indicadores' },
    mini('Pedidos no período', numero(k.total_pedidos), 'exceto cancelados', ctx.pode('pedidos.ler') ? '#/pedidos' : null),
    mini('Pendentes de aprovação', numero(k.pedidos_pendentes), moeda(k.pedidos_pendentes_valor), ctx.pode('pedidos.ler') ? '#/pedidos?status=PENDENTE_APROVACAO' : null, k.pedidos_pendentes ? 'alerta' : ''),
    mini('Aprovados a faturar', numero(k.pedidos_a_faturar), moeda(k.pedidos_a_faturar_valor), ctx.pode('pedidos.ler') ? '#/pedidos?status=APROVADO' : null),
    mini('A pagar em aberto', moeda(k.pagar_aberto), `${numero(k.pagar_qtd)} título(s)`, ctx.pode('financeiro.ler') ? '#/financeiro/pagar?situacao=ABERTO' : null),
    mini('Estoque (custo)', moeda(k.estoque_valor_custo), `${numero(k.produtos_ativos)} produto(s) ativo(s)`, ctx.pode('estoque.ler') ? '#/estoque' : null),
    mini('Abaixo do mínimo', numero(k.produtos_abaixo_minimo), 'disponível < mínimo', ctx.pode('estoque.ler') ? '#/estoque?situacao=abaixo' : null, k.produtos_abaixo_minimo ? 'erro' : ''));

  // Faturamento mensal (linha suave) + itens por categoria (barras de trilho).
  const totalSeis = r.evolucao.reduce((sm, m) => sm + m.valor, 0);
  const graficoMensal = h('section', { class: 'vg-bloco', 'aria-labelledby': 'vg-g1' },
    h('div', { class: 'vg-bloco-cab' }, h('h2', { id: 'vg-g1' }, 'Faturamento mensal'), h('span', { class: 'muted' }, 'últimos 6 meses')),
    h('div', { class: 'vg-total' }, valorMoeda(totalSeis), h('span', { class: 'muted' }, 'total nos 6 meses')),
    linha({
      titulo: 'Faturamento mensal dos últimos 6 meses',
      dados: r.evolucao.map((m) => ({ rotulo: `${MESES[Number(m.mes.slice(5)) - 1]}/${m.mes.slice(2, 4)}`, valor: m.valor, detalhe: `${m.pedidos} pedido(s)` })),
      formatar: moeda, formatarEixo: moedaCurta, altura: 240,
    }));
  const maxGrupo = Math.max(...r.por_grupo.map((g) => g.quantidade), 0);
  const categorias = h('section', { class: 'vg-bloco', 'aria-labelledby': 'vg-g2' },
    h('div', { class: 'vg-bloco-cab' }, h('h2', { id: 'vg-g2' }, 'Itens vendidos por categoria'), h('span', { class: 'muted' }, 'no período')),
    r.por_grupo.length ? h('ul', { class: 'vg-trilhos' }, r.por_grupo.map((g) => h('li', { class: g.outros ? 'outros' : '' },
      h('div', { class: 'vg-trilho-cab' }, h('span', {}, g.grupo || 'Sem grupo'),
        h('span', { class: 'vg-trilho-val' }, numero(g.quantidade), h('small', {}, k.itens_vendidos ? ` · ${numero(Math.round((g.quantidade / k.itens_vendidos) * 1000) / 10)}%` : ''))),
      h('div', { class: 'vg-trilho', role: 'presentation' }, h('span', { style: `width:${maxGrupo ? Math.max(2, (g.quantidade / maxGrupo) * 100) : 0}%` })))))
      : h('p', { class: 'muted' }, 'Nenhum item faturado no período.'));

  // Pedidos recentes (só para quem pode ver pedidos).
  const recentes = r.pedidos_recentes ? h('section', { class: 'vg-bloco vg-recentes', 'aria-labelledby': 'vg-pr' },
    h('div', { class: 'vg-bloco-cab' }, h('h2', { id: 'vg-pr' }, 'Pedidos recentes'), h('a', { class: 'vg-ver-todos', href: '#/pedidos' }, 'Ver todos →')),
    r.pedidos_recentes.length ? h('div', { class: 'tabela-envolta' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Pedido'), h('th', { scope: 'col' }, 'Cliente'), h('th', { scope: 'col' }, 'Emissão'),
        h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col', class: 'num' }, 'Total'))),
      h('tbody', {}, r.pedidos_recentes.map((p) => h('tr', {},
        h('td', {}, h('a', { href: `#/pedidos/${p.id}` }, p.numero)), h('td', {}, p.cliente), h('td', {}, data(p.emissao)),
        h('td', {}, seloPedido(p.status)), h('td', { class: 'num' }, moeda(p.total)))))))
      : h('p', { class: 'muted' }, 'Nenhum pedido registrado.')) : null;

  const alertas = h('section', { class: 'vg-bloco', 'aria-labelledby': 'vg-al' },
    h('div', { class: 'vg-bloco-cab' }, h('h2', { id: 'vg-al' }, 'Alertas operacionais'), h('span', { class: 'muted' }, numero(r.alertas.length))),
    r.alertas.length ? h('ul', { class: 'lista-simples' }, r.alertas.map((a) => h('li', {},
      h('span', { class: `ic-nivel ${a.nivel}`, 'aria-label': a.nivel === 'critico' ? 'Crítico' : 'Atenção' }, a.nivel === 'critico' ? '✕' : '!'),
      h('a', { href: a.rota }, a.texto)))) : h('p', { class: 'muted' }, 'Nenhum alerta.'));
  const atividades = r.atividades ? h('section', { class: 'vg-bloco', 'aria-labelledby': 'vg-at' },
    h('div', { class: 'vg-bloco-cab' }, h('h2', { id: 'vg-at' }, 'Atividades recentes')),
    r.atividades.length ? h('ul', { class: 'lista-simples' }, r.atividades.map((a) => h('li', {}, h('span', {}, descreverAtividade(a)), h('span', { class: 'quando' }, dataHora(a.data_hora)))))
      : h('p', { class: 'muted' }, 'Nenhuma atividade.')) : null;

  raiz.append(
    cabecalho('Painel executivo', `Resultados estratégicos do negócio · ${data(r.periodo.de)} a ${data(r.periodo.ate)}`, periodo),
    linhaKpi, secundarios,
    h('div', { class: 'vg-duas' }, graficoMensal, categorias),
    recentes || '',
    atividades ? h('div', { class: 'vg-duas vg-duas-igual' }, alertas, atividades) : alertas);
  return raiz;
}
