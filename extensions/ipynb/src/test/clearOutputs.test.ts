/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import type * as nbformat from '@jupyterlab/nbformat';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { jupyterNotebookModelToNotebookData } from '../deserializers';
import { activate } from '../notebookModelStoreSync';


suite(`ipynb Clear Outputs`, () => {
	const disposables: vscode.Disposable[] = [];
	const context = { subscriptions: disposables } as vscode.ExtensionContext;
	setup(() => {
		disposables.length = 0;
		activate(context);
	});
	teardown(async () => {
		disposables.forEach(d => d.dispose());
		disposables.length = 0;
		sinon.restore();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test.skip('Clear outputs after opening Notebook', async () => {
		const cells: nbformat.ICell[] = [
			{
				cell_type: 'code',
				execution_count: 10,
				outputs: [{ output_type: 'stream', name: 'stdout', text: ['Hello'] }],
				source: 'print(1)',
				metadata: {}
			},
			{
				cell_type: 'code',
				outputs: [],
				source: 'print(2)',
				metadata: {}
			},
			{
				cell_type: 'markdown',
				source: '# HEAD',
				metadata: {}
			}
		];
		const notebook = jupyterNotebookModelToNotebookData({ cells }, 'python');

		const notebookDocumentPromise = vscode.workspace.openNotebookDocument('jupyter-notebook', notebook);
		await raceTimeout(notebookDocumentPromise, 5000, () => {
			throw new Error('Timeout waiting for notebook to open');
		});
		const notebookDocument = await notebookDocumentPromise;
		await raceTimeout(vscode.window.showNotebookDocument(notebookDocument), 20000, () => {
			throw new Error('Timeout waiting for notebook to open');
		});

		assert.strictEqual(notebookDocument.cellCount, 3);
		assert.strictEqual(notebookDocument.cellAt(0).metadata.execution_count, 10);
		assert.strictEqual(notebookDocument.cellAt(1).metadata.execution_count, null);
		assert.strictEqual(notebookDocument.cellAt(2).metadata.execution_count, undefined);

		await raceTimeout(vscode.commands.executeCommand('notebook.clearAllCellsOutputs'), 5000, () => {
			throw new Error('Timeout waiting for notebook to clear outputs');
		});

		const verifyMetadataChanges = () => {
			assert.strictEqual(notebookDocument.cellAt(0).metadata.execution_count, null);
			assert.strictEqual(notebookDocument.cellAt(1).metadata.execution_count, null);
			assert.strictEqual(notebookDocument.cellAt(2).metadata.execution_count, undefined);
		};

		vscode.workspace.onDidChangeNotebookDocument(() => verifyMetadataChanges(), undefined, disposables);

		await new Promise<void>((resolve, reject) => {
			const interval = setInterval(() => {
				try {
					verifyMetadataChanges();
					clearInterval(interval);
					resolve();
				} catch {
				}
			}, 50);
			disposables.push({ dispose: () => clearInterval(interval) });
			const timeout = setTimeout(() => {
				try {
					verifyMetadataChanges();
					resolve();
				} catch (ex) {
					reject(ex);
				}
			}, 1000);
			disposables.push({ dispose: () => clearTimeout(timeout) });
		});
	});
























});

function raceTimeout<T>(promise: Thenable<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);

	return Promise.race([
		Promise.resolve(promise).then(
			result => {
				clearTimeout(timer);
				return result;
			},
			err => {
				clearTimeout(timer);
				throw err;
			}
		),
		new Promise<T | undefined>(resolve => promiseResolve = resolve)
	]);
}
