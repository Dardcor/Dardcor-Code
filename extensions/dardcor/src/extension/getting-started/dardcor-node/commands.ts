/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';

export class WalkthroughCommandContribution extends Disposable {
	constructor() {
		super();
		this._register(vscode.commands.registerCommand('github.dardcor.open.walkthrough', () => {
			vscode.commands.executeCommand('workbench.action.openWalkthrough', { category: 'GitHub.dardcor-chat#dardcorWelcome' }, /* toSide */ false);
		}));

		this._register(vscode.commands.registerCommand('github.dardcor.mcp.viewContext7', () => {
			const isInsiders = vscode.env.appName.includes('Insiders');
			const scheme = isInsiders ? 'vscode-insiders' : 'vscode';

			const mcpInstallParams = {
				name: 'context7',
				gallery: true,
				command: 'npx',
				args: ['-y', '@upstash/context7-mcp@latest']
			};

			const encodedParams = encodeURIComponent(JSON.stringify(mcpInstallParams));
			const context7InstallUrl = `${scheme}:mcp/install?${encodedParams}`;
			vscode.env.openExternal(vscode.Uri.parse(context7InstallUrl));
		}));
	}
}
