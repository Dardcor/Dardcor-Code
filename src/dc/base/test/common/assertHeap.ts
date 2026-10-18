/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare const __analyzeSnapshotInTests: (currentTest: string, classes: readonly string[]) => Promise<({ done: Promise<number[]>; file: string })>;

let currentTest: Mocha.Test | undefined;

const snapshotsToAssert: ({ counts: Promise<number[]>; file: string; test: string; opts: ISnapshotAssertOptions })[] = [];

setup(function () {
	currentTest = this.currentTest;
});

suiteTeardown(async () => {
	await Promise.all(snapshotsToAssert.map(async snap => {
		const counts = await snap.counts;

		const asserts = Object.entries(snap.opts.classes);
		if (asserts.length !== counts.length) {
			throw new Error(`expected class counts to equal assertions length for ${snap.test}`);
		}

		for (const [i, [name, doAssert]] of asserts.entries()) {
			try {
				doAssert(counts[i]);
			} catch (e) {
				throw new Error(`Unexpected number of ${name} instances (${counts[i]}) after "${snap.test}":\n\n${e.message}\n\nSnapshot saved at: ${snap.file}`);
			}
		}
	}));

	snapshotsToAssert.length = 0;
});

export interface ISnapshotAssertOptions {
	classes: Record<string, (count: number) => void>;
}

const snapshotMinTime = 20_000;

export async function assertHeap(opts: ISnapshotAssertOptions) {
	if (!currentTest) {
		throw new Error('assertSnapshot can only be used when a test is running');
	}

	if (currentTest.timeout() < snapshotMinTime) {
		currentTest.timeout(snapshotMinTime);
	}

	if (typeof __analyzeSnapshotInTests === 'undefined') {
		return;
	}

	const { done, file } = await __analyzeSnapshotInTests(currentTest.fullTitle(), Object.keys(opts.classes));
	snapshotsToAssert.push({ counts: done, file, test: currentTest.fullTitle(), opts });
}

