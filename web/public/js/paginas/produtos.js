import { get, post, put, del } from '../api.js';
import { h, cabecalho, tabelaRemota, formulario, modal, confirmar, toast, toastErro, moeda, numero, selo, atrasar } from '../ui.js';

const TIPOS = [['PA', 'PA - Produto acabado'], ['ME', 'ME - Mercadoria'], ['MP', 'MP - Matéria-prima'], ['MC', 'MC - Material de consumo'], ['SV', 'SV - Serviço']];
const UNIDADES = ['UN', 'PC', 'CX', 'KG', 'M', 'M2', 'L', 'MT', 'RL', 'HR'];

export async function render(ctx) {
  const estado = { q: ctx.query.q || '', grupo: '', tipo: '', status: 'ativo', estoque: ctx.query.estoque || '', ordem: 'codigo', direcao: 'asc', pagina: 1 };
  const grupos = await get('/api/produtos-grupos');
  const podeGravar = ctx.pode('produtos.gravar');

  const t = tabelaRemota({
    estado,
    carregar: (e) => get('/api/produtos', e),
    rotuloVazio: 'Nenhum produto encontrado.',
    colunas: [
      { chave: 'codigo', titulo: 'Código', ordenavel: true },
      { chave: 'descricao', titulo: 'Descrição', ordenavel: true, quebra: true },
      { chave: 'grupo', titulo: 'Grupo', ordenavel: true },
      { chave: 'tipo', titulo: 'Tipo / UM', render: (p) => `${p.tipo} / ${p.unidade}` },
      { chave: 'preco_venda', titulo: 'Preço de venda', ordenavel: true, num: true, render: (p) => moeda(p.preco_venda) },
      { chave: 'custo', titulo: 'Custo', num: true, render: (p) => moeda(p.custo) },
      { chave: 'saldo', titulo: 'Saldo', ordenavel: true, num: true, render: (p) => numero(p.saldo) },
      { chave: 'disponivel', titulo: 'Disponível', num: true, render: (p) => (p.abaixo_minimo ? selo(`${numero(p.disponivel)} · mín. ${numero(p.estoque_minimo)}`, 'erro') : numero(p.disponivel)) },
      { chave: 'ativo', titulo: 'Status', render: (p) => (p.ativo ? selo('Ativo', 'ok') : selo('Inativo', 'neutro')) },
      { chave: 'acoes', titulo: 'Ações', render: (p) => h('div', { class: 'acoes-linha' },
        podeGravar ? h('button', { class: 'btn btn-pequeno', onclick: () => abrirForm(p.id) }, 'Editar') : null,
        h('a', { class: 'btn btn-pequeno', href: `#/estoque?produto=${p.id}` }, 'Kardex'),
        podeGravar ? h('button', { class: 'btn btn-pequeno btn-perigo', onclick: () => excluir(p) }, 'Excluir') : null) },
    ],
  });

  async function excluir(p) {
    const ok = await confirmar({ titulo: 'Excluir produto', mensagem: `Excluir definitivamente ${p.codigo} - ${p.descricao}? Só é permitido para produtos sem movimentações ou pedidos; caso contrário, inative o cadastro.`, botao: 'Excluir', perigo: true });
    if (!ok) return;
    try { await del(`/api/produtos/${p.id}?versao=${p.versao}`); toast(`Produto ${p.codigo} excluído.`); t.atualizar(); } catch (e) { toastErro(e); }
  }

  async function abrirForm(id) {
    let atual = {};
    if (id) { try { atual = await get(`/api/produtos/${id}`); } catch (e) { toastErro(e); return; } }
    const f = formulario([
      { nome: 'codigo', rotulo: 'Código', obrigatorio: !id, col: 'c3', atributos: { maxlength: 15, readonly: !!id, style: 'text-transform:uppercase' } },
      { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, col: 'c6', atributos: { maxlength: 60 } },
      { nome: 'ativo', rotulo: 'Status', tipo: 'select', col: 'c3', vazio: false, opcoes: [['true', 'Ativo'], ['false', 'Inativo']] },
      { nome: 'grupo', rotulo: 'Grupo', obrigatorio: true, col: 'c3', atributos: { maxlength: 4, list: 'lista-grupos', style: 'text-transform:uppercase' } },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrigatorio: true, col: 'c3', opcoes: TIPOS },
      { nome: 'unidade', rotulo: 'Unidade de medida', tipo: 'select', obrigatorio: true, col: 'c3', opcoes: UNIDADES.map((u) => [u, u]) },
      { nome: 'ncm', rotulo: 'NCM (informativo)', col: 'c3', ajuda: 'Formato de 8 dígitos; não é validado contra a TIPI.', atributos: { inputmode: 'numeric', maxlength: 10 } },
      { nome: 'preco_venda', rotulo: 'Preço de venda (R$)', tipo: 'number', obrigatorio: true, col: 'c3', atributos: { min: '0.01', step: '0.01' } },
      { nome: 'custo', rotulo: 'Custo (R$)', tipo: 'number', obrigatorio: true, col: 'c3', atributos: { min: 0, step: '0.01' } },
      { nome: 'estoque_minimo', rotulo: 'Estoque mínimo', tipo: 'number', obrigatorio: true, col: 'c3', atributos: { min: 0, step: 'any' } },
      id ? { nome: 'saldo_info', rotulo: 'Saldo atual', col: 'c3', ajuda: 'Alterado somente por movimentação de estoque.', atributos: { readonly: true } }
        : { nome: 'saldo_inicial', rotulo: 'Saldo inicial', tipo: 'number', col: 'c3', ajuda: 'Gera movimentação SALDO_INICIAL.', atributos: { min: 0, step: 'any' } },
    ], { ...atual, ativo: String(atual.ativo ?? true), saldo_info: id ? numero(atual.saldo) : '', estoque_minimo: atual.estoque_minimo ?? 0, saldo_inicial: 0 });
    const msg = h('p', { class: 'erro-form', role: 'alert' });
    const salvar = h('button', { class: 'btn btn-primario', onclick: gravar }, id ? 'Salvar alterações' : 'Incluir produto');
    const m = modal({
      titulo: id ? `Alterar produto ${atual.codigo}` : 'Novo produto',
      corpo: h('div', {}, f.el, h('datalist', { id: 'lista-grupos' }, grupos.map((g) => h('option', { value: g }))), msg),
      rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), salvar],
    });
    async function gravar() {
      msg.textContent = '';
      const v = f.valores();
      const e = f.validarObrigatorios();
      if (v.preco_venda !== '' && !(v.preco_venda > 0)) e.preco_venda = 'O preço deve ser maior que zero.';
      if (v.custo !== '' && v.custo < 0) e.custo = 'O custo não pode ser negativo.';
      if (v.estoque_minimo !== '' && v.estoque_minimo < 0) e.estoque_minimo = 'Não pode ser negativo.';
      if (f.erros(e)) { msg.textContent = 'Corrija os campos destacados.'; return; }
      const corpo = { ...v, ativo: v.ativo === 'true' };
      delete corpo.saldo_info;
      if (id) { delete corpo.codigo; corpo.versao = atual.versao; }
      salvar.disabled = true;
      try {
        const r = id ? await put(`/api/produtos/${id}`, corpo) : await post('/api/produtos', corpo, { idempotente: true });
        toast(`Produto ${r.codigo} ${id ? 'alterado' : 'incluído'}.`);
        for (const a of r.avisos || []) toast(a, 'alerta', 'Atenção');
        m.fechar();
        t.atualizar();
        ctx.atualizarNotificacoes();
      } catch (err) { if (err.detalhes) f.erros(err.detalhes); msg.textContent = err.message; } finally { salvar.disabled = false; }
    }
  }

  const recarregar = () => { estado.pagina = 1; t.atualizar(); };
  const busca = h('input', { type: 'search', placeholder: 'Código ou descrição…', value: estado.q, 'aria-label': 'Pesquisar produtos' });
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; recarregar(); }));
  const sel = (rot, chave, opcoes) => h('label', {}, rot, h('select', { onchange: (ev) => { estado[chave] = ev.target.value; recarregar(); } },
    opcoes.map(([v, tx]) => h('option', { value: v, selected: estado[chave] === v }, tx))));
  t.atualizar();
  return h('div', {},
    cabecalho('Produtos', 'Equivalente Protheus: SB1 (MATA010) com saldos em SB2 — ZERPPROD.PRW',
      podeGravar ? h('button', { class: 'btn btn-primario', onclick: () => abrirForm() }, '+ Novo produto') : null),
    h('div', { class: 'filtros', role: 'search' },
      h('label', {}, 'Pesquisa', busca),
      sel('Grupo', 'grupo', [['', 'Todos'], ...grupos.map((g) => [g, g])]),
      sel('Tipo', 'tipo', [['', 'Todos'], ...TIPOS]),
      sel('Status', 'status', [['ativo', 'Ativos'], ['inativo', 'Inativos'], ['', 'Todos']]),
      sel('Estoque', 'estoque', [['', 'Qualquer'], ['abaixo', 'Abaixo do mínimo']])),
    t.el);
}
