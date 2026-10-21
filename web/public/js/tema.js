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

  function aplicar() {
    var efetivo = pref === 'system' ? (sistemaClaro && sistemaClaro.matches ? 'light' : 'dark') : pref;
    document.documentElement.dataset.theme = efetivo;
    document.documentElement.dataset.temaPref = pref;
    document.dispatchEvent(new CustomEvent('tema-mudou', { detail: { pref: pref, efetivo: efetivo } }));
  }

  // Na opção "Sistema", acompanha a troca de tema do Windows/celular sem recarregar.
  if (sistemaClaro) {
    var aoMudar = function () { if (pref === 'system') aplicar(); };
    if (sistemaClaro.addEventListener) sistemaClaro.addEventListener('change', aoMudar);
    else if (sistemaClaro.addListener) sistemaClaro.addListener(aoMudar);
  }

  window.ERPTema = {
    preferencia: function () { return pref; },
    definir: function (nova) {
      if (OPCOES.indexOf(nova) < 0) return;
      pref = nova;
      try { localStorage.setItem('tema', pref); } catch (e) { /* ignora */ }
      aplicar();
    },
  };
  aplicar();
})();
