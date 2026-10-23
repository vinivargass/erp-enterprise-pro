# ERP Enterprise Pro

Projeto demonstrativo de ERP inspirado nos módulos do TOTVS Protheus, feito como **avaliação técnica**. Tem duas camadas, sempre identificadas:

| Camada | Pasta | Natureza | Estado |
|---|---|---|---|
| **Demonstração web** | `web/` | Aplicação navegável: frontend SPA + API REST em Node + SQLite. Dados **fictícios**. **Não** se conecta ao Protheus. | Executável; 48/48 testes aprovados |
| **Implementação Protheus** | `protheus/` | Fontes **ADVPL** (`.PRW`), dicionário proposto, ExecAuto, MVC, PE, REST, TReport e plano de implantação. | **Não compilado** e não executado em AppServer |

> A interface é original: não usa logotipos nem identidade visual da TOTVS. "Protheus", "TOTVS" e os nomes de rotinas citados pertencem aos seus titulares e aparecem só como referência técnica.

## Como executar a demonstração

Requisito: Node.js 22.5 ou superior **ou** o VS Code instalado (os scripts usam o Node embutido nele, se não houver outro).

```bat
iniciar.cmd            :: sobe em http://localhost:3000
iniciar.cmd --reset    :: apaga o banco de demonstração e recria os dados fictícios
testar.cmd             :: roda os testes automatizados
```
Ou, com Node no PATH: `cd web && npm start` / `npm test`.

### Usuários de demonstração (senha de todos: `Demo@2026`)
| Usuário | Perfil | Pode |
|---|---|---|
| `admin` | ADMIN | tudo, inclusive parâmetros e Painel executivo |
| `diretoria` | DIRETORIA | tudo do gerente + Painel executivo (criado só em bancos novos; num banco existente, o `admin` concede o perfil) |
| `gerente` | GERENTE | cadastros, aprovar/rejeitar e faturar pedidos, auditoria (sem Painel executivo) |
| `vendedor` | VENDEDOR | clientes e pedidos (só os próprios) |
| `estoque` | ESTOQUE | produtos e movimentações |
| `financeiro` | FINANCEIRO | consultar e liquidar títulos |
| `consulta` | CONSULTA | somente leitura |

Na tela de login há **Criar conta**: a conta nova entra sem módulos liberados (SEM_ACESSO), e o `admin` define o perfil em *Administração → Usuários e perfis*. O **Painel executivo** (resultados estratégicos) é só para os perfis ADMIN e DIRETORIA.

### Roteiro rápido para avaliar
1. Entre como `vendedor`, crie um pedido com desconto de 15% e envie: ele fica **pendente** (alçada de 10%).
2. Entre como `gerente`, aprove (o estoque é reservado) e fature (o estoque é baixado e os títulos são gerados). Veja o kardex e o dashboard mudarem.
3. Tente faturar um pedido cancelado, pedir mais do que o disponível, cadastrar um CNPJ repetido ou liquidar duas vezes o mesmo título: todos são bloqueados.
4. Em **Parâmetros**, troque `ZZ_CREDPOL` para `REJEITAR` e reenvie um pedido acima do crédito.
5. Em **Relatórios**, gere e exporte um CSV (abre direto no Excel em pt-BR).

## Estrutura e documentação
| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Fases 1 e 2: requisitos, restrições, riscos, decisões, estrutura de diretórios |
| [docs/API.md](docs/API.md) | Endpoints REST, convenções, erros e exemplos de payload |
| [docs/TESTES.md](docs/TESTES.md) | Casos de teste e **resultados obtidos** |
| [docs/ADMINISTRACAO.md](docs/ADMINISTRACAO.md) | Painel exclusivo para administradores e gestão do perfil Admin: análise, arquivos, banco, segurança e testes |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Autenticação, autorização, entradas maliciosas, concorrência, backup |
| [docs/CONFORMIDADE.md](docs/CONFORMIDADE.md) | O que foi validado, dependências, limitações, **autoavaliação 0–100** |
| [protheus/dicionario/DICIONARIO.md](protheus/dicionario/DICIONARIO.md) | Tabelas padrão usadas, tabelas Z (campos, índices, compartilhamento), SX6, SX1, SX7 |
| [protheus/docs/INTEGRACAO.md](protheus/docs/INTEGRACAO.md) | MsExecAuto (parâmetros, erros, transação), ponto de entrada, REST, integração futura |
| [protheus/docs/IMPLANTACAO.md](protheus/docs/IMPLANTACAO.md) | Pré-requisitos, ordem de compilação, menus, homologação, rollback |
| [protheus/docs/TESTES_PROTHEUS.md](protheus/docs/TESTES_PROTHEUS.md) | 24 cenários com procedimento e resultado esperado (não executados) |
| [protheus/docs/MATRIZ.md](protheus/docs/MATRIZ.md) | Matriz funcionalidade web × implementação Protheus |

## Fontes ADVPL (`protheus/src`)
| Fonte | Responsabilidade | Recursos Protheus |
|---|---|---|
| ZERPVAL.PRW | Regras compartilhadas | BeginSql, FWGetArea/FWRestArea, RecLock em tabelas Z, GetAutoGRLog |
| ZERPCLI.PRW | Clientes (SA1) | FWMBrowse + legendas, MsExecAuto CRMA980/MATA030 |
| ZERPPROD.PRW | Produtos (SB1/SB2) | MsExecAuto MATA010, FWTemporaryTable, FWBrwColumn |
| ZERPDESC.PRW | Alçadas de desconto (ZA3) | **MVC completo**: MPFormModel, FWFormView, FWMVCMenu |
| ZERPPED.PRW | Pedidos (SC5/SC6 + ZA4) | **MsExecAuto MATA410**, Begin/DisarmTransaction, GetSxeNum, RecLock, ParamBox |
| ZERPEST.PRW | Estoque (SD3/SB2) | MsExecAuto MATA240, LockByName, idempotência |
| ZERPFIN.PRW | Financeiro (SE1/SE2) | MsExecAuto FINA070/FINA080, LockByName |
| ZERPREL.PRW | Relatórios | TReport, TRSection, TRCell, TRFunction, SX1 |
| ZERPPE.PRW | Ponto de entrada | MT410TOK (MATA410) |
| ZERPAPI.PRW | Integração REST | WSRESTFUL, JsonObject, SetRestFault |

Os fontes foram escritos sem acentos (ASCII), para evitar problemas de codificação no RPO e na tela do SmartClient.

## Aviso
Faturamento, impostos, TES, NF-e e liquidações são **demonstrativos**. Qualquer uso real exige configuração fiscal e financeira validada por especialistas e testes em ambiente de homologação.
