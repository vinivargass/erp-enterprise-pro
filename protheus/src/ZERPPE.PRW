#Include "TOTVS.ch"

/*/{Protheus.doc} MT410TOK
PONTO DE ENTRADA da rotina padrao MATA410 (Pedido de Venda).

OBJETIVO
Bloquear a gravacao de pedido com item cujo desconto ultrapasse a alcada
GERENCIAL do grupo do produto (ZA3, cadastro ZERPDESC). Descontos entre a alcada
do vendedor e a gerencial sao permitidos e tratados como "pendente de aprovacao"
pelo controle comercial (ZA4).

MOMENTO DE EXECUCAO
Validacao final ("TudoOk") do pedido, ao confirmar inclusao/alteracao, antes da
gravacao. Executa tambem quando a MATA410 roda por MsExecAuto (ex.: U_ZPedInc).

PARAMETROS
Nao dependemos de PARAMIXB: a operacao e identificada pelas variaveis publicas
INCLUI/ALTERA da rotina e os itens pelo aHeader/aCols da GetDados da MATA410.
A existencia e o conteudo de PARAMIXB para este PE variam por release - se
precisar deles, confirmar no TDN ("MT410TOK").

RETORNO
.T. permite gravar; .F. impede a gravacao (a mensagem e exibida via Help, que em
rotina automatica vai para o log do ExecAuto em vez de abrir tela).

IMPACTO NO PROCESSO PADRAO
Somente acrescenta uma restricao; nao altera dados nem o fluxo padrao.
Custo: um DbSeek em SB1 e ZA3 por item nao deletado.

COMPATIBILIDADE
- Nome e momento do PE: documentados para a MATA410. Verificar no TDN do release
  e no RPO (ExistBlock("MT410TOK") nao e necessario aqui: e o padrao que chama).
- Pode existir outro MT410TOK no RPO do cliente: so pode haver UM fonte com essa
  User Function. Se ja existir, incorporar esta regra ao fonte existente.
- C6_DESCONT e o percentual de desconto do item no padrao; confirmar no SX3.

STATUS: NAO COMPILADO.
/*/
User Function MT410TOK()
    Local lRet     := .T.
    Local aArea    := FWGetArea()
    Local nPosProd := 0
    Local nPosDesc := 0
    Local nI       := 0
    Local aDesc    := {}
    Local cGrupo   := ""

    // So valida inclusao/alteracao (na exclusao/visualizacao nao ha o que conferir).
    If Type("INCLUI") == "L" .And. Type("ALTERA") == "L" .And. (INCLUI .Or. ALTERA)
        nPosProd := aScan(aHeader, {|x| AllTrim(x[2]) == "C6_PRODUTO"})
        nPosDesc := aScan(aHeader, {|x| AllTrim(x[2]) == "C6_DESCONT"})

        If nPosProd > 0 .And. nPosDesc > 0
            SB1->(DbSetOrder(1)) // B1_FILIAL + B1_COD
            For nI := 1 To Len(aCols)
                // Ultima coluna do aCols indica linha deletada na GetDados.
                If !aCols[nI][Len(aHeader) + 1] .And. aCols[nI][nPosDesc] > 0
                    cGrupo := ""
                    If SB1->(DbSeek(FWxFilial("SB1") + aCols[nI][nPosProd]))
                        cGrupo := SB1->B1_GRUPO
                    EndIf
                    aDesc := U_ZDescMax(cGrupo)
                    If aCols[nI][nPosDesc] > aDesc[2]
                        Help(, , "MT410TOK", , "Item " + cValToChar(nI) + ": desconto de " + cValToChar(aCols[nI][nPosDesc]) + ;
                            "% acima da alcada gerencial (" + cValToChar(aDesc[2]) + "%) do grupo " + AllTrim(cGrupo) + ".", 1, 0, , , , , , ;
                            {"Reduza o desconto ou solicite revisao da alcada (rotina ZERPDESC)."})
                        lRet := .F.
                        Exit
                    EndIf
                EndIf
            Next nI
        EndIf
    EndIf

    FWRestArea(aArea)
Return lRet

/*
PROXIMO PASSO (documentado, nao implementado):
Para pedidos digitados na TELA padrao (nao via U_ZPedInc), o registro de controle
comercial ZA4 deveria ser criado apos a gravacao. O ponto de entrada M410STTS
(apos gravacao do pedido) e o candidato usual; confirmar no TDN o momento exato
de execucao e se ocorre dentro da transacao do pedido no release do ambiente
antes de implementar.
*/
