# ExecAuto, ponto de entrada, REST e integração futura

> Nada aqui foi executado em AppServer. As assinaturas citadas são as usadas em exemplos e documentação de rotina automática. **Antes de usar, confirme no TDN da sua release** (procure pelo nome da rotina + "ExecAuto" / "rotina automática").

## 1. MsExecAuto — fluxo de pedido de venda (`U_ZPedInc`, ZERPPED.PRW)

### Por que ExecAuto
A MATA410 executa validações de dicionário, gatilhos, regras fiscais, pontos de entrada e integrações do pedido. Gravar SC5/SC6 com `RecLock` pularia tudo isso. O ExecAuto roda a **mesma** lógica da tela, sem interface.

### Chamada
```advpl
Private lMsErroAuto    := .F.   // a rotina marca .T. em caso de erro
Private lMsHelpAuto    := .T.   // Help() não abre tela; mensagens vão para o log
Private lAutoErrNoFile := .T.   // log fica em memória (GetAutoGRLog) em vez de arquivo
MsExecAuto({|a, b, c| MATA410(a, b, c)}, aCabec, aLinhas, nOpc)  // 3=inclusão 4=alteração 5=exclusão
```

| Parâmetro | Conteúdo |
|---|---|
| `aCabec` | `{ {"C5_NUM", cNum, Nil}, {"C5_TIPO","N",Nil}, {"C5_CLIENTE",...}, {"C5_LOJACLI",...}, {"C5_CONDPAG",...} }` |
| `aLinhas` | array de itens; cada item `{ {"C6_ITEM",...}, {"C6_PRODUTO",...}, {"C6_QTDVEN",...}, {"C6_PRUNIT",...}, {"C6_PRCVEN",...}, {"C6_VALOR",...}, {"C6_TES",...}, {"C6_LOCAL",...} }` |
| `nOpc` | 3, 4 ou 5 |

Cuidados:
- **Ordem dos campos importa**: os gatilhos (SX7) disparam na ordem do vetor. Existe `FWVetByDic()` para ordenar o vetor pela ordem do dicionário ⚠️ confirmar assinatura no release.
- **TES** (`C6_TES`) define o tratamento fiscal, de estoque e financeiro. Ela vem do parâmetro `ZZ_TESVEND`, que **precisa ser definido pela área fiscal** (ou trocado por TES inteligente). O fonte não presume TES.
- **Desconto**: enviamos o preço de lista (`C6_PRUNIT`) e o líquido (`C6_PRCVEN`). Se o ambiente recalcula o preço por gatilho de `C6_DESCONT`, ajuste o vetor para enviar o percentual e deixar o gatilho calcular.
- **Numeração**: `GetSxeNum("SC5","C5_NUM")` + `ConfirmSX8()` só depois do sucesso; em caso de falha, `RollBackSX8()` devolve o número.

### Tratamento de erro
```advpl
If lMsErroAuto
    DisarmTransaction()          // desfaz SC5/SC6 e as gravações Z da mesma transação
    cErro := U_ZLogExec()        // texto do GetAutoGRLog(), sem tela
EndIf
```
Em tela interativa, `MostraErro()` exibe o log, mas **sempre fora** do `Begin/End Transaction`.

### Limites da transação
`Begin Transaction ... End Transaction` envolve: ExecAuto (SC5/SC6), ZA4 e ZA1. A MATA410 abre a própria transação, que nesse caso fica **aninhada**: o commit só acontece no `End Transaction` externo, e um `DisarmTransaction()` desfaz tudo. **Fora** da transação ficam a numeração SXE/SXF (com sua própria confirmação), mensagens de interface e qualquer chamada externa (HTTP, e-mail).

### Como verificar compatibilidade com o release
1. TDN: página "MATA410 - Pedidos de Venda - ExecAuto" do release.
2. No ambiente de desenvolvimento, rodar `U_ZPedInc` com um pedido mínimo e, em seguida, `U_ZPedInc` com um erro proposital (ex.: TES inexistente) para validar o log.
3. Conferir no APSDU/consulta SQL: SC5/SC6 gravados, ZA4 criado, numeração consumida corretamente.

### Outras rotinas automáticas usadas
| Fonte | Rotina | Bloco | Observação |
|---|---|---|---|
| ZERPCLI | CRMA980 / MATA030 | `{|a,b,c| CRMA980(a,b,c)}` / `{|a,b| MATA030(a,b)}` | CRMA980 recebe também `aAI0Auto` (complemento) ⚠️ |
| ZERPPROD | MATA010 | `{|x,y| MATA010(x,y)}` | |
| ZERPEST | MATA240 | `{|x,y| MATA240(x,y)}` | Movimento interno; respeita MV_ESTNEG |
| ZERPFIN | FINA070 / FINA080 | `{|x,y| FINA070(x,y)}` | Campos `AUT*` do vetor ⚠️ confirmar lista exigida |

## 2. Ponto de entrada — `MT410TOK` (ZERPPE.PRW)

| Item | Descrição |
|---|---|
| Objetivo | Impedir pedido com desconto acima da alçada **gerencial** do grupo do produto (ZA3). |
| Momento | Validação final (TudoOk) da MATA410, antes da gravação; vale também em ExecAuto. |
| Parâmetros | Não usamos `PARAMIXB` (o conteúdo varia por release). A operação vem de `INCLUI`/`ALTERA` e os itens de `aHeader`/`aCols`. |
| Retorno | `.T.` grava; `.F.` bloqueia, com `Help()` explicando o item e a alçada. |
| Impacto | Só acrescenta uma restrição; não grava dados nem altera o fluxo. |
| Compatibilidade | Só pode existir **um** `User Function MT410TOK` no RPO. Se o cliente já tiver um, incorpore a regra nele. Conferir no TDN se o PE existe no release e se `aCols` está disponível no momento da chamada. |

Próximo passo documentado (não implementado): `M410STTS` (após a gravação) para criar ZA4 nos pedidos digitados na tela padrão. ⚠️ Confirmar no TDN o momento exato de execução.

Para impedir o **faturamento** de pedido pendente/rejeitado na ZA4 (e não apenas na demonstração web), avaliar os pontos de entrada da liberação (MATA440) ou da preparação do documento de saída (MATA460). Os nomes e as assinaturas variam: **não foram implementados** para não inventar contrato.

## 3. REST — `ZERPCLIENTES` (ZERPAPI.PRW)

### Separação de responsabilidades
| Camada | Onde | O que faz |
|---|---|---|
| Autenticação | AppServer (`[HTTPREST]`, `SECURITY=1`) | Usuário Protheus via Basic ou OAuth2 (conforme o release). Nenhuma credencial no fonte. |
| Validação | `ZValCorpo()` | Tipos, tamanhos, obrigatórios, normalização. |
| Negócio | `U_ZCliInc()` (ZERPCLI) + ZERPVAL | Duplicidade, dígitos verificadores, ExecAuto. |
| Resposta | `ZResp()` / `ZErro()` | Status HTTP e JSON padronizados; nunca expõe pilha/SQL. |

### Configuração mínima do appserver.ini (exemplo, ajustar ao ambiente)
```ini
[HTTPV11]
Enable=1
Sockets=HTTPREST

[HTTPREST]
Port=8181
URIs=HTTPURI
SECURITY=1

[HTTPURI]
URL=/rest
PrepareIn=01        ; empresa(s) preparadas para as threads REST
Instances=1,2
CORSEnable=0
```
⚠️ Chaves e valores variam por build. Confira a documentação "REST ADVPL - configuração" do release. Em produção, use **HTTPS** (`SSL`) e não exponha a porta REST diretamente na internet.

### Exemplos
```http
GET /rest/zerpclientes?search=METAL&page=1&pageSize=20
Authorization: Basic <credencial do usuário Protheus — nunca versionar>

200 OK
{"itens":[{"codigo":"000001","loja":"01","razao_social":"METALURGICA HORIZONTE LTDA","documento":"10101010000178","ativo":true}],"total":1,"pagina":1,"tamanho":20}
```
```http
POST /rest/zerpclientes
Content-Type: application/json

{"razao_social":"Cliente Exemplo Ltda","nome_fantasia":"Exemplo","tipo_pessoa":"J","documento":"11.222.333/0001-81",
 "cep":"01001000","logradouro":"Rua A","numero":"10","bairro":"Centro","municipio":"Sao Paulo","cod_municipio":"50308",
 "uf":"SP","cond_pagto":"001","limite_credito":10000}

201 Created  {"codigo":"000123","loja":"01"}
409 Conflict {"erro":{"codigo":"CONFLITO","mensagem":"ja existe cliente com este CPF/CNPJ."}}
422          {"erro":{"codigo":"VALIDACAO","mensagem":"Campo uf com tamanho invalido."}}
```

## 4. Integração futura da demonstração web com o AppServer

A camada web foi organizada para trocar a persistência local pela API do Protheus sem reescrever a interface:

```
Navegador ── /api/* ──► Node (BFF: sessão, CSRF, validação) ──► REST Protheus (/rest/zerp*)
                                   │                                   │
                                   └─ SQLite (somente demonstração)    └─ AppServer → DBAccess → banco
```

1. Cada `services/*.js` passa a chamar um *adapter* HTTP para os endpoints `ZERP*` em vez do SQLite. As regras críticas (crédito, estoque, duplicidade) passam a valer **no Protheus**, e o Node só faz uma pré-validação.
2. A autenticação do BFF troca usuário/senha local por **OAuth2 do Protheus** (ou por um usuário técnico de integração com permissão mínima). O token fica **no servidor**, nunca no navegador.
3. A idempotência continua ponta a ponta: o BFF repassa a `Idempotency-Key` como `cChave` para `U_ZEstMov`/`U_ZFinBxR` (ZA2).
4. Endpoints a criar seguindo o padrão do ZERPAPI: `zerpprodutos`, `zerppedidos` (inclusão via `U_ZPedInc`, aprovação via `U_ZPedApr`), `zerpestoque` (`U_ZEstMov`), `zerpfinanceiro` (`U_ZFinBxR`/`U_ZFinBxP`).
5. Antes disso, verifique se a TOTVS já oferece API padrão para a entidade (há APIs REST padrão para vários cadastros nos releases recentes). Preferir a API oficial quando ela existir.
