/**
 * Dardcor Code - LSP publishDiagnostics Notification Handler (Task 628)
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { LspClient, ILspMessage } from './lsp-client.js';
import { lspDiagnosticToApiDiagnostic, ILspDiagnostic } from './lsp-converters.js';
import { Diagnostic } from '../api/ext-host-api-impl.js';
import { URI } from '../../core/types/uri.js';

export interface ILspDiagnosticsEvent {
	readonly uri: URI;
	readonly diagnostics: Diagnostic[];
	readonly version: number | undefined;
}

export interface ILspDiagnosticsListenerOptions {
	readonly onDiagnostics?: (event: ILspDiagnosticsEvent) => void;
}

/**
 * Listens for `textDocument/publishDiagnostics` notifications from a
 * language server and forwards them (converted to internal `Diagnostic`
 * objects) to the editor's problem markers.
 */
export class LspDiagnosticsListener extends Disposable {
	private readonly _onDidPublishDiagnostics = this._register(new Emitter<ILspDiagnosticsEvent>());
	readonly onDidPublishDiagnostics: Event<ILspDiagnosticsEvent> = this._onDidPublishDiagnostics.event;

	private readonly _diagnosticsByUri = new Map<string, Diagnostic[]>();

	constructor(
		private readonly _client: LspClient,
		options: ILspDiagnosticsListenerOptions = {}
	) {
		super();
		this._register(this._client.onNotification('textDocument/publishDiagnostics', (params: any) => {
			this._handlePublish(params);
		}));
		if (options.onDiagnostics) {
			this._register(this.onDidPublishDiagnostics(event => options.onDiagnostics!(event)));
		}
	}

	public getDiagnostics(uri: string): Diagnostic[] | undefined {
		const diagnostics = this._diagnosticsByUri.get(uri);
		return diagnostics ? diagnostics.slice() : undefined;
	}

	public getAllDiagnostics(): Array<{ uri: string; diagnostics: Diagnostic[] }> {
		return [...this._diagnosticsByUri.entries()].map(([uri, diagnostics]) => ({ uri, diagnostics: diagnostics.slice() }));
	}

	public clear(): void {
		for (const uri of this._diagnosticsByUri.keys()) {
			this._diagnosticsByUri.set(uri, []);
			this._onDidPublishDiagnostics.fire({ uri: URI.parse(uri), diagnostics: [], version: undefined });
		}
	}

	private _handlePublish(params: any): void {
		if (!params || typeof params.uri !== 'string') {
			return;
		}
		const diagnostics = ((params.diagnostics ?? []) as ILspDiagnostic[]).map(d => lspDiagnosticToApiDiagnostic(d, URI.parse(params.uri)));
		this._diagnosticsByUri.set(params.uri, diagnostics);
		this._onDidPublishDiagnostics.fire({
			uri: URI.parse(params.uri),
			diagnostics,
			version: params.version
		});
	}
}

export interface ILspDiagnosticSyncOptions {
	readonly uri: string;
	readonly text: string;
	readonly languageId: string;
	readonly version: number;
}

/**
 * Keeps the open-document state of a language server in sync and wires
 * the diagnostics listener back into a DiagnosticCollection sink.
 */
export class LspDiagnosticsController extends Disposable {
	private readonly _listener: LspDiagnosticsListener;
	private _opened = new Set<string>();

	constructor(
		private readonly _client: LspClient,
		onDiagnostics?: (event: ILspDiagnosticsEvent) => void
	) {
		super();
		this._listener = new LspDiagnosticsListener(this._client, { onDiagnostics });
		this._register(this._listener);
	}

	public get onDidPublishDiagnostics(): Event<ILspDiagnosticsEvent> {
		return this._listener.onDidPublishDiagnostics;
	}

	public openDocument(options: ILspDiagnosticSyncOptions): void {
		if (this._opened.has(options.uri)) {
			this.updateDocument(options);
			return;
		}
		this._opened.add(options.uri);
		this._client.didOpen(options.uri, options.languageId, options.version, options.text);
	}

	public updateDocument(options: ILspDiagnosticSyncOptions): void {
		if (!this._opened.has(options.uri)) {
			return;
		}
		this._client.didChange(options.uri, options.version, [{ text: options.text }]);
	}

	public closeDocument(uri: string): void {
		if (this._opened.delete(uri)) {
			this._client.didClose(uri);
		}
	}

	public disposeAll(): void {
		for (const uri of this._opened) {
			this._client.didClose(uri);
		}
		this._opened.clear();
	}
}

export function isPublishDiagnosticsMessage(message: ILspMessage): message is ILspMessage & { params: any } {
	return message.method === 'textDocument/publishDiagnostics' && message.id === undefined;
}
