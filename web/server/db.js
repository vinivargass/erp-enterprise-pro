'use strict';
// Persistência da DEMONSTRAÇÃO: SQLite local (node:sqlite, embutido no Node >= 22.5).
// Isto NÃO é o banco do Protheus. No Protheus os dados ficariam em SA1/SB1/SB2/SC5/SC6/
// SD3/SE1/SE2 e tabelas Z* acessadas via DBAccess — ver protheus/dicionario/DICIONARIO.md.
//
// Convenções:
// - valores monetários em CENTAVOS (INTEGER) para evitar erro de arredondamento binário;
// - quantidades em REAL arredondadas a 4 casas na camada de serviço;
// - datas 'AAAA-MM-DD' e data/hora ISO-8601 UTC;
// - controle otimista de concorrência pela coluna `versao`.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  login       TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  perfil      TEXT NOT NULL CHECK (perfil IN ('ADMIN','DIRETORIA','GERENTE','VENDEDOR','ESTOQUE','FINANCEIRO','CONSULTA','SEM_ACESSO')),
  senha_hash  TEXT NOT NULL,
  ativo       INTEGER NOT NULL DEFAULT 1
);

-- Login único sem diferenciar maiúsculas/minúsculas ("Admin" e "admin" são o mesmo usuário).
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_login_nocase ON usuarios (login COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  csrf        TEXT NOT NULL,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS parametros (
  chave      TEXT PRIMARY KEY,
  valor      TEXT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('N','C','L')),
  descricao  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequencias (
  nome   TEXT PRIMARY KEY,
  valor  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS condicoes_pagamento (
  codigo     TEXT PRIMARY KEY,
  descricao  TEXT NOT NULL,
  dias       TEXT NOT NULL            -- ex.: '30,60,90'
);

CREATE TABLE IF NOT EXISTS clientes (
  id                  INTEGER PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,
  razao_social        TEXT NOT NULL,
  nome_fantasia       TEXT NOT NULL,
  tipo_pessoa         TEXT NOT NULL CHECK (tipo_pessoa IN ('F','J')),
  documento           TEXT NOT NULL UNIQUE,  -- só dígitos
  inscricao_estadual  TEXT NOT NULL DEFAULT '',
  cep                 TEXT NOT NULL,
  logradouro          TEXT NOT NULL,
  numero              TEXT NOT NULL,
  complemento         TEXT NOT NULL DEFAULT '',
  bairro              TEXT NOT NULL,
  municipio           TEXT NOT NULL,
  uf                  TEXT NOT NULL,
  telefone            TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  cond_pagto          TEXT NOT NULL REFERENCES condicoes_pagamento(codigo),
  limite_credito_cent INTEGER NOT NULL DEFAULT 0 CHECK (limite_credito_cent >= 0),
  ativo               INTEGER NOT NULL DEFAULT 1,
  versao              INTEGER NOT NULL DEFAULT 1,
  criado_em           TEXT NOT NULL,
  atualizado_em       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id            INTEGER PRIMARY KEY,
  codigo        TEXT NOT NULL UNIQUE,
  razao_social  TEXT NOT NULL,
  documento     TEXT NOT NULL UNIQUE,
  ativo         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS produtos (
  id                 INTEGER PRIMARY KEY,
  codigo             TEXT NOT NULL UNIQUE,
  descricao          TEXT NOT NULL,
  grupo              TEXT NOT NULL,
  unidade            TEXT NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('PA','ME','MP','MC','SV')),
  preco_venda_cent   INTEGER NOT NULL CHECK (preco_venda_cent > 0),
  custo_cent         INTEGER NOT NULL CHECK (custo_cent >= 0),
  saldo              REAL NOT NULL DEFAULT 0,
  reservado          REAL NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  estoque_minimo     REAL NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  ncm                TEXT NOT NULL DEFAULT '',
  ativo              INTEGER NOT NULL DEFAULT 1,
  versao             INTEGER NOT NULL DEFAULT 1,
  criado_em          TEXT NOT NULL,
  atualizado_em      TEXT NOT NULL
);

-- Movimentações são o livro-razão do estoque: imutáveis (triggers abaixo).
CREATE TABLE IF NOT EXISTS movimentos_estoque (
  id                  INTEGER PRIMARY KEY,
  produto_id          INTEGER NOT NULL REFERENCES produtos(id),
  tipo                TEXT NOT NULL CHECK (tipo IN ('E','S')),
  quantidade          REAL NOT NULL CHECK (quantidade > 0),
  saldo_anterior      REAL NOT NULL,
  saldo_posterior     REAL NOT NULL,
  motivo              TEXT NOT NULL,
  origem              TEXT NOT NULL CHECK (origem IN ('SALDO_INICIAL','MANUAL','PEDIDO')),
  referencia          TEXT NOT NULL DEFAULT '',
  usuario             TEXT NOT NULL,
  data_hora           TEXT NOT NULL,
  chave_idempotencia  TEXT UNIQUE
);
-- Um pedido só pode baixar cada produto uma única vez (barreira contra baixa duplicada).
CREATE UNIQUE INDEX IF NOT EXISTS ux_mov_pedido
  ON movimentos_estoque (origem, referencia, produto_id) WHERE origem = 'PEDIDO';
CREATE INDEX IF NOT EXISTS ix_mov_produto ON movimentos_estoque (produto_id, id);

CREATE TRIGGER IF NOT EXISTS trg_mov_sem_update BEFORE UPDATE ON movimentos_estoque
BEGIN SELECT RAISE(ABORT, 'Movimentações de estoque são imutáveis; registre um estorno.'); END;
CREATE TRIGGER IF NOT EXISTS trg_mov_sem_delete BEFORE DELETE ON movimentos_estoque
BEGIN SELECT RAISE(ABORT, 'Movimentações de estoque são imutáveis; registre um estorno.'); END;

CREATE TABLE IF NOT EXISTS pedidos (
  id                   INTEGER PRIMARY KEY,
  numero               TEXT NOT NULL UNIQUE,
  cliente_id           INTEGER NOT NULL REFERENCES clientes(id),
  cond_pagto           TEXT NOT NULL REFERENCES condicoes_pagamento(codigo),
  status               TEXT NOT NULL CHECK (status IN ('RASCUNHO','PENDENTE_APROVACAO','APROVADO','REJEITADO','CANCELADO','FATURADO')),
  emissao              TEXT NOT NULL,
  total_bruto_cent     INTEGER NOT NULL DEFAULT 0,
  total_desconto_cent  INTEGER NOT NULL DEFAULT 0,
  total_liquido_cent   INTEGER NOT NULL DEFAULT 0,
  observacao           TEXT NOT NULL DEFAULT '',
  motivo_status        TEXT NOT NULL DEFAULT '',
  vendedor             TEXT NOT NULL,
  faturado_em          TEXT,
  versao               INTEGER NOT NULL DEFAULT 1,
  criado_em            TEXT NOT NULL,
  atualizado_em        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pedidos_status ON pedidos (status);
CREATE INDEX IF NOT EXISTS ix_pedidos_cliente ON pedidos (cliente_id);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id                   INTEGER PRIMARY KEY,
  pedido_id            INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  item                 TEXT NOT NULL,
  produto_id           INTEGER NOT NULL REFERENCES produtos(id),
  quantidade           REAL NOT NULL CHECK (quantidade > 0),
  preco_unitario_cent  INTEGER NOT NULL CHECK (preco_unitario_cent > 0),
  desconto_pct         REAL NOT NULL DEFAULT 0 CHECK (desconto_pct >= 0 AND desconto_pct < 100),
  total_cent           INTEGER NOT NULL,
  UNIQUE (pedido_id, produto_id),
  UNIQUE (pedido_id, item)
);

CREATE TABLE IF NOT EXISTS pedido_historico (
  id           INTEGER PRIMARY KEY,
  pedido_id    INTEGER NOT NULL REFERENCES pedidos(id),
  de_status    TEXT,
  para_status  TEXT NOT NULL,
  usuario      TEXT NOT NULL,
  data_hora    TEXT NOT NULL,
  observacao   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS titulos (
  id               INTEGER PRIMARY KEY,
  tipo             TEXT NOT NULL CHECK (tipo IN ('R','P')),
  numero           TEXT NOT NULL,
  parcela          TEXT NOT NULL DEFAULT '',
  cliente_id       INTEGER REFERENCES clientes(id),
  fornecedor_id    INTEGER REFERENCES fornecedores(id),
  pedido_id        INTEGER REFERENCES pedidos(id),
  emissao          TEXT NOT NULL,
  vencimento       TEXT NOT NULL,
  valor_cent       INTEGER NOT NULL CHECK (valor_cent > 0),
  saldo_cent       INTEGER NOT NULL CHECK (saldo_cent >= 0),
  situacao         TEXT NOT NULL CHECK (situacao IN ('ABERTO','PARCIAL','LIQUIDADO')),
  data_liquidacao  TEXT,
  historico        TEXT NOT NULL DEFAULT '',
  versao           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tipo, numero, parcela),
  CHECK (saldo_cent <= valor_cent),
  CHECK ((tipo = 'R' AND cliente_id IS NOT NULL AND fornecedor_id IS NULL)
      OR (tipo = 'P' AND fornecedor_id IS NOT NULL AND cliente_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_titulos_venc ON titulos (tipo, situacao, vencimento);

CREATE TABLE IF NOT EXISTS baixas (
  id                  INTEGER PRIMARY KEY,
  titulo_id           INTEGER NOT NULL REFERENCES titulos(id),
  valor_cent          INTEGER NOT NULL CHECK (valor_cent > 0),
  data                TEXT NOT NULL,
  usuario             TEXT NOT NULL,
  data_hora           TEXT NOT NULL,
  chave_idempotencia  TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS auditoria (
  id           INTEGER PRIMARY KEY,
  entidade     TEXT NOT NULL,
  entidade_id  INTEGER,
  acao         TEXT NOT NULL,
  usuario      TEXT NOT NULL,
  data_hora    TEXT NOT NULL,
  detalhes     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_auditoria_ent ON auditoria (entidade, entidade_id);

-- Respostas guardadas por chave de idempotência (cabeçalho Idempotency-Key).
CREATE TABLE IF NOT EXISTS idempotencia (
  chave        TEXT NOT NULL,
  usuario_id   INTEGER NOT NULL,
  rota         TEXT NOT NULL,
  hash_corpo   TEXT NOT NULL,
  status_http  INTEGER NOT NULL,
  resposta     TEXT NOT NULL,
  criado_em    TEXT NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);
`;

function abrir(caminho) {
  const db = new DatabaseSync(caminho);
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrar(db);
  db._profundidadeTx = 0;
  return db;
}

// Migrações incrementais para bancos já existentes. Só alteram ESTRUTURA; nenhum dado de
// usuário é modificado (perfil_base nasce vazio e só é preenchido quando um admin altera o perfil).
function migrar(db) {
  const colunas = db.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
  if (!colunas.includes('perfil_base')) {
    db.exec("ALTER TABLE usuarios ADD COLUMN perfil_base TEXT CHECK (perfil_base IS NULL OR perfil_base <> 'ADMIN')");
  }
  // Perfis DIRETORIA e SEM_ACESSO: o SQLite não altera um CHECK existente, então a tabela é recriada
  // com os mesmos dados (procedimento oficial: chaves estrangeiras desligadas durante a troca).
  const ddlUsuarios = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'").get().sql;
  if (!ddlUsuarios.includes("'SEM_ACESSO'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec(`BEGIN;
        CREATE TABLE usuarios_nova (
          id          INTEGER PRIMARY KEY,
          login       TEXT NOT NULL UNIQUE,
          nome        TEXT NOT NULL,
          perfil      TEXT NOT NULL CHECK (perfil IN ('ADMIN','DIRETORIA','GERENTE','VENDEDOR','ESTOQUE','FINANCEIRO','CONSULTA','SEM_ACESSO')),
          senha_hash  TEXT NOT NULL,
          ativo       INTEGER NOT NULL DEFAULT 1,
          perfil_base TEXT CHECK (perfil_base IS NULL OR perfil_base <> 'ADMIN')
        );
        INSERT INTO usuarios_nova (id, login, nome, perfil, senha_hash, ativo, perfil_base)
          SELECT id, login, nome, perfil, senha_hash, ativo, perfil_base FROM usuarios;
        DROP TABLE usuarios;
        ALTER TABLE usuarios_nova RENAME TO usuarios;
        CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_login_nocase ON usuarios (login COLLATE NOCASE);
        COMMIT;`);
    } catch (e) { db.exec('ROLLBACK;'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON;'); }
    const quebradas = db.prepare('PRAGMA foreign_key_check').all();
    if (quebradas.length) throw new Error('Migração de perfis deixou referências inválidas: ' + JSON.stringify(quebradas.slice(0, 3)));
  }
  // Mesa de trabalho (página Início): tarefas, anotação e preferências PESSOAIS. Cada linha pertence a um
  // usuário; o servidor sempre filtra por usuario_id da sessão. Apagar a conta apaga esses dados pessoais.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tarefas (
      id           INTEGER PRIMARY KEY,
      usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      titulo       TEXT NOT NULL,
      descricao    TEXT NOT NULL DEFAULT '',
      prazo        TEXT,
      prioridade   TEXT NOT NULL DEFAULT 'NORMAL' CHECK (prioridade IN ('ALTA','MEDIA','NORMAL')),
      concluida    INTEGER NOT NULL DEFAULT 0,
      concluida_em TEXT,
      criado_em    TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_tarefas_usuario ON tarefas (usuario_id, concluida, prazo);
    CREATE TABLE IF NOT EXISTS notas_pessoais (
      usuario_id    INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
      texto         TEXT NOT NULL DEFAULT '',
      atualizado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS preferencias_mesa (
      usuario_id         INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
      atalhos            TEXT NOT NULL,
      mostrar_calendario INTEGER NOT NULL DEFAULT 1,
      mostrar_notas      INTEGER NOT NULL DEFAULT 1,
      atualizado_em      TEXT NOT NULL
    );
    -- Várias notas por usuário (bloquinhos). notas_pessoais (nota única) ficou só como origem da migração.
    CREATE TABLE IF NOT EXISTS notas (
      id            INTEGER PRIMARY KEY,
      usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      texto         TEXT NOT NULL,
      criado_em     TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_notas_usuario ON notas (usuario_id, atualizado_em);
    CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, feita_em TEXT NOT NULL);
    -- Acessos adicionais por usuário, concedidos pelo ADMIN além do padrão do perfil (ver ADICIONAIS em auth.js).
    CREATE TABLE IF NOT EXISTS usuario_permissoes (
      usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      permissao     TEXT NOT NULL,
      concedido_por TEXT NOT NULL,
      concedido_em  TEXT NOT NULL,
      PRIMARY KEY (usuario_id, permissao)
    );
    -- Empresa/filial ativa exibida no cabeçalho (a demonstração tem uma só; antes ficava fixa no HTML).
    CREATE TABLE IF NOT EXISTS empresa (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      codigo        TEXT NOT NULL,
      nome          TEXT NOT NULL,
      filial_codigo TEXT NOT NULL,
      filial_nome   TEXT NOT NULL
    );
    INSERT OR IGNORE INTO empresa (id, codigo, nome, filial_codigo, filial_nome) VALUES (1, '01', 'Indústria Demo Ltda.', '0101', 'Matriz');
  `);
  // Carteira do vendedor: cliente com vendedor responsável (login). Clientes antigos ficam SEM vendedor:
  // nenhum é atribuído automaticamente; o gerente/admin define a carteira no cadastro do cliente.
  if (!db.prepare('PRAGMA table_info(clientes)').all().some((c) => c.name === 'vendedor')) {
    db.exec('ALTER TABLE clientes ADD COLUMN vendedor TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS ix_clientes_vendedor ON clientes (vendedor)');
  // Uma única vez: a nota única de cada usuário vira o primeiro bloquinho (nada é apagado da tabela antiga).
  if (!db.prepare("SELECT 1 FROM migracoes WHERE nome = 'notas_em_blocos'").get()) {
    db.exec(`BEGIN;
      INSERT INTO notas (usuario_id, texto, criado_em, atualizado_em)
        SELECT usuario_id, trim(texto, ' '||char(9)||char(10)||char(13)), atualizado_em, atualizado_em FROM notas_pessoais WHERE trim(texto, ' '||char(9)||char(10)||char(13)) <> '';
      INSERT INTO migracoes (nome, feita_em) VALUES ('notas_em_blocos', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      COMMIT;`);
  }
  // Logins de contas excluídas que tinham histórico: não podem ser recriados, para que ninguém
  // "herde" pedidos, movimentos ou auditoria de outra pessoa pelo mesmo login.
  db.exec(`CREATE TABLE IF NOT EXISTS logins_reservados (
    login        TEXT PRIMARY KEY COLLATE NOCASE,
    nome         TEXT NOT NULL,
    excluido_em  TEXT NOT NULL,
    excluido_por TEXT NOT NULL
  );`);
  // Trilha de auditoria imutável: nem a aplicação nem um usuário consegue editar/apagar registros.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_aud_sem_update BEFORE UPDATE ON auditoria
    BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria é imutável.'); END;
    CREATE TRIGGER IF NOT EXISTS trg_aud_sem_delete BEFORE DELETE ON auditoria
    BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria é imutável.'); END;
    CREATE INDEX IF NOT EXISTS ix_auditoria_acao ON auditoria (acao, id);
  `);
}

// Transação com BEGIN IMMEDIATE: obtém o lock de escrita no início, evitando que duas
// conexões leiam o mesmo saldo e gravem resultados conflitantes. Chamadas aninhadas
// usam SAVEPOINT, então um serviço pode chamar outro sem quebrar a atomicidade.
function transacao(db, fn) {
  if (db._profundidadeTx > 0) {
    const sp = `sp_${db._profundidadeTx}`;
    db.exec(`SAVEPOINT ${sp}`);
    db._profundidadeTx++;
    try {
      const r = fn();
      db.exec(`RELEASE ${sp}`);
      return r;
    } catch (e) {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw e;
    } finally {
      db._profundidadeTx--;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  db._profundidadeTx = 1;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* conexão já sem transação */ }
    throw e;
  } finally {
    db._profundidadeTx = 0;
  }
}

// Próximo número de uma sequência, dentro da transação corrente.
function proximaSequencia(db, nome, tamanho) {
  db.prepare('INSERT INTO sequencias (nome, valor) VALUES (?, 0) ON CONFLICT(nome) DO NOTHING').run(nome);
  db.prepare('UPDATE sequencias SET valor = valor + 1 WHERE nome = ?').run(nome);
  const { valor } = db.prepare('SELECT valor FROM sequencias WHERE nome = ?').get(nome);
  return String(valor).padStart(tamanho, '0');
}

module.exports = { abrir, transacao, proximaSequencia };
