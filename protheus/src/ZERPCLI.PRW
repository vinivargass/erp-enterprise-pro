#Include "TOTVS.ch"
#Include "FWMVCDef.ch"

/*/{Protheus.doc} ZERPCLI
Clientes - consulta gerencial e servicos de manutencao da SA1.

DECISAO DE ARQUITETURA
A SA1 e tabela padrao com rotina oficial de manutencao (CRMA980 nos releases
recentes; MATA030 em releases anteriores). Este fonte NAO reimplementa o cadastro:
- a tela de inclusao/alteracao continua sendo a rotina padrao (com suas validacoes,
  gatilhos, integracoes fiscais e pontos de entrada);
- integracoes (API REST, cargas) incluem/alteram clientes via MsExecAuto da rotina
  padrao (U_ZCliInc / U_ZCliAtv), nunca com RecLock direto na SA1;
- o browse abaixo e uma visao gerencial (status, credito, historico) com acoes
  que tambem passam pela rotina padrao.

Por que FWMBrowse sem MVC proprio: nao ha modelo de dados proprio a manter aqui;
o modelo e o da rotina padrao. Criar ModelDef/ViewDef sobre a SA1 duplicaria
regras e conflitaria com o CRMA980.

STATUS: NAO COMPILADO. Confirmar no TDN, para o release do ambiente:
- se a rotina vigente e CRMA980 ou MATA030 e a assinatura do ExecAuto
  (ver constante ZCLI_ROTINA abaixo);
- campos obrigatorios do SA1 no dicionario do cliente (podem existir campos
  obrigatorios adicionais por customizacao ou localizacao).
/*/

// Troque para .F. se o ambiente ainda usar a MATA030 para ExecAuto de clientes.
#Define ZCLI_USA_CRMA980 .T.

User Function ZERPCLI()
    Local oBrowse := FWMBrowse():New()

    oBrowse:SetAlias("SA1")
    oBrowse:SetDescription("ERP Enterprise Pro - Clientes (visao gerencial)")
    oBrowse:SetMenuDef("ZERPCLI")
    // A1_MSBLQL: "1" = bloqueado (inativo); "2" ou vazio = ativo
    oBrowse:AddLegend("SA1->A1_MSBLQL == '1'", "RED"  , "Inativo")
    oBrowse:AddLegend("SA1->A1_MSBLQL != '1'", "GREEN", "Ativo")
    oBrowse:Activate()
Return Nil

Static Function MenuDef()
    Local aRotina := {}

    // Formato classico {Titulo, Rotina, Reservado, nOpc}; FWMBrowse aceita este formato.
    aAdd(aRotina, {"Pesquisar"          , "PesqBrw"   , 0, 1})
    aAdd(aRotina, {"Visualizar"         , "AxVisual"  , 0, 2})
    aAdd(aRotina, {"Posicao de credito" , "U_ZCliCrd" , 0, 2})
    aAdd(aRotina, {"Historico"          , "U_ZCliHis" , 0, 2})
    aAdd(aRotina, {"Inativar"           , "U_ZCliIna" , 0, 4})
    aAdd(aRotina, {"Reativar"           , "U_ZCliRea" , 0, 4})
Return aRotina

//-------------------------------------------------------------------
/*/{Protheus.doc} ZCliInc
Inclui cliente pela rotina padrao (MsExecAuto). Usada pela API (ZERPAPI).

@param oDados, JsonObject, dados ja validados quanto a formato (ver ZERPAPI)
@return array, {lOk, cMensagem, cCodigo, cLoja}
/*/
//-------------------------------------------------------------------
User Function ZCliInc(oDados)
    Local aRet     := {.F., "", "", ""}
    Local aSA1     := {}
    Local cDoc     := U_ZSoDig(oDados["documento"])
    Local cPessoa  := oDados["tipo_pessoa"]
    Local cCod     := ""
    Local cLoja    := "01"

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    // 1) Regras proprias, antes da rotina padrao (falha rapida, mensagem clara para a API)
    If !U_ZVldDoc(cPessoa, cDoc)
        aRet[2] := "CPF/CNPJ invalido."
        Return aRet
    EndIf
    If U_ZCliDup(cDoc, "", "")
        aRet[2] := "DUPLICADO: ja existe cliente com este CPF/CNPJ."
        Return aRet
    EndIf

    // 2) Codigo: numeracao controlada pelo sistema (SXE/SXF). O padrao pode usar
    //    inicializador proprio no A1_COD; nesse caso omita A1_COD do vetor.
    cCod := GetSxeNum("SA1", "A1_COD")

    aAdd(aSA1, {"A1_COD"    , cCod                               , Nil})
    aAdd(aSA1, {"A1_LOJA"   , cLoja                              , Nil})
    aAdd(aSA1, {"A1_PESSOA" , cPessoa                            , Nil})
    aAdd(aSA1, {"A1_NOME"   , Upper(oDados["razao_social"])      , Nil})
    aAdd(aSA1, {"A1_NREDUZ" , Upper(oDados["nome_fantasia"])     , Nil})
    aAdd(aSA1, {"A1_TIPO"   , "F"                                , Nil}) // F = consumidor final; R/S/X conforme regra FISCAL (validar)
    aAdd(aSA1, {"A1_CGC"    , cDoc                               , Nil})
    aAdd(aSA1, {"A1_INSCR"  , Upper(oDados["inscricao_estadual"]), Nil})
    aAdd(aSA1, {"A1_CEP"    , U_ZSoDig(oDados["cep"])            , Nil})
    aAdd(aSA1, {"A1_END"    , Upper(oDados["logradouro"]) + ", " + oDados["numero"], Nil})
    aAdd(aSA1, {"A1_BAIRRO" , Upper(oDados["bairro"])            , Nil})
    aAdd(aSA1, {"A1_EST"    , Upper(oDados["uf"])                , Nil})
    aAdd(aSA1, {"A1_COD_MUN", oDados["cod_municipio"]            , Nil}) // codigo IBGE (5 digitos, sem UF); obrigatorio para NF-e
    aAdd(aSA1, {"A1_MUN"    , Upper(oDados["municipio"])         , Nil})
    aAdd(aSA1, {"A1_TEL"    , U_ZSoDig(oDados["telefone"])       , Nil})
    aAdd(aSA1, {"A1_EMAIL"  , Lower(oDados["email"])             , Nil})
    aAdd(aSA1, {"A1_COND"   , oDados["cond_pagto"]               , Nil})
    aAdd(aSA1, {"A1_LC"     , oDados["limite_credito"]           , Nil})
    aAdd(aSA1, {"A1_MSBLQL" , "2"                                , Nil})

    Begin Transaction
        If ZCLI_USA_CRMA980
            // Assinatura documentada para CRMA980: (aSA1Auto, nOpcAuto, aAI0Auto). Confirmar no TDN.
            MsExecAuto({|a, b, c| CRMA980(a, b, c)}, aSA1, 3, {})
        Else
            MsExecAuto({|a, b| MATA030(a, b)}, aSA1, 3)
        EndIf

        If lMsErroAuto
            DisarmTransaction()
            aRet[2] := U_ZLogExec()
        Else
            U_ZLogAud("SA1", cCod + cLoja, "INCLUSAO", "Inclusao via API ZERPCLIENTES. Doc: " + cDoc)
            aRet := {.T., "Cliente incluido.", cCod, cLoja}
        EndIf
    End Transaction

    // Numeracao: confirma somente se gravou; caso contrario devolve o numero ao SXE.
    If aRet[1]
        ConfirmSX8()
    Else
        RollBackSX8()
    EndIf
Return aRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZCliIna / ZCliRea
Inativa/reativa o cliente posicionado (A1_MSBLQL), com confirmacao e auditoria.
Exclusao fisica nao e oferecida: o cliente e referenciado por pedidos, notas e titulos.
/*/
//-------------------------------------------------------------------
User Function ZCliIna(cAlias, nReg, nOpc)
Return ZCliAtv(nReg, .F.)

User Function ZCliRea(cAlias, nReg, nOpc)
Return ZCliAtv(nReg, .T.)

Static Function ZCliAtv(nReg, lAtivar)
    Local aArea := FWGetArea()
    Local aSA1  := {}
    Local lBloq := .F.

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    SA1->(DbGoTo(nReg))
    lBloq := SA1->A1_MSBLQL == "1"
    // Reativar exige cliente bloqueado; inativar exige cliente ativo.
    If (lAtivar .And. lBloq) .Or. (!lAtivar .And. !lBloq)
        If !MsgYesNo(IIf(lAtivar, "Reativar", "Inativar") + " o cliente " + AllTrim(SA1->A1_COD) + "/" + SA1->A1_LOJA + ;
                     " - " + AllTrim(SA1->A1_NOME) + "?", "Confirmacao")
            FWRestArea(aArea)
            Return Nil
        EndIf

        aAdd(aSA1, {"A1_COD"   , SA1->A1_COD                , Nil})
        aAdd(aSA1, {"A1_LOJA"  , SA1->A1_LOJA               , Nil})
        aAdd(aSA1, {"A1_MSBLQL", IIf(lAtivar, "2", "1")     , Nil})

        Begin Transaction
            If ZCLI_USA_CRMA980
                MsExecAuto({|a, b, c| CRMA980(a, b, c)}, aSA1, 4, {})
            Else
                MsExecAuto({|a, b| MATA030(a, b)}, aSA1, 4)
            EndIf
            If lMsErroAuto
                DisarmTransaction()
            Else
                U_ZLogAud("SA1", SA1->A1_COD + SA1->A1_LOJA, IIf(lAtivar, "REATIVACAO", "INATIVACAO"), ;
                    "A1_MSBLQL: " + IIf(lAtivar, "1 -> 2", "2 -> 1"))
            EndIf
        End Transaction

        // Mensagens de tela sempre FORA da transacao (nao segurar locks esperando o usuario).
        If lMsErroAuto
            MostraErro()
        Else
            FWAlertSuccess("Cliente " + IIf(lAtivar, "reativado", "inativado") + ".", "ZERPCLI")
        EndIf
    Else
        FWAlertWarning("O cliente ja esta " + IIf(lAtivar, "ativo", "inativo") + ".", "ZERPCLI")
    EndIf

    FWRestArea(aArea)
Return Nil

//-------------------------------------------------------------------
/*/{Protheus.doc} ZCliCrd
Mostra a posicao de credito do cliente posicionado.
/*/
//-------------------------------------------------------------------
User Function ZCliCrd(cAlias, nReg, nOpc)
    Local aArea := FWGetArea()
    Local nUso  := 0
    Local cMsg  := ""

    SA1->(DbGoTo(nReg))
    nUso := U_ZCredUso(SA1->A1_COD, SA1->A1_LOJA)
    cMsg := "Limite de credito: "   + Transform(SA1->A1_LC, "@E 999,999,999.99") + CRLF + ;
            "Comprometido: "        + Transform(nUso, "@E 999,999,999.99") + CRLF + ;
            "Disponivel: "          + Transform(SA1->A1_LC - nUso, "@E 999,999,999.99")
    FWAlertInfo(cMsg, "Credito - " + AllTrim(SA1->A1_NOME))

    FWRestArea(aArea)
Return Nil

//-------------------------------------------------------------------
/*/{Protheus.doc} ZCliHis
Lista o historico de auditoria (ZA1) do cliente posicionado.
/*/
//-------------------------------------------------------------------
User Function ZCliHis(cAlias, nReg, nOpc)
    Local aArea  := FWGetArea()
    Local cTmp   := GetNextAlias()
    Local cChave := ""
    Local cTexto := ""

    SA1->(DbGoTo(nReg))
    cChave := SA1->A1_COD + SA1->A1_LOJA

    BeginSql Alias cTmp
        SELECT ZA1.ZA1_DATA, ZA1.ZA1_HORA, ZA1.ZA1_OPER, ZA1.ZA1_NOMUSR
          FROM %table:ZA1% ZA1
         WHERE ZA1.ZA1_FILIAL = %xFilial:ZA1%
           AND ZA1.ZA1_TABELA = 'SA1'
           AND ZA1.ZA1_CHAVE  = %exp:cChave%
           AND ZA1.%notDel%
         ORDER BY ZA1.ZA1_DATA DESC, ZA1.ZA1_HORA DESC
    EndSql
    TcSetField(cTmp, "ZA1_DATA", "D", 8, 0)

    While !(cTmp)->(Eof())
        cTexto += DtoC((cTmp)->ZA1_DATA) + " " + (cTmp)->ZA1_HORA + " - " + AllTrim((cTmp)->ZA1_OPER) + ;
                  " - " + AllTrim((cTmp)->ZA1_NOMUSR) + CRLF
        (cTmp)->(DbSkip())
    EndDo
    (cTmp)->(DbCloseArea())

    FWAlertInfo(IIf(Empty(cTexto), "Sem historico registrado.", cTexto), "Historico - " + AllTrim(SA1->A1_NOME))
    FWRestArea(aArea)
Return Nil
