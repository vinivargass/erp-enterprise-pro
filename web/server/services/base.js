'use strict';
// Utilitários comuns aos serviços: contexto, auditoria, parâmetros (equivalente ao SX6),
// paginação e controle otimista de versão.
const { erro } = require('../erros');

// ctx = { db, usuario: { id, login, perfil }, agora: () => Date }
const hoje = (ctx) => ctx.agora().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
const agoraIso = (ctx) => ctx.agora().toISOString();
// Permissão efetiva do usuário da sessão (padrão do perfil + adicionais), para regras de campo e de escopo.
const pode = (ctx, permissao) => (ctx.usuario.permissoes || []).includes(permissao);

function auditar(ctx, entidade, entidadeId, acao, detalhes) {
  ctx.db.prepare(`INSERT INTO auditoria (entidade, entidade_id, acao, usuario, data_hora, detalhes)
                  VALUES (?, ?, ?, ?, ?, ?)`)
    .run(entidade, entidadeId ?? null, acao, ctx.usuario.login, agoraIso(ctx), JSON.stringify(detalhes || {}));
}

// Diferença campo a campo entre dois objetos (para histórico de alterações).
function diferencas(antes, depois, campos) {
  const d = {};
  for (const c of campos) {
    if (String(antes[c]) !== String(depois[c])) d[c] = { de: antes[c], para: depois[c] };
  }
  return d;
}

const PARAMETROS_PADRAO = [
  ['ZZ_DESCMXV', '10', 'N', 'Desconto máximo (%) por item que o vendedor aplica sem aprovação.'],
  ['ZZ_DESCMXG', '25', 'N', 'Desconto máximo (%) por item admitido mesmo com aprovação gerencial.'],
  ['ZZ_CREDPOL', 'APROVACAO', 'C', 'Pedido acima do limite de crédito: REJEITAR ou APROVACAO (envia para gerente).'],
  ['ZZ_ESTNEG', 'N', 'L', 'Permite saída de estoque acima do saldo (S/N). Equivale à política do MV_ESTNEG.'],
  ['ZZ_PAGSIZE', '10', 'N', 'Registros por página nas listagens.'],
];

function parametro(ctx, chave) {
  const p = ctx.db.prepare('SELECT valor, tipo FROM parametros WHERE chave = ?').get(chave);
  if (!p) throw new Error(`Parâmetro ${chave} não cadastrado.`);
  if (p.tipo === 'N') return Number(p.valor);
  if (p.tipo === 'L') return p.valor === 'S';
  return p.valor;
}

function listarParametros(ctx) {
  return ctx.db.prepare('SELECT chave, valor, tipo, descricao FROM parametros ORDER BY chave').all();
}

function alterarParametro(ctx, chave, valor) {
  const p = ctx.db.prepare('SELECT * FROM parametros WHERE chave = ?').get(chave);
  if (!p) throw erro.naoEncontrado('Parâmetro inexistente.');
  const v = String(valor ?? '').trim().toUpperCase();
  const ok = p.tipo === 'N' ? /^\d+(\.\d+)?$/.test(v) && Number(v) <= 100
    : p.tipo === 'L' ? ['S', 'N'].includes(v)
      : chave === 'ZZ_CREDPOL' ? ['REJEITAR', 'APROVACAO'].includes(v) : v.length > 0 && v.length <= 50;
  if (!ok) throw erro.validacao('Valor inválido para o parâmetro.', { valor: 'Valor inválido.' });
  if (chave === 'ZZ_DESCMXV' && Number(v) > parametro(ctx, 'ZZ_DESCMXG')) {
    throw erro.regra('O desconto do vendedor não pode superar o desconto máximo gerencial.');
  }
  if (chave === 'ZZ_DESCMXG' && (Number(v) >= 100 || Number(v) < parametro(ctx, 'ZZ_DESCMXV'))) {
    throw erro.regra('O desconto gerencial deve ser menor que 100% e maior ou igual ao do vendedor.');
  }
  ctx.db.prepare('UPDATE parametros SET valor = ? WHERE chave = ?').run(v, chave);
  auditar(ctx, 'PARAMETRO', null, 'ALTERACAO', { chave, de: p.valor, para: v });
  return { chave, valor: v };
}

function paginar(ctx, query) {
  const tamanho = Math.min(Math.max(parseInt(query.tamanho, 10) || parametro(ctx, 'ZZ_PAGSIZE'), 1), 100);
  const pagina = Math.max(parseInt(query.pagina, 10) || 1, 1);
  return { tamanho, pagina, offset: (pagina - 1) * tamanho };
}

// Ordenação somente por colunas de uma lista branca (nunca concatena texto do usuário).
function ordenacao(query, permitidas, padrao) {
  const col = permitidas[query.ordem] || permitidas[padrao];
  const dir = query.direcao === 'desc' ? 'DESC' : 'ASC';
  return `${col} ${dir}`;
}

// Escapa curingas do LIKE e usa ESCAPE '\'.
const like = (t) => '%' + String(t).replace(/[\\%_]/g, (m) => '\\' + m) + '%';

function exigirVersao(versaoInformada, versaoAtual) {
  if (versaoInformada === undefined || versaoInformada === null) return; // clientes de API antigos
  if (Number(versaoInformada) !== Number(versaoAtual)) {
    throw erro.conflito('O registro foi alterado por outro usuário. Recarregue e tente novamente.',
      { versao_atual: versaoAtual });
  }
}

module.exports = {
  hoje, agoraIso, pode, auditar, diferencas, PARAMETROS_PADRAO, parametro, listarParametros,
  alterarParametro, paginar, ordenacao, like, exigirVersao,
};
