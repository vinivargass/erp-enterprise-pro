# Área administrativa: painel exclusivo e gestão do perfil Admin

## 1. Análise do que existia
| Item | Encontrado |
|---|---|
| Tecnologia | Node.js (HTTP nativo) + SQLite (`node:sqlite`) + SPA em JavaScript puro. Sem Supabase/Firebase/Power BI. |
| Autenticação | Própria do projeto (`server/auth.js`): sessão opaca em cookie HttpOnly, CSRF, scrypt. **Reutilizada**, sem sistema paralelo. |
| Fonte oficial de permissões | Tabela `usuarios.perfil` + matriz `PERMISSOES` (`auth.js`). As permissões são **recalculadas do banco a cada requisição** (`sessao()` faz JOIN com `usuarios`), então não há cache de autorização para invalidar no cliente. |
| Perfis | ADMIN, GERENTE, VENDEDOR, ESTOQUE, FINANCEIRO, CONSULTA. "Usuário comum" = qualquer perfil diferente de ADMIN. Há um único nível de administrador (sem hierarquia entre admins). |
| Auditoria | Tabela `auditoria` existente, reaproveitada. |
| E-mail de usuário | **Não existe** na tabela `usuarios`. A pesquisa é por nome e login. Ver §6. |

## 2. Arquivos criados ou modificados
| Arquivo | Alteração |
|---|---|
| `web/server/services/admin.js` | **Novo.** Pesquisa de usuários (sem diferenciar maiúsculas/acentos), conceder/remover Admin com auditoria de sucesso/falha, histórico, dados do painel e tabela de vendas. |
| `web/server/auth.js` | Permissão `admin.painel`; `alterarUsuario` (ponto único de troca de perfil) ganhou: proteção do **último admin ativo**, `perfil_base`, compare-and-set e retorno do nome. |
| `web/server/app.js` | Rotas `/api/admin/*`; **registro de toda falha de autorização (403)** na auditoria. |
| `web/server/db.js` | Migração: coluna `usuarios.perfil_base`; triggers que tornam a `auditoria` **imutável**; índice por ação. |
| `web/public/js/paginas/admin-painel.js` | **Novo.** Painel estilo BI: filtros, 8 indicadores, linha, rosca, barras, tabela com pesquisa/ordenação/paginação, botão Atualizar. |
| `web/public/js/paginas/admin-usuarios.js` | **Novo.** Pesquisa, filtros Todos/Administradores/Comuns e status, ações individuais com confirmação, histórico. |
| `web/public/js/grafico.js` | Novos gráficos `linha` e `rosca` (com dica, legenda e tabela acessível). |
| `web/public/js/main.js` | Menu "Administração" e rotas `#/admin/painel`, `#/admin/usuarios`. |
| `web/public/js/ui.js` | Componente `acessoNegado`. |
| `web/public/css/app.css` | Estilos da área administrativa e tokens de cor categórica (claro/escuro). |
| `web/tests/admin.test.js` | **Novo.** 10 testes dos cenários obrigatórios. |
| `testar.cmd`, `web/package.json` | Rodam as duas suítes. |

As demais telas não foram alteradas. A tela antiga de usuários (Parâmetros → Usuários) continua funcionando e agora também respeita a proteção do último admin, porque usa a mesma função.

## 3. Alterações no banco
```sql
ALTER TABLE usuarios ADD COLUMN perfil_base TEXT CHECK (perfil_base IS NULL OR perfil_base <> 'ADMIN');
CREATE TRIGGER trg_aud_sem_update BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria é imutável.'); END;
CREATE TRIGGER trg_aud_sem_delete BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria é imutável.'); END;
CREATE INDEX ix_auditoria_acao ON auditoria (acao, id);
```
A migração roda sozinha ao iniciar o servidor e **não altera nenhum usuário**: `perfil_base` nasce vazio. Conferido no banco real: os 11 usuários mantiveram perfil e situação.

`perfil_base` guarda o perfil "comum" para onde a pessoa volta ao perder o Admin. Ex.: VENDEDOR → ADMIN → (remover) → VENDEDOR. Sem registro anterior, volta para CONSULTA (o perfil de menor privilégio).

## 4. Regras de segurança
| Regra | Onde |
|---|---|
| Painel e dados só para ADMIN | rotas `/api/admin/painel` e `/api/admin/vendas` exigem `admin.painel`; a verificação é **no servidor**, com o perfil lido do banco. |
| Gestão de perfis só para ADMIN | rotas `/api/admin/usuarios*` e `/api/usuarios*` exigem `usuarios.gerir`. |
| URL direta | `#/admin/...` abre a página, que pede os dados ao servidor; sem permissão recebe 403 e mostra "Acesso restrito", sem nenhum dado. A tentativa fica registrada. |
| Nada vindo do navegador define perfil | as ações recebem só o **id** do alvo; o novo perfil é decidido no servidor (ADMIN ou `perfil_base`). Campos extras no corpo são ignorados. O autocadastro sempre cria CONSULTA. |
| Ninguém se eleva | sem `usuarios.gerir` → 403; admin não altera o próprio perfil. |
| Último administrador ativo | `alterarUsuario` recusa qualquer mudança que deixe zero admins ativos (proteção em profundidade contra remoções cruzadas). A tela também desabilita o botão. |
| Efeito imediato | toda mudança de perfil apaga as sessões abertas do usuário afetado (ele precisa entrar de novo, já com o perfil novo). |
| Sucesso só após gravar | a resposta 200 sai depois do COMMIT; a tela só mostra sucesso com essa resposta e então recarrega a lista. Falha → 500 genérico com código de rastreio, sem detalhe interno. |
| Sem segredos expostos | a pesquisa devolve id, nome, login, perfil e status. Nunca `senha_hash`, tokens ou sessões. |
| Auditoria | concessões/remoções com administrador, usuário afetado, perfil anterior/novo, ação, data/hora e **resultado** (SUCESSO, NEGADO ou FALHA); acessos ao painel; toda resposta 403. Trilha imutável por trigger. |

## 5. Como testar
Automático: `testar.cmd` (45 testes; inclui troca para qualquer perfil com verificação do que cada um acessa. Antes: 44: 34 anteriores + 10 da área administrativa, todos aprovados em 2026-10-20). Os testes usam banco **em memória** com usuários de teste; nenhuma conta real é alterada.

Manual (demonstração, senha `Demo@2026`):
1. Entre como `admin`: o menu mostra **Administração → Painel administrativo / Usuários e perfis**.
2. No painel, troque período, grupo e vendedor e clique em **Aplicar filtros**. Os indicadores, gráficos e tabela mudam. Pesquise e ordene a tabela.
3. Em **Usuários e perfis**, pesquise `vinicius` (ou `VINÍCIUS`), clique em **Tornar administrador** e confirme.
4. Saia e entre com o usuário promovido: o menu Administração aparece.
5. Volte como `admin` e clique em **Remover administrador**: a conta continua ativa e a pessoa volta ao perfil anterior. O histórico mostra as duas ações.
6. Entre como `consulta` e abra `http://localhost:3000/#/admin/painel` direto: aparece "Acesso restrito", e a tentativa entra no indicador "Acessos negados".

## 6. O que falta / limitações
- **E-mail:** não existe no cadastro de usuários. Para pesquisar por e-mail: adicionar a coluna `email` (migração em `db.js`), pedir o e-mail no autocadastro com validação, incluir na busca de `admin.js` e exibir só para ADMIN. Não foi feito para não inventar dado.
- **Pesquisa sem acentos em memória:** adequada ao volume de usuários de um ERP. Com milhares de usuários, guardar uma coluna normalizada e indexada.
- **Hierarquia de administradores:** não existe no sistema. Todos os ADMIN têm o mesmo poder.
- **Power BI:** não há integração. O painel é próprio, com visual semelhante e dados do banco da aplicação.

## 7. Acréscimos posteriores
- **Alterar para qualquer perfil** (`POST /api/admin/usuarios/:id/perfil`): janela com os 6 perfis, a descrição de cada um e a lista de acessos (gerada da matriz de permissões do servidor).
- **Desativar/Reativar conta** na aba Usuários e perfis. A seção "Usuários" da tela Parâmetros foi **removida**, e as rotas antigas `/api/usuarios` continuam disponíveis para compatibilidade.
- **Aba Excluir usuários** (`DELETE /api/admin/usuarios/:id`): exclusão definitiva só para contas **sem histórico** (sem pedidos, movimentações de estoque, baixas ou alterações registradas), que não sejam administradoras nem a própria conta. Exige digitar o login para confirmar. As regras são reavaliadas dentro da transação, e a exclusão (ou a tentativa negada) fica na auditoria. Para contas com histórico, a tela oferece **Desativar**.
- Testes: 47/47 (inclui perfis limitados por área, desativação e exclusão).
- **Excluir conta desativada (mesmo com histórico):** desative e depois exclua. Pedidos, movimentos, baixas e auditoria continuam no banco com o login original, e esse login entra na tabela nova `logins_reservados`. O autocadastro recusa o login reservado (sem diferenciar maiúsculas), para ninguém "herdar" o histórico ou os pedidos de outra pessoa. Contas sem histórico, ao serem excluídas, liberam o login. Testes: 48/48.
