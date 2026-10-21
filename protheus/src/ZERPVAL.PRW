#Include "TOTVS.ch"

/*/{Protheus.doc} ZERPVAL
Validacoes e utilitarios compartilhados do ERP Enterprise Pro.

Responsabilidade: regras reutilizadas por ZERPCLI, ZERPPED, ZERPEST, ZERPFIN e ZERPAPI.
Nenhuma funcao deste fonte grava em tabela padrao. As unicas gravacoes sao em
tabelas customizadas ZA1 (auditoria) e ZA2 (idempotencia).

STATUS: NAO COMPILADO. Escrito para Protheus 12.1.2x (LIB/TL++ recentes).
Validar no ambiente de desenvolvimento antes de qualquer uso (ver protheus/docs/TESTES_PROTHEUS.md).

Dependencias de dicionario: ZA1, ZA2 (SX2/SX3/SIX) e parametros ZZ_* (SX6).
Ver protheus/dicionario/DICIONARIO.md.

@type  Function
@since 2026-10-20
/*/

//-------------------------------------------------------------------
/*/{Protheus.doc} ZVldDoc
Valida CPF (cTipo = "F") ou CNPJ (cTipo = "J") pelos digitos verificadores.
Pode ser usada no X3_VLDUSER do campo A1_CGC:  U_ZVldDoc(M->A1_PESSOA, M->A1_CGC)

Observacao: o padrao ja oferece a funcao CGC() para essa validacao, usada no
dicionario do A1_CGC. Esta versao existe para uso fora do dicionario (API, cargas)
e para nao depender de comportamento de interface. Confirmar no TDN se CGC() atende
o seu cenario antes de duplicar a regra.

@param cTipo, character, "F" fisica ou "J" juridica
@param cDoc , character, documento com ou sem mascara
@return logical, .T. se valido
/*/
//-------------------------------------------------------------------
User Function ZVldDoc(cTipo, cDoc)
    Local lRet := .F.
    Local cNum := U_ZSoDig(cDoc)

    If cTipo == "F"
        lRet := ZCpfOk(cNum)
    ElseIf cTipo == "J"
        lRet := ZCnpjOk(cNum)
    EndIf
Return lRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZSoDig
Retorna somente os digitos de um texto (remove mascara de CPF/CNPJ/CEP).
/*/
//-------------------------------------------------------------------
User Function ZSoDig(cTexto)
    Local cRet := ""
    Local nI   := 0
    Local cCar := ""

    cTexto := IIf(ValType(cTexto) == "C", cTexto, "")
    For nI := 1 To Len(cTexto)
        cCar := SubStr(cTexto, nI, 1)
        If IsDigit(cCar)
            cRet += cCar
        EndIf
    Next nI
Return cRet

Static Function ZCpfOk(cCpf)
    Local lRet  := .T.
    Local nT    := 0
    Local nI    := 0
    Local nSoma := 0
    Local nDv   := 0

    If Len(cCpf) != 11 .Or. cCpf == Replicate(Left(cCpf, 1), 11)
        lRet := .F.
    Else
        // nT = quantidade de digitos usados no calculo (9 para o 1o DV, 10 para o 2o)
        For nT := 9 To 10
            nSoma := 0
            For nI := 1 To nT
                nSoma += Val(SubStr(cCpf, nI, 1)) * (nT + 2 - nI)
            Next nI
            nDv := Mod(nSoma * 10, 11)
            If nDv == 10
                nDv := 0
            EndIf
            If nDv != Val(SubStr(cCpf, nT + 1, 1))
                lRet := .F.
                Exit
            EndIf
        Next nT
    EndIf
Return lRet

Static Function ZCnpjOk(cCnpj)
    Local lRet   := .F.
    Local aPeso1 := {5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2}
    Local aPeso2 := {6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2}

    If Len(cCnpj) == 14 .And. cCnpj != Replicate(Left(cCnpj, 1), 14)
        lRet := ZDvCnpj(cCnpj, aPeso1) == Val(SubStr(cCnpj, 13, 1)) .And. ;
                ZDvCnpj(cCnpj, aPeso2) == Val(SubStr(cCnpj, 14, 1))
    EndIf
Return lRet

Static Function ZDvCnpj(cBase, aPeso)
    Local nSoma  := 0
    Local nI     := 0
    Local nResto := 0

    For nI := 1 To Len(aPeso)
        nSoma += Val(SubStr(cBase, nI, 1)) * aPeso[nI]
    Next nI
    nResto := Mod(nSoma, 11)
Return IIf(nResto < 2, 0, 11 - nResto)

//-------------------------------------------------------------------
/*/{Protheus.doc} ZCliDup
Verifica se ja existe outro cliente com o mesmo CPF/CNPJ na filial corrente.
Uso sugerido: X3_VLDUSER do A1_CGC -> U_ZVldDoc(M->A1_PESSOA, M->A1_CGC) .And. !U_ZCliDup(M->A1_CGC, M->A1_COD, M->A1_LOJA)

ATENCAO (confirmar no ambiente):
- O indice 3 da SA1 costuma ser A1_FILIAL+A1_CGC. Confirme no SIX antes de usar;
  por isso a busca e feita por NickName quando existir, com fallback por SQL.
- O padrao pode ja alertar duplicidade conforme parametros do cadastro de clientes.
  Verifique o comportamento do seu release para nao duplicar a mensagem.

@return logical, .T. se EXISTE duplicidade (outro codigo/loja com o mesmo documento)
/*/
//-------------------------------------------------------------------
User Function ZCliDup(cCgc, cCod, cLoja)
    Local lDup   := .F.
    Local cAlias := GetNextAlias()
    Local cDoc   := PadR(U_ZSoDig(cCgc), TamSX3("A1_CGC")[1])

    If !Empty(cDoc)
        // SQL embarcado: %exp:% gera o literal com escape; nao ha concatenacao de entrada do usuario.
        BeginSql Alias cAlias
            SELECT COUNT(*) QTD
              FROM %table:SA1% SA1
             WHERE SA1.A1_FILIAL = %xFilial:SA1%
               AND SA1.A1_CGC    = %exp:cDoc%
               AND NOT (SA1.A1_COD = %exp:cCod% AND SA1.A1_LOJA = %exp:cLoja%)
               AND SA1.%notDel%
        EndSql
        lDup := (cAlias)->QTD > 0
        (cAlias)->(DbCloseArea())
    EndIf

    If lDup
        Help(, , "ZCLIDUP", , "Ja existe cliente cadastrado com este CPF/CNPJ nesta filial.", 1, 0, , , , , , ;
            {"Consulte o cadastro existente ou verifique o documento informado."})
    EndIf
Return lDup

//-------------------------------------------------------------------
/*/{Protheus.doc} ZSaldoDisp
Saldo disponivel de um produto num armazem: B2_QATU - B2_RESERVA - B2_QEMP.

Alternativa padrao: a funcao SaldoSB2() calcula o disponivel considerando
parametros do modulo de estoque (ex.: empenhos, MV_ESTNEG). Sua assinatura e
comportamento variam por release; CONFIRMAR NO TDN antes de trocar este calculo.

@return numeric, saldo disponivel (0 se nao houver SB2 para o produto/armazem)
/*/
//-------------------------------------------------------------------
User Function ZSaldoDisp(cProd, cLocal)
    Local aArea := FWGetArea()
    Local nDisp := 0

    DbSelectArea("SB2")
    SB2->(DbSetOrder(1)) // B2_FILIAL + B2_COD + B2_LOCAL
    If SB2->(DbSeek(FWxFilial("SB2") + PadR(cProd, TamSX3("B2_COD")[1]) + PadR(cLocal, TamSX3("B2_LOCAL")[1])))
        nDisp := SB2->B2_QATU - SB2->B2_RESERVA - SB2->B2_QEMP
    EndIf

    FWRestArea(aArea)
Return nDisp

//-------------------------------------------------------------------
/*/{Protheus.doc} ZCredUso
Credito comprometido do cliente: saldo de titulos a receber em aberto (SE1) +
saldo de pedidos ainda nao entregues (SC6).

LIMITACOES (validar com o financeiro):
- Tipos de abatimento/credito (RA, NCC, AB-, ...) reduzem ou nao o saldo conforme
  a politica da empresa e parametros como MVABATIM / MV_CRNEG. Aqui RA e NCC sao
  desconsiderados de forma simplificada.
- O padrao mantem acumuladores na SA1 (ex.: A1_SALDUP, A1_SALPEDL) usados pela
  analise de credito nativa. Se a empresa usa a analise de credito padrao
  (liberacao de pedidos), PREFIRA a regra nativa em vez desta.

@return numeric, valor comprometido em moeda 1
/*/
//-------------------------------------------------------------------
User Function ZCredUso(cCli, cLoja)
    Local cAlias := GetNextAlias()
    Local nUso   := 0

    BeginSql Alias cAlias
        SELECT COALESCE(SUM(SE1.E1_SALDO), 0) VALOR
          FROM %table:SE1% SE1
         WHERE SE1.E1_FILIAL  = %xFilial:SE1%
           AND SE1.E1_CLIENTE = %exp:cCli%
           AND SE1.E1_LOJA    = %exp:cLoja%
           AND SE1.E1_SALDO   > 0
           AND SE1.E1_TIPO NOT IN ('RA ', 'NCC')
           AND SE1.%notDel%
    EndSql
    nUso += (cAlias)->VALOR
    (cAlias)->(DbCloseArea())

    cAlias := GetNextAlias()
    BeginSql Alias cAlias
        SELECT COALESCE(SUM((SC6.C6_QTDVEN - SC6.C6_QTDENT) * SC6.C6_PRCVEN), 0) VALOR
          FROM %table:SC6% SC6
         WHERE SC6.C6_FILIAL = %xFilial:SC6%
           AND SC6.C6_CLI    = %exp:cCli%
           AND SC6.C6_LOJA   = %exp:cLoja%
           AND SC6.C6_QTDVEN > SC6.C6_QTDENT
           AND SC6.C6_BLQ   <> 'R'
           AND SC6.%notDel%
    EndSql
    nUso += (cAlias)->VALOR
    (cAlias)->(DbCloseArea())
Return nUso

//-------------------------------------------------------------------
/*/{Protheus.doc} ZIdemExiste
Controle de idempotencia (ZA2): informa se uma operacao (origem + chave) ja foi
processada com sucesso. Usado para impedir baixa/movimentacao duplicada quando
a mesma requisicao chega duas vezes (reenvio de integracao, duplo clique, job repetido).

Deve ser chamada DENTRO de LockByName com a mesma chave (ver ZERPEST/ZERPFIN),
para que duas threads nao passem pela verificacao ao mesmo tempo.
/*/
//-------------------------------------------------------------------
User Function ZIdemExiste(cOrigem, cChave)
    Local aArea := FWGetArea()
    Local lRet  := .F.

    DbSelectArea("ZA2")
    ZA2->(DbSetOrder(1)) // ZA2_FILIAL + ZA2_ORIGEM + ZA2_CHAVE
    lRet := ZA2->(DbSeek(FWxFilial("ZA2") + PadR(cOrigem, TamSX3("ZA2_ORIGEM")[1]) + PadR(cChave, TamSX3("ZA2_CHAVE")[1])))

    FWRestArea(aArea)
Return lRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZIdemGrava
Registra a operacao como processada. Chamar dentro da MESMA transacao da operacao
de negocio: se a transacao for desfeita (DisarmTransaction), o registro tambem e.
/*/
//-------------------------------------------------------------------
User Function ZIdemGrava(cOrigem, cChave, cRecurso, cMotivo, nSldAnt, nSldPos)
    Local aArea := FWGetArea()

    DbSelectArea("ZA2")
    If RecLock("ZA2", .T.)
        ZA2->ZA2_FILIAL := FWxFilial("ZA2")
        ZA2->ZA2_ORIGEM := cOrigem
        ZA2->ZA2_CHAVE  := cChave
        ZA2->ZA2_RECURS := cRecurso
        ZA2->ZA2_MOTIVO := cMotivo
        ZA2->ZA2_SLDANT := nSldAnt
        ZA2->ZA2_SLDPOS := nSldPos
        ZA2->ZA2_USER   := RetCodUsr()
        ZA2->ZA2_DATA   := Date()
        ZA2->ZA2_HORA   := Time()
        ZA2->(MsUnlock())
    EndIf

    FWRestArea(aArea)
Return Nil

//-------------------------------------------------------------------
/*/{Protheus.doc} ZLogAud
Grava um registro de auditoria em ZA1 (historico de alteracoes de negocio).

Antes de adotar ZA1, avalie os recursos nativos de auditoria do seu release
(ex.: log de alteracoes/Embedded Audit Trail configurado no SIGACFG). Nomes e
disponibilidade variam por versao; confirmar na documentacao oficial.
/*/
//-------------------------------------------------------------------
User Function ZLogAud(cTabela, cChave, cOper, cDetalhe)
    Local aArea := FWGetArea()

    DbSelectArea("ZA1")
    If RecLock("ZA1", .T.)
        ZA1->ZA1_FILIAL := FWxFilial("ZA1")
        ZA1->ZA1_TABELA := cTabela
        ZA1->ZA1_CHAVE  := cChave
        ZA1->ZA1_OPER   := cOper
        ZA1->ZA1_DETALH := cDetalhe
        ZA1->ZA1_USER   := RetCodUsr()
        ZA1->ZA1_NOMUSR := cUserName
        ZA1->ZA1_DATA   := Date()
        ZA1->ZA1_HORA   := Time()
        ZA1->(MsUnlock())
    EndIf

    FWRestArea(aArea)
Return Nil

//-------------------------------------------------------------------
/*/{Protheus.doc} ZLogExec
Converte o log de erro de um MsExecAuto em texto, sem exibir tela.
Requer que o chamador tenha declarado:  Private lAutoErrNoFile := .T.
/*/
//-------------------------------------------------------------------
User Function ZLogExec()
    Local aLog := GetAutoGRLog()
    Local cRet := ""
    Local nI   := 0

    For nI := 1 To Len(aLog)
        cRet += AllTrim(aLog[nI]) + CRLF
    Next nI
Return IIf(Empty(cRet), "Falha na rotina automatica sem mensagem de log.", cRet)
