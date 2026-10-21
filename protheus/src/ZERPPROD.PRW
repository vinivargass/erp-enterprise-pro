#Include "TOTVS.ch"

/*/{Protheus.doc} ZERPPROD
Produtos - inclusao por rotina automatica e painel de estoque abaixo do minimo.

DECISOES
- SB1 e mantida pela rotina padrao MATA010. Integracoes usam MsExecAuto da MATA010.
- Saldo NAO e campo da SB1: fica na SB2 (por armazem) e so muda por movimentacao
  (SD3/MATA240, notas de entrada/saida, inventario). Por isso o "saldo inicial" do
  cadastro web corresponde, no Protheus, a uma movimentacao de entrada (ZERPEST) ou
  a carga de saldos iniciais (rotina de saldos iniciais do estoque - confirmar a
  rotina adotada pela empresa).
- Painel de estoque baixo usa FWTemporaryTable: a visao agrega SB1 + SB2 de todos os
  armazens e nao existe como tabela; a temporaria permite browse, ordenacao e filtro
  nativos sem criar tabela fisica permanente.

ESTOQUE MINIMO: usamos B1_EMIN. Em muitos releases o titulo desse campo e
"Ponto de Pedido"; o estoque de seguranca e B1_ESTSEG. Defina com a area de
suprimentos qual campo representa o "minimo" na empresa e confirme no SX3.

STATUS: NAO COMPILADO.
/*/

//-------------------------------------------------------------------
/*/{Protheus.doc} ZPrdInc
Inclui produto via MATA010.
@param oDados, JsonObject, {codigo, descricao, tipo, unidade, grupo, armazem, preco_venda, custo, estoque_minimo, ncm}
@return array, {lOk, cMensagem}
/*/
//-------------------------------------------------------------------
User Function ZPrdInc(oDados)
    Local aRet  := {.F., ""}
    Local aSB1  := {}

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .T.

    If oDados["preco_venda"] <= 0
        aRet[2] := "Preco de venda deve ser maior que zero."
        Return aRet
    EndIf
    If oDados["custo"] < 0 .Or. oDados["estoque_minimo"] < 0
        aRet[2] := "Custo e estoque minimo nao podem ser negativos."
        Return aRet
    EndIf

    aAdd(aSB1, {"B1_COD"   , Upper(oDados["codigo"])   , Nil})
    aAdd(aSB1, {"B1_DESC"  , Upper(oDados["descricao"]), Nil})
    aAdd(aSB1, {"B1_TIPO"  , oDados["tipo"]            , Nil}) // PA, ME, MP, MC... (tabela 02 do SX5)
    aAdd(aSB1, {"B1_UM"    , oDados["unidade"]         , Nil}) // deve existir na SAH
    aAdd(aSB1, {"B1_LOCPAD", oDados["armazem"]         , Nil}) // deve existir na NNR
    aAdd(aSB1, {"B1_GRUPO" , oDados["grupo"]           , Nil}) // deve existir na SBM
    aAdd(aSB1, {"B1_PRV1"  , oDados["preco_venda"]     , Nil})
    aAdd(aSB1, {"B1_CUSTD" , oDados["custo"]           , Nil})
    aAdd(aSB1, {"B1_EMIN"  , oDados["estoque_minimo"]  , Nil})
    // NCM: informativo nesta demonstracao. A validade fiscal (TIPI, ex-tarifario,
    // tributacao) deve ser definida pela area fiscal; o campo valida contra a SYD.
    If !Empty(oDados["ncm"])
        aAdd(aSB1, {"B1_POSIPI", oDados["ncm"], Nil})
    EndIf
    aAdd(aSB1, {"B1_MSBLQL", "2", Nil})

    Begin Transaction
        MsExecAuto({|x, y| MATA010(x, y)}, aSB1, 3)
        If lMsErroAuto
            DisarmTransaction()
            aRet[2] := U_ZLogExec()
        Else
            U_ZLogAud("SB1", oDados["codigo"], "INCLUSAO", "Inclusao via integracao")
            aRet := {.T., "Produto incluido."}
        EndIf
    End Transaction
Return aRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZPrdBxa
Painel (browse) de produtos com saldo disponivel abaixo do minimo.
/*/
//-------------------------------------------------------------------
User Function ZPrdBxa()
    Local aArea   := FWGetArea()
    Local oTemp   := Nil
    Local oBrowse := Nil
    Local aCampos := {}
    Local aColunas:= {}
    Local cTmp    := GetNextAlias()
    Local cQry    := GetNextAlias()
    Local nTamCod := TamSX3("B1_COD")[1]
    Local nTamDes := TamSX3("B1_DESC")[1]

    aAdd(aCampos, {"TMP_COD" , "C", nTamCod, 0})
    aAdd(aCampos, {"TMP_DESC", "C", nTamDes, 0})
    aAdd(aCampos, {"TMP_UM"  , "C", 2      , 0})
    aAdd(aCampos, {"TMP_DISP", "N", 14     , 2})
    aAdd(aCampos, {"TMP_MIN" , "N", 14     , 2})
    aAdd(aCampos, {"TMP_NEC" , "N", 14     , 2})

    oTemp := FWTemporaryTable():New(cTmp)
    oTemp:SetFields(aCampos)
    oTemp:AddIndex("01", {"TMP_COD"})
    oTemp:Create()

    // Disponivel = soma de todos os armazens. Parametros via %exp%/%xFilial%, sem concatenacao.
    BeginSql Alias cQry
        SELECT SB1.B1_COD, SB1.B1_DESC, SB1.B1_UM, SB1.B1_EMIN,
               COALESCE(SUM(SB2.B2_QATU - SB2.B2_RESERVA - SB2.B2_QEMP), 0) DISPONIVEL
          FROM %table:SB1% SB1
          LEFT JOIN %table:SB2% SB2
            ON SB2.B2_FILIAL = %xFilial:SB2%
           AND SB2.B2_COD    = SB1.B1_COD
           AND SB2.%notDel%
         WHERE SB1.B1_FILIAL = %xFilial:SB1%
           AND SB1.B1_MSBLQL <> '1'
           AND SB1.B1_EMIN   > 0
           AND SB1.%notDel%
         GROUP BY SB1.B1_COD, SB1.B1_DESC, SB1.B1_UM, SB1.B1_EMIN
        HAVING COALESCE(SUM(SB2.B2_QATU - SB2.B2_RESERVA - SB2.B2_QEMP), 0) < SB1.B1_EMIN
    EndSql

    While !(cQry)->(Eof())
        If RecLock(cTmp, .T.)
            (cTmp)->TMP_COD  := (cQry)->B1_COD
            (cTmp)->TMP_DESC := (cQry)->B1_DESC
            (cTmp)->TMP_UM   := (cQry)->B1_UM
            (cTmp)->TMP_DISP := (cQry)->DISPONIVEL
            (cTmp)->TMP_MIN  := (cQry)->B1_EMIN
            (cTmp)->TMP_NEC  := (cQry)->B1_EMIN - (cQry)->DISPONIVEL
            (cTmp)->(MsUnlock())
        EndIf
        (cQry)->(DbSkip())
    EndDo
    (cQry)->(DbCloseArea())

    // Colunas do browse sobre a temporaria. Confirmar no TDN os metodos de
    // FWBrwColumn disponiveis no release (SetData/SetTitle/SetSize/SetDecimal/SetPicture).
    aAdd(aColunas, ZCol("Codigo"     , {|| (cTmp)->TMP_COD }, nTamCod, 0, "@!"))
    aAdd(aColunas, ZCol("Descricao"  , {|| (cTmp)->TMP_DESC}, nTamDes, 0, "@!"))
    aAdd(aColunas, ZCol("UM"         , {|| (cTmp)->TMP_UM  }, 2      , 0, "@!"))
    aAdd(aColunas, ZCol("Disponivel" , {|| (cTmp)->TMP_DISP}, 14     , 2, "@E 999,999,999.99"))
    aAdd(aColunas, ZCol("Minimo"     , {|| (cTmp)->TMP_MIN }, 14     , 2, "@E 999,999,999.99"))
    aAdd(aColunas, ZCol("Necessidade", {|| (cTmp)->TMP_NEC }, 14     , 2, "@E 999,999,999.99"))

    oBrowse := FWMBrowse():New()
    oBrowse:SetAlias(cTmp)
    oBrowse:SetTemporary(.T.)
    oBrowse:SetColumns(aColunas)
    oBrowse:SetDescription("Produtos abaixo do estoque minimo")
    oBrowse:SetMenuDef("ZERPPROD") // MenuDef abaixo: somente consulta
    oBrowse:DisableDetails()
    oBrowse:Activate()

    // Sempre remover a temporaria ao sair (evita tabelas orfas no banco).
    oTemp:Delete()
    FWRestArea(aArea)
Return Nil

Static Function MenuDef()
    Local aRotina := {}

    aAdd(aRotina, {"Pesquisar", "PesqBrw", 0, 1})
Return aRotina

Static Function ZCol(cTitulo, bDado, nTam, nDec, cPict)
    Local oCol := FWBrwColumn():New()

    oCol:SetTitle(cTitulo)
    oCol:SetData(bDado)
    oCol:SetSize(nTam)
    oCol:SetDecimal(nDec)
    oCol:SetPicture(cPict)
Return oCol
