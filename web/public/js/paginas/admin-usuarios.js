// Gestão do perfil Admin (somente ADMIN). Toda decisão de segurança é do servidor:
// esta tela só envia a intenção ("conceder"/"remover") para o id escolhido.
import { get, post } from '../api.js';
import { h, selo, confirmar, modal, toast, toastErro, dataHora, tabelaRemota, atrasar, acessoNegado, acoesLinha } from '../ui.js';
import { navAdmin } from './admin-painel.js';

const ROT_ACAO = { CONCEDER_ADMIN: 'Concedeu Admin', REMOVER_ADMIN: 'Removeu Admin', ALTERAR_PERFIL: 'Alterou perfil', ALTERAR_ACESSOS: 'Alterou acessos adicionais', DESATIVAR_CONTA: 'Desativou conta', REATIVAR_CONTA: 'Reativou conta', ALTERACAO: 'Alterou perfil' };
const COR_PERFIL = { ADMIN: 'info', DIRETORIA: 'info', GERENTE: 'alerta', VENDEDOR: 'ok', ESTOQUE: 'ok', FINANCEIRO: 'ok', CONSULTA: 'neutro', SEM_ACESSO: 'neutro' };
const ROT_PERFIL = { ADMIN: 'Admin', DIRETORIA: 'Diretoria', GERENTE: 'Gerente', VENDEDOR: 'Vendedor', ESTOQUE: 'Estoque', FINANCEIRO: 'Financeiro', CONSULTA: 'Consulta', SEM_ACESSO: 'Sem acesso' };

export async function render(ctx) {
  ctx.migalhas(['Administração', 'Usuários e perfis']);
  // Primeira consulta antes de montar a tela: se o servidor negar (403), mostra "acesso restrito".
  let catalogo;
  try { catalogo = await get('/api/admin/perfis'); } catch (e) { if (e.status === 403) return acessoNegado(); throw e; }

  // Nome legível de cada acesso adicional (vindo do catálogo do servidor).
  const ROT_ADICIONAL = Object.fromEntries(catalogo.flatMap((p) => p.adicionais.map((a) => [a.permissao, a.rotulo])));
  const rotulosAdicionais = (u) => u.adicionais.map((k) => ROT_ADICIONAL[k] || k).join(', ');
  const listaAdicionais = (l) => (l?.length ? l.map((k) => ROT_ADICIONAL[k] || k).join(', ') : 'nenhum');

  const estado = { q: ctx.query.q || '', perfil: 'todos', status: '', ordem: 'nome', direcao: 'asc', pagina: 1, tamanho: 10 };
  const resumo = h('p', { class: 'resumo-admins', 'aria-live': 'polite' });
  let adminsAtivos = 0;

  const tabela = tabelaRemota({
    estado,
    carregar: async (e) => {
      const r = await get('/api/admin/usuarios', e);
      adminsAtivos = r.admins_ativos;
      resumo.textContent = `${r.total} usuário(s) encontrado(s) · ${r.admins_ativos} administrador(es) ativo(s) no sistema.`;
      return r;
    },
    rotuloVazio: 'Nenhum usuário encontrado. Tente outro nome ou limpe os filtros.',
    colunas: [
      { chave: 'nome', titulo: 'Nome completo', ordenavel: true, quebra: true, render: (u) => h('div', { class: 'usuario-cel' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()),
        h('span', {}, u.nome, u.voce ? h('span', { class: 'muted' }, ' (você)') : null)) },
      { chave: 'login', titulo: 'Usuário', ordenavel: true, render: (u) => h('code', {}, u.login) },
      { chave: 'perfil', titulo: 'Perfil atual', ordenavel: true, render: (u) => h('span', {},
        selo(ROT_PERFIL[u.perfil] || u.perfil, COR_PERFIL[u.perfil] || 'neutro'),
        h('small', { class: 'muted' }, u.admin ? ' administrador' : ' usuário comum'),
        u.adicionais?.length ? h('small', { class: 'selo-adicional', title: rotulosAdicionais(u) }, ` +${u.adicionais.length} adicional(is)`) : null) },
      { chave: 'ativo', titulo: 'Status', ordenavel: true, render: (u) => (u.ativo ? selo('Ativa', 'ok') : selo('Inativa', 'neutro')) },
      { chave: 'acao', titulo: 'Ação', render: acaoDe },
    ],
  });

  function acaoDe(u) {
    if (u.voce) return h('span', { class: 'muted', title: 'Você não pode alterar o próprio perfil de administrador.' }, 'Seu próprio acesso');
    // Último administrador ativo: nada que reduza o acesso dele é oferecido (o servidor também bloqueia).
    const ultimo = u.admin && u.ativo && adminsAtivos <= 1;
    const principal = h('button', { class: 'btn btn-pequeno', disabled: ultimo,
      title: ultimo ? 'Último administrador ativo: conceda Admin a outra pessoa antes.' : 'Escolher o perfil e os acessos adicionais (inclusive Admin)',
      onclick: () => escolherPerfil(u) }, 'Alterar perfil');
    if (ultimo) return acoesLinha(principal);
    return acoesLinha(principal, [
      u.admin ? { rotulo: 'Remover administrador', perigo: true, acao: () => removerAdmin(u) } : null,
      u.ativo ? { rotulo: 'Desativar conta', perigo: true, acao: () => alternarAtivo(u) }
        : { rotulo: 'Reativar conta', sensivel: true, acao: () => alternarAtivo(u) },
    ]);
  }

  async function alternarAtivo(u) {
    const ok = await confirmar(u.ativo ? {
      titulo: 'Desativar conta',
      mensagem: `Deseja realmente desativar a conta de ${u.nome} (${u.login})? Ele não conseguirá mais entrar e as sessões abertas serão encerradas. Os dados e o histórico são mantidos, e a conta pode ser reativada depois.`,
      botao: 'Desativar conta', perigo: true,
    } : {
      titulo: 'Reativar conta',
      mensagem: `Deseja reativar a conta de ${u.nome} (${u.login})? Ele voltará a entrar com o perfil ${ROT_PERFIL[u.perfil] || u.perfil}.`,
      botao: 'Reativar conta',
    });
    if (!ok) return;
    try {
      const r = await post(`/api/admin/usuarios/${u.id}/ativo`, { ativo: !u.ativo });
      toast(`Conta de ${r.nome} ${r.ativo ? 'reativada' : 'desativada'}.`, 'ok', 'Conta atualizada');
    } catch (e) { toastErro(e, 'A alteração NÃO foi feita'); }
    tabela.atualizar();
    historico.atualizar();
  }

  // Janela com todos os perfis, o que cada um acessa e os acessos adicionais que o Admin pode liberar
  // (listas vindas do servidor, que valida tudo de novo ao salvar).
  function escolherPerfil(u) {
    let escolhido = u.perfil;
    const marcados = new Set(u.adicionais || []);
    const msg = h('p', { class: 'erro-form', role: 'alert' });
    const caixaAdicionais = h('div', { class: 'perfil-adicionais' });
    const contagem = h('p', { class: 'perfil-contagem', 'aria-live': 'polite' });
    const doPerfil = (perfil) => catalogo.find((p) => p.perfil === perfil);

    // Contagem a partir das permissões efetivas: as do perfil + os adicionais marcados.
    function atualizarContagem() {
      const p = doPerfil(escolhido);
      const extras = p.adicionais.filter((a) => marcados.has(a.permissao)).length;
      contagem.textContent = `Acessos efetivos: ${p.acessos.length + extras}`
        + (extras ? ` (${p.acessos.length} do perfil + ${extras} adicional(is))` : ' (padrão do perfil)');
    }
    function desenharAdicionais() {
      const p = doPerfil(escolhido);
      // ao trocar de perfil, só ficam marcados os adicionais que o novo perfil admite
      for (const k of [...marcados]) if (!p.adicionais.some((a) => a.permissao === k)) marcados.delete(k);
      caixaAdicionais.replaceChildren(
        h('h3', {}, 'Acessos adicionais'),
        p.adicionais.length
          ? h('div', { class: 'perfil-adicionais-lista' }, p.adicionais.map((a) => {
            const id = `adic-${a.permissao.replace('.', '-')}`;
            return h('label', { for: id }, h('input', { type: 'checkbox', id, checked: marcados.has(a.permissao),
              onchange: (ev) => { if (ev.target.checked) marcados.add(a.permissao); else marcados.delete(a.permissao); msg.textContent = ''; atualizarContagem(); } }),
            ' ', a.rotulo);
          }))
          : h('p', { class: 'muted' }, escolhido === 'ADMIN' ? 'O Admin já tem todos os acessos.' : 'Este perfil não tem acessos adicionais.'));
      atualizarContagem();
    }

    const opcoes = h('div', { class: 'perfis-lista', role: 'radiogroup', 'aria-label': 'Perfis disponíveis' },
      catalogo.map((p) => {
        const id = `perfil-${p.perfil}`;
        // Conta inativa não pode virar Admin (o servidor também recusa): reative antes.
        const bloqueado = p.perfil === 'ADMIN' && !u.ativo && u.perfil !== 'ADMIN';
        const radio = h('input', { type: 'radio', name: 'perfil', id, value: p.perfil, checked: p.perfil === u.perfil, disabled: bloqueado,
          title: bloqueado ? 'Conta inativa: reative antes de conceder Admin.' : null,
          onchange: () => { escolhido = p.perfil; msg.textContent = ''; desenharAdicionais(); } });
        return h('label', { class: 'perfil-opcao', for: id }, radio,
          h('div', {},
            h('div', { class: 'perfil-titulo' }, selo(ROT_PERFIL[p.perfil] || p.perfil, COR_PERFIL[p.perfil] || 'neutro'),
              p.perfil === u.perfil ? h('small', { class: 'muted' }, ' perfil atual') : null),
            h('p', { class: 'perfil-desc' }, p.descricao),
            p.acessos.length
              ? h('details', {}, h('summary', {}, `${p.acessos.length} acesso(s) do perfil`),
                h('ul', { class: 'perfil-acessos' }, p.acessos.map((a) => h('li', {}, a))))
              : h('small', { class: 'muted' }, 'Nenhum módulo liberado.')));
      }));
    desenharAdicionais();

    const salvar = h('button', { class: 'btn btn-primario', onclick: async () => {
      const lista = [...marcados].sort();
      const mudouAdicionais = lista.join() !== [...(u.adicionais || [])].sort().join();
      if (escolhido === u.perfil && !mudouAdicionais) { msg.textContent = 'Nada foi alterado: escolha outro perfil ou marque/desmarque um acesso adicional.'; return; }
      const de = ROT_PERFIL[u.perfil]; const para = ROT_PERFIL[escolhido];
      // Promoção a Admin: confirmação própria e explícita (é o único caminho para conceder Admin na tela).
      const ok = await confirmar(escolhido === 'ADMIN' && u.perfil !== 'ADMIN' ? {
        titulo: 'Conceder perfil de administrador',
        mensagem: `Deseja realmente tornar ${u.nome} (${u.login}) administrador? Ele terá acesso completo ao sistema, inclusive à gestão de usuários e perfis, e as sessões abertas dele serão encerradas.`,
        botao: 'Conceder Admin', perigo: true,
      } : escolhido !== u.perfil ? {
        titulo: 'Confirmar mudança de perfil',
        mensagem: `Deseja realmente alterar o perfil de ${u.nome} (${u.login}) de ${de} para ${para}? `
          + 'Ele passará a acessar somente o que o novo perfil (e os adicionais marcados) permite, e as sessões abertas dele serão encerradas.',
        botao: `Alterar para ${para}`, perigo: u.admin,
      } : {
        titulo: 'Confirmar acessos adicionais',
        mensagem: `Deseja salvar os acessos adicionais de ${u.nome} (${u.login})? As sessões abertas dele serão encerradas para aplicar a mudança.`,
        botao: 'Salvar acessos',
      });
      if (!ok) return;
      salvar.disabled = true;
      try {
        const r = await post(`/api/admin/usuarios/${u.id}/perfil`, { perfil: escolhido, adicionais: lista });
        toast(`${r.nome}: perfil ${ROT_PERFIL[r.perfil] || r.perfil}${r.adicionais.length ? ` + ${r.adicionais.length} acesso(s) adicional(is)` : ''}. A conta continua ativa.`, 'ok', 'Acesso atualizado');
        m.fechar();
      } catch (e) {
        msg.textContent = e.message;
        toastErro(e, 'A alteração NÃO foi feita');
      } finally { salvar.disabled = false; }
      tabela.atualizar();
      historico.atualizar();
    } }, 'Salvar');
    const m = modal({ titulo: `Perfil de acesso de ${u.nome}`, corpo: h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Cada perfil libera só as telas e ações da sua área. Os acessos adicionais complementam o perfil escolhido. O bloqueio é feito pelo servidor.'),
      opcoes, caixaAdicionais, contagem, msg),
    rodape: [h('button', { class: 'btn', onclick: () => m.fechar() }, 'Cancelar'), salvar] });
  }

  // Atalho de "Mais ações": a pessoa volta ao perfil comum que tinha antes (ou Consulta).
  async function removerAdmin(u) {
    const ok = await confirmar({
      titulo: 'Remover perfil de administrador',
      mensagem: `Deseja realmente remover o perfil de administrador de ${u.nome} (${u.login})? Ele perderá as permissões administrativas, mas sua conta continuará ativa (perfil: ${ROT_PERFIL[u.perfil_comum] || u.perfil_comum}).`,
      botao: 'Remover Admin', perigo: true,
    });
    if (!ok) { toast('Operação cancelada. Nenhuma alteração foi feita.', 'alerta'); return; }
    try {
      // A mensagem de sucesso só aparece depois que o servidor confirmou a gravação.
      const r = await post(`/api/admin/usuarios/${u.id}/remover-admin`);
      toast(`${r.nome} não é mais administrador (perfil atual: ${ROT_PERFIL[r.perfil] || r.perfil}). A conta continua ativa.`, 'ok', 'Perfil atualizado');
    } catch (e) {
      toastErro(e, 'A alteração NÃO foi feita');
    }
    tabela.atualizar();
    historico.atualizar();
  }

  // --- filtros
  const busca = h('input', { type: 'search', placeholder: 'Nome, parte do nome ou usuário…', value: estado.q, 'aria-label': 'Pesquisar usuários', autofocus: true });
  busca.addEventListener('input', atrasar(() => { estado.q = busca.value; estado.pagina = 1; tabela.atualizar(); }, 250));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por perfil' });
  const opcoes = [['todos', 'Todos'], ['admin', 'Administradores'], ['comum', 'Usuários comuns']];
  const desenharChips = () => chips.replaceChildren(...opcoes.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(estado.perfil === v),
    onclick: () => { estado.perfil = v; estado.pagina = 1; selPerfil.value = ''; desenharChips(); tabela.atualizar(); } }, t)));
  desenharChips();
  const selPerfil = h('select', { 'aria-label': 'Perfil específico', onchange: (ev) => {
    estado.perfil = ev.target.value || 'todos'; estado.pagina = 1; desenharChips(); tabela.atualizar();
  } }, h('option', { value: '' }, 'Qualquer'), catalogo.map((p) => h('option', { value: p.perfil }, ROT_PERFIL[p.perfil] || p.perfil)));
  const selStatus = h('select', { onchange: (ev) => { estado.status = ev.target.value; estado.pagina = 1; tabela.atualizar(); } },
    h('option', { value: '' }, 'Todas'), h('option', { value: 'ativo' }, 'Ativas'), h('option', { value: 'inativo' }, 'Inativas'));

  // --- histórico (trilha de auditoria imutável)
  const historico = tabelaRemota({
    estado: { pagina: 1, tamanho: 8 },
    carregar: (e) => get('/api/admin/historico-perfis', e),
    rotuloVazio: 'Nenhuma alteração de perfil registrada.',
    colunas: [
      { chave: 'data_hora', titulo: 'Data e hora', render: (a) => dataHora(a.data_hora) },
      { chave: 'administrador', titulo: 'Administrador', render: (a) => h('code', {}, a.administrador) },
      { chave: 'usuario_afetado', titulo: 'Usuário afetado', render: (a) => h('code', {}, a.usuario_afetado || '—') },
      { chave: 'acao', titulo: 'Ação', render: (a) => ROT_ACAO[a.acao] || a.acao },
      { chave: 'perfil_anterior', titulo: 'Perfil anterior', render: (a) => ROT_PERFIL[a.perfil_anterior] || a.perfil_anterior || '—' },
      { chave: 'perfil_novo', titulo: 'Perfil novo', render: (a) => ROT_PERFIL[a.perfil_novo] || a.perfil_novo || '—' },
      { chave: 'adicionais', titulo: 'Acessos adicionais', quebra: true, render: (a) => (a.adicionais_anteriores.length || a.adicionais_novos.length
        ? h('small', {}, `${listaAdicionais(a.adicionais_anteriores)} → ${listaAdicionais(a.adicionais_novos)}`) : '—') },
      { chave: 'resultado', titulo: 'Resultado', quebra: true, render: (a) => h('span', {},
        selo(a.resultado === 'SUCESSO' ? 'Sucesso' : a.resultado === 'NEGADO' ? 'Negado' : 'Falha', a.resultado === 'SUCESSO' ? 'ok' : 'erro'),
        a.motivo ? h('small', { class: 'muted' }, ' ' + a.motivo) : null) },
    ],
  });

  tabela.atualizar();
  historico.atualizar();
  return h('div', {},
    h('div', { class: 'adm-cab' }, h('h1', {}, 'Usuários e perfis', h('span', { class: 'selo info selo-admin' }, 'Admin')),
      h('button', { class: 'btn', style: 'margin-left:auto', onclick: () => { tabela.atualizar(); historico.atualizar(); } }, 'Atualizar lista')),
    navAdmin(ctx, 'usuarios'),
    h('section', { class: 'bi-tile' },
      h('div', { class: 'filtros', role: 'search' }, h('label', {}, 'Pesquisar', busca), h('div', { class: 'grupo-filtro' }, h('span', {}, 'Mostrar'), chips), h('label', {}, 'Perfil', selPerfil), h('label', {}, 'Conta', selStatus)),
      resumo, tabela.el,
      h('p', { class: 'muted', style: 'margin-bottom:0' }, 'Use "Alterar perfil" para escolher qualquer perfil (vendedor, estoque, financeiro...), ver o que cada um acessa e liberar acessos adicionais. Para tornar alguém administrador, escolha Admin em "Alterar perfil". Em "Mais ações", "Remover administrador" devolve a pessoa ao perfil comum que tinha antes (ou Consulta). As sessões abertas dela são encerradas na hora.')),
    h('section', { class: 'bi-tile', style: 'margin-top:12px', 'aria-labelledby': 'hist' },
      h('h2', { id: 'hist' }, 'Histórico de alterações de perfil'), historico.el));
}
