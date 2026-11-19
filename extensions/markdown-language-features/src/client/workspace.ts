/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { isMarkdownFile, looksLikeMarkdownPath } from '../util/file';
import { InMemoryDocument } from './inMemoryDocument';
import { ResourceMap } from '../util/resourceMap';

export class VsCodeMdWorkspace extends Disposable {

	readonly #watcher: vscode.FileSystemWatcher | undefined;

	readonly #documentCache = new ResourceMap<ITextDocument>();

	readonly #utf8Decoder = new TextDecoder('utf-8');

	constructor() {
		super();

		this.#watcher = this._register(vscode.workspace.createFileSystemWatcher('**/*.md'));

		this._register(this.#watcher.onDidChange(async resource => {
			this.#documentCache.delete(resource);
		}));

		this._register(this.#watcher.onDidDelete(resource => {
			this.#documentCache.delete(resource);
		}));

		this._register(vscode.workspace.onDidOpenTextDocument(e => {
			this.#documentCache.delete(e.uri);
		}));

		this._register(vscode.workspace.onDidCloseTextDocument(e => {
			this.#documentCache.delete(e.uri);
		}));
	}

	#isRelevantMarkdownDocument(doc: vscode.TextDocument) {
		return isMarkdownFile(doc) && doc.uri.scheme !== 'vscode-bulkeditpreview';
	}

	public async getOrLoadMarkdownDocument(resource: vscode.Uri): Promise<ITextDocument | undefined> {
		const existing = this.#documentCache.get(resource);
		if (existing) {
			return existing;
		}

		const matchingDocument = vscode.workspace.textDocuments.find((doc) => this.#isRelevantMarkdownDocument(doc) && doc.uri.toString() === resource.toString());
		if (matchingDocument) {
			this.#documentCache.set(resource, matchingDocument);
			return matchingDocument;
		}

		if (!looksLikeMarkdownPath(resource)) {
			return undefined;
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(resource);

			const text = this.#utf8Decoder.decode(bytes);
			const doc = new InMemoryDocument(resource, text, 0);
			this.#documentCache.set(resource, doc);
			return doc;
		} catch {
			return undefined;
		}
	}
}
