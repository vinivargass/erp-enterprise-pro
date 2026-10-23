'use strict';
// Cadastro de clientes — equivalente Protheus: SA1 mantida pela rotina padrão (CRMA980/MATA030)
// e ZERPCLI.PRW. Ver protheus/src/ZERPCLI.PRW.
const { transacao, proximaSequencia } = require('../db');
const { erro } = require('../erros');
const { Validador, UFS, somenteDigitos, documentoValido, emailValido, centavos, reais } = require('../validacao');
const base = require('./base');

const CAMPOS_HIST = ['razao_social', 'nome_fantasia', 'tipo_pessoa', 'documento', 'inscricao_estadual', 'cep',
  'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'telefone', 'email', 'cond_pagto',
  'limite_credito', 'ativo'];

function paraApi(r) {
  if (!r) return r;
  const { limite_credito_cent, ...resto } = r;
  return { ...resto, ativo: !!r.ativo, limite_credito: reais(limite_credito_cent) };
}

// ---------- Regras de acesso a clientes ----------
// Escopo: o vendedor só enxerga a própria carteira e os clientes dos próprios pedidos (404 nos demais).
const soCarteira = (ctx) => ctx.usuario.perfil === 'VENDEDOR';
const FILTRO_CARTEIRA = '(vendedor = ? COLLATE NOCASE OR id IN (SELECT cliente_id FROM pedidos WHERE vendedor = ? COLLATE NOCASE))';
function visivel(ctx, cli) {
  if (!soCarteira(ctx)) return true;
  return ctx.db.prepare(`SELECT 1 FROM clientes WHERE id = ? AND ${FILTRO_CARTEIRA}`).get(cli.id, ctx.usuario.login, ctx.usuario.login) !== undefined;
}
// Limite e crédito só vão para o navegador de quem tem 'clientes.credito'.
function protegerCampos(ctx, c) {
  if (!c || base.pode(ctx, 'clientes.credito')) return c;
  const { limite_credito, credito_utilizado, credito_disponivel, ...resto } = c;
  return resto;
}
// Vendedor responsável válido: login de um VENDEDOR ativo (ou nenhum).
function vendedorValido(ctx, login) {
  if (login === null || login === undefined || login === '') return null;
  const v = ctx.db.prepare("SELECT login FROM usuarios WHERE login = ? COLLATE NOCASE AND perfil = 'VENDEDOR' AND ativo = 1").get(String(login));
  if (!v) throw erro.validacao('Existem campos inválidos.', { vendedor: 'Escolha um vendedor ativo.' });
  return v.login;
}
function vendedores(ctx) {
  return ctx.db.prepare("SELECT login, nome FROM usuarios WHERE perfil = 'VENDEDOR' AND ativo = 1 ORDER BY nome").all();
}

function validar(ctx, dados) {
  const v = new Validador(dados)
    .texto('razao_social', { obrigatorio: true, max: 80, min: 3 })
    .texto('nome_fantasia', { obrigatorio: true, max: 40 })
    .opcao('tipo_pessoa', ['F', 'J'])
    .texto('documento', { obrigatorio: true, max: 18 })
    .texto('inscricao_estadual', { max: 18, maiusculo: true })
    .texto('cep', { obrigatorio: true, max: 9 })
    .texto('logradouro', { obrigatorio: true, max: 80 })
    .texto('numero', { obrigatorio: true, max: 10 })
    .texto('complemento', { max: 50 })
    .texto('bairro', { obrigatorio: true, max: 40 })
    .texto('municipio', { obrigatorio: true, max: 60 })
    .texto('uf', { obrigatorio: true, max: 2, maiusculo: true })
    .texto('telefone', { max: 20 })
    .texto('email', { max: 120 })
    .texto('cond_pagto', { obrigatorio: true, max: 3, maiusculo: true })
    .numero('limite_credito', { obrigatorio: true, min: 0, max: 99999999.99 })
    .logico('ativo', true);

  const s = v.saida;
  if (s.documento !== undefined) {
    s.documento = somenteDigitos(s.documento);
    v.verificar('documento', documentoValido(s.tipo_pessoa, s.documento),
      s.tipo_pessoa === 'J' ? 'CNPJ inválido.' : 'CPF inválido.');
  }
  if (s.cep !== undefined) { s.cep = somenteDigitos(s.cep); v.verificar('cep', s.cep.length === 8, 'CEP deve ter 8 dígitos.'); }
  if (s.uf !== undefined) v.verificar('uf', UFS.includes(s.uf), 'UF inválida.');
  if (s.email) v.verificar('email', emailValido(s.email), 'E-mail inválido.');
  if (s.inscricao_estadual) {
    v.verificar('inscricao_estadual', s.inscricao_estadual === 'ISENTO' || /^[0-9./-]{2,18}$/.test(s.inscricao_estadual),
      'Informe somente números ou ISENTO.');
  }
  if (s.cond_pagto) {
    const cp = ctx.db.prepare('SELECT 1 FROM condicoes_pagamento WHERE codigo = ?').get(s.cond_pagto);
    v.verificar('cond_pagto', !!cp, 'Condição de pagamento inexistente.');
  }
  return v.resultado();
}

function garantirDocumentoUnico(ctx, documento, idIgnorar) {
  const dup = ctx.db.prepare('SELECT codigo, razao_social FROM clientes WHERE documento = ? AND id <> ?')
    .get(documento, idIgnorar || 0);
  if (dup) {
    throw erro.conflito(`Documento já cadastrado para o cliente ${dup.codigo} - ${dup.razao_social}.`,
      { documento: 'Documento já cadastrado.' });
  }
}

// Converte violação de UNIQUE (corrida entre duas inclusões simultâneas) em 409.
function traduzirUnico(e) {
  if (/UNIQUE constraint failed: clientes\.documento/.test(e.message)) {
    return erro.conflito('Documento já cadastrado.', { documento: 'Documento já cadastrado.' });
  }
  return e;
}

function listar(ctx, query = {}) {
  const filtros = [];
  const args = [];
  const q = String(query.q || '').trim();
  if (q) {
    const campo = query.campo || 'todos';
    const dig = somenteDigitos(q);
    if (campo === 'codigo') { filtros.push('codigo LIKE ? ESCAPE \'\\\''); args.push(base.like(q)); }
    else if (campo === 'nome') { filtros.push('(razao_social LIKE ? ESCAPE \'\\\' OR nome_fantasia LIKE ? ESCAPE \'\\\')'); args.push(base.like(q), base.like(q)); }
    else if (campo === 'documento') { filtros.push('documento LIKE ? ESCAPE \'\\\''); args.push(base.like(dig || q)); }
    else {
      filtros.push('(codigo LIKE ? ESCAPE \'\\\' OR razao_social LIKE ? ESCAPE \'\\\' OR nome_fantasia LIKE ? ESCAPE \'\\\'' + (dig ? ' OR documento LIKE ? ESCAPE \'\\\'' : '') + ')');
      args.push(base.like(q), base.like(q), base.like(q));
      if (dig) args.push(base.like(dig));
    }
  }
  if (query.status === 'ativo') filtros.push('ativo = 1');
  if (query.status === 'inativo') filtros.push('ativo = 0');
  if (query.uf && UFS.includes(String(query.uf).toUpperCase())) { filtros.push('uf = ?'); args.push(String(query.uf).toUpperCase()); }
  if (soCarteira(ctx)) { filtros.push(FILTRO_CARTEIRA); args.push(ctx.usuario.login, ctx.usuario.login); }

  const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';
  const colunas = { codigo: 'codigo', razao_social: 'razao_social', municipio: 'municipio', uf: 'uf' };
  if (base.pode(ctx, 'clientes.credito')) colunas.limite_credito = 'limite_credito_cent'; // sem crédito, nem ordena por ele
  const ordem = base.ordenacao(query, colunas, 'codigo');
  const pag = base.paginar(ctx, query);
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM clientes ${where}`).get(...args).n;
  const itens = ctx.db.prepare(`SELECT * FROM clientes ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .all(...args, pag.tamanho, pag.offset).map((r) => protegerCampos(ctx, paraApi(r)));
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

// Uso interno (pedidos, crédito): sem regra de escopo.
function obterLinha(ctx, id) {
  const r = ctx.db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(id));
  if (!r) throw erro.naoEncontrado('Cliente não encontrado.');
  return r;
}
// Para as rotas da API: fora da carteira do vendedor responde 404, como se não existisse.
function obterVisivel(ctx, id) {
  const r = obterLinha(ctx, id);
  if (!visivel(ctx, r)) throw erro.naoEncontrado('Cliente não encontrado.');
  return r;
}

// Crédito comprometido = títulos a receber em aberto + pedidos aprovados ainda não faturados.
function creditoUtilizadoCent(ctx, clienteId, ignorarPedidoId) {
  const t = ctx.db.prepare(`SELECT COALESCE(SUM(saldo_cent),0) v FROM titulos
                            WHERE tipo = 'R' AND cliente_id = ? AND situacao <> 'LIQUIDADO'`).get(clienteId).v;
  const p = ctx.db.prepare(`SELECT COALESCE(SUM(total_liquido_cent),0) v FROM pedidos
                            WHERE cliente_id = ? AND status = 'APROVADO' AND id <> ?`).get(clienteId, ignorarPedidoId || 0).v;
  return t + p;
}

function obter(ctx, id) {
  const r = obterVisivel(ctx, id);
  const usado = creditoUtilizadoCent(ctx, r.id);
  return protegerCampos(ctx, { ...paraApi(r), credito_utilizado: reais(usado), credito_disponivel: reais(r.limite_credito_cent - usado) });
}

function incluir(ctx, dados) {
  // Carteira e limite de crédito só por quem gerencia a carteira; o vendedor cadastra na própria carteira, sem limite.
  const carteira = base.pode(ctx, 'clientes.carteira');
  const entrada = { ...(dados || {}) };
  if (!carteira) entrada.limite_credito = 0;
  const vendedor = carteira ? vendedorValido(ctx, entrada.vendedor) : (soCarteira(ctx) ? ctx.usuario.login : null);
  const d = validar(ctx, entrada);
  try {
    return transacao(ctx.db, () => {
      garantirDocumentoUnico(ctx, d.documento);
      const codigo = proximaSequencia(ctx.db, 'CLIENTE', 6);
      const agora = base.agoraIso(ctx);
      const { lastInsertRowid } = ctx.db.prepare(`INSERT INTO clientes (codigo, razao_social, nome_fantasia, tipo_pessoa,
          documento, inscricao_estadual, cep, logradouro, numero, complemento, bairro, municipio, uf, telefone, email,
          cond_pagto, limite_credito_cent, ativo, vendedor, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(codigo, d.razao_social, d.nome_fantasia, d.tipo_pessoa, d.documento, d.inscricao_estadual, d.cep,
          d.logradouro, d.numero, d.complemento, d.bairro, d.municipio, d.uf, d.telefone, d.email.toLowerCase(),
          d.cond_pagto, centavos(d.limite_credito), d.ativo ? 1 : 0, vendedor, agora, agora);
      base.auditar(ctx, 'CLIENTE', Number(lastInsertRowid), 'INCLUSAO', { codigo, documento: d.documento });
      return obter(ctx, lastInsertRowid);
    });
  } catch (e) { throw traduzirUnico(e); }
}

function alterar(ctx, id, dados) {
  const atualAntes = obterVisivel(ctx, id);
  // Sem 'clientes.carteira' o limite e o vendedor ficam como estão; sem 'clientes.inativar', o status também.
  const carteira = base.pode(ctx, 'clientes.carteira');
  const entrada = { ...(dados || {}) };
  if (!carteira) entrada.limite_credito = reais(atualAntes.limite_credito_cent);
  if (!base.pode(ctx, 'clientes.inativar')) entrada.ativo = !!atualAntes.ativo;
  const vendedor = carteira && 'vendedor' in entrada ? vendedorValido(ctx, entrada.vendedor) : atualAntes.vendedor;
  const d = validar(ctx, entrada);
  try {
    return transacao(ctx.db, () => {
      const atual = obterVisivel(ctx, id);
      base.exigirVersao(dados.versao, atual.versao);
      garantirDocumentoUnico(ctx, d.documento, atual.id);
      const antes = paraApi(atual);
      const depois = { ...d, email: d.email.toLowerCase(), vendedor };
      const dif = base.diferencas(antes, depois, [...CAMPOS_HIST, 'vendedor']);
      if (!Object.keys(dif).length) return obter(ctx, id);
      const r = ctx.db.prepare(`UPDATE clientes SET razao_social=?, nome_fantasia=?, tipo_pessoa=?, documento=?,
          inscricao_estadual=?, cep=?, logradouro=?, numero=?, complemento=?, bairro=?, municipio=?, uf=?, telefone=?,
          email=?, cond_pagto=?, limite_credito_cent=?, ativo=?, vendedor=?, versao = versao + 1, atualizado_em=?
          WHERE id = ? AND versao = ?`)
        .run(d.razao_social, d.nome_fantasia, d.tipo_pessoa, d.documento, d.inscricao_estadual, d.cep, d.logradouro,
          d.numero, d.complemento, d.bairro, d.municipio, d.uf, d.telefone, depois.email, d.cond_pagto,
          centavos(d.limite_credito), d.ativo ? 1 : 0, vendedor, base.agoraIso(ctx), atual.id, atual.versao);
      if (r.changes !== 1) throw erro.conflito('O registro foi alterado por outro usuário. Recarregue e tente novamente.');
      base.auditar(ctx, 'CLIENTE', atual.id, 'ALTERACAO', dif);
      return obter(ctx, id);
    });
  } catch (e) { throw traduzirUnico(e); }
}

// Inativação lógica (equivalente a A1_MSBLQL = '1'): cliente nunca é excluído fisicamente,
// pois há pedidos e títulos que o referenciam.
function definirAtivo(ctx, id, ativo, versao) {
  return transacao(ctx.db, () => {
    const atual = obterVisivel(ctx, id);
    base.exigirVersao(versao, atual.versao);
    if (!!atual.ativo === ativo) throw erro.regra(ativo ? 'Cliente já está ativo.' : 'Cliente já está inativo.');
    ctx.db.prepare('UPDATE clientes SET ativo = ?, versao = versao + 1, atualizado_em = ? WHERE id = ?')
      .run(ativo ? 1 : 0, base.agoraIso(ctx), atual.id);
    base.auditar(ctx, 'CLIENTE', atual.id, ativo ? 'REATIVACAO' : 'INATIVACAO', { ativo: { de: !!atual.ativo, para: ativo } });
    return obter(ctx, id);
  });
}

function historico(ctx, id) {
  obterVisivel(ctx, id);
  const credito = base.pode(ctx, 'clientes.credito');
  return ctx.db.prepare(`SELECT acao, usuario, data_hora, detalhes FROM auditoria
                         WHERE entidade = 'CLIENTE' AND entidade_id = ? ORDER BY id DESC LIMIT 100`)
    .all(Number(id)).map((h) => {
      const detalhes = JSON.parse(h.detalhes);
      if (!credito) delete detalhes.limite_credito; // histórico não revela o limite a quem não pode vê-lo
      return { ...h, detalhes };
    });
}

function condicoesPagamento(ctx) {
  return ctx.db.prepare('SELECT codigo, descricao, dias FROM condicoes_pagamento ORDER BY codigo').all();
}

module.exports = { listar, obter, obterLinha, visivel, incluir, alterar, definirAtivo, historico, creditoUtilizadoCent, condicoesPagamento, vendedores };


