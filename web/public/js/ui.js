// Componentes de interface reutilizáveis. Todo texto vindo de dados é inserido como textContent
// (nunca innerHTML), o que impede XSS a partir de cadastros maliciosos.
import { idioma, ingles } from './idioma.js';

export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...filhos) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
}

// ---------- Formatação conforme o idioma (pt-BR: 1.234,56 e 21/10/2026; en-US: 1,234.56 e 10/21/2026) ----------
// A moeda continua sendo o real (R$) nos dois idiomas: os valores do sistema são em reais.
const fMoeda = new Intl.NumberFormat(idioma, { style: 'currency', currency: 'BRL' });
const fMoedaCurta = new Intl.NumberFormat(idioma, { notation: 'compact', maximumFractionDigits: 1 });
const fNum = new Intl.NumberFormat(idioma, { maximumFractionDigits: 4 });
export const moeda = (v) => (v == null ? '' : fMoeda.format(v));
export const moedaCurta = (v) => 'R$ ' + fMoedaCurta.format(v);
export const numero = (v) => (v == null ? '' : fNum.format(v));
export function data(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return ingles ? `${m}/${d}/${a}` : `${d}/${m}/${a}`;
}
export const dataHora = (iso) => (iso ? new Date(iso).toLocaleString(idioma, { dateStyle: 'short', timeStyle: 'short' }) : '');
export const hojeIso = () => new Date().toLocaleDateString('sv-SE');
export function documento(doc) {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc || '';
}
export function mascaraDocumento(valor, tipo) {
  const d = valor.replace(/\D/g, '').slice(0, tipo === 'F' ? 11 : 14);
  if (tipo === 'F') return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
export const mascaraCep = (v) => v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
export function mascaraTelefone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

// Mesmas regras do servidor, apenas para feedback imediato (o servidor sempre revalida).
export function cpfValido(v) {
  const c = String(v).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) { let sm = 0; for (let i = 0; i < t; i++) sm += c[i] * (t + 1 - i); if (((sm * 10) % 11) % 10 !== +c[t]) return false; }
  return true;
}
export function cnpjValido(v) {
  const c = String(v).replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (b) => { const p = b.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const r = p.reduce((sm, x, i) => sm + b[i] * x, 0) % 11; return r < 2 ? 0 : 11 - r; };
  return calc(c.slice(0, 12)) === +c[12] && calc(c.slice(0, 13)) === +c[13];
}

const STATUS_PEDIDO = {
  RASCUNHO: ['Rascunho', 'neutro'], PENDENTE_APROVACAO: ['Pendente de aprovação', 'alerta'], APROVADO: ['Aprovado', 'info'],
  REJEITADO: ['Rejeitado', 'erro'], CANCELADO: ['Cancelado', 'neutro'], FATURADO: ['Faturado', 'ok'],
};
export const rotuloStatus = (st) => (STATUS_PEDIDO[st] || [st])[0];
export const seloPedido = (st) => selo(...(STATUS_PEDIDO[st] || [st, 'neutro']));
export const selo = (texto, tipo = 'neutro') => h('span', { class: `selo ${tipo}` }, texto);
export const seloTitulo = (t) => (t.situacao === 'LIQUIDADO' ? selo('Liquidado', 'ok')
  : t.vencido ? selo('Vencido', 'erro') : t.situacao === 'PARCIAL' ? selo('Parcial', 'alerta') : selo('Em aberto', 'info'));

// ---------- Toasts ----------
export function toast(mensagem, tipo = 'ok', titulo) {
  const el = h('div', { class: `toast ${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' },
    h('div', {}, titulo ? h('strong', {}, titulo) : null, mensagem),
    h('button', { class: 'btn-icone btn-pequeno', 'aria-label': 'Fechar', onclick: () => el.remove() }, '×'));
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 9000 : 4500);
}
export function toastErro(e, titulo = 'Não foi possível concluir') { toast(e.message || String(e), 'erro', titulo); }

// ---------- Modal ----------
export function modal({ titulo, corpo, rodape, tamanho = '', aoFechar }) {
  const anterior = document.activeElement;
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla); anterior?.focus?.(); aoFechar?.(); };
  const tecla = (ev) => {
    if (ev.key === 'Escape') fechar();
    if (ev.key === 'Tab') { // mantém o foco dentro do modal
      const foco = [...caixa.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent);
      if (!foco.length) return;
      const [pri, ult] = [foco[0], foco[foco.length - 1]];
      if (ev.shiftKey && document.activeElement === pri) { ult.focus(); ev.preventDefault(); }
      else if (!ev.shiftKey && document.activeElement === ult) { pri.focus(); ev.preventDefault(); }
    }
  };
  const idTitulo = 'm' + Math.random().toString(36).slice(2);
  const caixa = h('div', { class: `modal ${tamanho}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo },
    h('header', {}, h('h2', { id: idTitulo }, titulo), h('button', { class: 'btn-icone', 'aria-label': 'Fechar', onclick: fechar }, '×')),
    h('div', { class: 'corpo' }, corpo),
    rodape ? h('footer', {}, rodape) : null);
  const fundo = h('div', { class: 'modal-fundo', onmousedown: (ev) => { if (ev.target === fundo) fechar(); } }, caixa);
  document.getElementById('modal-raiz').append(fundo);
  document.addEventListener('keydown', tecla);
  setTimeout(() => (caixa.querySelector('[autofocus], input:not([readonly]), select, textarea, footer .btn-primario') || caixa.querySelector('button'))?.focus(), 0);
  return { fechar, caixa };
}

// Confirmação antes de operações destrutivas; opcionalmente pede um motivo obrigatório.
export function confirmar({ titulo, mensagem, botao = 'Confirmar', perigo = false, pedirMotivo = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const motivo = pedirMotivo ? h('textarea', { rows: 3, maxlength: 250, 'aria-label': 'Motivo', placeholder: 'Motivo (mínimo 5 caracteres)' }) : null;
    const msgErro = h('p', { class: 'erro-form', role: 'alert' });
    const confirmarBtn = h('button', { class: `btn ${perigo ? 'btn-perigo-cheio' : 'btn-primario'}`, onclick: () => {
      if (motivo && motivo.value.trim().length < 5) { msgErro.textContent = 'Informe o motivo (mínimo 5 caracteres).'; motivo.focus(); return; }
      ok = true; m.fechar();
    } }, botao);
    const m = modal({
      titulo, tamanho: 'pequeno',
      corpo: h('div', {}, h('p', { style: 'margin-top:0' }, mensagem), motivo, msgErro),
      rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Voltar'), confirmarBtn],
      aoFechar: () => resolve(ok ? (motivo ? motivo.value.trim() : true) : false),
    });
  });
}

// ---------- Estados ----------
export const carregando = (txt = 'Carregando') => h('div', { class: 'estado carregando', role: 'status' }, txt);
export const vazio = (txt = 'Nenhum registro encontrado.') => h('div', { class: 'estado' }, txt);
export const falha = (e, tentar) => h('div', { class: 'estado erro', role: 'alert' }, e.message || 'Falha ao carregar.',
  tentar ? [' ', h('button', { class: 'btn btn-pequeno', onclick: tentar }, 'Tentar novamente')] : null);

// ---------- Formulário ----------
// campos: [{ nome, rotulo, tipo, obrigatorio, opcoes, col, mascara, ajuda, atributos, secao }]
export function formulario(campos, valores = {}) {
  const els = {};
  const grade = h('div', { class: 'form-grade' });
  for (const c of campos) {
    if (c.secao) { grade.append(h('div', { class: 'secao-form' }, c.secao)); continue; }
    const id = 'f_' + c.nome;
    let input;
    const v = valores[c.nome];
    if (c.tipo === 'select') {
      input = h('select', { id, name: c.nome, required: c.obrigatorio },
        c.vazio !== false ? h('option', { value: '' }, c.vazio || 'Selecione…') : null,
        c.opcoes.map(([val, txt]) => h('option', { value: val, selected: String(v ?? '') === String(val) }, txt)));
    } else if (c.tipo === 'textarea') {
      input = h('textarea', { id, name: c.nome, rows: 3, ...c.atributos }, v ?? '');
    } else {
      input = h('input', { id, name: c.nome, type: c.tipo || 'text', required: c.obrigatorio, value: v ?? '', ...c.atributos });
    }
    if (c.mascara) { input.addEventListener('input', () => { input.value = c.mascara(input.value); }); if (input.value) input.value = c.mascara(input.value); }
    const msg = h('span', { class: 'msg', id: id + '_msg', 'aria-live': 'polite' });
    input.setAttribute('aria-describedby', id + '_msg');
    els[c.nome] = { input, msg, def: c };
    grade.append(h('div', { class: `campo ${c.col || ''}` },
      h('label', { for: id }, c.rotulo, c.obrigatorio ? h('span', { class: 'obrig', 'aria-hidden': 'true' }, ' *') : null), input,
      c.ajuda ? h('small', { class: 'muted' }, c.ajuda) : null, msg));
  }
  const api = {
    el: grade,
    valores() {
      const o = {};
      for (const [n, { input, def }] of Object.entries(els)) {
        let val = input.value.trim();
        if (def.tipo === 'number') val = val === '' ? '' : Number(val);
        if (def.tipo === 'checkbox') val = input.checked;
        o[n] = val;
      }
      return o;
    },
    limparErros() { for (const { input, msg } of Object.values(els)) { msg.textContent = ''; input.parentElement.classList.remove('invalido'); input.removeAttribute('aria-invalid'); } },
    erros(mapa) {
      api.limparErros();
      let primeiro = null;
      for (const [n, texto] of Object.entries(mapa || {})) {
        const c = els[n]; if (!c) continue;
        c.msg.textContent = typeof texto === 'string' ? texto : 'Inválido.';
        c.input.parentElement.classList.add('invalido');
        c.input.setAttribute('aria-invalid', 'true');
        primeiro ||= c.input;
      }
      primeiro?.focus();
      return !!primeiro;
    },
    validarObrigatorios() {
      const e = {};
      for (const [n, { input, def }] of Object.entries(els)) if (def.obrigatorio && !input.value.trim()) e[n] = 'Campo obrigatório.';
      return e;
    },
    campo: (n) => els[n]?.input,
  };
  return api;
}

// ---------- Tabela com paginação/ordenação no servidor ----------
// colunas: [{ chave, titulo, ordenavel, num, render(linha) }]
export function tabelaRemota({ colunas, carregar, estado, aoMudar, rotuloVazio }) {
  const raiz = h('div');
  async function atualizar() {
    raiz.replaceChildren(carregando());
    let r;
    try { r = await carregar(estado); } catch (e) { raiz.replaceChildren(falha(e, atualizar)); return; }
    if (!r.itens.length) { raiz.replaceChildren(vazio(rotuloVazio)); return; }
    const thead = h('thead', {}, h('tr', {}, colunas.map((c) => {
      const ativa = estado.ordem === c.chave;
      const aria = ativa ? (estado.direcao === 'desc' ? 'descending' : 'ascending') : null;
      return h('th', { class: c.num ? 'num' : '', scope: 'col', 'aria-sort': aria },
        c.ordenavel ? h('button', { onclick: () => {
          estado.direcao = ativa && estado.direcao !== 'desc' ? 'desc' : 'asc';
          estado.ordem = c.chave; estado.pagina = 1; aoMudar?.(); atualizar();
        } }, c.titulo, h('span', { class: 'seta', 'aria-hidden': 'true' }, ativa ? (estado.direcao === 'desc' ? '▼' : '▲') : '↕')) : c.titulo);
    })));
    const tbody = h('tbody', {}, r.itens.map((l) => h('tr', {}, colunas.map((c) => h('td', { class: `${c.num ? 'num' : ''} ${c.quebra ? 'quebra' : ''}` }, c.render ? c.render(l) : l[c.chave])))));
    const paginas = Math.max(1, Math.ceil(r.total / r.tamanho));
    const pag = h('div', { class: 'paginacao' },
      h('span', {}, `${r.total} registro(s) · página ${r.pagina} de ${paginas}`),
      h('button', { class: 'btn btn-pequeno', disabled: r.pagina <= 1, onclick: () => { estado.pagina = r.pagina - 1; aoMudar?.(); atualizar(); } }, '‹ Anterior'),
      h('button', { class: 'btn btn-pequeno', disabled: r.pagina >= paginas, onclick: () => { estado.pagina = r.pagina + 1; aoMudar?.(); atualizar(); } }, 'Próxima ›'));
    raiz.replaceChildren(h('div', { class: 'tabela-envolta' }, h('table', {}, thead, tbody)), pag);
  }
  return { el: raiz, atualizar };
}

// Tabela simples (dados já carregados).
export function tabela(colunas, linhas, rotuloVazio) {
  if (!linhas.length) return vazio(rotuloVazio);
  return h('div', { class: 'tabela-envolta' }, h('table', {},
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : '' }, c.titulo)))),
    h('tbody', {}, linhas.map((l) => h('tr', {}, colunas.map((c) => h('td', { class: `${c.num ? 'num' : ''} ${c.quebra ? 'quebra' : ''}` }, c.render ? c.render(l) : l[c.chave])))))));
}

// ---------- Ações de linha de tabela ----------
// Uma ação principal visível + menu "Mais ações" (três pontos) com as secundárias.
// principal: elemento já pronto (botão/link) ou null. itens: [{ rotulo, acao, href, perigo, sensivel }] — itens
// nulos são ignorados, então cada página só passa as ações autorizadas e válidas para o estado do registro.
// As sensíveis/destrutivas (sensivel ou perigo) ficam num grupo separado no fim; só as de perigo ficam vermelhas.
// O menu é posto no <body> com posição fixa: não é cortado pela rolagem da tabela nem sai da tela.
let menuAberto = null; // só um menu de ações aberto por vez

function fecharMenuAcoes({ devolverFoco = false } = {}) {
  if (!menuAberto) return;
  const { lista, botao, limpar } = menuAberto;
  menuAberto = null;
  limpar();
  lista.remove();
  botao.setAttribute('aria-expanded', 'false');
  if (devolverFoco) botao.focus();
}

export function acoesLinha(principal, itens = []) {
  const validos = itens.filter(Boolean);
  const comuns = validos.filter((i) => !i.perigo && !i.sensivel);
  const sensiveis = validos.filter((i) => i.perigo || i.sensivel);
  if (!comuns.length && !sensiveis.length) return h('div', { class: 'acoes-linha' }, principal);

  const idMenu = 'acoes-' + Math.random().toString(36).slice(2);
  const botao = h('button', {
    type: 'button', class: 'btn btn-pequeno btn-mais', 'aria-label': 'Mais ações', title: 'Mais ações',
    'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': idMenu,
    onclick: (ev) => { ev.stopPropagation(); alternar(); },
    onkeydown: (ev) => { if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); abrir(ev.key === 'ArrowUp' ? 'ultimo' : 'primeiro'); } },
  }, s('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
    ...[5, 12, 19].map((cx) => s('circle', { cx, cy: 12, r: 1.7, fill: 'currentColor' }))));

  function itemEl(i) {
    const escolher = (ev) => {
      ev.stopPropagation();
      fecharMenuAcoes({ devolverFoco: true }); // a janela de confirmação, se houver, devolve o foco a este botão
      if (i.href) { location.hash = i.href; return; }
      i.acao?.();
    };
    return h('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: i.perigo ? 'perigo' : '', onclick: escolher }, i.rotulo);
  }

  function abrir(foco = 'primeiro') {
    fecharMenuAcoes();
    const lista = h('div', { class: 'menu-acoes', role: 'menu', id: idMenu, 'aria-label': 'Mais ações',
      onclick: (ev) => ev.stopPropagation() },
    comuns.map(itemEl),
    comuns.length && sensiveis.length ? h('div', { class: 'separador', role: 'separator' }) : null,
    sensiveis.map(itemEl));
    document.body.append(lista);
    posicionar(lista);
    const opcoes = () => [...lista.querySelectorAll('[role=menuitem]')];
    const tecla = (ev) => {
      const os = opcoes();
      const atual = os.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharMenuAcoes({ devolverFoco: true }); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); os[(atual + 1) % os.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); os[(atual - 1 + os.length) % os.length].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); os[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); os[os.length - 1].focus(); }
      else if (ev.key === 'Tab') fecharMenuAcoes({ devolverFoco: true });
    };
    const fora = (ev) => { if (!lista.contains(ev.target) && !botao.contains(ev.target)) fecharMenuAcoes(); };
    const reposicionar = () => fecharMenuAcoes(); // rolar ou redimensionar fecha (evita menu "solto" na tela)
    lista.addEventListener('keydown', tecla);
    document.addEventListener('pointerdown', fora, true);
    window.addEventListener('resize', reposicionar);
    window.addEventListener('scroll', reposicionar, true);
    window.addEventListener('hashchange', reposicionar);
    menuAberto = { lista, botao, limpar: () => {
      document.removeEventListener('pointerdown', fora, true);
      window.removeEventListener('resize', reposicionar);
      window.removeEventListener('scroll', reposicionar, true);
      window.removeEventListener('hashchange', reposicionar);
    } };
    botao.setAttribute('aria-expanded', 'true');
    const os = opcoes();
    (foco === 'ultimo' ? os[os.length - 1] : os[0]).focus();
  }

  // Abaixo e alinhado à direita do botão; se não couber embaixo, abre para cima; nunca sai da janela.
  function posicionar(lista) {
    const b = botao.getBoundingClientRect();
    const m = lista.getBoundingClientRect();
    const margem = 8;
    let top = b.bottom + 4;
    if (top + m.height > window.innerHeight - margem && b.top - m.height - 4 > margem) top = b.top - m.height - 4;
    top = Math.max(margem, Math.min(top, window.innerHeight - m.height - margem));
    const left = Math.max(margem, Math.min(b.right - m.width, window.innerWidth - m.width - margem));
    lista.style.top = `${top}px`;
    lista.style.left = `${left}px`;
  }

  function alternar() {
    if (menuAberto?.botao === botao) fecharMenuAcoes();
    else abrir();
  }

  return h('div', { class: 'acoes-linha' }, principal, botao);
}

// Cabeçalho padrão de página.
export function cabecalho(titulo, sub, ...acoes) {
  return h('div', { class: 'cab-pagina' }, h('div', {}, h('h1', {}, titulo), sub ? h('div', { class: 'sub' }, sub) : null),
    acoes.length ? h('div', { class: 'acoes' }, acoes) : null);
}

// Pequeno debounce para campos de pesquisa.
export function atrasar(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Tela de acesso negado (o bloqueio real é feito pelo servidor; isto só explica o motivo).
export const acessoNegado = (texto = 'Esta área é exclusiva para administradores.') => h('div', { class: 'cartao acesso-negado', role: 'alert' },
  h('div', { class: 'ic', 'aria-hidden': 'true' }, '!'), h('h1', {}, 'Acesso restrito'), h('p', { class: 'muted' }, texto),
  h('a', { class: 'btn', href: '#/inicio' }, 'Voltar ao início'));
