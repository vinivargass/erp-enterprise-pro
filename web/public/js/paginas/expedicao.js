// Expedição (perfil Estoque): pedidos aprovados ou faturados para separar e entregar.
// O servidor só envia o necessário para a separação: cliente, endereço, itens e quantidades.
// Preços, totais, custos e crédito nunca chegam a esta tela.
import { get } from '../api.js';
import { h, cabecalho, tabelaRemota, tabela, numero, data, selo, atrasar, mascaraCep } from '../ui.js';

const SELO = { APROVADO: ['Aprovado · a separar', 'alerta'], FATURADO: ['Faturado', 'ok'] };
const seloStatus = (s) => selo(...(SELO[s] || [s, 'neutro']));

export async function render(ctx) {
  const estado = { q: '', status: ctx.query.status || 'APROVADO', pagina: 1 };
  const t = tabelaRemota({
    estado,
    carregar: (e) => get('/api/expedicao', e),
    rotuloVazio: 'Nenhum pedido aguardando expedição.',
    colunas: [
      { chave: 'numero', titulo: 'Pedido' },
      { chave: 'emissao', titulo: 'Emissão', render: (p) => data(p.emissao) },
      { chave: 'cliente_nome', titulo: 'Cliente', quebra: true },
      { chave: 'destino', titulo: 'Destino', render: (p) => `${p.municipio}/${p.uf}` },
      { chave: 'qtd_itens', titulo: 'Itens', num: true },
      { chave: 'status', titulo: 'Situação', render: (p) => seloStatus(p.status) },
      { chave: 'acoes', titulo: 'Ações', render: (p) => h('a', { class: 'btn btn-pequeno', href: `#/expedicao/${p.id}` }, 'Separar') },
    ],
  });
  const recarregar = () => { estado.pagina = 1; t.atualizar(); };
  const busca = h('input', { type: 'search', placeholder: 'Pedido ou cliente…', 'aria-label': 'Pesquisar pedidos na expedição' });
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; recarregar(); }));
  t.atualizar();
  return h('div', {},
    cabecalho('Expedição', 'Pedidos aprovados para separar e entregar. Sem preços, valores ou custos.'),
    h('div', { class: 'filtros', role: 'search' },
      h('label', {}, 'Pesquisa', busca),
      h('label', {}, 'Situação', h('select', { onchange: (ev) => { estado.status = ev.target.value; recarregar(); } },
        [['APROVADO', 'A separar (aprovados)'], ['FATURADO', 'Faturados'], ['', 'Todos']]
          .map(([v, tx]) => h('option', { value: v, selected: estado.status === v }, tx))))),
    t.el);
}

export async function renderDetalhe(ctx) {
  const p = await get(`/api/expedicao/${ctx.params[0]}`);
  ctx.migalhas(['Operações', ['Expedição', '#/expedicao'], `Pedido ${p.numero}`]);
  const c = p.cliente;
  return h('div', {},
    cabecalho(`Separação do pedido ${p.numero}`, `Emitido em ${data(p.emissao)}`,
      h('button', { class: 'btn', onclick: () => window.print() }, 'Imprimir lista'),
      h('a', { class: 'btn', href: '#/expedicao' }, 'Voltar')),
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Itens a separar'),
        tabela([
          { chave: 'item', titulo: 'Item' },
          { chave: 'produto_codigo', titulo: 'Código' },
          { chave: 'produto_descricao', titulo: 'Descrição', quebra: true },
          { chave: 'quantidade', titulo: 'Quantidade', num: true, render: (i) => `${numero(i.quantidade)} ${i.unidade}` },
        ], p.itens, 'Pedido sem itens.'),
        p.observacao ? h('p', { class: 'muted' }, 'Observação: ', p.observacao) : null),
      h('section', { class: 'cartao' }, h('h2', {}, 'Entrega'),
        h('p', { style: 'margin:0' }, seloStatus(p.status)),
        h('p', {}, h('strong', {}, `${c.codigo} - ${c.razao_social}`), c.nome_fantasia ? h('br') : null, c.nome_fantasia || ''),
        h('p', { class: 'muted' }, `${c.logradouro}, ${c.numero}${c.complemento ? ' - ' + c.complemento : ''}`, h('br'),
          `${c.bairro} · ${c.municipio}/${c.uf} · CEP ${mascaraCep(c.cep)}`, c.telefone ? h('br') : null, c.telefone || ''))));
}
