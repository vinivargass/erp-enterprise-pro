'use strict';
// Indicadores calculados a partir do banco a cada requisição (nenhum número fixo no código).
const { reais } = require('../validacao');
const base = require('./base');

function primeiroDiaMes(iso) { return iso.slice(0, 8) + '01'; }
function ultimosMeses(hojeIso, n) {
  const [a, m] = hojeIso.split('-').map(Number);
  const r = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    r.push(d.toISOString().slice(0, 7));
  }
  return r;
}

function alertas(ctx) {
  const hoje = base.hoje(ctx);
  const a = [];
  const baixo = ctx.db.prepare(`SELECT id, codigo, descricao, ROUND(saldo - reservado, 4) disponivel, estoque_minimo FROM produtos
      WHERE ativo = 1 AND saldo - reservado < estoque_minimo ORDER BY (saldo - reservado) - estoque_minimo LIMIT 20`).all();
  for (const p of baixo) {
    a.push({ nivel: p.disponivel <= 0 ? 'critico' : 'atencao', tipo: 'ESTOQUE', texto: `${p.codigo} abaixo do mínimo: disponível ${p.disponivel}, mínimo ${p.estoque_minimo}`, rota: `#/estoque?produto=${p.id}` });
  }
  const venc = ctx.db.prepare(`SELECT tipo, COUNT(*) n, SUM(saldo_cent) v FROM titulos WHERE situacao <> 'LIQUIDADO' AND vencimento < ? GROUP BY tipo`).all(hoje);
  for (const v of venc) {
    a.push({ nivel: 'critico', tipo: 'FINANCEIRO', texto: `${v.n} título(s) a ${v.tipo === 'R' ? 'receber' : 'pagar'} vencido(s): R$ ${reais(v.v).toFixed(2).replace('.', ',')}`, rota: v.tipo === 'R' ? '#/financeiro/receber?situacao=VENCIDO' : '#/financeiro/pagar?situacao=VENCIDO' });
  }
  const pend = ctx.db.prepare("SELECT COUNT(*) n FROM pedidos WHERE status = 'PENDENTE_APROVACAO'").get().n;
  if (pend) a.push({ nivel: 'atencao', tipo: 'PEDIDO', texto: `${pend} pedido(s) aguardando aprovação`, rota: '#/pedidos?status=PENDENTE_APROVACAO' });
  return a;
}

function resumo(ctx, query = {}) {
  const hoje = base.hoje(ctx);
  const de = /^\d{4}-\d{2}-\d{2}$/.test(query.de || '') ? query.de : primeiroDiaMes(hoje);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(query.ate || '') ? query.ate : hoje;
  const db = ctx.db;
  const faturamento = db.prepare(`SELECT COALESCE(SUM(total_liquido_cent),0) v, COUNT(*) n FROM pedidos
      WHERE status = 'FATURADO' AND faturado_em BETWEEN ? AND ?`).get(de, ate);
  const pedidosPeriodo = db.prepare("SELECT COUNT(*) n FROM pedidos WHERE emissao BETWEEN ? AND ? AND status <> 'CANCELADO'").get(de, ate).n;
  const receber = db.prepare("SELECT COALESCE(SUM(saldo_cent),0) v, COUNT(*) n FROM titulos WHERE tipo='R' AND situacao <> 'LIQUIDADO'").get();
  const pagar = db.prepare("SELECT COALESCE(SUM(saldo_cent),0) v, COUNT(*) n FROM titulos WHERE tipo='P' AND situacao <> 'LIQUIDADO'").get();
  const estoqueValor = db.prepare('SELECT COALESCE(SUM(ROUND(saldo * custo_cent)),0) v, COUNT(*) n FROM produtos WHERE ativo = 1').get();
  const abaixo = db.prepare('SELECT COUNT(*) n FROM produtos WHERE ativo = 1 AND saldo - reservado < estoque_minimo').get().n;
  const pendentes = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_liquido_cent),0) v FROM pedidos WHERE status = 'PENDENTE_APROVACAO'").get();
  const aFaturar = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_liquido_cent),0) v FROM pedidos WHERE status = 'APROVADO'").get();

  const meses = ultimosMeses(hoje, 6);
  const porMes = new Map(db.prepare(`SELECT substr(faturado_em,1,7) mes, SUM(total_liquido_cent) v, COUNT(*) n FROM pedidos
      WHERE status = 'FATURADO' AND substr(faturado_em,1,7) >= ? GROUP BY mes`).all(meses[0]).map((r) => [r.mes, r]));
  const evolucao = meses.map((m) => ({ mes: m, valor: reais(porMes.get(m)?.v || 0), pedidos: porMes.get(m)?.n || 0 }));

  const porStatus = db.prepare('SELECT status, COUNT(*) n, SUM(total_liquido_cent) v FROM pedidos GROUP BY status').all()
    .map((r) => ({ status: r.status, quantidade: r.n, valor: reais(r.v || 0) }));

  const atividades = db.prepare('SELECT entidade, entidade_id, acao, usuario, data_hora, detalhes FROM auditoria ORDER BY id DESC LIMIT 10').all()
    .map((r) => ({ ...r, detalhes: JSON.parse(r.detalhes) }));

  // Itens vendidos no período (pedidos faturados) e sua distribuição por grupo de produto (categoria).
  const itens = db.prepare(`SELECT COALESCE(SUM(i.quantidade),0) q FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
      WHERE p.status = 'FATURADO' AND p.faturado_em BETWEEN ? AND ?`).get(de, ate).q;
  const grupos = db.prepare(`SELECT pr.grupo, SUM(i.quantidade) q FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
      JOIN produtos pr ON pr.id = i.produto_id WHERE p.status = 'FATURADO' AND p.faturado_em BETWEEN ? AND ?
      GROUP BY pr.grupo ORDER BY q DESC`).all(de, ate);
  const porGrupo = grupos.slice(0, 4).map((g) => ({ grupo: g.grupo, quantidade: g.q }));
  const resto = grupos.slice(4).reduce((s, g) => s + g.q, 0);
  if (resto > 0) porGrupo.push({ grupo: 'Outros', quantidade: resto, outros: true });

  // Pedidos recentes: só para quem pode ver pedidos; vendedor vê apenas os próprios.
  let pedidosRecentes = null;
  if ((ctx.usuario.permissoes || []).includes('pedidos.ler')) {
    const so = ctx.usuario.perfil === 'VENDEDOR';
    pedidosRecentes = db.prepare(`SELECT p.id, p.numero, c.razao_social cliente, p.total_liquido_cent, p.status, p.emissao
        FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ${so ? 'WHERE p.vendedor = ?' : ''}
        ORDER BY p.id DESC LIMIT 5`).all(...(so ? [ctx.usuario.login] : []))
      .map(({ total_liquido_cent, ...r }) => ({ ...r, total: reais(total_liquido_cent) }));
  }

  return {
    periodo: { de, ate },
    indicadores: {
      ticket_medio: faturamento.n ? reais(Math.round(faturamento.v / faturamento.n)) : 0,
      itens_vendidos: Math.round(itens * 100) / 100,
      faturamento: reais(faturamento.v), pedidos_faturados: faturamento.n, total_pedidos: pedidosPeriodo,
      receber_aberto: reais(receber.v), receber_qtd: receber.n, pagar_aberto: reais(pagar.v), pagar_qtd: pagar.n,
      estoque_valor_custo: reais(estoqueValor.v), produtos_ativos: estoqueValor.n, produtos_abaixo_minimo: abaixo,
      pedidos_pendentes: pendentes.n, pedidos_pendentes_valor: reais(pendentes.v),
      pedidos_a_faturar: aFaturar.n, pedidos_a_faturar_valor: reais(aFaturar.v),
    },
    evolucao, por_status: porStatus, por_grupo: porGrupo, pedidos_recentes: pedidosRecentes, atividades, alertas: alertas(ctx),
  };
}

module.exports = { resumo, alertas };
