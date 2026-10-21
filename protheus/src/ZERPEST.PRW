#Include "TOTVS.ch"

/*/{Protheus.doc} ZERPEST
Movimentacoes internas de estoque com rastreabilidade e protecao contra duplicidade.

PADRAO PROTHEUS USADO
- Movimento interno: SD3 gravado pela rotina padrao MATA240 (MsExecAuto). A rotina
  atualiza SB2 (saldo), custo medio, kardex e contabilizacao conforme configuracao.
  Nunca alterar B2_QATU diretamente.
- Tipo de movimento (D3_TM): cadastro SF5. Convencao padrao: codigos ate 500 sao
  entradas (devolucoes) e acima de 500 saidas (requisicoes); o campo F5_TIPO
  ("D" devolucao / "R" requisicao) e a fonte de verdade - confirmar no ambiente.
- Saldo negativo: a rotina padrao respeita o parametro MV_ESTNEG. A verificacao
  abaixo antecipa o erro com mensagem clara, mas a regra final e a do padrao.

RASTREABILIDADE (o que a demonstracao web grava em movimentos_estoque):
- SD3: produto, quantidade, armazem, TM, documento, data, usuario (padrao);
- ZA2: motivo, saldo anterior e posterior, usuario, data/hora, chave de idempotencia.
  ZA2 e gravada na MESMA transacao do MsExecAuto.
- Movimentacoes nao sao alteradas: correcao = estorno pela rotina padrao (que gera
  novo registro/estorno rastreavel), nunca UPDATE em SD3.

LIMITE DA TRANSACAO
Atomico: SD3 + SB2 (pela MATA240) + ZA2 + ZA1. Fora da transacao: o LockByName
(que serializa a mesma chave entre threads) e qualquer mensagem de interface.

STATUS: NAO COMPILADO.
/*/

//-------------------------------------------------------------------
/*/{Protheus.doc} ZEstMov
@param cProd   , character, codigo do produto
@param cLocal  , character, armazem
@param nQtd    , numeric  , quantidade (> 0)
@param cTM     , character, tipo de movimento (SF5)
@param cDoc    , character, documento de referencia
@param cMotivo , character, motivo (obrigatorio, minimo 5 caracteres)
@param cChave  , character, chave de idempotencia informada pelo chamador
@return array, {lOk, cMensagem, lDuplicada}
/*/
//-------------------------------------------------------------------
User Function ZEstMov(cProd, cLocal, nQtd, cTM, cDoc, cMotivo, cChave)
    Local aArea   := FWGetArea()
    Local aVetor  := {}
    Local cTipoTM := ""
    Local cTrava  := "ZERPEST_" + AllTrim(cChave)
    Local nSldAnt := 0
    Local nSldPos := 0
    Local aRet    := {.F., "", .F.}

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    // ---------- validacoes de entrada ----------
    If nQtd <= 0
        Return {.F., "Quantidade deve ser maior que zero.", .F.}
    EndIf
    If Len(AllTrim(cMotivo)) < 5
        Return {.F., "Informe o motivo da movimentacao.", .F.}
    EndIf
    If Empty(cChave)
        Return {.F., "Chave de idempotencia obrigatoria.", .F.}
    EndIf
    cTipoTM := Posicione("SF5", 1, FWxFilial("SF5") + cTM, "F5_TIPO") // indice 1: F5_FILIAL+F5_CODIGO
    If Empty(cTipoTM)
        Return {.F., "Tipo de movimento " + cTM + " nao cadastrado (SF5).", .F.}
    EndIf

    // ---------- serializa a mesma chave entre threads/servidores ----------
    // LockByName(cNome, lEmpresa, lFilial): trava logica por nome no License/Lock Server.
    If !LockByName(cTrava, .T., .T.)
        Return {.F., "Operacao com a mesma chave em processamento. Tente novamente.", .F.}
    EndIf

    If U_ZIdemExiste("ESTOQUE", cChave)
        aRet := {.T., "Movimentacao ja registrada anteriormente (nenhuma nova baixa).", .T.}
    Else
        nSldAnt := ZSaldoAtu(cProd, cLocal)
        If cTipoTM == "R" .And. nQtd > U_ZSaldoDisp(cProd, cLocal) .And. !SuperGetMV("ZZ_ESTNEG", .F., .F.)
            aRet := {.F., "Saldo disponivel insuficiente.", .F.}
        Else
            aAdd(aVetor, {"D3_TM"     , cTM      , Nil})
            aAdd(aVetor, {"D3_COD"    , cProd    , Nil})
            aAdd(aVetor, {"D3_QUANT"  , nQtd     , Nil})
            aAdd(aVetor, {"D3_LOCAL"  , cLocal   , Nil})
            aAdd(aVetor, {"D3_DOC"    , cDoc     , Nil})
            aAdd(aVetor, {"D3_EMISSAO", dDataBase, Nil})

            Begin Transaction
                MsExecAuto({|x, y| MATA240(x, y)}, aVetor, 3)
                If lMsErroAuto
                    DisarmTransaction()
                    aRet := {.F., U_ZLogExec(), .F.}
                Else
                    nSldPos := ZSaldoAtu(cProd, cLocal)
                    U_ZIdemGrava("ESTOQUE", cChave, "SD3:" + cValToChar(SD3->(Recno())), cMotivo, nSldAnt, nSldPos)
                    U_ZLogAud("SD3", AllTrim(cProd) + "/" + cLocal, IIf(cTipoTM == "R", "SAIDA", "ENTRADA"), ;
                        "Qtd " + cValToChar(nQtd) + " | saldo " + cValToChar(nSldAnt) + " -> " + cValToChar(nSldPos) + " | " + cMotivo)
                    aRet := {.T., "Movimentacao registrada.", .F.}
                EndIf
            End Transaction
        EndIf
    EndIf

    UnLockByName(cTrava, .T., .T.)
    FWRestArea(aArea)
Return aRet

Static Function ZSaldoAtu(cProd, cLocal)
    Local aArea := FWGetArea()
    Local nSld  := 0

    SB2->(DbSetOrder(1)) // B2_FILIAL + B2_COD + B2_LOCAL
    If SB2->(DbSeek(FWxFilial("SB2") + PadR(cProd, TamSX3("B2_COD")[1]) + PadR(cLocal, TamSX3("B2_LOCAL")[1])))
        nSld := SB2->B2_QATU
    EndIf

    FWRestArea(aArea)
Return nSld
