// Página Início — "Minha mesa de trabalho": tarefas, anotação, acesso rápido e calendário PESSOAIS.
// Tudo vem de /api/mesa e /api/tarefas, que o servidor filtra pelo usuário da sessão. Nenhum dado
// estratégico ou da empresa é consultado aqui (eles ficam no Painel executivo, com permissão própria).
import { get, post, put, del } from '../api.js';
import { h, data, formulario, modal, confirmar, toast, toastErro, carregando, falha } from '../ui.js';
import { idioma } from '../idioma.js';
import { ATALHOS, icone, liberado, permissaoDaRota } from '../modulos.js';

const IC = {
  ajustes: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  mais: 'M12 5v14M5 12h14',
  salvar: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  calendario: 'M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4',
  seta: 'm9.5 6 6 6-6 6',
  anterior: 'm14.5 6-6 6 6 6',
  pontos: 'M12 6.2v.1M12 12v.1M12 17.8v.1',
  editar: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  lixeira: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
};
const PRIORIDADES = [['ALTA', 'Alta'], ['MEDIA', 'Média'], ['NORMAL', 'Normal']];
const ROT_PRIORIDADE = Object.fromEntries(PRIORIDADES);

// Datas: 'AAAA-MM-DD' <-> Date ao meio-dia local (evita troca de dia por fuso).
const paraData = (iso) => new Date(`${iso}T12:00:00`);
const paraIso = (d) => d.toLocaleDateString('sv-SE');
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export async function render(ctx) {
  const mesa = await get('/api/mesa');
  const hoje = mesa.hoje;
  let prefs = mesa.preferencias;

  const tarefas = painelTarefas(hoje);
  const notas = painelNotas(mesa.notas);
  const calendario = painelCalendario(hoje, (dia) => tarefas.mostrarDia(dia));
  tarefas.aoVoltarParaHoje = () => calendario.selecionar(hoje, { avisar: false });
  ctx.aoSair({ podeSair: notas.podeSair, desmontar: notas.desmontar });

  const colEsq = h('div', { class: 'mesa-col' });
  const colDir = h('div', { class: 'mesa-col' });
  const grade = h('div', { class: 'mesa-grade' }, colEsq, colDir);
  // Monta (ou remonta) as colunas conforme as preferências; componentes ocultos não reservam espaço.
  function montar() {
    colEsq.replaceChildren(tarefas.el, ...(prefs.mostrar_notas ? [notas.el] : []));
    colDir.replaceChildren(painelAtalhos(ctx, prefs.atalhos, mesa.atalhos_disponiveis), ...(prefs.mostrar_calendario ? [calendario.el] : []));
    if (!prefs.mostrar_calendario) tarefas.voltarParaHoje();
  }
  montar();
  tarefas.carregar();

  const dataExtenso = maiuscula(paraData(hoje).toLocaleDateString(idioma, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const personalizar = h('button', { type: 'button', class: 'btn-contorno', onclick: () => abrirPersonalizar(ctx, prefs, mesa.atalhos_disponiveis, (novas) => { prefs = novas; montar(); }) },
    icone(IC.ajustes, 20), 'Personalizar');

  return h('div', { class: 'mesa' },
    h('header', { class: 'mesa-cab' },
      h('div', {}, h('h1', {}, 'Minha mesa de trabalho'), h('p', { class: 'mesa-data' }, dataExtenso)),
      personalizar),
    grade);
}

// ---------------------------------------------------------------------------------------------------
// Minhas tarefas
function painelTarefas(hoje) {
  const estado = { aba: 'hoje', dia: null };
  const ABAS = [['hoje', 'Hoje'], ['proximas', 'Próximas'], ['concluidas', 'Concluídas']];
  const lista = h('div', { class: 'tarefas-lista', id: 'tarefas-lista', role: 'tabpanel', 'aria-live': 'polite' });
  const faixaDia = h('div', { class: 'tarefas-dia', hidden: true });
  const botoesAba = ABAS.map(([id, rot]) => h('button', { type: 'button', role: 'tab', id: `aba-${id}`, 'aria-controls': 'tarefas-lista',
    onclick: () => trocarAba(id), onkeydown: (ev) => moverAba(ev, id) }, rot));
  const api = {};

  function marcarAbas() {
    for (const [i, [id]] of ABAS.entries()) {
      const ativa = !estado.dia && estado.aba === id;
      botoesAba[i].setAttribute('aria-selected', String(ativa));
      botoesAba[i].tabIndex = ativa || (estado.dia && i === 0) ? 0 : -1;
    }
    lista.setAttribute('aria-labelledby', estado.dia ? 'tarefas-titulo' : `aba-${estado.aba}`);
    faixaDia.hidden = !estado.dia;
    if (estado.dia) {
      faixaDia.replaceChildren(h('span', {}, `Tarefas com prazo em ${data(estado.dia)}`),
        h('button', { type: 'button', class: 'link', onclick: () => api.voltarParaHoje(true) }, 'Voltar para Hoje'));
    }
  }
  function trocarAba(id) { estado.aba = id; estado.dia = null; marcarAbas(); api.aoVoltarParaHoje?.(); carregar(); }
  function moverAba(ev, id) {
    const i = ABAS.findIndex(([x]) => x === id);
    const alvo = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ABAS.length - 1 }[ev.key];
    if (alvo === undefined) return;
    ev.preventDefault();
    const j = (alvo + ABAS.length) % ABAS.length;
    botoesAba[j].focus(); trocarAba(ABAS[j][0]);
  }

  async function carregar() {
    lista.replaceChildren(carregando());
    const q = estado.dia ? `filtro=dia&data=${estado.dia}` : `filtro=${estado.aba}`;
    let r;
    try { r = await get(`/api/tarefas?${q}`); } catch (e) { lista.replaceChildren(falha(e, carregar)); return; }
    const itens = r.itens.map(linha);
    if (r.sem_prazo.length) itens.push(h('li', { class: 'tarefas-separador', role: 'presentation' }, 'Sem prazo'), ...r.sem_prazo.map(linha));
    if (!itens.length) { lista.replaceChildren(vazio()); return; }
    lista.replaceChildren(h('ul', { class: 'tarefas' }, itens));
  }

  function vazio() {
    const textos = { hoje: 'Nenhuma tarefa para hoje.', proximas: 'Nenhuma tarefa programada.', concluidas: 'Nenhuma tarefa concluída ainda.' };
    const texto = estado.dia ? 'Nenhuma tarefa com prazo nesta data.' : textos[estado.aba];
    return h('div', { class: 'tarefas-vazio' }, h('p', {}, texto),
      estado.aba === 'concluidas' && !estado.dia ? null
        : h('button', { type: 'button', class: 'btn-contorno btn-contorno-p', onclick: () => abrirForm() }, icone(IC.mais, 16), 'Criar tarefa'));
  }

  function meta(t) {
    if (t.concluida) return t.concluida_em ? `Concluída em ${data(t.concluida_em)}` : null;
    if (t.atrasada) return `Atrasada · venceu em ${data(t.prazo)}`;
    if (t.prazo && t.prazo !== hoje && !estado.dia) return `Prazo: ${data(t.prazo)}`;
    return null;
  }

  function linha(t) {
    const caixa = h('input', { type: 'checkbox', class: 'tarefa-check', checked: t.concluida,
      'aria-label': `${t.concluida ? 'Reabrir' : 'Concluir'} tarefa: ${t.titulo}`, onchange: () => concluir(t, caixa.checked, caixa) });
    const m = meta(t);
    return h('li', { class: `tarefa${t.concluida ? ' concluida' : ''}` },
      caixa,
      h('div', { class: 'tarefa-texto' },
        h('strong', { class: 'tarefa-titulo' }, t.titulo),
        t.descricao ? h('p', { class: 'tarefa-desc' }, t.descricao) : null,
        m ? h('p', { class: `tarefa-meta${t.atrasada ? ' atrasada' : ''}` }, m) : null),
      h('span', { class: `prioridade p-${t.prioridade.toLowerCase()}` }, h('span', { class: 'ponto', 'aria-hidden': 'true' }), ROT_PRIORIDADE[t.prioridade]),
      menuAcoes(t));
  }

  function menuAcoes(t) {
    const botao = h('button', { type: 'button', class: 'tarefa-mais', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Mais ações para a tarefa: ${t.titulo}` }, icone(IC.pontos, 22));
    const item = (rot, fn, perigo) => h('li', { role: 'none' }, h('button', { type: 'button', role: 'menuitem', class: perigo ? 'perigo' : '', tabindex: -1,
      onclick: () => { fechar(); fn(); } }, rot));
    const menu = h('ul', { class: 'tarefa-menu', role: 'menu', hidden: true },
      item('Editar', () => abrirForm(t)),
      item(t.concluida ? 'Reabrir' : 'Concluir', () => concluir(t, !t.concluida)),
      item('Excluir', () => excluir(t), true));
    const opcoes = () => [...menu.querySelectorAll('[role=menuitem]')];
    const foraDele = (ev) => { if (!caixa.contains(ev.target)) fechar(); };
    function abrir() { menu.hidden = false; botao.setAttribute('aria-expanded', 'true'); opcoes()[0].focus(); document.addEventListener('mousedown', foraDele); }
    function fechar(devolver) { menu.hidden = true; botao.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', foraDele); if (devolver) botao.focus(); }
    botao.addEventListener('click', () => (menu.hidden ? abrir() : fechar()));
    menu.addEventListener('keydown', (ev) => {
      const o = opcoes(); const i = o.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); o[(i + (ev.key === 'ArrowDown' ? 1 : -1) + o.length) % o.length].focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); fechar(true); } else if (ev.key === 'Tab') fechar();
    });
    const caixa = h('div', { class: 'tarefa-acoes' }, botao, menu);
    return caixa;
  }

  async function concluir(t, concluida, caixa) {
    try {
      await post(`/api/tarefas/${t.id}/concluir`, { concluida });
      toast(concluida ? 'Tarefa concluída.' : 'Tarefa reaberta.');
      carregar();
    } catch (e) { if (caixa) caixa.checked = !concluida; toastErro(e); }
  }

  async function excluir(t) {
    const ok = await confirmar({ titulo: 'Excluir tarefa', mensagem: `Excluir a tarefa "${t.titulo}"? Esta ação não pode ser desfeita.`, botao: 'Excluir', perigo: true });
    if (!ok) return;
    try { await del(`/api/tarefas/${t.id}`); toast('Tarefa excluída.'); carregar(); } catch (e) { toastErro(e); }
  }

  function abrirForm(t) {
    const prazoPadrao = estado.dia || (estado.aba === 'hoje' ? hoje : '');
    const f = formulario([
      { nome: 'titulo', rotulo: 'Título da tarefa', obrigatorio: true, col: 'c12', atributos: { maxlength: 120, autocomplete: 'off' } },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea', col: 'c12', atributos: { maxlength: 500 } },
      { nome: 'prazo', rotulo: 'Prazo', tipo: 'date', col: 'c6' },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', vazio: false, col: 'c6', opcoes: PRIORIDADES },
    ], t ? { ...t, prazo: t.prazo || '' } : { prioridade: 'NORMAL', prazo: prazoPadrao });
    const msg = h('p', { class: 'erro-form', role: 'alert' });
    const salvar = h('button', { type: 'button', class: 'btn btn-primario', onclick: gravar }, t ? 'Salvar alterações' : 'Criar tarefa');
    const m = modal({ titulo: t ? 'Editar tarefa' : 'Nova tarefa', corpo: h('div', {}, f.el, msg),
      rodape: [h('button', { type: 'button', class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), salvar] });
    f.campo('titulo').focus();
    async function gravar() {
      msg.textContent = '';
      const v = f.valores();
      if (f.erros(f.validarObrigatorios())) return;
      salvar.disabled = true;
      try {
        if (t) await put(`/api/tarefas/${t.id}`, v); else await post('/api/tarefas', v);
        toast(t ? 'Tarefa atualizada.' : 'Tarefa criada.');
        m.fechar();
        carregar();
      } catch (e) { if (e.detalhes) f.erros(e.detalhes); msg.textContent = e.message; } finally { salvar.disabled = false; }
    }
  }

  api.carregar = carregar;
  api.mostrarDia = (dia) => { if (dia === hoje) { estado.dia = null; estado.aba = 'hoje'; } else estado.dia = dia; marcarAbas(); carregar(); };
  api.voltarParaHoje = (avisar) => {
    if (!estado.dia && estado.aba === 'hoje') return;
    estado.dia = null; estado.aba = 'hoje'; marcarAbas(); carregar();
    if (avisar) api.aoVoltarParaHoje?.();
  };
  marcarAbas();
  api.el = h('section', { class: 'painel painel-tarefas', 'aria-labelledby': 'tarefas-titulo' },
    h('div', { class: 'painel-cab' }, h('h2', { id: 'tarefas-titulo' }, 'Minhas tarefas'),
      h('button', { type: 'button', class: 'btn-contorno', onclick: () => abrirForm() }, icone(IC.mais, 20), 'Nova tarefa')),
    h('div', { class: 'abas-tarefas', role: 'tablist', 'aria-label': 'Filtrar tarefas' }, botoesAba),
    faixaDia, lista);
  return api;
}

// ---------------------------------------------------------------------------------------------------
// Anotações pessoais: o campo escreve uma nota nova; cada nota salva vira um bloquinho logo abaixo,
// que pode ser editado ou apagado. As notas ficam no servidor, separadas por usuário.
function painelNotas(notasIniciais) {
  let notas = notasIniciais;
  const editando = new Map(); // id -> textarea em edição (para avisar antes de descartar)
  const texto = h('textarea', { id: 'nota-texto', rows: 3, maxlength: 2000, placeholder: 'Adicione uma nota para lembrar depois...', 'aria-labelledby': 'notas-titulo' });
  const estadoEl = h('span', { class: 'nota-estado', role: 'status', 'aria-live': 'polite' });
  const botao = h('button', { type: 'button', class: 'btn-contorno', onclick: criar }, icone(IC.salvar, 20), 'Salvar nota');
  const blocos = h('ul', { class: 'notas-blocos', 'aria-label': 'Notas salvas' });

  const sujo = () => texto.value.trim() !== '' || [...editando.entries()].some(([id, campo]) => campo.value !== notas.find((n) => n.id === id)?.texto);
  const avisoNavegador = (ev) => { if (sujo()) { ev.preventDefault(); ev.returnValue = ''; } };
  window.addEventListener('beforeunload', avisoNavegador);
  texto.addEventListener('input', () => { estadoEl.className = 'nota-estado'; estadoEl.textContent = ''; });
  texto.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); criar(); } });
  const quando = (iso) => `${data(iso)} ${new Date(iso).toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit' })}`;

  async function criar() {
    if (!texto.value.trim()) { estadoEl.className = 'nota-estado erro'; estadoEl.textContent = 'Escreva a nota antes de salvar.'; texto.focus(); return; }
    botao.disabled = true;
    estadoEl.className = 'nota-estado';
    estadoEl.textContent = 'Salvando…';
    try {
      const n = await post('/api/notas', { texto: texto.value });
      notas = [n, ...notas];
      texto.value = '';
      estadoEl.textContent = 'Nota salva.';
      desenhar();
    } catch (e) {
      // O texto digitado fica no campo; só o aviso muda.
      estadoEl.className = 'nota-estado erro';
      estadoEl.textContent = `Não foi possível salvar: ${e.message}`;
    } finally { botao.disabled = false; }
  }

  function bloco(n) {
    if (editando.has(n.id)) return blocoEmEdicao(n);
    return h('li', { class: 'nota-bloco', dataset: { id: n.id } },
      h('p', { class: 'nota-bloco-texto' }, n.texto),
      h('div', { class: 'nota-bloco-rodape' },
        h('time', { datetime: n.atualizado_em }, quando(n.atualizado_em)),
        h('span', { class: 'nota-bloco-acoes' },
          h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Editar nota', 'data-dica': 'Editar', onclick: () => { editando.set(n.id, null); desenhar(n.id); } }, icone(IC.editar, 18)),
          h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Apagar nota', 'data-dica': 'Apagar', onclick: () => apagar(n) }, icone(IC.lixeira, 18)))));
  }

  function blocoEmEdicao(n) {
    const campo = h('textarea', { rows: 4, maxlength: 2000, 'aria-label': 'Texto da nota' }, n.texto);
    editando.set(n.id, campo);
    const msg = h('span', { class: 'nota-estado erro', role: 'alert' });
    const salvar = h('button', { type: 'button', class: 'btn btn-primario btn-pequeno', onclick: gravar }, 'Salvar');
    const cancelar = () => { editando.delete(n.id); desenhar(); blocos.querySelector(`[data-id="${n.id}"] [aria-label="Editar nota"]`)?.focus(); };
    campo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); cancelar(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); gravar(); }
    });
    async function gravar() {
      salvar.disabled = true; msg.textContent = '';
      try {
        const nova = await put(`/api/notas/${n.id}`, { texto: campo.value });
        notas = [nova, ...notas.filter((x) => x.id !== n.id)];
        editando.delete(n.id);
        desenhar();
        toast('Nota atualizada.');
      } catch (e) { msg.textContent = e.message; salvar.disabled = false; }
    }
    return h('li', { class: 'nota-bloco editando', dataset: { id: n.id } }, campo, msg,
      h('div', { class: 'nota-bloco-rodape' }, h('span'),
        h('span', { class: 'nota-bloco-acoes' }, h('button', { type: 'button', class: 'btn btn-pequeno', onclick: cancelar }, 'Cancelar'), salvar)));
  }

  async function apagar(n) {
    const ok = await confirmar({ titulo: 'Apagar nota', mensagem: 'Apagar esta nota? Esta ação não pode ser desfeita.', botao: 'Apagar', perigo: true });
    if (!ok) return;
    try {
      await del(`/api/notas/${n.id}`);
      notas = notas.filter((x) => x.id !== n.id);
      editando.delete(n.id);
      desenhar();
      toast('Nota apagada.');
      texto.focus();
    } catch (e) { toastErro(e); }
  }

  function desenhar(focarEdicao) {
    blocos.replaceChildren(...notas.map(bloco));
    blocos.hidden = !notas.length;
    if (focarEdicao) { const c = editando.get(focarEdicao); c?.focus(); c?.setSelectionRange(c.value.length, c.value.length); }
  }
  desenhar();

  return {
    el: h('section', { class: 'painel painel-notas', 'aria-labelledby': 'notas-titulo' },
      h('h2', { id: 'notas-titulo' }, 'Anotações pessoais'), texto,
      h('div', { class: 'nota-rodape' }, estadoEl, botao),
      blocos),
    podeSair: async () => !sujo() || confirmar({ titulo: 'Descartar anotação?', mensagem: 'A anotação tem alterações que ainda não foram salvas. Sair sem salvar?', botao: 'Sair sem salvar', perigo: true }),
    desmontar: () => window.removeEventListener('beforeunload', avisoNavegador),
  };
}

// ---------------------------------------------------------------------------------------------------
// Acesso rápido: só atalhos que o usuário pode abrir AGORA (o servidor já filtra; aqui conferimos de novo).
function painelAtalhos(ctx, atalhos, disponiveis) {
  const permitidos = atalhos.filter((r) => ATALHOS[r] && liberado(ctx.usuario, { perm: permissaoDaRota(r) ?? 'inexistente' }));
  const titulo = h('h2', { id: 'atalhos-titulo' }, 'Acesso rápido');
  let corpo;
  if (!disponiveis.length) {
    corpo = h('p', { class: 'atalhos-vazio' }, 'Seu acesso ainda não possui módulos liberados. Entre em contato com o administrador.');
  } else if (!permitidos.length) {
    corpo = h('p', { class: 'atalhos-vazio' }, 'Nenhum atalho escolhido. Use "Personalizar" para adicionar.');
  } else {
    corpo = h('div', { class: `atalhos${permitidos.length % 2 ? ' impar' : ''}` }, permitidos.map((r) => {
      const a = ATALHOS[r];
      return h('a', { class: 'atalho', href: '#/' + r },
        h('span', { class: 'atalho-ic' }, icone(a.ic, 30)),
        h('span', { class: 'atalho-nome' }, a.nome),
        h('span', { class: 'atalho-desc' }, a.desc),
        h('span', { class: 'atalho-seta' }, icone(IC.seta, 20)));
    }));
  }
  return h('section', { class: 'painel painel-atalhos', 'aria-labelledby': 'atalhos-titulo' }, titulo, corpo);
}

// ---------------------------------------------------------------------------------------------------
// Calendário: mês atual, semana conforme o idioma, dia de hoje e dia selecionado distintos.
function inicioDaSemana() {
  try {
    const loc = new Intl.Locale(idioma);
    const info = loc.getWeekInfo?.() || loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7; // 7 = domingo -> 0
  } catch { /* navegador sem Intl.Locale.weekInfo */ }
  return 0; // pt-BR e en-US começam no domingo
}

function painelCalendario(hoje, aoSelecionar) {
  let selecionado = hoje;
  let visivel = paraData(hoje); visivel.setDate(1);
  const primeiro = inicioDaSemana();
  const titulo = h('h2', { id: 'cal-titulo', 'aria-live': 'polite' });
  const grade = h('div', { class: 'cal-grade', role: 'grid', 'aria-labelledby': 'cal-titulo' });
  const nomesDias = h('div', { class: 'cal-semana', 'aria-hidden': 'true' });
  const api = {};

  // Cabeçalho dos dias da semana no idioma atual (DOM, SEG… / SUN, MON…).
  const base = paraData('2026-01-04'); // um domingo
  for (let i = 0; i < 7; i++) {
    const d = new Date(base); d.setDate(base.getDate() + ((primeiro + i) % 7));
    nomesDias.append(h('span', {}, d.toLocaleDateString(idioma, { weekday: 'short' }).replace('.', '').toUpperCase()));
  }

  function desenhar(focar) {
    titulo.textContent = maiuscula(visivel.toLocaleDateString(idioma, { month: 'long', year: 'numeric' }));
    const inicio = new Date(visivel);
    inicio.setDate(1 - ((visivel.getDay() - primeiro + 7) % 7));
    const ultimo = new Date(visivel.getFullYear(), visivel.getMonth() + 1, 0, 12);
    const semanas = [];
    const d = new Date(inicio);
    while (d <= ultimo || semanas.length === 0 || semanas[semanas.length - 1].length < 7) {
      if (!semanas.length || semanas[semanas.length - 1].length === 7) { if (d > ultimo) break; semanas.push([]); }
      semanas[semanas.length - 1].push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    const focavel = mesmoMes(paraData(selecionado)) ? selecionado : paraIso(visivel);
    grade.replaceChildren(...semanas.map((sem) => h('div', { role: 'row', class: 'cal-linha' }, sem.map((dia) => {
      const iso = paraIso(dia);
      const fora = !mesmoMes(dia);
      return h('div', { role: 'gridcell' }, h('button', { type: 'button',
        class: `cal-dia${fora ? ' fora' : ''}${iso === hoje ? ' hoje' : ''}${iso === selecionado ? ' selecionado' : ''}`,
        'aria-label': maiuscula(dia.toLocaleDateString(idioma, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
        'aria-pressed': String(iso === selecionado), 'aria-current': iso === hoje ? 'date' : null,
        tabindex: iso === focavel ? 0 : -1, dataset: { data: iso },
        onclick: () => api.selecionar(iso), onkeydown: (ev) => teclado(ev, dia) }, String(dia.getDate())));
    }))));
    if (focar) grade.querySelector(`[data-data="${focar}"]`)?.focus();
  }
  const mesmoMes = (d) => d.getMonth() === visivel.getMonth() && d.getFullYear() === visivel.getFullYear();

  function teclado(ev, dia) {
    const passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
    if (passo === undefined) return;
    ev.preventDefault();
    const alvo = new Date(dia); alvo.setDate(dia.getDate() + passo);
    if (!mesmoMes(alvo)) { visivel = new Date(alvo.getFullYear(), alvo.getMonth(), 1, 12); }
    desenhar(paraIso(alvo));
  }
  function mudarMes(delta) { visivel = new Date(visivel.getFullYear(), visivel.getMonth() + delta, 1, 12); desenhar(); }

  // Selecionar uma data só filtra a lista de tarefas; nenhum prazo é alterado.
  api.selecionar = (iso, { avisar = true } = {}) => {
    selecionado = iso;
    const d = paraData(iso);
    if (!mesmoMes(d)) visivel = new Date(d.getFullYear(), d.getMonth(), 1, 12);
    desenhar(avisar ? iso : undefined);
    if (avisar) aoSelecionar(iso);
  };
  desenhar();
  api.el = h('section', { class: 'painel painel-calendario', 'aria-labelledby': 'cal-titulo' },
    h('div', { class: 'cal-cab' },
      h('span', { class: 'cal-ic' }, icone(IC.calendario, 24)), titulo,
      h('div', { class: 'cal-nav' },
        h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Ir para o mês anterior', onclick: () => mudarMes(-1) }, icone(IC.anterior, 22)),
        h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Ir para o próximo mês', onclick: () => mudarMes(1) }, icone(IC.seta, 22)))),
    nomesDias, grade);
  return api;
}

// ---------------------------------------------------------------------------------------------------
// Personalizar: até 4 atalhos (entre os módulos autorizados), ordem, e exibição de calendário e anotações.
function abrirPersonalizar(ctx, prefs, disponiveis, aoSalvar) {
  const MAX = 4;
  const opcoes = disponiveis.filter((r) => ATALHOS[r] && liberado(ctx.usuario, { perm: permissaoDaRota(r) ?? 'inexistente' }));
  let escolhidos = prefs.atalhos.filter((r) => opcoes.includes(r));
  const lista = h('ul', { class: 'pers-lista' });
  const contador = h('p', { class: 'muted pers-contador', 'aria-live': 'polite' });
  const cal = h('input', { type: 'checkbox', id: 'pers-cal', checked: prefs.mostrar_calendario });
  const not = h('input', { type: 'checkbox', id: 'pers-notas', checked: prefs.mostrar_notas });
  const msg = h('p', { class: 'erro-form', role: 'alert' });

  function desenhar(focar) {
    const ordem = [...escolhidos, ...opcoes.filter((r) => !escolhidos.includes(r))];
    lista.replaceChildren(...ordem.map((r) => {
      const pos = escolhidos.indexOf(r);
      const marcado = pos >= 0;
      const nome = ATALHOS[r].nome;
      const mover = (delta, rot) => h('button', { type: 'button', class: 'btn btn-pequeno', 'aria-label': `${rot}: ${nome}`, dataset: { foco: `${r}${delta}` },
        disabled: !marcado || pos + delta < 0 || pos + delta >= escolhidos.length,
        onclick: () => { const a = escolhidos[pos + delta]; escolhidos[pos + delta] = r; escolhidos[pos] = a; desenhar(`${r}${delta}`); } }, delta < 0 ? '↑' : '↓');
      return h('li', { class: marcado ? 'marcado' : '' },
        h('label', {}, h('input', { type: 'checkbox', checked: marcado, disabled: !marcado && escolhidos.length >= MAX, dataset: { foco: r },
          onchange: (ev) => { escolhidos = ev.target.checked ? [...escolhidos, r] : escolhidos.filter((x) => x !== r); desenhar(r); } }),
        icone(ATALHOS[r].ic, 20), h('span', {}, nome)),
        h('span', { class: 'pers-ordem' }, marcado ? h('span', { class: 'muted' }, `${pos + 1}º`) : null, mover(-1, 'Subir'), mover(1, 'Descer')));
    }));
    contador.textContent = `${escolhidos.length} de ${MAX} atalhos escolhidos.`;
    if (focar) { const el = lista.querySelector(`[data-foco="${focar}"]`); (el && !el.disabled ? el : lista.querySelector(`[data-foco="${focar.replace(/-?1$/, '')}"]`))?.focus(); }
  }
  desenhar();

  async function enviar(corpo, botao) {
    msg.textContent = '';
    botao.disabled = true;
    try {
      const novas = await put('/api/mesa/preferencias', corpo);
      aoSalvar(novas);
      toast(corpo.restaurar ? 'Configuração padrão restaurada.' : 'Mesa de trabalho personalizada.');
      m.fechar();
    } catch (e) { msg.textContent = e.message; } finally { botao.disabled = false; }
  }
  const salvar = h('button', { type: 'button', class: 'btn btn-primario', onclick: () => enviar({ atalhos: escolhidos, mostrar_calendario: cal.checked, mostrar_notas: not.checked }, salvar) }, 'Salvar');
  const restaurar = h('button', { type: 'button', class: 'btn', onclick: () => enviar({ restaurar: true }, restaurar) }, 'Restaurar padrão');
  const m = modal({
    titulo: 'Personalizar mesa de trabalho',
    corpo: h('div', { class: 'pers' },
      h('h3', {}, 'Atalhos do acesso rápido'),
      opcoes.length ? [h('p', { class: 'muted' }, 'Escolha até quatro módulos e use as setas para definir a ordem.'), contador, lista]
        : h('p', { class: 'muted' }, 'Seu acesso ainda não possui módulos liberados. Entre em contato com o administrador.'),
      h('h3', {}, 'Componentes'),
      h('label', { class: 'pers-opcao', for: 'pers-cal' }, cal, 'Mostrar calendário'),
      h('label', { class: 'pers-opcao', for: 'pers-notas' }, not, 'Mostrar anotações'),
      msg),
    rodape: [restaurar, h('span', { class: 'espaco' }), h('button', { type: 'button', class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), salvar],
  });
}

