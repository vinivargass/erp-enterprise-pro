# Casos de teste e resultados obtidos

## 1. Testes automatizados da aplicação web (EXECUTADOS)

- Ferramenta: `node:test` (embutido no Node, sem dependências).
- Como rodar: `testar.cmd` na raiz, ou `node --test tests/erp.test.js` dentro de `web/`.
- Como funciona: cada execução sobe a **mesma** aplicação (`server/app.js`) numa porta efêmera, com banco SQLite em memória, e conversa com ela por HTTP como o navegador faria (login, cookie, CSRF, idempotência).
- Execução registrada: **2026-10-20 16:13**, Node v24.21.0 (embutido no VS Code), Windows 10.

**Resultado: 33 testes, 33 aprovados, 0 falhas.** (30 na entrega inicial + 3 do autocadastro de usuário, 2026-10-20.)

| # obrigatório | Teste | Resultado |
|---|---|---|
| 1 | Cadastro de cliente válido gera código automático e auditoria | ✔ |
| 2 | Bloqueia CPF/CNPJ duplicado (inclusão, com máscara, e alteração) | ✔ |
| — | Valida dígitos verificadores, obrigatórios, UF e e-mail; aceita CPF válido | ✔ |
| — | Alteração registra histórico campo a campo e controla versão (409 se desatualizada) | ✔ |
| — | Inativação lógica bloqueia novos pedidos | ✔ |
| — | Pesquisa por nome/documento com paginação; `%` e `_` tratados como texto | ✔ |
| 3 | Rejeita preço inválido (0, negativo, texto, 3 casas) e mínimo negativo | ✔ |
| — | Saldo inicial vira movimentação; cadastro não altera saldo | ✔ |
| — | Não exclui produto com movimentação | ✔ |
| 4 | Pedido válido: cálculo (37,02 × 0,95 = 35,17), aprovação automática e reserva | ✔ |
| — | Preço enviado pelo cliente da API é ignorado (vem do cadastro) | ✔ |
| 5 | Acima do limite de crédito: política APROVACAO → pendente; REJEITAR → rejeitado | ✔ |
| — | Desconto acima da alçada exige gerente; emissor não aprova o próprio; acima do máximo é inválido | ✔ |
| 6 | Rejeita envio com estoque insuficiente, considerando reservas de outros pedidos | ✔ |
| 7 | Cancelamento libera reserva e impede faturamento; faturado não cancela | ✔ |
| — | 3 faturamentos **simultâneos** do mesmo pedido: 1 sucesso, 2 × 409; estoque baixado uma vez; 2 parcelas somando o total | ✔ |
| 8 | Movimentação repetida com a mesma Idempotency-Key não duplica; chave com outro corpo é recusada | ✔ |
| — | Saída acima do disponível bloqueada; ZZ_ESTNEG=S libera e registra saldo negativo | ✔ |
| — | Histórico de movimentos imutável no banco (UPDATE/DELETE abortados por trigger) | ✔ |
| 9 | Liquidação duplicada: reenvio idempotente devolve a mesma resposta; segunda baixa → 409; 1 baixa gravada | ✔ |
| — | Baixa parcial; valor acima do saldo e data futura recusados | ✔ |
| 10 | Perfis sem permissão → 403; sem sessão → 401 | ✔ |
| — | Vendedor não enxerga pedido de outro vendedor (404) | ✔ |
| — | Mutação com token CSRF forjado → 403 | ✔ |
| — | Login bloqueia (429) após 5 senhas erradas | ✔ |
| 11 | JSON malformado/array (400), tipos errados (422), corpo > 100 KB (413), id com SQL (404), `ORDER BY`/busca com injeção (sem efeito), itens não-lista (422) | ✔ |
| — | CSV: BOM, `;`, vírgula decimal, aspas escapadas, fórmula neutralizada (`'=`) | ✔ |
| 12 | Falha simulada no banco no meio do faturamento → 500 sem vazar detalhe; status, estoque, reserva e movimentos intactos; refazer funciona | ✔ |
| — | Indicadores do dashboard mudam após faturar (sem números fixos) | ✔ |
| — | Os 6 relatórios executam; período invertido → 422 | ✔ |

### Defeitos encontrados pelos testes e corrigidos durante o desenvolvimento
| Defeito | Correção |
|---|---|
| O bloqueio por senha errada zerava o contador a cada tentativa (nunca bloqueava) | O contador só reinicia quando um bloqueio anterior expira (`auth.js`). |
| Corpo grande demais derrubava a conexão (ECONNRESET) em vez de responder 413 | O restante do corpo é descartado e a resposta 413 é enviada (`app.js`). |
| Rotas de relatório recusavam o identificador textual (`vendas`), que caía na validação de id numérico | Parâmetro de rota próprio `:rel`. |
| A política de segurança (CSP) bloqueava estilos escritos direto nos elementos | `style-src-attr 'unsafe-inline'`, mantendo `script-src 'self'`. |
| `api.js` lia `sessionStorage` sem proteção (quebra em navegação privada/armazenamento bloqueado) | Leitura dentro de `try/catch`. |

## 2. Verificações adicionais executadas
- Todos os módulos do frontend carregados no Node para conferir imports/exports: **ok**.
- Fluxo pela API real em execução (curl): login, dashboard, CSV, criação de pedido, recusa de mutação sem CSRF: **ok**.
- **Não executado:** teste visual em navegador por quem desenvolveu (não havia navegador automatizado nesta sessão). Recomenda-se uma passada manual pelas telas.

## 3. Testes que dependem do Protheus (NÃO EXECUTADOS)
Procedimentos e resultados esperados em [protheus/docs/TESTES_PROTHEUS.md](../protheus/docs/TESTES_PROTHEUS.md). Nenhum fonte ADVPL foi compilado ou executado em AppServer.

### Acréscimo — autocadastro de usuário (executado, 33/33)
| Teste | Resultado |
|---|---|
| Cria conta SEM_ACESSO (sem módulos) já autenticada; perfil enviado pelo cliente (`ADMIN`) é ignorado; a conta não consegue gravar (403) | ✔ |
| Recusa login duplicado (409), senha curta/sem números/contendo o login, confirmação diferente e dados inválidos (422) | ✔ |
| Admin promove usuário; perfil inválido 422; admin não rebaixa/desativa a si mesmo; gerente não gerencia usuários (403) | ✔ |

### Acréscimo — área administrativa (executado: 44/44 no total)
Arquivo `web/tests/admin.test.js` (10 testes, todos aprovados em 2026-10-20): admin acessa o painel com valores conferidos; filtros e tabela paginada; comuns e anônimos recebem 403/401 em todas as rotas administrativas, com registro na auditoria; pesquisa sem diferenciar maiúsculas e acentos; conceder Admin (persistido, sessões antigas invalidadas, novo login acessa); remover Admin (volta ao perfil anterior, conta ativa, perde o acesso na hora); chamadas diretas sem permissão bloqueadas; o próprio admin e o último admin ativo protegidos; falha de gravação → 500 sem alterar nada e auditada como FALHA; histórico completo e imutável.
