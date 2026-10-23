'use strict';
// Mesa de trabalho (página Início): tarefas, anotação e preferências PESSOAIS.
// Tudo é filtrado pelo usuário da sessão (ctx.usuario.id): ninguém lê nem altera dados de outra pessoa,
// e uma tarefa alheia responde 404, sem revelar que existe. Nada aqui consulta dados da empresa.
const { erro } = require('../erros');
const { Validador } = require('../validacao');
const base = require('./base');

const PRIORIDADES = ['ALTA', 'MEDIA', 'NORMAL'];
const LIMITE_LISTA = 100;

// Atalhos possíveis do "Acesso rápido" e a permissão que cada um exige. A preferência salva só guarda
// rotas desta lista; ao ler, os atalhos sem permissão ATUAL são descartados (favorito não concede acesso).
const ATALHOS = {
  clientes: 'clientes.ler', pedidos: 'pedidos.ler', produtos: 'produtos.ler', estoque: 'estoque.ler', expedicao: 'pedidos.expedicao',
  'financeiro/receber': 'financeiro.ler', 'financeiro/pagar': 'financeiro.ler', relatorios: 'relatorios.ler',
  'painel-executivo': 'painel_executivo.ler', configuracoes: 'parametros.ler', 'admin/usuarios': 'usuarios.gerir',
};
// Os 4 primeiros autorizados viram o padrão (o perfil Estoque, sem clientes e pedidos, ganha a Expedição).
const ATALHOS_PADRAO = ['clientes', 'pedidos', 'produtos', 'estoque', 'expedicao'];
const MAX_ATALHOS = 4;

const autorizados = (ctx, rotas) => rotas.filter((r) => ATALHOS[r] && (ctx.usuario.permissoes || []).includes(ATALHOS[r]));

function publica(t, hoje) {
  return {
    id: t.id, titulo: t.titulo, descricao: t.descricao, prazo: t.prazo, prioridade: t.prioridade,
    concluida: !!t.concluida, concluida_em: t.concluida_em, atrasada: !t.concluida && !!t.prazo && t.prazo < hoje,
  };
}

function propria(ctx, id) {
  const t = ctx.db.prepare('SELECT * FROM tarefas WHERE id = ? AND usuario_id = ?').get(Number(id), ctx.usuario.id);
  if (!t) throw erro.naoEncontrado('Tarefa não encontrada.');
  return t;
}

// Filtros das abas: hoje (vence hoje ou atrasada), proximas (prazo futuro e, à parte, sem prazo),
// concluidas, e dia (tarefas com prazo naquela data, vindo do calendário; não altera prazos).
function listar(ctx, query = {}) {
  const hoje = base.hoje(ctx);
  const uid = ctx.usuario.id;
  const db = ctx.db;
  const ordem = "CASE prioridade WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END";
  const filtro = ['hoje', 'proximas', 'concluidas', 'dia'].includes(query.filtro) ? query.filtro : 'hoje';
  let itens; let semPrazo = [];
  if (filtro === 'hoje') {
    itens = db.prepare(`SELECT * FROM tarefas WHERE usuario_id = ? AND concluida = 0 AND prazo IS NOT NULL AND prazo <= ?
        ORDER BY prazo, ${ordem}, id LIMIT ?`).all(uid, hoje, LIMITE_LISTA);
  } else if (filtro === 'proximas') {
    itens = db.prepare(`SELECT * FROM tarefas WHERE usuario_id = ? AND concluida = 0 AND prazo > ?
        ORDER BY prazo, ${ordem}, id LIMIT ?`).all(uid, hoje, LIMITE_LISTA);
    semPrazo = db.prepare(`SELECT * FROM tarefas WHERE usuario_id = ? AND concluida = 0 AND prazo IS NULL
        ORDER BY ${ordem}, id LIMIT ?`).all(uid, LIMITE_LISTA);
  } else if (filtro === 'concluidas') {
    itens = db.prepare(`SELECT * FROM tarefas WHERE usuario_id = ? AND concluida = 1
        ORDER BY concluida_em DESC, id DESC LIMIT ?`).all(uid, LIMITE_LISTA);
  } else {
    const v = new Validador({ data: query.data }).data('data').resultado();
    itens = db.prepare(`SELECT * FROM tarefas WHERE usuario_id = ? AND prazo = ?
        ORDER BY concluida, ${ordem}, id LIMIT ?`).all(uid, v.data, LIMITE_LISTA);
  }
  return { filtro, hoje, itens: itens.map((t) => publica(t, hoje)), sem_prazo: semPrazo.map((t) => publica(t, hoje)) };
}

function validarTarefa(dados) {
  return new Validador(dados)
    .texto('titulo', { obrigatorio: true, max: 120 })
    .texto('descricao', { max: 500 })
    .data('prazo', { obrigatorio: false })
    .opcao('prioridade', PRIORIDADES, { padrao: 'NORMAL' })
    .resultado();
}

function criar(ctx, dados) {
  const v = validarTarefa(dados);
  const agora = base.agoraIso(ctx);
  const r = ctx.db.prepare(`INSERT INTO tarefas (usuario_id, titulo, descricao, prazo, prioridade, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ctx.usuario.id, v.titulo, v.descricao, v.prazo, v.prioridade, agora, agora);
  return publica(propria(ctx, r.lastInsertRowid), base.hoje(ctx));
}

function alterar(ctx, id, dados) {
  propria(ctx, id);
  const v = validarTarefa(dados);
  ctx.db.prepare(`UPDATE tarefas SET titulo = ?, descricao = ?, prazo = ?, prioridade = ?, atualizado_em = ?
      WHERE id = ? AND usuario_id = ?`).run(v.titulo, v.descricao, v.prazo, v.prioridade, base.agoraIso(ctx), Number(id), ctx.usuario.id);
  return publica(propria(ctx, id), base.hoje(ctx));
}

function concluir(ctx, id, dados) {
  propria(ctx, id);
  const { concluida } = new Validador(dados).logico('concluida', true).resultado();
  const agora = base.agoraIso(ctx);
  ctx.db.prepare('UPDATE tarefas SET concluida = ?, concluida_em = ?, atualizado_em = ? WHERE id = ? AND usuario_id = ?')
    .run(concluida ? 1 : 0, concluida ? agora : null, agora, Number(id), ctx.usuario.id);
  return publica(propria(ctx, id), base.hoje(ctx));
}

function excluir(ctx, id) {
  propria(ctx, id);
  ctx.db.prepare('DELETE FROM tarefas WHERE id = ? AND usuario_id = ?').run(Number(id), ctx.usuario.id);
  return { ok: true };
}

// ---------- Anotação e preferências ----------
function lerPreferencias(ctx) {
  const p = ctx.db.prepare('SELECT * FROM preferencias_mesa WHERE usuario_id = ?').get(ctx.usuario.id);
  let salvos = ATALHOS_PADRAO;
  if (p) { try { const a = JSON.parse(p.atalhos); if (Array.isArray(a)) salvos = a; } catch { /* preferência corrompida: usa o padrão */ } }
  return {
    atalhos: autorizados(ctx, salvos).slice(0, MAX_ATALHOS),
    mostrar_calendario: p ? !!p.mostrar_calendario : true,
    mostrar_notas: p ? !!p.mostrar_notas : true,
    personalizado: !!p,
  };
}

// Tudo o que a página Início precisa ao abrir: data de hoje (fuso do servidor), notas e preferências.
function mesa(ctx) {
  return {
    hoje: base.hoje(ctx),
    notas: listarNotas(ctx),
    preferencias: lerPreferencias(ctx),
    atalhos_disponiveis: autorizados(ctx, Object.keys(ATALHOS)),
  };
}

// ---------- Notas (bloquinhos): várias por usuário, mais recentes primeiro ----------
const MAX_NOTAS = 200;
const MAX_TEXTO_NOTA = 2000;
const notaPublica = (n) => ({ id: n.id, texto: n.texto, criado_em: n.criado_em, atualizado_em: n.atualizado_em });

function listarNotas(ctx) {
  return ctx.db.prepare('SELECT * FROM notas WHERE usuario_id = ? ORDER BY atualizado_em DESC, id DESC LIMIT ?')
    .all(ctx.usuario.id, MAX_NOTAS).map(notaPublica);
}

function notaPropria(ctx, id) {
  const n = ctx.db.prepare('SELECT * FROM notas WHERE id = ? AND usuario_id = ?').get(Number(id), ctx.usuario.id);
  if (!n) throw erro.naoEncontrado('Nota não encontrada.');
  return n;
}

function textoDaNota(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  if (typeof d.texto !== 'string') throw erro.validacao('Existem campos inválidos.', { texto: 'Valor inválido.' });
  const texto = d.texto.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  if (!texto) throw erro.validacao('Existem campos inválidos.', { texto: 'Escreva a nota antes de salvar.' });
  if (texto.length > MAX_TEXTO_NOTA) throw erro.validacao('Existem campos inválidos.', { texto: `Máximo de ${MAX_TEXTO_NOTA} caracteres.` });
  return texto;
}

function criarNota(ctx, dados) {
  const texto = textoDaNota(dados);
  const total = ctx.db.prepare('SELECT COUNT(*) n FROM notas WHERE usuario_id = ?').get(ctx.usuario.id).n;
  if (total >= MAX_NOTAS) throw erro.regra(`Limite de ${MAX_NOTAS} notas atingido. Apague notas antigas para criar novas.`);
  const agora = base.agoraIso(ctx);
  const r = ctx.db.prepare('INSERT INTO notas (usuario_id, texto, criado_em, atualizado_em) VALUES (?, ?, ?, ?)').run(ctx.usuario.id, texto, agora, agora);
  return notaPublica(notaPropria(ctx, r.lastInsertRowid));
}

function alterarNota(ctx, id, dados) {
  notaPropria(ctx, id);
  const texto = textoDaNota(dados);
  ctx.db.prepare('UPDATE notas SET texto = ?, atualizado_em = ? WHERE id = ? AND usuario_id = ?').run(texto, base.agoraIso(ctx), Number(id), ctx.usuario.id);
  return notaPublica(notaPropria(ctx, id));
}

function excluirNota(ctx, id) {
  notaPropria(ctx, id);
  ctx.db.prepare('DELETE FROM notas WHERE id = ? AND usuario_id = ?').run(Number(id), ctx.usuario.id);
  return { ok: true };
}

function salvarPreferencias(ctx, dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  if (d.restaurar === true) {
    ctx.db.prepare('DELETE FROM preferencias_mesa WHERE usuario_id = ?').run(ctx.usuario.id);
    return lerPreferencias(ctx);
  }
  const erros = {};
  const atalhos = Array.isArray(d.atalhos) ? d.atalhos : null;
  if (!atalhos || atalhos.some((a) => typeof a !== 'string' || !ATALHOS[a])) erros.atalhos = 'Atalho inválido.';
  else if (new Set(atalhos).size !== atalhos.length) erros.atalhos = 'Atalho repetido.';
  else if (atalhos.length > MAX_ATALHOS) erros.atalhos = `Escolha no máximo ${MAX_ATALHOS} atalhos.`;
  // Só grava o que a pessoa pode abrir hoje; uma rota sem permissão é recusada, não "guardada para depois".
  else if (autorizados(ctx, atalhos).length !== atalhos.length) erros.atalhos = 'Atalho sem permissão.';
  for (const c of ['mostrar_calendario', 'mostrar_notas']) if (typeof d[c] !== 'boolean') erros[c] = 'Deve ser verdadeiro ou falso.';
  if (Object.keys(erros).length) throw erro.validacao('Existem campos inválidos.', erros);
  ctx.db.prepare(`INSERT INTO preferencias_mesa (usuario_id, atalhos, mostrar_calendario, mostrar_notas, atualizado_em) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (usuario_id) DO UPDATE SET atalhos = excluded.atalhos, mostrar_calendario = excluded.mostrar_calendario,
      mostrar_notas = excluded.mostrar_notas, atualizado_em = excluded.atualizado_em`)
    .run(ctx.usuario.id, JSON.stringify(atalhos), d.mostrar_calendario ? 1 : 0, d.mostrar_notas ? 1 : 0, base.agoraIso(ctx));
  return lerPreferencias(ctx);
}

// Empresa/filial ativa (cabeçalho). Não há troca de empresa nesta demonstração: existe uma só.
function empresa(ctx) {
  const e = ctx.db.prepare('SELECT codigo, nome, filial_codigo, filial_nome FROM empresa WHERE id = 1').get();
  return { ...e, outras: [] };
}

module.exports = { listar, criar, alterar, concluir, excluir, mesa, criarNota, alterarNota, excluirNota, salvarPreferencias, empresa, ATALHOS };
