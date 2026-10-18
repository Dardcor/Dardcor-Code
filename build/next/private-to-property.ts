/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';
import { type RawSourceMap, type Mapping, SourceMapConsumer, SourceMapGenerator } from 'source-map';



























const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function generateShortName(index: number): string {
	let name = '';
	do {
		name = CHARS[index % CHARS.length] + name;
		index = Math.floor(index / CHARS.length) - 1;
	} while (index >= 0);
	return '$' + name;
}

interface Edit {
	start: number;
	end: number;
	newText: string;
}

type ClassScope = Map<string, string>;

export interface TextEdit {
	readonly start: number;
	readonly end: number;
	readonly newText: string;
}

export interface ConvertPrivateFieldsResult {
	readonly code: string;
	readonly classCount: number;
	readonly fieldCount: number;
	readonly editCount: number;
	readonly elapsed: number;
	readonly edits: readonly TextEdit[];
}

export function convertPrivateFields(code: string, filename: string): ConvertPrivateFieldsResult {
	const t1 = Date.now();
	if (!code.includes('#')) {
		return { code, classCount: 0, fieldCount: 0, editCount: 0, elapsed: Date.now() - t1, edits: [] };
	}

	const sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);

	let nameCounter = 0;
	let fieldCount = 0;
	let classCount = 0;

	const edits: Edit[] = [];

	const classStack: ClassScope[] = [];

	visit(sourceFile);

	if (edits.length === 0) {
		return { code, classCount: 0, fieldCount: 0, editCount: 0, elapsed: Date.now() - t1, edits: [] };
	}

	edits.sort((a, b) => a.start - b.start);
	const parts: string[] = [];
	let lastEnd = 0;
	for (const edit of edits) {
		parts.push(code.substring(lastEnd, edit.start));
		parts.push(edit.newText);
		lastEnd = edit.end;
	}
	parts.push(code.substring(lastEnd));
	return { code: parts.join(''), classCount, fieldCount: fieldCount, editCount: edits.length, elapsed: Date.now() - t1, edits };


	function visit(node: ts.Node): void {
		if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
			visitClass(node);
			return;
		}
		ts.forEachChild(node, visit);
	}

	function visitClass(node: ts.ClassDeclaration | ts.ClassExpression): void {
		const publicNames = new Set<string>();
		for (const member of node.members) {
			if (!member.name) {
				continue;
			}
			if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
				publicNames.add(member.name.text);
				continue;
			}
			if (ts.isComputedPropertyName(member.name) && ts.isStringLiteral(member.name.expression)) {
				publicNames.add(member.name.expression.text);
			}
		}

		const scope: ClassScope = new Map();
		for (const member of node.members) {
			if (member.name && ts.isPrivateIdentifier(member.name)) {
				const name = member.name.text;
				if (!scope.has(name)) {
					let shortName: string;
					do {
						shortName = generateShortName(nameCounter++);
					} while (publicNames.has(shortName));
					scope.set(name, shortName);
					fieldCount++;
				}
			}
		}

		if (scope.size > 0) {
			classCount++;
		}

		const walkInClass = createWalkInClass(node);
		for (const clause of node.heritageClauses ?? []) {
			ts.forEachChild(clause, walkInClass);
		}

		classStack.push(scope);
		for (const member of node.members) {
			ts.forEachChild(member, walkInClass);
		}
		classStack.pop();
	}

	function createWalkInClass(classNode: ts.ClassDeclaration | ts.ClassExpression) {
		return function walkInClass(child: ts.Node): void {
			if ((ts.isClassDeclaration(child) || ts.isClassExpression(child)) && child !== classNode) {
				visitClass(child);
				return;
			}

			if (ts.isBinaryExpression(child) &&
				child.operatorToken.kind === ts.SyntaxKind.InKeyword &&
				ts.isPrivateIdentifier(child.left)) {
				const resolved = resolvePrivateName(child.left.text);
				if (resolved !== undefined) {
					edits.push({
						start: child.left.getStart(sourceFile),
						end: child.left.getEnd(),
						newText: `'${resolved}'`
					});
				}
				ts.forEachChild(child.right, walkInClass);
				return;
			}

			if (ts.isPrivateIdentifier(child)) {
				const resolved = resolvePrivateName(child.text);
				if (resolved !== undefined) {
					const start = child.getStart(sourceFile);
					edits.push({
						start,
						end: child.getEnd(),
						newText: (start > 0 && isIdentifierChar(code.charCodeAt(start - 1))) ? ' ' + resolved : resolved
					});
				}
				return;
			}

			ts.forEachChild(child, walkInClass);
		};
	}

	function resolvePrivateName(name: string): string | undefined {
		for (let i = classStack.length - 1; i >= 0; i--) {
			const resolved = classStack[i].get(name);
			if (resolved !== undefined) {
				return resolved;
			}
		}
		return undefined;
	}
}

function isIdentifierChar(ch: number): boolean {
	return (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90) || (ch >= 48 && ch <= 57) || ch === 95 || ch === 36;
}

export function adjustSourceMap(
	sourceMapJson: RawSourceMap,
	originalCode: string,
	edits: readonly TextEdit[]
): RawSourceMap {
	if (edits.length === 0) {
		return sourceMapJson;
	}


	const oldLineStarts = buildLineStarts(originalCode);
	const newLineStarts = buildLineStartsAfterEdits(originalCode, edits);

	const n = edits.length;
	const editStarts: number[] = new Array(n);
	const editEnds: number[] = new Array(n);
	const cumShifts: number[] = new Array(n);
	let cumShift = 0;
	for (let i = 0; i < n; i++) {
		editStarts[i] = edits[i].start;
		editEnds[i] = edits[i].end;
		cumShift += edits[i].newText.length - (edits[i].end - edits[i].start);
		cumShifts[i] = cumShift;
	}

	function adjustOffset(oldOff: number): number {
		let lo = 0, hi = n - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (editStarts[mid] <= oldOff) {
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (hi < 0) {
			return oldOff;
		}
		if (oldOff < editEnds[hi]) {
			const prevShift = hi > 0 ? cumShifts[hi - 1] : 0;
			return editStarts[hi] + prevShift;
		}
		return oldOff + cumShifts[hi];
	}

	function offsetToLineCol(lineStarts: readonly number[], offset: number): { line: number; col: number } {
		let lo = 0, hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= offset) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return { line: lo, col: offset - lineStarts[lo] };
	}

	const consumer = new SourceMapConsumer(sourceMapJson);
	const generator = new SourceMapGenerator({ file: sourceMapJson.file, sourceRoot: sourceMapJson.sourceRoot });

	for (let i = 0; i < sourceMapJson.sources.length; i++) {
		const content = sourceMapJson.sourcesContent?.[i];
		if (content !== null && content !== undefined) {
			generator.setSourceContent(sourceMapJson.sources[i], content);
		}
	}

	consumer.eachMapping(mapping => {
		const oldLine0 = mapping.generatedLine - 1;
		const oldOff = (oldLine0 < oldLineStarts.length
			? oldLineStarts[oldLine0]
			: oldLineStarts[oldLineStarts.length - 1]) + mapping.generatedColumn;

		const newOff = adjustOffset(oldOff);
		const newPos = offsetToLineCol(newLineStarts, newOff);

		if (mapping.source !== null && mapping.originalLine !== null && mapping.originalColumn !== null) {
			const newMapping: Mapping = {
				generated: { line: newPos.line + 1, column: newPos.col },
				original: { line: mapping.originalLine, column: mapping.originalColumn },
				source: mapping.source,
			};
			if (mapping.name !== null) {
				newMapping.name = mapping.name;
			}
			generator.addMapping(newMapping);
		} else {
			// eslint-disable-next-line local/code-no-dangerous-type-assertions
			generator.addMapping({
				generated: { line: newPos.line + 1, column: newPos.col },
			} as Mapping);
		}
	});

	return JSON.parse(generator.toString());
}

function buildLineStarts(text: string): number[] {
	const starts: number[] = [0];
	let pos = 0;
	while (true) {
		const nl = text.indexOf('\n', pos);
		if (nl === -1) {
			break;
		}
		starts.push(nl + 1);
		pos = nl + 1;
	}
	return starts;
}

function buildLineStartsAfterEdits(originalCode: string, edits: readonly TextEdit[]): number[] {
	const starts: number[] = [0];
	let oldPos = 0;
	let newPos = 0;

	for (const edit of edits) {
		let from = oldPos;
		while (true) {
			const nl = originalCode.indexOf('\n', from);
			if (nl === -1 || nl >= edit.start) {
				break;
			}
			starts.push(newPos + (nl - oldPos) + 1);
			from = nl + 1;
		}
		newPos += edit.start - oldPos;

		let replFrom = 0;
		while (true) {
			const nl = edit.newText.indexOf('\n', replFrom);
			if (nl === -1) {
				break;
			}
			starts.push(newPos + nl + 1);
			replFrom = nl + 1;
		}
		newPos += edit.newText.length;

		oldPos = edit.end;
	}

	let from = oldPos;
	while (true) {
		const nl = originalCode.indexOf('\n', from);
		if (nl === -1) {
			break;
		}
		starts.push(newPos + (nl - oldPos) + 1);
		from = nl + 1;
	}

	return starts;
}
