'use strict';
// DADOS DE DEMONSTRAÇÃO — empresa, clientes, fornecedores e produtos FICTÍCIOS.
// CPFs/CNPJs são gerados matematicamente válidos a partir de bases arbitrárias; não pertencem
// a pessoas ou empresas reais conhecidas. O histórico é criado pelos próprios serviços
// (com relógio simulado), então saldos, títulos e indicadores são consistentes entre si.
const { hashSenha, permissoesEfetivas } = require('./auth');
const base = require('./services/base');
const clientes = require('./services/clientes');
const produtos = require('./services/produtos');
const pedidos = require('./services/pedidos');
const estoque = require('./services/estoque');
const financeiro = require('./services/financeiro');

const SENHA_DEMO = 'Demo@2026';

function dvCnpj(b12) {
  const calc = (b) => {
    const pesos = b.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const r = pesos.reduce((s, p, i) => s + Number(b[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(b12);
  return b12 + d1 + calc(b12 + d1);
}
function dvCpf(b9) {
  let c = b9;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    c += ((s * 10) % 11) % 10;
  }
  return c;
}

// PRNG determinístico: o seed sempre gera o mesmo histórico.
function prng(semente) {
  let a = semente;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function popular(db, agoraReal = () => new Date()) {
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0) return false;
  const rnd = prng(20261020);
  let relogio = new Date(agoraReal());
  const ctxDe = (login) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login);
    return { db, usuario: { id: u.id, login: u.login, perfil: u.perfil, permissoes: permissoesEfetivas(u.perfil, []) }, agora: () => relogio };
  };

  const usuarios = [
    ['admin', 'Administrador Demo', 'ADMIN'], ['diretoria', 'Diretora Demo', 'DIRETORIA'], ['gerente', 'Gerente Comercial Demo', 'GERENTE'],
    ['vendedor', 'Vendedor Demo', 'VENDEDOR'], ['estoque', 'Almoxarife Demo', 'ESTOQUE'],
    ['financeiro', 'Analista Financeiro Demo', 'FINANCEIRO'], ['consulta', 'Auditor Somente Leitura', 'CONSULTA'],
  ];
  const insU = db.prepare('INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES (?,?,?,?)');
  const hash = hashSenha(SENHA_DEMO);
  for (const [l, n, p] of usuarios) insU.run(l, n, p, hash);

  const insP = db.prepare('INSERT INTO parametros (chave, valor, tipo, descricao) VALUES (?,?,?,?)');
  for (const p of base.PARAMETROS_PADRAO) insP.run(...p);

  const insC = db.prepare('INSERT INTO condicoes_pagamento (codigo, descricao, dias) VALUES (?,?,?)');
  [['001', 'À vista', '0'], ['002', '30 dias', '30'], ['003', '30/60 dias', '30,60'], ['004', '30/60/90 dias', '30,60,90']]
    .forEach((c) => insC.run(...c));

  const insF = db.prepare('INSERT INTO fornecedores (codigo, razao_social, documento) VALUES (?,?,?)');
  const fornecedores = [
    ['F00001', 'Aços Planalto Ind. e Com. Ltda (fictícia)', dvCnpj('112223330001')],
    ['F00002', 'Transportadora Rota Sul Ltda (fictícia)', dvCnpj('223334440001')],
    ['F00003', 'Embalagens Vale Verde S.A. (fictícia)', dvCnpj('334445550001')],
    ['F00004', 'Energia & Utilidades Demo Ltda (fictícia)', dvCnpj('445556660001')],
  ];
  fornecedores.forEach((f) => insF.run(...f));

  // Começa o histórico ~6 meses atrás.
  const inicio = new Date(agoraReal());
  inicio.setMonth(inicio.getMonth() - 6, 1);
  inicio.setHours(9, 0, 0, 0);
  relogio = new Date(inicio);
  const admin = ctxDe('admin');

  const dadosClientes = [
    ['Metalúrgica Horizonte Ltda', 'Metal Horizonte', 'J', dvCnpj('101010100001'), 'Campinas', 'SP', 150000],
    ['Construtora Pedra Alta S.A.', 'Pedra Alta', 'J', dvCnpj('202020200001'), 'Belo Horizonte', 'MG', 250000],
    ['Comercial Rio Claro Ltda', 'Rio Claro Com.', 'J', dvCnpj('303030300001'), 'Curitiba', 'PR', 80000],
    ['Instaladora Faísca Elétrica ME', 'Faísca', 'J', dvCnpj('404040400001'), 'Joinville', 'SC', 40000],
    ['Hidráulica Fonte Nova Ltda', 'Fonte Nova', 'J', dvCnpj('505050500001'), 'Porto Alegre', 'RS', 60000],
    ['Distribuidora Norte Sul Ltda', 'Norte Sul', 'J', dvCnpj('606060600001'), 'Goiânia', 'GO', 120000],
    ['Engenharia Ponto Fixo Ltda', 'Ponto Fixo', 'J', dvCnpj('707070700001'), 'Salvador', 'BA', 90000],
    ['Mariana Souza Demonstração', 'Mariana Souza', 'F', dvCpf('123123123'), 'São Paulo', 'SP', 8000],
    ['Carlos Pereira Demonstração', 'Carlos Pereira', 'F', dvCpf('456456456'), 'Recife', 'PE', 5000],
    ['Obras Rápidas Serviços Ltda', 'Obras Rápidas', 'J', dvCnpj('808080800001'), 'Campinas', 'SP', 15000],
    ['Indústria Elo Forte Ltda', 'Elo Forte', 'J', dvCnpj('909090900001'), 'Sorocaba', 'SP', 200000],
    ['Comércio Antigo Inativo Ltda', 'Antigo', 'J', dvCnpj('121212120001'), 'Santos', 'SP', 10000],
  ];
  const conds = ['002', '003', '002', '001', '003', '004', '002', '001', '001', '002', '004', '002'];
  const cliIds = dadosClientes.map(([rs, nf, tp, doc, mun, uf, lim], i) => clientes.incluir(admin, {
    razao_social: rs, nome_fantasia: nf, tipo_pessoa: tp, documento: doc, inscricao_estadual: tp === 'J' ? 'ISENTO' : '',
    cep: String(10000000 + i * 1234567).slice(0, 8), logradouro: `Rua Demonstração ${i + 1}`, numero: String(100 + i * 7),
    bairro: 'Centro', municipio: mun, uf, telefone: `(11) 3000-${String(1000 + i).slice(-4)}`,
    email: `contato${i + 1}@exemplo.com.br`, cond_pagto: conds[i], limite_credito: lim,
    vendedor: i < 11 ? 'vendedor' : null, // carteira do vendedor demo (o último cliente fica sem vendedor)
  }).id);

  const dadosProdutos = [
    ['TUB-001', 'Tubo aço carbono 1" x 6m', 'TUBO', 'PC', 'PA', 189.9, 121.5, 400, 80, '73063000'],
    ['TUB-002', 'Tubo aço galvanizado 2" x 6m', 'TUBO', 'PC', 'PA', 342.0, 230.0, 220, 60, '73063000'],
    ['TUB-003', 'Tubo inox 304 3/4" x 6m', 'TUBO', 'PC', 'PA', 612.5, 455.0, 70, 30, '73064000'],
    ['ELE-001', 'Eletroduto PVC 3/4" x 3m', 'ELET', 'PC', 'PA', 14.9, 7.8, 1800, 400, '39172300'],
    ['ELE-002', 'Eletroduto aço galv. 1" x 3m', 'ELET', 'PC', 'PA', 67.4, 41.0, 600, 150, '73063000'],
    ['CON-001', 'Curva 90° aço 1"', 'CONX', 'UN', 'PA', 22.5, 11.9, 900, 200, '73079300'],
    ['CON-002', 'Luva aço galvanizado 2"', 'CONX', 'UN', 'PA', 18.75, 9.4, 1200, 250, '73071920'],
    ['CON-003', 'Abraçadeira tipo D 1"', 'CONX', 'UN', 'PA', 3.9, 1.6, 4000, 800, '73269090'],
    ['CHA-001', 'Chapa aço 3mm 1200x3000', 'CHAP', 'PC', 'MP', 980.0, 760.0, 45, 20, '72085200'],
    ['PER-001', 'Perfil U enrijecido 150mm x 6m', 'PERF', 'PC', 'PA', 265.0, 178.0, 160, 40, '72166110'],
    ['FIX-001', 'Parafuso sextavado 1/2" x 2" (cx 50)', 'FIXA', 'CX', 'PA', 78.0, 39.5, 300, 60, '73181500'],
    ['TIN-001', 'Tinta esmalte sintético cinza 3,6L', 'TINT', 'UN', 'ME', 129.9, 74.0, 90, 25, '32089010'],
    ['EMB-001', 'Fita de arquear 16mm (rolo)', 'EMBA', 'RL', 'MC', 54.0, 31.0, 40, 30, '39206219'],
    ['SRV-001', 'Corte e rosca sob medida (hora)', 'SERV', 'HR', 'SV', 95.0, 40.0, 0, 0, ''],
  ];
  const prodIds = dadosProdutos.map(([codigo, descricao, grupo, unidade, tipo, pv, custo, saldo, min, ncm]) => produtos.incluir(admin, {
    codigo, descricao, grupo, unidade, tipo, preco_venda: pv, custo, saldo_inicial: saldo, estoque_minimo: min, ncm,
  }).id);
  const vendaveis = prodIds.filter((_, i) => dadosProdutos[i][4] !== 'SV' && dadosProdutos[i][4] !== 'MC' && dadosProdutos[i][4] !== 'MP');

  const vend = () => ctxDe('vendedor');
  const ger = () => ctxDe('gerente');
  const fin = () => ctxDe('financeiro');
  const est = () => ctxDe('estoque');

  // Histórico mensal: reposições, pedidos, faturamentos e liquidações.
  const agora = new Date(agoraReal());
  const diasTotais = Math.floor((agora - inicio) / 86400000);
  for (let dia = 1; dia < diasTotais - 3; dia += 2) {
    relogio = new Date(inicio.getTime() + dia * 86400000 + 3600000 * (1 + Math.floor(rnd() * 7)));
    if (dia % 14 === 1) {
      // reposição quinzenal dos itens que estão abaixo de 1,5x o mínimo
      for (const s of estoque.saldos(est())) {
        if (s.disponivel < s.estoque_minimo * 1.5 && s.estoque_minimo > 0 && !['EMB-001', 'TUB-003', 'CHA-001'].includes(s.codigo)) {
          estoque.movimentar(est(), { produto_id: s.id, tipo: 'E', quantidade: Math.ceil(s.estoque_minimo * 2), motivo: 'Reposição de estoque (compra demonstrativa)', referencia: 'NF-DEMO' });
        }
      }
    }
    const nItens = 1 + Math.floor(rnd() * 3);
    const escolhidos = [...new Set(Array.from({ length: nItens }, () => vendaveis[Math.floor(rnd() * vendaveis.length)]))];
    const cli = cliIds[Math.floor(rnd() * 11)]; // o último cliente fica sem pedidos e será inativado
    try {
      const p = pedidos.criar(vend(), {
        cliente_id: cli,
        itens: escolhidos.map((id) => ({ produto_id: id, quantidade: 3 + Math.floor(rnd() * 22), desconto_pct: rnd() < 0.15 ? 12 : (rnd() < 0.5 ? 5 : 0) })),
      });
      let r = pedidos.enviar(vend(), p.id, p.versao);
      if (r.status === 'PENDENTE_APROVACAO') {
        r = rnd() < 0.85 ? pedidos.aprovar(ger(), r.id, r.versao, 'Aprovação demonstrativa') : pedidos.rejeitar(ger(), r.id, r.versao, 'Condição comercial não aceita');
      }
      if (r.status === 'APROVADO') {
        if (rnd() < 0.06) pedidos.cancelar(ger(), r.id, r.versao, 'Cliente desistiu da compra');
        else pedidos.faturar(admin, r.id, r.versao); // por padrão só o Admin fatura
      }
    } catch (e) {
      if (!e.status) throw e; // erros de regra (ex.: estoque) apenas deixam o pedido em rascunho
    }
    // liquida títulos vencidos (a maioria) — alguns ficam em atraso de propósito
    const hojeSim = relogio.toLocaleDateString('sv-SE');
    const aVencer = db.prepare("SELECT id, saldo_cent, versao, vencimento, emissao FROM titulos WHERE tipo='R' AND situacao <> 'LIQUIDADO' AND vencimento <= ?").all(hojeSim);
    for (const t of aVencer) {
      if (rnd() < 0.8) financeiro.liquidar(fin(), t.id, { valor: t.saldo_cent / 100, data: t.vencimento, versao: t.versao });
    }
  }

  // Contas a pagar (lançadas direto: não há módulo de compras nesta demonstração).
  relogio = new Date(agora);
  const hoje = agora.toLocaleDateString('sv-SE');
  const somar = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const insT = db.prepare(`INSERT INTO titulos (tipo, numero, parcela, fornecedor_id, emissao, vencimento, valor_cent, saldo_cent, situacao, data_liquidacao, historico)
                           VALUES ('P', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const pagar = [
    ['NF1001', '', 1, -50, -20, 4580000, true], ['NF1002', 'A', 1, -35, -5, 1290000, false], ['NF1002', 'B', 1, -35, 25, 1290000, false],
    ['CT2001', '', 2, -18, -3, 384500, false], ['CT2002', '', 2, -6, 9, 412000, false], ['EM3001', '', 3, -10, 12, 976000, false],
    ['EN4001', '', 4, -25, -10, 1530000, true], ['EN4002', '', 4, -2, 18, 1610000, false], ['NF1003', '', 1, -3, 40, 6230000, false],
  ];
  for (const [num, parc, f, em, ve, v, pago] of pagar) {
    insT.run(num, parc, f, somar(hoje, em), somar(hoje, ve), v, pago ? 0 : v, pago ? 'LIQUIDADO' : 'ABERTO', pago ? somar(hoje, ve) : null, 'Lançamento demonstrativo');
  }

  // Situação "do dia": pedidos em diferentes estados para explorar o fluxo.
  relogio = new Date(agora.getTime() - 3600000 * 3);
  const p1 = pedidos.criar(vend(), { cliente_id: cliIds[0], itens: [{ produto_id: prodIds[0], quantidade: 20 }, { produto_id: prodIds[5], quantidade: 60, desconto_pct: 15 }], observacao: 'Desconto acima da alçada — aguarda gerente' });
  pedidos.enviar(vend(), p1.id, p1.versao);
  const p2 = pedidos.criar(vend(), { cliente_id: cliIds[9], itens: [{ produto_id: prodIds[4], quantidade: 250 }], observacao: 'Excede o limite de crédito do cliente' });
  pedidos.enviar(vend(), p2.id, p2.versao);
  const p3 = pedidos.criar(vend(), { cliente_id: cliIds[1], itens: [{ produto_id: prodIds[1], quantidade: 10 }, { produto_id: prodIds[6], quantidade: 40 }] });
  pedidos.enviar(vend(), p3.id, p3.versao);
  pedidos.criar(vend(), { cliente_id: cliIds[3], itens: [{ produto_id: prodIds[3], quantidade: 100, desconto_pct: 5 }], observacao: 'Rascunho em elaboração' });

  const ultimo = clientes.obter(admin, cliIds[11]);
  clientes.definirAtivo(admin, cliIds[11], false, ultimo.versao);
  return true;
}

module.exports = { popular, SENHA_DEMO, dvCnpj, dvCpf };
