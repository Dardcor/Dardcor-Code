/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface NotebookCellExecution {
		end(success: boolean | undefined, endTime?: number, error?: CellExecutionError): void;
	}

	export interface CellExecutionError {
		readonly name: string;

		readonly message: string;

		readonly stack: string | CellErrorStackFrame[] | undefined;

		uri: Uri;

		readonly location: Range | undefined;
	}

	export class CellErrorStackFrame {
		readonly uri?: Uri;

		position?: Position;

		readonly label: string;

		constructor(label: string, uri?: Uri, position?: Position);
	}
}
