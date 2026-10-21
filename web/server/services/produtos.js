'use strict';
// Cadastro de produtos — equivalente Protheus: SB1 via MATA010 (ExecAuto) e saldo em SB2.
// Ver protheus/src/ZERPPROD.PRW.
//
// O saldo NÃO é editável pelo cadastro: na inclusão, o saldo inicial vira uma movimentação
// de origem SALDO_INICIAL; depois disso, só o módulo de estoque altera quantidades.
const { transacao } = require('../db');
const { erro } = require('../erros');
const { Validador, somenteDigitos, centavos, reais } = require('../validacao');
const base = require('./base');
const estoque = require('./estoque');

const TIPOS = ['PA', 'ME', 'MP', 'MC', 'SV'];
const UNIDADES = ['UN', 'PC', 'CX', 'KG', 'M', 'M2', 'L', 'MT', 'RL', 'HR'];
const CAMPOS_HIST = ['descricao', 'grupo', 'unidade', 'tipo', 'preco_venda', 'custo', 'estoque_minimo', 'ncm', 'ativo'];

function paraApi(r) {
  if (!r) return r;
  const { preco_venda_cent, custo_cent, ...resto } = r;
  return {
    ...resto, ativo: !!r.ativo, preco_venda: reais(preco_venda_cent), custo: reais(custo_cent),
    disponivel: Math.round((r.saldo - r.reservado) * 10000) / 10000,
    abaixo_minimo: r.saldo - r.reservado < r.estoque_minimo,
  };
}

function validar(dados, inclusao) {
  const v = new Validador(dados)
    .texto('descricao', { obrigatorio: true, min: 3, max: 60 })
    .texto('grupo', { obrigatorio: true, max: 4, maiusculo: true })
    .opcao('unidade', UNIDADES)
    .opcao('tipo', TIPOS)
    .numero('preco_venda', { obrigatorio: true, min: 0, minExclusivo: true, max: 9999999.99 })
    .numero('custo', { obrigatorio: true, min: 0, max: 9999999.99 })
    .numero('estoque_minimo', { obrigatorio: true, min: 0, max: 9999999, casas: 4 })
    .texto('ncm', { max: 10 })
    .logico('ativo', true);
  if (inclusao) {
    v.texto('codigo', { obrigatorio: true, max: 15, maiusculo: true })
      .numero('saldo_inicial', { min: 0, max: 9999999, casas: 4, padrao: 0 });
    if (v.saida.codigo) v.verificar('codigo', /^[A-Z0-9._-]+$/.test(v.saida.codigo), 'Use letras, números, ponto, hífen ou sublinhado.');
  }
  // NCM é apenas informativo: valida o formato (8 dígitos), não a existência na tabela TIPI.
  if (v.saida.ncm) { v.saida.ncm = somenteDigitos(v.saida.ncm); v.verificar('ncm', v.saida.ncm.length === 8, 'NCM deve ter 8 dígitos.'); }
  return v.resultado();
}

function avisos(d) {
  const a = [];
  if (d.custo > 0 && d.preco_venda < d.custo) a.push('Preço de venda abaixo do custo (margem negativa).');
  return a;
}

function listar(ctx, query = {}) {
  const f = [];
  const a = [];
  if (query.q) { f.push("(codigo LIKE ? ESCAPE '\\' OR descricao LIKE ? ESCAPE '\\')"); a.push(base.like(query.q), base.like(query.q)); }
  if (query.grupo) { f.push('grupo = ?'); a.push(String(query.grupo).toUpperCase()); }
  if (TIPOS.includes(query.tipo)) { f.push('tipo = ?'); a.push(query.tipo); }
  if (query.status === 'ativo') f.push('ativo = 1');
  if (query.status === 'inativo') f.push('ativo = 0');
  if (query.estoque === 'abaixo') f.push('saldo - reservado < estoque_minimo');
  const where = f.length ? 'WHERE ' + f.join(' AND ') : '';
  const ordem = base.ordenacao(query, {
    codigo: 'codigo', descricao: 'descricao', grupo: 'grupo', preco_venda: 'preco_venda_cent', saldo: 'saldo',
  }, 'codigo');
  const pag = base.paginar(ctx, query);
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM produtos ${where}`).get(...a).n;
  const itens = ctx.db.prepare(`SELECT * FROM produtos ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(...a, pag.tamanho, pag.offset).map(paraApi);
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

function obterLinha(ctx, id) {
  const r = ctx.db.prepare('SELECT * FROM produtos WHERE id = ?').get(Number(id));
  if (!r) throw erro.naoEncontrado('Produto não encontrado.');
  return r;
}
const obter = (ctx, id) => paraApi(obterLinha(ctx, id));

function grupos(ctx) {
  return ctx.db.prepare('SELECT DISTINCT grupo FROM produtos ORDER BY grupo').all().map((r) => r.grupo);
}

function incluir(ctx, dados) {
  const d = validar(dados, true);
  try {
    return transacao(ctx.db, () => {
      if (ctx.db.prepare('SELECT 1 FROM produtos WHERE codigo = ?').get(d.codigo)) {
        throw erro.conflito('Código de produto já cadastrado.', { codigo: 'Código já cadastrado.' });
      }
      const agora = base.agoraIso(ctx);
      const { lastInsertRowid: id } = ctx.db.prepare(`INSERT INTO produtos (codigo, descricao, grupo, unidade, tipo,
          preco_venda_cent, custo_cent, estoque_minimo, ncm, ativo, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(d.codigo, d.descricao, d.grupo, d.unidade, d.tipo, centavos(d.preco_venda), centavos(d.custo),
          d.estoque_minimo, d.ncm, d.ativo ? 1 : 0, agora, agora);
      if (d.saldo_inicial > 0) {
        estoque.registrar(ctx, {
          produtoId: id, tipo: 'E', quantidade: d.saldo_inicial, motivo: 'Saldo inicial na inclusão do produto',
          origem: 'SALDO_INICIAL', referencia: d.codigo,
        });
      }
      base.auditar(ctx, 'PRODUTO', Number(id), 'INCLUSAO', { codigo: d.codigo, saldo_inicial: d.saldo_inicial });
      return { ...obter(ctx, id), avisos: avisos(d) };
    });
  } catch (e) {
    if (/UNIQUE constraint failed: produtos\.codigo/.test(e.message)) throw erro.conflito('Código de produto já cadastrado.');
    throw e;
  }
}

function alterar(ctx, id, dados) {
  if (dados && (dados.saldo !== undefined || dados.saldo_inicial !== undefined || dados.reservado !== undefined)) {
    throw erro.regra('O saldo não é alterado pelo cadastro. Use uma movimentação de estoque.');
  }
  const d = validar(dados, false);
  return transacao(ctx.db, () => {
    const atual = obterLinha(ctx, id);
    base.exigirVersao(dados.versao, atual.versao);
    if (!d.ativo && atual.reservado > 0) throw erro.regra('Produto possui reserva em pedidos aprovados; não pode ser inativado.');
    const dif = base.diferencas(paraApi(atual), d, CAMPOS_HIST);
    if (!Object.keys(dif).length) return { ...obter(ctx, id), avisos: avisos(d) };
    const r = ctx.db.prepare(`UPDATE produtos SET descricao=?, grupo=?, unidade=?, tipo=?, preco_venda_cent=?, custo_cent=?,
        estoque_minimo=?, ncm=?, ativo=?, versao = versao + 1, atualizado_em=? WHERE id=? AND versao=?`)
      .run(d.descricao, d.grupo, d.unidade, d.tipo, centavos(d.preco_venda), centavos(d.custo), d.estoque_minimo,
        d.ncm, d.ativo ? 1 : 0, base.agoraIso(ctx), atual.id, atual.versao);
    if (r.changes !== 1) throw erro.conflito('O registro foi alterado por outro usuário. Recarregue e tente novamente.');
    base.auditar(ctx, 'PRODUTO', atual.id, 'ALTERACAO', dif);
    return { ...obter(ctx, id), avisos: avisos(d) };
  });
}

// Exclusão física só para produto nunca utilizado; caso contrário, orienta a inativação.
function excluir(ctx, id, versao) {
  return transacao(ctx.db, () => {
    const atual = obterLinha(ctx, id);
    base.exigirVersao(versao, atual.versao);
    const usado = ctx.db.prepare(`SELECT
        (SELECT COUNT(*) FROM movimentos_estoque WHERE produto_id = ?) +
        (SELECT COUNT(*) FROM pedido_itens WHERE produto_id = ?) n`).get(atual.id, atual.id).n;
    if (usado > 0) throw erro.regra('Produto possui movimentações ou pedidos e não pode ser excluído. Inative o cadastro.');
    ctx.db.prepare('DELETE FROM produtos WHERE id = ?').run(atual.id);
    base.auditar(ctx, 'PRODUTO', atual.id, 'EXCLUSAO', { codigo: atual.codigo });
    return { excluido: true };
  });
}

module.exports = { TIPOS, UNIDADES, listar, obter, obterLinha, incluir, alterar, excluir, grupos };
