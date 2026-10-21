#Include "TOTVS.ch"

/*/{Protheus.doc} ZERPPED
Pedidos de venda: inclusao por rotina automatica (MATA410), aprovacao comercial
(alcada de desconto e credito) e cancelamento.

MAPEAMENTO DOS ESTADOS DA DEMONSTRACAO WEB
- RASCUNHO            -> no Protheus o equivalente natural e o Orcamento de Venda
                         (SCJ/SCK, rotina MATA415). Nao implementado aqui.
- PENDENTE_APROVACAO  -> SC5/SC6 gravados + ZA4_STATUS = "P"
- APROVADO            -> ZA4_STATUS = "A". A LIBERACAO de estoque/credito para
                         faturar continua sendo a padrao (SC9: MATA440, e as
                         analises de credito/estoque do modulo). Nao reimplementamos.
- REJEITADO           -> ZA4_STATUS = "J" (pedido permanece, sem liberacao)
- CANCELADO           -> pedido excluido pela MATA410 (opcao 5) + ZA4_STATUS = "C".
                         A exclusao e logica (D_E_L_E_T_), entao o dado permanece
                         rastreavel; o motivo fica em ZA4/ZA1.
- FATURADO            -> SC5->C5_NOTA preenchido pelo faturamento padrao
                         (MATA460/MATA461). FATURAMENTO FISCAL REAL depende de TES,
                         regras fiscais, NF-e e configuracao do ambiente; esta
                         demonstracao nao emite nem simula documento fiscal.

POR QUE ZA4 E NAO CAMPOS NOVOS NA SC5: mantem a tabela padrao sem alteracao
estrutural e concentra o workflow (status, aprovador, motivo, data) numa tabela
propria, facil de auditar e de remover. Se a empresa preferir campo de usuario na
SC5 (ex.: C5_XSTATUS), seguir a politica de nomenclatura de campos customizados.

GARANTIAS CONTRA DUPLICIDADE / CONCORRENCIA
- Inclusao: numero obtido por GetSxeNum, confirmado (ConfirmSX8) so apos sucesso.
- Aprovacao/cancelamento: RecLock no registro da ZA4 serializa as decisoes; o
  status e relido DEPOIS do lock (estado pode ter mudado enquanto aguardava).
- Baixa de estoque: feita somente pelo faturamento padrao, uma vez por item de
  nota (SD2). Nenhuma rotina deste fonte movimenta estoque do pedido.

STATUS: NAO COMPILADO. Ver protheus/docs/EXECAUTO.md para parametros e validacao.
/*/

#Define ZA4_PENDENTE  "P"
#Define ZA4_APROVADO  "A"
#Define ZA4_REJEITADO "J"
#Define ZA4_CANCELADO "C"

//-------------------------------------------------------------------
/*/{Protheus.doc} ZPedInc
Inclui pedido de venda via MsExecAuto(MATA410) e registra a situacao comercial (ZA4).

@param cCliente, character, A1_COD
@param cLoja   , character, A1_LOJA
@param cCond   , character, condicao de pagamento (SE4). Vazio = condicao do cliente
@param aItens  , array, { {cProduto, nQuantidade, nDescontoPct}, ... }
@return array, {lOk, cMensagem, cNumero, cStatusZA4}
/*/
//-------------------------------------------------------------------
User Function ZPedInc(cCliente, cLoja, cCond, aItens)
    Local aArea    := FWGetArea()
    Local aRet     := {.F., "", "", ""}
    Local aCabec   := {}
    Local aLinhas  := {}
    Local aLinha   := {}
    Local cNum     := ""
    Local cTes     := SuperGetMV("ZZ_TESVEND", .F., "")
    Local cLocal   := ""
    Local cStatus  := ZA4_APROVADO
    Local cMotivo  := ""
    Local aDesc    := {}
    Local nI       := 0
    Local nPrcTab  := 0
    Local nPrcLiq  := 0
    Local nTotal   := 0
    Local nMaiorDc := 0
    Local nDisp    := 0
    Local cErro    := ""

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    // ---------- 1) Validacoes de negocio ANTES da rotina automatica ----------
    DbSelectArea("SA1")
    SA1->(DbSetOrder(1)) // A1_FILIAL + A1_COD + A1_LOJA
    If !SA1->(DbSeek(FWxFilial("SA1") + cCliente + cLoja))
        cErro := "Cliente nao encontrado."
    ElseIf SA1->A1_MSBLQL == "1"
        cErro := "Cliente inativo nao pode receber pedidos."
    ElseIf Empty(aItens)
        cErro := "Informe ao menos um item."
    ElseIf Empty(cTes)
        // TES define tratamento fiscal/estoque/financeiro do item. Deve ser definida
        // pela area fiscal (parametro ZZ_TESVEND ou TES inteligente). Nao presumimos.
        cErro := "Parametro ZZ_TESVEND (TES de venda) nao configurado."
    EndIf
    If !Empty(cErro)
        FWRestArea(aArea)
        Return {.F., cErro, "", ""}
    EndIf
    cCond := IIf(Empty(cCond), SA1->A1_COND, cCond)

    DbSelectArea("SB1")
    SB1->(DbSetOrder(1)) // B1_FILIAL + B1_COD
    For nI := 1 To Len(aItens)
        If !SB1->(DbSeek(FWxFilial("SB1") + PadR(aItens[nI][1], TamSX3("B1_COD")[1]))) .Or. SB1->B1_MSBLQL == "1"
            cErro := "Item " + cValToChar(nI) + ": produto inexistente ou bloqueado."
            Exit
        EndIf
        If aItens[nI][2] <= 0
            cErro := "Item " + cValToChar(nI) + ": quantidade deve ser maior que zero."
            Exit
        EndIf
        aDesc := U_ZDescMax(SB1->B1_GRUPO) // {alcada vendedor, alcada gerente}
        If aItens[nI][3] < 0 .Or. aItens[nI][3] > aDesc[2]
            cErro := "Item " + cValToChar(nI) + ": desconto acima do maximo permitido (" + cValToChar(aDesc[2]) + "%)."
            Exit
        EndIf
        cLocal := SB1->B1_LOCPAD
        nDisp  := U_ZSaldoDisp(SB1->B1_COD, cLocal)
        If aItens[nI][2] > nDisp .And. !SuperGetMV("ZZ_ESTNEG", .F., .F.)
            cErro := "Item " + cValToChar(nI) + ": estoque insuficiente (disponivel " + cValToChar(nDisp) + ")."
            Exit
        EndIf
        If aItens[nI][3] > aDesc[1]
            nMaiorDc := Max(nMaiorDc, aItens[nI][3])
            cMotivo  := "Desconto acima da alcada do vendedor. "
        EndIf

        // Preco de tabela: B1_PRV1 nesta demonstracao. Em producao normalmente vem de
        // tabela de preco (DA0/DA1) - regra comercial a confirmar com a area.
        nPrcTab := SB1->B1_PRV1
        nPrcLiq := Round(nPrcTab * (1 - aItens[nI][3] / 100), TamSX3("C6_PRCVEN")[2])
        nTotal  += Round(nPrcLiq * aItens[nI][2], 2)

        aLinha := {}
        aAdd(aLinha, {"C6_ITEM"   , StrZero(nI, TamSX3("C6_ITEM")[1]), Nil})
        aAdd(aLinha, {"C6_PRODUTO", SB1->B1_COD                     , Nil})
        aAdd(aLinha, {"C6_QTDVEN" , aItens[nI][2]                   , Nil})
        aAdd(aLinha, {"C6_PRUNIT" , nPrcTab                         , Nil}) // preco de lista
        aAdd(aLinha, {"C6_PRCVEN" , nPrcLiq                         , Nil}) // preco liquido
        aAdd(aLinha, {"C6_VALOR"  , Round(nPrcLiq * aItens[nI][2], 2), Nil})
        aAdd(aLinha, {"C6_TES"    , cTes                            , Nil})
        aAdd(aLinha, {"C6_LOCAL"  , cLocal                          , Nil})
        aAdd(aLinhas, aLinha)
    Next nI

    If Empty(cErro) .And. SA1->A1_LC > 0 .And. U_ZCredUso(cCliente, cLoja) + nTotal > SA1->A1_LC
        If AllTrim(SuperGetMV("ZZ_CREDPOL", .F., "APROVACAO")) == "REJEITAR"
            cErro := "Limite de credito excedido (politica ZZ_CREDPOL = REJEITAR)."
        Else
            cMotivo += "Limite de credito excedido."
        EndIf
    EndIf
    If !Empty(cErro)
        FWRestArea(aArea)
        Return {.F., cErro, "", ""}
    EndIf
    If !Empty(cMotivo)
        cStatus := ZA4_PENDENTE
    EndIf

    // ---------- 2) Cabecalho ----------
    cNum := GetSxeNum("SC5", "C5_NUM")
    aAdd(aCabec, {"C5_NUM"    , cNum     , Nil})
    aAdd(aCabec, {"C5_TIPO"   , "N"      , Nil}) // N = normal
    aAdd(aCabec, {"C5_CLIENTE", cCliente , Nil})
    aAdd(aCabec, {"C5_LOJACLI", cLoja    , Nil})
    aAdd(aCabec, {"C5_CONDPAG", cCond    , Nil})

    // ---------- 3) Gravacao atomica: pedido padrao + controle ZA4 ----------
    // A MATA410 abre sua propria transacao; dentro de Begin Transaction ela passa a ser
    // aninhada, e o DisarmTransaction desfaz TUDO (SC5, SC6, ZA4, ZA1) se algo falhar.
    // Nada de interface (MostraErro/MsgAlert) dentro do bloco: so depois do End Transaction.
    Begin Transaction
        MsExecAuto({|a, b, c| MATA410(a, b, c)}, aCabec, aLinhas, 3)

        If lMsErroAuto
            DisarmTransaction()
            cErro := U_ZLogExec()
        Else
            DbSelectArea("ZA4")
            If RecLock("ZA4", .T.)
                ZA4->ZA4_FILIAL := FWxFilial("ZA4")
                ZA4->ZA4_NUM    := cNum
                ZA4->ZA4_STATUS := cStatus
                ZA4->ZA4_MOTIVO := IIf(Empty(cMotivo), "Dentro das alcadas e do limite de credito.", cMotivo)
                ZA4->ZA4_VALOR  := nTotal
                ZA4->ZA4_DESCMX := nMaiorDc
                ZA4->ZA4_USRINC := RetCodUsr()
                ZA4->ZA4_DTINC  := Date()
                ZA4->ZA4_HRINC  := Time()
                ZA4->(MsUnlock())
            EndIf
            U_ZLogAud("SC5", cNum, "INCLUSAO", "Pedido incluido. Status comercial: " + cStatus + ". " + cMotivo)
        EndIf
    End Transaction

    If Empty(cErro)
        ConfirmSX8()
        aRet := {.T., IIf(cStatus == ZA4_PENDENTE, "Pedido pendente de aprovacao: " + cMotivo, "Pedido incluido e aprovado."), cNum, cStatus}
    Else
        RollBackSX8()
        aRet := {.F., cErro, "", ""}
    EndIf

    FWRestArea(aArea)
Return aRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZPedApr
Aprova ou rejeita um pedido pendente (decisao comercial).
Regras: somente usuarios do parametro ZZ_APROVAD; o emissor nao aprova o proprio
pedido; somente status P pode ser decidido; estoque e revalidado na aprovacao.

@param cNum     , character, C5_NUM
@param lAprova  , logical  , .T. aprova / .F. rejeita
@param cMotivo  , character, obrigatorio na rejeicao
@return array, {lOk, cMensagem}
/*/
//-------------------------------------------------------------------
User Function ZPedApr(cNum, lAprova, cMotivo)
    Local aArea   := FWGetArea()
    Local cUser   := RetCodUsr()
    Local cAprov  := SuperGetMV("ZZ_APROVAD", .F., "")
    Local aRet    := {.F., ""}
    Local cFalta  := ""

    If !(cUser $ cAprov)
        Return {.F., "Usuario sem alcada de aprovacao (parametro ZZ_APROVAD)."}
    EndIf
    If !lAprova .And. Len(AllTrim(cMotivo)) < 5
        Return {.F., "Informe o motivo da rejeicao."}
    EndIf

    DbSelectArea("ZA4")
    ZA4->(DbSetOrder(1)) // ZA4_FILIAL + ZA4_NUM
    If !ZA4->(DbSeek(FWxFilial("ZA4") + cNum))
        FWRestArea(aArea)
        Return {.F., "Controle comercial do pedido nao encontrado."}
    EndIf

    // Lock primeiro, decisao depois: se outro aprovador decidiu enquanto esperavamos,
    // o status relido abaixo ja nao sera "P".
    If !ZA4->(RecLock("ZA4", .F.))
        FWRestArea(aArea)
        Return {.F., "Pedido em uso por outro usuario. Tente novamente."}
    EndIf

    If ZA4->ZA4_STATUS != ZA4_PENDENTE
        aRet := {.F., "Pedido nao esta pendente de aprovacao (status " + ZA4->ZA4_STATUS + ")."}
    ElseIf ZA4->ZA4_USRINC == cUser
        aRet := {.F., "O emissor nao pode aprovar o proprio pedido (segregacao de funcoes)."}
    Else
        If lAprova
            cFalta := ZPedFalta(cNum)
        EndIf
        If !Empty(cFalta)
            aRet := {.F., "Estoque insuficiente: " + cFalta}
        Else
            Begin Transaction
                ZA4->ZA4_STATUS := IIf(lAprova, ZA4_APROVADO, ZA4_REJEITADO)
                ZA4->ZA4_MOTIVO := IIf(lAprova, "Aprovado. " + cMotivo, cMotivo)
                ZA4->ZA4_USRAPR := cUser
                ZA4->ZA4_DTAPR  := Date()
                ZA4->ZA4_HRAPR  := Time()
                U_ZLogAud("SC5", cNum, IIf(lAprova, "APROVACAO", "REJEICAO"), cMotivo)
            End Transaction
            aRet := {.T., IIf(lAprova, "Pedido aprovado.", "Pedido rejeitado.")}
        EndIf
    EndIf
    ZA4->(MsUnlock())

    FWRestArea(aArea)
Return aRet

// Retorna texto com itens sem saldo disponivel (vazio = tudo disponivel).
Static Function ZPedFalta(cNum)
    Local aArea  := FWGetArea()
    Local cFalta := ""
    Local nDisp  := 0

    If SuperGetMV("ZZ_ESTNEG", .F., .F.)
        FWRestArea(aArea)
        Return ""
    EndIf

    DbSelectArea("SC6")
    SC6->(DbSetOrder(1)) // C6_FILIAL + C6_NUM + C6_ITEM + C6_PRODUTO
    SC6->(DbSeek(FWxFilial("SC6") + cNum))
    While !SC6->(Eof()) .And. SC6->C6_FILIAL == FWxFilial("SC6") .And. SC6->C6_NUM == cNum
        nDisp := U_ZSaldoDisp(SC6->C6_PRODUTO, SC6->C6_LOCAL)
        If SC6->C6_QTDVEN - SC6->C6_QTDENT > nDisp
            cFalta += AllTrim(SC6->C6_PRODUTO) + " (disp. " + cValToChar(nDisp) + ") "
        EndIf
        SC6->(DbSkip())
    EndDo

    FWRestArea(aArea)
Return cFalta

//-------------------------------------------------------------------
/*/{Protheus.doc} ZPedCan
Cancela pedido ainda nao faturado: exclusao pela MATA410 (opcao 5) + ZA4 = "C".
A rotina padrao recusa a exclusao se houver item liberado/faturado; mesmo assim
validamos antes para devolver mensagem clara.
/*/
//-------------------------------------------------------------------
User Function ZPedCan(cNum, cMotivo)
    Local aArea  := FWGetArea()
    Local aCabec := {}
    Local cErro  := ""

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    If Len(AllTrim(cMotivo)) < 5
        Return {.F., "Informe o motivo do cancelamento."}
    EndIf

    DbSelectArea("SC5")
    SC5->(DbSetOrder(1)) // C5_FILIAL + C5_NUM
    If !SC5->(DbSeek(FWxFilial("SC5") + cNum))
        FWRestArea(aArea)
        Return {.F., "Pedido nao encontrado."}
    EndIf
    If !Empty(SC5->C5_NOTA)
        FWRestArea(aArea)
        Return {.F., "Pedido faturado nao pode ser cancelado; o estorno exige cancelamento/devolucao da nota."}
    EndIf

    DbSelectArea("ZA4")
    ZA4->(DbSetOrder(1))
    If !ZA4->(DbSeek(FWxFilial("ZA4") + cNum)) .Or. !ZA4->(RecLock("ZA4", .F.))
        FWRestArea(aArea)
        Return {.F., "Controle comercial nao encontrado ou em uso."}
    EndIf
    If ZA4->ZA4_STATUS == ZA4_CANCELADO
        ZA4->(MsUnlock())
        FWRestArea(aArea)
        Return {.F., "Pedido ja cancelado."}
    EndIf

    aAdd(aCabec, {"C5_NUM", cNum, Nil})

    Begin Transaction
        // Itens vazios na exclusao: a MATA410 exclui todos os itens do pedido. Confirmar no TDN.
        MsExecAuto({|a, b, c| MATA410(a, b, c)}, aCabec, {}, 5)
        If lMsErroAuto
            DisarmTransaction()
            cErro := U_ZLogExec()
        Else
            ZA4->ZA4_STATUS := ZA4_CANCELADO
            ZA4->ZA4_MOTIVO := cMotivo
            ZA4->ZA4_USRAPR := RetCodUsr()
            ZA4->ZA4_DTAPR  := Date()
            ZA4->ZA4_HRAPR  := Time()
            U_ZLogAud("SC5", cNum, "CANCELAMENTO", cMotivo)
        EndIf
    End Transaction
    ZA4->(MsUnlock())

    FWRestArea(aArea)
Return IIf(Empty(cErro), {.T., "Pedido cancelado."}, {.F., cErro})

//-------------------------------------------------------------------
/*/{Protheus.doc} ZERPPED
Painel de aprovacao comercial (browse da ZA4 com legendas).
/*/
//-------------------------------------------------------------------
User Function ZERPPED()
    Local oBrowse := FWMBrowse():New()

    oBrowse:SetAlias("ZA4")
    oBrowse:SetDescription("Aprovacao comercial de pedidos de venda")
    oBrowse:SetMenuDef("ZERPPED")
    oBrowse:AddLegend("ZA4->ZA4_STATUS == 'P'", "YELLOW", "Pendente de aprovacao")
    oBrowse:AddLegend("ZA4->ZA4_STATUS == 'A'", "GREEN" , "Aprovado")
    oBrowse:AddLegend("ZA4->ZA4_STATUS == 'J'", "RED"   , "Rejeitado")
    oBrowse:AddLegend("ZA4->ZA4_STATUS == 'C'", "BLACK" , "Cancelado")
    oBrowse:Activate()
Return Nil

Static Function MenuDef()
    Local aRotina := {}

    aAdd(aRotina, {"Pesquisar"  , "PesqBrw"      , 0, 1})
    aAdd(aRotina, {"Visualizar" , "AxVisual"     , 0, 2})
    aAdd(aRotina, {"Aprovar"    , "U_ZPedTela(1)", 0, 4})
    aAdd(aRotina, {"Rejeitar"   , "U_ZPedTela(2)", 0, 4})
    aAdd(aRotina, {"Cancelar"   , "U_ZPedTela(3)", 0, 4})
Return aRotina

// Acoes de tela: pedem confirmacao/motivo e delegam para as funcoes de negocio acima.
User Function ZPedTela(nAcao)
    Local cNum    := ZA4->ZA4_NUM
    Local cMotivo := Space(200)
    Local aRet    := {}
    Local aPergs  := {}
    Local aResp   := {}

    If nAcao == 1
        If !MsgYesNo("Aprovar o pedido " + cNum + " (valor " + Transform(ZA4->ZA4_VALOR, "@E 999,999,999.99") + ")?" + CRLF + ;
                     "Motivo da pendencia: " + AllTrim(ZA4->ZA4_MOTIVO), "Aprovacao")
            Return Nil
        EndIf
        aRet := U_ZPedApr(cNum, .T., "")
    Else
        // ParamBox: tela simples de parametros. Assinatura: ParamBox(aParametros, cTitulo, @aRet)
        aAdd(aPergs, {1, "Motivo", cMotivo, "", "", "", "", 120, .T.})
        If !ParamBox(aPergs, IIf(nAcao == 2, "Rejeitar pedido ", "Cancelar pedido ") + cNum, @aResp)
            Return Nil
        EndIf
        cMotivo := AllTrim(aResp[1])
        aRet := IIf(nAcao == 2, U_ZPedApr(cNum, .F., cMotivo), U_ZPedCan(cNum, cMotivo))
    EndIf

    If aRet[1]
        FWAlertSuccess(aRet[2], "ZERPPED")
    Else
        FWAlertError(aRet[2], "ZERPPED")
    EndIf
Return Nil
