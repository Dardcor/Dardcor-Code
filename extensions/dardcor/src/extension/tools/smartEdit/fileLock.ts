/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

class AsyncLock {
	private queue: Array<() => void> = [];
	private locked = false;

	public async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}

		await new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	public release(): void {
		if (this.queue.length > 0) {
			const next = this.queue.shift()!;
			next();
		} else {
			this.locked = false;
		}
	}
}

const fileLocks = new Map<string, AsyncLock>();

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
	let lock = fileLocks.get(normalizedPath);
	if (!lock) {
		lock = new AsyncLock();
		fileLocks.set(normalizedPath, lock);
	}

	await lock.acquire();
	try {
		return await fn();
	} finally {
		lock.release();
	}
}
