// Exclusão de usuários (somente ADMIN). O servidor decide se a conta pode ser excluída
// (sem histórico, não é admin, não é você) e reavalia no momento da exclusão.
import { api, get, post } from '../api.js';
import { h, selo, modal, toast, toastErro, tabelaRemota, atrasar, acessoNegado, acoesLinha } from '../ui.js';
import { navAdmin } from './admin-painel.js';

const ROT_PERFIL = { ADMIN: 'Admin', DIRETORIA: 'Diretoria', GERENTE: 'Gerente', VENDEDOR: 'Vendedor', ESTOQUE: 'Estoque', FINANCEIRO: 'Financeiro', CONSULTA: 'Consulta', SEM_ACESSO: 'Sem acesso' };

export async function render(ctx) {
  ctx.migalhas(['Administração', 'Excluir usuários']);
  try { await get('/api/admin/perfis'); } catch (e) { if (e.status === 403) return acessoNegado(); throw e; }

  const estado = { q: '', perfil: 'todos', ordem: 'nome', direcao: 'asc', pagina: 1, tamanho: 10, exclusao: '1' };
  const tabela = tabelaRemota({
    estado,
    carregar: (e) => get('/api/admin/usuarios', e),
    rotuloVazio: 'Nenhum usuário encontrado.',
    colunas: [
      { chave: 'nome', titulo: 'Nome completo', ordenavel: true, quebra: true, render: (u) => h('span', {}, u.nome, u.voce ? h('span', { class: 'muted' }, ' (você)') : null) },
      { chave: 'login', titulo: 'Usuário', ordenavel: true, render: (u) => h('code', {}, u.login) },
      { chave: 'perfil', titulo: 'Perfil', ordenavel: true, render: (u) => selo(ROT_PERFIL[u.perfil] || u.perfil, u.admin ? 'info' : 'neutro') },
      { chave: 'ativo', titulo: 'Conta', render: (u) => (u.ativo ? selo('Ativa', 'ok') : selo('Inativa', 'neutro')) },
      { chave: 'exclusao', titulo: 'Pode excluir?', quebra: true, render: (u) => h('span', {},
        u.exclusao.permitida ? selo('Sim', 'ok') : selo('Não', 'erro'), h('small', { class: 'muted' }, ' ' + u.exclusao.motivo)) },
      // Excluir é a ação desta tela; desativar (passo anterior para contas com histórico) fica em "Mais ações".
      { chave: 'acao', titulo: 'Ação', render: (u) => acoesLinha(
        h('button', { class: 'btn btn-pequeno btn-perigo-cheio', disabled: !u.exclusao.permitida, onclick: () => confirmarExclusao(u) }, 'Excluir'), [
          !u.exclusao.permitida && u.ativo && !u.voce
            ? { rotulo: 'Desativar conta (para poder excluir)', sensivel: true, acao: () => desativar(u) } : null,
        ]) },
    ],
  });

  // Confirmação forte: é preciso digitar o login, porque a exclusão não pode ser desfeita.
  function confirmarExclusao(u) {
    const campo = h('input', { autocomplete: 'off', 'aria-label': `Digite ${u.login} para confirmar`, placeholder: u.login });
    const msg = h('p', { class: 'erro-form', role: 'alert' });
    const excluir = h('button', { class: 'btn btn-perigo-cheio', disabled: true, onclick: async () => {
      excluir.disabled = true;
      try {
        const r = await api('DELETE', `/api/admin/usuarios/${u.id}`, { confirmacao: campo.value.trim() });
        toast(`Usuário ${r.login} (${r.nome}) excluído definitivamente.${r.login_reservado ? ' O histórico foi mantido e o login ficou reservado.' : ''}`, 'ok', 'Usuário excluído');
        m.fechar();
      } catch (e) { msg.textContent = e.message; toastErro(e, 'A exclusão NÃO foi feita'); excluir.disabled = false; }
      tabela.atualizar();
    } }, 'Excluir definitivamente');
    campo.addEventListener('input', () => { excluir.disabled = campo.value.trim().toLowerCase() !== u.login.toLowerCase(); });
    const m = modal({
      titulo: 'Excluir usuário', tamanho: 'pequeno',
      corpo: h('div', {},
        h('p', { style: 'margin-top:0' }, 'Deseja realmente excluir a conta de ', h('strong', {}, u.nome), ` (${u.login})? `,
          'Esta ação ', h('strong', {}, 'não pode ser desfeita'), u.exclusao.historico
            ? ': a conta sai do banco, mas pedidos, movimentos e auditoria feitos por ela são mantidos. O login ficará reservado e não poderá ser criado de novo. A exclusão fica registrada na auditoria.'
            : ': a conta sai do banco e o login fica livre. A exclusão fica registrada na auditoria.'),
        h('label', { style: 'display:grid;gap:4px;font-weight:600' }, `Para confirmar, digite o login: ${u.login}`, campo), msg),
      rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), excluir],
    });
  }

  async function desativar(u) {
    try {
      await post(`/api/admin/usuarios/${u.id}/ativo`, { ativo: false });
      toast(`Conta de ${u.nome} desativada. Agora ela pode ser excluída.`, 'ok', 'Conta desativada');
    } catch (e) { toastErro(e, 'A alteração NÃO foi feita'); }
    tabela.atualizar();
  }

  const busca = h('input', { type: 'search', placeholder: 'Nome ou usuário…', 'aria-label': 'Pesquisar usuários', autofocus: true });
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; estado.pagina = 1; tabela.atualizar(); }, 250));
  tabela.atualizar();
  return h('div', {},
    h('div', { class: 'adm-cab' }, h('h1', {}, 'Excluir usuários', h('span', { class: 'selo info selo-admin' }, 'Admin'))),
    navAdmin(ctx, 'excluir'),
    h('div', { class: 'aviso alerta', style: 'margin-bottom:12px' },
      'Contas sem histórico podem ser excluídas direto. Contas com histórico (pedidos, movimentações, baixas, alterações) precisam ser desativadas primeiro; depois podem ser excluídas: o histórico continua no banco e o login fica reservado para não ser reutilizado.'),
    h('section', { class: 'bi-tile' }, h('div', { class: 'filtros', role: 'search' }, h('label', {}, 'Pesquisar', busca)), tabela.el));
}
