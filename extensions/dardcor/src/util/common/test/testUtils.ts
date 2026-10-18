/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach } from 'vitest';
import { DisposableStore, DisposableTracker, IDisposable, setDisposableTracker } from '../../dardcor/base/common/lifecycle';

export function ensureNoDisposablesAreLeakedInTestSuite(): Pick<DisposableStore, 'add'> {
	let tracker: DisposableTracker | undefined;
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
		tracker = new DisposableTracker();
		setDisposableTracker(tracker);
	});

	afterEach(() => {
		store.clear();
		setDisposableTracker(null);
		const result = tracker!.computeLeakingDisposables();
		if (result) {
			console.error(result.details);
			throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
		}
	});

	const testContext = {
		add<T extends IDisposable>(o: T): T {
			return store.add(o);
		}
	};
	return testContext;
}

export function throwIfDisposablesAreLeaked(body: () => void, logToConsole = true): void {
	const tracker = new DisposableTracker();
	setDisposableTracker(tracker);
	body();
	setDisposableTracker(null);
	computeLeakingDisposables(tracker, logToConsole);
}

export async function throwIfDisposablesAreLeakedAsync(body: () => Promise<void>): Promise<void> {
	const tracker = new DisposableTracker();
	setDisposableTracker(tracker);
	await body();
	setDisposableTracker(null);
	computeLeakingDisposables(tracker);
}

function computeLeakingDisposables(tracker: DisposableTracker, logToConsole = true) {
	const result = tracker.computeLeakingDisposables();
	if (result) {
		if (logToConsole) {
			console.error(result.details);
		}
		throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
	}
}
