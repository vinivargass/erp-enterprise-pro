import { get } from '../api.js';
import { h, cabecalho, tabela, moeda, numero, data, dataHora, carregando, falha, hojeIso } from '../ui.js';

const ROT_FILTRO = { de: 'Data inicial', ate: 'Data final', cliente_id: 'Cliente', produto_id: 'Produto', status: 'Status do pedido', situacao: 'Situação', tipo: 'Tipo' };

export async function render(ctx) {
  // O catálogo vem filtrado pelo servidor (só relatórios cujos dados o perfil pode ler).
  // As listas de filtro só são buscadas quando o perfil pode ler clientes/produtos.
  const vazio = { itens: [] };
  const [catalogo, clientes, produtos] = await Promise.all([
    get('/api/relatorios'),
    ctx.pode('clientes.ler') ? get('/api/clientes', { tamanho: 100, status: '', ordem: 'razao_social' }) : vazio,
    ctx.pode('produtos.ler') ? get('/api/produtos', { tamanho: 100, status: '' }) : vazio,
  ]);
  if (!catalogo.length) {
    return h('div', {}, cabecalho('Relatórios', ''), h('div', { class: 'estado' }, 'Nenhum relatório disponível para o seu perfil.'));
  }
  let atual = catalogo.find((r) => r.id === ctx.query.r) || catalogo[0];
  const filtrosEl = h('div', { class: 'filtros' });
  const resultado = h('div');
  const valores = {};
  const inicioMes = hojeIso().slice(0, 8) + '01';

  function controle(f) {
    const set = (ev) => { valores[f] = ev.target.value; };
    if (f === 'de' || f === 'ate') {
      valores[f] ??= atual.id === 'vendas' || atual.id === 'movimentacoes' ? (f === 'de' ? inicioMes : hojeIso()) : '';
      return h('input', { type: 'date', value: valores[f], onchange: set });
    }
    const opcoes = {
      cliente_id: clientes.itens.map((c) => [c.id, `${c.codigo} - ${c.razao_social}`]),
      produto_id: produtos.itens.map((p) => [p.id, `${p.codigo} - ${p.descricao}`]),
      status: ['RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADO', 'REJEITADO', 'CANCELADO', 'FATURADO'].map((s) => [s, s]),
      situacao: [['ABERTO', 'Aberto'], ['PARCIAL', 'Parcial'], ['LIQUIDADO', 'Liquidado']],
      tipo: [['E', 'Entradas'], ['S', 'Saídas']],
    }[f];
    if (!opcoes.length && (f === 'cliente_id' || f === 'produto_id')) return null; // sem permissão para a lista: filtro some
    return h('select', { onchange: set }, h('option', { value: '' }, 'Todos'), opcoes.map(([v, t]) => h('option', { value: v, selected: String(valores[f]) === String(v) }, t)));
  }

  function montarFiltros() {
    for (const k of Object.keys(valores)) delete valores[k];
    filtrosEl.replaceChildren(
      h('label', {}, 'Relatório', h('select', { onchange: (ev) => { atual = catalogo.find((r) => r.id === ev.target.value); montarFiltros(); resultado.replaceChildren(); } },
        catalogo.map((r) => h('option', { value: r.id, selected: r.id === atual.id }, r.titulo)))),
      ...atual.filtros.map((f) => { const c = controle(f); return c ? h('label', {}, ROT_FILTRO[f], c) : null; }).filter(Boolean), // replaceChildren escreveria "null"
      h('button', { class: 'btn btn-primario', onclick: executar }, 'Gerar'),
      h('button', { class: 'btn', onclick: exportar }, 'Exportar CSV'));
  }

  const fmt = { moeda, numero, data, datahora: dataHora };
  async function executar() {
    resultado.replaceChildren(carregando('Gerando relatório'));
    try {
      const r = await get(`/api/relatorios/${atual.id}`, valores);
      const somaveis = r.colunas.filter((c) => c.tipo === 'moeda');
      resultado.replaceChildren(
        h('p', { class: 'muted' }, `${r.linhas.length} linha(s) · gerado em ${dataHora(r.gerado_em)}`),
        tabela(r.colunas.map((c) => ({ ...c, titulo: c.titulo, num: c.tipo === 'moeda' || c.tipo === 'numero', quebra: c.chave === 'motivo' || c.chave === 'motivo_status', render: (l) => (fmt[c.tipo] ? fmt[c.tipo](l[c.chave]) : l[c.chave]) })), r.linhas, 'Nenhum dado para os filtros informados.'),
        r.linhas.length > 0 && somaveis.length > 0 ? h('div', { class: 'totais' }, somaveis.map((c) => h('div', {}, h('span', {}, `Total ${c.titulo.toLowerCase()}`), h('strong', {}, moeda(r.linhas.reduce((s, l) => s + (l[c.chave] || 0), 0)))))) : ''); // '' em vez de null: replaceChildren escreveria "null"
    } catch (e) { resultado.replaceChildren(falha(e, executar)); }
  }

  function exportar() {
    // Download direto da rota; o servidor gera o CSV (UTF-8 com BOM, ';', vírgula decimal).
    const qs = new URLSearchParams(Object.entries({ ...valores, formato: 'csv' }).filter(([, v]) => v !== '' && v != null));
    const a = h('a', { href: `/api/relatorios/${atual.id}?${qs}`, download: '' });
    document.body.append(a); a.click(); a.remove();
  }

  montarFiltros();
  if (ctx.query.r) executar();
  return h('div', {},
    cabecalho('Relatórios', 'Consulte os resultados e exporte as informações em CSV, compatível com o Excel.'),
    h('section', { class: 'cartao' }, filtrosEl, resultado));
}
