// Tema (Claro, Escuro ou Sistema). Script comum (não módulo), carregado no <head> ANTES do CSS ser pintado,
// para a página já abrir no tema certo, sem piscar. A preferência fica no navegador (localStorage 'tema').
// <html data-theme> recebe o tema efetivo ('light' ou 'dark'); <html data-tema-pref> guarda a escolha.
(function () {
  var OPCOES = ['light', 'dark', 'system'];
  var PADRAO = 'dark';                                   // o sistema nasceu escuro: continua assim até o usuário escolher
  var sistemaClaro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var pref = PADRAO;
  try { pref = localStorage.getItem('tema') || PADRAO; } catch (e) { /* sem armazenamento: usa o padrão */ }
  if (OPCOES.indexOf(pref) < 0) pref = PADRAO;

  // Troca de tema: <html class="tema-trocando"> marca a janela da troca. Nela o CSS (1) anima só os tokens de
  // cor no :root (@property), que todos os elementos herdam juntos, e (2) desliga as transições de cor próprias
  // dos componentes, para nenhum deles seguir outro ritmo. Com movimento reduzido o CSS não anima os tokens:
  // a troca é imediata (e a classe continua impedindo as transições dos componentes).
  // Um único temporizador: trocas rápidas reiniciam a janela e o resultado é sempre o último tema escolhido.
  var DURACAO = 200; // ms (igual ao CSS)
  var timer = null;
  function animarTroca() {
    var raiz = document.documentElement;
    raiz.classList.add('tema-trocando');
    clearTimeout(timer);
    timer = setTimeout(function () { raiz.classList.remove('tema-trocando'); timer = null; }, DURACAO + 50);
  }

  function aplicar(animar) {
    var efetivo = pref === 'system' ? (sistemaClaro && sistemaClaro.matches ? 'light' : 'dark') : pref;
    if (animar && document.documentElement.dataset.theme !== efetivo) animarTroca();
    document.documentElement.dataset.theme = efetivo;
    document.documentElement.dataset.temaPref = pref;
    document.dispatchEvent(new CustomEvent('tema-mudou', { detail: { pref: pref, efetivo: efetivo } }));
  }

  // Na opção "Sistema", acompanha a troca de tema do Windows/celular sem recarregar.
  if (sistemaClaro) {
    var aoMudar = function () { if (pref === 'system') aplicar(true); };
    if (sistemaClaro.addEventListener) sistemaClaro.addEventListener('change', aoMudar);
    else if (sistemaClaro.addListener) sistemaClaro.addListener(aoMudar);
  }

  window.ERPTema = {
    preferencia: function () { return pref; },
    definir: function (nova) {
      if (OPCOES.indexOf(nova) < 0) return;
      pref = nova;
      try { localStorage.setItem('tema', pref); } catch (e) { /* ignora */ }
      aplicar(true); // troca escolhida pelo usuário: com transição
    },
  };
  aplicar(false); // primeira pintura: tema certo direto, sem animação de entrada
})();
