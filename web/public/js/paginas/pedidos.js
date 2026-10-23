import { get, post, put } from '../api.js';
import {
  h, cabecalho, tabelaRemota, tabela, confirmar, toast, toastErro, moeda, numero, data, dataHora, documento,
  seloPedido, rotuloStatus, atrasar, selo,
} from '../ui.js';

const STATUS = ['RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADO', 'REJEITADO', 'CANCELADO', 'FATURADO'];

export async function renderLista(ctx) {
  const estado = { status: ctx.query.status || '', q: ctx.query.q || '', de: '', ate: '', ordem: 'numero', direcao: 'desc', pagina: 1 };
  const t = tabelaRemota({
    estado,
    carregar: (e) => get('/api/pedidos', e),
    rotuloVazio: 'Nenhum pedido encontrado.',
    colunas: [
      { chave: 'numero', titulo: 'Pedido', ordenavel: true, render: (p) => h('a', { href: `#/pedidos/${p.id}` }, p.numero) },
      { chave: 'emissao', titulo: 'Emissão', ordenavel: true, render: (p) => data(p.emissao) },
      { chave: 'cliente', titulo: 'Cliente', ordenavel: true, quebra: true, render: (p) => `${p.cliente_codigo} - ${p.cliente_nome}` },
      { chave: 'total', titulo: 'Total', ordenavel: true, num: true, render: (p) => moeda(p.total_liquido) },
      { chave: 'status', titulo: 'Status', ordenavel: true, render: (p) => seloPedido(p.status) },
      { chave: 'vendedor', titulo: 'Vendedor' },
      { chave: 'acoes', titulo: '', render: (p) => h('a', { class: 'btn btn-pequeno', href: `#/pedidos/${p.id}` }, 'Abrir') },
    ],
  });
  const recarregar = () => { estado.pagina = 1; t.atualizar(); };
  const busca = h('input', { type: 'search', placeholder: 'Número ou cliente…', value: estado.q, 'aria-label': 'Pesquisar pedidos' });
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; recarregar(); }));
  const dataInput = (chave, rot) => h('label', {}, rot, h('input', { type: 'date', onchange: (ev) => { estado[chave] = ev.target.value; recarregar(); } }));
  t.atualizar();
  return h('div', {},
    cabecalho('Pedidos de venda', 'Acompanhe os pedidos, da criação ao faturamento.',
      ctx.pode('pedidos.gravar') ? h('a', { class: 'btn btn-primario', href: '#/pedidos/novo' }, '+ Novo pedido') : null),
    h('div', { class: 'abas', role: 'navigation', 'aria-label': 'Filtrar por status' },
      [['', 'Todos'], ...STATUS.map((st) => [st, rotuloStatus(st)])].map(([st, rot]) =>
        h('a', { href: st ? `#/pedidos?status=${st}` : '#/pedidos', 'aria-current': estado.status === st ? 'page' : null }, rot))),
    h('div', { class: 'filtros', role: 'search' }, h('label', {}, 'Pesquisa', busca), dataInput('de', 'Emissão de'), dataInput('ate', 'Emissão até')),
    t.el);
}

// ---------- Inclusão / alteração ----------
export async function renderEdicao(ctx) {
  const id = ctx.params[0];
  if (!ctx.pode('pedidos.gravar')) throw new Error('Seu perfil não pode incluir ou alterar pedidos.');
  const [clientes, produtos, params] = await Promise.all([
    get('/api/clientes', { status: 'ativo', tamanho: 100, ordem: 'razao_social' }),
    get('/api/produtos', { status: 'ativo', tamanho: 100 }),
    get('/api/parametros'),
  ]);
  const p = id ? await get(`/api/pedidos/${id}`) : null;
  if (p && !['RASCUNHO', 'REJEITADO'].includes(p.status)) throw new Error(`Pedido ${p.numero} está ${rotuloStatus(p.status)} e não pode ser alterado.`);
  const param = Object.fromEntries(params.map((x) => [x.chave, Number(x.valor) || x.valor]));
  const prodPorId = new Map(produtos.itens.map((x) => [x.id, x]));
  let itens = p ? p.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, desconto_pct: i.desconto_pct })) : [];

  const selCliente = h('select', { id: 'cli', required: true },
    h('option', { value: '' }, 'Selecione o cliente…'),
    clientes.itens.map((c) => h('option', { value: c.id, selected: p?.cliente.id === c.id }, `${c.codigo} - ${c.razao_social} (${documento(c.documento)})`)));
  const infoCredito = h('div', { class: 'muted', 'aria-live': 'polite' });
  const obs = h('textarea', { rows: 2, maxlength: 250, id: 'obs' }, p?.observacao || '');
  const corpoItens = h('tbody');
  const totais = h('div', { class: 'totais' });
  const msg = h('p', { class: 'erro-form', role: 'alert' });

  async function mostrarCredito() {
    infoCredito.textContent = '';
    if (!selCliente.value) return;
    try {
      const c = await get(`/api/clientes/${selCliente.value}`);
      // sem 'clientes.credito' o servidor não envia o limite: não mostra nada
      if (c.limite_credito === undefined) { delete infoCredito.dataset.disp; calcular(); return; }
      infoCredito.textContent = `Limite ${moeda(c.limite_credito)} · comprometido ${moeda(c.credito_utilizado)} · disponível ${moeda(c.credito_disponivel)}`;
      infoCredito.dataset.disp = c.credito_disponivel;
      calcular();
    } catch (e) { infoCredito.textContent = e.message; }
  }
  selCliente.addEventListener('change', mostrarCredito);

  function calcular() {
    let bruto = 0; let liquido = 0;
    for (const it of itens) {
      const pr = prodPorId.get(it.produto_id);
      if (!pr) continue;
      const b = Math.round(pr.preco_venda * 100 * it.quantidade) / 100;
      bruto += b;
      liquido += Math.round(b * (1 - (it.desconto_pct || 0) / 100) * 100) / 100;
    }
    const disp = Number(infoCredito.dataset.disp);
    const alertaCred = selCliente.value && Number.isFinite(disp) && liquido > disp;
    const maiorDesc = Math.max(0, ...itens.map((i) => i.desconto_pct || 0));
    totais.replaceChildren(...[
      h('div', {}, h('span', {}, 'Total bruto'), h('strong', {}, moeda(bruto))),
      h('div', {}, h('span', {}, 'Descontos'), h('strong', {}, moeda(bruto - liquido))),
      h('div', {}, h('span', {}, 'Total do pedido'), h('strong', {}, moeda(liquido))),
      alertaCred ? h('div', { class: 'aviso alerta' }, 'Total acima do crédito disponível: o envio seguirá a política ZZ_CREDPOL.') : null,
      maiorDesc > param.ZZ_DESCMXV ? h('div', { class: 'aviso alerta' }, `Desconto acima de ${param.ZZ_DESCMXV}%: exigirá aprovação gerencial.`) : null].filter(Boolean)); // replaceChildren escreveria "null" como texto
  }

  function desenharItens() {
    corpoItens.replaceChildren(...itens.map((it, idx) => {
      const pr = prodPorId.get(it.produto_id);
      const qtd = h('input', { type: 'number', min: '0.0001', step: 'any', value: it.quantidade, style: 'width:100px', 'aria-label': 'Quantidade',
        oninput: (ev) => { it.quantidade = Number(ev.target.value); atualizarLinha(); } });
      const desc = h('input', { type: 'number', min: 0, max: param.ZZ_DESCMXG, step: '0.01', value: it.desconto_pct || 0, style: 'width:80px', 'aria-label': 'Desconto %',
        oninput: (ev) => { it.desconto_pct = Number(ev.target.value); atualizarLinha(); } });
      const total = h('td', { class: 'num' });
      const disp = h('td', { class: 'num' });
      function atualizarLinha() {
        const b = pr.preco_venda * (it.quantidade || 0);
        total.textContent = moeda(Math.round(b * (1 - (it.desconto_pct || 0) / 100) * 100) / 100);
        disp.replaceChildren(it.quantidade > pr.disponivel ? selo(`${numero(pr.disponivel)} (insuficiente)`, 'erro') : numero(pr.disponivel));
        calcular();
      }
      const tr = h('tr', {}, h('td', {}, String(idx + 1).padStart(2, '0')), h('td', { class: 'quebra' }, `${pr.codigo} - ${pr.descricao}`), h('td', {}, pr.unidade),
        h('td', {}, qtd), h('td', { class: 'num' }, moeda(pr.preco_venda)), h('td', {}, desc), total, disp,
        h('td', {}, h('button', { class: 'btn btn-pequeno btn-perigo', 'aria-label': `Remover ${pr.codigo}`, onclick: () => { itens.splice(idx, 1); desenharItens(); } }, 'Remover')));
      atualizarLinha();
      return tr;
    }));
    if (!itens.length) corpoItens.append(h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'Nenhum item. Adicione produtos abaixo.')));
    calcular();
  }

  const selProduto = h('select', { 'aria-label': 'Produto a adicionar' }, h('option', { value: '' }, 'Selecione um produto…'),
    produtos.itens.filter((x) => x.tipo !== 'MP').map((x) => h('option', { value: x.id }, `${x.codigo} - ${x.descricao} · ${moeda(x.preco_venda)} · disp. ${numero(x.disponivel)}`)));
  const btnAdd = h('button', { class: 'btn', onclick: () => {
    const pid = Number(selProduto.value);
    if (!pid) { selProduto.focus(); return; }
    if (itens.some((i) => i.produto_id === pid)) { toast('Produto já está no pedido; ajuste a quantidade.', 'alerta'); return; }
    itens.push({ produto_id: pid, quantidade: 1, desconto_pct: 0 });
    selProduto.value = '';
    desenharItens();
  } }, 'Adicionar item');

  const salvar = h('button', { class: 'btn btn-primario', onclick: () => gravar(false) }, 'Salvar rascunho');
  const salvarEnviar = h('button', { class: 'btn btn-primario', onclick: () => gravar(true) }, 'Salvar e enviar para aprovação');

  async function gravar(enviar) {
    msg.textContent = '';
    if (!selCliente.value) { msg.textContent = 'Selecione o cliente.'; selCliente.focus(); return; }
    if (!itens.length) { msg.textContent = 'Inclua ao menos um item.'; selProduto.focus(); return; }
    if (itens.some((i) => !(i.quantidade > 0))) { msg.textContent = 'Todas as quantidades devem ser maiores que zero.'; return; }
    if (itens.some((i) => i.desconto_pct < 0 || i.desconto_pct > param.ZZ_DESCMXG)) { msg.textContent = `Desconto deve estar entre 0% e ${param.ZZ_DESCMXG}%.`; return; }
    const corpo = { cliente_id: Number(selCliente.value), observacao: obs.value, itens };
    salvar.disabled = salvarEnviar.disabled = true;
    try {
      let r = p ? await put(`/api/pedidos/${p.id}`, { ...corpo, versao: p.versao }) : await post('/api/pedidos', corpo, { idempotente: true });
      if (enviar) {
        try {
          r = await post(`/api/pedidos/${r.id}/enviar`, { versao: r.versao });
          toast(`Pedido ${r.numero}: ${rotuloStatus(r.status)}. ${r.motivo_status}`, r.status === 'APROVADO' ? 'ok' : 'alerta');
        } catch (e) { toastErro(e, `Pedido ${r.numero} salvo como rascunho, mas não foi enviado`); }
      } else toast(`Pedido ${r.numero} salvo como rascunho.`);
      ctx.atualizarNotificacoes();
      ctx.navegar(`#/pedidos/${r.id}`);
    } catch (e) {
      msg.textContent = e.message + (e.detalhes?.itens ? ' ' + Object.entries(e.detalhes.itens).map(([i, d]) => `Item ${Number(i) + 1}: ${Object.values(d).join(' ')}`).join(' ') : '');
    } finally { salvar.disabled = salvarEnviar.disabled = false; }
  }

  ctx.migalhas(['Operações', ['Pedidos de venda', '#/pedidos'], p ? `Editar pedido ${p.numero}` : 'Novo pedido']);
  desenharItens();
  if (p) mostrarCredito();
  return h('div', {},
    cabecalho(p ? `Editar pedido ${p.numero}` : 'Novo pedido de venda', 'Preços vêm do cadastro do produto; o servidor recalcula tudo ao gravar.'),
    h('section', { class: 'cartao' }, h('h2', {}, '1. Cliente'),
      h('div', { class: 'form-grade' },
        h('div', { class: 'campo c8' }, h('label', { for: 'cli' }, 'Cliente ', h('span', { class: 'obrig' }, '*')), selCliente, infoCredito),
        h('div', { class: 'campo c12' }, h('label', { for: 'obs' }, 'Observação'), obs))),
    h('section', { class: 'cartao' }, h('h2', {}, '2. Itens'),
      h('div', { class: 'filtros' }, selProduto, btnAdd),
      h('div', { class: 'tabela-envolta' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Item', 'Produto', 'UM', 'Quantidade', 'Preço unit.', 'Desc. %', 'Total', 'Disponível', ''].map((x, i) => h('th', { class: [4, 6, 7].includes(i) ? 'num' : '' }, x)))),
        corpoItens)),
      totais,
      h('p', { class: 'muted' }, `Desconto até ${param.ZZ_DESCMXV}% sem aprovação; até ${param.ZZ_DESCMXG}% com aprovação gerencial (parâmetros ZZ_DESCMXV / ZZ_DESCMXG).`)),
    h('div', { class: 'cartao' }, msg, h('div', { class: 'acoes', style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end' },
      h('a', { class: 'btn', href: p ? `#/pedidos/${p.id}` : '#/pedidos' }, 'Cancelar edição'), salvar, salvarEnviar)));
}

// ---------- Consulta / ações ----------
export async function renderDetalhe(ctx) {
  const p = await get(`/api/pedidos/${ctx.params[0]}`);
  ctx.migalhas(['Operações', ['Pedidos de venda', '#/pedidos'], `Pedido ${p.numero}`]);
  const recarregar = () => { ctx.atualizarNotificacoes(); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  async function acao(nome, { titulo, mensagem, botao, perigo, motivo, sucesso, idempotente }) {
    const r = await confirmar({ titulo, mensagem, botao, perigo, pedirMotivo: !!motivo });
    if (!r) return;
    try {
      const corpo = { versao: p.versao };
      if (motivo) corpo[motivo] = r;
      const res = await post(`/api/pedidos/${p.id}/${nome}`, corpo, { idempotente });
      toast(sucesso(res), res.status === 'REJEITADO' ? 'alerta' : 'ok');
      recarregar();
    } catch (e) { toastErro(e); if (e.status === 409) recarregar(); }
  }

  const botoes = [];
  const pode = ctx.pode;
  if (['RASCUNHO', 'REJEITADO'].includes(p.status) && pode('pedidos.gravar')) botoes.push(h('a', { class: 'btn', href: `#/pedidos/${p.id}/editar` }, 'Editar'));
  if (p.status === 'RASCUNHO' && pode('pedidos.gravar')) {
    botoes.push(h('button', { class: 'btn btn-primario', onclick: () => acao('enviar', {
      titulo: 'Enviar pedido', mensagem: 'O sistema verificará estoque, alçada de desconto e limite de crédito. Continuar?', botao: 'Enviar',
      sucesso: (r) => `Pedido ${r.numero}: ${rotuloStatus(r.status)}.`,
    }) }, 'Enviar para aprovação'));
  }
  if (p.status === 'PENDENTE_APROVACAO' && pode('pedidos.aprovar')) {
    botoes.push(
      h('button', { class: 'btn btn-primario', onclick: () => acao('aprovar', { titulo: 'Aprovar pedido', mensagem: `Aprovar o pedido ${p.numero} (${moeda(p.total_liquido)})? Motivo da pendência: ${p.motivo_status}`, botao: 'Aprovar', sucesso: (r) => `Pedido ${r.numero} aprovado; estoque reservado.` }) }, 'Aprovar'),
      h('button', { class: 'btn btn-perigo', onclick: () => acao('rejeitar', { titulo: 'Rejeitar pedido', mensagem: 'Informe o motivo da rejeição.', botao: 'Rejeitar', perigo: true, motivo: 'motivo', sucesso: (r) => `Pedido ${r.numero} rejeitado.` }) }, 'Rejeitar'));
  }
  if (p.status === 'APROVADO' && pode('pedidos.faturar')) {
    botoes.push(h('button', { class: 'btn btn-primario', onclick: () => acao('faturar', {
      titulo: 'Faturamento demonstrativo',
      mensagem: 'Será baixado o estoque reservado e gerados os títulos a receber. Atenção: faturamento demonstrativo — não emite nota fiscal nem calcula impostos.',
      botao: 'Faturar', idempotente: true, sucesso: (r) => `Pedido ${r.numero} faturado; ${r.titulos.length} título(s) gerado(s).`,
    }) }, 'Faturar (demonstrativo)'));
  }
  // Rascunho/devolvido: quem emite cancela. Pendente/aprovado: só quem aprova (o servidor confere).
  if ((['RASCUNHO', 'REJEITADO'].includes(p.status) && pode('pedidos.gravar')) || (['PENDENTE_APROVACAO', 'APROVADO'].includes(p.status) && pode('pedidos.aprovar'))) {
    botoes.push(h('button', { class: 'btn btn-perigo', onclick: () => acao('cancelar', {
      titulo: 'Cancelar pedido', mensagem: `Cancelar o pedido ${p.numero}? ${p.status === 'APROVADO' ? 'A reserva de estoque será liberada. ' : ''}Esta operação não pode ser desfeita e o pedido não poderá ser faturado.`,
      botao: 'Cancelar pedido', perigo: true, motivo: 'motivo', sucesso: (r) => `Pedido ${r.numero} cancelado.`,
    }) }, 'Cancelar pedido'));
  }

  const avisoStatus = {
    PENDENTE_APROVACAO: ['alerta', `Aguardando aprovação: ${p.motivo_status}`],
    REJEITADO: ['erro', `Rejeitado: ${p.motivo_status} — edite o pedido para reenviar.`],
    CANCELADO: ['erro', `Cancelado: ${p.motivo_status}. Pedidos cancelados não podem ser faturados.`],
    FATURADO: ['', `Faturado em ${data(p.faturado_em)} (faturamento demonstrativo, sem documento fiscal).`],
    APROVADO: ['', p.motivo_status + ' Estoque reservado até o faturamento.'],
  }[p.status];

  return h('div', {},
    cabecalho(h('span', {}, `Pedido ${p.numero} `, seloPedido(p.status)), `Emissão ${data(p.emissao)} · vendedor ${p.vendedor} · versão ${p.versao}`, ...botoes),
    avisoStatus ? h('div', { class: `aviso ${avisoStatus[0]}`, style: 'margin-bottom:16px' }, avisoStatus[1]) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Itens'),
        tabela([
          { chave: 'item', titulo: 'Item' },
          { chave: 'produto', titulo: 'Produto', quebra: true, render: (i) => `${i.produto_codigo} - ${i.produto_descricao}` },
          { chave: 'quantidade', titulo: 'Qtd', num: true, render: (i) => `${numero(i.quantidade)} ${i.unidade}` },
          { chave: 'preco_unitario', titulo: 'Preço unit.', num: true, render: (i) => moeda(i.preco_unitario) },
          { chave: 'desconto_pct', titulo: 'Desc. %', num: true, render: (i) => numero(i.desconto_pct) },
          { chave: 'total', titulo: 'Total', num: true, render: (i) => moeda(i.total) },
        ], p.itens),
        h('div', { class: 'totais' },
          h('div', {}, h('span', {}, 'Total bruto'), h('strong', {}, moeda(p.total_bruto))),
          h('div', {}, h('span', {}, 'Descontos'), h('strong', {}, moeda(p.total_desconto))),
          h('div', {}, h('span', {}, 'Total do pedido'), h('strong', {}, moeda(p.total_liquido)))),
        p.observacao ? h('p', { class: 'muted' }, 'Observação: ', p.observacao) : null),
      h('div', {},
        h('section', { class: 'cartao' }, h('h2', {}, p.credito ? 'Cliente e crédito' : 'Cliente'),
          h('p', { style: 'margin:0' }, h('strong', {}, `${p.cliente.codigo} - ${p.cliente.razao_social}`)),
          h('p', { class: 'muted', style: 'margin:2px 0 10px' }, documento(p.cliente.documento), ` · condição ${p.cond_pagto}`),
          p.credito ? h('div', {}, `Limite: ${moeda(p.credito.limite)}`) : null, p.credito ? h('div', {}, `Comprometido (exceto este pedido): ${moeda(p.credito.utilizado)}`) : null,
          p.credito ? h('div', {}, 'Disponível: ', h('strong', { style: p.credito.disponivel < p.total_liquido ? 'color:var(--erro)' : '' }, moeda(p.credito.disponivel))) : null),
        h('section', { class: 'cartao' }, h('h2', {}, 'Histórico do pedido'),
          h('ul', { class: 'linha-tempo' }, p.historico.map((x) => h('li', {},
            h('div', {}, h('strong', {}, x.de_status ? `${rotuloStatus(x.de_status)} → ${rotuloStatus(x.para_status)}` : rotuloStatus(x.para_status))),
            h('div', { class: 'muted' }, `${x.usuario} · ${dataHora(x.data_hora)}`), x.observacao ? h('div', {}, x.observacao) : null)))),
        p.titulos.length ? h('section', { class: 'cartao' }, h('h2', {}, 'Títulos gerados'),
          tabela([
            { chave: 'numero', titulo: 'Título', render: (t) => t.numero + (t.parcela ? '/' + t.parcela : '') },
            { chave: 'vencimento', titulo: 'Vencimento', render: (t) => data(t.vencimento) },
            { chave: 'valor', titulo: 'Valor', num: true, render: (t) => moeda(t.valor) },
            { chave: 'situacao', titulo: 'Situação', render: (t) => (t.situacao === 'LIQUIDADO' ? selo('Liquidado', 'ok') : selo(t.situacao === 'PARCIAL' ? 'Parcial' : 'Em aberto', 'info')) },
          ], p.titulos)) : null)));
}
