# API REST da demonstração web

Base: `http://localhost:3000/api`. Todas as respostas são JSON (`application/json; charset=utf-8`), exceto a exportação CSV.

> Esta é a API da **demonstração** (Node + SQLite). A API equivalente no Protheus é a `ZERPCLIENTES` ([protheus/docs/INTEGRACAO.md](../protheus/docs/INTEGRACAO.md)).

## Convenções

| Item | Regra |
|---|---|
| Autenticação | `POST /api/auth/login` devolve o cookie `erp_sessao` (HttpOnly, SameSite=Strict, 8 h) e um `csrf`. |
| CSRF | Toda requisição que altera dados (POST/PUT/DELETE) envia `X-CSRF-Token: <csrf>`. |
| Idempotência | POSTs marcados com ★ aceitam `Idempotency-Key` (8 a 64 caracteres `[A-Za-z0-9_-]`). A mesma chave com o mesmo corpo devolve a resposta original e o cabeçalho `Idempotent-Replay: true`; com outro corpo, devolve 422. |
| Concorrência | Registros têm `versao`. Ao alterar, envie a `versao` lida; se outro usuário alterou antes, a resposta é **409**. |
| Paginação | `?pagina=1&tamanho=10` (máx. 100) → `{ itens, total, pagina, tamanho }`. |
| Ordenação | `?ordem=<coluna>&direcao=asc|desc`, só com colunas de uma lista permitida. |
| Valores | Dinheiro em reais com 2 casas (armazenado em centavos). Datas `AAAA-MM-DD`. |

### Formato de erro
```json
{ "erro": { "codigo": "VALIDACAO", "mensagem": "Existem campos inválidos.", "detalhes": { "documento": "CNPJ inválido." } } }
```
| HTTP | código | Quando |
|---|---|---|
| 400 | REQUISICAO_INVALIDA | JSON malformado, corpo que não é objeto, Content-Type errado |
| 401 | NAO_AUTENTICADO / CREDENCIAIS | sem sessão / login inválido |
| 403 | PROIBIDO | perfil sem permissão, CSRF inválido, segregação de funções |
| 404 | NAO_ENCONTRADO | registro inexistente ou fora do alcance do usuário |
| 409 | CONFLITO | duplicidade, versão desatualizada, operação concorrente, baixa duplicada |
| 413 | CORPO_GRANDE | corpo > 100 KB |
| 422 | VALIDACAO / REGRA_NEGOCIO | campo inválido / regra violada (estoque, crédito, status) |
| 429 | BLOQUEADO | 5 senhas erradas seguidas → 1 minuto de bloqueio |
| 500 | ERRO_INTERNO | falha inesperada: transação desfeita, com código de rastreio no log |

## Endpoints

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| POST | `/auth/login` | pública | `{login, senha, lembrar?}` → `{usuario, csrf}`. Login sem diferenciar maiúsculas. `lembrar: true` = cookie de 30 dias; senão cookie de sessão (8 h no servidor) |
| POST | `/auth/registrar` | pública | autocadastro `{nome, login, senha, confirmacao}` → 201 `{usuario, csrf}` já autenticado; perfil **sempre CONSULTA**; 409 login em uso; 422 senha fraca; 429 após 5 cadastros/10 min do mesmo IP |
| POST | `/auth/logout` | autenticado | encerra a sessão |
| GET | `/admin/painel?de=&ate=&grupo=&vendedor=` | admin.painel (ADMIN) | indicadores, evolução mensal, faturamento por grupo, status, top clientes (registra o acesso) |
| GET | `/admin/vendas?...filtros&q=&ordem=&direcao=&pagina=&tamanho=` | admin.painel (ADMIN) | vendas faturadas por item, paginadas |
| GET | `/admin/usuarios?q=&perfil=todos|admin|comum&status=&pagina=` | usuarios.gerir (ADMIN) | pesquisa sem diferenciar maiúsculas/acentos; nunca devolve senha/tokens |
| POST | `/admin/usuarios/:id/conceder-admin` · `/remover-admin` | usuarios.gerir (ADMIN) | sem corpo; o servidor decide o perfil; protege o próprio acesso e o último admin; encerra as sessões do afetado |
| POST | `/admin/usuarios/:id/perfil` | usuarios.gerir (ADMIN) | `{perfil}`: troca para qualquer perfil da lista oficial (ADMIN, GERENTE, VENDEDOR, ESTOQUE, FINANCEIRO, CONSULTA); mesmas proteções e auditoria |
| POST | `/admin/usuarios/:id/ativo` | usuarios.gerir (ADMIN) | `{ativo}`: desativa/reativa a conta (perfil e dados mantidos; sessões encerradas; não vale para si mesmo nem para o último admin) |
| DELETE | `/admin/usuarios/:id` | usuarios.gerir (ADMIN) | `{confirmacao: "<login>"}`: exclusão definitiva. Conta ativa: só se for comum e sem histórico. Conta **desativada**: pode ser excluída mesmo com histórico; o histórico é mantido e o login vai para `logins_reservados` (não pode ser recriado). Nunca a própria conta. `GET /admin/usuarios?exclusao=1` informa se cada conta pode ser excluída e por quê |
| GET | `/admin/perfis` | usuarios.gerir (ADMIN) | perfis com descrição e a lista de acessos que cada um libera (derivada da matriz de permissões) |
| GET | `/admin/historico-perfis` | usuarios.gerir (ADMIN) | trilha de alterações de perfil com resultado |
| GET | `/usuarios` | usuarios.gerir (ADMIN) | lista de usuários |
| PUT | `/usuarios/:id` | usuarios.gerir (ADMIN) | `{perfil?, ativo?}`; derruba as sessões do usuário; o admin não pode rebaixar/desativar a si mesmo |
| GET | `/auth/sessao` | autenticado | usuário atual, permissões e `csrf` (para retomar uma sessão lembrada) |
| GET | `/saude` | pública | estado do serviço |
| GET | `/dashboard?de=&ate=` | dashboard.ler | indicadores, evolução mensal, status, atividades, alertas |
| GET | `/notificacoes` | autenticado | alertas operacionais |
| GET | `/condicoes-pagamento` | autenticado | lista |
| GET | `/clientes?q=&campo=todos|codigo|nome|documento&status=ativo|inativo&uf=` | clientes.ler | lista paginada |
| POST ★ | `/clientes` | clientes.gravar | inclui (201) |
| GET | `/clientes/:id` | clientes.ler | ficha + crédito utilizado/disponível |
| PUT | `/clientes/:id` | clientes.gravar | altera (com `versao`) |
| POST | `/clientes/:id/inativar` · `/reativar` | clientes.inativar | `{versao}` |
| GET | `/clientes/:id/historico` | clientes.ler | trilha de alterações |
| GET | `/produtos?q=&grupo=&tipo=&status=&estoque=abaixo` | produtos.ler | lista paginada |
| GET | `/produtos-grupos` | produtos.ler | grupos existentes |
| POST ★ | `/produtos` | produtos.gravar | inclui; `saldo_inicial` gera movimentação |
| GET/PUT | `/produtos/:id` | produtos.ler / gravar | consulta / altera (saldo não é editável) |
| DELETE | `/produtos/:id?versao=` | produtos.gravar | só se nunca utilizado |
| GET | `/pedidos?status=&q=&de=&ate=&cliente_id=` | pedidos.ler | vendedor vê só os próprios |
| POST ★ | `/pedidos` | pedidos.gravar | cria RASCUNHO |
| GET/PUT | `/pedidos/:id` | pedidos.ler / gravar | consulta completa / altera (RASCUNHO ou REJEITADO) |
| POST | `/pedidos/:id/enviar` | pedidos.gravar | avalia estoque, alçada e crédito |
| POST | `/pedidos/:id/aprovar` · `/rejeitar` | pedidos.aprovar | `{versao, observacao}` / `{versao, motivo}` |
| POST | `/pedidos/:id/cancelar` | pedidos.gravar | `{versao, motivo}` |
| POST ★ | `/pedidos/:id/faturar` | pedidos.faturar | faturamento **demonstrativo** |
| GET | `/estoque/saldos?q=&situacao=abaixo` | estoque.ler | saldo, reservado, disponível |
| GET | `/estoque/movimentos?produto_id=&tipo=&origem=&de=&ate=` | estoque.ler | kardex paginado |
| POST ★ | `/estoque/movimentos` | estoque.movimentar | `{produto_id, tipo: E|S, quantidade, motivo, referencia}` |
| GET | `/financeiro/receber` · `/financeiro/pagar` `?situacao=ABERTO|VENCIDO|PARCIAL|LIQUIDADO&venc_de=&venc_ate=&q=` | financeiro.ler | títulos |
| GET | `/financeiro/titulos/:id` | financeiro.ler | título + baixas |
| POST ★ | `/financeiro/titulos/:id/liquidar` | financeiro.liquidar | `{valor, data, versao}` |
| GET | `/relatorios` | relatorios.ler | catálogo |
| GET | `/relatorios/:rel?filtros[&formato=csv]` | relatorios.ler | `vendas`, `pedidos_status`, `estoque_baixo`, `movimentacoes`, `receber_vencidas`, `pagar_vencimento` |
| GET / PUT | `/parametros` · `/parametros/:chave` | parametros.ler / gravar | `{valor}` |
| GET | `/auditoria` | auditoria.ler | trilha geral paginada |

## Exemplos de payload

### Inclusão de cliente
```http
POST /api/clientes
Content-Type: application/json
X-CSRF-Token: 3oZ...
Idempotency-Key: 6d1f4a3e-5c1b-4a8e-9a77-0f7e5d1c2b10

{ "razao_social": "Cliente Exemplo Ltda", "nome_fantasia": "Exemplo", "tipo_pessoa": "J",
  "documento": "11.222.333/0001-81", "inscricao_estadual": "ISENTO", "cep": "01001-000",
  "logradouro": "Rua A", "numero": "10", "bairro": "Centro", "municipio": "São Paulo", "uf": "SP",
  "telefone": "(11) 3000-0000", "email": "contato@exemplo.com.br", "cond_pagto": "002", "limite_credito": 15000 }
```
```json
201 { "id": 13, "codigo": "000013", "documento": "11222333000181", "ativo": true, "limite_credito": 15000,
      "credito_utilizado": 0, "credito_disponivel": 15000, "versao": 1, "...": "..." }
409 { "erro": { "codigo": "CONFLITO", "mensagem": "Documento já cadastrado para o cliente 000013 - Cliente Exemplo Ltda.",
      "detalhes": { "documento": "Documento já cadastrado." } } }
```

### Pedido
```http
POST /api/pedidos
{ "cliente_id": 1, "observacao": "Entrega em 2 dias",
  "itens": [ { "produto_id": 1, "quantidade": 10 }, { "produto_id": 6, "quantidade": 40, "desconto_pct": 5 } ] }
```
```json
201 { "id": 105, "numero": "000105", "status": "RASCUNHO", "total_bruto": 2799, "total_desconto": 45, "total_liquido": 2754,
      "itens": [ { "item": "01", "produto_codigo": "TUB-001", "quantidade": 10, "preco_unitario": 189.9, "desconto_pct": 0, "total": 1899 } ],
      "credito": { "limite": 150000, "utilizado": 1234.5, "disponivel": 148765.5 }, "versao": 1 }
```
```http
POST /api/pedidos/105/enviar        { "versao": 1 }
```
```json
200 { "status": "APROVADO", "motivo_status": "Aprovado automaticamente: dentro das alçadas e do limite de crédito.", "versao": 2 }
422 { "erro": { "codigo": "REGRA_NEGOCIO", "mensagem": "Estoque insuficiente para: TUB-003 (pedido 30, disponível 10)",
      "detalhes": { "faltas": [ { "codigo": "TUB-003", "quantidade": 30, "disponivel": 10 } ] } } }
```

### Movimentação de estoque
```http
POST /api/estoque/movimentos
Idempotency-Key: mov-2026-10-20-0001
{ "produto_id": 3, "tipo": "E", "quantidade": 25, "motivo": "Entrada NF 4512 fornecedor F00001", "referencia": "NF4512" }
```
```json
201 { "id": 512, "tipo": "E", "quantidade": 25, "saldo_anterior": 10, "saldo_posterior": 35, "origem": "MANUAL",
      "usuario": "estoque", "data_hora": "2026-10-20T18:02:11.120Z" }
```

### Liquidação
```http
POST /api/financeiro/titulos/88/liquidar
Idempotency-Key: bx-88-20261020
{ "valor": 1500.00, "data": "2026-10-20", "versao": 1 }
```
```json
200 { "id": 88, "situacao": "LIQUIDADO", "saldo": 0, "data_liquidacao": "2026-10-20", "baixas": [ { "valor": 1500, "usuario": "financeiro" } ] }
409 { "erro": { "codigo": "CONFLITO", "mensagem": "Título já liquidado. Baixa duplicada bloqueada." } }
```

### CSV
`GET /api/relatorios/estoque_baixo?formato=csv` → `text/csv; charset=utf-8`, anexo `estoque_baixo_AAAA-MM-DD.csv`:
```
﻿Código;Descrição;UM;Saldo;Reservado;Disponível;Mínimo;Necessidade
TUB-003;"Tubo inox 304 3/4"" x 6m";PC;10;0;10;30;20
```
