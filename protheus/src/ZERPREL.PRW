#Include "TOTVS.ch"
#Include "Report.ch"

/*/{Protheus.doc} ZERPREL
Relatorios em TReport com SQL embarcado (BeginSql).

Implementados aqui (padrao que se repete para os demais):
- ZERPREL1: Vendas por periodo (itens de NF de saida - SD2), filtro por periodo e cliente;
- ZERPREL2: Contas a receber vencidas (SE1), filtro por cliente e vencimento.
Os demais relatorios da demonstracao web (pedidos por status, estoque baixo,
movimentacoes, contas a pagar por vencimento) seguem a mesma estrutura, trocando
a query e as celulas - ver matriz em protheus/docs/MATRIZ.md.

Exportacao: o TReport oferece saida em planilha/arquivo pela propria tela de
impressao; nao e preciso gerar CSV manualmente no Protheus.

Perguntas (SX1): grupos ZERPREL1 e ZERPREL2 devem ser criados no dicionario
(ver DICIONARIO.md). Os filtros chegam como MV_PAR01..MV_PARnn e entram na query
apenas via %exp:% (nunca concatenados).

STATUS: NAO COMPILADO.
/*/

User Function ZERPREL1()
    Local oReport := Nil

    Pergunte("ZERPREL1", .F.)
    oReport := ZRel1Def()
    oReport:PrintDialog()
Return Nil

Static Function ZRel1Def()
    Local oReport  := Nil
    Local oSection := Nil

    oReport := TReport():New("ZERPREL1", "Vendas por periodo", "ZERPREL1", {|oRep| ZRel1Prt(oRep)}, ;
        "Itens faturados (SD2) por periodo e cliente. Valores conforme nota fiscal emitida pelo faturamento padrao.")
    oReport:SetLandscape()

    oSection := TRSection():New(oReport, "Vendas", {"SD2", "SA1", "SB1"})
    TRCell():New(oSection, "D2_EMISSAO", "SD2")
    TRCell():New(oSection, "D2_DOC"    , "SD2")
    TRCell():New(oSection, "D2_SERIE"  , "SD2")
    TRCell():New(oSection, "D2_CLIENTE", "SD2")
    TRCell():New(oSection, "D2_LOJA"   , "SD2")
    TRCell():New(oSection, "A1_NOME"   , "SA1")
    TRCell():New(oSection, "D2_COD"    , "SD2")
    TRCell():New(oSection, "B1_DESC"   , "SB1")
    TRCell():New(oSection, "D2_QUANT"  , "SD2")
    TRCell():New(oSection, "D2_PRCVEN" , "SD2")
    TRCell():New(oSection, "D2_TOTAL"  , "SD2")
    TRFunction():New(oSection:Cell("D2_TOTAL"), , "SUM")
Return oReport

Static Function ZRel1Prt(oReport)
    Local oSection := oReport:Section(1)
    Local cAlias   := GetNextAlias()
    Local cDtIni   := DtoS(MV_PAR01)
    Local cDtFim   := DtoS(MV_PAR02)
    Local cCliIni  := MV_PAR03
    Local cCliFim  := MV_PAR04

    oSection:BeginQuery()
    BeginSql Alias cAlias
        SELECT SD2.D2_EMISSAO, SD2.D2_DOC, SD2.D2_SERIE, SD2.D2_CLIENTE, SD2.D2_LOJA, SA1.A1_NOME,
               SD2.D2_COD, SB1.B1_DESC, SD2.D2_QUANT, SD2.D2_PRCVEN, SD2.D2_TOTAL
          FROM %table:SD2% SD2
         INNER JOIN %table:SA1% SA1
            ON SA1.A1_FILIAL = %xFilial:SA1%
           AND SA1.A1_COD    = SD2.D2_CLIENTE
           AND SA1.A1_LOJA   = SD2.D2_LOJA
           AND SA1.%notDel%
         INNER JOIN %table:SB1% SB1
            ON SB1.B1_FILIAL = %xFilial:SB1%
           AND SB1.B1_COD    = SD2.D2_COD
           AND SB1.%notDel%
         WHERE SD2.D2_FILIAL  = %xFilial:SD2%
           AND SD2.D2_EMISSAO BETWEEN %exp:cDtIni% AND %exp:cDtFim%
           AND SD2.D2_CLIENTE BETWEEN %exp:cCliIni% AND %exp:cCliFim%
           AND SD2.D2_TIPO    = 'N'
           AND SD2.%notDel%
         ORDER BY SD2.D2_EMISSAO, SD2.D2_DOC, SD2.D2_ITEM
    EndSql
    oSection:EndQuery()
    oSection:Print()
Return Nil

User Function ZERPREL2()
    Local oReport := Nil

    Pergunte("ZERPREL2", .F.)
    oReport := ZRel2Def()
    oReport:PrintDialog()
Return Nil

Static Function ZRel2Def()
    Local oReport  := Nil
    Local oSection := Nil

    oReport := TReport():New("ZERPREL2", "Contas a receber vencidas", "ZERPREL2", {|oRep| ZRel2Prt(oRep)}, ;
        "Titulos a receber com saldo em aberto e vencimento real anterior a data base.")

    oSection := TRSection():New(oReport, "Titulos", {"SE1", "SA1"})
    TRCell():New(oSection, "E1_PREFIXO", "SE1")
    TRCell():New(oSection, "E1_NUM"    , "SE1")
    TRCell():New(oSection, "E1_PARCELA", "SE1")
    TRCell():New(oSection, "E1_TIPO"   , "SE1")
    TRCell():New(oSection, "E1_CLIENTE", "SE1")
    TRCell():New(oSection, "E1_LOJA"   , "SE1")
    TRCell():New(oSection, "A1_NOME"   , "SA1")
    TRCell():New(oSection, "E1_EMISSAO", "SE1")
    TRCell():New(oSection, "E1_VENCREA", "SE1")
    TRCell():New(oSection, "ATRASO"    , "", "Dias atraso", "@E 99999", 6) // bloco definido em ZRel2Prt (depende do alias da query)
    TRCell():New(oSection, "E1_VALOR"  , "SE1")
    TRCell():New(oSection, "E1_SALDO"  , "SE1")
    TRFunction():New(oSection:Cell("E1_SALDO"), , "SUM")
Return oReport

Static Function ZRel2Prt(oReport)
    Local oSection := oReport:Section(1)
    Local cAlias   := GetNextAlias()
    Local cHoje    := DtoS(dDataBase)
    Local cCliIni  := MV_PAR01
    Local cCliFim  := MV_PAR02

    oSection:BeginQuery()
    BeginSql Alias cAlias
        COLUMN E1_EMISSAO AS DATE
        COLUMN E1_VENCREA AS DATE
        SELECT SE1.E1_PREFIXO, SE1.E1_NUM, SE1.E1_PARCELA, SE1.E1_TIPO, SE1.E1_CLIENTE, SE1.E1_LOJA,
               SA1.A1_NOME, SE1.E1_EMISSAO, SE1.E1_VENCREA, SE1.E1_VALOR, SE1.E1_SALDO
          FROM %table:SE1% SE1
         INNER JOIN %table:SA1% SA1
            ON SA1.A1_FILIAL = %xFilial:SA1%
           AND SA1.A1_COD    = SE1.E1_CLIENTE
           AND SA1.A1_LOJA   = SE1.E1_LOJA
           AND SA1.%notDel%
         WHERE SE1.E1_FILIAL  = %xFilial:SE1%
           AND SE1.E1_SALDO   > 0
           AND SE1.E1_VENCREA < %exp:cHoje%
           AND SE1.E1_CLIENTE BETWEEN %exp:cCliIni% AND %exp:cCliFim%
           AND SE1.%notDel%
         ORDER BY SE1.E1_VENCREA, SE1.E1_NUM
    EndSql
    oSection:EndQuery()
    oSection:Cell("ATRASO"):SetBlock({|| dDataBase - (cAlias)->E1_VENCREA})
    oSection:Print()
Return Nil
