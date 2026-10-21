// Inicialização: login, layout (menu, cabeçalho, notificações), roteamento por hash.
import { api, get, post, definirCsrf, quandoSessaoExpirar } from './api.js';
import { h, s, toast, falha, carregando } from './ui.js';
import * as dashboard from './paginas/dashboard.js';
import * as clientes from './paginas/clientes.js';
import * as produtos from './paginas/produtos.js';
import * as pedidos from './paginas/pedidos.js';
import * as estoque from './paginas/estoque.js';
import * as financeiro from './paginas/financeiro.js';
import * as relatorios from './paginas/relatorios.js';
import * as configuracoes from './paginas/configuracoes.js';
import * as adminPainel from './paginas/admin-painel.js';
import * as adminUsuarios from './paginas/admin-usuarios.js';
import * as adminExcluir from './paginas/admin-excluir.js';
import { montarIlustracao } from './ilustracao-login.js';

// Ícones de traço fino (estilo da referência)
const icone = (d) => s('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true' },
  s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
const MENU = [
  { grupo: 'Visão geral' },
  { rota: 'dashboard', rotulo: 'Visão geral', perm: 'dashboard.ler', ic: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { grupo: 'Cadastros' },
  { rota: 'clientes', rotulo: 'Clientes', perm: 'clientes.ler', ic: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.6-3.6 3.6-6 7.5-6s6.9 2.4 7.5 6' },
  { rota: 'produtos', rotulo: 'Produtos', perm: 'produtos.ler', ic: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12v9m0-9 8-4.5M12 12 4 7.5' },
  { grupo: 'Operações' },
  { rota: 'pedidos', rotulo: 'Pedidos de venda', perm: 'pedidos.ler', ic: 'M7 3h8l4 4v14H7zM15 3v4h4M10 11h6M10 15h6M10 19h3' },
  { rota: 'estoque', rotulo: 'Estoque', perm: 'estoque.ler', ic: 'M3.5 8 12 3.8 20.5 8v8.6L12 21l-8.5-4.4zM3.5 8 12 12.4 20.5 8M12 12.4V21M7.8 5.9l8.5 4.4' },
  { rota: 'financeiro/receber', rotulo: 'Contas a receber', perm: 'financeiro.ler', ic: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM14.6 9.3c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 1.9s1 1.6 2.6 2 2.6.9 2.6 2-1.1 1.9-2.6 1.9c-1.3 0-2.3-.6-2.7-1.6M12 6.3v1.6m0 8.2v1.6' },
  { rota: 'financeiro/pagar', rotulo: 'Contas a pagar', perm: 'financeiro.ler', ic: 'M4 7.5h15.5v11.5H5a1 1 0 0 1-1-1V6.2A1.7 1.7 0 0 1 5.7 4.5H17v3M15.5 13.2h1.5' },
  { grupo: 'Gestão' },
  { rota: 'relatorios', rotulo: 'Relatórios', perm: 'relatorios.ler', ic: 'M5 20v-7M10 20V6M15 20v-9M20 20V9M3 20h18' },
  { rota: 'configuracoes', rotulo: 'Parâmetros e auditoria', perm: 'parametros.ler', ic: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.2 13.6l1.6 1.2-1.8 3.1-1.9-.7a7.6 7.6 0 0 1-1.8 1l-.3 2h-3.6l-.3-2a7.6 7.6 0 0 1-1.8-1l-1.9.7-1.8-3.1 1.6-1.2a7.4 7.4 0 0 1 0-2.2L3.2 9.2 5 6.1l1.9.7a7.6 7.6 0 0 1 1.8-1l.3-2h3.6l.3 2a7.6 7.6 0 0 1 1.8 1l1.9-.7 1.8 3.1-1.6 1.2a7.4 7.4 0 0 1 0 2.2z' },
  { grupo: 'Administração' },
  { rota: 'admin/painel', rotulo: 'Painel administrativo', perm: 'admin.painel', ic: 'M4 4v16h16M8 15l3.2-4 3 2.4L19 7.5' },
  { rota: 'admin/usuarios', rotulo: 'Usuários e perfis', perm: 'usuarios.gerir', ic: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.4-3 2.8-5 6-5s5.6 2 6 5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.4c1.7.7 2.8 2.4 3 4.6' },
];

const PAGINAS = [
  [/^dashboard$/, dashboard.render, ['Visão geral']],
  [/^clientes$/, clientes.render, ['Cadastros', 'Clientes']],
  [/^produtos$/, produtos.render, ['Cadastros', 'Produtos']],
  [/^pedidos$/, pedidos.renderLista, ['Operações', 'Pedidos de venda']],
  [/^pedidos\/novo$/, pedidos.renderEdicao, ['Operações', ['Pedidos de venda', '#/pedidos'], 'Novo pedido']],
  [/^pedidos\/(\d+)$/, pedidos.renderDetalhe, ['Operações', ['Pedidos de venda', '#/pedidos'], 'Pedido']],
  [/^pedidos\/(\d+)\/editar$/, pedidos.renderEdicao, ['Operações', ['Pedidos de venda', '#/pedidos'], 'Editar pedido']],
  [/^estoque$/, estoque.render, ['Operações', 'Estoque']],
  [/^financeiro\/(receber|pagar)$/, financeiro.render, ['Financeiro']],
  [/^relatorios$/, relatorios.render, ['Gestão', 'Relatórios']],
  [/^configuracoes$/, configuracoes.render, ['Gestão', 'Parâmetros e auditoria']],
  // Área administrativa: a rota existe para todos, mas a página só exibe dados se o servidor autorizar
  // (acesso direto por URL sem permissão mostra "Acesso restrito" e fica registrado na auditoria).
  [/^admin\/painel$/, adminPainel.render, ['Administração', 'Painel administrativo']],
  [/^admin\/usuarios$/, adminUsuarios.render, ['Administração', 'Usuários e perfis']],
  [/^admin\/excluir$/, adminExcluir.render, ['Administração', 'Excluir usuários']],
];

let usuario = null;
const $ = (id) => document.getElementById(id);

function contexto(params, query) {
  return {
    usuario, params, query,
    pode: (p) => usuario.permissoes.includes(p),
    navegar: (rota) => { location.hash = rota; },
    migalhas: definirMigalhas,
    atualizarNotificacoes,
  };
}

function definirMigalhas(itens) {
  $('migalhas').replaceChildren(h('li', {}, h('a', { href: '#/dashboard' }, 'Início')),
    ...itens.map((it, i) => h('li', {}, Array.isArray(it) ? h('a', { href: it[1] }, it[0])
      : h('span', { 'aria-current': i === itens.length - 1 ? 'page' : null }, it))));
}

async function rotear() {
  // Trocar de página (menu, Voltar do navegador ou URL) fecha janelas modais que tenham ficado abertas.
  $('modal-raiz').replaceChildren();
  if (!usuario) return;
  const [caminho, qs] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const alvo = PAGINAS.find(([re]) => re.test(caminho));
  const conteudo = $('conteudo');
  for (const a of $('menu').querySelectorAll('a')) {
    a.toggleAttribute('aria-current', caminho === a.dataset.rota || caminho.startsWith(a.dataset.rota + '/'));
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  }
  $('app').classList.remove('menu-aberto');
  if (!alvo) { definirMigalhas(['Página não encontrada']); conteudo.replaceChildren(h('div', { class: 'estado' }, 'Página não encontrada. ', h('a', { href: '#/dashboard' }, 'Voltar ao início'))); return; }
  const [re, render, migalhas] = alvo;
  const params = caminho.match(re).slice(1);
  definirMigalhas(migalhas);
  conteudo.replaceChildren(carregando());
  try {
    const el = await render(contexto(params, query));
    if (el) conteudo.replaceChildren(el);
  } catch (e) {
    conteudo.replaceChildren(falha(e, rotear));
  }
  conteudo.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function montarMenu() {
  const itens = [];
  let grupoPendente = null;
  for (const m of MENU) {
    if (m.grupo) { grupoPendente = m.grupo; continue; }
    if (!usuario.permissoes.includes(m.perm)) continue;
    if (grupoPendente) { itens.push(h('div', { class: 'grupo' }, grupoPendente)); grupoPendente = null; }
    itens.push(h('a', { href: '#/' + m.rota, dataset: { rota: m.rota }, title: m.rotulo }, icone(m.ic), h('span', { class: 'rotulo' }, m.rotulo)));
  }
  $('menu').replaceChildren(...itens);
}

async function atualizarNotificacoes() {
  try {
    const alertas = await get('/api/notificacoes');
    const c = $('notif-contador');
    c.hidden = !alertas.length;
    c.textContent = alertas.length > 9 ? '9+' : String(alertas.length);
    $('btn-notif').setAttribute('aria-label', `Notificações (${alertas.length})`);
    $('painel-notif').replaceChildren(h('h2', {}, 'Alertas operacionais'),
      alertas.length ? h('ul', { class: 'lista-simples' }, alertas.map((a) => h('li', {},
        h('span', { class: `ic-nivel ${a.nivel}`, 'aria-label': a.nivel === 'critico' ? 'Crítico' : 'Atenção' }, '!'),
        h('a', { href: a.rota, onclick: () => fecharNotif() }, a.texto)))) : h('p', { class: 'muted' }, 'Nenhum alerta no momento.'));
  } catch { /* notificações são acessórias; falha silenciosa não bloqueia a tela */ }
}
function fecharNotif() { $('painel-notif').hidden = true; $('btn-notif').setAttribute('aria-expanded', 'false'); }

// Ilustração decorativa do login: montada só enquanto a tela de login está visível.
let desmontarIlustracao = null;
function pararIlustracao() { desmontarIlustracao?.(); desmontarIlustracao = null; }

function entrar(u) {
  usuario = u;
  pararIlustracao();
  $('tela-login').hidden = true;
  $('app').hidden = false;
  $('usuario-nome').textContent = u.nome;
  $('usuario-perfil').textContent = ({ ADMIN: 'Administrador', GERENTE: 'Gerente', VENDEDOR: 'Vendedor', ESTOQUE: 'Estoque', FINANCEIRO: 'Financeiro', CONSULTA: 'Consulta' })[u.perfil] || u.perfil;
  $('avatar').textContent = u.nome.split(' ').map((p) => p[0]).slice(0, 2).join('');
  montarMenu();
  atualizarNotificacoes();
  rotear();
}

function mostrarLogin(msg) {
  usuario = null;
  $('app').hidden = true;
  $('tela-login').hidden = false;
  pararIlustracao();
  desmontarIlustracao = montarIlustracao(document.querySelector('#tela-login .lum-metricas'));
  alternarFormAcesso('login');
  $('erro-login').textContent = msg || '';
  const fl = $('form-login');
  (fl.login.value ? fl.senha : fl.login).focus();
}

// Botão "olho" dos campos de senha: alterna entre mostrar e ocultar o que foi digitado.
const ICONE_OLHO = 'M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z';
const ICONE_OLHO_FECHADO = 'M2.3 3.7 3.7 2.3l18 18-1.4 1.4-3.3-3.3A11.7 11.7 0 0 1 12 19C6.5 19 2.7 14.6 1.5 12a14 14 0 0 1 4.3-5.2zM12 5c5.5 0 9.3 4.4 10.5 7a13.5 13.5 0 0 1-3.2 4.3l-3.4-3.4A4.5 4.5 0 0 0 11.1 7.6L8.9 5.4A11 11 0 0 1 12 5zm-4.4 5a4.5 4.5 0 0 0 6.4 6.4l-1.5-1.5a2.5 2.5 0 0 1-3.4-3.4z';

function desenharOlho(botao, visivel) {
  botao.replaceChildren(s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' },
    s('path', { d: visivel ? ICONE_OLHO_FECHADO : ICONE_OLHO, fill: 'currentColor' })));
  botao.setAttribute('aria-pressed', String(visivel));
  botao.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
  botao.title = visivel ? 'Ocultar senha' : 'Mostrar senha';
}

function iniciarOlhos() {
  for (const botao of document.querySelectorAll('.olho')) {
    const campo = $(botao.getAttribute('aria-controls'));
    desenharOlho(botao, false);
    botao.addEventListener('click', () => {
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      desenharOlho(botao, mostrar);
      campo.focus();
    });
  }
}

// Volta todos os campos de senha para o modo oculto (ao trocar de tela ou sair).
function ocultarSenhas() {
  for (const botao of document.querySelectorAll('.olho')) {
    $(botao.getAttribute('aria-controls')).type = 'password';
    desenharOlho(botao, false);
  }
}

function alternarFormAcesso(qual) {
  ocultarSenhas();
  $('form-login').hidden = qual !== 'login';
  $('form-registro').hidden = qual !== 'registro';
  const f = $(qual === 'login' ? 'form-login' : 'form-registro');
  (qual === 'login' ? f.login : f.nome).focus();
}

// Mesmas regras do servidor (auth.js), apenas para orientar enquanto a pessoa digita.
function errosRegistro(f) {
  const e = {};
  const login = f.login.value.trim();
  if (f.nome.value.trim().length < 3) e.nome = 'Informe o nome completo.';
  const avisoLogin = problemaLogin(login);
  if (avisoLogin) e.login = avisoLogin;
  const s = f.senha.value;
  if (s.length < 8) e.senha = 'A senha deve ter pelo menos 8 caracteres.';
  else if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) e.senha = 'A senha deve conter letras e números.';
  else if (login && s.toLowerCase().includes(login.toLowerCase())) e.senha = 'A senha não pode conter o login.';
  if (f.confirmacao.value !== s) e.confirmacao = 'As senhas não conferem.';
  return e;
}

// Aviso do campo usuário (o espaço é aceito na digitação, mas avisado e recusado no envio).
function problemaLogin(login) {
  if (/\s/.test(login)) return 'O usuário não pode conter espaço.';
  if (login.length > 0 && login.length < 3) return 'O usuário deve ter pelo menos 3 caracteres.';
  if (login && !/^[A-Za-z0-9._-]+$/.test(login)) return 'Use letras, números, ponto, hífen ou sublinhado (sem acentos).';
  if (!login) return 'Informe o usuário.';
  return null;
}

function mostrarErrosRegistro(f, erros) {
  const DICA = 'Mínimo de 8 caracteres, com letras e números, sem conter o login.';
  for (const campo of ['nome', 'login', 'senha', 'confirmacao']) {
    const msg = erros[campo] || '';
    $('r-' + campo).textContent = msg || (campo === 'senha' ? DICA : '');
    $('r-' + campo).classList.toggle('dica-senha', campo === 'senha' && !msg);
    f[campo].toggleAttribute('aria-invalid', !!msg);
    if (msg) f[campo].setAttribute('aria-invalid', 'true');
  }
  const primeiro = ['nome', 'login', 'senha', 'confirmacao'].find((c) => erros[c]);
  if (primeiro) f[primeiro].focus();
  return !!primeiro;
}

// Escolha de tema no menu do usuário (Claro, Escuro, Sistema). A aplicação e a gravação ficam em js/tema.js.
function iniciarTema() {
  const botoes = [...document.querySelectorAll('.tema-opcoes [data-tema]')];
  const marcar = () => {
    const pref = window.ERPTema ? window.ERPTema.preferencia() : 'dark';
    for (const b of botoes) b.setAttribute('aria-pressed', String(b.dataset.tema === pref));
  };
  for (const b of botoes) b.addEventListener('click', () => window.ERPTema?.definir(b.dataset.tema));
  document.addEventListener('tema-mudou', marcar);
  marcar();
}

// ---------- Busca geral do cabeçalho ----------
// Leva às páginas do menu (respeitando permissões) e busca o termo nas telas que já têm pesquisa.
const normalizarBusca = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function resultadosBusca(termo) {
  const t = normalizarBusca(termo);
  if (!usuario || !t) return [];
  const r = [];
  for (const m of MENU) {
    if (m.rota && usuario.permissoes.includes(m.perm) && normalizarBusca(m.rotulo).includes(t)) r.push({ rotulo: m.rotulo, dica: 'Abrir página', destino: '#/' + m.rota });
  }
  if (t.length >= 2) {
    const bruto = termo.trim().slice(0, 60);
    const q = encodeURIComponent(bruto);
    if (usuario.permissoes.includes('clientes.ler')) r.push({ rotulo: `Clientes: “${bruto}”`, dica: 'Pesquisar em clientes', destino: `#/clientes?q=${q}` });
    if (usuario.permissoes.includes('produtos.ler')) r.push({ rotulo: `Produtos: “${bruto}”`, dica: 'Pesquisar em produtos', destino: `#/produtos?q=${q}` });
    if (usuario.permissoes.includes('pedidos.ler')) r.push({ rotulo: `Pedidos: “${bruto}”`, dica: 'Pesquisar em pedidos', destino: `#/pedidos?q=${q}` });
  }
  return r.slice(0, 8);
}
function iniciarBusca() {
  const campo = $('busca-global'); const lista = $('busca-resultados');
  let itens = []; let ativo = -1;
  const fechar = () => { lista.hidden = true; campo.setAttribute('aria-expanded', 'false'); campo.removeAttribute('aria-activedescendant'); ativo = -1; };
  const ir = (it) => { campo.value = ''; itens = []; fechar(); location.hash = it.destino; };
  const desenhar = () => {
    lista.replaceChildren(...itens.map((it, i) => h('li', { role: 'option', id: 'busca-op-' + i, 'aria-selected': String(i === ativo),
      onmousedown: (ev) => { ev.preventDefault(); ir(it); } }, h('span', {}, it.rotulo), h('small', {}, it.dica))));
    lista.hidden = !itens.length;
    campo.setAttribute('aria-expanded', String(!!itens.length));
    if (ativo >= 0) campo.setAttribute('aria-activedescendant', 'busca-op-' + ativo); else campo.removeAttribute('aria-activedescendant');
  };
  campo.addEventListener('input', () => { itens = resultadosBusca(campo.value); ativo = itens.length ? 0 : -1; desenhar(); });
  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' && itens.length) { ativo = (ativo + 1) % itens.length; desenhar(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp' && itens.length) { ativo = (ativo - 1 + itens.length) % itens.length; desenhar(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && itens[ativo]) { ev.preventDefault(); ir(itens[ativo]); }
    else if (ev.key === 'Escape') fechar();
  });
  campo.addEventListener('blur', () => setTimeout(fechar, 120));
}

// ---------- Menu do usuário (nome + perfil + sair) ----------
function iniciarMenuUsuario() {
  const menu = $('menu-usuario'); const botao = $('btn-usuario');
  const fechar = () => { menu.hidden = true; botao.setAttribute('aria-expanded', 'false'); };
  botao.addEventListener('click', (ev) => { ev.stopPropagation(); menu.hidden = !menu.hidden; botao.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) $('btn-sair').focus(); });
  document.addEventListener('click', (ev) => { if (!menu.hidden && !ev.target.closest('.usuario')) fechar(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !menu.hidden) { fechar(); botao.focus(); } });
}

async function iniciar() {
  iniciarTema();
  quandoSessaoExpirar(() => { if (usuario) { toast('Sua sessão expirou. Entre novamente.', 'alerta'); mostrarLogin(); } });
  let recolhido = false;
  try { recolhido = localStorage.getItem('menuRecolhido') === '1'; } catch { /* ignora */ }
  $('app').classList.toggle('recolhido', recolhido);
  $('btn-menu').addEventListener('click', () => {
    const app = $('app');
    if (matchMedia('(max-width: 900px)').matches) { app.classList.toggle('menu-aberto'); return; }
    app.classList.toggle('recolhido');
    const r = app.classList.contains('recolhido');
    $('btn-menu').setAttribute('aria-expanded', String(!r));
    try { localStorage.setItem('menuRecolhido', r ? '1' : '0'); } catch { /* ignora */ }
  });
  $('btn-notif').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const p = $('painel-notif');
    p.hidden = !p.hidden;
    $('btn-notif').setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) atualizarNotificacoes();
  });
  document.addEventListener('click', (ev) => { if (!$('painel-notif').hidden && !ev.target.closest('.notif')) fecharNotif(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fecharNotif(); });
  $('btn-sair').addEventListener('click', async () => { try { await post('/api/auth/logout'); } catch { /* ignora */ } definirCsrf(''); mostrarLogin(); });
  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.classList.add('enviando'); // indicador de carregamento (spinner)
    btn.setAttribute('aria-busy', 'true');
    $('erro-login').textContent = '';
    try {
      const r = await api('POST', '/api/auth/login', { login: f.login.value.trim(), senha: f.senha.value, lembrar: f.lembrar.checked });
      ocultarSenhas();
      definirCsrf(r.csrf);
      f.senha.value = '';
      if (location.hash === '' || location.hash === '#/') location.hash = '#/dashboard';
      entrar(r.usuario);
    } catch (e) { $('erro-login').textContent = e.message; } finally { btn.disabled = false; btn.classList.remove('enviando'); btn.removeAttribute('aria-busy'); }
  });
  $('ir-registro').addEventListener('click', () => { $('erro-login').textContent = ''; alternarFormAcesso('registro'); });
  $('ir-login').addEventListener('click', () => alternarFormAcesso('login'));
  const fr = $('form-registro');
  fr.confirmacao.addEventListener('input', () => {
    $('r-confirmacao').textContent = fr.confirmacao.value && fr.confirmacao.value !== fr.senha.value ? 'As senhas não conferem.' : '';
  });
  fr.login.addEventListener('input', () => {
    // Não altera o que foi digitado: só avisa enquanto houver problema.
    const aviso = fr.login.value ? problemaLogin(fr.login.value) : null;
    $('r-login').textContent = aviso || '';
    if (aviso) fr.login.setAttribute('aria-invalid', 'true'); else fr.login.removeAttribute('aria-invalid');
  });
  fr.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('erro-registro').textContent = '';
    if (mostrarErrosRegistro(fr, errosRegistro(fr))) return;
    const btn = fr.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.classList.add('enviando'); // indicador de carregamento (spinner)
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await api('POST', '/api/auth/registrar', {
        nome: fr.nome.value.trim(), login: fr.login.value.trim(), senha: fr.senha.value, confirmacao: fr.confirmacao.value,
      });
      definirCsrf(r.csrf);
      fr.reset();
      ocultarSenhas();
      location.hash = '#/dashboard';
      entrar(r.usuario);
      toast(`Conta "${r.usuario.login}" criada. Seu perfil é CONSULTA (somente leitura).`, 'ok', 'Bem-vindo!');
    } catch (e) {
      if (e.detalhes) mostrarErrosRegistro(fr, e.detalhes);
      $('erro-registro').textContent = e.message;
    } finally { btn.disabled = false; btn.classList.remove('enviando'); btn.removeAttribute('aria-busy'); }
  });
  iniciarOlhos();
  iniciarBusca();
  iniciarMenuUsuario();
  // Google/Apple: o sistema NÃO possui essa integração. O botão apenas informa (não simula login).
  for (const b of document.querySelectorAll('.lum-social')) {
    b.addEventListener('click', () => toast(`Login com ${b.dataset.provedor} não está disponível nesta demonstração. Use seu usuário e senha.`, 'alerta', 'Indisponível'));
  }
  // Atalho dos usuários de demonstração: preenche só o login e leva o foco para a senha.
  for (const chip of document.querySelectorAll('.demo-chip')) {
    chip.addEventListener('click', () => {
      const f = $('form-login');
      f.login.value = chip.dataset.login;
      f.senha.value = '';
      f.senha.focus();
    });
  }
  window.addEventListener('hashchange', rotear);
  try {
    // Sessão ainda válida (ex.: "continuar conectado"): recupera usuário e token CSRF.
    const atual = await get('/api/auth/sessao');
    if (atual.csrf) definirCsrf(atual.csrf);
    entrar(atual);
  } catch { mostrarLogin(); }
}

iniciar();
