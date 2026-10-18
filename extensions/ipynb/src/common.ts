/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as nbformat from '@jupyterlab/nbformat';

export interface CellOutputMetadata {
	metadata?: any;

	transient?: {
		display_id?: string;
	} & any;

	outputType: nbformat.OutputType | string;

	executionCount?: nbformat.IExecuteResult['ExecutionCount'];

	__isJson?: boolean;
}


export interface CellMetadata {
	id?: string;
	attachments?: nbformat.IAttachments;
	metadata?: Partial<nbformat.ICellMetadata> & { vscode?: { languageId?: string } };
	execution_count?: number | null;
}



type KeysOfUnionType<T> = T extends T ? keyof T : never;
type FilterType<T, TTest> = T extends TTest ? T : never;
type MakeOptionalAndBool<T extends object> = { [K in keyof T]?: boolean };

export function hasKey<T extends object, TKeys>(x: T, key: TKeys & MakeOptionalAndBool<T>): x is FilterType<T, { [K in KeysOfUnionType<T> & keyof TKeys]: unknown }> {
	for (const k in key) {
		if (!(k in x)) {
			return false;
		}
	}
	return true;
}
