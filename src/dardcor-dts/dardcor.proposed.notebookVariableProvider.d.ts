/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
declare module 'vscode' {

	export interface NotebookController {
		variableProvider?: NotebookVariableProvider;
	}

	export enum NotebookVariablesRequestKind {
		Named = 1,
		Indexed = 2
	}

	export interface VariablesResult {
		variable: Variable;
		hasNamedChildren: boolean;
		indexedChildrenCount: number;
	}

	export interface NotebookVariableProvider {
		readonly onDidChangeVariables: Event<NotebookDocument>;

		/** When parent is undefined, this is requesting global Variables. When a variable is passed, it's requesting child props of that Variable. */
		provideVariables(notebook: NotebookDocument, parent: Variable | undefined, kind: NotebookVariablesRequestKind, start: number, token: CancellationToken): AsyncIterable<VariablesResult>;
	}

	export interface Variable {
		name: string;

		value: string;

		expression?: string;

		type?: string;

		interfaces?: string[];

		language?: string;
	}

}
