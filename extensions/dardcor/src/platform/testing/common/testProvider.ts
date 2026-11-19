/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const ITestProvider = createServiceIdentifier<ITestProvider>('ITestProvider');

export interface ITestFailure {
	snapshot: vscode.TestResultSnapshot;
	task: vscode.TestSnapshotTaskState;
}

export interface ITestProvider {
	readonly _serviceBrand: undefined;

	readonly lastResultsFrom?: number;

	readonly onDidChangeResults: vscode.Event<void>;

	getAllFailures(): Iterable<ITestFailure>;

	getLastFailureFor(testItem: vscode.TestItem): ITestFailure | undefined;

	getFailureAtPosition(uri: vscode.Uri, position: vscode.Position): ITestFailure | undefined;

	hasTestsInUri(uri: vscode.Uri): Promise<boolean>;

	hasAnyTests(): Promise<boolean>;
}
