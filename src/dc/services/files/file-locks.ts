/**
 * Dardcor Code - Atomic File Write Lock Queue (Task 185)
 * Mirrors: vs/platform/files/common/fileLocks.ts
 */

import { URI } from '../../core/types/uri.js';

export class FileLockManager {
	private readonly _locks = new Map<string, Promise<any>>();

	async lock<T>(resource: URI, task: () => Promise<T>): Promise<T> {
		const key = resource.toString();
		const current = this._locks.get(key) || Promise.resolve();

		const next = current.then(async () => {
			return task();
		}).finally(() => {
			if (this._locks.get(key) === next) {
				this._locks.delete(key);
			}
		});

		this._locks.set(key, next);
		return next;
	}

	isLocked(resource: URI): boolean {
		return this._locks.has(resource.toString());
	}
}
