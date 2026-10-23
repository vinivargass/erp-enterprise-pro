import { get, put } from '../api.js';
import { h, cabecalho, tabela, tabelaRemota, toast, toastErro, dataHora, confirmar } from '../ui.js';

export async function render(ctx) {
  const params = await get('/api/parametros');
  const podeAlterar = ctx.pode('parametros.gravar');

  async function alterar(p, input) {
    const valor = input.value.trim().toUpperCase();
    if (valor === p.valor) return;
    const ok = await confirmar({ titulo: 'Alterar parâmetro', mensagem: `Alterar ${p.chave} de "${p.valor}" para "${valor}"? A alteração afeta novas operações imediatamente e fica registrada na auditoria.`, botao: 'Alterar' });
    if (!ok) { input.value = p.valor; return; }
    try { await put(`/api/parametros/${p.chave}`, { valor }); p.valor = valor; toast(`Parâmetro ${p.chave} alterado.`); if (aud) aud.atualizar(); } catch (e) { toastErro(e); input.value = p.valor; }
  }

  const aud = ctx.pode('auditoria.ler') ? tabelaRemota({
    estado: { pagina: 1 },
    carregar: (e) => get('/api/auditoria', e),
    colunas: [
      { chave: 'data_hora', titulo: 'Data/hora', render: (a) => dataHora(a.data_hora) },
      { chave: 'usuario', titulo: 'Usuário' },
      { chave: 'entidade', titulo: 'Entidade', render: (a) => `${a.entidade}${a.entidade_id ? ' #' + a.entidade_id : ''}` },
      { chave: 'acao', titulo: 'Ação' },
      { chave: 'detalhes', titulo: 'Detalhes', quebra: true, render: (a) => h('code', {}, JSON.stringify(a.detalhes)) },
    ],
  }) : null;
  aud?.atualizar();
  // A gestão de usuários fica em Administração → Usuários e perfis.
  const podeUsuarios = ctx.pode('usuarios.gerir');

  return h('div', {},
    cabecalho('Parâmetros e auditoria', 'Ajuste as regras de negócio do sistema e consulte o registro de alterações.'),
    h('section', { class: 'cartao' }, h('h2', {}, 'Parâmetros de negócio'),
      tabela([
        { chave: 'chave', titulo: 'Parâmetro', render: (p) => h('code', {}, p.chave) },
        { chave: 'descricao', titulo: 'Descrição', quebra: true },
        { chave: 'valor', titulo: 'Valor', render: (p) => {
          const input = h('input', { value: p.valor, style: 'width:130px', 'aria-label': `Valor de ${p.chave}`, readonly: !podeAlterar });
          if (!podeAlterar) return input;
          return h('div', { class: 'acoes-linha' }, input, h('button', { class: 'btn btn-pequeno', onclick: () => alterar(p, input) }, 'Salvar'));
        } },
      ], params),
      podeAlterar ? null : h('p', { class: 'muted' }, 'Somente o perfil ADMIN altera parâmetros.')),
    podeUsuarios ? h('p', { class: 'aviso', style: 'margin:16px 0' }, 'Usuários, perfis e contas agora são gerenciados em ',
      h('a', { href: '#/admin/usuarios' }, 'Administração → Usuários e perfis'), '.') : null,
    aud ? h('section', { class: 'cartao' }, h('h2', {}, 'Trilha de auditoria'), aud.el) : null);
}
