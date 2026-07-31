import { Emitter, Event } from '../../../../dc/core/common/event.js';

export interface IServerSettingsEntry {
	readonly key: string;
	readonly value: any;
	readonly scope: 'user' | 'workspace' | 'default';
	readonly type?: string;
	readonly description?: string;
	readonly defaultValue?: any;
}

export interface IServerSettingsService {
	readonly onDidChangeSetting: Event<{ key: string; value: any; scope: string }>;
	getValue<T>(key: string, scope?: string): T | undefined;
	setValue(key: string, value: any, scope?: string): void;
	hasValue(key: string, scope?: string): boolean;
	removeValue(key: string, scope?: string): void;
	getSettings(scope?: string): IServerSettingsEntry[];
	getDefaultValue<T>(key: string): T | undefined;
	registerDefault(key: string, value: any, description?: string): void;
	resetToDefault(key: string, scope?: string): void;
}

export class ServerSettingsCommon implements IServerSettingsService {
	private readonly _userSettings = new Map<string, any>();
	private readonly _workspaceSettings = new Map<string, any>();
	private readonly _defaults = new Map<string, { value: any; description?: string }>();

	private readonly _onDidChangeSetting = new Emitter<{ key: string; value: any; scope: string }>();
	readonly onDidChangeSetting: Event<{ key: string; value: any; scope: string }> = this._onDidChangeSetting.event;

	getValue<T>(key: string, scope?: string): T | undefined {
		if (scope === 'workspace' && this._workspaceSettings.has(key)) {
			return this._workspaceSettings.get(key) as T;
		}
		if (this._userSettings.has(key)) {
			return this._userSettings.get(key) as T;
		}
		const def = this._defaults.get(key);
		return def ? def.value as T : undefined;
	}

	setValue(key: string, value: any, scope?: string): void {
		const targetScope = scope || 'user';
		if (targetScope === 'workspace') {
			this._workspaceSettings.set(key, value);
		} else {
			this._userSettings.set(key, value);
		}
		this._onDidChangeSetting.fire({ key, value, scope: targetScope });
	}

	hasValue(key: string, scope?: string): boolean {
		if (scope === 'workspace') {
			return this._workspaceSettings.has(key);
		}
		return this._userSettings.has(key) || this._defaults.has(key);
	}

	removeValue(key: string, scope?: string): void {
		if (scope === 'workspace') {
			this._workspaceSettings.delete(key);
		} else {
			this._userSettings.delete(key);
		}
		this._onDidChangeSetting.fire({ key, value: undefined, scope: scope || 'user' });
	}

	getSettings(scope?: string): IServerSettingsEntry[] {
		const result: IServerSettingsEntry[] = [];
		for (const [key, def] of this._defaults) {
			const userVal = this._userSettings.get(key);
			const wsVal = this._workspaceSettings.get(key);
			result.push({
				key,
				value: wsVal ?? userVal ?? def.value,
				scope: wsVal !== undefined ? 'workspace' : userVal !== undefined ? 'user' : 'default',
				description: def.description,
				defaultValue: def.value
			});
		}
		return result;
	}

	getDefaultValue<T>(key: string): T | undefined {
		return this._defaults.get(key)?.value as T | undefined;
	}

	registerDefault(key: string, value: any, description?: string): void {
		this._defaults.set(key, { value, description });
	}

	resetToDefault(key: string, scope?: string): void {
		this.removeValue(key, scope);
	}
}
