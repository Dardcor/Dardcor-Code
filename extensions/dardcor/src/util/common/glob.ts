/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import picomatch from 'picomatch';
import type vscode from 'vscode';
import * as path from '../dardcor/base/common/path';
import { isWindows } from '../dardcor/base/common/platform';
import { URI } from '../dardcor/base/common/uri';

export function isMatch(uri: URI, glob: vscode.GlobPattern): boolean {
	if (typeof glob === 'string') {
		return picomatch.isMatch(uri.fsPath, glob, { dot: true, windows: isWindows });
	} else {
		if (uri.fsPath === glob.baseUri.fsPath && glob.pattern === '*') {
			return true;
		}

		const relativePath = path.relative(glob.baseUri.fsPath, uri.fsPath);
		if (!relativePath.startsWith('..')) {
			return picomatch.isMatch(relativePath, glob.pattern, { dot: true, windows: isWindows });
		}

		return picomatch.isMatch(uri.fsPath, glob.pattern, { dot: true, windows: isWindows });
	}
}

export interface GlobIncludeOptions {
	readonly include?: readonly vscode.GlobPattern[];

	readonly exclude?: readonly vscode.GlobPattern[];
}

export function shouldInclude(uri: URI, options: GlobIncludeOptions | undefined): boolean {
	if (!options) {
		return true;
	}

	if (options.exclude?.some(x => isMatch(uri, x))) {
		return false;
	}

	if (options.include) {
		return options.include.some(x => isMatch(uri, x));
	}

	return true;
}

export function combineGlob(glob1: string | vscode.RelativePattern, glob2: string | vscode.RelativePattern): string {
	let stringGlob1 = typeof glob1 === 'string' ? glob1 : glob1.baseUri.toString() + glob1.pattern;
	let stringGlob2 = typeof glob2 === 'string' ? glob2 : glob2.baseUri.toString() + glob2.pattern;
	stringGlob1 = stringGlob1.replace(/\{.*\}/g, '');
	stringGlob2 = stringGlob2.replace(/\{.*\}/g, '');
	return `{${stringGlob1},${stringGlob2}}`;
}
