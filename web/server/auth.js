'use strict';
// Autenticação da DEMONSTRAÇÃO: senha com scrypt + sal, sessão opaca em cookie HttpOnly/SameSite=Strict,
// token CSRF exigido em toda requisição que altera dados, bloqueio temporário após falhas.
// No Protheus a autenticação seria do próprio AppServer (usuário Protheus/SIGACFG, Basic ou OAuth2
// no REST) — ver protheus/docs/INTEGRACAO.md.
const crypto = require('node:crypto');
const { erro, AppError } = require('./erros');

const SESSAO_MS = 8 * 60 * 60 * 1000;
const SESSAO_LEMBRAR_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 60 * 1000;

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 32);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

function conferirSenha(senha, armazenado) {
  const [alg, salHex, hHex] = String(armazenado).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 32);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Perfil -> permissões PADRÃO. A autorização é sempre verificada no servidor, a cada requisição.
// SEM_ACESSO (conta nova aguardando liberação) não tem permissão alguma.
// Permissões "de dado" (clientes.credito, produtos.custo) não abrem telas: decidem se campos sensíveis
// vão para o navegador. O escopo de registros (vendedor só vê a própria carteira e os próprios pedidos)
// fica nos serviços.
const PERMISSOES = {
  'clientes.ler': ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'FINANCEIRO', 'CONSULTA'],
  'clientes.gravar': ['ADMIN', 'GERENTE', 'VENDEDOR'],
  'clientes.inativar': ['ADMIN', 'GERENTE'],
  'clientes.carteira': ['ADMIN', 'GERENTE'],           // vendedor responsável e limite de crédito
  'clientes.credito': ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'FINANCEIRO'],
  'produtos.ler': ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'ESTOQUE', 'CONSULTA'],
  'produtos.gravar': ['ADMIN', 'GERENTE'],
  'produtos.custo': ['ADMIN', 'DIRETORIA', 'GERENTE'],
  'pedidos.ler': ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'FINANCEIRO'],
  'pedidos.gravar': ['ADMIN', 'GERENTE', 'VENDEDOR'],
  'pedidos.aprovar': ['ADMIN', 'GERENTE'],
  'pedidos.faturar': ['ADMIN'],
  'pedidos.expedicao': ['ADMIN', 'ESTOQUE'],          // pedidos aprovados para separar e entregar, sem valores
  'estoque.ler': ['ADMIN', 'DIRETORIA', 'GERENTE', 'ESTOQUE', 'CONSULTA'],
  'estoque.movimentar': ['ADMIN', 'ESTOQUE'],
  'financeiro.ler': ['ADMIN', 'DIRETORIA', 'FINANCEIRO'],
  'financeiro.liquidar': ['ADMIN', 'FINANCEIRO'],
  'financeiro.editar': ['ADMIN', 'FINANCEIRO'],       // vencimento e observação de títulos em aberto
  'relatorios.ler': ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'ESTOQUE', 'FINANCEIRO'],
  'parametros.ler': ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'ESTOQUE', 'FINANCEIRO'],
  'parametros.gravar': ['ADMIN'],
  'auditoria.ler': ['ADMIN'],
  'usuarios.gerir': ['ADMIN'],
  'admin.painel': ['ADMIN'],
  // Resultados estratégicos (faturamento, ticket, margem, contas a receber/pagar, custo do estoque).
  'painel_executivo.ler': ['ADMIN', 'DIRETORIA'],
};

// Acessos ADICIONAIS que o ADMIN pode conceder a um usuário, além do padrão do perfil. Só estes, e só
// para estes perfis; qualquer outra combinação é recusada. No perfil Consulta só há permissões de leitura.
const ADICIONAIS = {
  DIRETORIA: ['pedidos.gravar', 'pedidos.aprovar', 'pedidos.faturar', 'estoque.movimentar', 'financeiro.liquidar', 'auditoria.ler'],
  GERENTE: ['pedidos.faturar', 'financeiro.ler', 'auditoria.ler'],
  CONSULTA: ['pedidos.ler', 'financeiro.ler', 'relatorios.ler'],
};

const permissoesDoPerfil = (perfil) => Object.keys(PERMISSOES).filter((p) => PERMISSOES[p].includes(perfil));
const adicionaisPermitidos = (perfil) => ADICIONAIS[perfil] || [];

// Permissões efetivas = padrão do perfil + adicionais concedidos que o perfil ATUAL admite.
function permissoesEfetivas(perfil, adicionais = []) {
  const base = permissoesDoPerfil(perfil);
  const extras = adicionais.filter((p) => adicionaisPermitidos(perfil).includes(p) && !base.includes(p));
  return [...base, ...extras];
}
const adicionaisDoUsuario = (db, usuarioId) =>
  db.prepare('SELECT permissao FROM usuario_permissoes WHERE usuario_id = ? ORDER BY permissao').all(usuarioId).map((r) => r.permissao);

// Confere a permissão na lista efetiva do usuário da sessão (carregada do banco a cada requisição).
function exigir(usuario, permissao) {
  if (!PERMISSOES[permissao]) throw new Error(`Permissão desconhecida: ${permissao}`);
  const lista = usuario.permissoes || permissoesDoPerfil(usuario.perfil);
  if (!lista.includes(permissao)) throw erro.proibido();
}

function criarAutenticador(db, agora, { maxCadastros = MAX_CADASTROS } = {}) {
  const falhas = new Map(); // login -> { n, ate }

  // lembrar = "continuar conectado": sessão de 30 dias com cookie persistente.
  // Sem lembrar: 8 h no servidor e cookie de sessão (some ao fechar o navegador).
  function login(loginInformado, senha, lembrar = false) {
    // Login sem diferenciar maiúsculas/minúsculas e ignorando espaços nas pontas
    // ("Vinicius.Demo", " vinicius.demo " e "VINICIUS.DEMO" entram no mesmo usuário).
    const chave = String(loginInformado || '').trim().toLowerCase().slice(0, 40);
    const f = falhas.get(chave);
    if (f && f.ate > agora().getTime()) {
      throw new AppError(429, 'BLOQUEADO', 'Muitas tentativas. Aguarde um minuto e tente novamente.');
    }
    const u = db.prepare('SELECT * FROM usuarios WHERE login = ? COLLATE NOCASE AND ativo = 1').get(chave);
    // Executa o scrypt mesmo sem usuário, para não revelar por tempo de resposta se o login existe.
    const ok = conferirSenha(String(senha || ''), u ? u.senha_hash : 'scrypt$00$' + '0'.repeat(64)) && !!u;
    if (!ok) {
      // Reinicia a contagem apenas se um bloqueio anterior já expirou.
      const bloqueioExpirado = f && f.ate > 0 && f.ate <= agora().getTime();
      const n = (bloqueioExpirado ? 0 : (f?.n || 0)) + 1;
      falhas.set(chave, { n, ate: n >= MAX_FALHAS ? agora().getTime() + BLOQUEIO_MS : 0 });
      throw new AppError(401, 'CREDENCIAIS', 'Usuário ou senha inválidos.');
    }
    falhas.delete(chave);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(agora().getTime());
    db.prepare('INSERT INTO sessoes (token_hash, usuario_id, csrf, expira_em) VALUES (?,?,?,?)')
      .run(sha256(token), u.id, csrf, agora().getTime() + (lembrar ? SESSAO_LEMBRAR_MS : SESSAO_MS));
    return { token, csrf, usuario: publico(u, adicionaisDoUsuario(db, u.id)), maxAge: lembrar ? SESSAO_LEMBRAR_MS / 1000 : null };
  }

  function sessao(token) {
    if (!token) return null;
    const s = db.prepare(`SELECT s.csrf, s.expira_em, u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                          WHERE s.token_hash = ? AND u.ativo = 1`).get(sha256(token));
    if (!s || s.expira_em < agora().getTime()) return null;
    return { usuario: publico(s, adicionaisDoUsuario(db, s.id)), csrf: s.csrf };
  }

  function logout(token) { if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha256(token)); }

  // Autocadastro: a conta nasce SEMPRE com perfil SEM_ACESSO (nenhum módulo; só a página Início).
  // Perfis com mais poder só são concedidos por um ADMIN (alterarUsuario), nunca pelo próprio usuário.
  const cadastrosPorOrigem = new Map(); // ip -> [timestamps]
  function registrar(dados, origem) {
    const agoraMs = agora().getTime();
    const recentes = (cadastrosPorOrigem.get(origem) || []).filter((t) => agoraMs - t < JANELA_CADASTRO_MS);
    if (recentes.length >= maxCadastros) {
      throw new AppError(429, 'BLOQUEADO', 'Muitos cadastros a partir deste computador. Tente novamente mais tarde.');
    }
    const d = dados && typeof dados === 'object' ? dados : {};
    const nome = String(d.nome ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
    // O login guarda maiúsculas como digitadas, mas é único e comparado sem diferenciar maiúsculas/minúsculas.
    const loginNovo = String(d.login ?? '').trim();
    const senha = typeof d.senha === 'string' ? d.senha : '';
    const erros = {};
    if (nome.length < 3 || nome.length > 60) erros.nome = 'Informe o nome completo (3 a 60 caracteres).';
    if (/\s/.test(loginNovo)) erros.login = 'O usuário não pode conter espaço.';
    else if (!/^[A-Za-z0-9._-]{3,30}$/.test(loginNovo)) erros.login = 'Use 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado (sem acentos).';
    const problemaSenha = validarSenha(senha, loginNovo);
    if (problemaSenha) erros.senha = problemaSenha;
    if (d.confirmacao !== undefined && d.confirmacao !== senha) erros.confirmacao = 'As senhas não conferem.';
    if (Object.keys(erros).length) throw erro.validacao('Existem campos inválidos.', erros);
    if (db.prepare('SELECT 1 FROM logins_reservados WHERE login = ? COLLATE NOCASE').get(loginNovo)) {
      throw erro.conflito('Este login pertenceu a uma conta excluída e não pode ser reutilizado. Escolha outro.', { login: 'Login indisponível.' });
    }
    if (db.prepare('SELECT 1 FROM usuarios WHERE login = ? COLLATE NOCASE').get(loginNovo)) {
      throw erro.conflito('Este usuário já existe. Escolha outro login.', { login: 'Login já em uso.' });
    }
    try {
      db.prepare("INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES (?, ?, 'SEM_ACESSO', ?)")
        .run(loginNovo, nome, hashSenha(senha));
    } catch (e) {
      if (/UNIQUE constraint failed: usuarios\.login|ux_usuarios_login_nocase/.test(e.message)) throw erro.conflito('Este usuário já existe.', { login: 'Login já em uso.' });
      throw e;
    }
    recentes.push(agoraMs);
    cadastrosPorOrigem.set(origem, recentes);
    return login(loginNovo, senha);
  }

  return { login, sessao, logout, registrar };
}

const MAX_CADASTROS = 5;
const JANELA_CADASTRO_MS = 10 * 60 * 1000;

// Política mínima de senha da demonstração.
function validarSenha(senha, login) {
  if (senha.length < 8 || senha.length > 72) return 'A senha deve ter de 8 a 72 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha deve conter letras e números.';
  if (login && senha.toLowerCase().includes(login.toLowerCase())) return 'A senha não pode conter o login.';
  return null;
}

const PERFIS = ['ADMIN', 'DIRETORIA', 'GERENTE', 'VENDEDOR', 'ESTOQUE', 'FINANCEIRO', 'CONSULTA', 'SEM_ACESSO'];

// Descrição de cada perfil exibida na tela de gestão (os acessos em si vêm de PERMISSOES).
const DESCRICAO_PERFIS = {
  ADMIN: 'Acesso completo: todos os módulos, configurações, painel administrativo, Painel executivo e gestão de usuários e perfis.',
  DIRETORIA: 'Alta gestão: Painel executivo, relatórios e consulta a clientes, pedidos, estoque e financeiro. Sem ações operacionais por padrão (aprovar, faturar, alterar pedidos, movimentar estoque, liquidar), que o administrador pode liberar como acesso adicional.',
  GERENTE: 'Gestão comercial: clientes, produtos e carteira dos vendedores; cria, aprova e rejeita pedidos e consulta os títulos ligados a eles. Faturamento, financeiro completo e auditoria só como acesso adicional.',
  VENDEDOR: 'Vendas: clientes da própria carteira e os próprios pedidos; altera o pedido só em rascunho ou devolvido. Vê a disponibilidade dos produtos, sem custos. Sem financeiro e sem movimentar estoque.',
  ESTOQUE: 'Almoxarifado: consulta produtos (sem custos), movimenta o estoque e separa os pedidos aprovados na Expedição, sem preços nem valores. Não altera pedidos nem cadastros.',
  FINANCEIRO: 'Financeiro: consulta e liquida títulos a receber e a pagar e ajusta vencimento e observação de títulos em aberto; consulta pedidos e clientes. Não altera pedidos, cadastros nem estoque, e não fatura.',
  CONSULTA: 'Somente leitura: por padrão, clientes, produtos e estoque, sem custos nem dados de crédito. O administrador pode liberar a leitura de pedidos, financeiro e relatórios. Nunca altera dados.',
  SEM_ACESSO: 'Conta sem módulos liberados: só a página Início, os dados pessoais e sair. Perfil das contas novas até um administrador liberar o acesso.',
};

// Nome legível de cada permissão (para mostrar "o que este perfil pode fazer").
const ROTULO_PERMISSOES = {
  'painel_executivo.ler': 'Painel executivo (resultados estratégicos)', 'clientes.ler': 'Ver clientes', 'clientes.gravar': 'Incluir/alterar clientes',
  'clientes.inativar': 'Inativar clientes', 'clientes.carteira': 'Definir carteira e limite de crédito dos clientes',
  'clientes.credito': 'Ver limite e crédito dos clientes', 'produtos.ler': 'Ver produtos', 'produtos.gravar': 'Incluir/alterar produtos',
  'produtos.custo': 'Ver custo dos produtos', 'pedidos.ler': 'Ver pedidos', 'pedidos.gravar': 'Criar/alterar pedidos em rascunho',
  'pedidos.aprovar': 'Aprovar/rejeitar pedidos', 'pedidos.faturar': 'Faturar pedidos', 'pedidos.expedicao': 'Expedição de pedidos aprovados',
  'estoque.ler': 'Ver estoque', 'estoque.movimentar': 'Movimentar estoque',
  'financeiro.ler': 'Ver financeiro', 'financeiro.liquidar': 'Liquidar títulos', 'financeiro.editar': 'Ajustar vencimento e observação de títulos',
  'relatorios.ler': 'Relatórios (conforme os dados liberados)',
  'parametros.ler': 'Ver parâmetros', 'parametros.gravar': 'Alterar parâmetros', 'auditoria.ler': 'Ver auditoria',
  'usuarios.gerir': 'Gerenciar usuários e perfis', 'admin.painel': 'Painel administrativo',
};
const rotulo = (k) => ROTULO_PERMISSOES[k] || k;

// Catálogo para a tela "Usuários e perfis": acessos padrão de cada perfil e os adicionais que o ADMIN pode liberar.
// A contagem de "acessos" é sempre o número de permissões (funcionalidades), nunca de registros.
function catalogoPerfis() {
  return PERFIS.map((p) => ({
    perfil: p, descricao: DESCRICAO_PERFIS[p],
    acessos: permissoesDoPerfil(p).map(rotulo),
    adicionais: adicionaisPermitidos(p).map((k) => ({ permissao: k, rotulo: rotulo(k) })),
  }));
}

function listarUsuarios(db) {
  return db.prepare('SELECT id, login, nome, perfil, ativo FROM usuarios ORDER BY login').all()
    .map((u) => ({ ...u, ativo: !!u.ativo }));
}

// ÚNICO ponto de alteração de perfil/ativação (usado pela tela de Parâmetros e pela tela
// administrativa de perfis). Deve rodar dentro de transação (o chamador garante).
// Regras:
// - quem chama já foi validado como ADMIN pela rota (permissão 'usuarios.gerir', lida do banco);
// - o admin não pode rebaixar nem desativar a si mesmo;
// - o último administrador ativo nunca perde o acesso (o sistema não fica sem admin);
// - perfil_base guarda o perfil "comum" da pessoa, para onde ela volta ao perder o Admin;
// - qualquer mudança derruba as sessões abertas do usuário afetado.
function alterarUsuario(db, admin, id, dados) {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id));
  if (!u) throw erro.naoEncontrado('Usuário não encontrado.');
  const perfil = dados.perfil ?? u.perfil;
  const ativo = dados.ativo ?? !!u.ativo;
  if (!PERFIS.includes(perfil)) throw erro.validacao('Perfil inválido.', { perfil: 'Perfil inválido.' });
  if (typeof ativo !== 'boolean') throw erro.validacao('Ativo deve ser verdadeiro ou falso.', { ativo: 'Inválido.' });
  if (u.id === admin.id && (perfil !== 'ADMIN' || !ativo)) {
    throw erro.regra('Você não pode remover o próprio acesso de administrador.');
  }
  const eraAdminAtivo = u.perfil === 'ADMIN' && !!u.ativo;
  const continuaAdminAtivo = perfil === 'ADMIN' && ativo;
  if (eraAdminAtivo && !continuaAdminAtivo) {
    const outros = db.prepare("SELECT COUNT(*) n FROM usuarios WHERE perfil = 'ADMIN' AND ativo = 1 AND id <> ?").get(u.id).n;
    if (outros === 0) throw erro.regra('Este é o último administrador ativo. Conceda o perfil Admin a outro usuário antes.');
  }
  // Ao virar ADMIN, memoriza o perfil comum atual; ao receber um perfil comum, ele passa a ser a base.
  const perfilBase = perfil === 'ADMIN' ? (u.perfil !== 'ADMIN' ? u.perfil : u.perfil_base) : perfil;
  const r = db.prepare('UPDATE usuarios SET perfil = ?, ativo = ?, perfil_base = ? WHERE id = ? AND perfil = ? AND ativo = ?')
    .run(perfil, ativo ? 1 : 0, perfilBase, u.id, u.perfil, u.ativo);
  if (r.changes !== 1) throw erro.conflito('O usuário foi alterado por outra operação. Recarregue e tente novamente.');
  // Novo perfil: adicionais que ele não admite deixam de existir (não "voltam" se o perfil antigo retornar).
  if (perfil !== u.perfil) {
    const permitidos = adicionaisPermitidos(perfil);
    for (const p of adicionaisDoUsuario(db, u.id)) {
      if (!permitidos.includes(p)) db.prepare('DELETE FROM usuario_permissoes WHERE usuario_id = ? AND permissao = ?').run(u.id, p);
    }
  }
  // Mudança de perfil/ativação vale na hora: derruba as sessões abertas do usuário.
  if (perfil !== u.perfil || ativo !== !!u.ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
  return { antes: { perfil: u.perfil, ativo: !!u.ativo }, depois: { perfil, ativo }, login: u.login, nome: u.nome };
}

// Troca o conjunto de acessos adicionais de um usuário (só os que o perfil dele admite; o resto é recusado).
// Derruba as sessões abertas, para o novo conjunto valer na hora também na tela.
function definirAdicionais(db, usuarioId, perfil, lista, responsavel, agoraIso) {
  const permitidos = adicionaisPermitidos(perfil);
  const invalidos = lista.filter((p) => !permitidos.includes(p));
  if (invalidos.length) throw erro.validacao('Acesso adicional não permitido para este perfil.', { adicionais: 'Escolha só acessos da lista deste perfil.' });
  db.prepare('DELETE FROM usuario_permissoes WHERE usuario_id = ?').run(usuarioId);
  const ins = db.prepare('INSERT INTO usuario_permissoes (usuario_id, permissao, concedido_por, concedido_em) VALUES (?, ?, ?, ?)');
  for (const p of [...new Set(lista)]) ins.run(usuarioId, p, responsavel, agoraIso);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId);
}

function publico(u, adicionais = []) {
  const permissoes = permissoesEfetivas(u.perfil, adicionais);
  return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil, permissoes,
    adicionais: adicionais.filter((p) => permissoes.includes(p) && !permissoesDoPerfil(u.perfil).includes(p)) };
}

module.exports = {
  hashSenha, conferirSenha, criarAutenticador, exigir, PERMISSOES, SESSAO_MS, PERFIS,
  validarSenha, listarUsuarios, alterarUsuario, catalogoPerfis, definirAdicionais, adicionaisDoUsuario,
  adicionaisPermitidos, permissoesEfetivas, rotulo,
};
