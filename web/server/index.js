'use strict';
// Ponto de entrada: `node server/index.js` (ou iniciar.cmd na raiz do projeto).
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { abrir } = require('./db');
const { criarApp, criarLog } = require('./app');
const { popular, SENHA_DEMO } = require('./seed');

const PORTA = Number(process.env.PORT) || 3000;
// ERP_PUBLICO=1: acesso pela internet via túnel HTTPS. Escuta só em 127.0.0.1 (o túnel é o único caminho de fora).
const PUBLICO = process.env.ERP_PUBLICO === '1';
const HOST = PUBLICO ? '127.0.0.1' : (process.env.HOST || '127.0.0.1'); // só aceita conexões locais por padrão
const dados = path.join(__dirname, '..', 'data');
fs.mkdirSync(dados, { recursive: true });

const arquivoDb = process.env.ERP_DB || path.join(dados, 'erp-demo.db');
if (process.argv.includes('--reset') && fs.existsSync(arquivoDb)) {
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivoDb + sufixo, { force: true });
}
const db = abrir(arquivoDb);
if (popular(db)) console.log('Banco de demonstração criado com dados fictícios.');

const app = criarApp({ db, publico: PUBLICO, log: criarLog(path.join(__dirname, '..', 'logs', PUBLICO ? 'app-publico.log' : 'app.log')) });
http.createServer(app).listen(PORTA, HOST, () => {
  console.log(`ERP Enterprise Pro (DEMONSTRAÇÃO) em http://localhost:${PORTA}`);
  if (HOST === '0.0.0.0') {
    const ips = Object.values(require('node:os').networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORTA}`);
    console.log(`Acesso pela rede local liberado: ${ips.join('  ')}`);
    console.log('ATENÇÃO: as senhas de demonstração são públicas; use só em rede de confiança.');
  }
  if (PUBLICO) console.log('Modo público: aguardando o túnel HTTPS (cookie Secure, sem acessos de demonstração na tela).');
  else console.log(`Usuários: admin, gerente, vendedor, estoque, financeiro, consulta — senha de demonstração: ${SENHA_DEMO}`);
});
