'use strict';
// Área administrativa: painel (estilo BI) e gestão do perfil Admin.
// Acesso controlado nas ROTAS (permissões 'admin.painel' e 'usuarios.gerir', só ADMIN),
// recalculadas do banco a cada requisição — nada vindo do navegador define o perfil.
const { transacao } = require('../db');
const { erro } = require('../erros');
const { alterarUsuario, PERFIS, catalogoPerfis, definirAdicionais, adicionaisDoUsuario, permissoesEfetivas } = require('../auth');
const { reais } = require('../validacao');
const base = require('./base');

// ---------------------------------------------------------------- usuários e perfis

// Normaliza para pesquisa: minúsculas e sem acentos ("João" ≈ "joao").
const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const FILTROS_PERFIL = ['todos', 'admin', 'comum'];

// Pesquisa por nome completo, parte do nome ou login. A filtragem sem acentos é feita em memória:
// o SQLite não remove acentos nativamente e o volume de usuários de um ERP é pequeno.
// Nunca devolve senha_hash, tokens ou sessões.
function buscarUsuarios(ctx, query = {}) {
  const termo = normalizar(query.q).slice(0, 60);
  // 'todos' | 'admin' | 'comum' | um perfil específico (ex.: 'VENDEDOR')
  const filtro = FILTROS_PERFIL.includes(query.perfil) || PERFIS.includes(query.perfil) ? query.perfil : 'todos';
  let lista = ctx.db.prepare('SELECT id, login, nome, perfil, perfil_base, ativo FROM usuarios').all()
    .map((u) => ({ ...u, ativo: !!u.ativo, admin: u.perfil === 'ADMIN' }));
  if (termo) lista = lista.filter((u) => normalizar(u.nome).includes(termo) || normalizar(u.login).includes(termo));
  if (filtro === 'admin') lista = lista.filter((u) => u.admin);
  if (filtro === 'comum') lista = lista.filter((u) => !u.admin);
  if (PERFIS.includes(filtro)) lista = lista.filter((u) => u.perfil === filtro);
  if (query.status === 'ativo') lista = lista.filter((u) => u.ativo);
  if (query.status === 'inativo') lista = lista.filter((u) => !u.ativo);

  const col = ['nome', 'login', 'perfil', 'ativo'].includes(query.ordem) ? query.ordem : 'nome';
  const dir = query.direcao === 'desc' ? -1 : 1;
  const chave = (u) => (col === 'ativo' ? (u.ativo ? '0' : '1') : normalizar(u[col]));
  lista.sort((a, b) => dir * chave(a).localeCompare(chave(b)) || a.id - b.id);

  const tamanho = Math.min(Math.max(parseInt(query.tamanho, 10) || 10, 1), 50);
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  const pagina = Math.min(Math.max(parseInt(query.pagina, 10) || 1, 1), paginas);
  const adminsAtivos = ctx.db.prepare("SELECT COUNT(*) n FROM usuarios WHERE perfil = 'ADMIN' AND ativo = 1").get().n;
  return {
    itens: lista.slice((pagina - 1) * tamanho, pagina * tamanho).map((u) => ({
      id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, admin: u.admin, ativo: u.ativo,
      // perfil ao qual a pessoa volta se perder o Admin (informado na confirmação)
      perfil_comum: u.admin ? (u.perfil_base || 'CONSULTA') : u.perfil,
      voce: u.id === ctx.usuario.id,
      adicionais: u.admin ? [] : adicionaisDoUsuario(ctx.db, u.id),
      ...(query.exclusao === '1' ? { exclusao: avaliarExclusao(ctx, u) } : {}),
    })),
    total, pagina, tamanho, admins_ativos: adminsAtivos,
  };
}

// Conceder (paraAdmin = true) ou remover (false) o perfil Admin. A auditoria registra o resultado
// real: SUCESSO dentro da mesma transação da alteração; FALHA/NEGADO numa gravação à parte
// (a transação da alteração foi desfeita).
function definirAdmin(ctx, id, paraAdmin) {
  const alvo = ctx.db.prepare('SELECT id, login, nome, perfil, perfil_base, ativo FROM usuarios WHERE id = ?').get(Number(id));
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  return aplicarPerfil(ctx, alvo, paraAdmin ? 'ADMIN' : (alvo.perfil_base || 'CONSULTA'), paraAdmin ? 'CONCEDER_ADMIN' : 'REMOVER_ADMIN', () => {
    if (paraAdmin && alvo.perfil === 'ADMIN') throw erro.regra(`${alvo.nome} já é administrador.`);
    if (!paraAdmin && alvo.perfil !== 'ADMIN') throw erro.regra(`${alvo.nome} não é administrador.`);
  });
}

// Troca para QUALQUER perfil da lista oficial e/ou define os acessos adicionais do usuário.
// Corpo: { perfil, adicionais: ['pedidos.faturar', ...] }. O perfil e cada adicional são conferidos
// contra as listas do servidor; as proteções (próprio acesso, último admin) são as mesmas.
// Sem 'adicionais' no corpo: mantém os atuais se o perfil não mudou; zera se mudou.
function definirPerfil(ctx, id, perfil, adicionais) {
  const alvo = ctx.db.prepare('SELECT id, login, nome, perfil, perfil_base, ativo FROM usuarios WHERE id = ?').get(Number(id));
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  const novo = perfil === undefined || perfil === null || perfil === '' ? alvo.perfil : typeof perfil === 'string' ? perfil.toUpperCase() : '';
  const atuais = adicionaisDoUsuario(ctx.db, alvo.id).sort();
  const lista = Array.isArray(adicionais) ? [...new Set(adicionais.map(String))].sort() : novo === alvo.perfil ? atuais : [];
  const acao = novo === 'ADMIN' && alvo.perfil !== 'ADMIN' ? 'CONCEDER_ADMIN'
    : alvo.perfil === 'ADMIN' && novo !== 'ADMIN' ? 'REMOVER_ADMIN'
      : novo !== alvo.perfil ? 'ALTERAR_PERFIL' : 'ALTERAR_ACESSOS';
  return aplicarPerfil(ctx, alvo, novo, acao, () => {
    if (alvo.id === ctx.usuario.id) {
      throw erro.regra(alvo.perfil === 'ADMIN' && novo !== 'ADMIN' ? 'Você não pode remover o próprio acesso de administrador.' : 'Você não pode alterar o próprio perfil de acesso.');
    }
    if (!PERFIS.includes(novo)) throw erro.validacao('Perfil inválido.', { perfil: 'Escolha um dos perfis da lista.' });
    if (adicionais !== undefined && !Array.isArray(adicionais)) throw erro.validacao('Acessos adicionais inválidos.', { adicionais: 'Envie uma lista.' });
    if (novo === alvo.perfil && lista.join() === atuais.join()) throw erro.regra(`Nenhuma alteração: ${alvo.nome} já tem este perfil e estes acessos.`);
  }, lista, atuais);
}

function aplicarPerfil(ctx, alvo, novoPerfil, acao, validar, adicionais = [], anteriores = adicionaisDoUsuario(ctx.db, alvo.id)) {
  const detalhesBase = { usuario_afetado: alvo.login, nome: alvo.nome, perfil_anterior: alvo.perfil, adicionais_anteriores: anteriores };
  try {
    validar();
    if (novoPerfil === 'ADMIN' && !alvo.ativo) throw erro.regra('Reative a conta antes de conceder o perfil Admin.');
    return transacao(ctx.db, () => {
      const r = novoPerfil !== alvo.perfil ? alterarUsuario(ctx.db, ctx.usuario, alvo.id, { perfil: novoPerfil })
        : { depois: { perfil: alvo.perfil, ativo: !!alvo.ativo } };
      // Admin já tem tudo: não guarda adicionais. Os demais são validados contra a lista do perfil.
      definirAdicionais(ctx.db, alvo.id, r.depois.perfil, r.depois.perfil === 'ADMIN' ? [] : adicionais, ctx.usuario.login, base.agoraIso(ctx));
      const novos = adicionaisDoUsuario(ctx.db, alvo.id).sort();
      base.auditar(ctx, 'USUARIO', alvo.id, acao, {
        ...detalhesBase, perfil_novo: r.depois.perfil, adicionais_novos: novos, resultado: 'SUCESSO', sessoes_encerradas: true,
      });
      return { id: alvo.id, nome: alvo.nome, login: alvo.login, perfil: r.depois.perfil, admin: r.depois.perfil === 'ADMIN',
        ativo: r.depois.ativo, adicionais: novos, permissoes: permissoesEfetivas(r.depois.perfil, novos) };
    });
  } catch (e) {
    try {
      base.auditar(ctx, 'USUARIO', alvo.id, acao, {
        ...detalhesBase, perfil_novo: alvo.perfil, perfil_solicitado: String(novoPerfil).slice(0, 20),
        adicionais_solicitados: (adicionais || []).slice(0, 20).map((p) => String(p).slice(0, 40)), resultado: e.status ? 'NEGADO' : 'FALHA',
        motivo: e.status ? e.message : 'Erro interno ao gravar.',
      });
    } catch { /* se nem a auditoria grava, o erro original prevalece */ }
    throw e;
  }
}

// Desativar/reativar a conta (o perfil é mantido). Mesmas proteções: não desativa a si mesmo
// nem o último administrador ativo; derruba as sessões; resultado sempre auditado.
function definirAtivo(ctx, id, ativo) {
  const alvo = ctx.db.prepare('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE id = ?').get(Number(id));
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  const acao = ativo ? 'REATIVAR_CONTA' : 'DESATIVAR_CONTA';
  const detalhes = { usuario_afetado: alvo.login, nome: alvo.nome, perfil_anterior: alvo.perfil, perfil_novo: alvo.perfil };
  try {
    if (typeof ativo !== 'boolean') throw erro.validacao('Informe ativo como verdadeiro ou falso.', { ativo: 'Inválido.' });
    if (!!alvo.ativo === ativo) throw erro.regra(ativo ? 'A conta já está ativa.' : 'A conta já está desativada.');
    return transacao(ctx.db, () => {
      const r = alterarUsuario(ctx.db, ctx.usuario, alvo.id, { ativo });
      base.auditar(ctx, 'USUARIO', alvo.id, acao, { ...detalhes, resultado: 'SUCESSO', sessoes_encerradas: true });
      return { id: alvo.id, nome: alvo.nome, login: alvo.login, perfil: r.depois.perfil, ativo: r.depois.ativo };
    });
  } catch (e) {
    try { base.auditar(ctx, 'USUARIO', alvo.id, acao, { ...detalhes, resultado: e.status ? 'NEGADO' : 'FALHA', motivo: e.status ? e.message : 'Erro interno ao gravar.' }); } catch { /* ignora */ }
    throw e;
  }
}

// ---------------------------------------------------------------- exclusão de usuários
// Exclusão física é irreversível; por isso só vale para contas SEM movimento de negócio.
// Quem já registrou pedidos, estoque, baixas ou alterações de cadastro deve ser DESATIVADO,
// para o histórico continuar apontando para uma conta existente.
function contarAtividade(db, login) {
  const um = (sql) => db.prepare(sql).get(login).n;
  return {
    pedidos: um('SELECT COUNT(*) n FROM pedidos WHERE vendedor = ? COLLATE NOCASE')
      + um('SELECT COUNT(*) n FROM pedido_historico WHERE usuario = ? COLLATE NOCASE'),
    estoque: um('SELECT COUNT(*) n FROM movimentos_estoque WHERE usuario = ? COLLATE NOCASE'),
    financeiro: um('SELECT COUNT(*) n FROM baixas WHERE usuario = ? COLLATE NOCASE'),
    cadastros: um(`SELECT COUNT(*) n FROM auditoria WHERE usuario = ? COLLATE NOCASE
                   AND (entidade IN ('CLIENTE','PRODUTO','PEDIDO','ESTOQUE','TITULO','PARAMETRO')
                        OR acao IN ('CONCEDER_ADMIN','REMOVER_ADMIN','ALTERAR_PERFIL','ALTERAR_ACESSOS','DESATIVAR_CONTA','REATIVAR_CONTA','EXCLUIR_USUARIO'))`),
  };
}

// Regras:
// - nunca a própria conta;
// - conta ATIVA só é excluída se for comum e sem histórico;
// - conta DESATIVADA pode ser excluída mesmo com histórico (ou sendo admin desativado): os registros
//   antigos continuam no banco com o login, e esse login fica RESERVADO (não pode ser recriado),
//   para ninguém "herdar" pedidos/histórico de outra pessoa.
function avaliarExclusao(ctx, u) {
  if (u.id === ctx.usuario.id) return { permitida: false, motivo: 'Você não pode excluir a própria conta.', historico: false };
  const a = contarAtividade(ctx.db, u.login);
  const partes = [[a.pedidos, 'pedido(s)'], [a.estoque, 'movimentação(ões) de estoque'], [a.financeiro, 'baixa(s) financeira(s)'], [a.cadastros, 'alteração(ões) registradas']]
    .filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`);
  const historico = partes.length > 0;
  const ativo = !!u.ativo;
  if (ativo && u.perfil === 'ADMIN') return { permitida: false, historico, motivo: 'Administrador ativo: desative a conta (ou remova o Admin) antes de excluir.' };
  if (ativo && historico) return { permitida: false, historico, motivo: `Conta ativa com histórico (${partes.join(', ')}). Desative a conta primeiro; depois ela poderá ser excluída.` };
  if (historico) return { permitida: true, historico, motivo: `Desativada, com histórico (${partes.join(', ')}). O histórico é mantido e o login ficará reservado.` };
  return { permitida: true, historico, motivo: ativo ? 'Sem movimentações: pode ser excluída.' : 'Desativada, sem movimentações: pode ser excluída.' };
}

function excluirUsuario(ctx, id, confirmacao) {
  const alvo = ctx.db.prepare('SELECT id, login, nome, perfil, ativo FROM usuarios WHERE id = ?').get(Number(id));
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  const detalhes = { usuario_afetado: alvo.login, nome: alvo.nome, perfil_anterior: alvo.perfil, perfil_novo: '(excluído)' };
  try {
    if (String(confirmacao ?? '').trim().toLowerCase() !== alvo.login.toLowerCase()) {
      throw erro.validacao('Digite o login do usuário para confirmar a exclusão.', { confirmacao: 'Login não confere.' });
    }
    return transacao(ctx.db, () => {
      // reavalia dentro da transação (nada pode ter mudado entre a tela e a exclusão)
      const av = avaliarExclusao(ctx, alvo);
      if (!av.permitida) throw erro.regra(av.motivo);
      ctx.db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(alvo.id);
      ctx.db.prepare('DELETE FROM idempotencia WHERE usuario_id = ?').run(alvo.id);
      const r = ctx.db.prepare('DELETE FROM usuarios WHERE id = ?').run(alvo.id);
      if (r.changes !== 1) throw erro.conflito('O usuário foi alterado por outra operação. Recarregue a lista.');
      if (av.historico) {
        ctx.db.prepare('INSERT OR IGNORE INTO logins_reservados (login, nome, excluido_em, excluido_por) VALUES (?,?,?,?)')
          .run(alvo.login, alvo.nome, base.agoraIso(ctx), ctx.usuario.login);
      }
      base.auditar(ctx, 'USUARIO', alvo.id, 'EXCLUIR_USUARIO', { ...detalhes, resultado: 'SUCESSO', historico_mantido: av.historico, login_reservado: av.historico });
      return { excluido: true, id: alvo.id, nome: alvo.nome, login: alvo.login, login_reservado: av.historico };
    });
  } catch (e) {
    try { base.auditar(ctx, 'USUARIO', alvo.id, 'EXCLUIR_USUARIO', { ...detalhes, perfil_novo: alvo.perfil, resultado: e.status ? 'NEGADO' : 'FALHA', motivo: e.status ? e.message : 'Erro interno ao gravar.' }); } catch { /* ignora */ }
    throw e;
  }
}

// Histórico de alterações de perfil (concessões, remoções e alterações pela tela de Parâmetros).
function historicoPerfis(ctx, query = {}) {
  const pag = { tamanho: Math.min(Math.max(parseInt(query.tamanho, 10) || 10, 1), 50), pagina: Math.max(parseInt(query.pagina, 10) || 1, 1) };
  const where = "entidade = 'USUARIO' AND acao IN ('CONCEDER_ADMIN','REMOVER_ADMIN','ALTERAR_PERFIL','ALTERAR_ACESSOS','DESATIVAR_CONTA','REATIVAR_CONTA','EXCLUIR_USUARIO','ALTERACAO')";
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM auditoria WHERE ${where}`).get().n;
  const itens = ctx.db.prepare(`SELECT id, usuario, acao, data_hora, detalhes FROM auditoria WHERE ${where}
                                ORDER BY id DESC LIMIT ? OFFSET ?`).all(pag.tamanho, (pag.pagina - 1) * pag.tamanho)
    .map((a) => {
      const d = JSON.parse(a.detalhes);
      return {
        id: a.id, data_hora: a.data_hora, administrador: a.usuario, acao: a.acao,
        usuario_afetado: d.usuario_afetado || d.login, perfil_anterior: d.perfil_anterior || d.de?.perfil,
        perfil_novo: d.perfil_novo || d.para?.perfil, resultado: d.resultado || 'SUCESSO', motivo: d.motivo || '',
        adicionais_anteriores: d.adicionais_anteriores || [], adicionais_novos: d.adicionais_novos || [],
      };
    });
  return { itens, total, pagina: pag.pagina, tamanho: pag.tamanho };
}

// ---------------------------------------------------------------- painel (estilo BI)

const dataOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

function filtrosPainel(ctx, q) {
  const hoje = base.hoje(ctx);
  const inicioPadrao = (() => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 5, 1); return d.toISOString().slice(0, 10); })();
  const de = dataOk(q.de) ? q.de : inicioPadrao;
  const ate = dataOk(q.ate) ? q.ate : hoje;
  if (de > ate) throw erro.validacao('A data inicial é maior que a final.', { de: 'Maior que a data final.' });
  return { de, ate, grupo: String(q.grupo || '').slice(0, 10).toUpperCase(), vendedor: String(q.vendedor || '').slice(0, 40) };
}

// Cláusula comum das vendas faturadas (por item), sempre parametrizada.
function whereVendas(f) {
  const w = ["p.status = 'FATURADO'", 'p.faturado_em BETWEEN ? AND ?'];
  const a = [f.de, f.ate];
  if (f.grupo) { w.push('pr.grupo = ?'); a.push(f.grupo); }
  if (f.vendedor) { w.push('p.vendedor = ?'); a.push(f.vendedor); }
  return { sql: w.join(' AND '), args: a };
}
const FROM_VENDAS = 'FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id JOIN clientes c ON c.id = p.cliente_id';

function mesesEntre(de, ate) {
  const r = [];
  const d = new Date(de.slice(0, 7) + '-01T12:00:00Z');
  const fim = ate.slice(0, 7);
  while (d.toISOString().slice(0, 7) <= fim && r.length < 36) { r.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return r;
}

function painel(ctx, query = {}) {
  const f = filtrosPainel(ctx, query);
  const db = ctx.db;
  const w = whereVendas(f);

  const k = db.prepare(`SELECT COALESCE(SUM(i.total_cent),0) fat, COUNT(DISTINCT p.id) pedidos, COALESCE(SUM(i.quantidade),0) qtd,
      COALESCE(SUM(i.total_cent - ROUND(i.quantidade * pr.custo_cent)),0) margem, COUNT(DISTINCT p.cliente_id) clientes
      ${FROM_VENDAS} WHERE ${w.sql}`).get(...w.args);
  const receber = db.prepare("SELECT COALESCE(SUM(saldo_cent),0) v, COALESCE(SUM(CASE WHEN vencimento < ? THEN saldo_cent END),0) venc FROM titulos WHERE tipo='R' AND situacao <> 'LIQUIDADO'").get(base.hoje(ctx));
  const pagar = db.prepare("SELECT COALESCE(SUM(saldo_cent),0) v FROM titulos WHERE tipo='P' AND situacao <> 'LIQUIDADO'").get();
  const usuarios = db.prepare("SELECT COUNT(*) total, SUM(ativo) ativos, SUM(CASE WHEN perfil='ADMIN' AND ativo=1 THEN 1 ELSE 0 END) admins FROM usuarios").get();
  const negados = db.prepare("SELECT COUNT(*) n FROM auditoria WHERE acao = 'ACESSO_NEGADO' AND substr(data_hora,1,10) BETWEEN ? AND ?").get(f.de, f.ate).n;

  const porMes = new Map(db.prepare(`SELECT substr(p.faturado_em,1,7) mes, SUM(i.total_cent) v, COUNT(DISTINCT p.id) n
      ${FROM_VENDAS} WHERE ${w.sql} GROUP BY mes`).all(...w.args).map((r) => [r.mes, r]));
  const evolucao = mesesEntre(f.de, f.ate).map((m) => ({ mes: m, valor: reais(porMes.get(m)?.v || 0), pedidos: porMes.get(m)?.n || 0 }));

  // Pizza: até 5 grupos + "Outros" (mais fatias tornam a leitura e as cores ambíguas).
  const grupos = db.prepare(`SELECT pr.grupo, SUM(i.total_cent) v ${FROM_VENDAS} WHERE ${w.sql} GROUP BY pr.grupo ORDER BY v DESC`).all(...w.args);
  const porGrupo = grupos.slice(0, 5).map((g) => ({ rotulo: g.grupo, valor: reais(g.v) }));
  const resto = grupos.slice(5).reduce((s, g) => s + g.v, 0);
  if (resto > 0) porGrupo.push({ rotulo: 'Outros', valor: reais(resto), outros: true });

  const topClientes = db.prepare(`SELECT c.razao_social nome, SUM(i.total_cent) v ${FROM_VENDAS} WHERE ${w.sql}
      GROUP BY c.id ORDER BY v DESC LIMIT 5`).all(...w.args).map((r) => ({ rotulo: r.nome, valor: reais(r.v) }));

  const ws = ['p.emissao BETWEEN ? AND ?']; const as = [f.de, f.ate];
  if (f.vendedor) { ws.push('p.vendedor = ?'); as.push(f.vendedor); }
  const porStatus = db.prepare(`SELECT p.status, COUNT(*) n FROM pedidos p WHERE ${ws.join(' AND ')} GROUP BY p.status ORDER BY n DESC`)
    .all(...as).map((r) => ({ status: r.status, quantidade: r.n }));

  base.auditar(ctx, 'PAINEL_ADMIN', null, 'ACESSO', { de: f.de, ate: f.ate, grupo: f.grupo, vendedor: f.vendedor });
  return {
    filtros: f,
    opcoes: {
      grupos: db.prepare('SELECT DISTINCT grupo FROM produtos ORDER BY grupo').all().map((r) => r.grupo),
      vendedores: db.prepare('SELECT DISTINCT vendedor FROM pedidos ORDER BY vendedor').all().map((r) => r.vendedor),
    },
    indicadores: {
      faturamento: reais(k.fat), pedidos: k.pedidos, ticket_medio: k.pedidos ? reais(Math.round(k.fat / k.pedidos)) : 0,
      itens_vendidos: Math.round(k.qtd * 100) / 100, margem_estimada: reais(k.margem), margem_pct: k.fat ? Math.round((k.margem / k.fat) * 1000) / 10 : 0,
      clientes_atendidos: k.clientes, receber_aberto: reais(receber.v), receber_vencido: reais(receber.venc), pagar_aberto: reais(pagar.v),
      usuarios_ativos: usuarios.ativos || 0, usuarios_total: usuarios.total, administradores: usuarios.admins || 0, acessos_negados: negados,
    },
    evolucao, por_grupo: porGrupo, top_clientes: topClientes, por_status: porStatus,
    atualizado_em: base.agoraIso(ctx),
  };
}

// Tabela detalhada de vendas por item, com pesquisa, ordenação e paginação no servidor.
function vendasDetalhe(ctx, query = {}) {
  const f = filtrosPainel(ctx, query);
  const w = whereVendas(f);
  if (query.q) {
    w.sql += " AND (p.numero LIKE ? ESCAPE '\\' OR c.razao_social LIKE ? ESCAPE '\\' OR pr.codigo LIKE ? ESCAPE '\\' OR pr.descricao LIKE ? ESCAPE '\\')";
    const l = base.like(String(query.q).slice(0, 60));
    w.args.push(l, l, l, l);
  }
  const ordem = base.ordenacao(query, {
    data: 'p.faturado_em', pedido: 'p.numero', cliente: 'c.razao_social', produto: 'pr.codigo', grupo: 'pr.grupo', total: 'i.total_cent', quantidade: 'i.quantidade',
  }, 'data');
  const tamanho = Math.min(Math.max(parseInt(query.tamanho, 10) || 10, 1), 100);
  const pagina = Math.max(parseInt(query.pagina, 10) || 1, 1);
  const total = ctx.db.prepare(`SELECT COUNT(*) n ${FROM_VENDAS} WHERE ${w.sql}`).get(...w.args).n;
  const itens = ctx.db.prepare(`SELECT p.faturado_em data, p.numero pedido, c.razao_social cliente, pr.codigo produto_codigo,
      pr.descricao produto, pr.grupo, i.quantidade, i.total_cent, p.vendedor
      ${FROM_VENDAS} WHERE ${w.sql} ORDER BY ${ordem}, i.id LIMIT ? OFFSET ?`).all(...w.args, tamanho, (pagina - 1) * tamanho)
    .map(({ total_cent, ...r }) => ({ ...r, total: reais(total_cent) }));
  return { itens, total, pagina, tamanho };
}

module.exports = { buscarUsuarios, definirAdmin, definirPerfil, definirAtivo, excluirUsuario, historicoPerfis, painel, vendasDetalhe, normalizar, catalogoPerfis };
