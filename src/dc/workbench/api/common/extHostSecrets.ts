import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostSecrets {
	private readonly _secrets = new Map<string, string>();

	private readonly _onDidChange = new Emitter<any>();
	readonly onDidChange = this._onDidChange.event;

	get(key: string): Promise<string | undefined> {
		return Promise.resolve(this._secrets.get(key));
	}

	store(key: string, value: string): Promise<void> {
		this._secrets.set(key, value);
		this._onDidChange.fire({ key });
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		if (this._secrets.has(key)) {
			this._secrets.delete(key);
			this._onDidChange.fire({ key });
		}
		return Promise.resolve();
	}
}
