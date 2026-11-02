/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LanguageClient, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { MdLanguageClient, startClient } from './client/client';
import { activateShared } from './extension.shared';
import { VsCodeOutputLogger } from './logging';
import { IMdParser, MarkdownItEngine } from './markdownEngine';
import { getMarkdownExtensionContributions } from './markdownExtensions';
import { githubSlugifier } from './slugify';

export async function activate(context: vscode.ExtensionContext) {
	const contributions = getMarkdownExtensionContributions(context);
	context.subscriptions.push(contributions);

	const logger = new VsCodeOutputLogger();
	context.subscriptions.push(logger);

	const engine = new MarkdownItEngine(contributions, githubSlugifier, logger);

	// Start server in background without blocking preview command registration
	const clientPromise = startServer(context, engine);
	context.subscriptions.push({
		dispose: () => { void clientPromise.then(c => c.dispose()).catch(() => { }); }
	});

	const lazyClient = createLazyClient(clientPromise);
	activateShared(context, lazyClient, engine, logger, contributions);
}

function createLazyClient(clientPromise: Promise<MdLanguageClient>): MdLanguageClient {
	return {
		resolveLinkTarget: (linkText, uri) => clientPromise.then(c => c.resolveLinkTarget(linkText, uri)),
		getEditForFileRenames: (files, token) => clientPromise.then(c => c.getEditForFileRenames(files, token)),
		getReferencesToFileInWorkspace: (resource, token) => clientPromise.then(c => c.getReferencesToFileInWorkspace(resource, token)),
		prepareUpdatePastedLinks: (doc, ranges, token) => clientPromise.then(c => c.prepareUpdatePastedLinks(doc, ranges, token)),
		getUpdatePastedLinksEdit: (pastingIntoDoc, edits, metadata, token) => clientPromise.then(c => c.getUpdatePastedLinksEdit(pastingIntoDoc, edits, metadata, token)),
		dispose: () => { void clientPromise.then(c => c.dispose()).catch(() => { }); }
	} as MdLanguageClient;
}

function startServer(context: vscode.ExtensionContext, parser: IMdParser): Promise<MdLanguageClient> {
	const isDebugBuild = context.extension.packageJSON.main.includes('/out/');

	const serverModule = context.asAbsolutePath(
		isDebugBuild
			? './node_modules/vscode-markdown-languageserver/dist/node/workerMain'
			: './dist/serverWorkerMain'
	);

	const debugOptions = { execArgv: ['--nolazy', '--inspect=' + (7000 + Math.round(Math.random() * 999))] };

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	process.env['VSCODE_L10N_BUNDLE_LOCATION'] = vscode.l10n.uri?.toString() ?? '';

	return startClient((id, name, clientOptions) => {
		return new LanguageClient(id, name, serverOptions, clientOptions);
	}, parser);
}
