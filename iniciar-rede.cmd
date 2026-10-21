@echo off
rem Inicia a demonstracao aceitando acesso de OUTROS computadores da mesma rede local.
rem Use somente em rede de confianca (casa/empresa). As senhas de demonstracao sao publicas.
setlocal
set HOST=0.0.0.0
echo Acesso pela rede: abra http://SEU-IP:3000 no outro computador (veja o IP com o comando ipconfig).
echo Se o Windows perguntar sobre o Firewall, permita somente em "Redes privadas".
call "%~dp0iniciar.cmd" %*
endlocal
