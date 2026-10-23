'use strict';
// Permissões dos 8 perfis, validadas no SERVIDOR (rota, escopo de registros, campos sensíveis e
// estado do pedido) — não basta esconder menus. Aqui o gerente NÃO tem o adicional de faturar
// (semAdicionais), para conferir os padrões de cada perfil.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, clienteValido, produtoValido } = require('./apoio');

let amb;
const s = {};
const PERFIS = ['admin', 'diretoria', 'gerente', 'vendedor', 'estoque', 'financeiro', 'consulta', 'sem_acesso', 'vendedor2'];
const idDe = (login) => amb.db.prepare('SELECT id FROM usuarios WHERE login = ?').get(login).id;
let cliV; let cliV2; let cliLivre; let prod; let pedAprovado; let titulo;

before(async () => {
  amb = await iniciar({ semAdicionais: true });
  for (const l of PERFIS) s[l] = await amb.sessao(l);
  cliV = (await s.admin.post('/api/clientes', clienteValido({ vendedor: 'vendedor', limite_credito: 50000 }))).corpo;
  cliV2 = (await s.admin.post('/api/clientes', clienteValido({ vendedor: 'vendedor2' }))).corpo;
  cliLivre = (await s.admin.post('/api/clientes', clienteValido({ vendedor: null }))).corpo;
  prod = (await s.admin.post('/api/produtos', produtoValido({ saldo_inicial: 500, custo: 61.5 }))).corpo;
  const p = (await s.vendedor.post('/api/pedidos', { cliente_id: cliV.id, itens: [{ produto_id: prod.id, quantidade: 2 }] })).corpo;
  pedAprovado = (await s.vendedor.post(`/api/pedidos/${p.id}/enviar`, { versao: p.versao })).corpo;
  assert.equal(pedAprovado.status, 'APROVADO');
  // um título a receber para os testes do financeiro (faturado pelo admin)
  const p2 = (await s.vendedor.post('/api/pedidos', { cliente_id: cliV.id, itens: [{ produto_id: prod.id, quantidade: 1 }] })).corpo;
  const e2 = (await s.vendedor.post(`/api/pedidos/${p2.id}/enviar`, { versao: p2.versao })).corpo;
  const f2 = await s.admin.post(`/api/pedidos/${p2.id}/faturar`, { versao: e2.versao });
  assert.equal(f2.status, 200);
  titulo = f2.corpo.titulos[0];
});
after(() => amb.fechar());

describe('Gestão de perfis e acessos adicionais', () => {
  test('só o Admin altera perfis e permissões; os demais recebem 403', async () => {
    const alvo = idDe('consulta');
    for (const l of ['diretoria', 'gerente', 'vendedor', 'estoque', 'financeiro', 'consulta', 'sem_acesso']) {
      assert.equal((await s[l].post(`/api/admin/usuarios/${alvo}/perfil`, { perfil: 'ADMIN' })).status, 403, l);
      assert.equal((await s[l].post(`/api/admin/usuarios/${alvo}/perfil`, { adicionais: ['financeiro.ler'] })).status, 403, l);
    }
    // ninguém eleva a si mesmo
    assert.equal((await s.gerente.post(`/api/admin/usuarios/${idDe('gerente')}/perfil`, { adicionais: ['pedidos.faturar'] })).status, 403);
  });

  test('o último admin não é removido nem rebaixado; o admin não altera o próprio acesso', async () => {
    const eu = idDe('admin');
    assert.equal((await s.admin.post(`/api/admin/usuarios/${eu}/perfil`, { perfil: 'CONSULTA' })).status, 422);
    assert.equal((await s.admin.post(`/api/admin/usuarios/${eu}/remover-admin`)).status, 422);
    assert.equal((await s.admin.post(`/api/admin/usuarios/${eu}/ativo`, { ativo: false })).status, 422);
  });

  test('adicional fora da lista do perfil é recusado; consulta nunca ganha escrita', async () => {
    const id = idDe('consulta');
    for (const ad of ['pedidos.gravar', 'clientes.gravar', 'estoque.movimentar', 'financeiro.liquidar', 'usuarios.gerir']) {
      const r = await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { adicionais: [ad] });
      assert.equal(r.status, 422, ad);
    }
    assert.equal(amb.db.prepare('SELECT COUNT(*) n FROM usuario_permissoes WHERE usuario_id = ?').get(id).n, 0);
  });

  test('concessão vale na sessão aberta, é auditada e some ao trocar de perfil', async () => {
    const id = idDe('gerente');
    assert.equal((await s.gerente.post(`/api/pedidos/${pedAprovado.id}/faturar`, { versao: pedAprovado.versao })).status, 403, 'gerente não fatura por padrão');
    const r = await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { adicionais: ['pedidos.faturar'] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.adicionais, ['pedidos.faturar']);
    assert.ok(r.corpo.permissoes.includes('pedidos.faturar'));
    // trocar acessos encerra as sessões: novo login já traz a permissão efetiva
    assert.equal((await s.gerente.get('/api/auth/sessao')).status, 401);
    s.gerente = await amb.sessao('gerente');
    const ses = (await s.gerente.get('/api/auth/sessao')).corpo;
    assert.ok(ses.permissoes.includes('pedidos.faturar'));
    assert.deepEqual(ses.adicionais, ['pedidos.faturar']);
    const h = (await s.admin.get('/api/admin/historico-perfis?tamanho=50')).corpo.itens;
    const reg = h.find((x) => x.acao === 'ALTERAR_ACESSOS' && x.usuario_afetado === 'gerente');
    assert.ok(reg, 'auditado');
    assert.deepEqual(reg.adicionais_anteriores, []);
    assert.deepEqual(reg.adicionais_novos, ['pedidos.faturar']);
    assert.equal(reg.administrador, 'admin');
    // nada mudou → 422
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { adicionais: ['pedidos.faturar'] })).status, 422);
    // remove a concessão (volta ao padrão)
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { adicionais: [] })).status, 200);
    s.gerente = await amb.sessao('gerente');
    assert.equal((await s.gerente.post(`/api/pedidos/${pedAprovado.id}/faturar`, { versao: pedAprovado.versao })).status, 403);
  });

  test('trocar o perfil apaga os adicionais que o novo perfil não admite', async () => {
    const id = idDe('diretoria');
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { adicionais: ['auditoria.ler'] })).status, 200);
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'VENDEDOR' })).status, 200);
    assert.equal(amb.db.prepare('SELECT COUNT(*) n FROM usuario_permissoes WHERE usuario_id = ?').get(id).n, 0);
    assert.equal((await s.admin.post(`/api/admin/usuarios/${id}/perfil`, { perfil: 'DIRETORIA' })).status, 200);
    s.diretoria = await amb.sessao('diretoria');
  });

  test('catálogo descreve os 8 perfis e os adicionais permitidos', async () => {
    const cat = (await s.admin.get('/api/admin/perfis')).corpo;
    assert.equal(cat.length, 8);
    const g = cat.find((p) => p.perfil === 'GERENTE');
    assert.deepEqual(g.adicionais.map((a) => a.permissao).sort(), ['auditoria.ler', 'financeiro.ler', 'pedidos.faturar']);
    assert.ok(cat.find((p) => p.perfil === 'SEM_ACESSO').acessos.length === 0);
    assert.ok(!cat.find((p) => p.perfil === 'DIRETORIA').descricao.includes('tudo do Gerente'));
  });
});

describe('Regras por perfil (servidor)', () => {
  const st = async (l, metodo, rota, corpo) => (await s[l].bruto(metodo, rota, corpo)).status;

  test('Diretoria: lê comercial, financeiro, estoque e Painel executivo; sem ações operacionais', async () => {
    for (const r of ['/api/painel-executivo', '/api/pedidos', '/api/clientes', '/api/financeiro/receber', '/api/estoque/saldos', '/api/relatorios/vendas']) {
      assert.equal(await st('diretoria', 'GET', r), 200, r);
    }
    assert.equal(await st('diretoria', 'POST', `/api/pedidos/${pedAprovado.id}/faturar`, { versao: pedAprovado.versao }), 403);
    assert.equal(await st('diretoria', 'POST', '/api/pedidos', { cliente_id: cliV.id, itens: [] }), 403);
    assert.equal(await st('diretoria', 'POST', '/api/estoque/movimentos', { produto_id: prod.id, tipo: 'E', quantidade: 1, motivo: 'Teste diretoria' }), 403);
    assert.equal(await st('diretoria', 'POST', `/api/financeiro/titulos/${titulo.id}/liquidar`, { valor: 1, data: '2026-01-01' }), 403);
    assert.equal(await st('diretoria', 'GET', '/api/admin/usuarios'), 403);
    assert.equal(await st('diretoria', 'PUT', '/api/parametros/ZZ_DESCMXG', { valor: '50' }), 403);
    // vê custo e crédito (leitura estratégica)
    assert.ok('custo' in (await s.diretoria.get(`/api/produtos/${prod.id}`)).corpo);
  });

  test('Gerente: aprova/rejeita e edita cadastros comerciais; não fatura, sem financeiro nem auditoria', async () => {
    assert.equal(await st('gerente', 'GET', '/api/pedidos'), 200);
    assert.equal(await st('gerente', 'GET', '/api/financeiro/receber'), 403);
    assert.equal(await st('gerente', 'GET', '/api/auditoria'), 403);
    assert.equal(await st('gerente', 'GET', '/api/painel-executivo'), 403);
    const c = await s.gerente.post('/api/clientes', clienteValido({ vendedor: 'vendedor' }));
    assert.equal(c.status, 201);
    assert.equal(c.corpo.vendedor, 'vendedor', 'gerente define a carteira');
    // consulta financeira ligada ao pedido: vê os títulos do pedido faturado
    const fat = amb.db.prepare("SELECT id FROM pedidos WHERE status = 'FATURADO' LIMIT 1").get();
    assert.ok((await s.gerente.get(`/api/pedidos/${fat.id}`)).corpo.titulos.length > 0);
  });

  test('Vendedor: só os próprios pedidos e a carteira; altera só em rascunho; sem custo, crédito alheio, financeiro e estoque', async () => {
    // carteira
    const lista = (await s.vendedor.get('/api/clientes?tamanho=100')).corpo.itens.map((c) => c.id);
    assert.ok(lista.includes(cliV.id));
    assert.ok(!lista.includes(cliV2.id) && !lista.includes(cliLivre.id), 'clientes de fora da carteira não aparecem');
    assert.equal(await st('vendedor', 'GET', `/api/clientes/${cliV2.id}`), 404);
    assert.equal(await st('vendedor', 'POST', '/api/pedidos', { cliente_id: cliLivre.id, itens: [{ produto_id: prod.id, quantidade: 1 }] }), 422, 'cliente fora da carteira');
    // o vendedor do pedido vem da sessão, nunca do corpo
    const p = await s.vendedor.post('/api/pedidos', { cliente_id: cliV.id, vendedor: 'vendedor2', itens: [{ produto_id: prod.id, quantidade: 1 }] });
    assert.equal(p.status, 201);
    assert.equal(p.corpo.vendedor, 'vendedor');
    // cliente novo do vendedor entra na carteira dele, sem limite de crédito
    const novo = await s.vendedor.post('/api/clientes', clienteValido({ vendedor: 'vendedor2', limite_credito: 99999 }));
    assert.equal(novo.status, 201);
    assert.equal(amb.db.prepare('SELECT vendedor, limite_credito_cent FROM clientes WHERE id = ?').get(novo.corpo.id).vendedor, 'vendedor');
    assert.equal(amb.db.prepare('SELECT limite_credito_cent n FROM clientes WHERE id = ?').get(novo.corpo.id).n, 0);
    // pedido de outro vendedor
    const outro = (await s.vendedor2.post('/api/pedidos', { cliente_id: cliV2.id, itens: [{ produto_id: prod.id, quantidade: 1 }] })).corpo;
    assert.equal(await st('vendedor', 'GET', `/api/pedidos/${outro.id}`), 404);
    assert.equal(await st('vendedor', 'PUT', `/api/pedidos/${outro.id}`, { cliente_id: cliV.id, itens: [{ produto_id: prod.id, quantidade: 1 }], versao: outro.versao }), 404);
    // fora do rascunho não altera nem cancela; não aprova nem fatura
    assert.equal(await st('vendedor', 'PUT', `/api/pedidos/${pedAprovado.id}`, { cliente_id: cliV.id, itens: [{ produto_id: prod.id, quantidade: 3 }], versao: pedAprovado.versao }), 422);
    assert.equal(await st('vendedor', 'POST', `/api/pedidos/${pedAprovado.id}/cancelar`, { versao: pedAprovado.versao, motivo: 'Desistência' }), 403);
    assert.equal(await st('vendedor', 'POST', `/api/pedidos/${pedAprovado.id}/aprovar`, { versao: pedAprovado.versao }), 403);
    assert.equal(await st('vendedor', 'POST', `/api/pedidos/${pedAprovado.id}/faturar`, { versao: pedAprovado.versao }), 403);
    // produtos: disponibilidade sim, custo não
    const pr = (await s.vendedor.get(`/api/produtos/${prod.id}`)).corpo;
    assert.ok(!('custo' in pr));
    assert.ok('saldo' in pr || 'disponivel' in pr);
    assert.ok((await s.vendedor.get('/api/produtos?tamanho=100')).corpo.itens.every((x) => !('custo' in x)));
    assert.equal(await st('vendedor', 'GET', '/api/financeiro/receber'), 403);
    assert.equal(await st('vendedor', 'GET', '/api/estoque/saldos'), 403);
    assert.equal(await st('vendedor', 'POST', '/api/estoque/movimentos', { produto_id: prod.id, tipo: 'E', quantidade: 1, motivo: 'Teste vendedor' }), 403);
    // títulos do pedido não chegam ao vendedor
    const fat = amb.db.prepare("SELECT id FROM pedidos WHERE status = 'FATURADO' AND vendedor = 'vendedor' LIMIT 1").get();
    assert.deepEqual((await s.vendedor.get(`/api/pedidos/${fat.id}`)).corpo.titulos, []);
  });

  test('Estoque: produtos sem custo, movimenta estoque e vê a expedição sem valores', async () => {
    assert.equal(await st('estoque', 'GET', '/api/pedidos'), 403);
    assert.equal(await st('estoque', 'GET', `/api/pedidos/${pedAprovado.id}`), 403);
    assert.equal(await st('estoque', 'GET', '/api/clientes'), 403);
    assert.ok(!('custo' in (await s.estoque.get(`/api/produtos/${prod.id}`)).corpo));
    assert.equal(await st('estoque', 'POST', '/api/estoque/movimentos', { produto_id: prod.id, tipo: 'E', quantidade: 1, motivo: 'Entrada de teste' }), 201);
    assert.equal(await st('estoque', 'PUT', `/api/produtos/${prod.id}`, { ...produtoValido() }), 403);
    const ex = (await s.estoque.get('/api/expedicao')).corpo;
    assert.ok(ex.itens.some((p) => p.id === pedAprovado.id));
    assert.ok(ex.itens.every((p) => ['APROVADO', 'FATURADO'].includes(p.status)));
    const det = (await s.estoque.get(`/api/expedicao/${pedAprovado.id}`)).corpo;
    assert.equal(det.itens[0].quantidade, 2);
    const texto = JSON.stringify(det);
    for (const proibido of ['preco', 'total', 'custo', 'limite', 'credito', 'valor', 'desconto']) assert.ok(!texto.includes(proibido), proibido);
    // rascunho não aparece na expedição
    const rasc = amb.db.prepare("SELECT id FROM pedidos WHERE status = 'RASCUNHO' LIMIT 1").get();
    assert.equal(await st('estoque', 'GET', `/api/expedicao/${rasc.id}`), 404);
    assert.equal(await st('vendedor', 'GET', '/api/expedicao'), 403);
  });

  test('Financeiro: liquida e ajusta títulos; lê pedidos e clientes; não edita pedidos, cadastros nem estoque; não fatura', async () => {
    assert.equal(await st('financeiro', 'GET', '/api/pedidos'), 200);
    assert.equal(await st('financeiro', 'GET', `/api/clientes/${cliV.id}`), 200);
    assert.equal(await st('financeiro', 'PUT', `/api/clientes/${cliV.id}`, { ...clienteValido(), versao: 1 }), 403);
    assert.equal(await st('financeiro', 'POST', '/api/pedidos', { cliente_id: cliV.id, itens: [] }), 403);
    assert.equal(await st('financeiro', 'POST', `/api/pedidos/${pedAprovado.id}/faturar`, { versao: pedAprovado.versao }), 403);
    assert.equal(await st('financeiro', 'POST', '/api/estoque/movimentos', { produto_id: prod.id, tipo: 'E', quantidade: 1, motivo: 'Teste financeiro' }), 403);
    // ajuste de vencimento e observação
    const t = (await s.financeiro.get(`/api/financeiro/titulos/${titulo.id}`)).corpo;
    const ed = await s.financeiro.put(`/api/financeiro/titulos/${t.id}`, { vencimento: '2099-12-31', historico: 'Prorrogado a pedido do cliente', versao: t.versao });
    assert.equal(ed.status, 200, JSON.stringify(ed.corpo));
    assert.equal(ed.corpo.vencimento, '2099-12-31');
    assert.equal(ed.corpo.valor, t.valor, 'valor não muda');
    assert.equal((await s.financeiro.put(`/api/financeiro/titulos/${t.id}`, { vencimento: '2000-01-01', versao: ed.corpo.versao })).status, 422, 'antes da emissão');
    assert.equal((await s.financeiro.put(`/api/financeiro/titulos/${t.id}`, { vencimento: '2099-12-30', versao: t.versao })).status, 409, 'versão antiga');
    const aud = (await s.admin.get('/api/auditoria?entidade=TITULO')).corpo;
    assert.ok(JSON.stringify(aud).includes('2099-12-31'), 'ajuste auditado');
    assert.equal(await st('gerente', 'PUT', `/api/financeiro/titulos/${t.id}`, { vencimento: '2099-12-30', versao: ed.corpo.versao }), 403);
    // liquida e depois não edita mais
    const liq = await s.financeiro.post(`/api/financeiro/titulos/${t.id}/liquidar`, { valor: ed.corpo.saldo, data: ed.corpo.emissao, versao: ed.corpo.versao });
    assert.equal(liq.status, 200, JSON.stringify(liq.corpo));
    assert.equal((await s.financeiro.put(`/api/financeiro/titulos/${t.id}`, { vencimento: '2099-12-30', versao: liq.corpo.versao })).status, 422, 'liquidado congela');
  });

  test('Consulta: só leitura de cadastros e estoque, sem custo nem crédito; adicionais só de leitura', async () => {
    assert.equal(await st('consulta', 'GET', '/api/clientes'), 200);
    assert.equal(await st('consulta', 'GET', '/api/estoque/saldos'), 200);
    for (const r of ['/api/pedidos', '/api/financeiro/receber', '/api/painel-executivo', '/api/relatorios', '/api/auditoria']) assert.equal(await st('consulta', 'GET', r), 403, r);
    const c = (await s.consulta.get(`/api/clientes/${cliV.id}`)).corpo;
    assert.ok(!('limite_credito' in c) && !('credito_disponivel' in c), 'sem crédito');
    assert.ok(!('custo' in (await s.consulta.get(`/api/produtos/${prod.id}`)).corpo), 'sem custo');
    for (const [m, r, b] of [['POST', '/api/clientes', clienteValido()], ['PUT', `/api/clientes/${cliV.id}`, { versao: 1 }], ['POST', '/api/produtos', produtoValido()],
      ['POST', '/api/estoque/movimentos', { produto_id: prod.id, tipo: 'E', quantidade: 1, motivo: 'Teste consulta' }]]) {
      assert.equal(await st('consulta', m, r, b), 403, `${m} ${r}`);
    }
    // o admin libera a leitura de pedidos e relatórios: lê, mas continua sem escrever
    assert.equal((await s.admin.post(`/api/admin/usuarios/${idDe('consulta')}/perfil`, { adicionais: ['pedidos.ler', 'relatorios.ler'] })).status, 200);
    s.consulta = await amb.sessao('consulta');
    assert.equal(await st('consulta', 'GET', '/api/pedidos'), 200);
    assert.equal(await st('consulta', 'POST', '/api/pedidos', { cliente_id: cliV.id, itens: [{ produto_id: prod.id, quantidade: 1 }] }), 403);
    const cat = (await s.consulta.get('/api/relatorios')).corpo.map((r) => r.id);
    assert.ok(cat.includes('pedidos_status') && !cat.includes('receber_vencidas'), 'relatórios só dos dados liberados');
    assert.equal(await st('consulta', 'GET', '/api/relatorios/receber_vencidas'), 403);
    assert.equal(await st('consulta', 'GET', '/api/pedidos/' + pedAprovado.id), 200);
    assert.equal((await s.consulta.get(`/api/pedidos/${pedAprovado.id}`)).corpo.credito, null, 'sem crédito no pedido');
  });

  test('Sem acesso: só Início e opções pessoais', async () => {
    for (const r of ['/api/clientes', '/api/produtos', '/api/pedidos', '/api/estoque/saldos', '/api/financeiro/receber', '/api/relatorios', '/api/expedicao', '/api/parametros']) {
      assert.equal(await st('sem_acesso', 'GET', r), 403, r);
    }
    assert.equal(await st('sem_acesso', 'GET', '/api/mesa'), 200);
    assert.equal(await st('sem_acesso', 'GET', '/api/tarefas'), 200);
    assert.deepEqual((await s.sem_acesso.get('/api/auth/sessao')).corpo.permissoes, []);
  });

  test('relatórios e CSV respeitam permissões e o escopo do vendedor', async () => {
    const catE = (await s.estoque.get('/api/relatorios')).corpo.map((r) => r.id).sort();
    assert.deepEqual(catE, ['estoque_baixo', 'movimentacoes']);
    assert.equal(await st('estoque', 'GET', '/api/relatorios/vendas'), 403);
    assert.equal(await st('estoque', 'GET', '/api/relatorios/vendas?formato=csv'), 403, 'CSV passa pela mesma checagem');
    assert.equal(await st('vendedor', 'GET', '/api/relatorios/receber_vencidas?formato=csv'), 403);
    const rel = (await s.vendedor.get('/api/relatorios/pedidos_status')).corpo;
    const meus = amb.db.prepare("SELECT numero FROM pedidos WHERE vendedor = 'vendedor'").all().map((p) => p.numero);
    assert.ok(rel.linhas.length > 0 && rel.linhas.every((l) => meus.includes(l.numero)), 'só os próprios pedidos');
    const csv = await s.vendedor.get('/api/relatorios/pedidos_status?formato=csv');
    assert.equal(csv.status, 200);
    const alheio = amb.db.prepare("SELECT numero FROM pedidos WHERE vendedor = 'vendedor2' LIMIT 1").get().numero;
    assert.ok(!csv.corpo.includes(alheio), 'CSV sem pedido alheio');
  });

  test('carteira: só gerente/admin listam vendedores; clientes antigos não ganham vendedor automaticamente', async () => {
    assert.equal(await st('gerente', 'GET', '/api/vendedores'), 200);
    assert.equal(await st('vendedor', 'GET', '/api/vendedores'), 403);
    assert.equal(amb.db.prepare('SELECT vendedor FROM clientes WHERE id = ?').get(cliLivre.id).vendedor, null);
    // vendedor não muda a carteira nem o limite ao alterar o próprio cliente
    const c = (await s.vendedor.get(`/api/clientes/${cliV.id}`)).corpo;
    const r = await s.vendedor.put(`/api/clientes/${cliV.id}`, { ...c, vendedor: 'vendedor2', limite_credito: 999999, versao: c.versao });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const db = amb.db.prepare('SELECT vendedor, limite_credito_cent FROM clientes WHERE id = ?').get(cliV.id);
    assert.equal(db.vendedor, 'vendedor');
    assert.equal(db.limite_credito_cent, 5000000);
  });
});
