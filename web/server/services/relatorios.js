'use strict';
// Relatórios com filtros por período, cliente, produto e situação.
// Equivalente Protheus: TReport + BeginSql em ZERPREL.PRW.
// Todos os filtros entram como parâmetros "?" — nunca concatenados no SQL.
const { erro } = require('../erros');
const { reais } = require('../validacao');
const base = require('./base');

const dataOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

const RELATORIOS = {
  vendas: {
    titulo: 'Vendas por período (faturadas)',
    filtros: ['de', 'ate', 'cliente_id', 'produto_id'],
    colunas: [
      { chave: 'faturado_em', titulo: 'Faturado em', tipo: 'data' }, { chave: 'numero', titulo: 'Pedido' },
      { chave: 'cliente', titulo: 'Cliente' }, { chave: 'produto', titulo: 'Produto' },
      { chave: 'quantidade', titulo: 'Quantidade', tipo: 'numero' }, { chave: 'preco_unitario', titulo: 'Preço unit.', tipo: 'moeda' },
      { chave: 'desconto_pct', titulo: 'Desc. %', tipo: 'numero' }, { chave: 'total', titulo: 'Total', tipo: 'moeda' },
    ],
    executar(ctx, q) {
      const f = ["p.status = 'FATURADO'"]; const a = [];
      if (dataOk(q.de)) { f.push('p.faturado_em >= ?'); a.push(q.de); }
      if (dataOk(q.ate)) { f.push('p.faturado_em <= ?'); a.push(q.ate); }
      if (q.cliente_id) { f.push('p.cliente_id = ?'); a.push(Number(q.cliente_id)); }
      if (q.produto_id) { f.push('i.produto_id = ?'); a.push(Number(q.produto_id)); }
      return ctx.db.prepare(`SELECT p.faturado_em, p.numero, c.razao_social cliente, pr.codigo || ' - ' || pr.descricao produto,
          i.quantidade, i.preco_unitario_cent, i.desconto_pct, i.total_cent
          FROM pedidos p JOIN pedido_itens i ON i.pedido_id = p.id JOIN clientes c ON c.id = p.cliente_id
          JOIN produtos pr ON pr.id = i.produto_id WHERE ${f.join(' AND ')} ORDER BY p.faturado_em, p.numero, i.item`).all(...a)
        .map((r) => ({ ...r, preco_unitario: reais(r.preco_unitario_cent), total: reais(r.total_cent) }));
    },
  },
  pedidos_status: {
    titulo: 'Pedidos por status',
    filtros: ['de', 'ate', 'cliente_id', 'status'],
    colunas: [
      { chave: 'numero', titulo: 'Pedido' }, { chave: 'emissao', titulo: 'Emissão', tipo: 'data' },
      { chave: 'cliente', titulo: 'Cliente' }, { chave: 'status', titulo: 'Status' },
      { chave: 'total', titulo: 'Total', tipo: 'moeda' }, { chave: 'motivo_status', titulo: 'Motivo / observação' },
    ],
    executar(ctx, q) {
      const f = []; const a = [];
      if (dataOk(q.de)) { f.push('p.emissao >= ?'); a.push(q.de); }
      if (dataOk(q.ate)) { f.push('p.emissao <= ?'); a.push(q.ate); }
      if (q.cliente_id) { f.push('p.cliente_id = ?'); a.push(Number(q.cliente_id)); }
      if (q.status) { f.push('p.status = ?'); a.push(String(q.status)); }
      return ctx.db.prepare(`SELECT p.numero, p.emissao, c.razao_social cliente, p.status, p.total_liquido_cent, p.motivo_status
          FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
          ORDER BY p.status, p.numero`).all(...a).map((r) => ({ ...r, total: reais(r.total_liquido_cent) }));
    },
  },
  estoque_baixo: {
    titulo: 'Produtos com estoque abaixo do mínimo',
    filtros: ['produto_id'],
    colunas: [
      { chave: 'codigo', titulo: 'Código' }, { chave: 'descricao', titulo: 'Descrição' }, { chave: 'unidade', titulo: 'UM' },
      { chave: 'saldo', titulo: 'Saldo', tipo: 'numero' }, { chave: 'reservado', titulo: 'Reservado', tipo: 'numero' },
      { chave: 'disponivel', titulo: 'Disponível', tipo: 'numero' }, { chave: 'estoque_minimo', titulo: 'Mínimo', tipo: 'numero' },
      { chave: 'necessidade', titulo: 'Necessidade', tipo: 'numero' },
    ],
    executar(ctx, q) {
      const a = []; let extra = '';
      if (q.produto_id) { extra = ' AND id = ?'; a.push(Number(q.produto_id)); }
      return ctx.db.prepare(`SELECT codigo, descricao, unidade, saldo, reservado, ROUND(saldo - reservado, 4) disponivel, estoque_minimo,
          ROUND(estoque_minimo - (saldo - reservado), 4) necessidade FROM produtos
          WHERE ativo = 1 AND saldo - reservado < estoque_minimo${extra} ORDER BY necessidade DESC`).all(...a);
    },
  },
  movimentacoes: {
    titulo: 'Movimentações de estoque',
    filtros: ['de', 'ate', 'produto_id', 'tipo'],
    colunas: [
      { chave: 'data_hora', titulo: 'Data/hora', tipo: 'datahora' }, { chave: 'produto', titulo: 'Produto' },
      { chave: 'tipo', titulo: 'Tipo' }, { chave: 'quantidade', titulo: 'Quantidade', tipo: 'numero' },
      { chave: 'saldo_anterior', titulo: 'Saldo anterior', tipo: 'numero' }, { chave: 'saldo_posterior', titulo: 'Saldo posterior', tipo: 'numero' },
      { chave: 'origem', titulo: 'Origem' }, { chave: 'referencia', titulo: 'Referência' },
      { chave: 'motivo', titulo: 'Motivo' }, { chave: 'usuario', titulo: 'Usuário' },
    ],
    executar(ctx, q) {
      const f = []; const a = [];
      if (dataOk(q.de)) { f.push('substr(m.data_hora,1,10) >= ?'); a.push(q.de); }
      if (dataOk(q.ate)) { f.push('substr(m.data_hora,1,10) <= ?'); a.push(q.ate); }
      if (q.produto_id) { f.push('m.produto_id = ?'); a.push(Number(q.produto_id)); }
      if (q.tipo === 'E' || q.tipo === 'S') { f.push('m.tipo = ?'); a.push(q.tipo); }
      return ctx.db.prepare(`SELECT m.data_hora, p.codigo || ' - ' || p.descricao produto, CASE m.tipo WHEN 'E' THEN 'Entrada' ELSE 'Saída' END tipo,
          m.quantidade, m.saldo_anterior, m.saldo_posterior, m.origem, m.referencia, m.motivo, m.usuario
          FROM movimentos_estoque m JOIN produtos p ON p.id = m.produto_id ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
          ORDER BY m.id`).all(...a);
    },
  },
  receber_vencidas: {
    titulo: 'Contas a receber vencidas',
    filtros: ['cliente_id', 'de', 'ate'],
    colunas: [
      { chave: 'titulo', titulo: 'Título' }, { chave: 'cliente', titulo: 'Cliente' },
      { chave: 'emissao', titulo: 'Emissão', tipo: 'data' }, { chave: 'vencimento', titulo: 'Vencimento', tipo: 'data' },
      { chave: 'dias_atraso', titulo: 'Dias de atraso', tipo: 'numero' },
      { chave: 'valor', titulo: 'Valor', tipo: 'moeda' }, { chave: 'saldo', titulo: 'Saldo', tipo: 'moeda' },
    ],
    executar(ctx, q) {
      const hoje = base.hoje(ctx);
      const f = ["t.tipo = 'R'", "t.situacao <> 'LIQUIDADO'", 't.vencimento < ?']; const a = [hoje];
      if (q.cliente_id) { f.push('t.cliente_id = ?'); a.push(Number(q.cliente_id)); }
      if (dataOk(q.de)) { f.push('t.vencimento >= ?'); a.push(q.de); }
      if (dataOk(q.ate)) { f.push('t.vencimento <= ?'); a.push(q.ate); }
      return ctx.db.prepare(`SELECT t.numero || CASE WHEN t.parcela <> '' THEN '/' || t.parcela ELSE '' END titulo, c.razao_social cliente,
          t.emissao, t.vencimento, CAST(julianday(?) - julianday(t.vencimento) AS INTEGER) dias_atraso, t.valor_cent, t.saldo_cent
          FROM titulos t JOIN clientes c ON c.id = t.cliente_id WHERE ${f.join(' AND ')} ORDER BY t.vencimento`).all(hoje, ...a)
        .map((r) => ({ ...r, valor: reais(r.valor_cent), saldo: reais(r.saldo_cent) }));
    },
  },
  pagar_vencimento: {
    titulo: 'Contas a pagar por vencimento',
    filtros: ['de', 'ate', 'situacao'],
    colunas: [
      { chave: 'vencimento', titulo: 'Vencimento', tipo: 'data' }, { chave: 'titulo', titulo: 'Título' },
      { chave: 'fornecedor', titulo: 'Fornecedor' }, { chave: 'situacao', titulo: 'Situação' },
      { chave: 'valor', titulo: 'Valor', tipo: 'moeda' }, { chave: 'saldo', titulo: 'Saldo', tipo: 'moeda' },
    ],
    executar(ctx, q) {
      const f = ["t.tipo = 'P'"]; const a = [];
      if (dataOk(q.de)) { f.push('t.vencimento >= ?'); a.push(q.de); }
      if (dataOk(q.ate)) { f.push('t.vencimento <= ?'); a.push(q.ate); }
      if (['ABERTO', 'PARCIAL', 'LIQUIDADO'].includes(q.situacao)) { f.push('t.situacao = ?'); a.push(q.situacao); }
      return ctx.db.prepare(`SELECT t.vencimento, t.numero || CASE WHEN t.parcela <> '' THEN '/' || t.parcela ELSE '' END titulo,
          fo.razao_social fornecedor, t.situacao, t.valor_cent, t.saldo_cent
          FROM titulos t JOIN fornecedores fo ON fo.id = t.fornecedor_id WHERE ${f.join(' AND ')} ORDER BY t.vencimento, t.numero`).all(...a)
        .map((r) => ({ ...r, valor: reais(r.valor_cent), saldo: reais(r.saldo_cent) }));
    },
  },
};

function catalogo() {
  return Object.entries(RELATORIOS).map(([id, r]) => ({ id, titulo: r.titulo, filtros: r.filtros, colunas: r.colunas }));
}

function executar(ctx, id, query = {}) {
  const r = RELATORIOS[id];
  if (!r) throw erro.naoEncontrado('Relatório inexistente.');
  if (dataOk(query.de) && dataOk(query.ate) && query.de > query.ate) throw erro.validacao('Data inicial maior que a final.', { de: 'Maior que a data final.' });
  const linhas = r.executar(ctx, query).map((l) => Object.fromEntries(r.colunas.map((c) => [c.chave, l[c.chave]])));
  return { id, titulo: r.titulo, colunas: r.colunas, linhas, gerado_em: base.agoraIso(ctx), filtros: query };
}

// CSV para Excel pt-BR: UTF-8 com BOM, separador ';', decimal com vírgula, datas dd/mm/aaaa,
// aspas escapadas e neutralização de fórmulas (=, +, -, @) contra "CSV injection".
function paraCsv(rel) {
  const fmt = (v, tipo) => {
    if (v === null || v === undefined) return '';
    if (tipo === 'moeda') return Number(v).toFixed(2).replace('.', ',');
    if (tipo === 'numero') return String(v).replace('.', ',');
    if (tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
    if (tipo === 'datahora') { const d = new Date(v); return d.toLocaleString('pt-BR'); }
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return s;
  };
  const cel = (s) => (/[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const linhas = [rel.colunas.map((c) => cel(c.titulo)).join(';')];
  for (const l of rel.linhas) linhas.push(rel.colunas.map((c) => cel(fmt(l[c.chave], c.tipo))).join(';'));
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

module.exports = { catalogo, executar, paraCsv };
