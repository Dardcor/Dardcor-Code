/**
 * Dardcor Code - dc.DiagnosticCollection Message Queue Manager (Task 635)
 * Mirrors: vs/workbench/api/common/extHostDiagnostics.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol.js';
import { URI } from '../../core/types/uri.js';
import { Diagnostic, Range } from './ext-host-api-impl.js';

export function diagnosticFromJSON(json: any): Diagnostic {
	return new Diagnostic(
		new Range(json.range.start.lineNumber, json.range.start.column, json.range.end.lineNumber, json.range.end.column),
		json.message,
		json.severity,
		json.code,
		json.source
	);
}

export interface IDiagnosticChangeEvent {
	readonly uri?: URI;
	readonly diagnostics?: Diagnostic[];
}

/**
 * A named collection of diagnostics per URI, synced to the main side
 * whenever the queue is mutated.
 */
export class DiagnosticCollection implements IDisposable {
	private readonly _data = new Map<string, Diagnostic[]>();
	private _disposed = false;

	constructor(
		public readonly name: string,
		private readonly _onDidChange: (uri: URI | undefined) => void
	) {}

	public get isDisposed(): boolean {
		return this._disposed;
	}

	public set(uri: URI, diagnostics: readonly Diagnostic[] | undefined | null): void {
		if (this._disposed) {
			return;
		}
		if (!diagnostics || diagnostics.length === 0) {
			this.delete(uri);
			return;
		}
		this._data.set(uri.toString(), diagnostics.map(d => d instanceof Diagnostic ? d : new Diagnostic((d as any).range, (d as any).message, (d as any).severity, (d as any).code, (d as any).source)));
		this._onDidChange(uri);
	}

	public delete(uri: URI): void {
		if (this._data.delete(uri.toString())) {
			this._onDidChange(uri);
		}
	}

	public clear(): void {
		for (const uri of this._data.keys()) {
			this._data.delete(uri);
			this._onDidChange(URI.parse(uri));
		}
	}

	public has(uri: URI): boolean {
		return this._data.has(uri.toString());
	}

	public get(uri: URI): Diagnostic[] | undefined {
		const diagnostics = this._data.get(uri.toString());
		return diagnostics ? diagnostics.slice() : undefined;
	}

	public forEach(callback: (uri: URI, diagnostics: readonly Diagnostic[], collection: DiagnosticCollection) => unknown, thisArg?: any): void {
		for (const [uri, diagnostics] of this._data) {
			callback.call(thisArg, URI.parse(uri), diagnostics.slice(), this);
		}
	}

	public toJSON(): Array<{ uri: string; diagnostics: any[] }> {
		return [...this._data.entries()].map(([uri, diagnostics]) => ({
			uri,
			diagnostics: diagnostics.map(d => d.toJSON())
		}));
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._data.clear();
	}
}

export class ExtHostDiagnostics extends Disposable {
	private readonly _collections = new Map<string, DiagnosticCollection>();
	private readonly _onDidChangeDiagnostics = this._register(new Emitter<IDiagnosticChangeEvent>());
	readonly onDidChangeDiagnostics: Event<IDiagnosticChangeEvent> = this._onDidChangeDiagnostics.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public createDiagnosticCollection(name?: string): DiagnosticCollection {
		const collectionName = name ?? `extension#${this._collections.size + 1}`;
		const collection = new DiagnosticCollection(collectionName, uri => {
			this._syncCollection(collection);
			this._onDidChangeDiagnostics.fire({ uri });
		});
		this._collections.set(collectionName, collection);
		return collection;
	}

	public getDiagnosticCollections(): ReadonlyMap<string, DiagnosticCollection> {
		return this._collections;
	}

	public getAllDiagnostics(): Array<{ uri: string; diagnostics: Diagnostic[] }> {
		const result: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
		const byUri = new Map<string, Diagnostic[]>();
		for (const collection of this._collections.values()) {
			for (const entry of collection.toJSON()) {
				let diagnostics = byUri.get(entry.uri);
				if (!diagnostics) {
					diagnostics = [];
					byUri.set(entry.uri, diagnostics);
				}
				for (const d of entry.diagnostics) {
					diagnostics.push(diagnosticFromJSON(d));
				}
			}
		}
		for (const [uri, diagnostics] of byUri) {
			result.push({ uri, diagnostics });
		}
		return result;
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$getAll':
						return this.getAllDiagnostics();
					case '$getForUri':
						return this.getDiagnosticsForUri(payload.uri);
					default:
						throw new Error(`Perintah diagnostics tidak dikenal: ${command}`);
				}
			}
		};
	}

	public getDiagnosticsForUri(uri: string): Diagnostic[] | undefined {
		const result: Diagnostic[] = [];
		for (const collection of this._collections.values()) {
			const diagnostics = collection.get(URI.parse(uri));
			if (diagnostics) {
				result.push(...diagnostics);
			}
		}
		return result.length > 0 ? result : undefined;
	}

	private _syncCollection(collection: DiagnosticCollection): void {
		this._rpc.notify('main', 'diagnostics.update', { name: collection.name, entries: collection.toJSON() });
	}
}
