import { get, post } from '../api.js';
import { h, cabecalho, tabelaRemota, tabela, formulario, modal, toast, numero, dataHora, selo, atrasar, carregando, falha, acoesLinha } from '../ui.js';

const ORIGENS = { SALDO_INICIAL: 'Saldo inicial', MANUAL: 'Manual', PEDIDO: 'Pedido de venda' };

export async function render(ctx) {
  const podeMov = ctx.pode('estoque.movimentar');
  const saldosEl = h('div');
  const filtroSaldo = { q: '', situacao: ctx.query.situacao || '' };

  async function carregarSaldos() {
    saldosEl.replaceChildren(carregando());
    try {
      const linhas = await get('/api/estoque/saldos', filtroSaldo);
      saldosEl.replaceChildren(tabela([
        { chave: 'codigo', titulo: 'Código' },
        { chave: 'descricao', titulo: 'Descrição', quebra: true },
        { chave: 'saldo', titulo: 'Saldo', num: true, render: (r) => `${numero(r.saldo)} ${r.unidade}` },
        { chave: 'reservado', titulo: 'Reservado', num: true, render: (r) => numero(r.reservado) },
        { chave: 'disponivel', titulo: 'Disponível', num: true, render: (r) => numero(r.disponivel) },
        { chave: 'estoque_minimo', titulo: 'Mínimo', num: true, render: (r) => numero(r.estoque_minimo) },
        { chave: 'abaixo_minimo', titulo: 'Situação', render: (r) => (r.abaixo_minimo ? selo('Abaixo do mínimo', 'erro') : selo('Normal', 'ok')) },
        { chave: 'acoes', titulo: 'Ações', render: (r) => acoesLinha(
          h('button', { class: 'btn btn-pequeno', onclick: () => { movs.produto_id = r.id; movs.pagina = 1; rotuloMovs.textContent = `Histórico de movimentações: ${r.codigo} - ${r.descricao}`; limpar.hidden = false; tMov.atualizar(); document.getElementById('sec-mov').scrollIntoView({ behavior: 'smooth' }); } }, 'Movimentações'),
          [podeMov ? { rotulo: 'Movimentar estoque', acao: () => novaMov(r) } : null]) },
      ], linhas, 'Nenhum produto com os filtros informados.'));
    } catch (e) { saldosEl.replaceChildren(falha(e, carregarSaldos)); }
  }

  const movs = { produto_id: ctx.query.produto || '', tipo: '', origem: '', de: '', ate: '', pagina: 1 };
  const tMov = tabelaRemota({
    estado: movs,
    carregar: (e) => get('/api/estoque/movimentos', e),
    rotuloVazio: 'Nenhuma movimentação.',
    colunas: [
      { chave: 'id', titulo: 'Nº' },
      { chave: 'data_hora', titulo: 'Data/hora', render: (m) => dataHora(m.data_hora) },
      { chave: 'produto', titulo: 'Produto', render: (m) => m.produto_codigo },
      { chave: 'tipo', titulo: 'Tipo', render: (m) => (m.tipo === 'E' ? selo('Entrada', 'ok') : selo('Saída', 'alerta')) },
      { chave: 'quantidade', titulo: 'Quantidade', num: true, render: (m) => numero(m.quantidade) },
      { chave: 'saldo_anterior', titulo: 'Saldo anterior', num: true, render: (m) => numero(m.saldo_anterior) },
      { chave: 'saldo_posterior', titulo: 'Saldo posterior', num: true, render: (m) => numero(m.saldo_posterior) },
      { chave: 'origem', titulo: 'Origem', render: (m) => `${ORIGENS[m.origem]}${m.referencia ? ' · ' + m.referencia : ''}` },
      { chave: 'motivo', titulo: 'Motivo', quebra: true },
      { chave: 'usuario', titulo: 'Usuário' },
    ],
  });

  async function novaMov(produto) {
    const f = formulario([
      { nome: 'produto', rotulo: 'Produto', col: 'c12', atributos: { readonly: true } },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrigatorio: true, col: 'c3', vazio: false, opcoes: [['E', 'Entrada'], ['S', 'Saída']] },
      { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'number', obrigatorio: true, col: 'c3', atributos: { min: '0.0001', step: 'any' } },
      { nome: 'referencia', rotulo: 'Documento de referência', col: 'c6', atributos: { maxlength: 30 } },
      { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, col: 'c12', atributos: { maxlength: 120, minlength: 5 } },
    ], { produto: `${produto.codigo} - ${produto.descricao} · saldo ${numero(produto.saldo)} · reservado ${numero(produto.reservado)} · disponível ${numero(produto.disponivel)}` });
    const msg = h('p', { class: 'erro-form', role: 'alert' });
    // Mesma chave enquanto o modal estiver aberto: duplo clique / reenvio não duplica a movimentação.
    const chave = crypto.randomUUID();
    const salvar = h('button', { class: 'btn btn-primario', onclick: gravar }, 'Registrar movimentação');
    const m = modal({ titulo: 'Movimentação de estoque', corpo: h('div', {}, f.el,
      h('p', { class: 'muted' }, 'Movimentações são imutáveis. Para corrigir um lançamento, registre um movimento inverso com o motivo.'), msg),
    rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), salvar] });
    async function gravar() {
      msg.textContent = '';
      const v = f.valores();
      const e = f.validarObrigatorios();
      if (v.quantidade !== '' && !(v.quantidade > 0)) e.quantidade = 'Deve ser maior que zero.';
      if (v.motivo && v.motivo.length < 5) e.motivo = 'Mínimo de 5 caracteres.';
      if (f.erros(e)) return;
      salvar.disabled = true;
      try {
        const r = await post('/api/estoque/movimentos', { produto_id: produto.id, tipo: v.tipo, quantidade: v.quantidade, motivo: v.motivo, referencia: v.referencia }, { idempotente: true, chave });
        toast(`Movimentação nº ${r.id} registrada. Saldo: ${numero(r.saldo_anterior)} → ${numero(r.saldo_posterior)}.`);
        m.fechar();
        carregarSaldos(); tMov.atualizar(); ctx.atualizarNotificacoes();
      } catch (err) { if (err.detalhes) f.erros(err.detalhes); msg.textContent = err.message; } finally { salvar.disabled = false; }
    }
  }

  const busca = h('input', { type: 'search', placeholder: 'Código ou descrição…', 'aria-label': 'Pesquisar saldos' });
  busca.addEventListener('input', atrasar(() => { filtroSaldo.q = busca.value; carregarSaldos(); }));
  const rotuloMovs = h('span', {}, 'Todas as movimentações');
  const limpar = h('button', { class: 'btn btn-pequeno', hidden: !movs.produto_id, onclick: () => { movs.produto_id = ''; movs.pagina = 1; rotuloMovs.textContent = 'Todas as movimentações'; limpar.hidden = true; tMov.atualizar(); } }, 'Mostrar todos os produtos');
  const filtroMov = (rot, chave, opcoes) => h('label', {}, rot, h('select', { onchange: (ev) => { movs[chave] = ev.target.value; movs.pagina = 1; tMov.atualizar(); } }, opcoes.map(([v, tx]) => h('option', { value: v }, tx))));
  const dataMov = (rot, chave) => h('label', {}, rot, h('input', { type: 'date', onchange: (ev) => { movs[chave] = ev.target.value; movs.pagina = 1; tMov.atualizar(); } }));

  if (movs.produto_id) {
    try { const p = await get(`/api/produtos/${movs.produto_id}`); rotuloMovs.textContent = `Histórico de movimentações: ${p.codigo} - ${p.descricao}`; } catch { /* filtro inválido é ignorado */ }
  }
  carregarSaldos();
  tMov.atualizar();
  return h('div', {},
    cabecalho('Controle de estoque', 'Acompanhe saldos, reservas e movimentações de produtos.'),
    h('section', { class: 'cartao' }, h('h2', {}, 'Saldos por produto'),
      h('div', { class: 'filtros', role: 'search' }, h('label', {}, 'Pesquisa', busca),
        h('label', {}, 'Situação', h('select', { onchange: (ev) => { filtroSaldo.situacao = ev.target.value; carregarSaldos(); } },
          h('option', { value: '' }, 'Todos'), h('option', { value: 'abaixo', selected: filtroSaldo.situacao === 'abaixo' }, 'Abaixo do mínimo')))),
      saldosEl),
    h('section', { class: 'cartao', id: 'sec-mov' }, h('h2', {}, rotuloMovs),
      h('div', { class: 'filtros' },
        filtroMov('Tipo', 'tipo', [['', 'Todos'], ['E', 'Entradas'], ['S', 'Saídas']]),
        filtroMov('Origem', 'origem', [['', 'Todas'], ...Object.entries(ORIGENS)]),
        dataMov('De', 'de'), dataMov('Até', 'ate'), limpar),
      tMov.el));
}
