#Include "TOTVS.ch"

/*/{Protheus.doc} ZERPFIN
Financeiro demonstrativo: baixa (liquidacao) de titulos a receber (SE1/FINA070) e
a pagar (SE2/FINA080) com protecao contra pagamento duplicado.

NAO HA INTEGRACAO BANCARIA, CNAB, BOLETO OU DOCUMENTO OFICIAL. A baixa usa motivo e
conta bancaria configurados por parametro e deve ser homologada pelo financeiro.

PROTECOES CONTRA BAIXA DUPLICADA
1) LockByName pela chave do titulo: duas threads nao baixam o mesmo titulo ao mesmo tempo;
2) idempotencia (ZA2): a mesma requisicao reenviada nao gera segunda baixa;
3) saldo relido apos a trava: titulo com E1_SALDO = 0 nao aceita baixa;
4) valor > saldo e recusado antes do ExecAuto (o padrao tambem valida).

STATUS: NAO COMPILADO. Os nomes de campos "AUT*" do vetor de baixa sao os usados
na documentacao de rotina automatica da FINA070/FINA080; confirmar no TDN do
release, pois campos adicionais podem ser exigidos (ex.: natureza, multa, desconto).
/*/

//-------------------------------------------------------------------
/*/{Protheus.doc} ZFinBxR
Baixa de titulo a receber.
@return array, {lOk, cMensagem, lDuplicada}
/*/
//-------------------------------------------------------------------
User Function ZFinBxR(cPrefixo, cNum, cParcela, cTipo, nValor, dBaixa, cChave)
    Local aArea  := FWGetArea()
    Local aBaixa := {}
    Local cChTit := ""
    Local cTrava := ""
    Local aRet   := {.F., "", .F.}

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    If nValor <= 0
        Return {.F., "Valor da baixa deve ser maior que zero.", .F.}
    EndIf
    If Empty(cChave)
        Return {.F., "Chave de idempotencia obrigatoria.", .F.}
    EndIf
    If dBaixa > Date()
        Return {.F., "Data de baixa no futuro.", .F.}
    EndIf

    cChTit := PadR(cPrefixo, TamSX3("E1_PREFIXO")[1]) + PadR(cNum, TamSX3("E1_NUM")[1]) + ;
              PadR(cParcela, TamSX3("E1_PARCELA")[1]) + PadR(cTipo, TamSX3("E1_TIPO")[1])
    cTrava := "ZERPFIN_SE1_" + cChTit

    If !LockByName(cTrava, .T., .T.)
        Return {.F., "Titulo em processamento por outra operacao.", .F.}
    EndIf

    DbSelectArea("SE1")
    SE1->(DbSetOrder(1)) // E1_FILIAL + E1_PREFIXO + E1_NUM + E1_PARCELA + E1_TIPO
    If U_ZIdemExiste("BAIXA_SE1", cChave)
        aRet := {.T., "Baixa ja registrada anteriormente (nenhuma nova baixa).", .T.}
    ElseIf !SE1->(DbSeek(FWxFilial("SE1") + cChTit))
        aRet := {.F., "Titulo nao encontrado.", .F.}
    ElseIf SE1->E1_SALDO <= 0
        aRet := {.F., "Titulo ja liquidado. Baixa duplicada bloqueada.", .F.}
    ElseIf nValor > SE1->E1_SALDO
        aRet := {.F., "Valor maior que o saldo em aberto (" + AllTrim(Transform(SE1->E1_SALDO, "@E 999,999,999.99")) + ").", .F.}
    ElseIf dBaixa < SE1->E1_EMISSAO
        aRet := {.F., "Data de baixa anterior a emissao.", .F.}
    Else
        aAdd(aBaixa, {"E1_PREFIXO"  , SE1->E1_PREFIXO                       , Nil})
        aAdd(aBaixa, {"E1_NUM"      , SE1->E1_NUM                           , Nil})
        aAdd(aBaixa, {"E1_PARCELA"  , SE1->E1_PARCELA                       , Nil})
        aAdd(aBaixa, {"E1_TIPO"     , SE1->E1_TIPO                          , Nil})
        aAdd(aBaixa, {"AUTMOTBX"    , SuperGetMV("ZZ_MOTBX", .F., "NOR")    , Nil})
        aAdd(aBaixa, {"AUTBANCO"    , SuperGetMV("ZZ_BCOBX", .F., "")       , Nil})
        aAdd(aBaixa, {"AUTAGENCIA"  , SuperGetMV("ZZ_AGEBX", .F., "")       , Nil})
        aAdd(aBaixa, {"AUTCONTA"    , SuperGetMV("ZZ_CTABX", .F., "")       , Nil})
        aAdd(aBaixa, {"AUTDTBAIXA"  , dBaixa                                , Nil})
        aAdd(aBaixa, {"AUTDTCREDITO", dBaixa                                , Nil})
        aAdd(aBaixa, {"AUTHIST"     , "Baixa ERP Enterprise Pro"            , Nil})
        aAdd(aBaixa, {"AUTJUROS"    , 0                                     , Nil, .T.})
        aAdd(aBaixa, {"AUTVALREC"   , nValor                                , Nil})

        Begin Transaction
            MsExecAuto({|x, y| FINA070(x, y)}, aBaixa, 3)
            If lMsErroAuto
                DisarmTransaction()
                aRet := {.F., U_ZLogExec(), .F.}
            Else
                U_ZIdemGrava("BAIXA_SE1", cChave, "SE1:" + cChTit, "Baixa " + cValToChar(nValor), 0, 0)
                U_ZLogAud("SE1", cChTit, "BAIXA", "Valor " + cValToChar(nValor) + " em " + DtoC(dBaixa))
                aRet := {.T., "Baixa registrada.", .F.}
            EndIf
        End Transaction
    EndIf

    UnLockByName(cTrava, .T., .T.)
    FWRestArea(aArea)
Return aRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZFinBxP
Baixa de titulo a pagar (FINA080). Mesma estrutura de protecao da ZFinBxR.
/*/
//-------------------------------------------------------------------
User Function ZFinBxP(cPrefixo, cNum, cParcela, cTipo, cFornece, cLoja, nValor, dBaixa, cChave)
    Local aArea  := FWGetArea()
    Local aBaixa := {}
    Local cChTit := ""
    Local cTrava := ""
    Local aRet   := {.F., "", .F.}

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    If nValor <= 0 .Or. Empty(cChave) .Or. dBaixa > Date()
        Return {.F., "Valor, chave de idempotencia ou data de baixa invalidos.", .F.}
    EndIf

    cChTit := PadR(cPrefixo, TamSX3("E2_PREFIXO")[1]) + PadR(cNum, TamSX3("E2_NUM")[1]) + ;
              PadR(cParcela, TamSX3("E2_PARCELA")[1]) + PadR(cTipo, TamSX3("E2_TIPO")[1]) + ;
              PadR(cFornece, TamSX3("E2_FORNECE")[1]) + PadR(cLoja, TamSX3("E2_LOJA")[1])
    cTrava := "ZERPFIN_SE2_" + cChTit

    If !LockByName(cTrava, .T., .T.)
        Return {.F., "Titulo em processamento por outra operacao.", .F.}
    EndIf

    DbSelectArea("SE2")
    SE2->(DbSetOrder(1)) // E2_FILIAL + E2_PREFIXO + E2_NUM + E2_PARCELA + E2_TIPO + E2_FORNECE + E2_LOJA
    If U_ZIdemExiste("BAIXA_SE2", cChave)
        aRet := {.T., "Baixa ja registrada anteriormente (nenhuma nova baixa).", .T.}
    ElseIf !SE2->(DbSeek(FWxFilial("SE2") + cChTit))
        aRet := {.F., "Titulo nao encontrado.", .F.}
    ElseIf SE2->E2_SALDO <= 0
        aRet := {.F., "Titulo ja liquidado. Baixa duplicada bloqueada.", .F.}
    ElseIf nValor > SE2->E2_SALDO
        aRet := {.F., "Valor maior que o saldo em aberto.", .F.}
    Else
        aAdd(aBaixa, {"E2_PREFIXO"  , SE2->E2_PREFIXO                    , Nil})
        aAdd(aBaixa, {"E2_NUM"      , SE2->E2_NUM                        , Nil})
        aAdd(aBaixa, {"E2_PARCELA"  , SE2->E2_PARCELA                    , Nil})
        aAdd(aBaixa, {"E2_TIPO"     , SE2->E2_TIPO                       , Nil})
        aAdd(aBaixa, {"E2_FORNECE"  , SE2->E2_FORNECE                    , Nil})
        aAdd(aBaixa, {"E2_LOJA"     , SE2->E2_LOJA                       , Nil})
        aAdd(aBaixa, {"AUTMOTBX"    , SuperGetMV("ZZ_MOTBX", .F., "NOR") , Nil})
        aAdd(aBaixa, {"AUTBANCO"    , SuperGetMV("ZZ_BCOBX", .F., "")    , Nil})
        aAdd(aBaixa, {"AUTAGENCIA"  , SuperGetMV("ZZ_AGEBX", .F., "")    , Nil})
        aAdd(aBaixa, {"AUTCONTA"    , SuperGetMV("ZZ_CTABX", .F., "")    , Nil})
        aAdd(aBaixa, {"AUTDTBAIXA"  , dBaixa                             , Nil})
        aAdd(aBaixa, {"AUTDTDEB"    , dBaixa                             , Nil})
        aAdd(aBaixa, {"AUTHIST"     , "Baixa ERP Enterprise Pro"         , Nil})
        aAdd(aBaixa, {"AUTVLRPG"    , nValor                             , Nil})

        Begin Transaction
            MsExecAuto({|x, y| FINA080(x, y)}, aBaixa, 3)
            If lMsErroAuto
                DisarmTransaction()
                aRet := {.F., U_ZLogExec(), .F.}
            Else
                U_ZIdemGrava("BAIXA_SE2", cChave, "SE2:" + cChTit, "Baixa " + cValToChar(nValor), 0, 0)
                U_ZLogAud("SE2", cChTit, "BAIXA", "Valor " + cValToChar(nValor) + " em " + DtoC(dBaixa))
                aRet := {.T., "Baixa registrada.", .F.}
            EndIf
        End Transaction
    EndIf

    UnLockByName(cTrava, .T., .T.)
    FWRestArea(aArea)
Return aRet
