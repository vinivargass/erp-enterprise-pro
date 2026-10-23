// Gráficos de barras em SVG puro (uma série por gráfico, cor --serie-1),
// com dica ao passar o mouse/foco e tabela equivalente para leitores de tela.
import { h, s } from './ui.js';
import { idioma } from './idioma.js';

let dica;
function mostrarDica(ev, linhas) {
  if (!dica) { dica = h('div', { class: 'dica-grafico', role: 'tooltip' }); document.body.append(dica); }
  dica.replaceChildren(...linhas.map((l, i) => (i === 0 ? h('strong', {}, l) : h('div', {}, l))));
  dica.hidden = false;
  const r = ev.target.getBoundingClientRect?.();
  const x = ev.clientX ?? (r.left + r.width / 2);
  const y = ev.clientY ?? r.top;
  dica.style.left = Math.min(x + 12, innerWidth - dica.offsetWidth - 8) + 'px';
  dica.style.top = Math.max(y - dica.offsetHeight - 10, 8) + 'px';
}
const esconderDica = () => { if (dica) dica.hidden = true; };

function passoEixo(max) {
  if (max <= 0) return 1;
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto);
}

// Barras verticais: dados = [{ rotulo, valor, detalhe }]
let contadorGrad = 0;

export function barrasVerticais({ dados, formatar, formatarEixo = formatar, titulo, altura = 240 }) {
  const L = 640; const A = altura; const mE = 56; const mD = 8; const mT = 18; const mB = 26;
  const max = Math.max(...dados.map((d) => d.valor), 0);
  const passo = passoEixo(max);
  const topo = Math.max(passo, Math.ceil(max / passo) * passo);
  const y = (v) => mT + (A - mT - mB) * (1 - v / topo);
  const larg = (L - mE - mD) / dados.length;
  const barra = Math.min(48, larg * 0.6);
  const svg = s('svg', { class: 'grafico', viewBox: `0 0 ${L} ${A}`, role: 'img', 'aria-label': titulo });
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    svg.append(s('line', { class: 'grade', x1: mE, x2: L - mD, y1: y(v), y2: y(v) }),
      s('text', { class: 'eixo', x: mE - 8, y: y(v) + 4, 'text-anchor': 'end' }, formatarEixo(v)));
  }
  const iMax = dados.reduce((m, d, i) => (d.valor > dados[m].valor ? i : m), 0);
  dados.forEach((d, i) => {
    const cx = mE + larg * i + larg / 2;
    const yv = y(d.valor);
    const alturaBarra = Math.max(0, A - mB - yv);
    const raio = Math.min(4, alturaBarra / 2, barra / 2);
    // barra com cantos superiores arredondados e base reta (ancorada no eixo)
    const x0 = cx - barra / 2; const x1 = cx + barra / 2; const yb = A - mB;
    const caminho = alturaBarra > 0
      ? `M${x0},${yb} V${yv + raio} Q${x0},${yv} ${x0 + raio},${yv} H${x1 - raio} Q${x1},${yv} ${x1},${yv + raio} V${yb} Z` : '';
    const linhas = [d.rotulo, formatar(d.valor), d.detalhe].filter(Boolean);
    const b = s('path', { class: 'barra', d: caminho });
    const alvo = s('rect', { x: mE + larg * i, y: mT, width: larg, height: A - mT - mB, fill: 'transparent', tabindex: 0,
      'aria-label': linhas.join(', '),
      onmousemove: (ev) => { b.classList.add('ativa'); mostrarDica(ev, linhas); },
      onmouseleave: () => { b.classList.remove('ativa'); esconderDica(); },
      onfocus: (ev) => { b.classList.add('ativa'); mostrarDica(ev, linhas); },
      onblur: () => { b.classList.remove('ativa'); esconderDica(); } });
    svg.append(b, alvo, s('text', { class: 'eixo', x: cx, y: A - 8, 'text-anchor': 'middle' }, d.rotulo));
    if (i === iMax || i === dados.length - 1) {
      svg.append(s('text', { class: 'rotulo-valor', x: cx, y: yv - 6, 'text-anchor': 'middle' }, formatarEixo(d.valor)));
    }
  });
  return h('figure', { style: 'margin:0' }, svg, tabelaAcessivel(dados, formatar));
}

// Barras horizontais (categorias com rótulos longos).
export function barrasHorizontais({ dados, formatar, titulo }) {
  const L = 360; const linha = 30; const mE = 132; const mD = 44; // largura próxima da exibida: rótulos sem encolher
  const A = dados.length * linha + 8;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  const svg = s('svg', { class: 'grafico', viewBox: `0 0 ${L} ${A}`, role: 'img', 'aria-label': titulo });
  dados.forEach((d, i) => {
    const y = 4 + i * linha;
    const w = ((L - mE - mD) * d.valor) / max;
    const raio = Math.min(4, w / 2);
    const caminho = w > 0 ? `M${mE},${y + 5} H${mE + w - raio} Q${mE + w},${y + 5} ${mE + w},${y + 5 + raio} V${y + 23 - raio} Q${mE + w},${y + 23} ${mE + w - raio},${y + 23} H${mE} Z` : '';
    const linhas = [d.rotulo, formatar(d.valor), d.detalhe].filter(Boolean);
    const b = s('path', { class: 'barra', d: caminho });
    svg.append(
      s('text', { class: 'eixo', x: mE - 8, y: y + 18, 'text-anchor': 'end' }, d.rotulo), b,
      s('text', { class: 'rotulo-valor', x: mE + w + 6, y: y + 18 }, formatar(d.valor)),
      s('rect', { x: 0, y, width: L, height: linha, fill: 'transparent', tabindex: 0, 'aria-label': linhas.join(', '),
        onmousemove: (ev) => { b.classList.add('ativa'); mostrarDica(ev, linhas); },
        onmouseleave: () => { b.classList.remove('ativa'); esconderDica(); },
        onfocus: (ev) => mostrarDica(ev, linhas), onblur: esconderDica }));
  });
  return h('figure', { style: 'margin:0' }, svg, tabelaAcessivel(dados, formatar));
}

// Linha (evolução no tempo): dados = [{ rotulo, valor, detalhe }]. Linha de 2px, marcadores de 8px,
// guia vertical + dica ao passar o mouse/teclado. Uma série: sem legenda (o título a nomeia).
export function linha({ dados, formatar, formatarEixo = formatar, titulo, altura = 260 }) {
  const L = 640; const A = altura; const mE = 60; const mD = 16; const mT = 20; const mB = 26;
  const max = Math.max(...dados.map((d) => d.valor), 0);
  const passo = passoEixo(max);
  const topo = Math.max(passo, Math.ceil(max / passo) * passo);
  const y = (v) => mT + (A - mT - mB) * (1 - v / topo);
  const x = (i) => (dados.length === 1 ? (mE + L - mD) / 2 : mE + ((L - mE - mD) * i) / (dados.length - 1));
  const svg = s('svg', { class: 'grafico', viewBox: `0 0 ${L} ${A}`, role: 'img', 'aria-label': titulo });
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    svg.append(s('line', { class: 'grade', x1: mE, x2: L - mD, y1: y(v), y2: y(v) }),
      s('text', { class: 'eixo', x: mE - 8, y: y(v) + 4, 'text-anchor': 'end' }, formatarEixo(v)));
  }
  // Curva suave (Catmull-Rom → Bézier) com controle limitado à faixa do gráfico, e área em degradê.
  const pts = dados.map((d, i) => [x(i), y(d.valor)]);
  const limY = (v) => Math.min(A - mB, Math.max(mT, v));
  let caminho = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
    caminho += ` C${p1[0] + (p2[0] - p0[0]) / 6},${limY(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${limY(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
  }
  const idGrad = `grad-linha-${++contadorGrad}`;
  svg.append(s('defs', {}, s('linearGradient', { id: idGrad, x1: 0, y1: 0, x2: 0, y2: 1 },
    s('stop', { offset: '0%', style: 'stop-color:var(--serie-1);stop-opacity:var(--area-opacidade)' }),
    s('stop', { offset: '100%', style: 'stop-color:var(--serie-1);stop-opacity:0' }))),
  s('path', { class: 'area-suave', d: `${caminho} L${pts[pts.length - 1][0]},${A - mB} L${pts[0][0]},${A - mB} Z`, fill: `url(#${idGrad})` }),
  s('path', { class: 'linha', d: caminho }));
  const guia = s('line', { class: 'guia', y1: mT, y2: A - mB, x1: 0, x2: 0, visibility: 'hidden' });
  svg.append(guia);
  const iMax = dados.reduce((m, d, i) => (d.valor > dados[m].valor ? i : m), 0);
  const passoRotulo = Math.ceil(dados.length / 8);
  dados.forEach((d, i) => {
    const marca = s('circle', { class: 'marca', cx: x(i), cy: y(d.valor), r: 4 });
    const linhas = [d.rotulo, formatar(d.valor), d.detalhe].filter(Boolean);
    const larg = dados.length > 1 ? (L - mE - mD) / (dados.length - 1) : L;
    const ativar = (ev) => { guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i)); guia.setAttribute('visibility', 'visible'); marca.setAttribute('r', 6); mostrarDica(ev, linhas); };
    const desativar = () => { guia.setAttribute('visibility', 'hidden'); marca.setAttribute('r', 4); esconderDica(); };
    svg.append(marca, s('rect', { x: x(i) - larg / 2, y: mT, width: larg, height: A - mT - mB, fill: 'transparent', tabindex: 0,
      'aria-label': linhas.join(', '), onmousemove: ativar, onmouseleave: desativar, onfocus: ativar, onblur: desativar }));
    if (i % passoRotulo === 0 || i === dados.length - 1) svg.append(s('text', { class: 'eixo', x: x(i), y: A - 8, 'text-anchor': 'middle' }, d.rotulo));
    if (i === iMax || i === dados.length - 1) svg.append(s('text', { class: 'rotulo-valor', x: x(i), y: y(d.valor) - 10, 'text-anchor': 'middle' }, formatarEixo(d.valor)));
  });
  return h('figure', { style: 'margin:0' }, svg, tabelaAcessivel(dados, formatar));
}

// Rosca (parte de um todo): até 6 fatias, cores categóricas em ordem fixa (--cat-1..5, "Outros" neutro),
// separação de 2px na cor da superfície, legenda sempre presente e percentual direto nas fatias grandes.
export function rosca({ dados, formatar, titulo }) {
  const total = dados.reduce((sm, d) => sm + d.valor, 0);
  const R = 90; const r = 56; const C = 110;
  const svg = s('svg', { class: 'grafico rosca', viewBox: '0 0 220 220', role: 'img', 'aria-label': titulo });
  let ang = -Math.PI / 2;
  const ponto = (raio, a) => `${C + raio * Math.cos(a)},${C + raio * Math.sin(a)}`;
  const legenda = h('ul', { class: 'legenda' });
  dados.forEach((d, i) => {
    const frac = total ? d.valor / total : 0;
    const a2 = ang + frac * Math.PI * 2;
    const grande = frac > 0.5 ? 1 : 0;
    const cor = d.outros ? 'var(--cat-outros)' : `var(--cat-${i + 1})`;
    const pct = (frac * 100).toLocaleString(idioma, { maximumFractionDigits: 1 }) + '%';
    const linhas = [d.rotulo, formatar(d.valor), pct];
    const caminho = frac >= 0.9999
      ? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r} A${r},${r} 0 1 0 ${C},${C - r} Z`
      : `M${ponto(R, ang)} A${R},${R} 0 ${grande} 1 ${ponto(R, a2)} L${ponto(r, a2)} A${r},${r} 0 ${grande} 0 ${ponto(r, ang)} Z`;
    const fatia = s('path', { class: 'fatia', d: caminho, style: `fill:${cor}`, tabindex: 0, 'aria-label': linhas.join(', '),
      onmousemove: (ev) => mostrarDica(ev, linhas), onmouseleave: esconderDica, onfocus: (ev) => mostrarDica(ev, linhas), onblur: esconderDica });
    svg.append(fatia);
    if (frac >= 0.08) {
      const meio = (ang + a2) / 2;
      svg.append(s('text', { class: 'rotulo-fatia', x: C + ((R + r) / 2) * Math.cos(meio), y: C + ((R + r) / 2) * Math.sin(meio) + 4, 'text-anchor': 'middle' }, pct));
    }
    legenda.append(h('li', {}, h('span', { class: 'amostra', style: `background:${cor}`, 'aria-hidden': 'true' }), h('span', {}, d.rotulo), h('strong', {}, pct)));
    ang = a2;
  });
  svg.append(s('text', { class: 'centro-rot', x: C, y: C - 4, 'text-anchor': 'middle' }, 'Total'),
    s('text', { class: 'centro-val', x: C, y: C + 16, 'text-anchor': 'middle' }, formatar(total).replace(/[.,]\d{2}$/, '')));
  return h('figure', { class: 'fig-rosca' }, h('div', { class: 'rosca-corpo' }, svg, legenda), tabelaAcessivel(dados, formatar));
}

function tabelaAcessivel(dados, formatar) {
  return h('details', { class: 'tabela-grafico' }, h('summary', {}, 'Ver dados em tabela'),
    h('table', {}, h('tbody', {}, dados.map((d) => h('tr', {}, h('td', {}, d.rotulo), h('td', { class: 'num' }, formatar(d.valor)), d.detalhe ? h('td', {}, d.detalhe) : null)))));
}
