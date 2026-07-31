/**
 * Dardcor Code - ServiceCollection Map
 */

import { ServiceIdentifier } from './annotations.js';
import { SyncDescriptor } from './descriptors.js';

export class ServiceCollection {
	private readonly _entries = new Map<ServiceIdentifier<any>, any>();

	constructor(...entries: [ServiceIdentifier<any>, any][]) {
		for (const [id, service] of entries) {
			this.set(id, service);
		}
	}

	public set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): T | SyncDescriptor<T> {
		const result = this._entries.get(id);
		this._entries.set(id, instanceOrDescriptor);
		return result;
	}

	public has(id: ServiceIdentifier<any>): boolean {
		return this._entries.has(id);
	}

	public get<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> {
		return this._entries.get(id);
	}
}
