/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, NotebookCell, NotebookDocument } from 'vscode';
import { isJupyterNotebookUri } from '../../../util/common/notebooks';
import { createServiceIdentifier } from '../../../util/common/services';
import { isUri } from '../../../util/common/types';
import { AsyncIterableObject, AsyncIterableSource, DeferredPromise } from '../../../util/dardcor/base/common/async';
import { StringSHA1 } from '../../../util/dardcor/base/common/hash';
import { Constants } from '../../../util/dardcor/base/common/uint';
import { EndOfLine, NotebookCellData, NotebookCellKind, NotebookEdit, NotebookRange, Range, TextEdit, Uri } from '../../../dardcorTypes';
import { IDiffService } from '../../diff/common/diffService';
import { ILogService } from '../../log/common/logService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { AlternativeContentFormat, IAlternativeNotebookContentService } from './alternativeContent';
import { lineMightHaveCellMarker } from './alternativeContentProvider.text';
import { EOL, getCellId, getCellIdMap, LineOfText } from './helpers';
import { computeDiff } from './notebookDiff';

export type NotebookEditGenerationTelemtryOptions = {
	model: Promise<string> | string | undefined;
	requestId: string | undefined;
	source: NotebookEditGenrationSource;
};

export enum NotebookEditGenrationSource {
	codeMapperEditNotebook = 'codeMapperEditNotebook',
	codeMapperEmptyNotebook = 'codeMapperEmptyNotebook',
	codeMapperFastApply = 'codeMapperFastApply',
	createFile = 'createFile',
	stringReplace = 'stringReplace',
	applyPatch = 'applyPatch',
	newNotebookIntent = 'newNotebookIntent',
}

export const IAlternativeNotebookContentEditGenerator = createServiceIdentifier<IAlternativeNotebookContentEditGenerator>('IAlternativeNotebookContentEditGenerator');
export interface IAlternativeNotebookContentEditGenerator {
	readonly _serviceBrand: undefined;
	generateNotebookEdits(notebookOrUri: NotebookDocument | Uri, lines: AsyncIterable<LineOfText> | string, telemetryOptions: NotebookEditGenerationTelemtryOptions | undefined, token: CancellationToken): AsyncIterable<NotebookEdit | [Uri, TextEdit[]]>;
}

export class AlternativeNotebookContentEditGenerator implements IAlternativeNotebookContentEditGenerator {
	declare readonly _serviceBrand: undefined;
	constructor(
		@IAlternativeNotebookContentService private readonly alternativeContentService: IAlternativeNotebookContentService,
		@IDiffService private readonly diffService: IDiffService,
		@ILogService private readonly logger: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
	}

	private getFormat(firstLine: string): AlternativeContentFormat {
		const firstChar = firstLine.trim().substring(0, 1);
		const format = firstChar === '{' ? 'json' : firstChar === '<' ? 'xml' : 'text';
		return format;
	}

	private getEOLForNewCell(notebookOrUri: NotebookDocument | Uri, cellKind: NotebookCellKind): string | undefined {
		const eolInExistingCodeCell = isUri(notebookOrUri) ? undefined : (notebookOrUri.getCells().find(c => c.kind === cellKind)?.document.eol ?? undefined);
		return eolInExistingCodeCell ? eolInExistingCodeCell === EndOfLine.LF ? '\n' : '\r\n' : EOL;
	}

	public async *generateNotebookEdits(notebookOrUri: NotebookDocument | Uri, lines: AsyncIterable<LineOfText> | string, telemetryOptions: NotebookEditGenerationTelemtryOptions | undefined, token: CancellationToken): AsyncIterable<NotebookEdit | [Uri, TextEdit[]]> {
		lines = typeof lines === 'string' ? textToAsyncIterableLines(lines) : lines;
		const firstNonEmptyLinePromise = new DeferredPromise<LineOfText>();
		lines = readFirstNonEmptyLineAndKeepStreaming(lines, firstNonEmptyLinePromise);
		const firstNonEmptyLine = (await firstNonEmptyLinePromise.p).value;
		const format = this.getFormat(firstNonEmptyLine);

		const linesCollected: string[] = [];
		lines = collectWhileStreaming(lines, linesCollected);
		const isEmptyNotebook = isUri(notebookOrUri) || notebookOrUri.cellCount === 0;

		let notebookEditEmitted = false;
		let cellTextEditEmitted = false;
		for await (const edit of this.generateNotebookEditsImpl(notebookOrUri, lines, format, token)) {
			notebookEditEmitted = notebookEditEmitted || !Array.isArray(edit);
			if (Array.isArray(edit)) {
				cellTextEditEmitted = true;
			}
			yield edit;
		}

		if (isEmptyNotebook || !isUri(notebookOrUri)) {
			if (!notebookEditEmitted && format === 'text' && linesCollected.length && !lineMightHaveCellMarker(firstNonEmptyLine)) {
				const uri = isUri(notebookOrUri) ? notebookOrUri : notebookOrUri.uri;
				if (isJupyterNotebookUri(uri)) {
					const eolForNewCell = this.getEOLForNewCell(notebookOrUri, NotebookCellKind.Code);
					const cellData = new NotebookCellData(NotebookCellKind.Code, linesCollected.join(eolForNewCell), 'python');
					yield NotebookEdit.insertCells(0, [cellData]);
					this.logger.info(`No new cells were emitted for ${uri.toString()}. Emitting a new cell with the contents of the code.`);
				} else {
					this.logger.warn(`No new cells were emitted for ${uri.toString()}`);
				}
			}
		}

		(async () => {
			const model = await Promise.resolve(telemetryOptions?.model).catch(() => undefined);
			this.telemetryService.sendMSFTTelemetryEvent('notebook.editGeneration', {
				requestId: telemetryOptions?.requestId,
				requestSource: telemetryOptions?.source,
				model,
				inputFormat: format
			}, {
				isEmptyNotebook: isEmptyNotebook ? 1 : 0,
				isNotebookOrUri: isUri(notebookOrUri) ? 0 : 1,
				isJupyterNotebookUri: isJupyterNotebookUri(isUri(notebookOrUri) ? notebookOrUri : notebookOrUri.uri) ? 1 : 0,
				isEditEmitted: notebookEditEmitted ? 1 : 0,
				isCellTextEditEmitted: cellTextEditEmitted ? 1 : 0,
				sourceLength: linesCollected.length
			});
		})();
	}

	public async *generateNotebookEditsImpl(notebookOrUri: NotebookDocument | Uri, lines: AsyncIterable<LineOfText>, format: AlternativeContentFormat, token: CancellationToken): AsyncIterable<NotebookEdit | [Uri, TextEdit[]]> {
		const provider = this.alternativeContentService.create(format);
		const isEmptyNotebook = isUri(notebookOrUri) || notebookOrUri.cellCount === 0;
		const isNotebookAvailable = !isUri(notebookOrUri);
		const cellIdMap = isNotebookAvailable ? getCellIdMap(notebookOrUri) : new Map<string, NotebookCell>();

		const cellInfo: { index: number; language: string; cell?: NotebookCell; lines: string[]; insertEdit?: NotebookEdit; ended: boolean } = {
			index: -1,
			lines: [],
			language: 'markdown',
			ended: false
		};

		const cellsSeen = new WeakSet<NotebookCell>();
		function getCellIdOfNewCell(cell: ExpectedCellInfo): string {
			const hash = new StringSHA1();
			hash.update(cell.index.toString());
			return hash.digest().substring(0, 8);
		}


		type ExpectedCellInfo = { index: number; cell?: NotebookCell; lines: string[]; language: string };
		const expectedCells: ExpectedCellInfo[] = [];
		const original: { id: string; uri?: Uri }[] = isUri(notebookOrUri) ? [] : notebookOrUri.getCells().map(cell => ({ id: getCellId(cell), uri: cell.document.uri }));
		const allLines: string[] = [];
		lines = collectWhileStreaming(lines, allLines);
		let editsEmitted = false;
		for await (const line of provider.parseAlternateContent(notebookOrUri, lines, token)) {
			if (token.isCancellationRequested) {
				break;
			}
			if (line.type === 'start') {
				const expectedCell: ExpectedCellInfo = {
					index: line.index,
					language: line.language || 'markdown',
					lines: [],
					cell: line.id ? cellIdMap.get(line.id) : undefined
				};
				expectedCells.push(expectedCell);
				cellInfo.ended = false;
				cellInfo.insertEdit = undefined;
				cellInfo.index = expectedCell.index;
				cellInfo.lines = expectedCell.lines;
				cellInfo.language = expectedCell.language;
				cellInfo.cell = expectedCell.cell;
				if (cellInfo.cell) {
					cellsSeen.add(cellInfo.cell);
				}
			} else if (line.type === 'end') {
				cellInfo.ended = true;
				const doc = cellInfo.cell?.document;
				if (!cellInfo.insertEdit && !cellInfo.cell && !cellInfo.lines.length) {
					const cellData = new NotebookCellData(cellInfo.language === 'markdown' ? NotebookCellKind.Markup : NotebookCellKind.Code, '', cellInfo.language);
					const insertEdit = NotebookEdit.insertCells(cellInfo.index, [cellData]);
					yield insertEdit;
					editsEmitted = true;
					original.splice(cellInfo.index, 0, { id: getCellIdOfNewCell(cellInfo) });
				} else if (cellInfo.insertEdit && !cellInfo.cell) {
					const existingCell = (!isEmptyNotebook && isNotebookAvailable && cellInfo.index < notebookOrUri.cellCount) ? notebookOrUri.cellAt(cellInfo.index) : undefined;
					if (existingCell && existingCell.document.getText() === cellInfo.insertEdit.newCells[0].value) {
						cellsSeen.add(existingCell);
						expectedCells[expectedCells.length - 1].cell = existingCell;

						const doc = existingCell.document;
						for (let i = 0; i < doc.lineCount; i++) {
							const line = doc.lineAt(i);
							yield [doc.uri, [new TextEdit(new Range(i, 0, i, Constants.MAX_SAFE_SMALL_INTEGER), line.text)]];
							editsEmitted = true;
						}
					} else {
						yield cellInfo.insertEdit;
						editsEmitted = true;
						original.splice(cellInfo.index, 0, { id: getCellIdOfNewCell(cellInfo) });
					}
				} else if (cellInfo.lines.length && doc && cellInfo.lines.length < doc.lineCount) {
					const range = new Range(cellInfo.lines.length - 1, cellInfo.lines.slice(-1)[0].length, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
					yield [doc.uri, [new TextEdit(range, '')]];
				}
			} else if (line.type === 'line' && !cellInfo.ended) {
				cellInfo.lines.push(line.line);
				if (cellInfo.cell) {
					if (cellInfo.lines.length > cellInfo.cell.document.lineCount) {
						const range = new Range(cellInfo.lines.length - 1, 0, cellInfo.lines.length - 1, 0);
						const eol = cellInfo.cell.document.eol === EndOfLine.LF ? '\n' : '\r\n';
						const newText = `${eol}${line.line}`;
						yield [cellInfo.cell.document.uri, [new TextEdit(range, newText)]];
					} else {
						const lineIndex = cellInfo.lines.length - 1;
						yield [cellInfo.cell.document.uri, [new TextEdit(new Range(lineIndex, 0, lineIndex, Constants.MAX_SAFE_SMALL_INTEGER), line.line)]];
					}
					editsEmitted = true;
				} else if (cellInfo.insertEdit) {
					const eolForNewCell = this.getEOLForNewCell(notebookOrUri, cellInfo.insertEdit.newCells[0].kind);
					cellInfo.insertEdit.newCells[0].value = cellInfo.lines.join(eolForNewCell);
				} else {
					const cellData = new NotebookCellData(cellInfo.language === 'markdown' ? NotebookCellKind.Markup : NotebookCellKind.Code, line.line, cellInfo.language);
					cellInfo.insertEdit = NotebookEdit.insertCells(cellInfo.index, [cellData]);
				}
			}
		}

		if (isEmptyNotebook || !isNotebookAvailable) {
			return;
		}

		if (!editsEmitted && allLines.length) {
			this.logger.warn(`No edits generated for notebook ${notebookOrUri.uri.toString()}. This is likely due to an invalid format. Expected format: ${format}. Provided content as follows:\n\n${allLines.join('\n')}`);
			return;
		}

		const modified = expectedCells.map(cell => cell.cell ? getCellId(cell.cell) : getCellIdOfNewCell(cell));

		for (const missingCell of original.filter(cell => cell.uri && !modified.includes(cell.id)).reverse()) {
			const cell = cellIdMap.get(missingCell.id);
			if (cell) {
				const index = original.indexOf(missingCell);
				yield NotebookEdit.deleteCells(new NotebookRange(index, index + 1));
				original.splice(index, 1);
			}
		}

		const result = await this.diffService.computeDiff(original.map(c => c.id).join(EOL), modified.join(EOL), { computeMoves: false, ignoreTrimWhitespace: true, maxComputationTimeMs: 5_000 });
		const diffResult = computeDiff(original.map(i => i.id), modified, result.changes);

		if (diffResult.every(d => d.type === 'unchanged')) {
			return;
		}

		for (const change of diffResult.filter(d => d.type === 'delete').reverse()) {
			yield NotebookEdit.deleteCells(new NotebookRange(change.originalCellIndex, change.originalCellIndex + 1));
		}

		for (const change of diffResult.filter(d => d.type === 'insert')) {
			const expectedCell = expectedCells[change.modifiedCellIndex];
			const kind = expectedCell.language === 'markdown' ? NotebookCellKind.Markup : NotebookCellKind.Code;
			const eolForNewCell = this.getEOLForNewCell(notebookOrUri, kind);
			const source = expectedCell.lines.join(eolForNewCell);
			const cellData = new NotebookCellData(kind, source, expectedCell.language);
			yield NotebookEdit.insertCells(expectedCell.index, [cellData]);
		}
	}

}

export function textToAsyncIterableLines(text: string): AsyncIterable<LineOfText> {
	const source = new AsyncIterableSource<string>();
	source.emitOne(text);
	source.resolve();
	return streamLines(source.asyncIterable);
}


function streamLines(source: AsyncIterable<string>): AsyncIterableObject<LineOfText> {
	return new AsyncIterableObject<LineOfText>(async (emitter) => {
		let buffer = '';
		for await (const str of source) {
			buffer += str;
			do {
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex === -1) {
					break;
				}

				const line = buffer.substring(0, newlineIndex);
				buffer = buffer.substring(newlineIndex + 1);

				emitter.emitOne(new LineOfText(line));
			} while (true);
		}

		if (buffer.length > 0) {
			emitter.emitOne(new LineOfText(buffer));
		}
	});
}


function readFirstNonEmptyLineAndKeepStreaming(source: AsyncIterable<LineOfText>, firstNonEmptyLine: DeferredPromise<LineOfText>): AsyncIterable<LineOfText> {
	return new AsyncIterableObject<LineOfText>(async (emitter) => {
		for await (const line of source) {
			if (!firstNonEmptyLine.isSettled && line.value.trim().length) {
				firstNonEmptyLine.complete(line);
			}
			emitter.emitOne(line);
		}
		if (!firstNonEmptyLine.isSettled) {
			firstNonEmptyLine.complete(new LineOfText(''));
		}
	});
}

function collectWhileStreaming(source: AsyncIterable<LineOfText>, lines: string[]): AsyncIterable<LineOfText> {
	return new AsyncIterableObject<LineOfText>(async (emitter) => {
		for await (const line of source) {
			lines.push(line.value);
			emitter.emitOne(line);
		}
	});
}
