# Segurança e integridade

## Implementado na demonstração web
| Tema | Como |
|---|---|
| Autenticação | Senha com **scrypt** + sal aleatório. Sessão opaca (32 bytes aleatórios) em cookie `HttpOnly; SameSite=Strict`; o banco guarda só o SHA-256 do token. A sessão expira em 8 h, com cookie que some ao fechar o navegador; com **Continuar conectado**, dura 30 dias (cookie persistente). Logout apaga a sessão no servidor. |
| Autocadastro | Tela "Criar conta" no login. A conta nasce **sempre** com perfil SEM_ACESSO, sem nenhum módulo (um perfil enviado pelo cliente é ignorado). Senha de 8 a 72 caracteres, com letras e números, sem conter o login. Máximo de 5 cadastros por IP a cada 10 min. Só o ADMIN concede outros perfis (Administração → Usuários e perfis), e a mudança encerra as sessões abertas do usuário. O admin não pode remover o próprio acesso. |
| Força bruta | 5 falhas seguidas no mesmo login → bloqueio de 60 s (429). Para não revelar se o usuário existe, a resposta leva o mesmo tempo nos dois casos. |
| CSRF | Token por sessão, exigido em toda mutação e comparado em tempo constante. |
| Autorização por perfil | Matriz `PERMISSOES` em `auth.js` (ADMIN, DIRETORIA, GERENTE, VENDEDOR, ESTOQUE, FINANCEIRO, CONSULTA, SEM_ACESSO; resultados estratégicos só com `painel_executivo.ler`: ADMIN e DIRETORIA), verificada **no servidor** em cada rota. O menu só esconde o que o servidor também bloqueia. |
| Acesso a registros | Vendedor só lista e abre os próprios pedidos (404 para os demais). Segregação: o emissor não aprova o próprio pedido. |
| Validação no servidor | Classe `Validador`: tipos, tamanhos, obrigatórios, datas reais, casas decimais, dígitos de CPF/CNPJ, listas de opções. O frontend repete as regras só por usabilidade. |
| Entradas maliciosas | SQL sempre parametrizado (`?`); ordenação por lista branca; `LIKE` com escape; ids validados; corpo limitado a 100 KB; JSON precisa ser objeto; caracteres de controle removidos; saída na tela por `textContent` (sem `innerHTML` com dados), o que impede XSS; CSP `script-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`; CSV com neutralização de fórmulas. |
| Duplicidade e repetição | `Idempotency-Key` genérica (tabela `idempotencia`), chaves únicas em movimentos e baixas, UNIQUE em documento/código. |
| Concorrência | `BEGIN IMMEDIATE` (lock de escrita no início da transação), atualizações condicionais por `versao`/status/saldo ("compare-and-set"), índice único que impede baixar o estoque do mesmo pedido duas vezes. |
| Atomicidade | Toda operação de negócio roda em `transacao()`; uma falha desfaz tudo. Teste 12 comprova. |
| Logs | Auditoria de negócio (tabela `auditoria`: usuário, ação, antes→depois) e log técnico `web/logs/app.log` (JSON por linha: mutações, erros 4xx/5xx com código de rastreio e pilha **somente no log**, nunca na resposta). |
| Segredos | Não há segredos no código. A senha de demonstração é pública e serve **somente** para os dados fictícios. O servidor escuta apenas em `127.0.0.1` por padrão. |

## Limites conhecidos (demonstração)
- HTTP sem TLS (somente localhost). Em rede, colocar atrás de um proxy HTTPS.
- Sessões e bloqueio por força bruta ficam em memória/SQLite local, sem cluster.
- Não há troca de senha, MFA nem gestão de usuários pela interface.

## No Protheus
- Usuários, grupos, menus e privilégios ficam no **SIGACFG**. O REST usa `SECURITY=1` (Basic/OAuth2). Credenciais de integração ficam em cofre/configuração do servidor, nunca no fonte.
- Concorrência: `RecLock` no registro de decisão (ZA4), `LockByName` por chave de operação (estoque, baixa), `X2_UNICO` na ZA2, e as próprias travas das rotinas padrão.
- Transações: `Begin Transaction`/`DisarmTransaction` envolvendo ExecAuto + gravações Z. Nenhuma interface dentro da transação.

## Backup e recuperação
| Item | Demonstração | Produção (Protheus) |
|---|---|---|
| Dados | `web/data/erp-demo.db` (+ `-wal`). Backup: parar o servidor e copiar os arquivos, ou `sqlite3 erp-demo.db ".backup copia.db"`. Recriar do zero: `iniciar.cmd --reset`. | Backup do banco pelo DBA (completo diário + log de transações), com retenção e **teste periódico de restauração**. |
| Código | Repositório git | RPO versionado (patches), fontes no controle de versão, ambiente de homologação espelhado. |
| Recuperação | restaurar o arquivo `.db` | restaurar banco + RPO compatíveis; reprocessar integrações pendentes usando a idempotência (ZA2) para não duplicar. |
