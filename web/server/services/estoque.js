'use strict';
// Controle de estoque — equivalente Protheus: SB2 (saldos) + SD3 (movimentos internos) via
// MATA240 em ExecAuto. Ver protheus/src/ZERPEST.PRW.
//
// Regras:
// - O saldo só muda por movimentação; cada movimentação grava saldo anterior/posterior,
//   usuário, data/hora e motivo, e é imutável (triggers no banco).
// - Saída manual não pode consumir quantidade reservada para pedidos aprovados.
// - Saída acima do saldo é bloqueada, salvo se ZZ_ESTNEG = 'S'.
// - Chave de idempotência única por movimentação: reenvio da mesma operação não duplica.
const { transacao } = require('../db');
const { erro } = require('../erros');
const { Validador, q4 } = require('../validacao');
const base = require('./base');

function produtoParaMov(ctx, produtoId) {
  const p = ctx.db.prepare('SELECT id, codigo, descricao, saldo, reservado, estoque_minimo, ativo FROM produtos WHERE id = ?')
    .get(Number(produtoId));
  if (!p) throw erro.naoEncontrado('Produto não encontrado.');
  return p;
}

// Núcleo de gravação. Deve rodar dentro de transação (garantido pelo chamador ou aqui).
// consumirReserva: usado pelo faturamento, que baixa a quantidade antes reservada.
function registrar(ctx, { produtoId, tipo, quantidade, motivo, origem, referencia = '', chave = null, consumirReserva = 0 }) {
  return transacao(ctx.db, () => {
    if (chave) {
      const existente = ctx.db.prepare('SELECT * FROM movimentos_estoque WHERE chave_idempotencia = ?').get(chave);
      if (existente) {
        if (existente.produto_id !== Number(produtoId) || existente.tipo !== tipo || existente.quantidade !== q4(quantidade)) {
          throw erro.conflito('Chave de idempotência já usada em outra movimentação.');
        }
        return { ...existente, duplicada: true };
      }
    }
    const p = produtoParaMov(ctx, produtoId);
    if (!p.ativo && origem === 'MANUAL') throw erro.regra(`Produto ${p.codigo} está inativo.`);
    const qtd = q4(quantidade);
    let novoSaldo = p.saldo;
    if (tipo === 'E') novoSaldo = q4(p.saldo + qtd);
    else {
      const livre = q4(p.saldo - (p.reservado - consumirReserva));
      if (qtd > livre && !base.parametro(ctx, 'ZZ_ESTNEG')) {
        throw erro.regra(`Saldo disponível insuficiente para ${p.codigo}: disponível ${livre}, solicitado ${qtd}.`,
          { quantidade: `Disponível: ${livre}` });
      }
      novoSaldo = q4(p.saldo - qtd);
    }
    const novoReservado = q4(p.reservado - consumirReserva);
    if (novoReservado < 0) throw new Error('Reserva inconsistente.');
    // Atualização condicional: se outro processo alterou o saldo entre a leitura e a gravação,
    // nenhuma linha é afetada e a operação é abortada (não sobrescreve silenciosamente).
    const upd = ctx.db.prepare(`UPDATE produtos SET saldo = ?, reservado = ?, atualizado_em = ?
                                WHERE id = ? AND saldo = ? AND reservado = ?`)
      .run(novoSaldo, novoReservado, base.agoraIso(ctx), p.id, p.saldo, p.reservado);
    if (upd.changes !== 1) throw erro.conflito('Saldo alterado concorrentemente. Tente novamente.');
    const ins = ctx.db.prepare(`INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, saldo_anterior, saldo_posterior,
        motivo, origem, referencia, usuario, data_hora, chave_idempotencia) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.id, tipo, qtd, p.saldo, novoSaldo, motivo, origem, referencia, ctx.usuario.login, base.agoraIso(ctx), chave);
    return ctx.db.prepare('SELECT * FROM movimentos_estoque WHERE id = ?').get(ins.lastInsertRowid);
  });
}

// Movimentação manual (tela de estoque / API).
function movimentar(ctx, dados, chaveIdempotencia) {
  const d = new Validador(dados)
    .numero('produto_id', { obrigatorio: true, min: 1, casas: 0 })
    .opcao('tipo', ['E', 'S'])
    .numero('quantidade', { obrigatorio: true, min: 0, minExclusivo: true, max: 9999999, casas: 4 })
    .texto('motivo', { obrigatorio: true, min: 5, max: 120 })
    .texto('referencia', { max: 30 })
    .resultado();
  const chave = chaveIdempotencia ? `MAN:${ctx.usuario.id}:${chaveIdempotencia}` : null;
  const mov = registrar(ctx, {
    produtoId: d.produto_id, tipo: d.tipo, quantidade: d.quantidade, motivo: d.motivo,
    origem: 'MANUAL', referencia: d.referencia, chave,
  });
  if (!mov.duplicada) base.auditar(ctx, 'ESTOQUE', mov.produto_id, d.tipo === 'E' ? 'ENTRADA' : 'SAIDA', { movimento: mov.id, quantidade: d.quantidade });
  return mov;
}

function listarMovimentos(ctx, query = {}) {
  const f = [];
  const a = [];
  if (query.produto_id) { f.push('m.produto_id = ?'); a.push(Number(query.produto_id)); }
  if (query.tipo === 'E' || query.tipo === 'S') { f.push('m.tipo = ?'); a.push(query.tipo); }
  if (['SALDO_INICIAL', 'MANUAL', 'PEDIDO'].includes(query.origem)) { f.push('m.origem = ?'); a.push(query.origem); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.de || '')) { f.push('substr(m.data_hora,1,10) >= ?'); a.push(query.de); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.ate || '')) { f.push('substr(m.data_hora,1,10) <= ?'); a.push(query.ate); }
  const where = f.length ? 'WHERE ' + f.join(' AND ') : '';
  const pag = base.paginar(ctx, query);
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM movimentos_estoque m ${where}`).get(...a).n;
  const itens = ctx.db.prepare(`SELECT m.*, p.codigo produto_codigo, p.descricao produto_descricao, p.unidade
      FROM movimentos_estoque m JOIN produtos p ON p.id = m.produto_id ${where}
      ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...a, pag.tamanho, pag.offset);
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

function saldos(ctx, query = {}) {
  const f = ['p.ativo = 1'];
  const a = [];
  if (query.q) { f.push("(p.codigo LIKE ? ESCAPE '\\' OR p.descricao LIKE ? ESCAPE '\\')"); a.push(base.like(query.q), base.like(query.q)); }
  if (query.situacao === 'abaixo') f.push('p.saldo - p.reservado < p.estoque_minimo');
  return ctx.db.prepare(`SELECT p.id, p.codigo, p.descricao, p.unidade, p.grupo, p.saldo, p.reservado,
      ROUND(p.saldo - p.reservado, 4) disponivel, p.estoque_minimo,
      (p.saldo - p.reservado < p.estoque_minimo) abaixo_minimo
      FROM produtos p WHERE ${f.join(' AND ')} ORDER BY abaixo_minimo DESC, p.codigo`).all(...a)
    .map((r) => ({ ...r, abaixo_minimo: !!r.abaixo_minimo }));
}

module.exports = { registrar, movimentar, listarMovimentos, saldos };
