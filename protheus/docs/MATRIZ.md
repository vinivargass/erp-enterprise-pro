# Matriz: funcionalidade web × implementação Protheus

Legenda da coluna **Situação Protheus**: ✅ fonte ADVPL entregue (não compilado) · 📄 documentado/padrão nativo, sem fonte próprio · ⏳ próximo passo, não implementado.

| Módulo | Funcionalidade (demonstração web) | Implementação web | Equivalente Protheus | Fonte / recurso | Situação |
|---|---|---|---|---|---|
| Dashboard | Faturamento, pedidos, receber/pagar, estoque, alertas | `services/dashboard.js` (SQL agregado) | Consultas SQL sobre SF2/SD2, SC5, SE1, SE2, SB2; painel com widgets/consulta ou API para BI | — | 📄 (endpoint `zerpdashboard` sugerido em INTEGRACAO.md) |
| Clientes | Inclusão com código automático | `clientes.incluir` + sequência | CRMA980/MATA030 via ExecAuto, código por GetSxeNum | `ZERPCLI` `U_ZCliInc` | ✅ |
| Clientes | CPF/CNPJ com dígitos verificadores | `validacao.js` | `U_ZVldDoc` (ou `CGC()` padrão) | `ZERPVAL` | ✅ |
| Clientes | Bloqueio de duplicidade | checagem + UNIQUE | `U_ZCliDup` (SQL) + X3_VLDUSER no A1_CGC | `ZERPVAL` | ✅ |
| Clientes | Pesquisa, filtro, paginação | `GET /api/clientes` | FWMBrowse (pesquisa/filtro nativos) e REST paginado | `ZERPCLI`, `ZERPAPI` | ✅ |
| Clientes | Inativação com confirmação | `POST /inativar` + modal | `A1_MSBLQL='1'` via ExecAuto + MsgYesNo | `ZERPCLI` `U_ZCliIna` | ✅ |
| Clientes | Histórico de alterações | tabela `auditoria` | ZA1 (ou auditoria nativa do release) | `ZERPVAL` `U_ZLogAud`, `ZERPCLI` `U_ZCliHis` | ✅ |
| Clientes | Posição de crédito | `creditoUtilizadoCent` | `U_ZCredUso` (SE1 + SC6) / análise de crédito padrão | `ZERPVAL`, `ZERPCLI` | ✅ |
| Produtos | CRUD, validações de preço/quantidade | `services/produtos.js` | MATA010 via ExecAuto | `ZERPPROD` `U_ZPrdInc` | ✅ (inclusão); alteração/bloqueio seguem o mesmo padrão ⏳ |
| Produtos | Saldo inicial vira movimentação | `estoque.registrar(SALDO_INICIAL)` | Movimento de entrada (MATA240) ou carga de saldo inicial | `ZERPEST` | ✅ / 📄 |
| Produtos | Alerta de estoque baixo | `abaixo_minimo` | Browse em FWTemporaryTable (SB1+SB2) | `ZERPPROD` `U_ZPrdBxa` | ✅ |
| Produtos | NCM informativo | formato 8 dígitos | `B1_POSIPI` validado contra SYD pelo padrão | `ZERPPROD` | 📄 |
| Pedidos | Rascunho | status RASCUNHO | Orçamento de venda (SCJ/SCK, MATA415) | padrão | 📄 |
| Pedidos | Itens, preço do cadastro, desconto | `calcularItens` | `C6_PRUNIT`/`C6_PRCVEN`; preço real via tabela de preço DA0/DA1 | `ZERPPED` `U_ZPedInc` | ✅ |
| Pedidos | Desconto dentro de limites | ZZ_DESCMXV/ZZ_DESCMXG | ZA3 por grupo (MVC) + MT410TOK + parâmetros | `ZERPDESC`, `ZERPPE` | ✅ |
| Pedidos | Validação de crédito | política ZZ_CREDPOL | `U_ZCredUso` + ZZ_CREDPOL; liberação de crédito padrão (SC9) | `ZERPPED` | ✅ / 📄 |
| Pedidos | Verificação de estoque | disponível = saldo − reservado | `U_ZSaldoDisp` (SB2: QATU−RESERVA−QEMP) | `ZERPVAL`, `ZERPPED` | ✅ |
| Pedidos | Aprovação/rejeição | `aprovar`/`rejeitar` + segregação | ZA4 + `U_ZPedApr` + ZZ_APROVAD | `ZERPPED` | ✅ |
| Pedidos | Cancelamento | `cancelar` libera reserva | MATA410 opção 5 + ZA4 = C | `ZERPPED` `U_ZPedCan` | ✅ |
| Pedidos | Faturamento (demonstrativo) | baixa estoque + títulos, atômico | **Faturamento padrão** MATA460/MATA461 (NF-e, impostos, SD2, SE1) | padrão | 📄 — não reimplementado |
| Pedidos | Impedir faturar pendente/cancelado | regra de status | Cancelado = excluído (não fatura). Pendente: PE de liberação/faturamento | — | ⏳ (ver INTEGRACAO.md §2) |
| Estoque | Entradas e saídas com motivo | `movimentar` | MATA240 via ExecAuto + ZA2 | `ZERPEST` `U_ZEstMov` | ✅ |
| Estoque | Saldo anterior/posterior, usuário, data | colunas do movimento | SD3 + ZA2_SLDANT/ZA2_SLDPOS | `ZERPEST` | ✅ |
| Estoque | Bloqueio acima do saldo | ZZ_ESTNEG | `U_ZSaldoDisp` + MV_ESTNEG do padrão | `ZERPEST` | ✅ |
| Estoque | Imutabilidade do histórico | triggers SQLite | SD3 não é alterada; correção por estorno padrão | padrão | 📄 |
| Estoque | Movimentação duplicada | `chave_idempotencia` UNIQUE | LockByName + ZA2 (X2_UNICO) | `ZERPEST` | ✅ |
| Financeiro | Listas de receber/pagar com filtros | `services/financeiro.js` | FINA040/FINA050 (browse padrão) e relatório ZERPREL2 | padrão / `ZERPREL` | 📄 / ✅ |
| Financeiro | Liquidação sem duplicidade | idempotência + CAS de saldo | FINA070/FINA080 via ExecAuto + LockByName + ZA2 | `ZERPFIN` | ✅ |
| Relatórios | 6 relatórios com filtros | `services/relatorios.js` | TReport + BeginSql + SX1 | `ZERPREL` (2 de 6) | ✅ 2 / ⏳ 4 |
| Relatórios | Exportação CSV (BOM, `;`, vírgula decimal) | `paraCsv` | Exportação nativa do TReport (planilha) | padrão | 📄 |
| Segurança | Login, perfis, autorização no servidor | `auth.js`, matriz de permissões | Usuários/grupos/menus do SIGACFG; REST com SECURITY=1 | padrão | 📄 |
| Segurança | Vendedor só vê os próprios pedidos | filtro por `vendedor` | Filtro de browse por vendedor (SA3) / privilégios | — | ⏳ |
| Integração | API REST | `server/app.js` | WSRESTFUL `ZERPCLIENTES` | `ZERPAPI` | ✅ (clientes) / ⏳ demais |
| Parâmetros | Parâmetros de negócio editáveis | tabela `parametros` | SX6 (ZZ_*) via SuperGetMV | todos | ✅ |
