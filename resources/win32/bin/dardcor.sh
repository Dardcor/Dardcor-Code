#!/usr/bin/env sh
#
# Copyright (c) Dardcor Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
if [ "$DARDCOR_WSL_DEBUG_INFO" = true ] || [ "$VSCODE_WSL_DEBUG_INFO" = true ]; then
	set -x
fi

COMMIT="@@COMMIT@@"
APP_NAME="@@APPNAME@@"
QUALITY="@@QUALITY@@"
NAME="@@NAME@@"
SERVERDATAFOLDER="@@SERVERDATAFOLDER@@"
DARDCOR_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
ELECTRON="$DARDCOR_PATH/$NAME.exe"

IN_WSL=false
if [ -n "$WSL_DISTRO_NAME" ]; then
	IN_WSL=true
else
	WSL_BUILD=$(uname -r | sed -E 's/^[0-9.]+-([0-9]+)-Microsoft.*|.*/\1/')
	if [ -n "$WSL_BUILD" ]; then
		if [ "$WSL_BUILD" -ge 17063 ]; then
			IN_WSL=true
		else
			"$ELECTRON" "$@"
			exit $?
		fi
	fi
fi
if [ $IN_WSL = true ]; then

	export WSLENV="ELECTRON_RUN_AS_NODE/w:$WSLENV"
	CLI=$(wslpath -m "$DARDCOR_PATH/resources/app/out/cli.js")

	# use the Remote WSL extension if installed
	WSL_EXT_ID="ms-vscode-remote.remote-wsl"

	ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" --locate-extension $WSL_EXT_ID >/tmp/remote-wsl-loc.txt 2>/dev/null </dev/null
	WSL_EXT_WLOC=$(cat /tmp/remote-wsl-loc.txt)

	if [ -n "$WSL_EXT_WLOC" ]; then
		WSL_CODE=$(wslpath -u "${WSL_EXT_WLOC%%[[:cntrl:]]}")/scripts/wslCode.sh
		"$WSL_CODE" "$COMMIT" "$QUALITY" "$ELECTRON" "$APP_NAME" "$SERVERDATAFOLDER" "$@"
		exit $?
	fi

elif [ -x "$(command -v cygpath)" ]; then
	CLI=$(cygpath -m "$DARDCOR_PATH/resources/app/out/cli.js")
else
	CLI="$DARDCOR_PATH/resources/app/out/cli.js"
fi
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
