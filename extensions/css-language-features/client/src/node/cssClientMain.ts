/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext, extensions, l10n } from 'vscode';
import { BaseLanguageClient, LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { LanguageClientConstructor, startClient } from '../cssClient';
import { getNodeFSRequestService } from './nodeFs';
import { registerDropOrPasteResourceSupport } from '../dropOrPaste/dropOrPasteResource';

let client: BaseLanguageClient | undefined;

export async function activate(context: ExtensionContext) {
	const clientMain = extensions.getExtension('vscode.css-language-features')?.packageJSON?.main || '';

	const serverMain = `./server/${clientMain.indexOf('/dist/') !== -1 ? 'dist' : 'out'}/node/cssServerMain`;
	const serverModule = context.asAbsolutePath(serverMain);

	const debugOptions = { execArgv: ['--nolazy', '--inspect=' + (7000 + Math.round(Math.random() * 999))] };

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	const newLanguageClient: LanguageClientConstructor = (id: string, name: string, clientOptions: LanguageClientOptions) => {
		return new LanguageClient(id, name, serverOptions, clientOptions);
	};

	process.env['VSCODE_L10N_BUNDLE_LOCATION'] = l10n.uri?.toString() ?? '';

	client = await startClient(context, newLanguageClient, { fs: getNodeFSRequestService(), TextDecoder });

	context.subscriptions.push(registerDropOrPasteResourceSupport({ language: 'css', scheme: '*' }));
}

export async function deactivate(): Promise<void> {
	if (client) {
		await client.stop();
		client = undefined;
	}
}

