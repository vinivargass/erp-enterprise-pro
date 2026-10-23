'use strict';
// Testes da página Início e do Painel executivo (resultados estratégicos com permissão explícita).
// Banco SQLite EM MEMÓRIA com usuários de teste: nenhuma conta real é alterada.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { iniciar, clienteValido, produtoValido } = require('./apoio');
const { abrir } = require('../server/db');

let amb; let s = {};
const ESTRATEGICOS = ['/api/painel-executivo', '/api/admin/painel', '/api/admin/vendas'];
const login = (u, senha = 'Teste@123') => fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: u, senha }) });
const cookieDe = (r) => r.headers.get('set-cookie').split(';')[0];
const get = (cookie, rota) => fetch(amb.url + rota, { headers: { Cookie: cookie } });

before(async () => {
  amb = await iniciar({ maxCadastros: 100 });
  for (const l of ['admin', 'diretoria', 'gerente', 'vendedor', 'vendedor2', 'estoque', 'financeiro', 'consulta', 'sem_acesso']) s[l] = await amb.sessao(l);
  // Massa: pedido pendente do vendedor, rascunho do vendedor2, produto abaixo do mínimo, título vencido.
  const c = (await s.admin.post('/api/clientes', clienteValido({ limite_credito: 1 }))).corpo;
  const p = (await s.admin.post('/api/produtos', produtoValido({ preco_venda: 100, saldo_inicial: 50, estoque_minimo: 10 }))).corpo;
  const ped = (await s.vendedor.post('/api/pedidos', { cliente_id: c.id, itens: [{ produto_id: p.id, quantidade: 1 }] })).corpo;
  await s.vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao }); // acima do crédito: vai para aprovação
  await s.vendedor2.post('/api/pedidos', { cliente_id: c.id, itens: [{ produto_id: p.id, quantidade: 1 }] });
  await s.admin.post('/api/produtos', produtoValido({ saldo_inicial: 1, estoque_minimo: 5 }));
  amb.db.prepare(`INSERT INTO titulos (tipo, numero, parcela, cliente_id, emissao, vencimento, valor_cent, saldo_cent, situacao, historico)
    VALUES ('R', 'T900', '', ?, '2020-01-01', '2020-02-01', 12345, 12345, 'ABERTO', 'teste')`).run(c.id);
});
after(() => amb.fechar());

describe('Painel executivo: permissão explícita no servidor', () => {
  test('3. alta gestão (DIRETORIA) e ADMIN acessam os indicadores e os filtros de período', async () => {
    for (const u of ['diretoria', 'admin']) {
      const r = await s[u].get('/api/painel-executivo?de=2020-01-01&ate=2030-12-31');
      assert.equal(r.status, 200, u);
      assert.deepEqual(r.corpo.periodo, { de: '2020-01-01', ate: '2030-12-31' }, 'filtro de período respeitado');
      for (const k of ['faturamento', 'ticket_medio', 'itens_vendidos', 'receber_aberto', 'pagar_aberto', 'estoque_valor_custo']) assert.ok(k in r.corpo.indicadores, k);
    }
    assert.equal((await s.diretoria.get('/api/admin/painel')).status, 403, 'Diretoria não é administração técnica');
  });

  test('4. sem a permissão: 403 nas rotas estratégicas, mesmo chamando direto, e a negação fica auditada', async () => {
    for (const u of ['gerente', 'vendedor', 'estoque', 'financeiro', 'consulta', 'sem_acesso']) {
      for (const rota of ESTRATEGICOS) {
        const r = await s[u].get(rota);
        assert.equal(r.status, 403, `${u} ${rota}`);
        assert.ok(!('indicadores' in (r.corpo || {})), 'nenhum dado vem junto com a negação');
      }
    }
    const negado = amb.db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'ACESSO_NEGADO' AND usuario = 'gerente' ORDER BY id DESC").all()
      .map((x) => JSON.parse(x.detalhes));
    assert.ok(negado.some((d) => d.rota === '/api/painel-executivo' && d.permissao === 'painel_executivo.ler'));
    assert.equal((await fetch(amb.url + '/api/painel-executivo')).status, 401, 'sem sessão');
    assert.equal((await fetch(amb.url + '/api/dashboard')).status, 404, 'rota antiga não existe mais');
  });

  test('a permissão só vem do perfil, concedido por ADMIN; o próprio usuário não se promove', async () => {
    const sessao = (await s.sem_acesso.get('/api/auth/sessao')).corpo;
    assert.deepEqual(sessao.permissoes, []);
    assert.equal((await s.sem_acesso.post(`/api/admin/usuarios/${sessao.id}/perfil`, { perfil: 'DIRETORIA' })).status, 403);
    assert.equal((await s.gerente.post(`/api/admin/usuarios/${sessao.id}/perfil`, { perfil: 'DIRETORIA' })).status, 403);
    const cat = (await s.admin.get('/api/admin/perfis')).corpo;
    const comPainel = cat.filter((p) => p.acessos.some((a) => /Painel executivo/.test(a))).map((p) => p.perfil);
    assert.deepEqual(comPainel, ['ADMIN', 'DIRETORIA'], 'só alta gestão e o superadministrador');
  });

  test('6. troca de perfil derruba a sessão antiga; o novo login já vem com as permissões novas', async () => {
    await fetch(amb.url + '/api/auth/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Socia Teste', login: 'socia', senha: 'Segura2026' }) });
    const id = amb.db.prepare("SELECT id FROM usuarios WHERE login = 'socia'").get().id;
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'DIRETORIA' })).status, 200);
    const ck1 = cookieDe(await login('socia', 'Segura2026'));
    assert.equal((await get(ck1, '/api/painel-executivo')).status, 200);
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'GERENTE' })).status, 200);
    assert.equal((await get(ck1, '/api/painel-executivo')).status, 401, 'sessão anterior encerrada');
    const ck2 = cookieDe(await login('socia', 'Segura2026'));
    assert.equal((await get(ck2, '/api/painel-executivo')).status, 403, 'novo perfil sem o painel');
  });
});

describe('Página Início: mesa de trabalho pessoal', () => {
  const hoje = () => new Date().toLocaleDateString('sv-SE');
  const somar = (dias) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toLocaleDateString('sv-SE'); };

  test('1. usuário sem permissões usa tarefas e notas, sem nenhum dado da empresa', async () => {
    const m = await s.sem_acesso.get('/api/mesa');
    assert.equal(m.status, 200);
    assert.equal(m.corpo.hoje, hoje());
    assert.deepEqual(m.corpo.preferencias.atalhos, [], 'nenhum atalho sem permissão');
    assert.deepEqual(m.corpo.atalhos_disponiveis, []);
    const texto = JSON.stringify(m.corpo);
    assert.ok(!/faturamento|receber|pagar|R\$|valor/.test(texto), 'a página Início não traz dados estratégicos');
    assert.equal((await s.sem_acesso.post('/api/tarefas', { titulo: 'Ler o manual' })).status, 201);
    assert.equal((await s.sem_acesso.post('/api/notas', { texto: 'lembrete' })).status, 201);
    assert.deepEqual((await s.sem_acesso.get('/api/notificacoes')).corpo, []);
    for (const rota of ['/api/clientes', '/api/produtos', '/api/pedidos', '/api/estoque/saldos', '/api/financeiro/receber', '/api/relatorios', '/api/parametros', '/api/condicoes-pagamento']) {
      assert.equal((await s.sem_acesso.get(rota)).status, 403, rota);
    }
  });

  test('tarefas: criar, editar, concluir, reabrir, excluir e filtrar pelas abas', async () => {
    const u = s.estoque;
    const criar = async (t) => { const r = await u.post('/api/tarefas', t); assert.equal(r.status, 201, JSON.stringify(r.corpo)); return r.corpo; };
    const atrasada = await criar({ titulo: 'Conferir inventário', descricao: 'Corredor B', prazo: somar(-2), prioridade: 'ALTA' });
    const deHoje = await criar({ titulo: 'Repor etiquetas', prazo: hoje(), prioridade: 'MEDIA' });
    const futura = await criar({ titulo: 'Planejar contagem', prazo: somar(5) });
    const semPrazo = await criar({ titulo: 'Organizar arquivo' });
    assert.equal(semPrazo.prioridade, 'NORMAL', 'prioridade padrão');
    assert.equal(atrasada.atrasada, true);

    const aba = async (f, extra = '') => (await u.get(`/api/tarefas?filtro=${f}${extra}`)).corpo;
    assert.deepEqual((await aba('hoje')).itens.map((t) => t.id), [atrasada.id, deHoje.id], 'atrasadas e de hoje, atrasada primeiro');
    const prox = await aba('proximas');
    assert.deepEqual(prox.itens.map((t) => t.id), [futura.id]);
    assert.deepEqual(prox.sem_prazo.map((t) => t.id), [semPrazo.id], 'sem prazo vem separado');
    assert.deepEqual((await aba('dia', `&data=${somar(5)}`)).itens.map((t) => t.id), [futura.id], 'consulta por dia (calendário)');

    const ed = await u.put(`/api/tarefas/${futura.id}`, { titulo: 'Planejar contagem geral', descricao: 'Com a equipe', prazo: somar(6), prioridade: 'ALTA' });
    assert.equal(ed.status, 200);
    assert.equal(ed.corpo.prazo, somar(6));
    assert.equal((await u.post(`/api/tarefas/${deHoje.id}/concluir`, { concluida: true })).corpo.concluida, true);
    assert.deepEqual((await aba('concluidas')).itens.map((t) => t.id), [deHoje.id]);
    assert.ok(!(await aba('hoje')).itens.some((t) => t.id === deHoje.id));
    assert.equal((await u.post(`/api/tarefas/${deHoje.id}/concluir`, { concluida: false })).corpo.concluida, false, 'reabrir');
    assert.equal((await u.del(`/api/tarefas/${semPrazo.id}`)).status, 200);
    assert.equal((await aba('proximas')).sem_prazo.length, 0);

    // validação no servidor
    assert.equal((await u.post('/api/tarefas', { titulo: '' })).status, 422, 'título obrigatório');
    assert.equal((await u.post('/api/tarefas', { titulo: 'x', prioridade: 'URGENTE' })).status, 422);
    assert.equal((await u.post('/api/tarefas', { titulo: 'x', prazo: '2026-02-30' })).status, 422);
    assert.equal((await u.post('/api/tarefas', { titulo: 'x'.repeat(121) })).status, 422);
  });

  test('isolamento: ninguém vê nem altera tarefas e notas de outra pessoa', async () => {
    const minha = (await s.vendedor.post('/api/tarefas', { titulo: 'Ligar para cliente', prazo: hoje() })).corpo;
    const notaV = (await s.vendedor.post('/api/notas', { texto: 'nota do vendedor' })).corpo;
    await s.vendedor2.post('/api/notas', { texto: 'nota do vendedor2' });
    for (const outro of [s.vendedor2, s.admin]) {
      assert.ok(!(await outro.get('/api/tarefas?filtro=hoje')).corpo.itens.some((t) => t.id === minha.id), 'não aparece na lista de outro');
      assert.equal((await outro.put(`/api/tarefas/${minha.id}`, { titulo: 'invadida' })).status, 404);
      assert.equal((await outro.post(`/api/tarefas/${minha.id}/concluir`, { concluida: true })).status, 404);
      assert.equal((await outro.del(`/api/tarefas/${minha.id}`)).status, 404);
      assert.ok(!(await outro.get('/api/mesa')).corpo.notas.some((n) => n.id === notaV.id), 'nota não aparece para outro');
      assert.equal((await outro.put(`/api/notas/${notaV.id}`, { texto: 'invadida' })).status, 404);
      assert.equal((await outro.del(`/api/notas/${notaV.id}`)).status, 404);
    }
    assert.deepEqual((await s.vendedor.get('/api/mesa')).corpo.notas.map((n) => n.texto), ['nota do vendedor']);
    assert.deepEqual((await s.vendedor2.get('/api/mesa')).corpo.notas.map((n) => n.texto), ['nota do vendedor2']);
    assert.equal((await s.vendedor.get('/api/tarefas?filtro=hoje')).corpo.itens.find((t) => t.id === minha.id).titulo, 'Ligar para cliente');
    assert.equal((await fetch(amb.url + '/api/mesa')).status, 401, 'sem sessão');
  });

  test('notas em bloquinhos: criar várias, editar, apagar, validar e exigir CSRF', async () => {
    const u = s.consulta;
    const a = await u.post('/api/notas', { texto: 'linha 1\nlinha 2' });
    assert.equal(a.status, 201);
    assert.ok(a.corpo.id && a.corpo.criado_em);
    const b = (await u.post('/api/notas', { texto: 'segunda nota' })).corpo;
    assert.deepEqual((await u.get('/api/mesa')).corpo.notas.map((n) => n.texto), ['segunda nota', 'linha 1\nlinha 2'], 'mais recente primeiro');

    const ed = await u.put(`/api/notas/${a.corpo.id}`, { texto: 'linha 1 editada' });
    assert.equal(ed.status, 200);
    assert.equal(ed.corpo.texto, 'linha 1 editada');
    assert.equal((await u.get('/api/mesa')).corpo.notas[0].id, a.corpo.id, 'editada sobe para o topo');

    assert.equal((await u.del(`/api/notas/${b.id}`)).status, 200);
    assert.deepEqual((await u.get('/api/mesa')).corpo.notas.map((n) => n.id), [a.corpo.id]);
    assert.equal((await u.del(`/api/notas/${b.id}`)).status, 404, 'já apagada');

    assert.equal((await u.post('/api/notas', { texto: '   ' })).status, 422, 'nota vazia');
    assert.equal((await u.post('/api/notas', { texto: 'x'.repeat(2001) })).status, 422, 'limite de tamanho');
    assert.equal((await u.put(`/api/notas/${a.corpo.id}`, { texto: '' })).status, 422);
    const ck = (await login('consulta')).headers.get('set-cookie').split(';')[0];
    const semCsrf = await fetch(amb.url + `/api/notas/${a.corpo.id}`, { method: 'DELETE', headers: { Cookie: ck } });
    assert.equal(semCsrf.status, 403, 'sem o token CSRF');
    assert.equal((await u.get('/api/mesa')).corpo.notas.length, 1, 'nada foi apagado');
  });

  test('personalização: só módulos autorizados, no máximo 4, e permissão revogada some do favorito', async () => {
    const pref = (await s.gerente.get('/api/mesa')).corpo.preferencias;
    assert.deepEqual(pref.atalhos, ['clientes', 'pedidos', 'produtos', 'estoque'], 'padrão quando autorizado');
    assert.deepEqual((await s.estoque.get('/api/mesa')).corpo.preferencias.atalhos, ['produtos', 'estoque', 'expedicao'], 'sem pedidos nem clientes: some, sem lacuna');
    const salvar = (sess, corpo) => sess.put('/api/mesa/preferencias', { mostrar_calendario: true, mostrar_notas: true, ...corpo });
    assert.equal((await salvar(s.gerente, { atalhos: ['painel-executivo'] })).status, 422, 'não guarda atalho sem permissão');
    assert.equal((await salvar(s.gerente, { atalhos: ['clientes', 'pedidos', 'produtos', 'estoque', 'relatorios'] })).status, 422, 'máximo 4');
    assert.equal((await salvar(s.gerente, { atalhos: ['clientes', 'clientes'] })).status, 422, 'sem repetição');
    assert.equal((await salvar(s.gerente, { atalhos: ['x/../admin'] })).status, 422);
    const ok = await salvar(s.gerente, { atalhos: ['relatorios', 'clientes'], mostrar_calendario: false });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.corpo.atalhos, ['relatorios', 'clientes'], 'ordem escolhida');
    const lido = (await s.gerente.get('/api/mesa')).corpo.preferencias;
    assert.equal(lido.mostrar_calendario, false, 'persistiu');
    assert.equal((await s.gerente.put('/api/mesa/preferencias', { restaurar: true })).corpo.atalhos.length, 4, 'restaurar padrão');

    // permissão revogada: o favorito salvo deixa de aparecer
    await fetch(amb.url + '/api/auth/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Rita Pref', login: 'rita.pref', senha: 'Segura2026' }) });
    const id = amb.db.prepare("SELECT id FROM usuarios WHERE login = 'rita.pref'").get().id;
    await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'FINANCEIRO' });
    let r = await login('rita.pref', 'Segura2026');
    let ck = cookieDe(r);
    const { csrf } = await r.json();
    const put = await fetch(amb.url + '/api/mesa/preferencias', { method: 'PUT', headers: { Cookie: ck, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ atalhos: ['financeiro/receber', 'clientes'], mostrar_calendario: true, mostrar_notas: true }) });
    assert.equal(put.status, 200);
    await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'CONSULTA' });
    r = await login('rita.pref', 'Segura2026');
    ck = cookieDe(r);
    assert.deepEqual((await (await get(ck, '/api/mesa')).json()).preferencias.atalhos, ['clientes'], 'financeiro saiu do favorito');
  });

  test('empresa ativa vem do servidor', async () => {
    const e = (await s.sem_acesso.get('/api/empresa')).corpo;
    assert.equal(e.codigo, '01');
    assert.ok(e.nome && e.filial_codigo);
  });

  test('notificações respeitam a área de cada perfil', async () => {
    const tipos = async (u) => [...new Set((await s[u].get('/api/notificacoes')).corpo.map((a) => a.tipo))].sort();
    assert.ok(!(await tipos('vendedor')).includes('FINANCEIRO'), 'vendedor não recebe totais do financeiro');
    assert.ok(!(await tipos('estoque')).includes('FINANCEIRO'));
    assert.ok((await tipos('financeiro')).includes('FINANCEIRO'));
    assert.ok(!(await tipos('consulta')).includes('PEDIDO'), 'aviso de aprovação só para quem aprova');
  });

  test('apagar a conta apaga as tarefas, a nota e as preferências pessoais', async () => {
    await fetch(amb.url + '/api/auth/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Temp Mesa', login: 'temp.mesa', senha: 'Segura2026' }) });
    const id = amb.db.prepare("SELECT id FROM usuarios WHERE login = 'temp.mesa'").get().id;
    amb.db.prepare("INSERT INTO tarefas (usuario_id, titulo, criado_em, atualizado_em) VALUES (?, 't', 'x', 'x')").run(id);
    amb.db.prepare("INSERT INTO notas (usuario_id, texto, criado_em, atualizado_em) VALUES (?, 'n', 'x', 'x')").run(id);
    await s.admin.post(`/api/admin/usuarios/${id}/ativo`, { ativo: false });
    const r = await s.admin.bruto('DELETE', `/api/admin/usuarios/${id}`, { confirmacao: 'temp.mesa' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(amb.db.prepare('SELECT COUNT(*) n FROM tarefas WHERE usuario_id = ?').get(id).n, 0);
    assert.equal(amb.db.prepare('SELECT COUNT(*) n FROM notas WHERE usuario_id = ?').get(id).n, 0);
  });
});

describe('Migração de bancos existentes', () => {
  test('banco antigo ganha os perfis novos sem perder usuários nem sessões', () => {
    const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-mig-')), 'antigo.db');
    const velho = new DatabaseSync(arq);
    velho.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
        perfil TEXT NOT NULL CHECK (perfil IN ('ADMIN','GERENTE','VENDEDOR','ESTOQUE','FINANCEIRO','CONSULTA')),
        senha_hash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sessoes (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), csrf TEXT NOT NULL, expira_em INTEGER NOT NULL);
      INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES ('ana', 'Ana', 'GERENTE', 'x'), ('bia', 'Bia', 'CONSULTA', 'y');
      INSERT INTO sessoes VALUES ('t1', 1, 'c', 9999999999999);`);
    velho.close();
    const db = abrir(arq);
    assert.deepEqual(db.prepare('SELECT login, perfil FROM usuarios ORDER BY id').all().map((u) => ({ ...u })), [{ login: 'ana', perfil: 'GERENTE' }, { login: 'bia', perfil: 'CONSULTA' }]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessoes').get().n, 1);
    db.prepare("UPDATE usuarios SET perfil = 'DIRETORIA' WHERE login = 'ana'").run();
    db.prepare("INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES ('nova', 'Nova', 'SEM_ACESSO', 'z')").run();
    assert.throws(() => db.prepare("INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES ('x', 'X', 'DONO', 'z')").run(), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES ('ANA', 'Dup', 'GERENTE', 'z')").run(), /UNIQUE/, 'índice sem diferenciar maiúsculas recriado');
    db.close();
  });

  test('a nota única antiga vira o primeiro bloquinho, uma vez só', () => {
    const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-notas-')), 'antigo.db');
    const velho = new DatabaseSync(arq);
    velho.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
        perfil TEXT NOT NULL CHECK (perfil IN ('ADMIN','DIRETORIA','GERENTE','VENDEDOR','ESTOQUE','FINANCEIRO','CONSULTA','SEM_ACESSO')),
        senha_hash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE notas_pessoais (usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE, texto TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL);
      INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES ('ana', 'Ana', 'GERENTE', 'x'), ('bia', 'Bia', 'CONSULTA', 'y');
      INSERT INTO notas_pessoais VALUES (1, 'lembrar da reunião', '2026-10-22T10:00:00.000Z'), (2, '   ', '2026-10-22T10:00:00.000Z');`);
    velho.close();
    let db = abrir(arq);
    assert.deepEqual(db.prepare('SELECT usuario_id, texto FROM notas').all().map((n) => ({ ...n })), [{ usuario_id: 1, texto: 'lembrar da reunião' }], 'nota vazia não vira bloco');
    db.prepare('DELETE FROM notas').run(); // a pessoa apaga o bloco depois
    db.close();
    db = abrir(arq);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notas').get().n, 0, 'reabrir o banco não recria a nota apagada');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notas_pessoais').get().n, 2, 'tabela antiga preservada');
    db.close();
  });
});
