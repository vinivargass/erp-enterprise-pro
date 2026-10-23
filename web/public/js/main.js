// Inicialização: login, layout (menu, cabeçalho, notificações), roteamento por hash.
// idioma.js vem primeiro: em inglês, ele já traduz a página antes de qualquer tela aparecer.
import { IDIOMAS, idioma, definirIdioma, traduzir } from './idioma.js';
import { api, get, post, definirCsrf, quandoSessaoExpirar } from './api.js';
import { h, s, toast, falha, carregando } from './ui.js';
import * as inicio from './paginas/inicio.js';
import * as ajuda from './paginas/ajuda.js';
import * as painelExecutivo from './paginas/dashboard.js';
import * as clientes from './paginas/clientes.js';
import * as produtos from './paginas/produtos.js';
import * as pedidos from './paginas/pedidos.js';
import * as estoque from './paginas/estoque.js';
import * as expedicao from './paginas/expedicao.js';
import * as financeiro from './paginas/financeiro.js';
import * as relatorios from './paginas/relatorios.js';
import * as configuracoes from './paginas/configuracoes.js';
import * as adminPainel from './paginas/admin-painel.js';
import * as adminUsuarios from './paginas/admin-usuarios.js';
import * as adminExcluir from './paginas/admin-excluir.js';
import { montarIlustracao } from './ilustracao-login.js';
import { MENU, icone, liberado } from './modulos.js';

const PAGINAS = [
  [/^inicio$/, inicio.render, []],
  [/^ajuda$/, ajuda.render, ['Ajuda']],
  [/^painel-executivo$/, painelExecutivo.render, ['Gestão', 'Painel executivo']],
  [/^clientes$/, clientes.render, ['Cadastros', 'Clientes']],
  [/^produtos$/, produtos.render, ['Cadastros', 'Produtos']],
  [/^pedidos$/, pedidos.renderLista, ['Operações', 'Pedidos de venda']],
  [/^pedidos\/novo$/, pedidos.renderEdicao, ['Operações', ['Pedidos de venda', '#/pedidos'], 'Novo pedido']],
  [/^pedidos\/(\d+)$/, pedidos.renderDetalhe, ['Operações', ['Pedidos de venda', '#/pedidos'], 'Pedido']],
  [/^pedidos\/(\d+)\/editar$/, pedidos.renderEdicao, ['Operações', ['Pedidos de venda', '#/pedidos'], 'Editar pedido']],
  [/^estoque$/, estoque.render, ['Operações', 'Estoque']],
  [/^expedicao$/, expedicao.render, ['Operações', 'Expedição']],
  [/^expedicao\/(\d+)$/,expedicao.renderDetalhe, ['Operações', ['Expedição', '#/expedicao'], 'Separação']],
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

// Saída da página atual: uma tela com alteração não salva (ex.: anotação) registra `podeSair`, que pode pedir
// confirmação; `desmontar` limpa o que a tela deixou ligado (ex.: aviso do navegador ao fechar a aba).
let saidaDaPagina = null;
let rotaAtual = '';
async function podeSairDaPagina() {
  if (!saidaDaPagina) return true;
  const ok = await saidaDaPagina.podeSair();
  if (ok) { saidaDaPagina.desmontar?.(); saidaDaPagina = null; }
  return ok;
}

function contexto(params, query) {
  return {
    usuario, params, query,
    pode: (p) => usuario.permissoes.includes(p),
    navegar: (rota) => { location.hash = rota; },
    migalhas: definirMigalhas,
    atualizarNotificacoes,
    aoSair: (cfg) => { saidaDaPagina = cfg; },
  };
}

function definirMigalhas(itens) {
  $('migalhas').replaceChildren(h('li', {}, itens.length ? h('a', { href: '#/inicio' }, 'Início') : h('span', { 'aria-current': 'page' }, 'Início')),
    ...itens.map((it, i) => h('li', {}, Array.isArray(it) ? h('a', { href: it[1] }, it[0])
      : h('span', { 'aria-current': i === itens.length - 1 ? 'page' : null }, it))));
}

// Cada navegação (e cada entrada/saída de sessão) recebe um número. Uma tela que termina de carregar
// depois que o usuário mudou de página ou saiu do sistema é descartada, nunca exibida.
let navegacao = 0;

async function rotear() {
  if (!usuario) return;
  // Alteração não salva na página atual: se a pessoa cancelar, volta ao endereço anterior sem trocar de tela.
  if (location.hash !== rotaAtual && !(await podeSairDaPagina())) { history.replaceState(null, '', rotaAtual || '#/inicio'); return; }
  rotaAtual = location.hash;
  // Trocar de página (menu, Voltar do navegador ou URL) fecha janelas modais que tenham ficado abertas.
  $('modal-raiz').replaceChildren();
  const minha = ++navegacao;
  const [caminho, qs] = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?');
  // Endereço antigo da "Visão geral": leva ao Início (o painel estratégico tem endereço próprio e permissão).
  if (caminho === 'dashboard') { location.replace('#/inicio'); return; }
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const alvo = PAGINAS.find(([re]) => re.test(caminho));
  const conteudo = $('conteudo');
  for (const a of document.querySelectorAll('#menu a, #menu-rodape a')) {
    a.toggleAttribute('aria-current', caminho === a.dataset.rota || caminho.startsWith(a.dataset.rota + '/'));
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  }
  $('app').classList.remove('menu-aberto');
  if (!alvo) { definirMigalhas(['Página não encontrada']); conteudo.replaceChildren(h('div', { class: 'estado' }, 'Página não encontrada. ', h('a', { href: '#/inicio' }, 'Voltar ao início'))); return; }
  const [re, render, migalhas] = alvo;
  const params = caminho.match(re).slice(1);
  definirMigalhas(migalhas);
  conteudo.replaceChildren(carregando());
  try {
    const el = await render(contexto(params, query));
    if (minha !== navegacao || !usuario) return;
    if (el) conteudo.replaceChildren(el);
  } catch (e) {
    if (minha !== navegacao || !usuario) return;
    conteudo.replaceChildren(falha(e, rotear));
  }
  conteudo.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// Menu lateral: lista única dos módulos liberados; Configurações e Ajuda ficam no rodapé.
function montarMenu() {
  const item = (m) => h('a', { href: '#/' + m.rota, dataset: { rota: m.rota }, title: m.rotulo }, icone(m.ic, 24), h('span', { class: 'rotulo' }, m.rotulo));
  const liberados = MENU.filter((m) => liberado(usuario, m));
  $('menu').replaceChildren(...liberados.filter((m) => !m.rodape).map(item));
  $('menu-rodape').replaceChildren(...liberados.filter((m) => m.rodape).map(item));
}

// Empresa/filial ativa no cabeçalho (dados do servidor). Sem outras empresas, não há seletor.
async function mostrarEmpresa() {
  const el = $('empresa-ativa');
  try {
    const e = await get('/api/empresa');
    if (!usuario) return;
    el.textContent = `Empresa ${e.codigo} · ${e.nome}`;
    $('contexto').title = `Filial ${e.filial_codigo} · ${e.filial_nome}`;
  } catch { el.textContent = ''; }
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
// ---------- Painéis do cabeçalho: só um aberto por vez ----------
// Uma única fonte de verdade: painelAtivo = null | 'idioma' | 'notificacoes' | 'usuario' | 'busca'.
// Cada painel registra o controle que o abre (botao), o painel e a área "de dentro" (raiz): clicar ou focar
// fora da raiz do painel ativo o fecha. Os botões NÃO param a propagação do clique: o botão troca o painel
// primeiro e, quando o clique chega ao document, o painel ativo já é o novo (e o clique foi "dentro" dele).
// Modais e formulários da página ficam fora deste controle.
const PAINEIS = {};
let painelAtivo = null;

function registrarPainel(nome, cfg) { PAINEIS[nome] = cfg; }

function abrirPainel(nome) {
  if (painelAtivo === nome) return;
  fecharPainel();
  const p = PAINEIS[nome];
  painelAtivo = nome;
  p.painel.hidden = false;
  p.botao.setAttribute('aria-expanded', 'true');
  manterNaTela(p.painel);
  p.aoAbrir?.();
}

// Painel aberto nunca sai da área visível (telas estreitas): desloca na horizontal só o necessário.
function manterNaTela(painel) {
  painel.style.translate = '';
  const r = painel.getBoundingClientRect();
  const margem = 8;
  let dx = 0;
  if (r.left < margem) dx = margem - r.left;
  else if (r.right > window.innerWidth - margem) dx = window.innerWidth - margem - r.right;
  if (dx) painel.style.translate = `${Math.round(dx)}px 0`;
}

function fecharPainel({ devolverFoco = false } = {}) {
  if (!painelAtivo) return;
  const p = PAINEIS[painelAtivo];
  painelAtivo = null;
  p.painel.hidden = true;
  p.botao.setAttribute('aria-expanded', 'false');
  p.aoFechar?.();
  if (devolverFoco) p.botao.focus();
}

const alternarPainel = (nome) => (painelAtivo === nome ? fecharPainel() : abrirPainel(nome));

// Listeners globais únicos (o cabeçalho vive enquanto a página existir; nada a desmontar).
function iniciarPaineisCabecalho() {
  const dentro = (alvo) => painelAtivo && PAINEIS[painelAtivo].raiz.contains(alvo);
  document.addEventListener('click', (ev) => { if (painelAtivo && !dentro(ev.target)) fecharPainel(); });
  // Teclado: sair do painel com Tab também o fecha.
  document.addEventListener('focusin', (ev) => { if (painelAtivo && !dentro(ev.target)) fecharPainel(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !painelAtivo) return;
    ev.preventDefault();
    fecharPainel({ devolverFoco: true });
  });
  window.addEventListener('hashchange', () => fecharPainel());
  window.addEventListener('resize', () => { if (painelAtivo) manterNaTela(PAINEIS[painelAtivo].painel); });
}

function iniciarNotificacoes() {
  const botao = $('btn-notif');
  registrarPainel('notificacoes', { botao, painel: $('painel-notif'), raiz: botao.closest('.notif'), aoAbrir: () => atualizarNotificacoes() });
  botao.addEventListener('click', () => alternarPainel('notificacoes'));
}
const fecharNotif = () => { if (painelAtivo === 'notificacoes') fecharPainel(); };

// Ilustração decorativa do login: montada só enquanto a tela de login está visível.
let desmontarIlustracao = null;
function pararIlustracao() { desmontarIlustracao?.(); desmontarIlustracao = null; }

function entrar(u) {
  usuario = u;
  pararIlustracao();
  $('tela-login').hidden = true;
  $('app').hidden = false;
  $('usuario-nome').textContent = u.nome;
  $('usuario-perfil').textContent = ({ ADMIN: 'Administrador', DIRETORIA: 'Diretoria', GERENTE: 'Gerente', VENDEDOR: 'Vendedor', ESTOQUE: 'Estoque', FINANCEIRO: 'Financeiro', CONSULTA: 'Consulta', SEM_ACESSO: 'Sem acesso' })[u.perfil] || u.perfil;
  $('avatar').textContent = u.nome.split(' ').map((p) => p[0]).slice(0, 2).join('');
  montarMenu();
  mostrarEmpresa();
  atualizarNotificacoes();
  rotaAtual = '';
  rotear();
}

// Ao sair (ou ao expirar a sessão), nada do usuário anterior fica na página, nem escondido:
// conteúdo, menu, notificações, janelas, busca e identificação são esvaziados.
function limparSessaoNaTela() {
  navegacao++;
  saidaDaPagina?.desmontar?.(); saidaDaPagina = null; rotaAtual = '';
  for (const id of ['conteudo', 'menu', 'menu-rodape', 'migalhas', 'painel-notif', 'modal-raiz', 'busca-resultados', 'usuario-nome', 'usuario-perfil', 'avatar', 'empresa-ativa']) $(id).replaceChildren();
  $('notif-contador').hidden = true;
  fecharPainel(); // painel do cabeçalho aberto (se houver) fecha e o estado volta a "nenhum"
  $('busca-global').value = '';
  document.querySelector('.dica-grafico')?.remove();
}

function mostrarLogin(msg) {
  usuario = null;
  limparSessaoNaTela();
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
  if (!f.confirmacao.value) e.confirmacao = CONFIRMACAO_VAZIA;
  else if (f.confirmacao.value !== s) e.confirmacao = SENHAS_DIFERENTES;
  return e;
}

// "As senhas não conferem" acompanha os valores ATUAIS dos dois campos, comparados exatamente como
// digitados (sem trim nem mudança de maiúsculas). Roda quando qualquer um dos dois muda (digitar, apagar,
// colar). Só cuida da confirmação: os erros das regras da senha principal não são tocados aqui.
const SENHAS_DIFERENTES = 'As senhas não conferem.';
const CONFIRMACAO_VAZIA = 'Confirme a senha.';
// O tipo do erro exibido fica em data-erro do campo (o texto pode estar traduzido na tela).
function revalidarConfirmacao(f) {
  const msg = $('r-confirmacao');
  const campo = f.confirmacao;
  if (campo.value && campo.value !== f.senha.value) {
    msg.textContent = SENHAS_DIFERENTES;
    campo.dataset.erro = 'divergencia';
    campo.setAttribute('aria-invalid', 'true');
  } else if (campo.value || campo.dataset.erro === 'divergencia') {
    // Iguais, ou confirmação apagada depois de uma divergência: some a mensagem e a borda vermelha.
    // Com o campo vazio, o aviso de preenchimento obrigatório (do envio) continua até a pessoa digitar.
    msg.textContent = '';
    delete campo.dataset.erro;
    campo.removeAttribute('aria-invalid');
  }
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
  if (erros.confirmacao === SENHAS_DIFERENTES) f.confirmacao.dataset.erro = 'divergencia';
  else if (erros.confirmacao) f.confirmacao.dataset.erro = 'vazia';
  else delete f.confirmacao.dataset.erro;
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

// Escolha de idioma (tela de login e menu do usuário). A troca recarrega a página no novo idioma.
// Cabeçalho: globo + idioma atual (PT-BR / EN-US) abre a lista de idiomas; na tela de login, atalho PT | EN.
function iniciarIdioma() {
  const botao = $('btn-idioma'); const menu = $('menu-idioma');
  const opcoes = [...menu.querySelectorAll('[data-idioma]')];
  $('idioma-atual').textContent = idioma.toUpperCase();
  botao.setAttribute('aria-label', `${idioma === 'en-US' ? 'Language' : 'Idioma'}: ${IDIOMAS[idioma]}`);
  for (const o of opcoes) o.setAttribute('aria-checked', String(o.dataset.idioma === idioma));
  for (const b of document.querySelectorAll('.login-idioma [data-idioma]')) {
    b.setAttribute('aria-pressed', String(b.dataset.idioma === idioma));
    b.addEventListener('click', () => definirIdioma(b.dataset.idioma));
  }
  // Abrir e fechar passam pelo controle único do cabeçalho (fecha notificações, usuário e busca).
  registrarPainel('idioma', { botao, painel: menu, raiz: botao.closest('.idioma-seletor'),
    aoAbrir: () => (opcoes.find((o) => o.getAttribute('aria-checked') === 'true') || opcoes[0]).focus() });
  botao.addEventListener('click', () => alternarPainel('idioma'));
  botao.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowDown' && menu.hidden) { ev.preventDefault(); abrirPainel('idioma'); } });
  menu.addEventListener('keydown', (ev) => {
    const i = opcoes.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      opcoes[(i + (ev.key === 'ArrowDown' ? 1 : -1) + opcoes.length) % opcoes.length].focus();
    }
  });
  // A troca recarrega a página no novo idioma; com anotação não salva, o navegador pede confirmação.
  for (const o of opcoes) o.addEventListener('click', () => { fecharPainel({ devolverFoco: true }); definirIdioma(o.dataset.idioma); });
}

// Botão de tema: sol no modo escuro (ativa o claro), lua no modo claro (ativa o escuro). Um clique grava a
// escolha explícita, mesmo em "Seguir sistema". O ícone é escolhido pelo CSS conforme <html data-theme>.
function iniciarBotaoTema() {
  const botao = $('btn-tema');
  const escuro = () => document.documentElement.dataset.theme !== 'light';
  const marcar = () => {
    const acao = escuro() ? 'Ativar modo claro' : 'Ativar modo escuro';
    botao.setAttribute('aria-label', acao);
    botao.dataset.dica = acao;
  };
  botao.addEventListener('click', () => window.ERPTema?.definir(escuro() ? 'light' : 'dark'));
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
    // Aceita o nome da página no idioma da tela ou em português.
    const nomes = [m.rotulo, traduzir(m.rotulo)].map(normalizarBusca);
    if (m.rota && liberado(usuario, m) && nomes.some((n) => n.includes(t))) r.push({ rotulo: m.rotulo, dica: 'Abrir página', destino: '#/' + m.rota });
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
  // A lista de resultados é um painel do cabeçalho como os outros: abrir fecha os demais e vice-versa.
  registrarPainel('busca', { botao: campo, painel: lista, raiz: campo.closest('.busca-global'),
    aoFechar: () => { campo.removeAttribute('aria-activedescendant'); ativo = -1; } });
  const fechar = () => { if (painelAtivo === 'busca') fecharPainel(); };
  const ir = (it) => { campo.value = ''; itens = []; fechar(); location.hash = it.destino; };
  const desenhar = () => {
    lista.replaceChildren(...itens.map((it, i) => h('li', { role: 'option', id: 'busca-op-' + i, 'aria-selected': String(i === ativo),
      onmousedown: (ev) => { ev.preventDefault(); ir(it); } }, h('span', {}, it.rotulo), h('small', {}, it.dica))));
    if (!itens.length) { fechar(); return; }
    abrirPainel('busca');
    if (ativo >= 0) campo.setAttribute('aria-activedescendant', 'busca-op-' + ativo); else campo.removeAttribute('aria-activedescendant');
  };
  campo.addEventListener('input', () => { itens = resultadosBusca(campo.value); ativo = itens.length ? 0 : -1; desenhar(); });
  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' && itens.length) { ativo = (ativo + 1) % itens.length; desenhar(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp' && itens.length) { ativo = (ativo - 1 + itens.length) % itens.length; desenhar(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && itens[ativo]) { ev.preventDefault(); ir(itens[ativo]); }
    // Escape é tratado pelo controle do cabeçalho (fecha a lista e mantém o foco no campo).
  });
}

// ---------- Menu do usuário (nome + perfil + sair) ----------
function iniciarMenuUsuario() {
  const menu = $('menu-usuario'); const botao = $('btn-usuario');
  // Os botões de tema ficam dentro da raiz: trocar o tema mantém o menu aberto.
  registrarPainel('usuario', { botao, painel: menu, raiz: botao.closest('.usuario'),
    aoAbrir: () => (menu.querySelector('.tema-opcoes [aria-pressed="true"]') || $('btn-sair')).focus() });
  botao.addEventListener('click', () => alternarPainel('usuario'));
}

async function iniciar() {
  iniciarTema();
  iniciarBotaoTema();
  iniciarIdioma();
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
  iniciarPaineisCabecalho();
  iniciarNotificacoes();
  $('btn-sair').addEventListener('click', async () => {
    if (!(await podeSairDaPagina())) return; // anotação não salva: a pessoa decide antes de sair
    try { await post('/api/auth/logout'); } catch { /* ignora */ } definirCsrf(''); mostrarLogin();
  });
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
      if (location.hash === '' || location.hash === '#/') location.hash = '#/inicio';
      entrar(r.usuario);
    } catch (e) { $('erro-login').textContent = e.message; } finally { btn.disabled = false; btn.classList.remove('enviando'); btn.removeAttribute('aria-busy'); }
  });
  $('ir-registro').addEventListener('click', () => { $('erro-login').textContent = ''; alternarFormAcesso('registro'); });
  $('ir-login').addEventListener('click', () => alternarFormAcesso('login'));
  const fr = $('form-registro');
  fr.confirmacao.addEventListener('input', () => revalidarConfirmacao(fr));
  fr.senha.addEventListener('input', () => revalidarConfirmacao(fr));
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
      location.hash = '#/inicio';
      entrar(r.usuario);
      toast(`Conta "${r.usuario.login}" criada. Um administrador vai liberar os módulos do seu acesso.`, 'ok', 'Bem-vindo!');
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
