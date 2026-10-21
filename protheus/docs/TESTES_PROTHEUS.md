# Roteiro de testes que dependem do ambiente Protheus

> **NENHUM destes testes foi executado.** Este documento traz o procedimento e o resultado esperado, para um desenvolvedor executar em ambiente de desenvolvimento/homologação. Registre na coluna "Obtido" o que realmente aconteceu.

Preparação comum: dicionário criado (DICIONARIO.md), fontes compilados, parâmetros ZZ_* configurados, um cliente ativo `C1`, produtos `P1` (saldo 10 no armazém 01, grupo G1) e `P2` (saldo 0), ZA3 do grupo G1 com alçadas 10/25, usuário vendedor `V1` e aprovador `A1` (em ZZ_APROVAD). Para chamar funções de serviço, use uma rotina de teste (`User Function ZTST...`) ou o TDS (executar função).

| # | Cenário | Procedimento | Resultado esperado | Obtido |
|---|---|---|---|---|
| P1 | Compilação | Compilar os 10 fontes na ordem do IMPLANTACAO.md | Sem erros; anotar warnings | |
| P2 | Cliente válido via API | `POST /rest/zerpclientes` com CNPJ válido inédito | 201, cliente na SA1 pela CRMA980, ZA1 com INCLUSAO | |
| P3 | CPF/CNPJ duplicado | Repetir P2 com o mesmo documento | 409; nenhuma SA1 nova; número SXE devolvido (RollBackSX8) | |
| P4 | Documento inválido | `U_ZVldDoc("J","11111111111111")` e `U_ZVldDoc("F","52998224725")` | `.F.` e `.T.` | |
| P5 | Produto com preço inválido | `U_ZPrdInc` com `preco_venda = 0` | `{.F., "Preco de venda deve ser maior que zero."}` sem chamar MATA010 | |
| P6 | Pedido válido | `U_ZPedInc(C1, "01", "", {{P1, 2, 5}})` | `.T.`, status A; SC5/SC6 gravados; ZA4 = A; `ConfirmSX8` | |
| P7 | Crédito excedido | Reduzir `A1_LC` de C1; repetir P6 com valor acima | Política APROVACAO → ZA4 = P com motivo; política REJEITAR → `.F.`, sem SC5 | |
| P8 | Estoque insuficiente | `U_ZPedInc(C1,"01","",{{P2,1,0}})` com ZZ_ESTNEG=.F. | `.F.` "estoque insuficiente"; sem SC5 | |
| P9 | Desconto acima da alçada gerencial (PE) | Na tela MATA410, item de G1 com 30% | MT410TOK bloqueia com Help citando a alçada 25% | |
| P10 | Aprovação com segregação | `V1` inclui pedido pendente; `V1` tenta `U_ZPedApr` | Recusa "emissor não pode aprovar"; com `A1` → ZA4 = A, ZA1 APROVACAO | |
| P11 | Aprovação concorrente | Duas sessões de `A1` aprovam o mesmo pedido ao mesmo tempo | Uma aprova; a outra recebe "não está pendente" ou "em uso" | |
| P12 | Cancelamento | `U_ZPedCan(cNum, "Cliente desistiu")` em pedido sem nota | SC5/SC6 excluídos (D_E_L_E_T_), ZA4 = C; pedido não aparece para faturar | |
| P13 | Cancelar pedido faturado | `U_ZPedCan` em pedido com `C5_NOTA` | `.F.` com mensagem de estorno fiscal | |
| P14 | Movimentação duplicada | `U_ZEstMov(P1,"01",1,"<TM entrada>","DOC1","Ajuste de teste","K1")` duas vezes | 1ª grava SD3+ZA2; 2ª retorna `lDuplicada = .T.` sem novo SD3 | |
| P15 | Saída acima do saldo | `U_ZEstMov` saída de 999 | `.F.` saldo insuficiente (ou erro da MATA240 conforme MV_ESTNEG) | |
| P16 | Falha no ExecAuto desfaz tudo | `U_ZEstMov` com TM inexistente na MATA240 (mas existente na SF5 para passar a 1ª validação) ou forçar erro | `lMsErroAuto`, DisarmTransaction: sem SD3, sem ZA2 | |
| P17 | Baixa duplicada | `U_ZFinBxR(...,"B1")` duas vezes; depois com outra chave | 2ª: `lDuplicada`; 3ª: "Título já liquidado" | |
| P18 | Baixa concorrente | Duas threads com chaves diferentes no mesmo título | LockByName serializa; só uma baixa total | |
| P19 | API: JSON inválido | `POST` com corpo `{"razao_social":` | 400 JSON_INVALIDO | |
| P20 | API: sem autenticação | `GET` sem Authorization com SECURITY=1 | 401 do AppServer | |
| P21 | Permissão de menu | Usuário sem acesso ao menu `U_ZERPPED` | Rotina não aparece / acesso negado pelo padrão | |
| P22 | MVC ZA3 | Incluir alçada com vendedor 30 e gerente 20 | Bloqueio "alçada do vendedor não pode superar..." | |
| P23 | FWTemporaryTable | `U_ZPrdBxa` com P2 abaixo do mínimo | Browse lista P2; ao fechar, a temporária é removida | |
| P24 | Relatórios | `U_ZERPREL1` e `U_ZERPREL2` com filtros | Dados batem com SQL de conferência; exportação para planilha funciona | |

SQL de conferência (exemplo para P14):
```sql
SELECT D3_COD, D3_QUANT, D3_TM, D3_DOC FROM SD3010 WHERE D3_DOC = 'DOC1' AND D_E_L_E_T_ = ' ';
SELECT ZA2_CHAVE, ZA2_SLDANT, ZA2_SLDPOS FROM ZA2010 WHERE ZA2_CHAVE = 'K1' AND D_E_L_E_T_ = ' ';
```
(o sufixo `010` depende da empresa; ajuste.)
