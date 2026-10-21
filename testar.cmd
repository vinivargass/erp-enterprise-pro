@echo off
rem Executa os testes automatizados da aplicacao web (node:test, sem dependencias).
setlocal
cd /d "%~dp0web"
where node >nul 2>nul
if %errorlevel%==0 (
  node --test --test-reporter=spec tests\erp.test.js tests\admin.test.js tests\publico.test.js
  goto :fim
)
set "VSCODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
if not exist "%VSCODE%" (
  echo Node.js nao encontrado. Instale o Node 22.5+ ou o VS Code.
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=1
"%VSCODE%" --test --test-reporter=spec tests\erp.test.js tests\admin.test.js tests\publico.test.js
:fim
endlocal
