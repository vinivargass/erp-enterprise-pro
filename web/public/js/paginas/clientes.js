import { get, post, put } from '../api.js';
import {
  h, cabecalho, tabelaRemota, formulario, modal, confirmar, toast, toastErro, moeda, documento, dataHora, selo, atrasar,
  mascaraDocumento, mascaraCep, mascaraTelefone, cpfValido, cnpjValido, carregando, falha,
} from '../ui.js';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const ROTULOS = {
  razao_social: 'Razão social', nome_fantasia: 'Nome fantasia', tipo_pessoa: 'Tipo', documento: 'CPF/CNPJ', inscricao_estadual: 'Inscrição estadual',
  cep: 'CEP', logradouro: 'Logradouro', numero: 'Número', complemento: 'Complemento', bairro: 'Bairro', municipio: 'Município', uf: 'UF',
  telefone: 'Telefone', email: 'E-mail', cond_pagto: 'Condição de pagamento', limite_credito: 'Limite de crédito', ativo: 'Ativo',
};

export async function render(ctx) {
  const estado = { q: ctx.query.q || '', campo: 'todos', status: ctx.query.status || 'ativo', uf: '', ordem: 'codigo', direcao: 'asc', pagina: 1 };
  const condicoes = await get('/api/condicoes-pagamento');
  const podeGravar = ctx.pode('clientes.gravar');
  const podeInativar = ctx.pode('clientes.inativar');

  const tabela = tabelaRemota({
    estado,
    carregar: (e) => get('/api/clientes', e),
    rotuloVazio: 'Nenhum cliente encontrado com esses filtros.',
    colunas: [
      { chave: 'codigo', titulo: 'Código', ordenavel: true },
      { chave: 'razao_social', titulo: 'Razão social', ordenavel: true, quebra: true, render: (c) => h('div', {}, h('strong', {}, c.razao_social), h('div', { class: 'muted' }, c.nome_fantasia)) },
      { chave: 'documento', titulo: 'CPF/CNPJ', render: (c) => documento(c.documento) },
      { chave: 'municipio', titulo: 'Município/UF', ordenavel: true, render: (c) => `${c.municipio}/${c.uf}` },
      { chave: 'limite_credito', titulo: 'Limite de crédito', ordenavel: true, num: true, render: (c) => moeda(c.limite_credito) },
      { chave: 'ativo', titulo: 'Status', render: (c) => (c.ativo ? selo('Ativo', 'ok') : selo('Inativo', 'neutro')) },
      { chave: 'acoes', titulo: 'Ações', render: (c) => h('div', { class: 'acoes-linha' },
        h('button', { class: 'btn btn-pequeno', onclick: () => abrirFicha(c.id) }, 'Consultar'),
        podeGravar ? h('button', { class: 'btn btn-pequeno', onclick: () => abrirForm(c.id) }, 'Editar') : null,
        podeInativar ? (c.ativo
          ? h('button', { class: 'btn btn-pequeno btn-perigo', onclick: () => alternarAtivo(c, false) }, 'Inativar')
          : h('button', { class: 'btn btn-pequeno', onclick: () => alternarAtivo(c, true) }, 'Reativar')) : null) },
    ],
  });

  async function alternarAtivo(c, ativo) {
    const ok = await confirmar({
      titulo: ativo ? 'Reativar cliente' : 'Inativar cliente',
      mensagem: ativo ? `Reativar ${c.razao_social}? O cliente voltará a aceitar pedidos.`
        : `Inativar ${c.razao_social}? O cadastro e o histórico são mantidos, mas novos pedidos ficam bloqueados.`,
      botao: ativo ? 'Reativar' : 'Inativar', perigo: !ativo,
    });
    if (!ok) return;
    try {
      await post(`/api/clientes/${c.id}/${ativo ? 'reativar' : 'inativar'}`, { versao: c.versao });
      toast(`Cliente ${c.codigo} ${ativo ? 'reativado' : 'inativado'}.`);
      tabela.atualizar();
    } catch (e) { toastErro(e); }
  }

  async function abrirFicha(id) {
    const corpo = h('div', {}, carregando());
    modal({ titulo: 'Consulta de cliente', corpo });
    try {
      const [c, hist] = await Promise.all([get(`/api/clientes/${id}`), get(`/api/clientes/${id}/historico`)]);
      const linha = (r, v) => h('div', { class: 'campo c3' }, h('label', {}, r), h('div', {}, v || '—'));
      corpo.replaceChildren(
        h('div', { class: 'form-grade' },
          linha('Código', c.codigo), linha('Status', c.ativo ? selo('Ativo', 'ok') : selo('Inativo', 'neutro')),
          linha('Tipo', c.tipo_pessoa === 'J' ? 'Jurídica' : 'Física'), linha('CPF/CNPJ', documento(c.documento)),
          h('div', { class: 'campo c6' }, h('label', {}, 'Razão social'), h('div', {}, c.razao_social)),
          linha('Nome fantasia', c.nome_fantasia), linha('Inscrição estadual', c.inscricao_estadual),
          h('div', { class: 'campo c12' }, h('label', {}, 'Endereço'),
            h('div', {}, `${c.logradouro}, ${c.numero}${c.complemento ? ' - ' + c.complemento : ''} · ${c.bairro} · ${c.municipio}/${c.uf} · CEP ${mascaraCep(c.cep)}`)),
          linha('Telefone', c.telefone), linha('E-mail', c.email),
          linha('Condição de pagamento', (condicoes.find((x) => x.codigo === c.cond_pagto) || {}).descricao),
          linha('Limite de crédito', moeda(c.limite_credito)), linha('Crédito comprometido', moeda(c.credito_utilizado)),
          linha('Crédito disponível', h('strong', { style: c.credito_disponivel < 0 ? 'color:var(--erro)' : '' }, moeda(c.credito_disponivel)))),
        h('h2', { style: 'margin-top:18px' }, 'Histórico de alterações'),
        hist.length ? h('ul', { class: 'linha-tempo' }, hist.map((x) => h('li', {},
          h('div', {}, h('strong', {}, x.acao), ` · ${x.usuario} · `, h('span', { class: 'muted' }, dataHora(x.data_hora))),
          Object.entries(x.detalhes).filter(([, v]) => v && typeof v === 'object' && 'de' in v).map(([campo, v]) =>
            h('div', { class: 'muted' }, `${ROTULOS[campo] || campo}: "${v.de}" → "${v.para}"`))))) : h('p', { class: 'muted' }, 'Sem histórico.'));
    } catch (e) { corpo.replaceChildren(falha(e)); }
  }

  async function abrirForm(id) {
    let atual = {};
    if (id) { try { atual = await get(`/api/clientes/${id}`); } catch (e) { toastErro(e); return; } }
    const tipoInicial = atual.tipo_pessoa || 'J';
    const f = formulario([
      { secao: 'Identificação' },
      { nome: 'codigo', rotulo: 'Código', col: 'c2', atributos: { readonly: true, placeholder: 'automático' } },
      { nome: 'tipo_pessoa', rotulo: 'Tipo de pessoa', tipo: 'select', obrigatorio: true, col: 'c2', vazio: false, opcoes: [['J', 'Jurídica'], ['F', 'Física']] },
      { nome: 'documento', rotulo: 'CPF/CNPJ', obrigatorio: true, col: 'c3', atributos: { inputmode: 'numeric', autocomplete: 'off' } },
      { nome: 'inscricao_estadual', rotulo: 'Inscrição estadual', col: 'c3', ajuda: 'Números ou ISENTO' },
      { nome: 'ativo', rotulo: 'Status', tipo: 'select', col: 'c2', vazio: false, opcoes: [['true', 'Ativo'], ['false', 'Inativo']] },
      { nome: 'razao_social', rotulo: 'Nome / razão social', obrigatorio: true, col: 'c8', atributos: { maxlength: 80 } },
      { nome: 'nome_fantasia', rotulo: 'Nome fantasia', obrigatorio: true, atributos: { maxlength: 40 } },
      { secao: 'Endereço' },
      { nome: 'cep', rotulo: 'CEP', obrigatorio: true, col: 'c2', mascara: mascaraCep, atributos: { inputmode: 'numeric' } },
      { nome: 'logradouro', rotulo: 'Logradouro', obrigatorio: true, col: 'c6', atributos: { maxlength: 80 } },
      { nome: 'numero', rotulo: 'Número', obrigatorio: true, col: 'c2', atributos: { maxlength: 10 } },
      { nome: 'complemento', rotulo: 'Complemento', col: 'c2', atributos: { maxlength: 50 } },
      { nome: 'bairro', rotulo: 'Bairro', obrigatorio: true, atributos: { maxlength: 40 } },
      { nome: 'municipio', rotulo: 'Município', obrigatorio: true, atributos: { maxlength: 60 } },
      { nome: 'uf', rotulo: 'UF', tipo: 'select', obrigatorio: true, col: 'c2', opcoes: UFS.map((u) => [u, u]) },
      { secao: 'Contato e comercial' },
      { nome: 'telefone', rotulo: 'Telefone', col: 'c3', mascara: mascaraTelefone, atributos: { inputmode: 'tel' } },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', col: 'c3', atributos: { maxlength: 120 } },
      { nome: 'cond_pagto', rotulo: 'Condição de pagamento', tipo: 'select', obrigatorio: true, col: 'c3', opcoes: condicoes.map((c) => [c.codigo, `${c.codigo} - ${c.descricao}`]) },
      { nome: 'limite_credito', rotulo: 'Limite de crédito (R$)', tipo: 'number', obrigatorio: true, col: 'c3', atributos: { min: 0, step: '0.01' } },
    ], { ...atual, ativo: String(atual.ativo ?? true), documento: atual.documento ? mascaraDocumento(atual.documento, tipoInicial) : '', telefone: atual.telefone ? mascaraTelefone(atual.telefone) : '' });

    const tipo = f.campo('tipo_pessoa');
    const doc = f.campo('documento');
    const aplicarMascara = () => { doc.value = mascaraDocumento(doc.value, tipo.value); doc.placeholder = tipo.value === 'F' ? '000.000.000-00' : '00.000.000/0000-00'; };
    doc.addEventListener('input', aplicarMascara);
    tipo.addEventListener('change', aplicarMascara);
    aplicarMascara();

    const msg = h('p', { class: 'erro-form', role: 'alert' });
    const salvar = h('button', { class: 'btn btn-primario', onclick: gravar }, id ? 'Salvar alterações' : 'Incluir cliente');
    const m = modal({ titulo: id ? `Alterar cliente ${atual.codigo}` : 'Novo cliente', corpo: h('div', {}, f.el, msg), rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), salvar] });

    async function gravar() {
      msg.textContent = '';
      const v = f.valores();
      const erros = f.validarObrigatorios();
      const valido = v.tipo_pessoa === 'F' ? cpfValido(v.documento) : cnpjValido(v.documento);
      if (v.documento && !valido) erros.documento = v.tipo_pessoa === 'F' ? 'CPF inválido.' : 'CNPJ inválido.';
      if (f.erros(erros)) { msg.textContent = 'Corrija os campos destacados.'; return; }
      const corpo = { ...v, ativo: v.ativo === 'true', limite_credito: v.limite_credito === '' ? '' : Number(v.limite_credito) };
      delete corpo.codigo;
      salvar.disabled = true;
      try {
        const r = id ? await put(`/api/clientes/${id}`, { ...corpo, versao: atual.versao }) : await post('/api/clientes', corpo, { idempotente: true });
        toast(`Cliente ${r.codigo} ${id ? 'alterado' : 'incluído'} com sucesso.`);
        m.fechar();
        tabela.atualizar();
      } catch (e) {
        if (e.detalhes) f.erros(e.detalhes);
        msg.textContent = e.message;
      } finally { salvar.disabled = false; }
    }
  }

  const busca = h('input', { type: 'search', placeholder: 'Pesquisar…', value: estado.q, 'aria-label': 'Pesquisar clientes' });
  const recarregar = () => { estado.pagina = 1; tabela.atualizar(); };
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; recarregar(); }));
  const sel = (rot, chave, opcoes) => h('label', {}, rot, h('select', { onchange: (ev) => { estado[chave] = ev.target.value; recarregar(); } },
    opcoes.map(([v, t]) => h('option', { value: v, selected: estado[chave] === v }, t))));

  tabela.atualizar();
  return h('div', {},
    cabecalho('Clientes', 'Cadastro de clientes · equivalente Protheus: SA1 (rotina padrão CRMA980/MATA030 + ZERPCLI.PRW)',
      podeGravar ? h('button', { class: 'btn btn-primario', onclick: () => abrirForm() }, '+ Novo cliente') : null),
    h('div', { class: 'filtros', role: 'search' },
      h('label', {}, 'Pesquisa', busca),
      sel('Pesquisar em', 'campo', [['todos', 'Todos os campos'], ['codigo', 'Código'], ['nome', 'Nome'], ['documento', 'CPF/CNPJ']]),
      sel('Status', 'status', [['ativo', 'Ativos'], ['inativo', 'Inativos'], ['', 'Todos']]),
      sel('UF', 'uf', [['', 'Todas'], ...UFS.map((u) => [u, u])])),
    tabela.el);
}
