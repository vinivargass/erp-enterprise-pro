'use strict';
// Financeiro DEMONSTRATIVO — equivalente Protheus: SE1 (receber) / SE2 (pagar), baixas via
// FINA070 / FINA080 em ExecAuto. Ver protheus/src/ZERPFIN.PRW.
// Não há integração bancária, CNAB, boleto ou documento fiscal.
const { transacao } = require('../db');
const { erro } = require('../erros');
const { Validador, centavos, reais } = require('../validacao');
const base = require('./base');

function paraApi(r) {
  if (!r) return r;
  const { valor_cent, saldo_cent, ...resto } = r;
  return { ...resto, valor: reais(valor_cent), saldo: reais(saldo_cent) };
}

function listar(ctx, tipo, query = {}) {
  const f = ['t.tipo = ?'];
  const a = [tipo];
  const hoje = base.hoje(ctx);
  if (query.situacao === 'ABERTO') f.push("t.situacao IN ('ABERTO','PARCIAL')");
  else if (['PARCIAL', 'LIQUIDADO'].includes(query.situacao)) { f.push('t.situacao = ?'); a.push(query.situacao); }
  else if (query.situacao === 'VENCIDO') { f.push("t.situacao <> 'LIQUIDADO' AND t.vencimento < ?"); a.push(hoje); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.venc_de || '')) { f.push('t.vencimento >= ?'); a.push(query.venc_de); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.venc_ate || '')) { f.push('t.vencimento <= ?'); a.push(query.venc_ate); }
  if (query.q) {
    f.push("(t.numero LIKE ? ESCAPE '\\' OR COALESCE(c.razao_social, fo.razao_social) LIKE ? ESCAPE '\\')");
    a.push(base.like(query.q), base.like(query.q));
  }
  const where = 'WHERE ' + f.join(' AND ');
  const ordem = base.ordenacao(query, { numero: 't.numero, t.parcela', vencimento: 't.vencimento', valor: 't.valor_cent', saldo: 't.saldo_cent', emissao: 't.emissao' }, 'vencimento');
  const pag = base.paginar(ctx, query);
  const from = `FROM titulos t LEFT JOIN clientes c ON c.id = t.cliente_id LEFT JOIN fornecedores fo ON fo.id = t.fornecedor_id ${where}`;
  const total = ctx.db.prepare(`SELECT COUNT(*) n ${from}`).get(...a).n;
  const itens = ctx.db.prepare(`SELECT t.*, COALESCE(c.razao_social, fo.razao_social) participante,
        (t.situacao <> 'LIQUIDADO' AND t.vencimento < ?) vencido ${from} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(hoje, ...a, pag.tamanho, pag.offset).map((r) => ({ ...paraApi(r), vencido: !!r.vencido }));
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

function obter(ctx, id) {
  const t = ctx.db.prepare(`SELECT t.*, COALESCE(c.razao_social, fo.razao_social) participante FROM titulos t
      LEFT JOIN clientes c ON c.id = t.cliente_id LEFT JOIN fornecedores fo ON fo.id = t.fornecedor_id WHERE t.id = ?`).get(Number(id));
  if (!t) throw erro.naoEncontrado('Título não encontrado.');
  const baixas = ctx.db.prepare('SELECT id, valor_cent, data, usuario, data_hora FROM baixas WHERE titulo_id = ? ORDER BY id').all(t.id)
    .map(({ valor_cent, ...b }) => ({ ...b, valor: reais(valor_cent) }));
  return { ...paraApi(t), baixas };
}

// Liquidação (total ou parcial). Proteções contra pagamento duplicado:
// 1) chave de idempotência única em `baixas` — reenvio da mesma requisição devolve a mesma baixa;
// 2) compare-and-set em saldo/versão — duas baixas concorrentes não consomem o mesmo saldo;
// 3) título LIQUIDADO não aceita nova baixa.
function liquidar(ctx, id, dados, chaveIdempotencia) {
  const d = new Validador(dados)
    .numero('valor', { obrigatorio: true, min: 0, minExclusivo: true, max: 99999999.99 })
    .data('data')
    .resultado();
  const chave = chaveIdempotencia ? `BX:${ctx.usuario.id}:${chaveIdempotencia}` : null;
  return transacao(ctx.db, () => {
    if (chave) {
      const b = ctx.db.prepare('SELECT * FROM baixas WHERE chave_idempotencia = ?').get(chave);
      if (b) {
        if (b.titulo_id !== Number(id) || b.valor_cent !== centavos(d.valor)) throw erro.conflito('Chave de idempotência já usada em outra baixa.');
        return { ...obter(ctx, id), duplicada: true };
      }
    }
    const t = ctx.db.prepare('SELECT * FROM titulos WHERE id = ?').get(Number(id));
    if (!t) throw erro.naoEncontrado('Título não encontrado.');
    base.exigirVersao(dados.versao, t.versao);
    if (t.situacao === 'LIQUIDADO' || t.saldo_cent === 0) throw erro.conflito('Título já liquidado. Baixa duplicada bloqueada.');
    const valor = centavos(d.valor);
    if (valor > t.saldo_cent) throw erro.validacao(`Valor maior que o saldo em aberto (${reais(t.saldo_cent).toFixed(2)}).`, { valor: 'Acima do saldo.' });
    if (d.data < t.emissao) throw erro.validacao('Data de liquidação anterior à emissão.', { data: 'Anterior à emissão.' });
    if (d.data > base.hoje(ctx)) throw erro.validacao('Data de liquidação no futuro.', { data: 'Data futura.' });
    const novoSaldo = t.saldo_cent - valor;
    const situacao = novoSaldo === 0 ? 'LIQUIDADO' : 'PARCIAL';
    const r = ctx.db.prepare(`UPDATE titulos SET saldo_cent = ?, situacao = ?, data_liquidacao = ?, versao = versao + 1
                              WHERE id = ? AND versao = ? AND saldo_cent = ?`)
      .run(novoSaldo, situacao, novoSaldo === 0 ? d.data : t.data_liquidacao, t.id, t.versao, t.saldo_cent);
    if (r.changes !== 1) throw erro.conflito('Título alterado por outra operação. Recarregue e tente novamente.');
    ctx.db.prepare('INSERT INTO baixas (titulo_id, valor_cent, data, usuario, data_hora, chave_idempotencia) VALUES (?,?,?,?,?,?)')
      .run(t.id, valor, d.data, ctx.usuario.login, base.agoraIso(ctx), chave);
    base.auditar(ctx, 'TITULO', t.id, 'LIQUIDACAO', { numero: t.numero, parcela: t.parcela, valor: d.valor, situacao });
    return obter(ctx, id);
  });
}


// Ajuste de título em aberto (perfil FINANCEIRO/ADMIN): só vencimento e observação (campo "historico").
// Valor, saldo, participante e situação nunca mudam por aqui; título liquidado fica congelado.
function editar(ctx, id, dados) {
  const d = new Validador(dados)
    .data('vencimento')
    .texto('historico', { max: 250 })
    .resultado();
  return transacao(ctx.db, () => {
    const t = ctx.db.prepare('SELECT * FROM titulos WHERE id = ?').get(Number(id));
    if (!t) throw erro.naoEncontrado('Título não encontrado.');
    base.exigirVersao(dados.versao, t.versao);
    if (t.situacao === 'LIQUIDADO') throw erro.regra('Título liquidado não pode ser alterado.');
    if (d.vencimento < t.emissao) throw erro.validacao('Vencimento anterior à emissão.', { vencimento: 'Anterior à emissão.' });
    const historico = Object.prototype.hasOwnProperty.call(dados || {}, 'historico') ? d.historico : t.historico;
    const diff = {};
    if (d.vencimento !== t.vencimento) diff.vencimento = { de: t.vencimento, para: d.vencimento };
    if (historico !== t.historico) diff.observacao = { de: t.historico, para: historico };
    if (!Object.keys(diff).length) return obter(ctx, id);
    const r = ctx.db.prepare('UPDATE titulos SET vencimento = ?, historico = ?, versao = versao + 1 WHERE id = ? AND versao = ?')
      .run(d.vencimento, historico, t.id, t.versao);
    if (r.changes !== 1) throw erro.conflito('Título alterado por outra operação. Recarregue e tente novamente.');
    base.auditar(ctx, 'TITULO', t.id, 'ALTERACAO', { numero: t.numero, parcela: t.parcela, ...diff });
    return obter(ctx, id);
  });
}
module.exports = { listar, obter, liquidar, editar };
