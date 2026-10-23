// Módulos do sistema: uma única lista usada pelo menu lateral, pela busca do cabeçalho, pelo "Acesso rápido"
// e pela Ajuda. Cada item só aparece para quem tem a permissão `perm` (perm vazia = qualquer usuário
// autenticado). A permissão é conferida de novo no servidor. `rodape: true` = fica no pé do menu lateral.
import { s } from './ui.js';

// Ícones de traço fino (estilo da referência)
export const icone = (d, tam = 20) => s('svg', { viewBox: '0 0 24 24', width: tam, height: tam, 'aria-hidden': 'true' },
  s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

export const ICONES = {
  inicio: 'M3.5 10.5 12 3.5l8.5 7M5.5 9v11h4.5v-6h4v6h4.5V9',
  clientes: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.8 20c.4-3.3 2.9-5.3 6.2-5.3s5.8 2 6.2 5.3M15.5 4.4a3.5 3.5 0 0 1 0 6.4M17.6 14.9c2 .6 3.3 2.4 3.6 5.1',
  produtos: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12v9m0-9 8-4.5M12 12 4 7.5',
  pedidos: 'M6 3h12v18H6zM9 7.5h6M9 11h6M9 14.5h6M9 18h3',
  estoque: 'M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12v9m0-9 8-4.5M12 12 4 7.5',
  arquivo: 'M3.5 4.5h17v4h-17zM5 8.5V20h14V8.5M10 12h4',
  expedicao: 'M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7M6.5 18.5a1.8 1.8 0 1 0 0-.1M16.5 18.5a1.8 1.8 0 1 0 0-.1',
  receber: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM14.6 9.3c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 1.9s1 1.6 2.6 2 2.6.9 2.6 2-1.1 1.9-2.6 1.9c-1.3 0-2.3-.6-2.7-1.6M12 6.3v1.6m0 8.2v1.6',
  pagar: 'M4 7.5h15.5v11.5H5a1 1 0 0 1-1-1V6.2A1.7 1.7 0 0 1 5.7 4.5H17v3M15.5 13.2h1.5',
  executivo: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  relatorios: 'M4 20.5h16M6 20.5v-6h3v6M10.5 20.5V9h3v11.5M15 20.5V4h3v16.5',
  painel: 'M4 4v16h16M8 15l3.2-4 3 2.4L19 7.5',
  usuarios: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.4-3 2.8-5 6-5s5.6 2 6 5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.4c1.7.7 2.8 2.4 3 4.6',
  configuracoes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.2 13.6l1.6 1.2-1.8 3.1-1.9-.7a7.6 7.6 0 0 1-1.8 1l-.3 2h-3.6l-.3-2a7.6 7.6 0 0 1-1.8-1l-1.9.7-1.8-3.1 1.6-1.2a7.4 7.4 0 0 1 0-2.2L3.2 9.2 5 6.1l1.9.7a7.6 7.6 0 0 1 1.8-1l.3-2h3.6l.3 2a7.6 7.6 0 0 1 1.8 1l1.9-.7 1.8 3.1-1.6 1.2a7.4 7.4 0 0 1 0 2.2z',
  ajuda: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.6v.4',
};

export const MENU = [
  { rota: 'inicio', rotulo: 'Início', perm: '', ic: ICONES.inicio },
  { rota: 'clientes', rotulo: 'Clientes', perm: 'clientes.ler', descricao: 'Cadastro, consulta e histórico de clientes.', ic: ICONES.clientes },
  { rota: 'produtos', rotulo: 'Produtos', perm: 'produtos.ler', descricao: 'Itens, preços, grupos e estoque mínimo.', ic: ICONES.produtos },
  { rota: 'pedidos', rotulo: 'Pedidos de venda', perm: 'pedidos.ler', descricao: 'Emissão, aprovação e faturamento de pedidos.', ic: ICONES.pedidos },
  { rota: 'estoque', rotulo: 'Estoque', perm: 'estoque.ler', descricao: 'Saldos, reservas e movimentações.', ic: ICONES.estoque },
  { rota: 'expedicao', rotulo: 'Expedição', perm: 'pedidos.expedicao', descricao: 'Pedidos aprovados para separar e entregar (sem valores).', ic: ICONES.expedicao },
  { rota: 'financeiro/receber', rotulo: 'Contas a receber', perm: 'financeiro.ler', descricao: 'Títulos a receber e baixas.', ic: ICONES.receber },
  { rota: 'financeiro/pagar', rotulo: 'Contas a pagar', perm: 'financeiro.ler', descricao: 'Títulos a pagar e baixas.', ic: ICONES.pagar },
  { rota: 'relatorios', rotulo: 'Relatórios', perm: 'relatorios.ler', descricao: 'Consultas com filtros e exportação CSV.', ic: ICONES.relatorios },
  { rota: 'painel-executivo', rotulo: 'Painel executivo', perm: 'painel_executivo.ler', descricao: 'Resultados estratégicos e indicadores do negócio.', ic: ICONES.executivo },
  { rota: 'admin/painel', rotulo: 'Painel administrativo', perm: 'admin.painel', descricao: 'Visão gerencial da administração.', ic: ICONES.painel },
  { rota: 'admin/usuarios', rotulo: 'Usuários e perfis', perm: 'usuarios.gerir', descricao: 'Contas, perfis e permissões.', ic: ICONES.usuarios },
  { rota: 'configuracoes', rotulo: 'Configurações', perm: 'parametros.ler', descricao: 'Parâmetros de negócio e trilha de auditoria.', ic: ICONES.configuracoes, rodape: true },
  { rota: 'ajuda', rotulo: 'Ajuda', perm: '', descricao: 'Como usar o sistema e a sua mesa de trabalho.', ic: ICONES.ajuda, rodape: true },
];

// Atalhos do "Acesso rápido" (página Início): nome curto, descrição e ícone de cada rota permitida.
// A lista de rotas que podem virar atalho e a permissão de cada uma são definidas no servidor (services/mesa.js).
export const ATALHOS = {
  clientes: { nome: 'Clientes', desc: 'Acessar clientes', ic: ICONES.clientes },
  pedidos: { nome: 'Pedidos', desc: 'Acessar pedidos', ic: ICONES.pedidos },
  produtos: { nome: 'Produtos', desc: 'Acessar produtos', ic: ICONES.produtos },
  estoque: { nome: 'Estoque', desc: 'Acessar estoque', ic: ICONES.arquivo },
  expedicao: { nome: 'Expedição', desc: 'Separar pedidos aprovados', ic: ICONES.expedicao },
  'financeiro/receber': { nome: 'A receber', desc: 'Acessar contas a receber', ic: ICONES.receber },
  'financeiro/pagar': { nome: 'A pagar', desc: 'Acessar contas a pagar', ic: ICONES.pagar },
  relatorios: { nome: 'Relatórios', desc: 'Acessar relatórios', ic: ICONES.relatorios },
  'painel-executivo': { nome: 'Painel executivo', desc: 'Acessar resultados', ic: ICONES.executivo },
  configuracoes: { nome: 'Configurações', desc: 'Acessar parâmetros', ic: ICONES.configuracoes },
  'admin/usuarios': { nome: 'Usuários', desc: 'Acessar usuários e perfis', ic: ICONES.usuarios },
};

// O usuário pode abrir este item? (perm vazia = basta estar autenticado)
export const liberado = (usuario, m) => !m.perm || (usuario?.permissoes || []).includes(m.perm);
export const permissaoDaRota = (rota) => MENU.find((m) => m.rota === rota)?.perm;
