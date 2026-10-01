#!/usr/bin/env bash

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

function dardcor_cli() {
	cd $ROOT

	if [[ "$OSTYPE" == "darwin"* ]]; then
		NAME=`node -p "require('./product.json').nameLong"`
		EXE_NAME=`node -p "require('./product.json').nameShort"`
		CODE="./.build/electron/$NAME.app/Contents/MacOS/$EXE_NAME"
	else
		NAME=`node -p "require('./product.json').applicationName"`
		CODE=".build/electron/$NAME"
	fi

	# Get electron, compile, built-in extensions
	if [[ -z "${DARDCOR_SKIP_PRELAUNCH}" ]] && [[ -z "${VSCODE_SKIP_PRELAUNCH}" ]]; then
		node build/lib/preLaunch.ts
	fi

	# Manage built-in extensions
	if [[ "$1" == "--builtin" ]]; then
		exec "$CODE" build/builtin
		return
	fi

	# Disable test extension
	DISABLE_TEST_EXTENSION="--disable-extension=dardcor.dardcor-api-tests"
	if [[ "$@" == *"--extensionTestsPath"* ]]; then
		DISABLE_TEST_EXTENSION=""
	fi

	ELECTRON_RUN_AS_NODE=1 \
	NODE_ENV=development \
	DARDCOR_DEV=1 \
	VSCODE_DEV=1 \
	DARDCOR_CLI=1 \
	VSCODE_CLI=1 \
	ELECTRON_ENABLE_LOGGING=1 \
	ELECTRON_ENABLE_STACK_DUMPING=1 \
	"$CODE" --inspect=5874 "$ROOT/out/cli.js" . $DISABLE_TEST_EXTENSION "$@"
}

dardcor_cli "$@"
