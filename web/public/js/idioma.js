// Idioma da interface: Português (Brasil), o padrão, ou English (US).
// A escolha fica no navegador (localStorage 'idioma'); trocar recarrega a página.
// Em português nada é traduzido. Em inglês, um MutationObserver traduz cada texto, placeholder, title e
// aria-label (e a dica data-dica) assim que entra na página, usando o dicionário de js/idioma-en.js (frase exata ou padrão).
// Dados digitados ou cadastrados (nomes, descrições) não estão no dicionário e continuam como foram gravados.
export const IDIOMAS = { 'pt-BR': 'Português', 'en-US': 'English (US)' };
const PADRAO = 'pt-BR';

export const idioma = (() => {
  try { const v = localStorage.getItem('idioma'); return v in IDIOMAS ? v : PADRAO; } catch { return PADRAO; }
})();
export const ingles = idioma === 'en-US';

export function definirIdioma(novo) {
  if (!(novo in IDIOMAS) || novo === idioma) return;
  try { localStorage.setItem('idioma', novo); } catch { /* sem armazenamento: vale só até recarregar */ }
  location.reload();
}

// Abreviações de mês usadas nos gráficos (rótulo "out/26" ou "Oct/26").
export const MESES = ingles
  ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  : ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const dic = ingles ? await import('./idioma-en.js') : null;

// Traduz um texto (frase exata ou padrão); mantém os espaços das pontas. Sem tradução, devolve o original.
export function traduzir(texto) {
  if (!dic || typeof texto !== 'string') return texto;
  const chave = texto.trim();
  if (!chave) return texto;
  let r = dic.textos[chave];
  if (r === undefined) {
    for (const [re, troca] of dic.padroes) {
      if (re.test(chave)) { r = chave.replace(re, troca); break; }
    }
  }
  if (r === undefined || r === chave) return texto;
  return texto.slice(0, texto.length - texto.trimStart().length) + r + texto.slice(texto.trimEnd().length);
}

const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'data-dica'];
// Logins, códigos de parâmetro e campos de texto não são traduzidos.
const ignorar = (el) => !el || !!el.closest('[translate="no"], code, script, style, textarea');
// Atributos (placeholder, title...) de um campo de texto são traduzidos; o conteúdo digitado nunca.
const ignorarAtributos = (el) => !el || !!el.closest('[translate="no"], code, script, style');

function traduzirAtributos(el) {
  for (const a of ATRIBUTOS) {
    const v = el.getAttribute(a);
    if (v) { const n = traduzir(v); if (n !== v) el.setAttribute(a, n); }
  }
  if (el.tagName === 'INPUT' && el.readOnly && el.value) { const n = traduzir(el.value); if (n !== el.value) el.value = n; }
}

function traduzirArvore(raiz) {
  if (raiz.nodeType === Node.TEXT_NODE) {
    if (!ignorar(raiz.parentElement)) { const n = traduzir(raiz.data); if (n !== raiz.data) raiz.data = n; }
    return;
  }
  if (raiz.nodeType !== Node.ELEMENT_NODE || ignorarAtributos(raiz)) return;
  traduzirAtributos(raiz);
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let no = w.nextNode(); no; no = w.nextNode()) {
    if (no.nodeType === Node.TEXT_NODE) {
      if (!ignorar(no.parentElement)) { const n = traduzir(no.data); if (n !== no.data) no.data = n; }
    } else if (!ignorarAtributos(no)) traduzirAtributos(no);
  }
}

if (ingles) {
  document.documentElement.lang = 'en-US';
  document.title = traduzir(document.title);
  traduzirArvore(document.body);
  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (m.type === 'childList') m.addedNodes.forEach(traduzirArvore);
      else if (m.type === 'characterData') traduzirArvore(m.target);
      else if (m.type === 'attributes' && !ignorarAtributos(m.target)) traduzirAtributos(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
}
