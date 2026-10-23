'use strict';
// Pedidos de venda — equivalente Protheus: SC5/SC6 via MATA410 (ExecAuto) + controle de
// aprovação em tabela Z (ZA4). Ver protheus/src/ZERPPED.PRW.
//
// Máquina de estados:
//   RASCUNHO ──enviar──► APROVADO               (sem exceções; reserva estoque)
//            └─enviar──► PENDENTE_APROVACAO     (desconto acima da alçada ou crédito excedido c/ política APROVACAO)
//            └─enviar──► REJEITADO              (crédito excedido c/ política REJEITAR)
//   PENDENTE_APROVACAO ──aprovar──► APROVADO  |  ──rejeitar──► REJEITADO
//   REJEITADO ──alterar──► RASCUNHO
//   APROVADO ──faturar──► FATURADO (baixa estoque reservado + gera títulos a receber)
//   qualquer estado exceto FATURADO/CANCELADO ──cancelar──► CANCELADO (libera reserva)
//
// FATURAMENTO DEMONSTRATIVO: não emite NF-e, não calcula ICMS/IPI/PIS/COFINS e não
// substitui o faturamento fiscal do Protheus (MATA460/MATA461), que depende de TES,
// regras fiscais e configuração apropriadas validadas por especialista.
const { transacao, proximaSequencia } = require('../db');
const { erro } = require('../erros');
const { Validador, centavos, reais, q4 } = require('../validacao');
const base = require('./base');
const clientes = require('./clientes');
const estoque = require('./estoque');

const STATUS = ['RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADO', 'REJEITADO', 'CANCELADO', 'FATURADO'];
const EDITAVEIS = ['RASCUNHO', 'REJEITADO'];
const CANCELAVEIS = ['RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADO', 'REJEITADO'];

function paraApi(r) {
  if (!r) return r;
  const { total_bruto_cent, total_desconto_cent, total_liquido_cent, ...resto } = r;
  return {
    ...resto,
    total_bruto: reais(total_bruto_cent), total_desconto: reais(total_desconto_cent), total_liquido: reais(total_liquido_cent),
  };
}

// Valida e calcula itens com o preço vigente do cadastro (o cliente da API não define preço).
function calcularItens(ctx, itensEntrada) {
  if (!Array.isArray(itensEntrada) || itensEntrada.length === 0) {
    throw erro.validacao('Inclua ao menos um item.', { itens: 'Inclua ao menos um item.' });
  }
  if (itensEntrada.length > 200) throw erro.validacao('Máximo de 200 itens por pedido.');
  const descMaxG = base.parametro(ctx, 'ZZ_DESCMXG');
  const vistos = new Set();
  const errosItens = {};
  const itens = itensEntrada.map((it, i) => {
    const v = new Validador(it)
      .numero('produto_id', { obrigatorio: true, min: 1, casas: 0 })
      .numero('quantidade', { obrigatorio: true, min: 0, minExclusivo: true, max: 999999, casas: 4 })
      .numero('desconto_pct', { min: 0, max: descMaxG, casas: 2, padrao: 0 });
    try {
      const d = v.resultado();
      const p = ctx.db.prepare('SELECT * FROM produtos WHERE id = ?').get(d.produto_id);
      if (!p) throw erro.validacao('x', { produto_id: 'Produto inexistente.' });
      if (!p.ativo) throw erro.validacao('x', { produto_id: `Produto ${p.codigo} inativo.` });
      if (vistos.has(p.id)) throw erro.validacao('x', { produto_id: `Produto ${p.codigo} repetido; ajuste a quantidade.` });
      vistos.add(p.id);
      const bruto = Math.round(p.preco_venda_cent * d.quantidade);
      const total = Math.round(bruto * (1 - d.desconto_pct / 100));
      return {
        item: String(i + 1).padStart(2, '0'), produto_id: p.id, quantidade: q4(d.quantidade),
        preco_unitario_cent: p.preco_venda_cent, desconto_pct: d.desconto_pct, total_cent: total, bruto_cent: bruto,
      };
    } catch (e) {
      if (e.detalhes) errosItens[i] = e.detalhes; else throw e;
      return null;
    }
  });
  if (Object.keys(errosItens).length) {
    throw erro.validacao(`Itens inválidos. O desconto máximo permitido é ${descMaxG}%.`, { itens: errosItens });
  }
  return itens;
}

function validarCabecalho(ctx, dados) {
  const d = new Validador(dados)
    .numero('cliente_id', { obrigatorio: true, min: 1, casas: 0 })
    .texto('cond_pagto', { max: 3, maiusculo: true })
    .texto('observacao', { max: 250 })
    .resultado();
  const cli = ctx.db.prepare('SELECT * FROM clientes WHERE id = ?').get(d.cliente_id);
  // Vendedor: só clientes da própria carteira (ou de pedidos dele). O dono do pedido vem da sessão, nunca do corpo.
  if (!cli || !clientes.visivel(ctx, cli)) throw erro.validacao('Cliente inexistente.', { cliente_id: 'Cliente inexistente.' });
  if (!cli.ativo) throw erro.validacao('Cliente inativo não pode receber pedidos.', { cliente_id: 'Cliente inativo.' });
  d.cond_pagto = d.cond_pagto || cli.cond_pagto;
  if (!ctx.db.prepare('SELECT 1 FROM condicoes_pagamento WHERE codigo = ?').get(d.cond_pagto)) {
    throw erro.validacao('Condição de pagamento inexistente.', { cond_pagto: 'Inexistente.' });
  }
  return d;
}

function gravarItens(ctx, pedidoId, itens) {
  ctx.db.prepare('DELETE FROM pedido_itens WHERE pedido_id = ?').run(pedidoId);
  const ins = ctx.db.prepare(`INSERT INTO pedido_itens (pedido_id, item, produto_id, quantidade, preco_unitario_cent,
                              desconto_pct, total_cent) VALUES (?,?,?,?,?,?,?)`);
  for (const it of itens) ins.run(pedidoId, it.item, it.produto_id, it.quantidade, it.preco_unitario_cent, it.desconto_pct, it.total_cent);
  const bruto = itens.reduce((s, i) => s + i.bruto_cent, 0);
  const liquido = itens.reduce((s, i) => s + i.total_cent, 0);
  return { bruto, desconto: bruto - liquido, liquido };
}

function historicoStatus(ctx, pedidoId, de, para, obs) {
  ctx.db.prepare(`INSERT INTO pedido_historico (pedido_id, de_status, para_status, usuario, data_hora, observacao)
                  VALUES (?,?,?,?,?,?)`).run(pedidoId, de, para, ctx.usuario.login, base.agoraIso(ctx), obs || '');
}

// Troca de status com "compare-and-set": só altera se o status e a versão lidos ainda valem.
// Duas requisições simultâneas de faturar/cancelar o mesmo pedido: só uma vence.
function mudarStatus(ctx, ped, para, motivo, extra = {}) {
  const sets = ['status = ?', 'motivo_status = ?', 'versao = versao + 1', 'atualizado_em = ?'];
  const args = [para, motivo || '', base.agoraIso(ctx)];
  if (extra.faturado_em) { sets.push('faturado_em = ?'); args.push(extra.faturado_em); }
  const r = ctx.db.prepare(`UPDATE pedidos SET ${sets.join(', ')} WHERE id = ? AND status = ? AND versao = ?`)
    .run(...args, ped.id, ped.status, ped.versao);
  if (r.changes !== 1) throw erro.conflito('O pedido foi alterado por outra operação. Recarregue e tente novamente.');
  historicoStatus(ctx, ped.id, ped.status, para, motivo);
  base.auditar(ctx, 'PEDIDO', ped.id, `STATUS_${para}`, { numero: ped.numero, de: ped.status, motivo: motivo || '' });
}

function obterLinha(ctx, id) {
  const r = ctx.db.prepare('SELECT * FROM pedidos WHERE id = ?').get(Number(id));
  // Proteção por registro: vendedor só acessa os próprios pedidos (404 para não revelar existência).
  if (!r || (ctx.usuario.perfil === 'VENDEDOR' && r.vendedor !== ctx.usuario.login)) {
    throw erro.naoEncontrado('Pedido não encontrado.');
  }
  return r;
}

function itensDoPedido(ctx, id) {
  return ctx.db.prepare(`SELECT i.*, p.codigo produto_codigo, p.descricao produto_descricao, p.unidade,
        ROUND(p.saldo - p.reservado, 4) disponivel
      FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id WHERE i.pedido_id = ? ORDER BY i.item`).all(id)
    .map(({ preco_unitario_cent, total_cent, ...i }) => ({ ...i, preco_unitario: reais(preco_unitario_cent), total: reais(total_cent) }));
}

function obter(ctx, id) {
  const p = obterLinha(ctx, id);
  const cli = ctx.db.prepare('SELECT id, codigo, razao_social, documento, limite_credito_cent FROM clientes WHERE id = ?').get(p.cliente_id);
  const usado = clientes.creditoUtilizadoCent(ctx, p.cliente_id, p.id);
  return {
    ...paraApi(p),
    cliente: { id: cli.id, codigo: cli.codigo, razao_social: cli.razao_social, documento: cli.documento },
    // Limite e crédito do cliente só para quem tem 'clientes.credito'.
    credito: base.pode(ctx, 'clientes.credito')
      ? { limite: reais(cli.limite_credito_cent), utilizado: reais(usado), disponivel: reais(cli.limite_credito_cent - usado) } : null,
    itens: itensDoPedido(ctx, p.id),
    historico: ctx.db.prepare('SELECT de_status, para_status, usuario, data_hora, observacao FROM pedido_historico WHERE pedido_id = ? ORDER BY id').all(p.id),
    // Títulos do pedido: consulta financeira de quem aprova (gerente) ou de quem tem o financeiro. Vendedor não vê.
    titulos: !(base.pode(ctx, 'financeiro.ler') || base.pode(ctx, 'pedidos.aprovar')) ? [] : ctx.db.prepare('SELECT id, numero, parcela, vencimento, valor_cent, saldo_cent, situacao FROM titulos WHERE pedido_id = ? ORDER BY parcela').all(p.id)
      .map(({ valor_cent, saldo_cent, ...t }) => ({ ...t, valor: reais(valor_cent), saldo: reais(saldo_cent) })),
  };
}

function listar(ctx, query = {}) {
  const f = [];
  const a = [];
  if (ctx.usuario.perfil === 'VENDEDOR') { f.push('p.vendedor = ?'); a.push(ctx.usuario.login); }
  if (STATUS.includes(query.status)) { f.push('p.status = ?'); a.push(query.status); }
  if (query.cliente_id) { f.push('p.cliente_id = ?'); a.push(Number(query.cliente_id)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.de || '')) { f.push('p.emissao >= ?'); a.push(query.de); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.ate || '')) { f.push('p.emissao <= ?'); a.push(query.ate); }
  if (query.q) { f.push("(p.numero LIKE ? ESCAPE '\\' OR c.razao_social LIKE ? ESCAPE '\\')"); a.push(base.like(query.q), base.like(query.q)); }
  const where = f.length ? 'WHERE ' + f.join(' AND ') : '';
  const ordem = base.ordenacao(query, { numero: 'p.numero', emissao: 'p.emissao', cliente: 'c.razao_social', total: 'p.total_liquido_cent', status: 'p.status' }, 'numero');
  const pag = base.paginar(ctx, query);
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ${where}`).get(...a).n;
  const itens = ctx.db.prepare(`SELECT p.*, c.codigo cliente_codigo, c.razao_social cliente_nome
      FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(...a, pag.tamanho, pag.offset).map(paraApi);
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

function criar(ctx, dados) {
  const cab = validarCabecalho(ctx, dados);
  const itens = calcularItens(ctx, dados.itens);
  return transacao(ctx.db, () => {
    const numero = proximaSequencia(ctx.db, 'PEDIDO', 6);
    const agora = base.agoraIso(ctx);
    const { lastInsertRowid: id } = ctx.db.prepare(`INSERT INTO pedidos (numero, cliente_id, cond_pagto, status, emissao,
        observacao, vendedor, criado_em, atualizado_em) VALUES (?,?,?,'RASCUNHO',?,?,?,?,?)`)
      .run(numero, cab.cliente_id, cab.cond_pagto, base.hoje(ctx), cab.observacao, ctx.usuario.login, agora, agora);
    const t = gravarItens(ctx, id, itens);
    ctx.db.prepare('UPDATE pedidos SET total_bruto_cent=?, total_desconto_cent=?, total_liquido_cent=? WHERE id=?')
      .run(t.bruto, t.desconto, t.liquido, id);
    historicoStatus(ctx, id, null, 'RASCUNHO', 'Pedido criado');
    base.auditar(ctx, 'PEDIDO', Number(id), 'INCLUSAO', { numero, total: reais(t.liquido) });
    return obter(ctx, id);
  });
}

function alterar(ctx, id, dados) {
  const cab = validarCabecalho(ctx, dados);
  const itens = calcularItens(ctx, dados.itens);
  return transacao(ctx.db, () => {
    const ped = obterLinha(ctx, id);
    base.exigirVersao(dados.versao, ped.versao);
    if (!EDITAVEIS.includes(ped.status)) throw erro.regra(`Pedido ${ped.status} não pode ser alterado.`);
    const t = gravarItens(ctx, ped.id, itens);
    const r = ctx.db.prepare(`UPDATE pedidos SET cliente_id=?, cond_pagto=?, observacao=?, total_bruto_cent=?,
        total_desconto_cent=?, total_liquido_cent=?, status='RASCUNHO', motivo_status='', versao = versao + 1, atualizado_em=?
        WHERE id=? AND versao=?`)
      .run(cab.cliente_id, cab.cond_pagto, cab.observacao, t.bruto, t.desconto, t.liquido, base.agoraIso(ctx), ped.id, ped.versao);
    if (r.changes !== 1) throw erro.conflito('O pedido foi alterado por outra operação.');
    if (ped.status !== 'RASCUNHO') historicoStatus(ctx, ped.id, ped.status, 'RASCUNHO', 'Pedido reaberto para edição');
    base.auditar(ctx, 'PEDIDO', ped.id, 'ALTERACAO', { numero: ped.numero, total: reais(t.liquido) });
    return obter(ctx, id);
  });
}

// Verificação de estoque: quantidade de cada item contra o disponível (saldo - reservado).
function faltasDeEstoque(ctx, pedidoId) {
  if (base.parametro(ctx, 'ZZ_ESTNEG')) return [];
  return ctx.db.prepare(`SELECT p.codigo, i.quantidade, ROUND(p.saldo - p.reservado, 4) disponivel
      FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ? AND i.quantidade > p.saldo - p.reservado`).all(pedidoId);
}

function reservar(ctx, pedidoId) {
  const permiteNeg = base.parametro(ctx, 'ZZ_ESTNEG');
  const itens = ctx.db.prepare('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?').all(pedidoId);
  const upd = ctx.db.prepare(`UPDATE produtos SET reservado = ROUND(reservado + ?, 4)
                              WHERE id = ? AND (? = 1 OR saldo - reservado >= ?)`);
  for (const it of itens) {
    if (upd.run(it.quantidade, it.produto_id, permiteNeg ? 1 : 0, it.quantidade).changes !== 1) {
      throw erro.regra('Estoque insuficiente no momento da reserva. Recarregue o pedido.');
    }
  }
}

function liberarReserva(ctx, pedidoId) {
  const itens = ctx.db.prepare('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?').all(pedidoId);
  const upd = ctx.db.prepare('UPDATE produtos SET reservado = MAX(ROUND(reservado - ?, 4), 0) WHERE id = ?');
  for (const it of itens) upd.run(it.quantidade, it.produto_id);
}

function erroFalta(faltas) {
  return erro.regra('Estoque insuficiente para: ' + faltas.map((f) => `${f.codigo} (pedido ${f.quantidade}, disponível ${f.disponivel})`).join('; '),
    { faltas });
}

function enviar(ctx, id, versao) {
  return transacao(ctx.db, () => {
    const ped = obterLinha(ctx, id);
    base.exigirVersao(versao, ped.versao);
    if (ped.status !== 'RASCUNHO') throw erro.regra(`Somente pedidos em RASCUNHO podem ser enviados (atual: ${ped.status}).`);
    const cli = clientes.obterLinha(ctx, ped.cliente_id);
    if (!cli.ativo) throw erro.regra('Cliente inativo.');
    const faltas = faltasDeEstoque(ctx, ped.id);
    if (faltas.length) throw erroFalta(faltas);

    const motivos = [];
    const descMaxV = base.parametro(ctx, 'ZZ_DESCMXV');
    const maiorDesc = ctx.db.prepare('SELECT MAX(desconto_pct) m FROM pedido_itens WHERE pedido_id = ?').get(ped.id).m || 0;
    if (maiorDesc > descMaxV) motivos.push(`Desconto de ${maiorDesc}% acima da alçada do vendedor (${descMaxV}%).`);

    const usado = clientes.creditoUtilizadoCent(ctx, cli.id, ped.id);
    const excede = usado + ped.total_liquido_cent > cli.limite_credito_cent;
    if (excede) {
      const msg = `Limite de crédito excedido: limite ${reais(cli.limite_credito_cent).toFixed(2)}, comprometido ${reais(usado).toFixed(2)}, pedido ${reais(ped.total_liquido_cent).toFixed(2)}.`;
      if (base.parametro(ctx, 'ZZ_CREDPOL') === 'REJEITAR') {
        mudarStatus(ctx, ped, 'REJEITADO', msg);
        return obter(ctx, id);
      }
      motivos.push(msg);
    }
    if (motivos.length) {
      mudarStatus(ctx, ped, 'PENDENTE_APROVACAO', motivos.join(' '));
    } else {
      reservar(ctx, ped.id);
      mudarStatus(ctx, ped, 'APROVADO', 'Aprovado automaticamente: dentro das alçadas e do limite de crédito.');
    }
    return obter(ctx, id);
  });
}

function aprovar(ctx, id, versao, observacao) {
  return transacao(ctx.db, () => {
    const ped = obterLinha(ctx, id);
    base.exigirVersao(versao, ped.versao);
    if (ped.status !== 'PENDENTE_APROVACAO') throw erro.regra(`Pedido não está pendente de aprovação (atual: ${ped.status}).`);
    if (ped.vendedor === ctx.usuario.login) throw erro.proibido('O próprio emissor não pode aprovar o pedido (segregação de funções).');
    const faltas = faltasDeEstoque(ctx, ped.id);
    if (faltas.length) throw erroFalta(faltas);
    reservar(ctx, ped.id);
    mudarStatus(ctx, ped, 'APROVADO', `Aprovado por ${ctx.usuario.login}. ${String(observacao || '').slice(0, 200)}`.trim());
    return obter(ctx, id);
  });
}

function rejeitar(ctx, id, versao, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 5) throw erro.validacao('Informe o motivo da rejeição.', { motivo: 'Mínimo de 5 caracteres.' });
  return transacao(ctx.db, () => {
    const ped = obterLinha(ctx, id);
    base.exigirVersao(versao, ped.versao);
    if (ped.status !== 'PENDENTE_APROVACAO') throw erro.regra(`Pedido não está pendente de aprovação (atual: ${ped.status}).`);
    mudarStatus(ctx, ped, 'REJEITADO', m.slice(0, 250));
    return obter(ctx, id);
  });
}

function cancelar(ctx, id, versao, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 5) throw erro.validacao('Informe o motivo do cancelamento.', { motivo: 'Mínimo de 5 caracteres.' });
  return transacao(ctx.db, () => {
    const ped = obterLinha(ctx, id);
    base.exigirVersao(versao, ped.versao);
    // Depois que sai do rascunho (pendente ou aprovado), cancelar é decisão de quem aprova, não de quem emitiu.
    if (['PENDENTE_APROVACAO', 'APROVADO'].includes(ped.status) && !base.pode(ctx, 'pedidos.aprovar')) {
      throw erro.proibido('Este pedido já saiu do rascunho; o cancelamento cabe a quem aprova pedidos.');
    }
    if (!CANCELAVEIS.includes(ped.status)) {
      throw erro.regra(ped.status === 'FATURADO'
        ? 'Pedido faturado não pode ser cancelado; o estorno exige devolução/cancelamento fiscal da nota.'
        : `Pedido ${ped.status} não pode ser cancelado.`);
    }
    if (ped.status === 'APROVADO') liberarReserva(ctx, ped.id);
    mudarStatus(ctx, ped, 'CANCELADO', m.slice(0, 250));
    return obter(ctx, id);
  });
}

function parcelas(totalCent, diasCsv) {
  const dias = String(diasCsv).split(',').map((d) => parseInt(d, 10)).filter((d) => d >= 0);
  const n = dias.length || 1;
  const valor = Math.floor(totalCent / n);
  return dias.map((d, i) => ({
    parcela: n === 1 ? '' : String.fromCharCode(65 + i),
    dias: d,
    valor_cent: valor + (i === 0 ? totalCent - valor * n : 0),
  }));
}

function somarDias(dataIso, dias) {
  const d = new Date(dataIso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Faturamento demonstrativo, atômico: ou tudo (status + baixa de estoque + títulos) ou nada.
function faturar(ctx, id, versao) {
  return transacao(ctx.db, () => {
    const ped = obterLinha(ctx, id);
    base.exigirVersao(versao, ped.versao);
    if (ped.status === 'CANCELADO') throw erro.regra('Pedido cancelado não pode ser faturado.');
    if (ped.status === 'FATURADO') throw erro.conflito('Pedido já faturado.');
    if (ped.status !== 'APROVADO') throw erro.regra(`Somente pedidos APROVADOS podem ser faturados (atual: ${ped.status}).`);
    const hoje = base.hoje(ctx);
    // 1) "reivindica" o pedido: se outra requisição faturou/cancelou antes, falha aqui.
    mudarStatus(ctx, ped, 'FATURADO', 'Faturamento demonstrativo (sem emissão fiscal).', { faturado_em: hoje });
    // 2) baixa o estoque reservado; o índice único ux_mov_pedido impede baixa duplicada.
    const itens = ctx.db.prepare('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?').all(ped.id);
    for (const it of itens) {
      estoque.registrar(ctx, {
        produtoId: it.produto_id, tipo: 'S', quantidade: it.quantidade, motivo: `Faturamento do pedido ${ped.numero}`,
        origem: 'PEDIDO', referencia: ped.numero, consumirReserva: it.quantidade,
      });
    }
    // 3) gera os títulos a receber conforme a condição de pagamento.
    const cond = ctx.db.prepare('SELECT dias FROM condicoes_pagamento WHERE codigo = ?').get(ped.cond_pagto);
    const ins = ctx.db.prepare(`INSERT INTO titulos (tipo, numero, parcela, cliente_id, pedido_id, emissao, vencimento,
        valor_cent, saldo_cent, situacao, historico) VALUES ('R', ?, ?, ?, ?, ?, ?, ?, ?, 'ABERTO', ?)`);
    for (const p of parcelas(ped.total_liquido_cent, cond.dias)) {
      ins.run(ped.numero, p.parcela, ped.cliente_id, ped.id, hoje, somarDias(hoje, p.dias), p.valor_cent, p.valor_cent,
        `Pedido ${ped.numero}`);
    }
    return obter(ctx, id);
  });
}


// Expedição (perfil ESTOQUE): pedidos aprovados/faturados para separar e entregar.
// Só o necessário para separar: cliente, endereço, itens e quantidades — sem preços, totais, custos nem crédito.
const STATUS_EXPEDICAO = ['APROVADO', 'FATURADO'];

function expedicao(ctx, query = {}) {
  const f = ["p.status IN ('APROVADO','FATURADO')"];
  const a = [];
  if (STATUS_EXPEDICAO.includes(query.status)) { f.push('p.status = ?'); a.push(query.status); }
  if (query.q) { f.push("(p.numero LIKE ? ESCAPE '\' OR c.razao_social LIKE ? ESCAPE '\')"); a.push(base.like(query.q), base.like(query.q)); }
  const where = 'WHERE ' + f.join(' AND ');
  const pag = base.paginar(ctx, query);
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ${where}`).get(...a).n;
  const itens = ctx.db.prepare(`SELECT p.id, p.numero, p.status, p.emissao, c.razao_social cliente_nome, c.municipio, c.uf,
        (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id) qtd_itens
      FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ${where} ORDER BY p.status, p.numero LIMIT ? OFFSET ?`)
    .all(...a, pag.tamanho, pag.offset);
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

function expedicaoDetalhe(ctx, id) {
  const p = ctx.db.prepare('SELECT id, numero, status, emissao, observacao, cliente_id FROM pedidos WHERE id = ?').get(Number(id));
  if (!p || !STATUS_EXPEDICAO.includes(p.status)) throw erro.naoEncontrado('Pedido não encontrado na expedição.');
  const c = ctx.db.prepare(`SELECT codigo, razao_social, nome_fantasia, cep, logradouro, numero, complemento, bairro,
      municipio, uf, telefone FROM clientes WHERE id = ?`).get(p.cliente_id);
  const itens = ctx.db.prepare(`SELECT i.item, p.codigo produto_codigo, p.descricao produto_descricao, p.unidade, i.quantidade
      FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id WHERE i.pedido_id = ? ORDER BY i.item`).all(p.id);
  const { cliente_id, ...cab } = p;
  return { ...cab, cliente: c, itens };
}
module.exports = { STATUS, listar, obter, criar, alterar, enviar, aprovar, rejeitar, cancelar, faturar, parcelas, expedicao, expedicaoDetalhe };
