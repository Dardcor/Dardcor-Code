/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IByokLmBridgeConnection, IByokLmModelInfo } from '../common/agentHostByokLm.js';

export const IByokLmBridgeRegistry = createDecorator<IByokLmBridgeRegistry>('byokLmBridgeRegistry');

export interface IByokLmBridgeRegistry {
	readonly _serviceBrand: undefined;

	register(clientId: string, connection: IByokLmBridgeConnection): IDisposable;

	getModels(): readonly IByokLmModelInfo[];

	getServingConnection(): IByokLmBridgeConnection | undefined;

	onDidChangeModels(listener: () => void): IDisposable;
}

interface IConnectionEntry {
	readonly connection: IByokLmBridgeConnection;
	models: readonly IByokLmModelInfo[] | undefined;
	readonly store: DisposableStore;
}

export class ByokLmBridgeRegistry implements IByokLmBridgeRegistry {

	declare readonly _serviceBrand: undefined;

	private readonly _entries = new Map<string, IConnectionEntry>();
	private readonly _changeListeners = new Set<() => void>();

	onDidChangeModels(listener: () => void): IDisposable {
		this._changeListeners.add(listener);
		return toDisposable(() => {
			this._changeListeners.delete(listener);
		});
	}

	private _notifyChanged(): void {
		for (const listener of [...this._changeListeners]) {
			listener();
		}
	}

	register(clientId: string, connection: IByokLmBridgeConnection): IDisposable {
		this._entries.get(clientId)?.store.dispose();

		const store = new DisposableStore();
		const entry: IConnectionEntry = { connection, models: undefined, store };
		this._entries.set(clientId, entry);

		store.add(connection.onDidChangeModels(models => {
			if (this._entries.get(clientId) !== entry) {
				return;
			}
			if (entry.models === undefined || !modelsEqual(entry.models, models)) {
				entry.models = models;
				this._notifyChanged();
			}
		}));

		this._notifyChanged();

		return toDisposable(() => {
			if (this._entries.get(clientId) === entry) {
				this._entries.delete(clientId);
				entry.store.dispose();
				this._notifyChanged();
			}
		});
	}

	getModels(): readonly IByokLmModelInfo[] {
		return this._servingEntry()?.models ?? [];
	}

	getServingConnection(): IByokLmBridgeConnection | undefined {
		return this._servingEntry()?.connection;
	}

	private _servingEntry(): IConnectionEntry | undefined {
		let emptyFallback: IConnectionEntry | undefined;
		for (const entry of this._entries.values()) {
			if (entry.models === undefined) {
				continue;
			}
			if (entry.models.length > 0) {
				return entry;
			}
			emptyFallback ??= entry;
		}
		return emptyFallback;
	}
}

function modelsEqual(a: readonly IByokLmModelInfo[], b: readonly IByokLmModelInfo[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return a.every((m, i) => {
		const n = b[i];
		return m.vendor === n.vendor
			&& m.id === n.id
			&& m.name === n.name
			&& m.modelIdentifier === n.modelIdentifier
			&& m.maxContextWindowTokens === n.maxContextWindowTokens
			&& m.supportsVision === n.supportsVision
			&& m.defaultReasoningEffort === n.defaultReasoningEffort
			&& arraysEqual(m.supportedReasoningEfforts, n.supportedReasoningEfforts);
	});
}

function arraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
	return a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => value === b[index]));
}

export class NullByokLmBridgeRegistry implements IByokLmBridgeRegistry {

	declare readonly _serviceBrand: undefined;

	register(): IDisposable {
		return Disposable.None;
	}

	getModels(): readonly IByokLmModelInfo[] {
		return [];
	}

	getServingConnection(): IByokLmBridgeConnection | undefined {
		return undefined;
	}

	onDidChangeModels(): IDisposable {
		return Disposable.None;
	}
}
