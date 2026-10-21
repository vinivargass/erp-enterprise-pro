'use strict';
// Infraestrutura de testes: sobe a aplicação real (mesmo app.js) com banco SQLite em memória
// numa porta efêmera e fala com ela por HTTP, como o navegador faria.
const http = require('node:http');
const { abrir } = require('../server/db');
const { criarApp } = require('../server/app');
const { hashSenha } = require('../server/auth');
const base = require('../server/services/base');
const { dvCnpj, dvCpf } = require('../server/seed');

const SENHA = 'Teste@123';
let hashCache;

async function iniciar(opcoes = {}) {
  const db = abrir(':memory:');
  hashCache ||= hashSenha(SENHA);
  const insU = db.prepare('INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES (?,?,?,?)');
  for (const p of ['ADMIN', 'GERENTE', 'VENDEDOR', 'ESTOQUE', 'FINANCEIRO', 'CONSULTA']) insU.run(p.toLowerCase(), p, p, hashCache);
  insU.run('vendedor2', 'Outro vendedor', 'VENDEDOR', hashCache);
  const insP = db.prepare('INSERT INTO parametros (chave, valor, tipo, descricao) VALUES (?,?,?,?)');
  for (const p of base.PARAMETROS_PADRAO) insP.run(...p);
  db.prepare("INSERT INTO condicoes_pagamento VALUES ('001','À vista','0'), ('003','30/60','30,60')").run();
  db.prepare("INSERT INTO fornecedores (codigo, razao_social, documento) VALUES ('F1','Fornecedor Teste', ?)").run(dvCnpj('998877660001'));

  const servidor = http.createServer(criarApp({ db, ...opcoes }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}`;

  async function sessao(login) {
    const r = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, senha: SENHA }) });
    if (r.status !== 200) throw new Error(`login ${login} falhou: ${r.status}`);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const { csrf } = await r.json();
    const chamar = async (metodo, caminho, corpo, extras = {}) => {
      const headers = { Cookie: cookie, 'X-CSRF-Token': csrf, ...extras };
      if (corpo !== undefined) headers['Content-Type'] = 'application/json';
      const resp = await fetch(url + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
      const tipo = resp.headers.get('content-type') || '';
      return { status: resp.status, corpo: tipo.includes('json') ? await resp.json() : await resp.text(), headers: resp.headers };
    };
    return {
      get: (c) => chamar('GET', c), post: (c, b, h) => chamar('POST', c, b ?? {}, h), put: (c, b) => chamar('PUT', c, b),
      del: (c) => chamar('DELETE', c), bruto: chamar, cookie, csrf,
    };
  }

  return { db, url, sessao, fechar: () => new Promise((r) => servidor.close(r)) };
}

let seq = 0;
function clienteValido(extra = {}) {
  seq++;
  return {
    razao_social: `Cliente Teste ${seq} Ltda`, nome_fantasia: `Teste ${seq}`, tipo_pessoa: 'J',
    documento: dvCnpj(String(10000000 + seq).padStart(8, '0') + '0001'),
    cep: '01001-000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'São Paulo', uf: 'SP',
    email: `c${seq}@exemplo.com.br`, cond_pagto: '001', limite_credito: 10000, ...extra,
  };
}
function produtoValido(extra = {}) {
  seq++;
  return { codigo: `P${seq}`, descricao: `Produto teste ${seq}`, grupo: 'TST', unidade: 'UN', tipo: 'PA', preco_venda: 100, custo: 60, estoque_minimo: 5, saldo_inicial: 50, ...extra };
}

module.exports = { iniciar, clienteValido, produtoValido, dvCnpj, dvCpf };
