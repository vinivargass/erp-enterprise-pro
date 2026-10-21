'use strict';
// Testes do MODO PÚBLICO (acesso pela internet via túnel HTTPS).
// Banco SQLite EM MEMÓRIA: nenhuma conta real é alterada.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./apoio');

const registrar = (url, login, ip) => fetch(url + '/api/auth/registrar', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
  body: JSON.stringify({ nome: 'Pessoa ' + login, login, senha: 'Segura2026' }),
});

describe('Modo público', () => {
  let pub; let normal;
  before(async () => {
    pub = await iniciar({ publico: true, maxCadastros: 2 });
    normal = await iniciar({ maxCadastros: 2 });
  });
  after(async () => { await pub.fechar(); await normal.fechar(); });

  test('tela de login sem os acessos de demonstração', async () => {
    const html = await (await fetch(pub.url + '/')).text();
    assert.ok(!html.includes('demo-acesso') && !html.includes('Demo@2026'), 'bloco de demonstração removido');
    assert.ok(html.includes('id="form-login"'), 'formulário de login continua');
    assert.ok((await (await fetch(normal.url + '/')).text()).includes('demo-acesso'), 'modo normal mantém o bloco');
  });

  test('cookie de sessão com Secure só no modo público', async () => {
    const r1 = await registrar(pub.url, 'pubcookie', '203.0.113.9');
    assert.equal(r1.status, 201);
    assert.match(r1.headers.get('set-cookie'), /; Secure/);
    const r2 = await registrar(normal.url, 'normalcookie');
    assert.equal(r2.status, 201);
    assert.doesNotMatch(r2.headers.get('set-cookie'), /Secure/);
  });

  test('limite de cadastros vale por visitante (IP informado pelo túnel)', async () => {
    assert.equal((await registrar(pub.url, 'visa1', '198.51.100.1')).status, 201);
    assert.equal((await registrar(pub.url, 'visa2', '198.51.100.1')).status, 201);
    assert.equal((await registrar(pub.url, 'visa3', '198.51.100.1')).status, 429, 'mesmo visitante atinge o limite');
    assert.equal((await registrar(pub.url, 'visb1', '198.51.100.2')).status, 201, 'outro visitante não é afetado');
  });

  test('modo normal ignora o cabeçalho do túnel (não pode ser forjado para burlar o limite)', async () => {
    assert.equal((await registrar(normal.url, 'forja1', '10.0.0.1')).status, 201);
    assert.equal((await registrar(normal.url, 'forja2', '10.0.0.2')).status, 429);
  });
});
