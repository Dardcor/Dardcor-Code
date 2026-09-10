@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

if "%VSCODE_SKIP_PRELAUNCH%"=="" (
	node build/lib/preLaunch.ts || (
		echo Failed to prepare VS Code for launch ^(build/lib/preLaunch.ts^). 1>&2
		exit /b 1
	)
)

if not exist "out\main.js" (
	echo [Dardcor Code] out\main.js not found. Transpiling client...
	call npm run transpile-client || (
		echo Failed to transpile client. 1>&2
		exit /b 1
	)
)

set "NAMESHORT="
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do if not defined NAMESHORT set "NAMESHORT=%%~a"
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

if "%~1"=="--builtin" goto builtin

set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set DARDCOR_PORT=25128
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

%CODE% . %DISABLE_TEST_EXTENSION% %*
goto end

:builtin
%CODE% build/builtin

:end

popd

endlocal
