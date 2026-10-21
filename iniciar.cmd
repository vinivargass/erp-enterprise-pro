@echo off
rem Inicia a demonstracao web do ERP Enterprise Pro.
rem Usa o Node instalado no PATH; se nao houver, usa o Node embutido no VS Code.
rem Parametro opcional: --reset  (apaga o banco de demonstracao e recria os dados ficticios)
setlocal
cd /d "%~dp0web"
where node >nul 2>nul
if %errorlevel%==0 (
  node server\index.js %*
  goto :fim
)
set "VSCODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
if not exist "%VSCODE%" (
  echo Node.js nao encontrado. Instale o Node 22.5+ ou o VS Code.
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=1
"%VSCODE%" server\index.js %*
:fim
endlocal
