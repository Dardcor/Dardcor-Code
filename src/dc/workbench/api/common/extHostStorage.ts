import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostStorage {
	private readonly _globalState = new Map<string, any>();
	private readonly _workspaceState = new Map<string, any>();

	get(key: string, isGlobal: boolean): any | undefined {
		if (isGlobal) {
			return this._globalState.get(key);
		}
		return this._workspaceState.get(key);
	}

	update(key: string, value: any, isGlobal: boolean): Promise<void> {
		if (isGlobal) {
			if (value === undefined) {
				this._globalState.delete(key);
			} else {
				this._globalState.set(key, value);
			}
		} else {
			if (value === undefined) {
				this._workspaceState.delete(key);
			} else {
				this._workspaceState.set(key, value);
			}
		}
		return Promise.resolve();
	}

	keys(isGlobal: boolean): readonly string[] {
		if (isGlobal) {
			return Array.from(this._globalState.keys());
		}
		return Array.from(this._workspaceState.keys());
	}
}
