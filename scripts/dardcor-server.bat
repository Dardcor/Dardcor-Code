@echo off
setlocal

title Dardcor Server

set ROOT_DIR=%~dp0..

pushd %ROOT_DIR%

:: Configuration
set NODE_ENV=development
set DARDCOR_DEV=1
set VSCODE_DEV=1

:: Get electron, compile, built-in extensions
if "%DARDCOR_SKIP_PRELAUNCH%"=="" if "%VSCODE_SKIP_PRELAUNCH%"=="" (
	node build/lib/preLaunch.ts
)

:: Node executable
FOR /F "tokens=*" %%g IN ('node build/lib/node.ts') do (SET NODE=%%g)

if not exist "%NODE%" (
	:: Download nodejs executable for remote
	call npm run gulp node
)

popd

:: Launch Server
if exist "%ROOT_DIR%\scripts\dardcor-server.js" (
	call "%NODE%" %ROOT_DIR%\scripts\dardcor-server.js %*
) else (
	call "%NODE%" %ROOT_DIR%\scripts\code-server.js %*
)

endlocal
