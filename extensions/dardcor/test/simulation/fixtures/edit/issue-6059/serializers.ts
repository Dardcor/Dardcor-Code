/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as nbformat from '@jupyterlab/nbformat';
import { NotebookCell, NotebookCellData, NotebookCellKind, NotebookCellOutput } from 'vscode';
import { CellOutputMetadata, useCustomPropertyInMetadata, type CellMetadata } from './common';
import { textMimeTypes } from './deserializers';

const textDecoder = new TextDecoder();

enum CellOutputMimeTypes {
	error = 'application/vnd.code.notebook.error',
	stderr = 'application/vnd.code.notebook.stderr',
	stdout = 'application/vnd.code.notebook.stdout'
}

export function createJupyterCellFromNotebookCell(
	vscCell: NotebookCellData,
	preferredLanguage: string | undefined
): nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell {
	let cell: nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell;
	if (vscCell.kind === NotebookCellKind.Markup) {
		cell = createMarkdownCellFromNotebookCell(vscCell);
	} else if (vscCell.languageId === 'raw') {
		cell = createRawCellFromNotebookCell(vscCell);
	} else {
		cell = createCodeCellFromNotebookCell(vscCell, preferredLanguage);
	}
	return cell;
}







export function sortObjectPropertiesRecursively(obj: any): any {
	if (Array.isArray(obj)) {
		return obj.map(sortObjectPropertiesRecursively);
	}
	if (obj !== undefined && obj !== null && typeof obj === 'object' && Object.keys(obj).length > 0) {
		return (
			Object.keys(obj)
				.sort()
				.reduce<Record<string, any>>((sortedObj, prop) => {
					sortedObj[prop] = sortObjectPropertiesRecursively(obj[prop]);
					return sortedObj;
				}, {}) as any
		);
	}
	return obj;
}

export function getCellMetadata(options: { cell: NotebookCell | NotebookCellData } | { metadata?: { [key: string]: any } }): CellMetadata {
	if ('cell' in options) {
		const cell = options.cell;
		if (useCustomPropertyInMetadata()) {
			const metadata: CellMetadata = {

				...(cell.metadata?.custom ?? {})
			};

			const attachments = cell.metadata?.custom?.attachments ?? cell.metadata?.attachments;
			if (attachments) {
				metadata.attachments = attachments;
			}
			return metadata;
		}
		const metadata = {

			...(cell.metadata ?? {})
		};

		return metadata;
	} else {
		const cell = options;
		if (useCustomPropertyInMetadata()) {
			const metadata: CellMetadata = {

				...(cell.metadata?.custom ?? {})
			};

			const attachments = cell.metadata?.custom?.attachments ?? cell.metadata?.attachments;
			if (attachments) {
				metadata.attachments = attachments;
			}
			return metadata;
		}
		const metadata = {

			...(cell.metadata ?? {})
		};

		return metadata;
	}
}

export function getVSCodeCellLanguageId(metadata: CellMetadata): string | undefined {
	return metadata.metadata?.vscode?.languageId;
}
export function setVSCodeCellLanguageId(metadata: CellMetadata, languageId: string) {
	metadata.metadata = metadata.metadata || {};
	metadata.metadata.vscode = { languageId };
}
export function removeVSCodeCellLanguageId(metadata: CellMetadata) {
	if (metadata.metadata?.vscode) {
		delete metadata.metadata.vscode;
	}
}

function createCodeCellFromNotebookCell(cell: NotebookCellData, preferredLanguage: string | undefined): nbformat.ICodeCell {
	const cellMetadata: CellMetadata = JSON.parse(JSON.stringify(getCellMetadata({ cell })));
	cellMetadata.metadata = cellMetadata.metadata || {};
	if (cell.languageId !== preferredLanguage) {
		setVSCodeCellLanguageId(cellMetadata, cell.languageId);
	} else {

		removeVSCodeCellLanguageId(cellMetadata);
	}

	const codeCell: any = {
		cell_type: 'code',



		execution_count: cellMetadata.execution_count ?? cell.executionSummary?.executionOrder ?? null,
		source: splitMultilineString(cell.value.replace(/\r\n/g, '\n')),
		outputs: (cell.outputs || []).map(translateCellDisplayOutput),
		metadata: cellMetadata.metadata
	};
	if (cellMetadata?.id) {
		codeCell.id = cellMetadata.id;
	}
	return codeCell;
}

function createRawCellFromNotebookCell(cell: NotebookCellData): nbformat.IRawCell {
	const cellMetadata = getCellMetadata({ cell });
	const rawCell: any = {
		cell_type: 'raw',
		source: splitMultilineString(cell.value.replace(/\r\n/g, '\n')),
		metadata: cellMetadata?.metadata || {}
	};
	if (cellMetadata?.attachments) {
		rawCell.attachments = cellMetadata.attachments;
	}
	if (cellMetadata?.id) {
		rawCell.id = cellMetadata.id;
	}
	return rawCell;
}

function splitMultilineString(source: nbformat.MultilineString): string[] {
	if (Array.isArray(source)) {
		return source as string[];
	}
	const str = source.toString();
	if (str.length > 0) {

		const arr = str.split('\n');
		return arr
			.map((s, i) => {
				if (i < arr.length - 1) {
					return `${s}\n`;
				}
				return s;
			})
			.filter(s => s.length > 0);
	}
	return [];
}

function translateCellDisplayOutput(output: NotebookCellOutput): JupyterOutput {
	const customMetadata = output.metadata as CellOutputMetadata | undefined;
	let result: JupyterOutput;


	const outputType = customMetadata?.outputType as nbformat.OutputType;
	switch (outputType) {
		case 'error': {
			result = translateCellErrorOutput(output);
			break;
		}
		case 'stream': {
			result = convertStreamOutput(output);
			break;
		}
		case 'display_data': {
			result = {
				output_type: 'display_data',
				data: output.items.reduce((prev: any, curr) => {
					prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
					return prev;
				}, {}),
				metadata: customMetadata?.metadata || {}
			};
			break;
		}
		case 'execute_result': {
			result = {
				output_type: 'execute_result',
				data: output.items.reduce((prev: any, curr) => {
					prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
					return prev;
				}, {}),
				metadata: customMetadata?.metadata || {}, // This can never be undefined.
				execution_count:
					typeof customMetadata?.executionCount === 'number' ? customMetadata?.executionCount : null
			};
			break;
		}
		case 'update_display_data': {
			result = {
				output_type: 'update_display_data',
				data: output.items.reduce((prev: any, curr) => {
					prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
					return prev;
				}, {}),
				metadata: customMetadata?.metadata || {}
			};
			break;
		}
		default: {
			const isError =
				output.items.length === 1 && output.items.every((item) => item.mime === CellOutputMimeTypes.error);
			const isStream = output.items.every(
				(item) => item.mime === CellOutputMimeTypes.stderr || item.mime === CellOutputMimeTypes.stdout
			);

			if (isError) {
				return translateCellErrorOutput(output);
			}




			const outputType: nbformat.OutputType =
				<nbformat.OutputType>customMetadata?.outputType || (isStream ? 'stream' : 'display_data');
			let unknownOutput: nbformat.IUnrecognizedOutput | nbformat.IDisplayData | nbformat.IStream;
			if (outputType === 'stream') {

				unknownOutput = convertStreamOutput(output);
			} else if (outputType === 'display_data') {

				const displayData: nbformat.IDisplayData = {
					data: {},
					metadata: {},
					output_type: 'display_data'
				};
				unknownOutput = displayData;
			} else {
				unknownOutput = {
					output_type: outputType
				};
			}
			if (customMetadata?.metadata) {
				unknownOutput.metadata = customMetadata.metadata;
			}
			if (output.items.length > 0) {
				unknownOutput.data = output.items.reduce((prev: any, curr) => {
					prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
					return prev;
				}, {});
			}
			result = unknownOutput;
			break;
		}
	}



	if (result && customMetadata && customMetadata.transient) {
		result.transient = customMetadata.transient;
	}
	return result;
}

function translateCellErrorOutput(output: NotebookCellOutput): nbformat.IError {

	const firstItem = output.items[0];

	if (!firstItem.data) {
		return {
			output_type: 'error',
			ename: '',
			evalue: '',
			traceback: []
		};
	}
	const originalError: undefined | nbformat.IError = output.metadata?.originalError;
	const value: Error = JSON.parse(textDecoder.decode(firstItem.data));
	return {
		output_type: 'error',
		ename: value.name,
		evalue: value.message,




		traceback: originalError?.traceback || splitMultilineString(value.stack || value.message || '')
	};
}


function getOutputStreamType(output: NotebookCellOutput): string | undefined {
	if (output.items.length > 0) {
		return output.items[0].mime === CellOutputMimeTypes.stderr ? 'stderr' : 'stdout';
	}

	return;
}

type JupyterOutput =
	| nbformat.IUnrecognizedOutput
	| nbformat.IExecuteResult
	| nbformat.IDisplayData
	| nbformat.IStream
	| nbformat.IError;

function convertStreamOutput(output: NotebookCellOutput): JupyterOutput {
	const outputs: string[] = [];
	output.items
		.filter((opit) => opit.mime === CellOutputMimeTypes.stderr || opit.mime === CellOutputMimeTypes.stdout)
		.map((opit) => textDecoder.decode(opit.data))
		.forEach(value => {

			const lines = value.split('\n');


			if (outputs.length && lines.length && lines[0].length > 0) {
				outputs[outputs.length - 1] = `${outputs[outputs.length - 1]}${lines.shift()!}`;
			}
			for (const line of lines) {
				outputs.push(line);
			}
		});

	for (let index = 0; index < (outputs.length - 1); index++) {
		outputs[index] = `${outputs[index]}\n`;
	}


	if (outputs.length && outputs[outputs.length - 1].length === 0) {
		outputs.pop();
	}

	const streamType = getOutputStreamType(output) || 'stdout';

	return {
		output_type: 'stream',
		name: streamType,
		text: outputs
	};
}

function convertOutputMimeToJupyterOutput(mime: string, value: Uint8Array) {
	if (!value) {
		return '';
	}
	try {
		if (mime === CellOutputMimeTypes.error) {
			const stringValue = textDecoder.decode(value);
			return JSON.parse(stringValue);
		} else if (mime.startsWith('text/') || textMimeTypes.includes(mime)) {
			const stringValue = textDecoder.decode(value);
			return splitMultilineString(stringValue);
		} else if (mime.startsWith('image/') && mime !== 'image/svg+xml') {


			if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
				return Buffer.from(value).toString('base64');
			} else {
				return btoa(value.reduce((s: string, b: number) => s + String.fromCharCode(b), ''));
			}
		} else if (mime.toLowerCase().includes('json')) {
			const stringValue = textDecoder.decode(value);
			return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
		} else if (mime === 'image/svg+xml') {
			return splitMultilineString(textDecoder.decode(value));
		} else {
			return textDecoder.decode(value);
		}
	} catch (ex) {
		return '';
	}
}

export function createMarkdownCellFromNotebookCell(cell: NotebookCellData): nbformat.IMarkdownCell {
	const cellMetadata = getCellMetadata({ cell });
	const markdownCell: any = {
		cell_type: 'markdown',
		source: splitMultilineString(cell.value.replace(/\r\n/g, '\n')),
		metadata: cellMetadata?.metadata || {}
	};
	if (cellMetadata?.attachments) {
		markdownCell.attachments = cellMetadata.attachments;
	}
	if (cellMetadata?.id) {
		markdownCell.id = cellMetadata.id;
	}
	return markdownCell;
}

export function pruneCell(cell: nbformat.ICell): nbformat.ICell {

	const result = {
		...cell,
		source: splitMultilineString(cell.source)
	} as nbformat.ICell;


	if (result.cell_type !== 'code') {
		delete (<any>result).outputs;
		delete (<any>result).execution_count;
	} else {

		result.outputs = result.outputs ? (result.outputs as nbformat.IOutput[]).map(fixupOutput) : [];
	}

	return result;
}
const dummyStreamObj: nbformat.IStream = {
	output_type: 'stream',
	name: 'stdout',
	text: ''
};
const dummyErrorObj: nbformat.IError = {
	output_type: 'error',
	ename: '',
	evalue: '',
	traceback: ['']
};
const dummyDisplayObj: nbformat.IDisplayData = {
	output_type: 'display_data',
	data: {},
	metadata: {}
};
const dummyExecuteResultObj: nbformat.IExecuteResult = {
	output_type: 'execute_result',
	name: '',
	execution_count: 0,
	data: {},
	metadata: {}
};
const AllowedCellOutputKeys = {
	['stream']: new Set(Object.keys(dummyStreamObj)),
	['error']: new Set(Object.keys(dummyErrorObj)),
	['display_data']: new Set(Object.keys(dummyDisplayObj)),
	['execute_result']: new Set(Object.keys(dummyExecuteResultObj))
};

function fixupOutput(output: nbformat.IOutput): nbformat.IOutput {
	let allowedKeys: Set<string>;
	switch (output.output_type) {
		case 'stream':
		case 'error':
		case 'execute_result':
		case 'display_data':
			allowedKeys = AllowedCellOutputKeys[output.output_type];
			break;
		default:
			return output;
	}
	const result = { ...output };
	for (const k of Object.keys(output)) {
		if (!allowedKeys.has(k)) {
			delete result[k];
		}
	}
	return result;
}
