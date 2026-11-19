/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { visit } from 'jsonc-parser';
import type { CancellationToken, NotebookCell, NotebookDocument, TextDocument } from 'vscode';
import { AsyncIterableObject } from '../../../util/dardcor/base/common/async';
import { URI } from '../../../util/dardcor/base/common/uri';
import { NotebookCellKind, Position, Range, Uri } from '../../../dardcorTypes';
import { BaseAlternativeNotebookContentProvider } from './alternativeContentProvider';
import { AlternativeNotebookDocument } from './alternativeNotebookDocument';
import { EOL, getCellId, getCellIdMap, getDefaultLanguage, LineOfCellText, LineOfText, summarize } from './helpers';

const IndentSize = 4;

export function isJsonContent(text: string): boolean {
	if (text.startsWith('{') || text.trim().startsWith('{')) {
		return true;
	}

	if ((text.includes('{') || text.includes('}')) && text.includes('"source":') && text.includes('"cell_type":')) {
		return true;
	}
	return false;
}

class AlternativeJsonDocument extends AlternativeNotebookDocument {
	override fromCellPosition(cell: NotebookCell, position: Position): Position {
		const cellId = getCellId(cell);

		const alternativeContentText = this.getText();
		const sourcePrefix = `                `;
		const cellMarker = `"id": "${cellId}",`;
		const positionOfSource = alternativeContentText.indexOf(`"source": [`, alternativeContentText.indexOf(cellMarker));

		const firstLineIndexOfCellSource = this.positionAt(positionOfSource).line + 1;
		const leadingCharacters = cell.document.getText(new Range(position.line, 0, position.line, position.character));
		const characterPositionInAltContent = `${sourcePrefix}${JSON.stringify(leadingCharacters).slice(0, -1)}`;
		const linePositionInAltContent = position.line + firstLineIndexOfCellSource;
		return new Position(linePositionInAltContent, characterPositionInAltContent.length);
	}
	override toCellPosition(position: Position): { cell: NotebookCell; position: Position } | undefined {
		throw new Error('Method not implemented.');
	}
}

export class AlternativeJsonNotebookContentProvider extends BaseAlternativeNotebookContentProvider {
	constructor() {
		super('json');
	}

	public stripCellMarkers(text: string): string {
		return text;
	}

	public override parseAlternateContent(notebookOrUri: NotebookDocument | Uri, inputStream: AsyncIterable<LineOfText>, token: CancellationToken): AsyncIterable<LineOfCellText> {
		return this.parseAlternateContentImpl(notebookOrUri, inputStream, token);
	}

	public override getAlternativeDocumentFromText(text: string, notebook: NotebookDocument): AlternativeNotebookDocument {
		return new AlternativeJsonDocument(text, notebook);
	}

	public override getAlternativeDocument(notebook: NotebookDocument, excludeMarkdownCells?: boolean): AlternativeNotebookDocument {
		const cells = notebook.getCells().filter(cell => excludeMarkdownCells ? cell.kind !== NotebookCellKind.Markup : true).map(cell => {
			const summary = summarize(cell);
			const source = getCellCode(cell.document);

			return {
				cell_type: summary.cell_type,
				id: summary.id,
				metadata: {
					language: summary.language
				},
				source,
			} satisfies SummaryCell;
		});

		const json: Notebook = { cells };
		const text = JSON.stringify(json, undefined, IndentSize);

		return new AlternativeJsonDocument(text, notebook);
	}

	public override getSummaryOfStructure(notebook: NotebookDocument, cellsToInclude: NotebookCell[], existingCodeMarker: string): string {
		const lines = ['{', '    "cells: ['];
		const existingCodeMarkerWithComment = `// ${existingCodeMarker}`;
		notebook.getCells().forEach((cell) => {
			if (cellsToInclude.includes(cell)) {
				const cellSummary = summarize(cell);
				if (cellSummary.source.length && cellSummary.source[0].trim().length) {
					cellSummary.source = [cellSummary.source[0], existingCodeMarkerWithComment];
				} else if (cellSummary.source.length && cellSummary.source.some(line => line.trim().length)) {
					cellSummary.source = [existingCodeMarkerWithComment, cellSummary.source.filter(line => line.trim().length)[0], existingCodeMarkerWithComment];
				} else {
					cellSummary.source = [existingCodeMarkerWithComment];
				}
				const summary = JSON.stringify(cellSummary, undefined, IndentSize).split(/\r?\n/).map(line => `    ${line}`);
				lines.push(...summary);
				lines.push(',');
			} else if (!lines.length || lines[lines.length - 1] !== existingCodeMarkerWithComment) {
				lines.push(existingCodeMarkerWithComment);
			}
		});
		lines.push(`    ]`);
		lines.push(`}`);
		return lines.join(EOL);
	}

	private parseAlternateContentImpl(notebookOrUri: NotebookDocument | URI, inputStream: AsyncIterable<LineOfText>, token: CancellationToken): AsyncIterable<LineOfCellText> {
		return new AsyncIterableObject<LineOfCellText>(async (emitter) => {
			const cellIdMap = URI.isUri(notebookOrUri) ? new Map<string, NotebookCell>() : getCellIdMap(notebookOrUri);
			const cellIdsSeen = new Set<string>();
			let jsonText = '';
			let lastSeenOffset = -1;
			const cellInfo: { id?: string; index: number; kind: NotebookCellKind; source: string[]; uri?: Uri; language?: string; startOffset: number; endOffset: number } = {
				index: -1,
				startOffset: -1,
				endOffset: -1,
				kind: NotebookCellKind.Code,
				source: [],
			};
			const defaultLanguage = URI.isUri(notebookOrUri) ? 'python' : getDefaultLanguage(notebookOrUri);

			const emitCell = (endOffset: number) => {
				cellInfo.language = cellInfo.language || defaultLanguage;
				if (cellInfo.id && cellIdMap.get(cellInfo.id)?.document.languageId === cellInfo.language) {
					if (cellIdsSeen.has(cellInfo.id)) {
						cellInfo.id = '';
					} else {
						cellIdsSeen.add(cellInfo.id);
					}
				} else {
					cellInfo.id = '';
				}
				const cell = cellIdMap.get(cellInfo.id);
				cellInfo.uri = cell?.document.uri;
				cellInfo.kind = cell?.kind || (cellInfo.language === 'markdown' ? NotebookCellKind.Markup : NotebookCellKind.Code);

				emitter.emitOne({ index: cellInfo.index, type: 'start', kind: cellInfo.kind, language: cellInfo.language, uri: cellInfo.uri, id: cellInfo.id });
				cellInfo.source.forEach(cellLine => emitter.emitOne({ index: cellInfo.index, type: 'line', line: cellLine }));
				emitter.emitOne({ index: cellInfo.index, type: 'end' });
			};

			let finalOffset = 0;
			for await (const lineOfText of inputStream) {
				if (token.isCancellationRequested) {
					break;
				}
				const line = lineOfText.value;


				jsonText += line;

				visit(jsonText, {
					onObjectEnd(offset, _length, _startLine, _startCharacter) {
						finalOffset = offset;
					},
					onLiteralValue: (value, offset, _length, _startLine, _startCharacter, pathSupplier) => {
						if (lastSeenOffset >= offset) {
							return;
						}
						const segments = pathSupplier();
						if (segments.length < 2) {
							return;
						}
						if (segments.shift() !== 'cells') {
							return;
						}
						const cellIndex = segments.shift();
						if (typeof cellIndex !== 'number') {
							return;
						}

						const property = segments.shift()! as string;
						lastSeenOffset = offset;

						if (cellInfo.index !== -1 && cellInfo.index !== cellIndex) {
							emitCell(offset);

							cellInfo.startOffset = offset;
							cellInfo.id = undefined;
							cellInfo.kind = NotebookCellKind.Code;
							cellInfo.source = [];
							cellInfo.uri = undefined;
							cellInfo.language = undefined;
						}

						cellInfo.index = cellIndex;

						if (property === 'cell_type') {
							cellInfo.kind = value === 'code' ? NotebookCellKind.Code : NotebookCellKind.Markup;
							if (cellInfo.kind === NotebookCellKind.Markup) {
								cellInfo.language = 'markdown';
							}
						} else if (property === 'id') {
							cellInfo.id = value;
						} else if (property === 'metadata' && segments[0] === 'id') {
							cellInfo.id = value;
						} else if (property === 'metadata' && segments[0] === 'language') {
							cellInfo.language = value;
							if (cellInfo.language === 'markdown') {
								cellInfo.kind = NotebookCellKind.Markup;
							}
						} else if (property === 'source' && segments.length && typeof segments[0] === 'number') {
							if (segments[0] === 0) {
								cellInfo.startOffset = offset;
							}
							let code = typeof value === 'string' ? value : `${value || ''}`;
							if (code.endsWith('\n')) {
								code = code.substr(0, code.length - 1);
							}
							cellInfo.source.push(code);
						}
					}
				});
			}

			if (cellInfo.index !== -1) {
				emitCell(finalOffset);
			}
		});
	}
}

function getCellCode(document: TextDocument): string[] {
	if (document.lineCount === 0) {
		return [];
	}
	if (document.lineCount === 1) {
		return [document.lineAt(0).text];
	}
	const lineCount = document.lineCount;
	return new Array(lineCount).fill('').map((_, i) => document.lineAt(i).text);
}

type Notebook = {
	cells: SummaryCell[];
};

type SummaryCell = {
	cell_type: 'code' | 'markdown';
	source: string[];
	id: string;
	metadata: {
		language: string;
	};
};
