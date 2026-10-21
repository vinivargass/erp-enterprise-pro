# Análise, arquitetura e decisões técnicas

## Fase 1 — Análise

### Requisitos centrais
- ERP navegável com 7 módulos (dashboard, clientes, produtos, pedidos, estoque, financeiro, relatórios) e regras reais: crédito, alçada de desconto, reserva e baixa de estoque, máquina de estados do pedido, liquidação sem duplicidade, auditoria.
- Duas camadas **separadas e identificadas**: demonstração web (executável) e implementação Protheus (ADVPL, não executada).
- Honestidade técnica: nada de ADVPL "simulado" em JavaScript, nada de afirmar compilação ou integração não testadas.

### Restrições do ambiente
| Restrição | Consequência |
|---|---|
| Sem Node/Python instalados na máquina | Uso do **Node 24 embutido no VS Code** (`ELECTRON_RUN_AS_NODE=1`), com `node:sqlite` e `node:test` nativos → **zero dependências npm**. |
| O único AppServer acessível é de homologação da empresa | Decisão: **não compilar** nada nele. Os fontes ADVPL são entregues para revisão e para o roteiro de testes. |
| Sem navegador automatizado na sessão | A interface foi validada por carga de módulos e testes de API, não por inspeção visual automatizada. |

### Riscos identificados
| Risco | Mitigação |
|---|---|
| Assinaturas de rotinas/funções Protheus variarem por release | Sinalizadas com ⚠️ nos fontes e documentos, com o caminho para confirmar no TDN. |
| Regras fiscais (TES, impostos, NF-e) | Fora do escopo. O faturamento web é declarado **demonstrativo**; no Protheus fica com o faturamento padrão. |
| Concorrência (pedido/estoque/baixa) | Transação com lock imediato + compare-and-set + índices únicos (web); RecLock/LockByName/X2_UNICO (Protheus). |
| Arredondamento monetário | Valores em centavos inteiros no banco. |
| Reaproveitar o "visual" da TOTVS | Identidade visual própria, sem logotipos nem cores da marca. |

## Arquitetura da demonstração web

```
web/
├── server/                 Backend Node (CommonJS, sem dependências)
│   ├── index.js            entrada: abre o banco, cria dados demo, sobe HTTP em 127.0.0.1:3000
│   ├── app.js              camada HTTP: rotas REST, sessão, CSRF, permissões, idempotência, erros, estáticos
│   ├── auth.js             scrypt, sessões, bloqueio por força bruta, matriz de permissões
│   ├── db.js               schema SQLite, transação (BEGIN IMMEDIATE + SAVEPOINT), sequências
│   ├── erros.js            AppError → status HTTP
│   ├── validacao.js        Validador, CPF/CNPJ, centavos
│   ├── seed.js             dados FICTÍCIOS gerados pelos próprios serviços (relógio simulado)
│   └── services/           REGRAS DE NEGÓCIO (sem HTTP)
│       ├── base.js         contexto, auditoria, parâmetros (≈SX6), paginação, versão
│       ├── clientes.js  produtos.js  pedidos.js  estoque.js  financeiro.js
│       └── dashboard.js  relatorios.js
├── public/                 Frontend SPA (ES modules, sem framework/bundler)
│   ├── index.html  css/app.css
│   └── js/ api.js  ui.js (componentes)  grafico.js (SVG)  main.js (layout/rotas)  paginas/*.js
├── tests/                  node:test — HTTP contra a app real com SQLite em memória
├── data/                   banco da demonstração (gerado)
└── logs/                   log técnico (gerado)
```

**Separação de responsabilidades:** `app.js` não conhece regra de negócio; `services/*` não conhecem HTTP (recebem `ctx = {db, usuario, agora}`); `db.js` só cuida de persistência e transação. Por isso os testes de regra e o seed usam os mesmos serviços, e uma troca futura de persistência (SQLite → API Protheus) fica confinada aos serviços.

**Por que sem framework:** o ambiente não tinha npm. Componentes reutilizáveis próprios (`tabelaRemota`, `formulario`, `modal`, `confirmar`, `toast`, `barrasVerticais`) dão o mesmo resultado prático com zero dependências e sem build.

### Decisões de domínio
| Decisão | Motivo |
|---|---|
| Saldo só muda por movimentação; movimentos imutáveis (triggers) | Rastreabilidade; editar produto nunca altera o histórico. |
| Reserva no aprovado, baixa no faturamento | Impede vender o mesmo saldo duas vezes e só baixa o estoque com o "documento". |
| Índice único `(origem, referencia, produto)` para origem PEDIDO | Barreira física contra baixa duplicada, além da regra de status. |
| Preço do item vem do cadastro | O cliente da API não consegue impor preço. |
| Segregação: emissor não aprova | Controle interno básico. |
| Cancelado não fatura; faturado não cancela | Estorno de faturado exige processo fiscal (devolução/cancelamento de NF). |

## Fase 2 — Planejamento (estrutura do projeto)

```
ERP_ENTERPRISE_PRO/
├── README.md               visão geral, execução, avaliação
├── iniciar.cmd / testar.cmd
├── docs/                   ARQUITETURA, API, TESTES, SEGURANCA, CONFORMIDADE
├── web/                    demonstração executável (acima)
└── protheus/
    ├── src/                fontes ADVPL (NÃO compilados)
    │   ├── ZERPVAL.PRW     validações e utilitários compartilhados (CPF/CNPJ, saldo, crédito, idempotência, auditoria)
    │   ├── ZERPCLI.PRW     clientes: browse gerencial SA1, ExecAuto CRMA980/MATA030, inativação, crédito, histórico
    │   ├── ZERPPROD.PRW    produtos: ExecAuto MATA010, painel FWTemporaryTable de estoque baixo
    │   ├── ZERPDESC.PRW    cadastro MVC completo (ZA3: alçadas de desconto)
    │   ├── ZERPPED.PRW     pedidos: ExecAuto MATA410, aprovação ZA4, cancelamento, browse de aprovação
    │   ├── ZERPEST.PRW     estoque: ExecAuto MATA240 + LockByName + ZA2
    │   ├── ZERPFIN.PRW     financeiro: ExecAuto FINA070/FINA080 sem baixa duplicada
    │   ├── ZERPREL.PRW     relatórios TReport + BeginSql
    │   ├── ZERPPE.PRW      ponto de entrada MT410TOK
    │   └── ZERPAPI.PRW     WSRESTFUL ZERPCLIENTES
    ├── dicionario/DICIONARIO.md
    └── docs/               INTEGRACAO (ExecAuto/PE/REST), IMPLANTACAO, TESTES_PROTHEUS, MATRIZ
```

**Justificativa da divisão dos fontes:** um fonte por módulo de negócio (o mesmo recorte do menu e da responsabilidade funcional), mais três transversais: `ZERPVAL` (regras compartilhadas, para não duplicar validação entre tela, API e ExecAuto), `ZERPPE` (pontos de entrada isolados, porque o nome da User Function é imposto pelo padrão e só pode existir uma por RPO) e `ZERPAPI` (camada HTTP separada do negócio). O MVC de alçadas (`ZERPDESC`) é separado de `ZERPPED` porque é um cadastro com ciclo de vida próprio.
