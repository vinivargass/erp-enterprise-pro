#Include "TOTVS.ch"
#Include "RestFul.ch"

/*/{Protheus.doc} ZERPAPI
Servico REST de clientes do ERP Enterprise Pro (WSRESTFUL, ADVPL classico).

CAMADAS (separadas de proposito)
1) Autenticacao  -> NAO e feita neste fonte. E do AppServer: secao [HTTPREST] com
                    SECURITY=1 exige usuario Protheus (Basic Auth) e, nos releases
                    que suportam, token OAuth2. O usuario autenticado vira o
                    __cUserId da thread, e as permissoes de menu/rotina valem.
                    Nenhuma credencial fica no fonte. Ver protheus/docs/INTEGRACAO.md.
2) Validacao     -> ZValCorpo(): formato, tipos, tamanhos, obrigatorios (sem acesso a banco).
3) Negocio       -> ZERPCLI (U_ZCliInc) + ZERPVAL: duplicidade, regras, MsExecAuto.
4) Resposta HTTP -> ZResp()/SetRestFault(): status e JSON padronizados
                    {"erro": {"codigo": "...", "mensagem": "..."}}.

ENDPOINTS
GET  /zerpclientes?search=&page=&pageSize=   lista paginada (max 100 por pagina)
GET  /zerpclientes/{codigo}/{loja}           consulta um cliente
POST /zerpclientes                           inclui cliente

STATUS: NAO COMPILADO E NAO TESTADO CONTRA APPSERVER.
Confirmar no TDN do release: sintaxe de WSMETHOD com nome + PATH (disponivel em
builds recentes do REST ADVPL), ::SetStatus e o comportamento de SetRestFault.
Alternativa moderna: REST em TL++ com anotacoes (@Get/@Post) e oRest.
/*/

WSRESTFUL ZERPCLIENTES DESCRIPTION "ERP Enterprise Pro - Clientes" FORMAT APPLICATION_JSON
    WSDATA search   AS STRING  OPTIONAL
    WSDATA page     AS INTEGER OPTIONAL
    WSDATA pageSize AS INTEGER OPTIONAL

    WSMETHOD GET  LISTA  DESCRIPTION "Lista clientes"      WSSYNTAX "/zerpclientes"                PATH "/zerpclientes"                PRODUCES APPLICATION_JSON
    WSMETHOD GET  UM     DESCRIPTION "Consulta um cliente" WSSYNTAX "/zerpclientes/{codigo}/{loja}" PATH "/zerpclientes/{codigo}/{loja}" PRODUCES APPLICATION_JSON
    WSMETHOD POST INCLUI DESCRIPTION "Inclui cliente"      WSSYNTAX "/zerpclientes"                PATH "/zerpclientes"                PRODUCES APPLICATION_JSON
END WSRESTFUL

//-------------------------------------------------------------------
WSMETHOD GET LISTA WSRECEIVE search, page, pageSize WSSERVICE ZERPCLIENTES
    Local cAlias  := GetNextAlias()
    Local oResp   := JsonObject():New()
    Local aItens  := {}
    Local oItem   := Nil
    Local nPage   := IIf(ValType(::page) == "N" .And. ::page > 0, ::page, 1)
    Local nSize   := IIf(ValType(::pageSize) == "N" .And. ::pageSize > 0, Min(::pageSize, 100), 20)
    Local cBusca  := IIf(ValType(::search) == "C", ZLimpaBusca(::search), "")
    Local cLike   := "%" + Upper(cBusca) + "%"
    Local nPular  := (nPage - 1) * nSize
    Local nTotal  := 0

    // cLike entra como literal escapado pelo %exp:%; caracteres curinga do usuario foram removidos.
    BeginSql Alias cAlias
        SELECT SA1.A1_COD, SA1.A1_LOJA, SA1.A1_NOME, SA1.A1_NREDUZ, SA1.A1_CGC, SA1.A1_MUN, SA1.A1_EST, SA1.A1_MSBLQL
          FROM %table:SA1% SA1
         WHERE SA1.A1_FILIAL = %xFilial:SA1%
           AND (SA1.A1_NOME LIKE %exp:cLike% OR SA1.A1_COD LIKE %exp:cLike% OR SA1.A1_CGC LIKE %exp:cLike%)
           AND SA1.%notDel%
         ORDER BY SA1.A1_COD, SA1.A1_LOJA
    EndSql

    // Paginacao por salto de registros: portavel entre bancos suportados pelo DBAccess.
    // Para volumes grandes, substituir por paginacao no SQL do banco homologado.
    While !(cAlias)->(Eof())
        nTotal++
        If nTotal > nPular .And. Len(aItens) < nSize
            oItem := JsonObject():New()
            oItem["codigo"]       := AllTrim((cAlias)->A1_COD)
            oItem["loja"]         := AllTrim((cAlias)->A1_LOJA)
            oItem["razao_social"] := AllTrim((cAlias)->A1_NOME)
            oItem["nome_fantasia"]:= AllTrim((cAlias)->A1_NREDUZ)
            oItem["documento"]    := AllTrim((cAlias)->A1_CGC)
            oItem["municipio"]    := AllTrim((cAlias)->A1_MUN)
            oItem["uf"]           := (cAlias)->A1_EST
            oItem["ativo"]        := (cAlias)->A1_MSBLQL != "1"
            aAdd(aItens, oItem)
        EndIf
        (cAlias)->(DbSkip())
    EndDo
    (cAlias)->(DbCloseArea())

    oResp["itens"]  := aItens
    oResp["total"]  := nTotal
    oResp["pagina"] := nPage
    oResp["tamanho"]:= nSize
Return ZResp(Self, 200, oResp)

//-------------------------------------------------------------------
WSMETHOD GET UM WSSERVICE ZERPCLIENTES
    Local aArea := FWGetArea()
    Local oResp := Nil
    Local cCod  := ""
    Local cLoja := ""
    Local lRet  := .T.

    If Len(::aURLParms) < 2
        Return ZErro(400, "REQUISICAO_INVALIDA", "Informe codigo e loja.")
    EndIf
    cCod  := PadR(::aURLParms[1], TamSX3("A1_COD")[1])
    cLoja := PadR(::aURLParms[2], TamSX3("A1_LOJA")[1])

    SA1->(DbSetOrder(1)) // A1_FILIAL + A1_COD + A1_LOJA
    If SA1->(DbSeek(FWxFilial("SA1") + cCod + cLoja))
        oResp := JsonObject():New()
        oResp["codigo"]         := AllTrim(SA1->A1_COD)
        oResp["loja"]           := AllTrim(SA1->A1_LOJA)
        oResp["razao_social"]   := AllTrim(SA1->A1_NOME)
        oResp["nome_fantasia"]  := AllTrim(SA1->A1_NREDUZ)
        oResp["tipo_pessoa"]    := SA1->A1_PESSOA
        oResp["documento"]      := AllTrim(SA1->A1_CGC)
        oResp["municipio"]      := AllTrim(SA1->A1_MUN)
        oResp["uf"]             := SA1->A1_EST
        oResp["cond_pagto"]     := SA1->A1_COND
        oResp["limite_credito"] := SA1->A1_LC
        oResp["credito_utilizado"] := U_ZCredUso(SA1->A1_COD, SA1->A1_LOJA)
        oResp["ativo"]          := SA1->A1_MSBLQL != "1"
        lRet := ZResp(Self, 200, oResp)
    Else
        lRet := ZErro(404, "NAO_ENCONTRADO", "Cliente nao encontrado.")
    EndIf

    FWRestArea(aArea)
Return lRet

//-------------------------------------------------------------------
WSMETHOD POST INCLUI WSSERVICE ZERPCLIENTES
    Local cBody  := ::GetContent()
    Local oBody  := JsonObject():New()
    Local xErr   := Nil
    Local cValid := ""
    Local aRes   := {}
    Local oResp  := Nil

    If Len(cBody) > 102400
        Return ZErro(413, "CORPO_GRANDE", "Requisicao maior que o permitido.")
    EndIf

    // FromJson retorna Nil em caso de sucesso ou texto com o erro de parse.
    xErr := oBody:FromJson(cBody)
    If ValType(xErr) == "C"
        Return ZErro(400, "JSON_INVALIDO", "Corpo JSON malformado.")
    EndIf

    cValid := ZValCorpo(oBody)
    If !Empty(cValid)
        Return ZErro(422, "VALIDACAO", cValid)
    EndIf

    aRes := U_ZCliInc(oBody)
    If aRes[1]
        oResp := JsonObject():New()
        oResp["codigo"] := aRes[3]
        oResp["loja"]   := aRes[4]
        Return ZResp(Self, 201, oResp)
    EndIf
    If Left(aRes[2], 10) == "DUPLICADO:"
        Return ZErro(409, "CONFLITO", SubStr(aRes[2], 12))
    EndIf
Return ZErro(422, "REGRA_NEGOCIO", aRes[2])

//-------------------------------------------------------------------
// Validacao de formato do corpo (camada 2). Normaliza ausentes para "" / 0, para
// que a camada de negocio receba sempre o mesmo formato.
//-------------------------------------------------------------------
Static Function ZValCorpo(oBody)
    Local aTexto := {{"razao_social", 3, 40, .T.}, {"nome_fantasia", 1, 20, .T.}, {"tipo_pessoa", 1, 1, .T.}, ;
                     {"documento", 11, 18, .T.}, {"inscricao_estadual", 0, 18, .F.}, {"cep", 8, 9, .T.}, ;
                     {"logradouro", 1, 60, .T.}, {"numero", 1, 10, .T.}, {"bairro", 1, 40, .T.}, ;
                     {"municipio", 1, 60, .T.}, {"cod_municipio", 5, 5, .T.}, {"uf", 2, 2, .T.}, ;
                     {"telefone", 0, 15, .F.}, {"email", 0, 100, .F.}, {"cond_pagto", 3, 3, .T.}}
    Local nI     := 0
    Local cCampo := ""
    Local xVal   := Nil

    // Tamanhos maximos acima sao ilustrativos: o ideal e ler do dicionario (TamSX3).
    For nI := 1 To Len(aTexto)
        cCampo := aTexto[nI][1]
        xVal   := oBody[cCampo]
        If xVal == Nil
            xVal := ""
        EndIf
        If ValType(xVal) != "C"
            Return "Campo " + cCampo + " deve ser texto."
        EndIf
        xVal := AllTrim(xVal)
        If aTexto[nI][4] .And. Empty(xVal)
            Return "Campo " + cCampo + " e obrigatorio."
        EndIf
        If Len(xVal) > aTexto[nI][3] .Or. (!Empty(xVal) .And. Len(xVal) < aTexto[nI][2])
            Return "Campo " + cCampo + " com tamanho invalido."
        EndIf
        oBody[cCampo] := xVal
    Next nI

    If !(oBody["tipo_pessoa"] $ "FJ")
        Return "tipo_pessoa deve ser F ou J."
    EndIf
    If oBody["limite_credito"] == Nil
        oBody["limite_credito"] := 0
    EndIf
    If ValType(oBody["limite_credito"]) != "N" .Or. oBody["limite_credito"] < 0
        Return "limite_credito deve ser numero maior ou igual a zero."
    EndIf
    If !Empty(oBody["email"]) .And. (At("@", oBody["email"]) < 2 .Or. At(".", oBody["email"]) == 0)
        Return "E-mail invalido."
    EndIf
Return ""

// Remove curingas e aspas da busca do usuario (o %exp% ja escapa; isto evita LIKE abrangente).
Static Function ZLimpaBusca(cTexto)
    Local cRet := AllTrim(cTexto)

    cRet := StrTran(cRet, "%", "")
    cRet := StrTran(cRet, "_", "")
    cRet := StrTran(cRet, "'", "")
Return Left(cRet, 40)

Static Function ZResp(oSelf, nStatus, oJson)
    oSelf:SetContentType("application/json")
    oSelf:SetStatus(nStatus)
    oSelf:SetResponse(EncodeUTF8(oJson:ToJson()))
Return .T.

// Erro padronizado. SetRestFault devolve o status HTTP e a mensagem ao cliente.
// Nunca devolver pilha de erro, SQL ou dados internos na mensagem.
Static Function ZErro(nStatus, cCodigo, cMensagem)
    Local oErr := JsonObject():New()

    oErr["erro"] := JsonObject():New()
    oErr["erro"]["codigo"]   := cCodigo
    oErr["erro"]["mensagem"] := cMensagem
    SetRestFault(nStatus, EncodeUTF8(oErr:ToJson()))
Return .F.
