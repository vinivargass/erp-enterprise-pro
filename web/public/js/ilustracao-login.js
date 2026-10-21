// Ilustração decorativa da tela de login/cadastro: fios ligam o símbolo à esquerda aos cards marcados com
// data-conector, e os cards reagem de leve ao cursor (fios e bolinhas acompanham a posição atual do card).
// Conteúdo 100% estático: este módulo não chama a API nem lê dados do ERP.
const NS = 'http://www.w3.org/2000/svg';
const FOLGA = 5;       // px livres entre a bolinha e a borda do card (e do símbolo)
const RAIO = 3;        // bolinha de 6 px de diâmetro
const DESLOC = 5;      // deslocamento máximo do card (px)
const GIRO = 1.5;      // rotação máxima do card (graus)
const ALCANCE = 260;   // distância do cursor até a borda do card (px) em que a reação chega a zero
const SUAVE = 0.12;    // fração do caminho percorrida a cada quadro de 60 Hz (retorno suave, sem oscilar)

const svgEl = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const limitar = (v) => Math.max(-1, Math.min(1, v));
const parado = () => ({ x: 0, y: 0, r: 0, k: 0 });

// Monta a ilustração dentro de `raiz` (o <aside class="lum-metricas">) e devolve a função que a desmonta.
export function montarIlustracao(raiz) {
  const svg = raiz.querySelector('.lum-fios');
  const simbolo = raiz.querySelector('.lum-excel');
  if (!svg || !simbolo) return () => {};
  const movimento = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  // x, y, r = deslocamento/rotação atuais; k = intensidade (reforço da borda); alvo = para onde está indo
  const cards = [...raiz.querySelectorAll('.lum-cartao')].map((el) => ({ el, ...parado(), alvo: parado(), base: null }));
  const ligados = cards.filter((c) => c.el.hasAttribute('data-conector'));
  let origem = null;     // pontas no símbolo: { x, ys: [cima, baixo] }
  let quadro = 0;
  let medicao = 0;

  // Elementos SVG criados uma vez; a cada quadro só os atributos mudam.
  svg.replaceChildren();
  ligados.forEach((c, i) => {
    c.fio = { linha: svgEl('path', { class: 'lum-linha' }), pulso: svgEl('path', { class: i ? 'lum-pulso p2' : 'lum-pulso', pathLength: 100 }),
      inicio: svgEl('circle', { class: 'lum-no', r: RAIO }), fim: svgEl('circle', { class: 'lum-no', r: RAIO }) };
    svg.append(c.fio.linha, c.fio.pulso, c.fio.inicio, c.fio.fim);
  });

  // Mede a geometria real (sem a reação aplicada), relativa à própria coluna.
  function medir() {
    medicao = 0;
    if (!simbolo.offsetParent) { origem = null; return; }        // telas estreitas: símbolo e fios ocultos pelo CSS
    const caixa = raiz.getBoundingClientRect();
    for (const c of cards) c.el.style.transform = '';
    for (const c of cards) {
      const r = c.el.getBoundingClientRect();
      c.base = { x: r.left - caixa.left, y: r.top - caixa.top, w: r.width, h: r.height };
    }
    const s = simbolo.getBoundingClientRect();
    // A parte visível do desenho termina em 58 de 64 unidades da largura do ícone.
    const xs = s.left - caixa.left + (s.width * 58) / 64 + FOLGA + RAIO;
    const cy = s.top - caixa.top + s.height / 2;
    const d = s.height * 0.2;
    origem = { x: xs, ys: [cy - d, cy + d] };
    ligados.sort((a, b) => a.base.y - b.base.y);                   // card de cima recebe a ponta de cima
    aplicar();
  }
  let ativo = true;
  const agendarMedicao = () => { if (ativo && !medicao) medicao = requestAnimationFrame(medir); };

  // Aplica deslocamento/rotação atuais e redesenha os fios até a posição atual de cada card.
  function aplicar() {
    for (const c of cards) {
      c.el.style.transform = c.x || c.y || c.r ? `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) rotate(${c.r.toFixed(3)}deg)` : '';
      c.el.style.setProperty('--reacao', c.k.toFixed(3));
    }
    if (!origem) return;
    ligados.forEach((c, i) => {
      const b = c.base;
      const t = (c.r * Math.PI) / 180;
      // Centro da lateral esquerda do card já girado/deslocado, recuado FOLGA + RAIO na direção do próprio card.
      const meia = b.w / 2 + FOLGA + RAIO;
      const ex = b.x + b.w / 2 + c.x - meia * Math.cos(t);
      const ey = b.y + b.h / 2 + c.y - meia * Math.sin(t);
      const sx = origem.x; const sy = origem.ys[Math.min(i, 1)];
      const mx = (sx + ex) / 2;
      const d = `M${sx},${sy} H${sx + 12} C${mx},${sy} ${mx},${ey} ${ex - 12},${ey} H${ex}`;
      c.fio.linha.setAttribute('d', d);
      c.fio.pulso.setAttribute('d', d);
      c.fio.inicio.setAttribute('cx', sx); c.fio.inicio.setAttribute('cy', sy);
      c.fio.fim.setAttribute('cx', ex); c.fio.fim.setAttribute('cy', ey);
    });
  }

  let anterior = 0;
  function passo(agora) {
    quadro = 0;
    // Mesma velocidade em telas de 60 Hz ou 144 Hz: a fração percorrida depende do tempo desde o último quadro.
    const dt = anterior ? Math.min(agora - anterior, 50) : 16.7;
    anterior = agora;
    const f = 1 - (1 - SUAVE) ** (dt / 16.7);
    let mexendo = false;
    for (const c of cards) {
      for (const p of ['x', 'y', 'r', 'k']) {
        const falta = c.alvo[p] - c[p];
        if (Math.abs(falta) > 0.004) { c[p] += falta * f; mexendo = true; } else c[p] = c.alvo[p];
      }
    }
    aplicar();
    if (mexendo) quadro = requestAnimationFrame(passo);           // para sozinho quando tudo assenta
    else anterior = 0;
  }
  const animar = () => { if (!quadro) quadro = requestAnimationFrame(passo); };

  // Uma única posição do cursor, relativa à coluna (que não se move), coordena os quatro cards.
  // Intensidade: distância do cursor até a borda do card na posição original (área estável, sem tremedeira).
  // Direção: deslocamento rumo ao cursor; inclinação conforme o lado do card em que o cursor está.
  function aoMover(ev) {
    const caixa = raiz.getBoundingClientRect();
    const px = ev.clientX - caixa.left; const py = ev.clientY - caixa.top;
    for (const c of cards) {
      const b = c.base;
      if (!b) continue;
      const fora = Math.hypot(Math.max(b.x - px, 0, px - b.x - b.w), Math.max(b.y - py, 0, py - b.y - b.h));
      let k = Math.max(0, 1 - fora / ALCANCE);
      k = k * k * (3 - 2 * k);
      const nx = limitar((px - b.x - b.w / 2) / (b.w / 2)); const ny = limitar((py - b.y - b.h / 2) / (b.h / 2));
      const m = Math.max(1, Math.hypot(nx, ny));                  // na diagonal o deslocamento total também fica em DESLOC
      c.alvo = { x: (DESLOC * nx * k) / m, y: (DESLOC * ny * k) / m, r: GIRO * nx * ny * k, k };
    }
    animar();
  }
  function aoSair() { for (const c of cards) c.alvo = parado(); animar(); }

  // Movimento só com mouse/trackpad e sem preferência por redução de movimento.
  let movendo = false;
  function ajustarMovimento() {
    if (movimento.matches && !movendo) {
      raiz.addEventListener('pointermove', aoMover, { passive: true });
      raiz.addEventListener('pointerleave', aoSair);
      movendo = true;
    } else if (!movimento.matches && movendo) {
      raiz.removeEventListener('pointermove', aoMover);
      raiz.removeEventListener('pointerleave', aoSair);
      movendo = false;
      for (const c of cards) { Object.assign(c, parado()); c.alvo = parado(); }
      aplicar();
    }
  }

  const observador = new ResizeObserver(agendarMedicao);
  observador.observe(raiz);
  observador.observe(raiz.querySelector('.lum-cartoes'));
  movimento.addEventListener('change', ajustarMovimento);
  document.fonts?.ready.then(agendarMedicao);
  ajustarMovimento();
  medir();

  return function desmontar() {
    ativo = false;
    observador.disconnect();
    movimento.removeEventListener('change', ajustarMovimento);
    raiz.removeEventListener('pointermove', aoMover);
    raiz.removeEventListener('pointerleave', aoSair);
    cancelAnimationFrame(quadro); cancelAnimationFrame(medicao);
    quadro = 0; medicao = 0;
    for (const c of cards) { c.el.style.transform = ''; c.el.style.removeProperty('--reacao'); }
    svg.replaceChildren();
  };
}
