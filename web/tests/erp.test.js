'use strict';
// Testes automatizados da APLICAÇÃO WEB (não dependem de Protheus).
// Executar: testar.cmd na raiz, ou `node --test tests/` dentro de web/.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, clienteValido, produtoValido, dvCpf } = require('./apoio');

let amb; let admin; let gerente; let vendedor; let estoque; let financeiro; let consulta;

before(async () => {
  amb = await iniciar();
  [admin, gerente, vendedor, estoque, financeiro, consulta] = await Promise.all(
    ['admin', 'gerente', 'vendedor', 'estoque', 'financeiro', 'consulta'].map((l) => amb.sessao(l)));
});
after(() => amb.fechar());

async function novoCliente(extra) { const r = await admin.post('/api/clientes', clienteValido(extra)); assert.equal(r.status, 201, JSON.stringify(r.corpo)); return r.corpo; }
async function novoProduto(extra) { const r = await admin.post('/api/produtos', produtoValido(extra)); assert.equal(r.status, 201, JSON.stringify(r.corpo)); return r.corpo; }
async function novoPedido(sessao, clienteId, itens) { const r = await sessao.post('/api/pedidos', { cliente_id: clienteId, itens }); assert.equal(r.status, 201, JSON.stringify(r.corpo)); return r.corpo; }

describe('1-2. Clientes', () => {
  test('1. cadastro de cliente válido gera código automático e auditoria', async () => {
    const c = await novoCliente();
    assert.match(c.codigo, /^\d{6}$/);
    assert.equal(c.ativo, true);
    const hist = await admin.get(`/api/clientes/${c.id}/historico`);
    assert.equal(hist.corpo[0].acao, 'INCLUSAO');
  });

  test('2. bloqueia CPF/CNPJ duplicado (inclusão e alteração)', async () => {
    const a = await novoCliente();
    const dup = await admin.post('/api/clientes', clienteValido({ documento: a.documento }));
    assert.equal(dup.status, 409);
    assert.match(dup.corpo.erro.mensagem, /já cadastrado/);
    // mesmo documento formatado com máscara também é bloqueado
    const mascarado = a.documento.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    assert.equal((await admin.post('/api/clientes', clienteValido({ documento: mascarado }))).status, 409);
    const b = await novoCliente();
    const alt = await admin.put(`/api/clientes/${b.id}`, { ...clienteValido({ documento: a.documento }), versao: b.versao });
    assert.equal(alt.status, 409);
  });

  test('valida dígitos verificadores, obrigatórios e UF', async () => {
    const r = await admin.post('/api/clientes', clienteValido({ documento: '11.111.111/1111-11', razao_social: '', uf: 'XX', email: 'x@' }));
    assert.equal(r.status, 422);
    assert.ok(r.corpo.erro.detalhes.documento && r.corpo.erro.detalhes.razao_social && r.corpo.erro.detalhes.uf && r.corpo.erro.detalhes.email);
    const cpf = await admin.post('/api/clientes', clienteValido({ tipo_pessoa: 'F', documento: dvCpf('987654321') }));
    assert.equal(cpf.status, 201);
  });

  test('alteração registra histórico campo a campo e controla versão', async () => {
    const c = await novoCliente();
    const r = await admin.put(`/api/clientes/${c.id}`, { ...c, limite_credito: 1234.5, versao: c.versao });
    assert.equal(r.status, 200);
    const velho = await admin.put(`/api/clientes/${c.id}`, { ...c, limite_credito: 1, versao: c.versao });
    assert.equal(velho.status, 409, 'versão desatualizada deve gerar conflito');
    const hist = await admin.get(`/api/clientes/${c.id}/historico`);
    assert.deepEqual(hist.corpo[0].detalhes.limite_credito, { de: 10000, para: 1234.5 });
  });

  test('inativação lógica bloqueia novos pedidos', async () => {
    const c = await novoCliente();
    const p = await novoProduto();
    assert.equal((await admin.post(`/api/clientes/${c.id}/inativar`, { versao: c.versao })).status, 200);
    const r = await vendedor.post('/api/pedidos', { cliente_id: c.id, itens: [{ produto_id: p.id, quantidade: 1 }] });
    assert.equal(r.status, 422);
  });

  test('pesquisa por nome/documento com paginação e caracteres curinga tratados', async () => {
    const c = await novoCliente({ razao_social: 'Zebra 100% Especial_Ltda' });
    const porNome = await admin.get('/api/clientes?q=100%25%20Esp&campo=nome');
    assert.equal(porNome.corpo.total, 1);
    const porDoc = await admin.get(`/api/clientes?q=${c.documento.slice(0, 8)}&campo=documento`);
    assert.ok(porDoc.corpo.itens.some((x) => x.id === c.id));
    const pag = await admin.get('/api/clientes?tamanho=2&pagina=1&status=');
    assert.equal(pag.corpo.itens.length, 2);
    assert.ok(pag.corpo.total > 2);
  });
});

describe('3. Produtos', () => {
  test('3. rejeita preço inválido (zero, negativo, texto, 3 casas)', async () => {
    for (const preco of [0, -10, 'abc', 10.123]) {
      const r = await admin.post('/api/produtos', produtoValido({ preco_venda: preco }));
      assert.equal(r.status, 422, `preço ${preco}`);
      assert.ok(r.corpo.erro.detalhes.preco_venda);
    }
    const qtdNeg = await admin.post('/api/produtos', produtoValido({ estoque_minimo: -1 }));
    assert.equal(qtdNeg.status, 422);
  });

  test('saldo inicial vira movimentação; cadastro não altera saldo', async () => {
    const p = await novoProduto({ saldo_inicial: 30 });
    const movs = await admin.get(`/api/estoque/movimentos?produto_id=${p.id}`);
    assert.equal(movs.corpo.itens[0].origem, 'SALDO_INICIAL');
    const r = await admin.put(`/api/produtos/${p.id}`, { ...produtoValido(), saldo: 999, versao: p.versao });
    assert.equal(r.status, 422);
    assert.equal((await admin.get(`/api/produtos/${p.id}`)).corpo.saldo, 30);
  });

  test('não exclui produto com movimentação', async () => {
    const p = await novoProduto();
    assert.equal((await admin.del(`/api/produtos/${p.id}?versao=${p.versao}`)).status, 422);
    const semUso = await novoProduto({ saldo_inicial: 0 });
    assert.equal((await admin.del(`/api/produtos/${semUso.id}?versao=${semUso.versao}`)).status, 200);
  });
});

describe('4-7. Pedidos de venda', () => {
  test('4. pedido com itens válidos: cálculo, aprovação automática e reserva', async () => {
    const c = await novoCliente({ limite_credito: 5000 });
    const p = await novoProduto({ preco_venda: 12.34, saldo_inicial: 100 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 3, desconto_pct: 5 }]);
    assert.equal(ped.status, 'RASCUNHO');
    assert.equal(ped.total_bruto, 37.02);
    assert.equal(ped.total_liquido, 35.17); // 37,02 × 0,95 = 35,169 → 35,17
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    assert.equal(env.corpo.status, 'APROVADO');
    assert.equal((await admin.get(`/api/produtos/${p.id}`)).corpo.reservado, 3);
  });

  test('preço enviado pelo cliente da API é ignorado (vem do cadastro)', async () => {
    const c = await novoCliente();
    const p = await novoProduto({ preco_venda: 50 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 1, preco_unitario: 0.01 }]);
    assert.equal(ped.itens[0].preco_unitario, 50);
  });

  test('5. acima do limite de crédito: política APROVACAO → pendente; REJEITAR → rejeitado', async () => {
    const c = await novoCliente({ limite_credito: 100 });
    const p = await novoProduto({ preco_venda: 80 });
    const p1 = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 2 }]);
    const r1 = await vendedor.post(`/api/pedidos/${p1.id}/enviar`, { versao: p1.versao });
    assert.equal(r1.corpo.status, 'PENDENTE_APROVACAO');
    assert.match(r1.corpo.motivo_status, /Limite de crédito excedido/);

    assert.equal((await admin.put('/api/parametros/ZZ_CREDPOL', { valor: 'REJEITAR' })).status, 200);
    const p2 = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 2 }]);
    const r2 = await vendedor.post(`/api/pedidos/${p2.id}/enviar`, { versao: p2.versao });
    assert.equal(r2.corpo.status, 'REJEITADO');
    await admin.put('/api/parametros/ZZ_CREDPOL', { valor: 'APROVACAO' });
  });

  test('desconto acima da alçada exige gerente; emissor não aprova o próprio pedido; acima do máximo é inválido', async () => {
    const c = await novoCliente();
    const p = await novoProduto();
    const invalido = await vendedor.post('/api/pedidos', { cliente_id: c.id, itens: [{ produto_id: p.id, quantidade: 1, desconto_pct: 40 }] });
    assert.equal(invalido.status, 422);
    const ped = await novoPedido(gerente, c.id, [{ produto_id: p.id, quantidade: 1, desconto_pct: 15 }]);
    const env = await gerente.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    assert.equal(env.corpo.status, 'PENDENTE_APROVACAO');
    const auto = await gerente.post(`/api/pedidos/${ped.id}/aprovar`, { versao: env.corpo.versao });
    assert.equal(auto.status, 403, 'segregação de funções');
    const ok = await admin.post(`/api/pedidos/${ped.id}/aprovar`, { versao: env.corpo.versao });
    assert.equal(ok.corpo.status, 'APROVADO');
  });

  test('6. rejeita envio com estoque insuficiente (considerando reservas)', async () => {
    const c = await novoCliente({ limite_credito: 100000 });
    const p = await novoProduto({ saldo_inicial: 10 });
    const a = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 8 }]);
    assert.equal((await vendedor.post(`/api/pedidos/${a.id}/enviar`, { versao: a.versao })).corpo.status, 'APROVADO');
    const b = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 5 }]);
    const r = await vendedor.post(`/api/pedidos/${b.id}/enviar`, { versao: b.versao });
    assert.equal(r.status, 422);
    assert.match(r.corpo.erro.mensagem, /Estoque insuficiente/);
    assert.equal((await vendedor.get(`/api/pedidos/${b.id}`)).corpo.status, 'RASCUNHO');
  });

  test('7. cancelamento libera reserva e impede faturamento; faturado não cancela', async () => {
    const c = await novoCliente();
    const p = await novoProduto({ saldo_inicial: 20 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 4 }]);
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    assert.equal((await admin.get(`/api/produtos/${p.id}`)).corpo.reservado, 4);
    // pedido já aprovado: o vendedor não cancela mais; quem aprova (gerente) cancela
    assert.equal((await vendedor.post(`/api/pedidos/${ped.id}/cancelar`, { versao: env.corpo.versao, motivo: 'Cliente desistiu' })).status, 403);
    const semMotivo = await gerente.post(`/api/pedidos/${ped.id}/cancelar`, { versao: env.corpo.versao, motivo: '' });
    assert.equal(semMotivo.status, 422);
    const can = await gerente.post(`/api/pedidos/${ped.id}/cancelar`, { versao: env.corpo.versao, motivo: 'Cliente desistiu' });
    assert.equal(can.corpo.status, 'CANCELADO');
    assert.equal((await admin.get(`/api/produtos/${p.id}`)).corpo.reservado, 0);
    const fat = await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: can.corpo.versao });
    assert.equal(fat.status, 422);
    assert.match(fat.corpo.erro.mensagem, /cancelado não pode ser faturado/);

    const ped2 = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 1 }]);
    const e2 = await vendedor.post(`/api/pedidos/${ped2.id}/enviar`, { versao: ped2.versao });
    const f2 = await gerente.post(`/api/pedidos/${ped2.id}/faturar`, { versao: e2.corpo.versao });
    assert.equal(f2.corpo.status, 'FATURADO');
    assert.equal((await vendedor.post(`/api/pedidos/${ped2.id}/cancelar`, { versao: f2.corpo.versao, motivo: 'Tentativa indevida' })).status, 422);
  });

  test('faturamento baixa estoque uma única vez, mesmo com requisições simultâneas', async () => {
    const c = await novoCliente({ cond_pagto: '003' });
    const p = await novoProduto({ saldo_inicial: 10 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 3 }]);
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    const tentativas = await Promise.all([1, 2, 3].map(() => gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.corpo.versao })));
    assert.equal(tentativas.filter((t) => t.status === 200).length, 1);
    assert.ok(tentativas.filter((t) => t.status !== 200).every((t) => t.status === 409));
    const prod = (await admin.get(`/api/produtos/${p.id}`)).corpo;
    assert.equal(prod.saldo, 7);
    assert.equal(prod.reservado, 0);
    const pedFinal = (await admin.get(`/api/pedidos/${ped.id}`)).corpo;
    assert.equal(pedFinal.titulos.length, 2, 'condição 30/60 gera 2 parcelas');
    assert.equal(Math.round(pedFinal.titulos.reduce((s, t) => s + t.valor, 0) * 100), Math.round(pedFinal.total_liquido * 100));
    const saidas = (await admin.get(`/api/estoque/movimentos?produto_id=${p.id}&origem=PEDIDO`)).corpo.itens;
    assert.equal(saidas.length, 1);
  });
});

describe('8. Estoque', () => {
  test('8. movimentação repetida com a mesma chave não duplica', async () => {
    const p = await novoProduto({ saldo_inicial: 10 });
    const corpo = { produto_id: p.id, tipo: 'E', quantidade: 5, motivo: 'Entrada por nota fiscal 123' };
    const h = { 'Idempotency-Key': 'mov-teste-00000001' };
    const r1 = await estoque.post('/api/estoque/movimentos', corpo, h);
    const r2 = await estoque.post('/api/estoque/movimentos', corpo, h);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r2.headers.get('idempotent-replay'), 'true');
    assert.equal(r1.corpo.id, r2.corpo.id);
    assert.equal((await admin.get(`/api/produtos/${p.id}`)).corpo.saldo, 15);
    const outra = await estoque.post('/api/estoque/movimentos', { ...corpo, quantidade: 6 }, h);
    assert.equal(outra.status, 422, 'mesma chave com outro conteúdo é recusada');
  });

  test('saída acima do disponível é bloqueada; política ZZ_ESTNEG libera', async () => {
    const p = await novoProduto({ saldo_inicial: 3 });
    const r = await estoque.post('/api/estoque/movimentos', { produto_id: p.id, tipo: 'S', quantidade: 4, motivo: 'Consumo interno' });
    assert.equal(r.status, 422);
    await admin.put('/api/parametros/ZZ_ESTNEG', { valor: 'S' });
    const ok = await estoque.post('/api/estoque/movimentos', { produto_id: p.id, tipo: 'S', quantidade: 4, motivo: 'Consumo interno' });
    await admin.put('/api/parametros/ZZ_ESTNEG', { valor: 'N' });
    assert.equal(ok.status, 201);
    assert.equal(ok.corpo.saldo_anterior, 3);
    assert.equal(ok.corpo.saldo_posterior, -1);
  });

  test('histórico é imutável no banco (trigger)', async () => {
    assert.throws(() => amb.db.prepare('UPDATE movimentos_estoque SET quantidade = 1').run(), /imutáveis/);
    assert.throws(() => amb.db.prepare('DELETE FROM movimentos_estoque').run(), /imutáveis/);
  });
});

describe('9. Financeiro', () => {
  test('9. liquidação duplicada é bloqueada (reenvio idempotente e segunda baixa)', async () => {
    const c = await novoCliente();
    const p = await novoProduto({ preco_venda: 100 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 1 }]);
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    const fat = await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.corpo.versao });
    const tit = fat.corpo.titulos[0];
    const hoje = new Date().toLocaleDateString('sv-SE');
    const h = { 'Idempotency-Key': 'baixa-teste-0001' };
    const t0 = (await financeiro.get(`/api/financeiro/titulos/${tit.id}`)).corpo;
    const b1 = await financeiro.post(`/api/financeiro/titulos/${tit.id}/liquidar`, { valor: 100, data: hoje, versao: t0.versao }, h);
    const b2 = await financeiro.post(`/api/financeiro/titulos/${tit.id}/liquidar`, { valor: 100, data: hoje, versao: t0.versao }, h);
    assert.equal(b1.status, 200);
    assert.equal(b1.corpo.situacao, 'LIQUIDADO');
    assert.equal(b2.headers.get('idempotent-replay'), 'true');
    const b3 = await financeiro.post(`/api/financeiro/titulos/${tit.id}/liquidar`, { valor: 100, data: hoje });
    assert.equal(b3.status, 409);
    assert.equal((await financeiro.get(`/api/financeiro/titulos/${tit.id}`)).corpo.baixas.length, 1);
  });

  test('baixa parcial, valor acima do saldo e data futura', async () => {
    const t = amb.db.prepare(`INSERT INTO titulos (tipo, numero, fornecedor_id, emissao, vencimento, valor_cent, saldo_cent, situacao)
      VALUES ('P', 'TST-1', 1, '2026-01-01', '2026-02-01', 10000, 10000, 'ABERTO')`).run();
    const id = t.lastInsertRowid;
    assert.equal((await financeiro.post(`/api/financeiro/titulos/${id}/liquidar`, { valor: 150, data: '2026-02-01' })).status, 422);
    assert.equal((await financeiro.post(`/api/financeiro/titulos/${id}/liquidar`, { valor: 10, data: '2999-01-01' })).status, 422);
    const parc = await financeiro.post(`/api/financeiro/titulos/${id}/liquidar`, { valor: 40, data: '2026-02-01' });
    assert.equal(parc.corpo.situacao, 'PARCIAL');
    assert.equal(parc.corpo.saldo, 60);
  });
});

describe('10. Permissões e acesso a registros', () => {
  test('10. perfis sem permissão recebem 403; sem sessão 401', async () => {
    const c = clienteValido();
    assert.equal((await consulta.post('/api/clientes', c)).status, 403);
    assert.equal((await vendedor.post('/api/estoque/movimentos', { produto_id: 1, tipo: 'E', quantidade: 1, motivo: 'teste x' })).status, 403);
    assert.equal((await vendedor.get('/api/financeiro/receber')).status, 403);
    assert.equal((await estoque.get('/api/pedidos')).status, 403);
    assert.equal((await vendedor.put('/api/parametros/ZZ_DESCMXV', { valor: '50' })).status, 403);
    assert.equal((await financeiro.post('/api/pedidos/1/aprovar', {})).status, 403);
    const anon = await fetch(amb.url + '/api/clientes');
    assert.equal(anon.status, 401);
  });

  test('vendedor não enxerga pedido de outro vendedor', async () => {
    const outro = await amb.sessao('vendedor2');
    const c = await novoCliente({ vendedor: 'vendedor2' });
    const p = await novoProduto();
    const ped = await novoPedido(outro, c.id, [{ produto_id: p.id, quantidade: 1 }]);
    assert.equal((await vendedor.get(`/api/pedidos/${ped.id}`)).status, 404);
    const lista = await vendedor.get('/api/pedidos?tamanho=100');
    assert.ok(lista.corpo.itens.every((x) => x.vendedor === 'vendedor'));
    assert.equal((await gerente.get(`/api/pedidos/${ped.id}`)).status, 200);
  });

  test('"continuar conectado": cookie de 30 dias; sem marcar, cookie de sessão; sessão devolve CSRF', async () => {
    const entrar = (lembrar) => fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'gerente', senha: 'Teste@123', lembrar }) });
    const comLembrar = await entrar(true);
    assert.match(comLembrar.headers.get('set-cookie'), /Max-Age=2592000/);
    const semLembrar = await entrar(false);
    assert.doesNotMatch(semLembrar.headers.get('set-cookie'), /Max-Age/, 'sem lembrar: cookie some ao fechar o navegador');
    // Navegador reaberto: só o cookie existe; /auth/sessao devolve o CSRF que permite gravar.
    const cookie = comLembrar.headers.get('set-cookie').split(';')[0];
    const sessao = await (await fetch(amb.url + '/api/auth/sessao', { headers: { Cookie: cookie } })).json();
    assert.equal(sessao.login, 'gerente');
    assert.ok(sessao.csrf);
    const grava = await fetch(amb.url + '/api/clientes', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': sessao.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(clienteValido()) });
    assert.equal(grava.status, 201);
  });

  test('mutação sem token CSRF é recusada', async () => {
    const r = await vendedor.bruto('POST', '/api/clientes', clienteValido(), { 'X-CSRF-Token': 'forjado' });
    assert.equal(r.status, 403);
  });

  test('login bloqueia após tentativas inválidas', async () => {
    const tentar = () => fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'consulta', senha: 'errada' }) });
    for (let i = 0; i < 5; i++) assert.equal((await tentar()).status, 401);
    assert.equal((await tentar()).status, 429);
  });
});

describe('Autocadastro de usuário', () => {
  const registrar = (corpo) => fetch(amb.url + '/api/auth/registrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });

  test('cria conta SEM_ACESSO (sem módulos), já autenticada, e ignora perfil enviado pelo cliente', async () => {
    const r = await registrar({ nome: 'Maria Teste', login: 'Maria.Teste', senha: 'segredo123', confirmacao: 'segredo123', perfil: 'ADMIN' });
    assert.equal(r.status, 201);
    const corpo = await r.json();
    assert.equal(corpo.usuario.login, 'Maria.Teste', 'maiúsculas são preservadas');
    // qualquer combinação de maiúsculas/minúsculas (e espaços nas pontas) entra no MESMO usuário
    for (const variante of ['maria.teste', 'MARIA.TESTE', 'mArIa.TeStE', '  Maria.Teste  ']) {
      const r2 = await fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: variante, senha: 'segredo123' }) });
      assert.equal(r2.status, 200, variante);
      assert.equal((await r2.json()).usuario.id, corpo.usuario.id, variante);
    }
    assert.equal(corpo.usuario.perfil, 'SEM_ACESSO', 'perfil enviado pelo cliente é ignorado');
    assert.deepEqual(corpo.usuario.permissoes, [], 'conta nova não tem nenhum módulo liberado');
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const sessao = await fetch(amb.url + '/api/auth/sessao', { headers: { Cookie: cookie } });
    assert.equal(sessao.status, 200);
    // pode entrar de novo com a senha criada, mas não tem permissão de escrita
    const login = await fetch(amb.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'maria.teste', senha: 'segredo123' }) });
    assert.equal(login.status, 200);
    const { csrf } = await login.json();
    const ck = login.headers.get('set-cookie').split(';')[0];
    const tenta = await fetch(amb.url + '/api/clientes', { method: 'POST', headers: { Cookie: ck, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(clienteValido()) });
    assert.equal(tenta.status, 403);
  });

  test('recusa login duplicado, senha fraca, confirmação diferente e dados inválidos', async () => {
    assert.equal((await registrar({ nome: 'Outro Admin', login: 'admin', senha: 'abcdef123' })).status, 409);
    assert.equal((await registrar({ nome: 'Outro Admin', login: 'ADMIN', senha: 'abcdef123' })).status, 409, 'maiúsculas não criam login duplicado');
    const espaco = await registrar({ nome: 'Joao Teste', login: 'joao silva', senha: 'segredo123' });
    assert.equal(espaco.status, 422);
    assert.equal((await espaco.json()).erro.detalhes.login, 'O usuário não pode conter espaço.');
    const fraca = await registrar({ nome: 'Joao Teste', login: 'joao', senha: 'abc' });
    assert.equal(fraca.status, 422);
    assert.ok((await fraca.json()).erro.detalhes.senha);
    assert.equal((await registrar({ nome: 'Joao Teste', login: 'joao', senha: 'somenteletras' })).status, 422);
    assert.equal((await registrar({ nome: 'Joao Teste', login: 'joao', senha: 'joao12345' })).status, 422, 'senha contém o login');
    assert.equal((await registrar({ nome: 'Joao Teste', login: 'joao', senha: 'segredo123', confirmacao: 'outra123' })).status, 422);
    assert.equal((await registrar({ nome: 'J', login: 'joão inválido', senha: 'segredo123' })).status, 422);
  });

  test('admin promove usuário; não pode rebaixar a si mesmo; não-admin não gerencia', async () => {
    await registrar({ nome: 'Pedro Teste', login: 'pedro', senha: 'segredo456' });
    const lista = (await admin.get('/api/usuarios')).corpo;
    const pedro = lista.find((u) => u.login === 'pedro');
    assert.equal(pedro.perfil, 'SEM_ACESSO');
    assert.equal((await admin.put(`/api/usuarios/${pedro.id}`, { perfil: 'VENDEDOR' })).status, 200);
    assert.equal((await admin.put(`/api/usuarios/${pedro.id}`, { perfil: 'SUPERUSER' })).status, 422);
    const eu = lista.find((u) => u.login === 'admin');
    assert.equal((await admin.put(`/api/usuarios/${eu.id}`, { perfil: 'CONSULTA' })).status, 422);
    assert.equal((await admin.put(`/api/usuarios/${eu.id}`, { ativo: false })).status, 422);
    assert.equal((await gerente.get('/api/usuarios')).status, 403);
    assert.equal((await gerente.put(`/api/usuarios/${pedro.id}`, { perfil: 'ADMIN' })).status, 403);
  });
});

describe('11. Dados inválidos na API', () => {
  test('11. JSON malformado, tipos errados, corpo grande, ids e ordenação maliciosos', async () => {
    assert.equal((await admin.bruto('POST', '/api/clientes', '{"razao_social":', {})).status, 400);
    assert.equal((await admin.bruto('POST', '/api/clientes', '[1,2]', {})).status, 400);
    const tipos = await admin.post('/api/clientes', { ...clienteValido(), razao_social: { $ne: 1 }, limite_credito: '1e400' });
    assert.equal(tipos.status, 422);
    const grande = await admin.post('/api/clientes', { ...clienteValido(), razao_social: 'x'.repeat(200 * 1024) });
    assert.equal(grande.status, 413);
    assert.equal((await admin.get('/api/clientes/1%20OR%201=1')).status, 404);
    const sqli = await admin.get("/api/clientes?ordem=codigo;DROP TABLE clientes&q=x' OR 'x'='x");
    assert.equal(sqli.status, 200);
    assert.equal(sqli.corpo.total, 0);
    assert.ok((await admin.get('/api/clientes')).corpo.total > 0, 'tabela intacta');
    const itens = await vendedor.post('/api/pedidos', { cliente_id: 1, itens: 'não é lista' });
    assert.equal(itens.status, 422);
    const xss = await admin.post('/api/clientes', clienteValido({ razao_social: '<img src=x onerror=alert(1)>' }));
    assert.equal(xss.status, 201, 'texto é aceito e armazenado literalmente; a interface o exibe como texto');
    assert.equal((await admin.get('/api/rota-inexistente')).status, 404);
  });

  test('CSV: BOM, separador ;, decimal com vírgula e neutralização de fórmula', async () => {
    await novoCliente({ razao_social: '=HYPERLINK("http://x")' });
    const r = await admin.get('/api/relatorios/pedidos_status?formato=csv');
    assert.equal(r.status, 200);
    assert.ok(r.corpo.startsWith('﻿') || r.corpo.startsWith('Pedido'), 'BOM UTF-8');
    assert.match(r.headers.get('content-type'), /text\/csv/);
    const { paraCsv } = require('../server/services/relatorios');
    const csv = paraCsv({ colunas: [{ chave: 'a', titulo: 'Nome' }, { chave: 'v', titulo: 'Valor', tipo: 'moeda' }], linhas: [{ a: '=SUM(1;2) "x"', v: 1234.5 }] });
    assert.equal(csv, '﻿Nome;Valor\r\n"\'=SUM(1;2) ""x""";1234,50\r\n');
  });
});

describe('12. Falhas de persistência', () => {
  test('12. falha no meio do faturamento faz rollback completo', async () => {
    const c = await novoCliente();
    const p = await novoProduto({ saldo_inicial: 10 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 2 }]);
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    // Simula falha do banco na última etapa (geração de títulos)
    amb.db.exec("CREATE TEMP TRIGGER falha_titulos BEFORE INSERT ON titulos BEGIN SELECT RAISE(ABORT, 'disco cheio (simulado)'); END;");
    const r = await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.corpo.versao });
    amb.db.exec('DROP TRIGGER falha_titulos');
    assert.equal(r.status, 500);
    assert.match(r.corpo.erro.mensagem, /Nenhuma alteração parcial foi gravada/);
    assert.ok(!/disco cheio/.test(JSON.stringify(r.corpo)), 'não vaza detalhe interno');
    const depois = (await admin.get(`/api/pedidos/${ped.id}`)).corpo;
    assert.equal(depois.status, 'APROVADO');
    const prod = (await admin.get(`/api/produtos/${p.id}`)).corpo;
    assert.equal(prod.saldo, 10);
    assert.equal(prod.reservado, 2);
    assert.equal((await admin.get(`/api/estoque/movimentos?produto_id=${p.id}&origem=PEDIDO`)).corpo.total, 0);
    // após a falha, a operação pode ser refeita normalmente
    const ok = await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.corpo.versao });
    assert.equal(ok.corpo.status, 'FATURADO');
  });
});

describe('Dashboard e relatórios', () => {
  test('indicadores refletem operações (sem números fixos)', async () => {
    const antes = (await admin.get('/api/painel-executivo')).corpo.indicadores;
    const c = await novoCliente();
    const p = await novoProduto({ preco_venda: 10 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 1 }]);
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.corpo.versao });
    const depois = (await admin.get('/api/painel-executivo')).corpo.indicadores;
    assert.equal(Math.round((depois.faturamento - antes.faturamento) * 100), 1000);
    assert.equal(Math.round((depois.receber_aberto - antes.receber_aberto) * 100), 1000);
  });

  test('painel executivo: itens vendidos, categorias e pedidos recentes', async () => {
    const antes = (await admin.get('/api/painel-executivo')).corpo;
    const c = await novoCliente();
    const p = await novoProduto({ preco_venda: 5 });
    const ped = await novoPedido(vendedor, c.id, [{ produto_id: p.id, quantidade: 3 }]);
    const env = await vendedor.post(`/api/pedidos/${ped.id}/enviar`, { versao: ped.versao });
    await gerente.post(`/api/pedidos/${ped.id}/faturar`, { versao: env.corpo.versao });
    const depois = (await admin.get('/api/painel-executivo')).corpo;
    assert.equal(depois.indicadores.itens_vendidos - antes.indicadores.itens_vendidos, 3);
    const k = depois.indicadores;
    assert.equal(k.ticket_medio, Math.round((k.faturamento / k.pedidos_faturados) * 100) / 100);
    const somaGrupos = depois.por_grupo.reduce((s, g) => s + g.quantidade, 0);
    assert.equal(Math.round(somaGrupos * 100), Math.round(k.itens_vendidos * 100), 'categorias somam os itens vendidos');
    assert.ok(depois.por_grupo.length <= 5);
    assert.equal(depois.pedidos_recentes[0].numero, ped.numero);
    // perfis operacionais não recebem os resultados estratégicos (nem a lista de pedidos que vem junto)
    assert.equal((await estoque.get('/api/painel-executivo')).status, 403);
    assert.equal((await vendedor.get('/api/painel-executivo')).status, 403);
  });

  test('todos os relatórios executam e validam período', async () => {
    const cat = (await admin.get('/api/relatorios')).corpo;
    assert.equal(cat.length, 6);
    for (const r of cat) assert.equal((await admin.get(`/api/relatorios/${r.id}`)).status, 200, r.id);
    assert.equal((await admin.get('/api/relatorios/vendas?de=2026-12-01&ate=2026-01-01')).status, 422);
  });
});
