import { get, post } from '../api.js';
import { h, cabecalho, tabelaRemota, tabela, formulario, modal, toast, toastErro, moeda, data, dataHora, seloTitulo, atrasar, hojeIso, carregando, falha } from '../ui.js';

export async function render(ctx) {
  const tipo = ctx.params[0]; // receber | pagar
  const receber = tipo === 'receber';
  ctx.migalhas(['Financeiro', receber ? 'Contas a receber' : 'Contas a pagar']);
  const estado = { situacao: ctx.query.situacao || 'ABERTO', venc_de: '', venc_ate: '', q: '', ordem: 'vencimento', direcao: 'asc', pagina: 1 };
  const podeLiquidar = ctx.pode('financeiro.liquidar');

  const t = tabelaRemota({
    estado,
    carregar: (e) => get(`/api/financeiro/${tipo}`, e),
    rotuloVazio: 'Nenhum título com esses filtros.',
    colunas: [
      { chave: 'numero', titulo: 'Título', ordenavel: true, render: (x) => x.numero + (x.parcela ? '/' + x.parcela : '') },
      { chave: 'participante', titulo: receber ? 'Cliente' : 'Fornecedor', quebra: true },
      { chave: 'emissao', titulo: 'Emissão', ordenavel: true, render: (x) => data(x.emissao) },
      { chave: 'vencimento', titulo: 'Vencimento', ordenavel: true, render: (x) => data(x.vencimento) },
      { chave: 'valor', titulo: 'Valor', ordenavel: true, num: true, render: (x) => moeda(x.valor) },
      { chave: 'saldo', titulo: 'Saldo em aberto', ordenavel: true, num: true, render: (x) => moeda(x.saldo) },
      { chave: 'situacao', titulo: 'Situação', render: seloTitulo },
      { chave: 'data_liquidacao', titulo: 'Liquidação', render: (x) => data(x.data_liquidacao) },
      { chave: 'acoes', titulo: 'Ações', render: (x) => h('div', { class: 'acoes-linha' },
        h('button', { class: 'btn btn-pequeno', onclick: () => detalhar(x.id) }, 'Consultar'),
        podeLiquidar && x.situacao !== 'LIQUIDADO' ? h('button', { class: 'btn btn-pequeno btn-primario', onclick: () => liquidar(x) }, 'Liquidar') : null) },
    ],
  });

  async function detalhar(id) {
    const corpo = h('div', {}, carregando());
    modal({ titulo: 'Consulta de título', corpo, tamanho: 'pequeno' });
    try {
      const x = await get(`/api/financeiro/titulos/${id}`);
      corpo.replaceChildren(
        h('p', { style: 'margin-top:0' }, h('strong', {}, `${x.numero}${x.parcela ? '/' + x.parcela : ''}`), ' · ', x.participante),
        h('p', {}, `Emissão ${data(x.emissao)} · vencimento ${data(x.vencimento)}`, h('br'), `Valor ${moeda(x.valor)} · saldo ${moeda(x.saldo)}`, h('br'), x.historico),
        h('h2', {}, 'Baixas'),
        tabela([
          { chave: 'data', titulo: 'Data', render: (b) => data(b.data) },
          { chave: 'valor', titulo: 'Valor', num: true, render: (b) => moeda(b.valor) },
          { chave: 'usuario', titulo: 'Usuário' },
          { chave: 'data_hora', titulo: 'Registrado em', render: (b) => dataHora(b.data_hora) },
        ], x.baixas, 'Nenhuma baixa registrada.'));
    } catch (e) { corpo.replaceChildren(falha(e)); }
  }

  function liquidar(x) {
    const f = formulario([
      { nome: 'valor', rotulo: 'Valor da baixa (R$)', tipo: 'number', obrigatorio: true, col: 'c6', atributos: { min: '0.01', max: x.saldo, step: '0.01' } },
      { nome: 'data', rotulo: 'Data da liquidação', tipo: 'date', obrigatorio: true, col: 'c6', atributos: { max: hojeIso(), min: x.emissao } },
    ], { valor: x.saldo, data: hojeIso() });
    const msg = h('p', { class: 'erro-form', role: 'alert' });
    const chave = crypto.randomUUID(); // mesma chave em reenvios: impede baixa duplicada
    const ok = h('button', { class: 'btn btn-primario', onclick: gravar }, 'Confirmar liquidação');
    const m = modal({
      titulo: `Liquidar título ${x.numero}${x.parcela ? '/' + x.parcela : ''}`, tamanho: 'pequeno',
      corpo: h('div', {}, h('p', { style: 'margin-top:0' }, `${x.participante} · saldo em aberto ${moeda(x.saldo)}`), f.el,
        h('p', { class: 'muted' }, 'Liquidação demonstrativa: não movimenta banco nem gera documento oficial. Valor menor que o saldo gera baixa parcial.'), msg),
      rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), ok],
    });
    async function gravar() {
      msg.textContent = '';
      const v = f.valores();
      const e = f.validarObrigatorios();
      if (v.valor !== '' && !(v.valor > 0)) e.valor = 'Deve ser maior que zero.';
      if (v.valor > x.saldo) e.valor = 'Maior que o saldo em aberto.';
      if (f.erros(e)) return;
      ok.disabled = true;
      try {
        const r = await post(`/api/financeiro/titulos/${x.id}/liquidar`, { ...v, versao: x.versao }, { idempotente: true, chave });
        toast(r.situacao === 'LIQUIDADO' ? `Título ${r.numero} liquidado.` : `Baixa parcial registrada. Saldo: ${moeda(r.saldo)}.`);
        m.fechar(); t.atualizar(); ctx.atualizarNotificacoes();
      } catch (err) { if (err.detalhes) f.erros(err.detalhes); msg.textContent = err.message; if (err.status === 409) t.atualizar(); } finally { ok.disabled = false; }
    }
  }

  const recarregar = () => { estado.pagina = 1; t.atualizar(); };
  const busca = h('input', { type: 'search', placeholder: 'Título ou nome…', 'aria-label': 'Pesquisar títulos' });
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; recarregar(); }));
  const dt = (rot, chave) => h('label', {}, rot, h('input', { type: 'date', onchange: (ev) => { estado[chave] = ev.target.value; recarregar(); } }));
  t.atualizar();
  return h('div', {},
    cabecalho(receber ? 'Contas a receber' : 'Contas a pagar',
      `Financeiro demonstrativo · equivalente Protheus: ${receber ? 'SE1 / baixa FINA070' : 'SE2 / baixa FINA080'} — ZERPFIN.PRW · sem integração bancária`),
    h('div', { class: 'abas' },
      h('a', { href: '#/financeiro/receber', 'aria-current': receber ? 'page' : null }, 'Contas a receber'),
      h('a', { href: '#/financeiro/pagar', 'aria-current': receber ? null : 'page' }, 'Contas a pagar')),
    h('div', { class: 'filtros', role: 'search' },
      h('label', {}, 'Pesquisa', busca),
      h('label', {}, 'Situação', h('select', { onchange: (ev) => { estado.situacao = ev.target.value; recarregar(); } },
        [['ABERTO', 'Em aberto (inclui parciais)'], ['VENCIDO', 'Vencidos'], ['PARCIAL', 'Parciais'], ['LIQUIDADO', 'Liquidados'], ['', 'Todos']]
          .map(([v, tx]) => h('option', { value: v, selected: estado.situacao === v }, tx)))),
      dt('Vencimento de', 'venc_de'), dt('Vencimento até', 'venc_ate')),
    t.el);
}
