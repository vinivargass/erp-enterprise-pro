'use strict';
// Camada HTTP: roteamento REST, autenticação, autorização, idempotência e respostas.
// Responsabilidades separadas: auth.js (quem é), rotas (o que pode), services (regras), db (persistência).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AppError, erro } = require('./erros');
const { transacao } = require('./db');
const { criarAutenticador, exigir, listarUsuarios, alterarUsuario } = require('./auth');
const clientes = require('./services/clientes');
const produtos = require('./services/produtos');
const pedidos = require('./services/pedidos');
const estoque = require('./services/estoque');
const financeiro = require('./services/financeiro');
const dashboard = require('./services/dashboard');
const mesa = require('./services/mesa');
const relatorios = require('./services/relatorios');
const admin = require('./services/admin');
const base = require('./services/base');

const PUBLICO = path.join(__dirname, '..', 'public');
const MAX_CORPO = 100 * 1024;
const TIPOS_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// Rotas: [método, padrão, permissão | null (pública) | '' (só autenticado), handler, opções]
function rotas() {
  const r = [];
  const add = (m, p, perm, h, o = {}) => r.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), perm, h, o });

  add('GET', '/api/saude', null, () => ({ ok: true, modo: 'DEMONSTRACAO', persistencia: 'SQLite local (não é Protheus)' }));
  // Devolve também o token CSRF: com "continuar conectado", o navegador reaberto não tem mais o
  // CSRF guardado na aba (sessionStorage). Só a própria origem lê esta resposta (SameSite + sem CORS).
  add('GET', '/api/auth/sessao', '', (c) => ({ ...c.usuario, csrf: c.csrf }));

  // Página Início ("Minha mesa de trabalho"): dados PESSOAIS de qualquer usuário autenticado.
  // O serviço filtra tudo pelo usuário da sessão; nada da empresa é consultado aqui.
  add('GET', '/api/empresa', '', (c) => mesa.empresa(c));
  add('GET', '/api/mesa', '', (c) => mesa.mesa(c));
  add('POST', '/api/notas', '', (c, q, b) => mesa.criarNota(c, b), { status: 201 });
  add('PUT', '/api/notas/:id', '', (c, q, b, p) => mesa.alterarNota(c, p.id, b));
  add('DELETE', '/api/notas/:id', '', (c, q, b, p) => mesa.excluirNota(c, p.id));
  add('PUT', '/api/mesa/preferencias', '', (c, q, b) => mesa.salvarPreferencias(c, b));
  add('GET', '/api/tarefas', '', (c, q) => mesa.listar(c, q));
  add('POST', '/api/tarefas', '', (c, q, b) => mesa.criar(c, b), { status: 201 });
  add('PUT', '/api/tarefas/:id', '', (c, q, b, p) => mesa.alterar(c, p.id, b));
  add('POST', '/api/tarefas/:id/concluir', '', (c, q, b, p) => mesa.concluir(c, p.id, b));
  add('DELETE', '/api/tarefas/:id', '', (c, q, b, p) => mesa.excluir(c, p.id));
  // Resultados estratégicos: permissão explícita, conferida aqui antes de qualquer consulta.
  add('GET', '/api/painel-executivo', 'painel_executivo.ler', (c, q) => dashboard.resumo(c, q));
  add('GET', '/api/notificacoes', '', (c) => dashboard.alertas(c));

  add('GET', '/api/condicoes-pagamento', 'clientes.ler', (c) => clientes.condicoesPagamento(c));
  add('GET', '/api/clientes', 'clientes.ler', (c, q) => clientes.listar(c, q));
  add('POST', '/api/clientes', 'clientes.gravar', (c, q, b) => clientes.incluir(c, b), { status: 201, idem: true });
  add('GET', '/api/clientes/:id', 'clientes.ler', (c, q, b, p) => clientes.obter(c, p.id));
  add('PUT', '/api/clientes/:id', 'clientes.gravar', (c, q, b, p) => clientes.alterar(c, p.id, b));
  add('POST', '/api/clientes/:id/inativar', 'clientes.inativar', (c, q, b, p) => clientes.definirAtivo(c, p.id, false, b.versao));
  add('POST', '/api/clientes/:id/reativar', 'clientes.inativar', (c, q, b, p) => clientes.definirAtivo(c, p.id, true, b.versao));
  add('GET', '/api/clientes/:id/historico', 'clientes.ler', (c, q, b, p) => clientes.historico(c, p.id));
  add('GET', '/api/vendedores', 'clientes.carteira', (c) => clientes.vendedores(c));

  add('GET', '/api/produtos', 'produtos.ler', (c, q) => produtos.listar(c, q));
  add('GET', '/api/produtos-grupos', 'produtos.ler', (c) => produtos.grupos(c));
  add('POST', '/api/produtos', 'produtos.gravar', (c, q, b) => produtos.incluir(c, b), { status: 201, idem: true });
  add('GET', '/api/produtos/:id', 'produtos.ler', (c, q, b, p) => produtos.obter(c, p.id));
  add('PUT', '/api/produtos/:id', 'produtos.gravar', (c, q, b, p) => produtos.alterar(c, p.id, b));
  add('DELETE', '/api/produtos/:id', 'produtos.gravar', (c, q, b, p) => produtos.excluir(c, p.id, q.versao));

  add('GET', '/api/pedidos', 'pedidos.ler', (c, q) => pedidos.listar(c, q));
  add('POST', '/api/pedidos', 'pedidos.gravar', (c, q, b) => pedidos.criar(c, b), { status: 201, idem: true });
  add('GET', '/api/pedidos/:id', 'pedidos.ler', (c, q, b, p) => pedidos.obter(c, p.id));
  add('PUT', '/api/pedidos/:id', 'pedidos.gravar', (c, q, b, p) => pedidos.alterar(c, p.id, b));
  add('POST', '/api/pedidos/:id/enviar', 'pedidos.gravar', (c, q, b, p) => pedidos.enviar(c, p.id, b.versao));
  add('POST', '/api/pedidos/:id/aprovar', 'pedidos.aprovar', (c, q, b, p) => pedidos.aprovar(c, p.id, b.versao, b.observacao));
  add('POST', '/api/pedidos/:id/rejeitar', 'pedidos.aprovar', (c, q, b, p) => pedidos.rejeitar(c, p.id, b.versao, b.motivo));
  add('POST', '/api/pedidos/:id/cancelar', 'pedidos.gravar', (c, q, b, p) => pedidos.cancelar(c, p.id, b.versao, b.motivo));
  add('POST', '/api/pedidos/:id/faturar', 'pedidos.faturar', (c, q, b, p) => pedidos.faturar(c, p.id, b.versao), { idem: true });
  // Expedição: pedidos aprovados/faturados sem valores (perfil ESTOQUE).
  add('GET', '/api/expedicao', 'pedidos.expedicao', (c, q) => pedidos.expedicao(c, q));
  add('GET', '/api/expedicao/:id', 'pedidos.expedicao', (c, q, b, p) => pedidos.expedicaoDetalhe(c, p.id));

  add('GET', '/api/estoque/saldos', 'estoque.ler', (c, q) => estoque.saldos(c, q));
  add('GET', '/api/estoque/movimentos', 'estoque.ler', (c, q) => estoque.listarMovimentos(c, q));
  add('POST', '/api/estoque/movimentos', 'estoque.movimentar', (c, q, b, p, req) => estoque.movimentar(c, b, req.chaveIdem), { status: 201, idem: true });

  add('GET', '/api/financeiro/receber', 'financeiro.ler', (c, q) => financeiro.listar(c, 'R', q));
  add('GET', '/api/financeiro/pagar', 'financeiro.ler', (c, q) => financeiro.listar(c, 'P', q));
  add('GET', '/api/financeiro/titulos/:id', 'financeiro.ler', (c, q, b, p) => financeiro.obter(c, p.id));
  add('POST', '/api/financeiro/titulos/:id/liquidar', 'financeiro.liquidar', (c, q, b, p, req) => financeiro.liquidar(c, p.id, b, req.chaveIdem), { idem: true });
  add('PUT', '/api/financeiro/titulos/:id', 'financeiro.editar', (c, q, b, p) => financeiro.editar(c, p.id, b));

  add('GET', '/api/relatorios', 'relatorios.ler', (c) => relatorios.catalogo(c));
  add('GET', '/api/relatorios/:rel', 'relatorios.ler', (c, q, b, p) => relatorios.executar(c, p.rel, q));

  // Área administrativa (somente ADMIN; permissão lida do banco a cada requisição).
  // O painel administrativo também mostra faturamento, margem e títulos: exige ainda a permissão executiva.
  add('GET', '/api/admin/painel', 'admin.painel', (c, q) => { exigir(c.usuario, 'painel_executivo.ler'); return admin.painel(c, q); });
  add('GET', '/api/admin/vendas', 'admin.painel', (c, q) => { exigir(c.usuario, 'painel_executivo.ler'); return admin.vendasDetalhe(c, q); });
  add('GET', '/api/admin/usuarios', 'usuarios.gerir', (c, q) => admin.buscarUsuarios(c, q));
  add('POST', '/api/admin/usuarios/:id/conceder-admin', 'usuarios.gerir', (c, q, b, p) => admin.definirAdmin(c, p.id, true));
  add('POST', '/api/admin/usuarios/:id/remover-admin', 'usuarios.gerir', (c, q, b, p) => admin.definirAdmin(c, p.id, false));
  add('POST', '/api/admin/usuarios/:id/perfil', 'usuarios.gerir', (c, q, b, p) => admin.definirPerfil(c, p.id, b.perfil, b.adicionais));
  add('POST', '/api/admin/usuarios/:id/ativo', 'usuarios.gerir', (c, q, b, p) => admin.definirAtivo(c, p.id, b.ativo));
  add('DELETE', '/api/admin/usuarios/:id', 'usuarios.gerir', (c, q, b, p) => admin.excluirUsuario(c, p.id, b.confirmacao));
  add('GET', '/api/admin/perfis', 'usuarios.gerir', () => admin.catalogoPerfis());
  add('GET', '/api/admin/historico-perfis', 'usuarios.gerir', (c, q) => admin.historicoPerfis(c, q));

  add('GET', '/api/usuarios', 'usuarios.gerir', (c) => listarUsuarios(c.db));
  add('PUT', '/api/usuarios/:id', 'usuarios.gerir', (c, q, b, p) => {
    const r = transacao(c.db, () => {
      const res = alterarUsuario(c.db, c.usuario, p.id, b);
      base.auditar(c, 'USUARIO', Number(p.id), 'ALTERACAO', { login: res.login, de: res.antes, para: res.depois });
      return res;
    });
    return r.depois;
  });

  add('GET', '/api/parametros', 'parametros.ler', (c) => base.listarParametros(c));
  add('PUT', '/api/parametros/:chave', 'parametros.gravar', (c, q, b, p) => base.alterarParametro(c, p.chave, b.valor));
  add('GET', '/api/auditoria', 'auditoria.ler', (c, q) => {
    const pag = base.paginar(c, q);
    const itens = c.db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT ? OFFSET ?').all(pag.tamanho, pag.offset)
      .map((x) => ({ ...x, detalhes: JSON.parse(x.detalhes) }));
    return { itens, total: c.db.prepare('SELECT COUNT(*) n FROM auditoria').get().n, pagina: pag.pagina, tamanho: pag.tamanho };
  });
  return r;
}

// Cookie da sessão: persistente (Max-Age) só com "continuar conectado"; senão, cookie de sessão
// do navegador, apagado ao fechá-lo (o servidor ainda expira a sessão em 8 h).
// No modo público (acesso pela internet via túnel HTTPS) o cookie ganha "Secure": só trafega criptografado.
function cookieSessao(r, publico = false) {
  return `erp_sessao=${r.token}; HttpOnly; SameSite=Strict; Path=/${r.maxAge ? `; Max-Age=${r.maxAge}` : ''}${publico ? '; Secure' : ''}`;
}

function lerCookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    // Ao exceder o limite, descarta o restante (sem acumular em memória) e responde 413 no fim;
    // destruir o socket aqui impediria o cliente de receber a resposta de erro.
    req.on('data', (c) => {
      tam += c.length;
      if (tam <= MAX_CORPO) partes.push(c);
    });
    req.on('end', () => {
      if (tam > MAX_CORPO) reject(new AppError(413, 'CORPO_GRANDE', 'Requisição maior que o permitido.'));
      else resolve(Buffer.concat(partes).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// publico = true: servidor atrás de um túnel HTTPS (ex.: Cloudflare), escutando só em 127.0.0.1.
// Nesse modo: cookie Secure, IP do visitante lido do cabeçalho do túnel e tela de login sem os acessos de demonstração.
function criarApp({ db, agora = () => new Date(), log = criarLog(), maxCadastros, publico = false } = {}) {
  const autenticador = criarAutenticador(db, agora, maxCadastros ? { maxCadastros } : {});
  const tabela = rotas();
  // Só confia no cabeçalho do túnel no modo público, em que ninguém além do túnel alcança o servidor.
  const ipCliente = (req) => (publico && req.headers['cf-connecting-ip']) || req.socket.remoteAddress || '-';

  function enviarJson(res, status, obj, extras = {}) {
    const corpo = JSON.stringify(obj);
    res.writeHead(status, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras });
    res.end(corpo);
  }

  function servirEstatico(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const alvo = path.normalize(path.join(PUBLICO, rel));
    if (!alvo.startsWith(PUBLICO + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(alvo, (e, dados) => {
      if (e) { res.writeHead(404, CABECALHOS_SEGURANCA); res.end('Não encontrado'); return; }
      // Modo público: retira da página o bloco "Usuários de demonstração" (logins e senha pública).
      if (publico && rel === '/index.html') dados = Buffer.from(dados.toString('utf8').replace(/<details class="demo-acesso">[\s\S]*?<\/details>/, ''));
      res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': TIPOS_MIME[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(dados);
    });
  }

  async function tratar(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) { servirEstatico(req, res, url); return; }
    const inicio = Date.now();
    let usuarioLog = '-';
    try {
      const cookies = lerCookies(req);
      const metodo = req.method;
      const mutacao = !['GET', 'HEAD'].includes(metodo);
      let corpo = {};
      let bruto = '';
      if (mutacao) {
        bruto = await lerCorpo(req);
        if (bruto) {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw erro.requisicao('Content-Type deve ser application/json.');
          try { corpo = JSON.parse(bruto); } catch { throw erro.requisicao('JSON malformado.'); }
          if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw erro.requisicao('O corpo deve ser um objeto JSON.');
        }
      }

      // Login / logout tratados à parte (login é público).
      if (url.pathname === '/api/auth/login' && metodo === 'POST') {
        const r = autenticador.login(corpo.login, corpo.senha, corpo.lembrar === true);
        usuarioLog = r.usuario.login;
        base.auditar({ db, agora, usuario: r.usuario }, 'SESSAO', r.usuario.id, 'LOGIN', {});
        enviarJson(res, 200, { usuario: r.usuario, csrf: r.csrf }, {
          'Set-Cookie': cookieSessao(r, publico),
        });
        return;
      }

      // Autocadastro (público): cria conta CONSULTA e já abre a sessão.
      if (url.pathname === '/api/auth/registrar' && metodo === 'POST') {
        const r = autenticador.registrar(corpo, ipCliente(req));
        usuarioLog = r.usuario.login;
        base.auditar({ db, agora, usuario: r.usuario }, 'USUARIO', r.usuario.id, 'AUTOCADASTRO', { login: r.usuario.login, perfil: r.usuario.perfil });
        enviarJson(res, 201, { usuario: r.usuario, csrf: r.csrf }, {
          'Set-Cookie': cookieSessao(r, publico),
        });
        return;
      }

      const rota = tabela.find((x) => x.m === metodo && x.re.test(url.pathname));
      if (!rota) {
        const existe = tabela.some((x) => x.re.test(url.pathname));
        if (existe) throw new AppError(405, 'METODO', 'Método não permitido.');
        if (url.pathname !== '/api/auth/logout') throw erro.naoEncontrado('Recurso inexistente.');
      }

      let sessao = null;
      if (rota?.perm !== null) {
        sessao = autenticador.sessao(cookies.erp_sessao);
        if (!sessao) throw erro.naoAutenticado();
        usuarioLog = sessao.usuario.login;
        // CSRF: requisições que alteram dados precisam ecoar o token da sessão.
        if (mutacao) {
          const t = String(req.headers['x-csrf-token'] || '');
          if (t.length !== sessao.csrf.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(sessao.csrf))) {
            throw erro.proibido('Token CSRF ausente ou inválido.');
          }
        }
      }
      if (url.pathname === '/api/auth/logout') {
        autenticador.logout(cookies.erp_sessao);
        enviarJson(res, 200, { ok: true }, { 'Set-Cookie': `erp_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publico ? '; Secure' : ''}` });
        return;
      }
      if (rota.perm) {
        try {
          exigir(sessao.usuario, rota.perm);
        } catch (e) {
          // Falha de autorização fica na trilha (quem, rota, permissão exigida). Sem dados do corpo.
          try {
            base.auditar({ db, agora, usuario: sessao.usuario }, 'ACESSO', null, 'ACESSO_NEGADO',
              { metodo, rota: url.pathname, permissao: rota.perm, perfil: sessao.usuario.perfil });
          } catch { /* a auditoria não pode mascarar o 403 */ }
          throw e;
        }
      }

      const ctx = { db, agora, usuario: sessao ? sessao.usuario : { id: 0, login: 'anonimo', perfil: 'CONSULTA' }, csrf: sessao?.csrf };
      const query = Object.fromEntries(url.searchParams);
      const params = rota.re.exec(url.pathname).groups || {};
      for (const k of Object.keys(params)) params[k] = decodeURIComponent(params[k]);
      if (params.id !== undefined && !/^\d{1,10}$/.test(params.id)) throw erro.naoEncontrado();

      // Exportação CSV de relatório (mesma rota, sufixo .csv)
      if (rota.perm === 'relatorios.ler' && query.formato === 'csv' && params.rel) {
        const rel = relatorios.executar(ctx, params.rel, query);
        res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${params.rel}_${base.hoje(ctx)}.csv"` });
        res.end(relatorios.paraCsv(rel));
        return;
      }

      // Idempotência: mesma chave + mesmo corpo => devolve a resposta original sem reprocessar.
      const chaveIdem = req.headers['idempotency-key'];
      if (chaveIdem !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(chaveIdem)) throw erro.requisicao('Idempotency-Key inválida (8 a 64 caracteres alfanuméricos).');
      const reqInfo = { chaveIdem };
      if (rota.o.idem && chaveIdem) {
        const hash = crypto.createHash('sha256').update(bruto).digest('hex');
        const rotaChave = `${metodo} ${url.pathname}`;
        const salvo = db.prepare('SELECT * FROM idempotencia WHERE usuario_id = ? AND chave = ?').get(ctx.usuario.id, chaveIdem);
        if (salvo) {
          if (salvo.rota !== rotaChave || salvo.hash_corpo !== hash) throw erro.validacao('Idempotency-Key reutilizada com outra requisição.');
          enviarJson(res, salvo.status_http, JSON.parse(salvo.resposta), { 'Idempotent-Replay': 'true' });
          return;
        }
        const resultado = transacao(db, () => {
          const r = rota.h(ctx, query, corpo, params, reqInfo);
          db.prepare('INSERT INTO idempotencia (chave, usuario_id, rota, hash_corpo, status_http, resposta, criado_em) VALUES (?,?,?,?,?,?,?)')
            .run(chaveIdem, ctx.usuario.id, rotaChave, hash, rota.o.status || 200, JSON.stringify(r), base.agoraIso(ctx));
          return r;
        });
        enviarJson(res, rota.o.status || 200, resultado);
        return;
      }

      const resultado = rota.h(ctx, query, corpo, params, reqInfo);
      enviarJson(res, rota.o.status || 200, resultado);
    } catch (e) {
      if (e instanceof AppError) {
        enviarJson(res, e.status, { erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } });
      } else {
        const id = crypto.randomUUID();
        log('ERRO', { id, metodo: req.method, rota: url.pathname, usuario: usuarioLog, mensagem: e.message, pilha: e.stack });
        enviarJson(res, 500, { erro: { codigo: 'ERRO_INTERNO', mensagem: `Falha interna ao processar a operação. Nenhuma alteração parcial foi gravada. Código de rastreio: ${id}` } });
      }
    } finally {
      if (res.statusCode >= 400 || req.method !== 'GET') {
        log('REQ', { metodo: req.method, rota: url.pathname, status: res.statusCode, usuario: usuarioLog, ms: Date.now() - inicio });
      }
      // Modo WAL: gravações ficam primeiro em erp-demo.db-wal. O checkpoint copia para o
      // erp-demo.db, para que ferramentas que abrem só o .db (visualizadores, cópias) vejam
      // os dados recentes. PASSIVE não bloqueia leitores; se algum estiver ativo, conclui depois.
      if (req.method !== 'GET' && res.statusCode < 400) {
        try { db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get(); } catch { /* banco em memória (testes) ou ocupado */ }
      }
    }
  }

  return tratar;
}

function criarLog(arquivo) {
  if (!arquivo) return () => {};
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  return (nivel, dados) => {
    fs.appendFile(arquivo, JSON.stringify({ ts: new Date().toISOString(), nivel, ...dados }) + '\n', () => {});
  };
}

module.exports = { criarApp, criarLog };
