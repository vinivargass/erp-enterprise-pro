'use strict';
// Testes da área administrativa (painel exclusivo + gestão do perfil Admin).
// Banco SQLite EM MEMÓRIA com usuários de teste: nenhuma conta real é alterada.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, clienteValido, produtoValido } = require('./apoio');
const admin = require('../server/services/admin');

const SENHA = 'Teste@123';
let amb; let adm; let gerente; let vendedor; let consulta;

const idDe = (login) => amb.db.prepare('SELECT id FROM usuarios WHERE login = ?').get(login).id;
const perfilDe = (login) => ({ ...amb.db.prepare('SELECT perfil, ativo FROM usuarios WHERE login = ?').get(login) });
const registrar = (nome, login) => fetch(amb.url + '/api/auth/registrar', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, login, senha: 'Segura2026' }),
});

before(async () => {
  amb = await iniciar({ maxCadastros: 100 }); // esta suíte cria muitas contas seguidas; o padrão (5/10 min) vale em produção
  [adm, gerente, vendedor, consulta] = await Promise.all(['admin', 'gerente', 'vendedor', 'consulta'].map((l) => amb.sessao(l)));
  // Massa mínima de vendas faturadas para o painel (pelos próprios serviços, via API).
  const c = (await adm.post('/api/clientes', clienteValido({ limite_credito: 100000 }))).corpo;
  const p1 = (await adm.post('/api/produtos', produtoValido({ grupo: 'AAA', preco_venda: 100, custo: 40 }))).corpo;
  const p2 = (await adm.post('/api/produtos', produtoValido({ grupo: 'BBB', preco_venda: 50, custo: 30 }))).corpo;
  for (const itens of [[{ produto_id: p1.id, quantidade: 2 }], [{ produto_id: p2.id, quantidade: 4 }, { produto_id: p1.id, quantidade: 1 }]]) {
    const ped = (await vendedor.post('/api/pedidos', { cliente_id: c.id, itens })).corpo;
    const env = (await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao })).corpo;
    assert.equal((await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.versao })).status, 200);
  }
});
after(() => amb.fechar());

describe('Painel exclusivo para administradores', () => {
  test('1. administrador acessa o painel com indicadores e gráficos de dados reais', async () => {
    const r = await adm.get('/api/admin/painel');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.indicadores.faturamento, 500);   // 2×100 + (4×50 + 1×100)
    assert.equal(r.corpo.indicadores.pedidos, 2);
    assert.equal(r.corpo.indicadores.ticket_medio, 250);
    assert.equal(r.corpo.indicadores.margem_estimada, 500 - (3 * 40 + 4 * 30));
    assert.ok(r.corpo.evolucao.length >= 1);
    assert.deepEqual(r.corpo.por_grupo.map((g) => g.rotulo), ['AAA', 'BBB']);
    assert.ok(r.corpo.por_status.length && r.corpo.top_clientes.length);
  });

  test('filtros (grupo, período) e tabela com pesquisa, ordenação e paginação', async () => {
    const grupo = await adm.get('/api/admin/painel?grupo=BBB');
    assert.equal(grupo.corpo.indicadores.faturamento, 200);
    const vazio = await adm.get('/api/admin/painel?de=2000-01-01&ate=2000-01-31');
    assert.equal(vazio.corpo.indicadores.faturamento, 0);
    assert.equal((await adm.get('/api/admin/painel?de=2026-12-01&ate=2026-01-01')).status, 422);
    const tab = await adm.get('/api/admin/vendas?tamanho=2&ordem=total&direcao=desc');
    assert.equal(tab.corpo.total, 3);
    assert.equal(tab.corpo.itens.length, 2);
    assert.equal(tab.corpo.itens[0].total, 200);
    assert.equal((await adm.get('/api/admin/vendas?q=inexistente-xyz')).corpo.total, 0);
  });

  test('2-3. usuário comum não acessa painel nem dados administrativos por API (e fica auditado)', async () => {
    const rotas = ['/api/admin/painel', '/api/admin/vendas', '/api/admin/usuarios', '/api/admin/historico-perfis', '/api/usuarios'];
    for (const s of [gerente, vendedor, consulta]) {
      for (const rota of rotas) assert.equal((await s.get(rota)).status, 403, rota);
    }
    for (const rota of rotas) assert.equal((await fetch(amb.url + rota)).status, 401, `anônimo ${rota}`);
    const negados = amb.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE acao = 'ACESSO_NEGADO' AND detalhes LIKE '%/api/admin/painel%'").get().n;
    assert.ok(negados >= 3, 'tentativas negadas registradas');
    // Resposta negada não vaza nenhum dado do painel
    const r = await consulta.get('/api/admin/painel');
    assert.equal(r.corpo.indicadores, undefined);
  });
});

describe('Gestão do perfil Admin', () => {
  test('4. pesquisa por nome completo, parte do nome e usuário, sem diferenciar maiúsculas e acentos', async () => {
    assert.equal((await registrar('José Antônio Pereira', 'jose.antonio')).status, 201);
    assert.equal((await registrar('Ana Lúcia Souza', 'analu')).status, 201);
    for (const termo of ['José Antônio Pereira', 'jose antonio', 'ANTONIO', 'pere', 'jose.ant']) {
      const r = await adm.get(`/api/admin/usuarios?q=${encodeURIComponent(termo)}`);
      assert.ok(r.corpo.itens.some((u) => u.login === 'jose.antonio'), termo);
    }
    const lucia = await adm.get('/api/admin/usuarios?q=lucia');
    assert.deepEqual(lucia.corpo.itens.map((u) => u.login), ['analu']);
    const admins = await adm.get('/api/admin/usuarios?perfil=admin');
    assert.ok(admins.corpo.itens.every((u) => u.admin));
    const comuns = await adm.get('/api/admin/usuarios?perfil=comum&tamanho=2');
    assert.ok(comuns.corpo.itens.every((u) => !u.admin));
    assert.equal(comuns.corpo.itens.length, 2);
    assert.ok(comuns.corpo.total > 2, 'paginação');
    assert.ok(!JSON.stringify(comuns.corpo).includes('senha'), 'não expõe senha/hash');
  });

  test('5 e 10. conceder Admin: grava, encerra sessões antigas e o novo login acessa o painel', async () => {
    const alvo = await amb.sessao('vendedor2');
    assert.equal((await alvo.get('/api/admin/painel')).status, 403);
    const r = await adm.post(`/api/admin/usuarios/${idDe('vendedor2')}/conceder-admin`);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.perfil, 'ADMIN');
    assert.equal(perfilDe('vendedor2').perfil, 'ADMIN', 'persistido no banco');
    assert.equal((await alvo.get('/api/auth/sessao')).status, 401, 'sessão antiga invalidada');
    const nova = await amb.sessao('vendedor2');
    assert.equal((await nova.get('/api/admin/painel')).status, 200);
    assert.equal((await adm.post(`/api/admin/usuarios/${idDe('vendedor2')}/conceder-admin`)).status, 422, 'já é admin');
  });

  test('6 e 10. remover Admin: conta continua ativa no perfil anterior e perde o acesso na hora', async () => {
    const comoAdmin = await amb.sessao('vendedor2');
    assert.equal((await comoAdmin.get('/api/admin/usuarios')).status, 200);
    const r = await adm.post(`/api/admin/usuarios/${idDe('vendedor2')}/remover-admin`);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.perfil, 'VENDEDOR', 'volta ao perfil comum que tinha antes');
    assert.deepEqual(perfilDe('vendedor2'), { perfil: 'VENDEDOR', ativo: 1 });
    assert.equal((await comoAdmin.get('/api/admin/usuarios')).status, 401, 'sessão de admin derrubada');
    const depois = await amb.sessao('vendedor2');
    assert.equal((await depois.get('/api/admin/painel')).status, 403);
    assert.equal((await depois.get('/api/pedidos')).status, 200, 'continua usando o sistema como vendedor');
  });

  test('alterar para qualquer perfil: cada um fica LIMITADO à sua área (validado no servidor)', async () => {
    const cat = (await adm.get('/api/admin/perfis')).corpo;
    assert.deepEqual(cat.map((p) => p.perfil), ['ADMIN', 'GERENTE', 'VENDEDOR', 'ESTOQUE', 'FINANCEIRO', 'CONSULTA']);
    assert.ok(cat.find((p) => p.perfil === 'ESTOQUE').acessos.includes('Movimentar estoque'));
    assert.ok(!cat.find((p) => p.perfil === 'VENDEDOR').acessos.includes('Liquidar títulos'));

    assert.equal((await registrar('Paula Perfis', 'paula.perfis')).status, 201);
    const id = idDe('paula.perfis');
    const casos = [
      // perfil      pode                                   não pode
      ['ESTOQUE', ['/api/estoque/saldos'], ['/api/pedidos', '/api/financeiro/receber', '/api/admin/painel']],
      ['FINANCEIRO', ['/api/financeiro/receber'], ['/api/admin/usuarios', '/api/auditoria']],
      ['VENDEDOR', ['/api/pedidos'], ['/api/financeiro/receber', '/api/admin/painel']],
      ['GERENTE', ['/api/auditoria', '/api/financeiro/receber'], ['/api/admin/painel', '/api/admin/usuarios']],
    ];
    for (const [perfil, pode, naoPode] of casos) {
      const r = await adm.post(`/api/admin/usuarios/${id}/perfil`, { perfil });
      assert.equal(r.status, 200, perfil);
      assert.equal(perfilDe('paula.perfis').perfil, perfil);
      const s = await fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'paula.perfis', senha: 'Segura2026' }) });
      const ck = s.headers.get('set-cookie').split(';')[0];
      for (const rota of pode) assert.equal((await fetch(amb.url + rota, { headers: { Cookie: ck } })).status, 200, `${perfil} pode ${rota}`);
      for (const rota of naoPode) assert.equal((await fetch(amb.url + rota, { headers: { Cookie: ck } })).status, 403, `${perfil} não pode ${rota}`);
    }
    assert.equal((await adm.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'SUPERUSUARIO' })).status, 422, 'perfil fora da lista');
    assert.equal((await adm.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'GERENTE' })).status, 422, 'mesmo perfil');
    assert.equal((await adm.post(`/api/admin/usuarios/${idDe('admin')}/perfil`, { perfil: 'CONSULTA' })).status, 422, 'não rebaixa a si mesmo');
    assert.equal((await gerente.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'ADMIN' })).status, 403, 'não-admin não altera');
    const h = (await adm.get('/api/admin/historico-perfis?tamanho=50')).corpo.itens;
    assert.ok(h.some((x) => x.acao === 'ALTERAR_PERFIL' && x.usuario_afetado === 'paula.perfis' && x.perfil_novo === 'FINANCEIRO'));
    const sp = (await adm.get('/api/admin/usuarios?perfil=GERENTE')).corpo.itens;
    assert.ok(sp.length && sp.every((u) => u.perfil === 'GERENTE'), 'filtro por perfil específico');
  });

  test('desativar e reativar conta: perde o acesso, mantém perfil e dados; auditado', async () => {
    assert.equal((await registrar('Carlos Ativo', 'carlos.ativo')).status, 201);
    const id = idDe('carlos.ativo');
    const r = await adm.post(`/api/admin/usuarios/${id}/ativo`, { ativo: false });
    assert.equal(r.status, 200);
    assert.deepEqual(perfilDe('carlos.ativo'), { perfil: 'CONSULTA', ativo: 0 });
    const login = await fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'carlos.ativo', senha: 'Segura2026' }) });
    assert.equal(login.status, 401, 'conta desativada não entra');
    assert.equal((await adm.post(`/api/admin/usuarios/${id}/ativo`, { ativo: false })).status, 422, 'já desativada');
    assert.equal((await adm.post(`/api/admin/usuarios/${idDe('admin')}/ativo`, { ativo: false })).status, 422, 'não desativa a si mesmo');
    assert.equal((await gerente.post(`/api/admin/usuarios/${id}/ativo`, { ativo: true })).status, 403);
    assert.equal((await adm.post(`/api/admin/usuarios/${id}/ativo`, { ativo: true })).status, 200);
    const h = (await adm.get('/api/admin/historico-perfis?tamanho=50')).corpo.itens;
    assert.ok(h.some((x) => x.acao === 'DESATIVAR_CONTA' && x.usuario_afetado === 'carlos.ativo' && x.resultado === 'SUCESSO'));
  });

  test('excluir usuário: só sem histórico, com login digitado; admin/si mesmo/com histórico bloqueados', async () => {
    assert.equal((await registrar('Excluivel Teste', 'excluivel')).status, 201);
    const id = idDe('excluivel');
    const lista = (await adm.get('/api/admin/usuarios?exclusao=1&tamanho=50')).corpo.itens;
    assert.equal(lista.find((u) => u.login === 'excluivel').exclusao.permitida, true);
    assert.equal(lista.find((u) => u.login === 'vendedor').exclusao.permitida, false, 'vendedor tem pedidos');
    assert.match(lista.find((u) => u.login === 'vendedor').exclusao.motivo, /Desative/);
    assert.equal(lista.find((u) => u.login === 'admin').exclusao.permitida, false);

    const del = (s, uid, confirmacao) => s.bruto('DELETE', `/api/admin/usuarios/${uid}`, { confirmacao });
    assert.equal((await del(adm, id, 'outro-login')).status, 422, 'confirmação errada');
    assert.equal((await del(gerente, id, 'excluivel')).status, 403, 'não-admin');
    assert.equal((await del(adm, idDe('vendedor'), 'vendedor')).status, 422, 'com histórico');
    assert.equal((await del(adm, idDe('admin'), 'admin')).status, 422, 'a si mesmo');
    assert.ok(perfilDe('vendedor').perfil, 'vendedor continua existindo');

    const ok = await del(adm, id, 'EXCLUIVEL');
    assert.equal(ok.status, 200);
    assert.equal(amb.db.prepare('SELECT COUNT(*) n FROM usuarios WHERE id = ?').get(id).n, 0);
    assert.equal((await del(adm, id, 'excluivel')).status, 404);
    const h = (await adm.get('/api/admin/historico-perfis?tamanho=50')).corpo.itens;
    assert.ok(h.some((x) => x.acao === 'EXCLUIR_USUARIO' && x.usuario_afetado === 'excluivel' && x.resultado === 'SUCESSO'));
    assert.ok(h.some((x) => x.acao === 'EXCLUIR_USUARIO' && x.usuario_afetado === 'vendedor' && x.resultado === 'NEGADO'));
  });

  test('conta com histórico: desativar e depois excluir; histórico mantido e login reservado', async () => {
    assert.equal((await registrar('Hist Vendedor', 'hist.vend')).status, 201);
    const id = idDe('hist.vend');
    await adm.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'VENDEDOR' });
    const lg = await fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'hist.vend', senha: 'Segura2026' }) });
    const { csrf } = await lg.json();
    const ck = lg.headers.get('set-cookie').split(';')[0];
    const cli = (await adm.get('/api/clientes?status=ativo&tamanho=1')).corpo.itens[0];
    const prod = (await adm.get('/api/produtos?status=ativo&tamanho=1')).corpo.itens[0];
    const ped = await fetch(amb.url + '/api/pedidos', { method: 'POST', headers: { Cookie: ck, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: cli.id, itens: [{ produto_id: prod.id, quantidade: 1 }] }) });
    assert.equal(ped.status, 201);
    const pedidoId = (await ped.json()).id;

    const del = (uid, confirmacao) => adm.bruto('DELETE', `/api/admin/usuarios/${uid}`, { confirmacao });
    assert.equal((await del(id, 'hist.vend')).status, 422, 'ativa com histórico: precisa desativar antes');
    assert.equal((await adm.post(`/api/admin/usuarios/${id}/ativo`, { ativo: false })).status, 200);
    const av = (await adm.get('/api/admin/usuarios?exclusao=1&q=hist.vend')).corpo.itens[0].exclusao;
    assert.equal(av.permitida, true);
    assert.equal(av.historico, true);

    const ok = await del(id, 'hist.vend');
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.login_reservado, true);
    assert.equal(amb.db.prepare('SELECT COUNT(*) n FROM usuarios WHERE id = ?').get(id).n, 0, 'saiu do banco');
    assert.equal(amb.db.prepare('SELECT vendedor FROM pedidos WHERE id = ?').get(pedidoId).vendedor, 'hist.vend', 'pedido mantido');
    for (const tentativa of ['hist.vend', 'HIST.VEND']) {
      const r = await registrar('Impostor', tentativa);
      assert.equal(r.status, 409, `login reservado: ${tentativa}`);
    }
    // conta SEM histórico e desativada também pode ser excluída, e o login fica livre
    assert.equal((await registrar('Sem Hist', 'sem.hist')).status, 201);
    await adm.post(`/api/admin/usuarios/${idDe('sem.hist')}/ativo`, { ativo: false });
    const r2 = await del(idDe('sem.hist'), 'sem.hist');
    assert.equal(r2.status, 200);
    assert.equal(r2.corpo.login_reservado, false);
    assert.equal((await registrar('Sem Hist 2', 'sem.hist')).status, 201, 'login sem histórico pode ser reutilizado');
  });

  test('7. sem autorização ninguém altera perfis por chamada direta (nem eleva o próprio)', async () => {
    const meuId = idDe('vendedor');
    for (const s of [gerente, vendedor, consulta]) {
      assert.equal((await s.post(`/api/admin/usuarios/${meuId}/conceder-admin`)).status, 403);
      assert.equal((await s.put(`/api/usuarios/${meuId}`, { perfil: 'ADMIN' })).status, 403);
    }
    // perfil "informado" pelo cliente não tem efeito
    assert.equal((await vendedor.post(`/api/admin/usuarios/${meuId}/conceder-admin`, { perfil: 'ADMIN', admin: true })).status, 403);
    assert.equal(perfilDe('vendedor').perfil, 'VENDEDOR');
    assert.equal((await adm.post('/api/admin/usuarios/999999/conceder-admin')).status, 404);
  });

  test('8. o próprio admin não se remove e o último administrador ativo é protegido', async () => {
    assert.equal((await adm.post(`/api/admin/usuarios/${idDe('admin')}/remover-admin`)).status, 422);
    // Defesa em profundidade: simula duas remoções cruzadas (A e B se removendo ao mesmo tempo).
    await adm.post(`/api/admin/usuarios/${idDe('gerente')}/conceder-admin`);
    amb.db.prepare("UPDATE usuarios SET ativo = 0 WHERE login = 'admin'").run(); // A deixou de ser admin ativo nesse meio-tempo
    const ctxA = { db: amb.db, agora: () => new Date(), usuario: { id: idDe('admin'), login: 'admin', perfil: 'ADMIN' } };
    assert.throws(() => admin.definirAdmin(ctxA, idDe('gerente'), false), /último administrador ativo/);
    assert.equal(perfilDe('gerente').perfil, 'ADMIN', 'o sistema não ficou sem administrador');
    amb.db.prepare("UPDATE usuarios SET ativo = 1 WHERE login = 'admin'").run();
    // restaura o cenário: gerente volta a GERENTE
    adm = await amb.sessao('admin');
    assert.equal((await adm.post(`/api/admin/usuarios/${idDe('gerente')}/remover-admin`)).corpo.perfil, 'GERENTE');
    gerente = await amb.sessao('gerente');
  });

  test('9. falha de gravação é informada como erro e nada muda', async () => {
    amb.db.exec("CREATE TEMP TRIGGER falha_usuarios BEFORE UPDATE ON usuarios BEGIN SELECT RAISE(ABORT, 'disco cheio (simulado)'); END;");
    const r = await adm.post(`/api/admin/usuarios/${idDe('consulta')}/conceder-admin`);
    amb.db.exec('DROP TRIGGER falha_usuarios');
    assert.equal(r.status, 500);
    assert.equal(r.corpo.perfil, undefined, 'não devolve dados de sucesso');
    assert.ok(!JSON.stringify(r.corpo).includes('disco cheio'), 'não vaza detalhe interno');
    assert.equal(perfilDe('consulta').perfil, 'CONSULTA');
    const ult = (await adm.get('/api/admin/historico-perfis')).corpo.itens[0];
    assert.equal(ult.resultado, 'FALHA');
    assert.equal(ult.usuario_afetado, 'consulta');
  });

  test('11. histórico registra quem, quem foi afetado, perfis, ação, data e resultado; e é imutável', async () => {
    const h = (await adm.get('/api/admin/historico-perfis?tamanho=50')).corpo.itens;
    const concessao = h.find((x) => x.acao === 'CONCEDER_ADMIN' && x.usuario_afetado === 'vendedor2' && x.resultado === 'SUCESSO');
    assert.ok(concessao);
    assert.equal(concessao.administrador, 'admin');
    assert.equal(concessao.perfil_anterior, 'VENDEDOR');
    assert.equal(concessao.perfil_novo, 'ADMIN');
    assert.match(concessao.data_hora, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(h.some((x) => x.acao === 'REMOVER_ADMIN' && x.resultado === 'NEGADO'), 'tentativa negada também fica registrada');
    assert.ok(!JSON.stringify(h).match(/senha|token|csrf/i), 'sem segredos');
    assert.throws(() => amb.db.prepare('UPDATE auditoria SET usuario = 1').run(), /imutável/);
    assert.throws(() => amb.db.prepare('DELETE FROM auditoria').run(), /imutável/);
    assert.ok(amb.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidade = 'PAINEL_ADMIN' AND acao = 'ACESSO'").get().n > 0, 'acessos ao painel registrados');
  });
});

void SENHA;
