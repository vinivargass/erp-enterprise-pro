// Ajuda: orientações de uso e a lista dos módulos que ESTE usuário pode abrir (mesmas permissões do menu).
import { h, cabecalho } from '../ui.js';
import { MENU, icone, liberado } from '../modulos.js';

export async function render(ctx) {
  const modulos = MENU.filter((m) => m.descricao && m.rota !== 'ajuda' && liberado(ctx.usuario, m));
  const topico = (titulo, ...itens) => h('section', { class: 'ajuda-topico' }, h('h2', {}, titulo), h('ul', {}, itens.map((t) => h('li', {}, t))));
  return h('div', { class: 'ajuda' },
    cabecalho('Ajuda', 'Como usar o sistema e a sua mesa de trabalho.'),
    h('div', { class: 'ajuda-grade' },
      topico('Sua mesa de trabalho',
        'Em "Minhas tarefas", crie lembretes com prazo e prioridade. A aba "Hoje" mostra o que vence hoje e o que está atrasado.',
        'Marque a caixa da tarefa para concluí-la; em "Concluídas" você pode reabri-la.',
        'Clique em um dia do calendário para ver as tarefas com prazo naquela data.',
        'As anotações e as tarefas são só suas: ninguém mais as vê.',
        'Em "Personalizar", escolha até quatro atalhos e mostre ou oculte o calendário e as anotações.'),
      topico('Preferências',
        'Idioma: use o globo no topo da tela.',
        'Tema claro ou escuro: use o botão de sol ou lua no topo da tela; "Seguir sistema" fica no menu com o seu nome.',
        'Para sair, abra o menu com o seu nome e escolha "Sair do sistema".'),
      topico('Acesso',
        'Você vê apenas os módulos liberados para o seu perfil. O bloqueio também é feito no servidor.',
        'Para pedir acesso a outro módulo, fale com o administrador do sistema.')),
    h('section', { class: 'ajuda-topico' }, h('h2', {}, 'Módulos liberados para você'),
      modulos.length ? h('ul', { class: 'ajuda-modulos' }, modulos.map((m) => h('li', {},
        h('a', { href: '#/' + m.rota }, icone(m.ic, 20), h('span', {}, h('strong', {}, m.rotulo), h('small', {}, m.descricao))))))
        : h('p', { class: 'muted' }, 'Seu acesso ainda não possui módulos liberados. Entre em contato com o administrador.')));
}
