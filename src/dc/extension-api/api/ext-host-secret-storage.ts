import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface ISecretStorageChangeEvent {
	readonly key: string;
}

export interface ISecretStorage {
	get(key: string): Promise<string | undefined>;
	store(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	readonly onDidChange: Event<ISecretStorageChangeEvent>;
}

export interface ISecretStorageSink {
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

let secretStorageSink: ISecretStorageSink | undefined;

export function setSecretStorageSink(sink: ISecretStorageSink | undefined): void {
	secretStorageSink = sink;
}

export function getSecretStorageSink(): ISecretStorageSink | undefined {
	return secretStorageSink;
}

export class ExtHostSecretStorage extends Disposable {
	private readonly _secrets = new Map<string, string>();

	private readonly _onDidChange = this._register(new Emitter<ISecretStorageChangeEvent>());
	readonly onDidChange: Event<ISecretStorageChangeEvent> = this._onDidChange.event;

	public async get(key: string): Promise<string | undefined> {
		const local = this._secrets.get(key);
		if (local !== undefined) {
			return local;
		}
		const remote = await secretStorageSink?.get(key);
		if (remote !== undefined) {
			this._secrets.set(key, remote);
		}
		return remote;
	}

	public async store(key: string, value: string): Promise<void> {
		this._secrets.set(key, value);
		await secretStorageSink?.set(key, value);
	}

	public async delete(key: string): Promise<void> {
		const existed = this._secrets.delete(key);
		await secretStorageSink?.delete(key);
		if (existed) {
			this._onDidChange.fire({ key });
		}
	}

	public async clear(): Promise<void> {
		const keys = [...this._secrets.keys()];
		this._secrets.clear();
		for (const key of keys) {
			await secretStorageSink?.delete(key);
			this._onDidChange.fire({ key });
		}
	}

	public getStoredKeys(): string[] {
		return [...this._secrets.keys()];
	}

	public has(key: string): boolean {
		return this._secrets.has(key);
	}

	public getSecretStorage(): ISecretStorage {
		return {
			get: (key: string) => this.get(key),
			store: (key: string, value: string) => this.store(key, value),
			delete: (key: string) => this.delete(key),
			onDidChange: this.onDidChange
		};
	}

	public override dispose(): void {
		this._secrets.clear();
		super.dispose();
	}
}

let sharedSecretStorage: ExtHostSecretStorage | undefined;

export function getSecretStorage(): ISecretStorage {
	if (!sharedSecretStorage) {
		sharedSecretStorage = new ExtHostSecretStorage();
	}
	return sharedSecretStorage.getSecretStorage();
}
