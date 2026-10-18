/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export namespace tests {
		export function runTests(run: TestRunRequest, token?: CancellationToken): Thenable<void>;

		export function registerTestFollowupProvider(provider: TestFollowupProvider): Disposable;

		export function createTestObserver(): TestObserver;
		export const testResults: ReadonlyArray<TestRunResult>;

		export const onDidChangeTestResults: Event<void>;
	}

	export interface TestFollowupProvider {
		provideFollowup(result: TestRunResult, test: TestResultSnapshot, taskIndex: number, messageIndex: number, token: CancellationToken): ProviderResult<Command[]>;
	}

	export interface TestObserver {
		readonly tests: ReadonlyArray<TestItem>;

		readonly onDidChangeTest: Event<TestsChangeEvent>;

		dispose(): void;
	}

	export interface TestsChangeEvent {
		readonly added: ReadonlyArray<TestItem>;

		readonly updated: ReadonlyArray<TestItem>;

		readonly removed: ReadonlyArray<TestItem>;
	}

	export interface TestRunResult {
		readonly completedAt: number;

		readonly output?: string;

		readonly results: ReadonlyArray<Readonly<TestResultSnapshot>>;

		getDetailedCoverage?(uri: Uri, token?: CancellationToken): Thenable<FileCoverageDetail[]>;
	}

	export interface TestResultSnapshot {
		readonly id: string;

		readonly parent?: TestResultSnapshot;

		readonly uri?: Uri;

		readonly label: string;

		readonly description?: string;

		readonly range?: Range;

		readonly taskStates: ReadonlyArray<TestSnapshotTaskState>;

		readonly children: Readonly<TestResultSnapshot>[];
	}

	export interface TestSnapshotTaskState {
		readonly state: TestResultState;

		readonly duration?: number;

		readonly messages: ReadonlyArray<TestMessage>;
	}

	export enum TestResultState {
		Queued = 1,
		Running = 2,
		Passed = 3,
		Failed = 4,
		Skipped = 5,
		Errored = 6
	}
}
