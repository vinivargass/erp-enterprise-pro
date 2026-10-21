#Include "TOTVS.ch"
#Include "FWMVCDef.ch"

/*/{Protheus.doc} ZERPDESC
Cadastro MVC de alcadas de desconto por grupo de produto (tabela customizada ZA3).

POR QUE MVC AQUI: e uma tabela propria (ZA3), sem rotina padrao equivalente, com
regras de validacao de modelo. O MVC separa:
- ModelDef: estrutura e regras (valida em qualquer origem: tela, ExecAuto MVC, API);
- ViewDef : apenas apresentacao;
- MenuDef : operacoes disponiveis (FWMVCMenu gera Visualizar/Incluir/Alterar/Excluir/Copiar).

Consumidores da regra: ZERPPE (MT410TOK) e ZERPPED (U_ZPedApr).

Classe de modelo: MPFormModel (heranca de FWFormModel). E a classe usada para
modelos de dados de rotinas, porque integra o commit padrao em tabelas do
dicionario e os pontos de entrada MVC.

STATUS: NAO COMPILADO.
Dicionario necessario: ZA3 (SX2/SX3/SIX) - ver protheus/dicionario/DICIONARIO.md.
/*/

User Function ZERPDESC()
    Local oBrowse := FWMBrowse():New()

    oBrowse:SetAlias("ZA3")
    oBrowse:SetDescription("Alcadas de desconto por grupo de produto")
    oBrowse:AddLegend("ZA3->ZA3_MSBLQL == '1'", "RED"  , "Bloqueada")
    oBrowse:AddLegend("ZA3->ZA3_MSBLQL != '1'", "GREEN", "Ativa")
    oBrowse:Activate()
Return Nil

Static Function MenuDef()
Return FWMVCMenu("ZERPDESC")

Static Function ModelDef()
    Local oStruZA3 := FWFormStruct(1, "ZA3")
    Local oModel   := Nil

    // ID do modelo diferente do nome da User Function: o framework procura um ponto de
    // entrada MVC com o nome do ID; usar o mesmo nome causaria recursao.
    oModel := MPFormModel():New("ZERPDESCM", /*bPre*/, {|oMdl| ZA3PosVld(oMdl)}, /*bCommit*/, /*bCancel*/)
    oModel:AddFields("ZA3MASTER", /*cOwner*/, oStruZA3)
    oModel:SetPrimaryKey({"ZA3_FILIAL", "ZA3_GRUPO"})
    oModel:SetDescription("Alcadas de desconto")
    oModel:GetModel("ZA3MASTER"):SetDescription("Alcada por grupo")
Return oModel

Static Function ViewDef()
    Local oModel   := FWLoadModel("ZERPDESC")
    Local oStruZA3 := FWFormStruct(2, "ZA3")
    Local oView    := FWFormView():New()

    oView:SetModel(oModel)
    oView:AddField("VIEW_ZA3", oStruZA3, "ZA3MASTER")
    oView:CreateHorizontalBox("TELA", 100)
    oView:SetOwnerView("VIEW_ZA3", "TELA")
Return oView

//-------------------------------------------------------------------
/*/{Protheus.doc} ZA3PosVld
Pos-validacao do modelo (TudoOk). Executa em inclusao/alteracao por tela ou
por rotina automatica MVC, entao a regra vale para todas as origens.
/*/
//-------------------------------------------------------------------
Static Function ZA3PosVld(oModel)
    Local lRet   := .T.
    Local nOper  := oModel:GetOperation()
    Local cGrupo := ""
    Local nMaxV  := 0
    Local nMaxG  := 0

    If nOper == MODEL_OPERATION_INSERT .Or. nOper == MODEL_OPERATION_UPDATE
        cGrupo := oModel:GetValue("ZA3MASTER", "ZA3_GRUPO")
        nMaxV  := oModel:GetValue("ZA3MASTER", "ZA3_DESCMV")
        nMaxG  := oModel:GetValue("ZA3MASTER", "ZA3_DESCMG")

        // Grupo deve existir no cadastro padrao de grupos (SBM, indice 1: BM_FILIAL+BM_GRUPO)
        If !ExistCpo("SBM", cGrupo)
            lRet := .F.
        ElseIf nMaxV < 0 .Or. nMaxG < 0 .Or. nMaxG >= 100
            Help(, , "ZERPDESC", , "Percentuais devem estar entre 0 e 99,99.", 1, 0)
            lRet := .F.
        ElseIf nMaxV > nMaxG
            Help(, , "ZERPDESC", , "A alcada do vendedor nao pode superar a alcada gerencial.", 1, 0, , , , , , ;
                {"Ajuste ZA3_DESCMV para um valor menor ou igual a ZA3_DESCMG."})
            lRet := .F.
        EndIf
    EndIf
Return lRet

//-------------------------------------------------------------------
/*/{Protheus.doc} ZDescMax
Retorna {nAlcadaVendedor, nAlcadaGerente} para o grupo do produto.
Sem regra cadastrada (ou bloqueada), usa os parametros gerais ZZ_DESCMXV/ZZ_DESCMXG.
/*/
//-------------------------------------------------------------------
User Function ZDescMax(cGrupo)
    Local aArea := FWGetArea()
    Local aRet  := {SuperGetMV("ZZ_DESCMXV", .F., 10), SuperGetMV("ZZ_DESCMXG", .F., 25)}

    DbSelectArea("ZA3")
    ZA3->(DbSetOrder(1)) // ZA3_FILIAL + ZA3_GRUPO
    If ZA3->(DbSeek(FWxFilial("ZA3") + PadR(cGrupo, TamSX3("ZA3_GRUPO")[1]))) .And. ZA3->ZA3_MSBLQL != "1"
        aRet := {ZA3->ZA3_DESCMV, ZA3->ZA3_DESCMG}
    EndIf

    FWRestArea(aArea)
Return aRet
