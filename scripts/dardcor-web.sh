#!/usr/bin/env bash

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

function dardcor_web() {
	cd $ROOT

	npm run download-builtin-extensions

	NODE=$(node build/lib/node.ts)
	if [ ! -e $NODE ];then
		npm run gulp node
	fi

	NODE=$(node build/lib/node.ts)

	$NODE ./scripts/dardcor-web.js "$@"
}

dardcor_web "$@"
