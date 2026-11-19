/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface NotebookControllerDetectionTask {
		dispose(): void;
	}

	export class NotebookKernelSourceAction {
		readonly label: string;
		readonly description?: string;
		readonly detail?: string;
		readonly command: string | Command;
		readonly documentation?: Uri;

		constructor(label: string);
	}

	export interface NotebookKernelSourceActionProvider {
		readonly onDidChangeNotebookKernelSourceActions?: Event<void>;
		provideNotebookKernelSourceActions(token: CancellationToken): ProviderResult<NotebookKernelSourceAction[]>;
	}

	export namespace notebooks {
		export function createNotebookControllerDetectionTask(notebookType: string): NotebookControllerDetectionTask;

		export function registerKernelSourceActionProvider(notebookType: string, provider: NotebookKernelSourceActionProvider): Disposable;
	}
}
