/**
 * Dardcor Code - Storage Service Interface & Implementation
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export const IStorageService = createDecorator<IStorageService>('storageService');

export enum StorageScope {
	GLOBAL = 0,
	WORKSPACE = 1,
	PROFILE = 2
}

export enum StorageTarget {
	USER = 0,
	MACHINE = 1
}

export interface IStorageChangeEvent {
	readonly key: string;
	readonly scope: StorageScope;
}

export interface IStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeStorage: Event<IStorageChangeEvent>;
	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;
	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope, target: StorageTarget): void;
	remove(key: string, scope: StorageScope): void;
}

export class InMemoryStorageService extends Disposable implements IStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _globalStorage = new Map<string, string>();
	private readonly _workspaceStorage = new Map<string, string>();
	private readonly _onDidChangeStorage = this._register(new Emitter<IStorageChangeEvent>());

	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	public get(key: string, scope: StorageScope, fallbackValue: string): string;
	public get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;
	public get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
		const targetMap = scope === StorageScope.GLOBAL ? this._globalStorage : this._workspaceStorage;
		return targetMap.get(key) ?? fallbackValue;
	}

	public getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean {
		const val = this.get(key, scope);
		return val !== undefined ? val === 'true' : fallbackValue;
	}

	public getNumber(key: string, scope: StorageScope, fallbackValue: number): number {
		const val = this.get(key, scope);
		return val !== undefined ? Number(val) : fallbackValue;
	}

	public store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope, _target: StorageTarget): void {
		if (value === undefined || value === null) {
			this.remove(key, scope);
			return;
		}
		const targetMap = scope === StorageScope.GLOBAL ? this._globalStorage : this._workspaceStorage;
		const strValue = String(value);
		targetMap.set(key, strValue);
		this._onDidChangeStorage.fire({ key, scope });
	}

	public remove(key: string, scope: StorageScope): void {
		const targetMap = scope === StorageScope.GLOBAL ? this._globalStorage : this._workspaceStorage;
		if (targetMap.delete(key)) {
			this._onDidChangeStorage.fire({ key, scope });
		}
	}
}
