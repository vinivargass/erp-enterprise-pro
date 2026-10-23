// Painel administrativo (somente ADMIN). Os dados vêm de /api/admin/*, que o servidor só
// entrega para quem tem a permissão 'admin.painel' — esta tela não decide nada sozinha.
import { get } from '../api.js';
import {
  h, moeda, moedaCurta, numero, data, dataHora, rotuloStatus, tabelaRemota, atrasar, falha, acessoNegado,
} from '../ui.js';
import { barrasVerticais, barrasHorizontais, linha, rosca } from '../grafico.js';
import { MESES } from '../idioma.js';

const rotuloMes = (m) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;

export function navAdmin(ctx, atual) {
  const itens = [['painel', 'Painel', 'admin.painel'], ['usuarios', 'Usuários e perfis', 'usuarios.gerir'], ['excluir', 'Excluir usuários', 'usuarios.gerir']].filter(([, , p]) => ctx.pode(p));
  return h('nav', { class: 'adm-nav', 'aria-label': 'Seções administrativas' },
    itens.map(([r, t]) => h('a', { href: `#/admin/${r}`, 'aria-current': r === atual ? 'page' : null }, t)));
}

export async function render(ctx) {
  ctx.migalhas(['Administração', 'Painel administrativo']);
  const filtros = { de: ctx.query.de || '', ate: ctx.query.ate || '', grupo: ctx.query.grupo || '', vendedor: ctx.query.vendedor || '' };

  let dados;
  try {
    dados = await get('/api/admin/painel', filtros);
  } catch (e) {
    if (e.status === 403) return acessoNegado();
    throw e;
  }
  Object.assign(filtros, dados.filtros);
  const k = dados.indicadores;
  const corpo = h('div');
  const atualizado = h('span', { class: 'atualizado', 'aria-live': 'polite' }, `Atualizado em ${dataHora(dados.atualizado_em)}`);

  // --- filtros (slicers)
  const inDe = h('input', { type: 'date', value: filtros.de });
  const inAte = h('input', { type: 'date', value: filtros.ate });
  const selGrupo = h('select', {}, h('option', { value: '' }, 'Todos'), dados.opcoes.grupos.map((g) => h('option', { value: g, selected: g === filtros.grupo }, g)));
  const selVend = h('select', {}, h('option', { value: '' }, 'Todos'), dados.opcoes.vendedores.map((v) => h('option', { value: v, selected: v === filtros.vendedor }, v)));
  const aplicar = () => {
    const q = new URLSearchParams(Object.entries({ de: inDe.value, ate: inAte.value, grupo: selGrupo.value, vendedor: selVend.value }).filter(([, v]) => v));
    const destino = `#/admin/painel${q.toString() ? '?' + q : ''}`;
    if (location.hash === destino) window.dispatchEvent(new HashChangeEvent('hashchange')); else ctx.navegar(destino);
  };
  const slicers = h('div', { class: 'slicers', role: 'search', 'aria-label': 'Filtros do painel' },
    h('label', {}, 'De', inDe), h('label', {}, 'Até', inAte),
    h('label', {}, 'Grupo de produto', selGrupo), h('label', {}, 'Vendedor', selVend),
    h('div', { class: 'acoes' },
      h('a', { class: 'btn', href: '#/admin/painel' }, 'Limpar'),
      h('button', { class: 'btn btn-primario', onclick: aplicar }, 'Aplicar filtros')));

  // --- indicadores
  const kpi = (rot, val, det, classe = '') => h('div', { class: `bi-kpi ${classe}` }, h('div', { class: 'rot' }, rot), h('div', { class: 'val' }, val), det ? h('div', { class: 'det' }, det) : null);
  const kpis = h('div', { class: 'bi-kpis' },
    kpi('Faturamento', moeda(k.faturamento), `${numero(k.pedidos)} pedido(s) faturado(s)`),
    kpi('Ticket médio', moeda(k.ticket_medio), `${numero(k.clientes_atendidos)} cliente(s) atendido(s)`),
    kpi('Margem bruta estimada', moeda(k.margem_estimada), `${numero(k.margem_pct)}% · usa o custo atual do produto`),
    kpi('Itens vendidos', numero(k.itens_vendidos), 'soma das quantidades'),
    kpi('A receber em aberto', moeda(k.receber_aberto), `vencido: ${moeda(k.receber_vencido)}`, k.receber_vencido > 0 ? 'alerta' : ''),
    kpi('A pagar em aberto', moeda(k.pagar_aberto), 'todos os vencimentos'),
    kpi('Usuários ativos', numero(k.usuarios_ativos), `${numero(k.administradores)} administrador(es) · ${numero(k.usuarios_total)} no total`),
    kpi('Acessos negados', numero(k.acessos_negados), 'tentativas sem permissão no período', k.acessos_negados > 0 ? 'erro' : ''));

  const vazio = (txt) => h('p', { class: 'estado' }, txt);
  const semVendas = k.pedidos === 0;
  const grade = h('div', { class: 'bi-grade' },
    h('section', { class: 'bi-tile c8', 'aria-labelledby': 't1' }, h('h2', { id: 't1' }, 'Faturamento mensal'),
      semVendas ? vazio('Sem vendas faturadas para os filtros escolhidos.') : linha({
        titulo: 'Faturamento mensal no período', formatar: moeda, formatarEixo: moedaCurta,
        dados: dados.evolucao.map((m) => ({ rotulo: rotuloMes(m.mes), valor: m.valor, detalhe: `${m.pedidos} pedido(s)` })),
      })),
    h('section', { class: 'bi-tile c4', 'aria-labelledby': 't2' }, h('h2', { id: 't2' }, 'Faturamento por grupo'),
      dados.por_grupo.length ? rosca({ titulo: 'Participação de cada grupo de produto no faturamento', formatar: moeda, dados: dados.por_grupo }) : vazio('Sem dados.')),
    h('section', { class: 'bi-tile c6', 'aria-labelledby': 't3' }, h('h2', { id: 't3' }, 'Pedidos por status (emitidos no período)'),
      dados.por_status.length ? barrasVerticais({
        titulo: 'Quantidade de pedidos por status', formatar: (v) => numero(v), altura: 220,
        dados: dados.por_status.map((s) => ({ rotulo: rotuloStatus(s.status).replace(' de aprovação', ''), valor: s.quantidade })),
      }) : vazio('Nenhum pedido emitido no período.')),
    h('section', { class: 'bi-tile c6', 'aria-labelledby': 't4' }, h('h2', { id: 't4' }, 'Top 5 clientes por faturamento'),
      dados.top_clientes.length ? barrasHorizontais({ titulo: 'Cinco clientes com maior faturamento', formatar: moedaCurta, dados: dados.top_clientes }) : vazio('Sem dados.')));

  // --- tabela detalhada (pesquisa, ordenação e paginação no servidor)
  const estadoTab = { ...filtros, q: '', ordem: 'data', direcao: 'desc', pagina: 1, tamanho: 10 };
  const tab = tabelaRemota({
    estado: estadoTab,
    carregar: (e) => get('/api/admin/vendas', e),
    rotuloVazio: 'Nenhuma venda encontrada para os filtros.',
    colunas: [
      { chave: 'data', titulo: 'Faturado em', ordenavel: true, render: (r) => data(r.data) },
      { chave: 'pedido', titulo: 'Pedido', ordenavel: true },
      { chave: 'cliente', titulo: 'Cliente', ordenavel: true, quebra: true },
      { chave: 'produto', titulo: 'Produto', ordenavel: true, quebra: true, render: (r) => `${r.produto_codigo} - ${r.produto}` },
      { chave: 'grupo', titulo: 'Grupo', ordenavel: true },
      { chave: 'quantidade', titulo: 'Qtd', ordenavel: true, num: true, render: (r) => numero(r.quantidade) },
      { chave: 'total', titulo: 'Total', ordenavel: true, num: true, render: (r) => moeda(r.total) },
      { chave: 'vendedor', titulo: 'Vendedor' },
    ],
  });
  const busca = h('input', { type: 'search', placeholder: 'Pedido, cliente ou produto…', 'aria-label': 'Pesquisar vendas' });
  busca.addEventListener('input', atrasar(() => { estadoTab.q = busca.value; estadoTab.pagina = 1; tab.atualizar(); }));
  const selTam = h('select', { 'aria-label': 'Linhas por página', onchange: (ev) => { estadoTab.tamanho = Number(ev.target.value); estadoTab.pagina = 1; tab.atualizar(); } },
    [10, 25, 50].map((n) => h('option', { value: n }, `${n} por página`)));
  tab.atualizar();

  const atualizar = h('button', { class: 'btn', onclick: async () => {
    atualizar.disabled = true;
    atualizado.textContent = 'Atualizando…';
    try {
      const novo = await render(ctx);
      document.getElementById('conteudo').replaceChildren(novo);
    } catch (e) {
      atualizado.textContent = 'Falha ao atualizar.';
      corpo.prepend(falha(e));
    } finally { atualizar.disabled = false; }
  } }, 'Atualizar dados');

  corpo.append(
    h('div', { class: 'adm-cab' }, h('h1', {}, 'Painel administrativo', h('span', { class: 'selo info selo-admin' }, 'Admin')), atualizado, atualizar),
    navAdmin(ctx, 'painel'),
    h('p', { class: 'muted', style: 'margin:-6px 0 12px' }, `Período: ${data(filtros.de)} a ${data(filtros.ate)}${filtros.grupo ? ' · grupo ' + filtros.grupo : ''}${filtros.vendedor ? ' · vendedor ' + filtros.vendedor : ''}. Dados reais do banco da aplicação (demonstração).`),
    slicers, kpis, grade,
    h('section', { class: 'bi-tile c12', style: 'margin-top:12px', 'aria-labelledby': 't5' }, h('h2', { id: 't5' }, 'Vendas detalhadas por item'),
      h('div', { class: 'filtros' }, h('label', {}, 'Pesquisa', busca), h('label', {}, 'Exibir', selTam)), tab.el));
  return corpo;
}

