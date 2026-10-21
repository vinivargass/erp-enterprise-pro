# Relatório final de conformidade técnica

## O que foi realmente validado
| Item | Situação |
|---|---|
| Aplicação web: 30 testes automatizados (12 obrigatórios + 18 extras) | **Executados, 30/30 aprovados** (2026-10-20). |
| Servidor web em execução, fluxos via API (curl) | Executado. |
| Carga de todos os módulos do frontend (imports/exports) | Executado. |
| Inspeção visual das telas no navegador | **Não executada** por quem desenvolveu. |
| Compilação dos 10 fontes ADVPL | **Não executada.** Nenhuma afirmação de que compilam. |
| Execução de ExecAuto, PE, REST e TReport em AppServer | **Não executada.** Roteiro em TESTES_PROTHEUS.md. |

## Dependências de ambiente e versão
| Camada | Dependência |
|---|---|
| Web | Node.js ≥ 22.5 (usa `node:sqlite` e `node:test`); validado com Node 24.21.0 embutido no VS Code. Nenhum pacote npm. Navegador moderno (ES modules, `crypto.randomUUID`, CSS custom properties). |
| Protheus | 12.1.2x com LIB atualizada; TDS-VSCode; SIGAFAT, SIGAEST, SIGAFIN, SIGACFG; dicionário Z e parâmetros ZZ_* criados; REST habilitado no appserver.ini. Detalhes em IMPLANTACAO.md. |

## Limitações conhecidas
**Demonstração web**
1. Persistência local SQLite (arquivo único). **Não é** integração com o Protheus.
2. Faturamento demonstrativo: não emite NF-e, não calcula impostos, não usa TES.
3. Financeiro sem integração bancária, sem CNAB/boleto. Contas a pagar são lançadas pelo seed (não há módulo de compras).
4. Sem HTTPS (localhost); sem MFA ou gestão de usuários pela tela; sessões em instância única.
5. Listas de seleção do pedido e dos relatórios carregam até 100 clientes/produtos (suficiente para a demo; em escala, trocar por busca com autocompletar).
6. O pedido aceita um item por produto (quantidades somadas na mesma linha).

**Implementação Protheus**
1. Fontes não compilados. Assinaturas marcadas com ⚠️ precisam de confirmação no TDN do release: CRMA980 (3º parâmetro), FWVetByDic, campos `AUT*` de FINA070/FINA080, sintaxe `WSMETHOD ... PATH` e `::SetStatus`, métodos de `FWBrwColumn`, `FWAlert*`.
2. "Rascunho" corresponde ao Orçamento (MATA415), que não foi implementado.
3. O bloqueio de faturamento para pedido **pendente** na ZA4 não foi implementado (depende de PE de liberação/faturamento a confirmar). Cancelado é excluído e, portanto, não fatura.
4. ZA4 é criada só por `U_ZPedInc`; pedidos digitados na tela padrão precisariam do `M410STTS` (documentado, não implementado).
5. Relatórios: 2 de 6 em TReport. Os demais seguem o mesmo padrão.
6. Critério de crédito simplificado (SE1 + SC6). A análise de crédito padrão do módulo pode ser a regra correta para a empresa.
7. Regras fiscais (TES, A1_TIPO, NCM) exigem validação de especialista fiscal.

## Autoavaliação (0 a 100)

> Esta nota é a **autoavaliação** de quem fez o projeto. Ela deve ser conferida por um desenvolvedor Protheus, principalmente o critério de ADVPL, que só pode ser medido compilando.

| Critério | Peso | Nota | Evidências e descontos |
|---|---|---|---|
| Qualidade e funcionalidade da aplicação web | 15 | **12** | Os 7 módulos funcionais, com filtros, paginação, ordenação, modais, toasts, estados de carregamento/vazio/erro, máscaras, pt-BR, tema escuro e acessibilidade (foco no modal, `aria-*`, tabela alternativa nos gráficos). Desconto: sem inspeção visual automatizada; selects limitados a 100 itens. |
| Arquitetura e organização | 10 | **8** | Camadas HTTP/serviços/persistência separadas; componentes reutilizáveis; zero dependências. Desconto: frontend sem testes próprios; `app.js` concentra rotas e middlewares. |
| Correção e qualidade do ADVPL | 25 | **16** | Uso de ExecAuto em vez de RecLock em tabelas padrão, `Begin/DisarmTransaction` com limites explicados, `FWGetArea/FWRestArea`, `%xFilial%/%notDel%/%exp%`, `LockByName` + idempotência, `GetSxeNum/ConfirmSX8/RollBackSX8`, sem interface dentro de transação. Desconto forte: **não compilado**; várias assinaturas dependem de confirmação; durante a revisão foram achados e corrigidos 2 defeitos lógicos (condição invertida na reativação de cliente; alias fora de escopo no TReport), o que indica que restam outros só detectáveis compilando e testando. |
| Conhecimento do framework Protheus | 15 | **11** | MVC (MPFormModel/FWFormView/FWMVCMenu/pós-validação), FWMBrowse com legendas, FWTemporaryTable justificada, TReport/TRSection/TRCell/TRFunction, WSRESTFUL + JsonObject, PE MT410TOK sem depender de PARAMIXB, SX2/SX3/SIX/SX6/SX1/SX7/SX9. Desconto: pontos de liberação/faturamento não cobertos; preferência por ExecAuto clássico onde existem APIs mais novas. |
| Integridade das regras de negócio | 15 | **13** | Web: reserva + baixa única com índice físico, compare-and-set, rollback testado, faturamento concorrente testado, segregação de funções. Protheus: delega ao padrão o que é dele. Desconto: aprovação ZA4 não bloqueia o faturamento no Protheus (limitação 3). |
| Testes e tratamento de erros | 10 | **8** | 30 testes HTTP de ponta a ponta incluindo concorrência, injeção e falha de persistência; 24 cenários Protheus roteirizados. Desconto: testes Protheus não executados; nenhum teste de interface. |
| Documentação e honestidade técnica | 10 | **9** | Incertezas marcadas no código e nos documentos; status "NÃO COMPILADO" em todos os fontes; separação clara entre web e Protheus; matriz de rastreabilidade. |
| **Total** | **100** | **77** | **Classificação: 75–89 — boa base, com pontos específicos para revisar.** |

### Pontos que um revisor Protheus deve olhar primeiro
1. Compilar e rodar P2, P6, P14 e P17 do roteiro (cobrem ExecAuto de 4 rotinas diferentes).
2. Confirmar a rotina de clientes do release (CRMA980 × MATA030) e o vetor exigido.
3. Validar o vetor de baixa (`AUT*`) com o financeiro e o motivo de baixa configurado.
4. Decidir a regra de crédito oficial (análise padrão × `U_ZCredUso`).
5. Definir com a área fiscal a TES (`ZZ_TESVEND`) e o `A1_TIPO`.
