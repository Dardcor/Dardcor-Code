/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function urlToUri(url: string, base: vscode.Uri): vscode.Uri | undefined {
	try {
		const parsedUrl = new URL(url, base.toString());
		const uri = vscode.Uri.parse(parsedUrl.toString());
		return uri;
	} catch (e) {
		return undefined;
	}
}
