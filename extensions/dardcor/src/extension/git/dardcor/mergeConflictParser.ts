/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const startHeaderMarker = '<<<<<<<';
const commonAncestorsMarker = '|||||||';
const splitterMarker = '=======';
const endFooterMarker = '>>>>>>>';

interface IScanMergedConflict {
	startHeader: vscode.TextLine;
	commonAncestors: vscode.TextLine[];
	splitter?: vscode.TextLine;
	endFooter?: vscode.TextLine;
}

export interface IDocumentMergeConflictDescriptor {
	range: vscode.Range;
	current: IMergeRegion;
	incoming: IMergeRegion;
	commonAncestors: IMergeRegion[];
	splitter: vscode.Range;
}

interface IMergeRegion {
	name: string;
	header: vscode.Range;
	content: vscode.Range;
	decoratorContent: vscode.Range;
}

export class MergeConflictParser {

	static scanDocument(document: vscode.TextDocument): IDocumentMergeConflictDescriptor[] {


		let currentConflict: IScanMergedConflict | null = null;
		const conflictDescriptors: IDocumentMergeConflictDescriptor[] = [];

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);

			if (!line || line.isEmptyOrWhitespace) {
				continue;
			}

			if (line.text.startsWith(startHeaderMarker)) {
				if (currentConflict !== null) {
					currentConflict = null;

					break;
				}

				currentConflict = { startHeader: line, commonAncestors: [] };
			}
			else if (currentConflict && !currentConflict.splitter && line.text.startsWith(commonAncestorsMarker)) {
				currentConflict.commonAncestors.push(line);
			}
			else if (currentConflict && !currentConflict.splitter && line.text === splitterMarker) {
				currentConflict.splitter = line;
			}
			else if (currentConflict && line.text.startsWith(endFooterMarker)) {
				currentConflict.endFooter = line;

				const completeDescriptor = MergeConflictParser.scanItemToMergeConflictDescriptor(document, currentConflict);

				if (completeDescriptor !== null) {
					conflictDescriptors.push(completeDescriptor);
				}

				currentConflict = null;
			}
		}

		return conflictDescriptors.filter(Boolean);
	}

	static containsConflict(document: vscode.TextDocument): boolean {
		if (!document) {
			return false;
		}

		const text = document.getText();
		return text.includes(startHeaderMarker) && text.includes(endFooterMarker);
	}

	private static scanItemToMergeConflictDescriptor(document: vscode.TextDocument, scanned: IScanMergedConflict): IDocumentMergeConflictDescriptor | null {
		if (!scanned.startHeader || !scanned.splitter || !scanned.endFooter) {
			return null;
		}

		const tokenAfterCurrentBlock: vscode.TextLine = scanned.commonAncestors[0] || scanned.splitter;

		return {
			current: {
				header: scanned.startHeader.range,
				decoratorContent: new vscode.Range(
					scanned.startHeader.rangeIncludingLineBreak.end,
					MergeConflictParser.shiftBackOneCharacter(document, tokenAfterCurrentBlock.range.start, scanned.startHeader.rangeIncludingLineBreak.end)),
				content: new vscode.Range(
					scanned.startHeader.rangeIncludingLineBreak.end,
					tokenAfterCurrentBlock.range.start),
				name: scanned.startHeader.text.substring(startHeaderMarker.length + 1)
			},
			commonAncestors: scanned.commonAncestors.map((currentTokenLine, index, commonAncestors) => {
				const nextTokenLine = commonAncestors[index + 1] || scanned.splitter;
				return {
					header: currentTokenLine.range,
					decoratorContent: new vscode.Range(
						currentTokenLine.rangeIncludingLineBreak.end,
						MergeConflictParser.shiftBackOneCharacter(document, nextTokenLine.range.start, currentTokenLine.rangeIncludingLineBreak.end)),
					content: new vscode.Range(
						currentTokenLine.rangeIncludingLineBreak.end,
						nextTokenLine.range.start),
					name: currentTokenLine.text.substring(commonAncestorsMarker.length + 1)
				};
			}),
			splitter: scanned.splitter.range,
			incoming: {
				header: scanned.endFooter.range,
				decoratorContent: new vscode.Range(
					scanned.splitter.rangeIncludingLineBreak.end,
					MergeConflictParser.shiftBackOneCharacter(document, scanned.endFooter.range.start, scanned.splitter.rangeIncludingLineBreak.end)),
				content: new vscode.Range(
					scanned.splitter.rangeIncludingLineBreak.end,
					scanned.endFooter.range.start),
				name: scanned.endFooter.text.substring(endFooterMarker.length + 1)
			},
			range: new vscode.Range(scanned.startHeader.range.start, scanned.endFooter.rangeIncludingLineBreak.end)
		};
	}

	private static shiftBackOneCharacter(document: vscode.TextDocument, range: vscode.Position, unlessEqual: vscode.Position): vscode.Position {
		if (range.isEqual(unlessEqual)) {
			return range;
		}

		let line = range.line;
		let character = range.character - 1;

		if (character < 0) {
			line--;
			character = document.lineAt(line).range.end.character;
		}

		return new vscode.Position(line, character);
	}
}
