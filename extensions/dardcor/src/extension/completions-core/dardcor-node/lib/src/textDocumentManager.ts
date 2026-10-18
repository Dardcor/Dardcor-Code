/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createServiceIdentifier } from '../../../../../util/common/services';
import { IInstantiationService } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { TextDocumentItem, VersionedTextDocumentIdentifier, WorkspaceFolder } from '../../types/src';
import { ICompletionsFileSystemService } from './fileSystem';
import {
	INotebookDocument,
	IRange,
	ITextDocument,
	TextDocumentIdentifier,
	TextDocumentResult,
	TextDocumentValidation,
} from './textDocument';
import { isDocumentValid } from './util/documentEvaluation';
import { Event } from './util/event';
import { basename, normalizeUri } from './util/uri';

interface TextDocumentContentChangeEvent {
	readonly range: IRange;
	readonly rangeOffset: number;
	readonly rangeLength: number;
	readonly text: string;
}

export interface TextDocumentOpenEvent {
	readonly document: TextDocumentItem;
}

export interface TextDocumentChangeEvent {
	readonly document: VersionedTextDocumentIdentifier;

	readonly contentChanges: readonly TextDocumentContentChangeEvent[];
}

export interface TextDocumentCloseEvent {
	readonly document: TextDocumentIdentifier;
}

export interface TextDocumentFocusedEvent {
	readonly document?: TextDocumentIdentifier;
}

export interface WorkspaceFoldersChangeEvent {
	readonly workspaceFolders: WorkspaceFolder[];
	readonly added: WorkspaceFolder[];
	readonly removed: WorkspaceFolder[];
}

export const ICompletionsTextDocumentManagerService = createServiceIdentifier<ICompletionsTextDocumentManagerService>('ICompletionsTextDocumentManagerService');

export interface ICompletionsTextDocumentManagerService {
	readonly _serviceBrand: undefined;
	onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
	onDidOpenTextDocument: Event<TextDocumentOpenEvent>;
	onDidCloseTextDocument: Event<TextDocumentCloseEvent>;
	onDidFocusTextDocument: Event<TextDocumentFocusedEvent>;
	onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>;

	textDocuments(): Promise<ITextDocument[]>;

	getTextDocumentsUnsafe(): ITextDocument[];

	getTextDocumentUnsafe(docId: TextDocumentIdentifier): ITextDocument | undefined;

	getTextDocument(docId: TextDocumentIdentifier): Promise<ITextDocument | undefined>;

	getTextDocumentValidation(docId: TextDocumentIdentifier): Promise<TextDocumentValidation>;

	getTextDocumentWithValidation(docId: TextDocumentIdentifier): Promise<TextDocumentResult<ITextDocument>>;

	findNotebook(doc: TextDocumentIdentifier): INotebookDocument | undefined;

	getWorkspaceFolders(): WorkspaceFolder[];

	getWorkspaceFolder(doc: TextDocumentIdentifier): WorkspaceFolder | undefined;

	getRelativePath(doc: TextDocumentIdentifier): string | undefined;
}

export abstract class TextDocumentManager implements ICompletionsTextDocumentManagerService {
	declare _serviceBrand: undefined;
	abstract onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
	abstract onDidOpenTextDocument: Event<TextDocumentOpenEvent>;
	abstract onDidCloseTextDocument: Event<TextDocumentCloseEvent>;

	abstract onDidFocusTextDocument: Event<TextDocumentFocusedEvent>;
	abstract onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>;

	abstract getTextDocumentsUnsafe(): ITextDocument[];

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICompletionsFileSystemService private readonly fileSystem: ICompletionsFileSystemService,
	) { }

	async textDocuments(): Promise<ITextDocument[]> {
		const documents = this.getTextDocumentsUnsafe();
		const filteredDocuments: ITextDocument[] = [];
		for (const doc of documents) {
			const result = await this.instantiationService.invokeFunction(isDocumentValid, doc);
			if (result.status === 'valid') {
				filteredDocuments.push(doc);
			}
		}
		return filteredDocuments;
	}

	getTextDocumentUnsafe(docId: TextDocumentIdentifier): ITextDocument | undefined {
		const uri = normalizeUri(docId.uri);
		return this.getTextDocumentsUnsafe().find(t => t.uri === uri);
	}

	async getTextDocument(docId: TextDocumentIdentifier): Promise<ITextDocument | undefined> {
		return this.getTextDocumentWithValidation(docId).then(result => {
			if (result.status === 'valid') {
				return result.document;
			}
			return undefined;
		});
	}

	private async validateTextDocument(docId: TextDocumentIdentifier) {
		return await this.instantiationService.invokeFunction(isDocumentValid, docId);
	}

	async getTextDocumentValidation(docId: TextDocumentIdentifier): Promise<TextDocumentValidation> {
		try {
			return await this.validateTextDocument(docId);
		} catch (err) {
			return this.notFoundResult(docId);
		}
	}

	async getTextDocumentWithValidation(docId: TextDocumentIdentifier): Promise<TextDocumentResult<ITextDocument>> {
		const document = this.getTextDocumentUnsafe(docId);
		if (!document) { return this.notFoundResult(docId); }
		const result = await this.validateTextDocument(docId);
		return result.status === 'valid' ? { status: 'valid', document } : result;
	}

	private notFoundResult({ uri }: TextDocumentIdentifier): { status: 'notfound'; message: string } {
		return {
			status: 'notfound',
			message: `Document for URI could not be found: ${uri}`,
		};
	}

	protected async readTextDocumentFromDisk(uri: string): Promise<string | undefined> {
		try {
			const fileStat = await this.fileSystem.stat(uri);
			if (fileStat.size > 5 * 1024 * 1024) {
				return undefined;
			}
		} catch (e) {
			return undefined;
		}
		return await this.fileSystem.readFileString(uri);
	}

	abstract findNotebook(doc: TextDocumentIdentifier): INotebookDocument | undefined;

	abstract getWorkspaceFolders(): WorkspaceFolder[];

	getWorkspaceFolder(doc: TextDocumentIdentifier) {
		const uri = normalizeUri(doc.uri);
		return this.getWorkspaceFolders().find(f => uri.startsWith(normalizeUri(f.uri)));
	}

	getRelativePath(doc: TextDocumentIdentifier): string | undefined {
		if (doc.uri.startsWith('untitled:')) {
			return undefined;
		}
		const uri = normalizeUri(doc.uri);
		for (const folder of this.getWorkspaceFolders()) {
			const parentURI = normalizeUri(folder.uri)
				.replace(/[#?].*/, '')
				.replace(/\/?$/, '/');
			if (uri.startsWith(parentURI)) {
				return uri.slice(parentURI.length);
			}
		}
		return basename(uri);
	}
}
