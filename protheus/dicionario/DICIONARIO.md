# Modelo de dados e dicionário proposto (Protheus)

> **Status:** proposta para revisão. Nada foi criado em ambiente Protheus.
> Tamanhos de campos **padrão** variam por release e por customização do cliente. Confira sempre no **SX3 do próprio ambiente** (Configurador → Base de Dados → Dicionário → Bases de Dados) ou no TDN da versão. Onde houver dúvida, ela está sinalizada com ⚠️.

## 1. Princípios adotados

1. **Usar tabelas padrão** quando o conceito já existe no Protheus (cliente, produto, saldo, pedido, título, nota). Gravações nelas acontecem **somente pelas rotinas padrão** (tela ou `MsExecAuto`), nunca por `RecLock` direto.
2. **Criar tabela Z** apenas para conceitos que não existem no padrão: auditoria de negócio, idempotência de integrações, alçadas de desconto e workflow de aprovação comercial.
3. **Sem campos novos nas tabelas padrão** nesta proposta. Assim a atualização de release fica mais simples. Se a empresa preferir campos de usuário (ex.: `C5_XSTATUS`), seguir a política interna de nomenclatura de campos customizados.
4. Toda tabela Z tem `ZZ?_FILIAL` e exclusão lógica padrão (`D_E_L_E_T_` + `R_E_C_N_O_` + `R_E_C_D_E_L_` geridos pelo DBAccess).

## 2. Tabelas padrão utilizadas

| Tabela | Uso no projeto | Rotina oficial de manutenção | Chave/índice usado nos fontes |
|---|---|---|---|
| **SA1** Clientes | cadastro, crédito (`A1_LC`), bloqueio (`A1_MSBLQL`) | CRMA980 (releases recentes) / MATA030 ⚠️ confirmar qual vigora no release | Índice 1 `A1_FILIAL+A1_COD+A1_LOJA`. Duplicidade de CGC por SQL (o índice 3 costuma ser `A1_FILIAL+A1_CGC` ⚠️ confirmar no SIX) |
| **SB1** Produtos | descrição, tipo, UM, grupo, preço (`B1_PRV1`), custo (`B1_CUSTD`), mínimo (`B1_EMIN` ⚠️ título "Ponto de Pedido" em vários releases), NCM (`B1_POSIPI`) | MATA010 | Índice 1 `B1_FILIAL+B1_COD` |
| **SBM** Grupos de produto | validação do grupo nas alçadas (ZA3) | MATA035 ⚠️ | Índice 1 `BM_FILIAL+BM_GRUPO` |
| **SB2** Saldos por armazém | `B2_QATU` (atual), `B2_RESERVA`, `B2_QEMP` | atualizado pelas movimentações | Índice 1 `B2_FILIAL+B2_COD+B2_LOCAL` |
| **SD3** Movimentos internos | entradas/saídas manuais | MATA240 | — |
| **SF5** Tipos de movimento | define se o TM é requisição (saída) ou devolução (entrada) por `F5_TIPO` | MATA230 ⚠️ | Índice 1 `F5_FILIAL+F5_CODIGO` |
| **SC5 / SC6** Pedido de venda (cabeçalho/itens) | pedido, cliente, condição, itens, preço, TES | MATA410 | SC5 índice 1 `C5_FILIAL+C5_NUM`; SC6 índice 1 `C6_FILIAL+C6_NUM+C6_ITEM+C6_PRODUTO` |
| **SC9** Pedidos liberados | liberação de estoque/crédito **padrão** (não alterada) | MATA440 / MATA455 / MATA456 ⚠️ | — |
| **SD2 / SF2** NF de saída | relatório de vendas faturadas | MATA460/MATA461 (faturamento) | — |
| **SE1 / SE2** Títulos a receber / pagar | saldos, vencimento real (`E1_VENCREA`), baixas | FINA040/FINA070 (receber) · FINA050/FINA080 (pagar) | SE1 índice 1 `E1_FILIAL+E1_PREFIXO+E1_NUM+E1_PARCELA+E1_TIPO`; SE2 índice 1 `...+E2_TIPO+E2_FORNECE+E2_LOJA` |
| **SE4** Condições de pagamento | condição do pedido | MATA360 ⚠️ | — |

**Relacionamentos principais:** SA1 (cod+loja) → SC5 (`C5_CLIENTE`,`C5_LOJACLI`) → SC6 (`C6_NUM`) → SB1 (`C6_PRODUTO`); SC6 → SC9 → SD2/SF2 (faturamento) → SE1 (`E1_PREFIXO/E1_NUM` = série/nota). SB1 → SB2 (por armazém) ← SD3.

## 3. Tabelas customizadas (Z)

Prefixo **ZA*** reservado ao projeto. Antes de criar, verificar no SX2 do cliente se os aliases estão livres.

### ZA1 — Auditoria de negócio
Justificativa: histórico de alterações legível pela área de negócio (quem, quando, o quê), independente de log técnico. ⚠️ Avaliar antes o recurso nativo de auditoria do release (trilha de auditoria configurável no SIGACFG); se atender, ZA1 pode ser dispensada.

| Campo | Tipo | Tam | Dec | Obrig. | Descrição |
|---|---|---|---|---|---|
| ZA1_FILIAL | C | (tam. filial) | | S | Filial |
| ZA1_TABELA | C | 3 | | S | Alias afetado (SA1, SC5, SD3, SE1...) |
| ZA1_CHAVE | C | 60 | | S | Chave do registro |
| ZA1_OPER | C | 15 | | S | INCLUSAO, ALTERACAO, INATIVACAO, APROVACAO... |
| ZA1_DETALH | M | 10 | | N | Detalhe (antes → depois, motivo) |
| ZA1_USER | C | 6 | | S | Código do usuário (`RetCodUsr()`) |
| ZA1_NOMUSR | C | 25 | | S | Nome do usuário |
| ZA1_DATA | D | 8 | | S | Data |
| ZA1_HORA | C | 8 | | S | Hora |

Índices (SIX): **1** `ZA1_FILIAL+ZA1_TABELA+ZA1_CHAVE+DTOS(ZA1_DATA)+ZA1_HORA`; **2** `ZA1_FILIAL+DTOS(ZA1_DATA)`.
Registros **somente inclusão** (rotinas não alteram nem excluem ZA1). Sem `X2_UNICO`.

### ZA2 — Idempotência de integrações / rastreabilidade de movimentos
Justificativa: impedir que a mesma operação (movimentação, baixa) seja processada duas vezes e guardar motivo + saldo anterior/posterior de cada movimento.

| Campo | Tipo | Tam | Dec | Obrig. | Descrição |
|---|---|---|---|---|---|
| ZA2_FILIAL | C | (tam. filial) | | S | Filial |
| ZA2_ORIGEM | C | 15 | | S | ESTOQUE, BAIXA_SE1, BAIXA_SE2 |
| ZA2_CHAVE | C | 60 | | S | Chave informada pelo chamador (ex.: UUID) |
| ZA2_RECURS | C | 80 | | S | Registro gerado (ex.: `SD3:recno`, `SE1:chave`) |
| ZA2_MOTIVO | C | 120 | | S | Motivo informado |
| ZA2_SLDANT | N | 14 | 4 | N | Saldo antes (movimentos de estoque) |
| ZA2_SLDPOS | N | 14 | 4 | N | Saldo depois |
| ZA2_USER | C | 6 | | S | Usuário |
| ZA2_DATA | D | 8 | | S | Data |
| ZA2_HORA | C | 8 | | S | Hora |

Índice **1** `ZA2_FILIAL+ZA2_ORIGEM+ZA2_CHAVE`. **X2_UNICO** = `ZA2_FILIAL+ZA2_ORIGEM+ZA2_CHAVE` (unicidade também no banco, além do `LockByName`).

### ZA3 — Alçadas de desconto por grupo de produto (cadastro MVC `ZERPDESC`)
| Campo | Tipo | Tam | Dec | Obrig. | Validação (X3_VALID / VLDUSER) | Descrição |
|---|---|---|---|---|---|---|
| ZA3_FILIAL | C | (tam. filial) | | S | | Filial |
| ZA3_GRUPO | C | (= BM_GRUPO) | | S | `ExistCpo("SBM")` · consulta padrão (F3) `SBM` | Grupo de produto |
| ZA3_DESCGR | C | (= BM_DESC) | | N | virtual; inicializador `Posicione("SBM",1,xFilial("SBM")+ZA3->ZA3_GRUPO,"BM_DESC")` | Descrição do grupo |
| ZA3_DESCMV | N | 5 | 2 | S | `Positivo() .And. M->ZA3_DESCMV < 100` | Alçada do vendedor (%) |
| ZA3_DESCMG | N | 5 | 2 | S | `Positivo() .And. M->ZA3_DESCMG < 100` | Alçada gerencial (%) |
| ZA3_MSBLQL | C | 1 | | N | `Pertence("12")` · combo `1=Sim;2=Nao` | Bloqueado |

Índice **1** `ZA3_FILIAL+ZA3_GRUPO`; **X2_UNICO** = `ZA3_FILIAL+ZA3_GRUPO`.
**Gatilho (SX7):** `ZA3_GRUPO` → `ZA3_DESCGR`, regra `SBM->BM_DESC`, posicionando SBM ordem 1 com chave `xFilial("SBM")+M->ZA3_GRUPO`.

### ZA4 — Controle comercial do pedido (workflow de aprovação)
| Campo | Tipo | Tam | Dec | Obrig. | Descrição |
|---|---|---|---|---|---|
| ZA4_FILIAL | C | (tam. filial) | | S | Filial |
| ZA4_NUM | C | (= C5_NUM) | | S | Número do pedido |
| ZA4_STATUS | C | 1 | | S | `P`=Pendente, `A`=Aprovado, `J`=Rejeitado, `C`=Cancelado (combo) |
| ZA4_MOTIVO | C | 250 | | S | Motivo da pendência/decisão |
| ZA4_VALOR | N | 14 | 2 | S | Valor do pedido na inclusão |
| ZA4_DESCMX | N | 5 | 2 | N | Maior desconto concedido |
| ZA4_USRINC / ZA4_DTINC / ZA4_HRINC | C6 / D / C8 | | | S | Quem incluiu e quando |
| ZA4_USRAPR / ZA4_DTAPR / ZA4_HRAPR | C6 / D / C8 | | | N | Quem decidiu e quando |

Índices **1** `ZA4_FILIAL+ZA4_NUM`; **2** `ZA4_FILIAL+ZA4_STATUS+ZA4_NUM`. **X2_UNICO** = `ZA4_FILIAL+ZA4_NUM`.
Relacionamento: `ZA4_NUM` = `C5_NUM` (1:1). Registrar o relacionamento no **SX9** para a consulta de integridade do Configurador.

## 4. Filiais e compartilhamento (SX2: X2_MODO / X2_MODOUN / X2_MODOEMP)

| Tabela | Proposta | Motivo |
|---|---|---|
| ZA1, ZA2, ZA4 | **Exclusivo** (E/E/E) | Acompanham documentos da filial (pedidos, títulos, movimentos). |
| ZA3 | Seguir o compartilhamento da **SBM** | A alçada é por grupo; se SBM é compartilhada, ZA3 também deve ser, para não exigir cadastro repetido por filial. |

Os fontes usam sempre `FWxFilial("ALIAS")` / `%xFilial:ALIAS%`, então funcionam com qualquer modo, desde que o SX2 esteja coerente. ⚠️ Mudar o compartilhamento depois de haver dados exige migração do campo `_FILIAL`.

## 5. Parâmetros (SX6)

`X6_VAR` tem 10 posições; por isso os nomes são curtos.

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| ZZ_DESCMXV | N | 10 | Desconto máximo (%) do vendedor sem aprovação (usado quando o grupo não tem ZA3) |
| ZZ_DESCMXG | N | 25 | Desconto máximo (%) com aprovação gerencial |
| ZZ_CREDPOL | C | APROVACAO | `REJEITAR` ou `APROVACAO` quando o pedido excede o crédito |
| ZZ_ESTNEG | L | .F. | Permitir saída/pedido acima do disponível (a regra final do padrão é o **MV_ESTNEG**) |
| ZZ_APROVAD | C | (vazio) | Códigos de usuários aprovadores, separados por `/` |
| ZZ_TESVEND | C | (vazio) | TES de venda usada pelo `U_ZPedInc` — **definir com a área fiscal** |
| ZZ_MOTBX | C | NOR | Motivo de baixa (deve existir na tabela de motivos de baixa) ⚠️ |
| ZZ_BCOBX / ZZ_AGEBX / ZZ_CTABX | C | (vazio) | Banco/agência/conta das baixas demonstrativas (cadastro SA6) |

## 6. Perguntas de relatório (SX1)

| Grupo | Ordem | Pergunta | Tipo | Tam | Variável |
|---|---|---|---|---|---|
| ZERPREL1 | 01 | Emissão de? | D | 8 | MV_PAR01 |
| ZERPREL1 | 02 | Emissão até? | D | 8 | MV_PAR02 |
| ZERPREL1 | 03 | Cliente de? (F3 SA1) | C | = A1_COD | MV_PAR03 |
| ZERPREL1 | 04 | Cliente até? (F3 SA1) | C | = A1_COD | MV_PAR04 |
| ZERPREL2 | 01 | Cliente de? | C | = A1_COD | MV_PAR01 |
| ZERPREL2 | 02 | Cliente até? | C | = A1_COD | MV_PAR02 |

## 7. Validações de usuário sugeridas no dicionário padrão (X3_VLDUSER)

| Campo | Expressão | Observação |
|---|---|---|
| A1_CGC | `U_ZVldDoc(M->A1_PESSOA, M->A1_CGC) .And. !U_ZCliDup(M->A1_CGC, M->A1_COD, M->A1_LOJA)` | ⚠️ O padrão já valida o CGC (função `CGC()`); avaliar se basta acrescentar apenas a regra de duplicidade. |

## 8. Exclusão lógica e tratamento de registros

- Tabelas padrão: exclusão sempre pela rotina padrão (que marca `D_E_L_E_T_`). Clientes e produtos **não são excluídos**, e sim bloqueados (`A1_MSBLQL`/`B1_MSBLQL = '1'`).
- Toda query filtra `%notDel%` e `%xFilial%`.
- ZA1 e ZA2 são somente inclusão (trilha). ZA3 permite exclusão pelo MVC (lógica). ZA4 nunca é excluída: o cancelamento muda o status.

## 9. Compatibilidade com o dicionário

- Criar as tabelas Z pelo **Configurador** (ou por pacote de atualização de dicionário homologado, ex.: UPDDISTR ⚠️ confirmar o mecanismo adotado pela empresa no release, já que o dicionário pode estar no banco de dados).
- Não editar os arquivos/tabelas do dicionário diretamente no banco.
- Após criar, rodar a verificação de integridade do dicionário e conferir a criação física das tabelas no DBAccess (a tabela física é criada no primeiro acesso, ou pelo próprio processo de atualização).
