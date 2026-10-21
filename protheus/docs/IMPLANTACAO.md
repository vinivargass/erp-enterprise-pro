# Plano de implantação no Protheus

> Sequência recomendada para levar os fontes de `protheus/src` a um ambiente **de desenvolvimento**, depois homologação e só então produção. Nenhuma etapa foi executada.

## 0. Pré-requisitos e dependências de ambiente

| Item | Requisito |
|---|---|
| Protheus | 12.1.2x (fontes escritos pensando em 12.1.2310 ou superior). ⚠️ Releases mais antigos podem não ter `FWAlertSuccess/FWAlertError/FWAlertInfo/FWAlertWarning`, `FWGetArea/FWRestArea` ou a sintaxe `WSMETHOD ... PATH`. |
| LIB / framework | LIB atualizada do release (MVC, FWMBrowse, FWTemporaryTable, JsonObject, REST). |
| RPO | Compilar em RPO de **desenvolvimento**. Não compilar em RPO de produção sem homologação. |
| DBAccess | Banco homologado pelo release (SQL Server, Oracle ou PostgreSQL). As queries usam SQL ANSI simples e `COALESCE`. |
| Ferramenta | TDS-VSCode (TOTVS Developer Studio for VSCode) com acesso ao AppServer de desenvolvimento. |
| Módulos | SIGAFAT (pedido/faturamento), SIGAEST (estoque), SIGAFIN (financeiro), SIGACFG (dicionário/parâmetros). |
| Cadastros prévios | TES de venda (área fiscal), tipo de movimento SF5 para entradas/saídas manuais, condições de pagamento, grupos de produto (SBM), banco/agência/conta para baixas, motivo de baixa. |

## 1. Dicionário (SIGACFG)
1. Criar ZA1, ZA2, ZA3 e ZA4 conforme [DICIONARIO.md](../dicionario/DICIONARIO.md): SX2 (modo de compartilhamento), SX3 (campos), SIX (índices), X2_UNICO, SX7 (gatilho ZA3) e SX9 (ZA4 ↔ SC5).
2. Criar os parâmetros ZZ_* no SX6 com valores **de teste**.
3. Criar as perguntas SX1 `ZERPREL1` e `ZERPREL2`.
4. Validar se não há conflito de alias/nome com customizações existentes (ZA1–ZA4, MT410TOK).

## 2. Compilação
Ordem sugerida (dependências): `ZERPVAL` → `ZERPDESC` → `ZERPCLI` → `ZERPPROD` → `ZERPEST` → `ZERPFIN` → `ZERPPED` → `ZERPPE` → `ZERPREL` → `ZERPAPI`.
- Corrigir warnings do compilador (variáveis não usadas, includes).
- Antes de compilar `ZERPPE`, procurar no RPO por `MT410TOK` existente (uma só User Function com esse nome pode existir).

## 3. Menus (SIGACFG → Menus)
| Função | Menu sugerido | Acesso |
|---|---|---|
| `U_ZERPCLI` | Faturamento → Atualizações → Clientes (visão gerencial) | Comercial |
| `U_ZERPDESC` | Faturamento → Atualizações → Alçadas de desconto | Gerência comercial |
| `U_ZERPPED` | Faturamento → Atualizações → Aprovação comercial | Aprovadores (ZZ_APROVAD) |
| `U_ZPrdBxa` | Estoque → Consultas → Abaixo do mínimo | Estoque/compras |
| `U_ZERPREL1`, `U_ZERPREL2` | Relatórios | Conforme área |

As funções de serviço (`U_ZPedInc`, `U_ZEstMov`, `U_ZFinBxR`...) **não** vão para o menu. São chamadas por API/rotinas.

## 4. REST
Configurar `[HTTPV11]/[HTTPREST]/[HTTPURI]` no appserver.ini do serviço REST (ver [INTEGRACAO.md](INTEGRACAO.md)), reiniciar o serviço e validar `GET /rest/zerpclientes` com usuário de teste.

## 5. Testes em desenvolvimento
Executar o roteiro de [TESTES_PROTHEUS.md](TESTES_PROTHEUS.md) e registrar evidências (prints, SQL de conferência, log do console).

## 6. Homologação
- Ambiente com cópia de base anonimizada.
- Validação **fiscal** (TES, impostos, NF-e) e **financeira** (motivo de baixa, contabilização) pelos especialistas.
- Teste de concorrência: duas sessões aprovando o mesmo pedido; duas baixas simultâneas do mesmo título.

## 7. Produção
- Janela de manutenção, backup do RPO e do banco.
- Aplicar o dicionário pelo mesmo processo homologado (não recriar manualmente).
- Aplicar o patch do RPO compilado em homologação.
- Monitorar o console.log e a ZA1 nos primeiros dias.

## 8. Rollback
- RPO: restaurar o backup/patch anterior.
- Dicionário: as tabelas Z podem permanecer (não afetam o padrão). Retirar os menus e os parâmetros se necessário.
- `MT410TOK`: remover do RPO restaura o comportamento padrão.
