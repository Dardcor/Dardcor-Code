/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentId } from '../../../platform/inlineEdits/common/dataTypes/documentId';
import { DuplicateAdditionsMode } from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { ResponseProcessor } from '../../../platform/inlineEdits/common/responseProcessor';
import { NoNextEditReason, StreamedEdit } from '../../../platform/inlineEdits/common/statelessNextEditProvider';
import { ILogger } from '../../../platform/log/common/logService';
import { ErrorUtils } from '../../../util/common/errors';
import { equals as arraysEqual } from '../../../util/dardcor/base/common/arrays';
import { isAbsolute } from '../../../util/dardcor/base/common/path';
import { URI } from '../../../util/dardcor/base/common/uri';
import { LineReplacement } from '../../../util/dardcor/editor/common/core/edits/lineEdit';
import { DefaultLinesDiffComputer } from '../../../util/dardcor/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer';
import { LineRange } from '../../../util/dardcor/editor/common/core/ranges/lineRange';
import { OffsetRange } from '../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { AbstractText } from '../../../util/dardcor/editor/common/core/text/abstractText';
import { FetchStreamError } from '../common/fetchStreamError';
import { toUniquePath } from '../common/promptCraftingUtils';
import { ResponseTags } from '../common/tags';
import { CurrentDocument } from '../common/xtabCurrentDocument';

class Patch {
	public removedLines: string[] = [];
	public addedLines: string[] = [];

	public isProgressiveRevealEarlyEdit = false;

	private constructor(
		public readonly filePath: string,
		public readonly lineNumZeroBased: number,
		public readonly patchIndex: number,
	) { }

	public static ofLine(line: string, patchIndex: number): Patch | null {
		const match = line.match(/^(.+):(\d+)$/);
		if (!match) {
			return null;
		}
		const [, filename, lineNumber] = match;
		return new Patch(filename, parseInt(lineNumber, 10), patchIndex);
	}

	public static progressiveRevealParts(source: Patch): { early: Patch; continuation: Patch } {
		const early = new Patch(source.filePath, source.lineNumZeroBased, source.patchIndex);
		early.removedLines = [source.removedLines[0]];
		early.addedLines = [...source.addedLines];
		early.isProgressiveRevealEarlyEdit = true;

		const continuation = new Patch(source.filePath, source.lineNumZeroBased + 1, source.patchIndex);
		continuation.removedLines = source.removedLines.slice(1);
		return { early, continuation };
	}

	addLine(line: string): boolean {
		const contentLine = line.slice(1);
		if (line.startsWith('-')) {
			this.removedLines.push(contentLine);
			return true;
		}
		if (line.startsWith('+')) {
			this.addedLines.push(contentLine);
			return true;
		}
		return false;
	}

	public toString(): string {
		return [
			`${this.filePath}:${this.lineNumZeroBased}`,
			...this.removedLines.map(l => `-${l}`),
			...this.addedLines.map(l => `+${l}`),
		].join('\n');
	}
}

export interface DuplicateAdditionRemoval {
	readonly kind: 'suffix' | 'prefix' | 'middle';
	readonly newAdditions: string[];
	readonly removedLines: readonly string[];
}


function isMeaningfulLine(line: string): boolean {
	return line.trim().length > 1;
}

export function tryRemoveDuplicateAdditions(
	replacement: LineReplacement,
	currentText: AbstractText,
): DuplicateAdditionRemoval | undefined {
	const addedLines = replacement.newLines;
	if (addedLines.length === 0) {
		return undefined;
	}

	const followingStartLine1Based = replacement.lineRange.endLineNumberExclusive;
	const fileLineCount = currentText.lineRange.endLineNumberExclusive - 1;
	const followingEndLine1BasedExclusive = Math.min(
		fileLineCount + 1,
		followingStartLine1Based + addedLines.length,
	);
	const following: string[] = [];
	for (let l = followingStartLine1Based; l < followingEndLine1BasedExclusive; l++) {
		following.push(currentText.getLineAt(l));
	}
	if (following.length === 0) {
		return undefined;
	}

	for (let k = Math.min(addedLines.length, following.length); k >= 1; k--) {
		const tail = addedLines.slice(-k);
		if (!arraysEqual(tail, following.slice(0, k))) {
			continue;
		}
		return {
			kind: 'suffix',
			newAdditions: addedLines.slice(0, addedLines.length - k),
			removedLines: tail,
		};
	}

	if (addedLines[0] === following[0] && isMeaningfulLine(addedLines[0])) {
		return {
			kind: 'prefix',
			newAdditions: addedLines.slice(1),
			removedLines: addedLines.slice(0, 1),
		};
	}

	if (addedLines.length >= 3 && following.length >= 2 &&
		isMeaningfulLine(following[0]) && isMeaningfulLine(following[1])) {
		const a = following[0];
		const b = following[1];
		for (let start = 1; start < addedLines.length - 1; start++) {
			if (addedLines[start] !== a || addedLines[start + 1] !== b) {
				continue;
			}
			let k = 2;
			while (
				start + k < addedLines.length &&
				k < following.length &&
				addedLines[start + k] === following[k]
			) {
				k++;
			}
			return {
				kind: 'middle',
				newAdditions: [
					...addedLines.slice(0, start),
					...addedLines.slice(start + k),
				],
				removedLines: addedLines.slice(start, start + k),
			};
		}
	}

	return undefined;
}


type EditDecision =
	| { kind: 'emit'; lineReplacement: LineReplacement }
	| { kind: 'skip' }
	| { kind: 'skipAndStop' };

function applyDuplicatePolicy(
	edit: Patch,
	lineReplacement: LineReplacement,
	content: AbstractText,
	mode: Exclude<DuplicateAdditionsMode, DuplicateAdditionsMode.Off>,
	tracer: ILogger,
): EditDecision {
	const removal = tryRemoveDuplicateAdditions(lineReplacement, content);
	if (removal === undefined) {
		return { kind: 'emit', lineReplacement };
	}

	tracer.trace(`Detected duplicate addition(s) (kind=${removal.kind}, count=${removal.removedLines.length}, mode=${mode}) for edit at ${edit.filePath}:${edit.lineNumZeroBased}`);

	switch (mode) {
		case DuplicateAdditionsMode.DropPatch:
			return { kind: 'skip' };
		case DuplicateAdditionsMode.DropAllRemaining:
			return { kind: 'skipAndStop' };
		case DuplicateAdditionsMode.TrimDuplicate: {
			const newLines = removal.newAdditions;
			if (newLines.length === 0 && lineReplacement.lineRange.length === 0) {
				return { kind: 'skip' };
			}
			return { kind: 'emit', lineReplacement: new LineReplacement(lineReplacement.lineRange, newLines) };
		}
	}
}

function duplicateModePreservesRemovedRange(mode: DuplicateAdditionsMode): boolean {
	return mode === DuplicateAdditionsMode.Off || mode === DuplicateAdditionsMode.TrimDuplicate;
}

function allowsMultiLineProgressiveReveal(enableProgressiveGhostText: boolean, enableProgressiveGhostTextMultiLine: boolean, duplicateAdditionsMode: DuplicateAdditionsMode): boolean {
	return enableProgressiveGhostText && enableProgressiveGhostTextMultiLine && duplicateModePreservesRemovedRange(duplicateAdditionsMode);
}

function shouldApplyDuplicatePolicy(edit: Patch, isActiveDoc: boolean, duplicateAdditionsMode: DuplicateAdditionsMode): duplicateAdditionsMode is Exclude<DuplicateAdditionsMode, DuplicateAdditionsMode.Off> {
	return duplicateAdditionsMode !== DuplicateAdditionsMode.Off && isActiveDoc && !edit.isProgressiveRevealEarlyEdit;
}

function isEmptyCursorLineShiftUp(patch: Patch): boolean {
	if (patch.removedLines.length < 2 || patch.removedLines[0].trim() !== '') {
		return false;
	}
	const firstAddedLine = patch.addedLines[0];
	const nextRemovedLine = patch.removedLines[1];
	return firstAddedLine === nextRemovedLine || nextRemovedLine.startsWith(firstAddedLine);
}

export namespace XtabPatchResponseHandler {

	const SPLIT_DIFF_MAX_COMPUTATION_TIME_MS = 100;

	export function splitReplacement(replacement: LineReplacement, removedLines: readonly string[]): LineReplacement[] {
		const addedLines = replacement.newLines;
		if (removedLines.length === 0 || addedLines.length === 0) {
			return [replacement];
		}

		const diff = new DefaultLinesDiffComputer().computeDiff([...removedLines], [...addedLines], {
			ignoreTrimWhitespace: false,
			maxComputationTimeMs: SPLIT_DIFF_MAX_COMPUTATION_TIME_MS,
			computeMoves: false,
		});
		if (diff.hitTimeout || diff.changes.length <= 1) {
			return [replacement];
		}

		const baseLine = replacement.lineRange.startLineNumber;
		return diff.changes.map(change => new LineReplacement(
			new LineRange(
				baseLine + change.original.startLineNumber - 1,
				baseLine + change.original.endLineNumberExclusive - 1,
			),
			addedLines.slice(change.modified.startLineNumber - 1, change.modified.endLineNumberExclusive - 1),
		));
	}

	export async function* handleResponse(
		linesStream: AsyncIterable<string>,
		currentDocument: CurrentDocument,
		activeDocumentId: DocumentId,
		workspaceRoot: URI | undefined,
		window: OffsetRange | undefined,
		parentTracer: ILogger,
		duplicateAdditionsMode: DuplicateAdditionsMode = DuplicateAdditionsMode.Off,
		enableProgressiveGhostText: boolean = false,
		splitPatchOnDiff: boolean = false,
		enableProgressiveGhostTextMultiLine: boolean = false,
	): AsyncGenerator<StreamedEdit, NoNextEditReason, void> {
		const tracer = parentTracer.createSubLogger(['XtabCustomDiffPatchResponseHandler', 'handleResponse']);
		const activeDocRelativePath = toUniquePath(activeDocumentId, workspaceRoot?.path);

		try {
			let dropAllRemaining = false;
			const cursorLine = enableProgressiveGhostText ? currentDocument.cursorLineOffset : undefined;
			const progressiveDocPath = enableProgressiveGhostText ? activeDocRelativePath : undefined;
			const allowMultiLineRemoval = allowsMultiLineProgressiveReveal(enableProgressiveGhostText, enableProgressiveGhostTextMultiLine, duplicateAdditionsMode);
			for await (const edit of extractEdits(linesStream, cursorLine, progressiveDocPath, allowMultiLineRemoval)) {
				if (dropAllRemaining) {
					continue;
				}

				const isActiveDoc = edit.filePath === activeDocRelativePath;
				const targetDocument = isActiveDoc
					? activeDocumentId
					: resolveTargetDocument(edit.filePath, workspaceRoot);
				if (!targetDocument) {
					tracer.error(`Could not resolve target document for edit: ${edit.toString()}`);
					continue;
				}

				let lineReplacement = resolveEdit(edit);

				if (shouldApplyDuplicatePolicy(edit, isActiveDoc, duplicateAdditionsMode)) {
					const decision = applyDuplicatePolicy(edit, lineReplacement, currentDocument.content, duplicateAdditionsMode, tracer);
					switch (decision.kind) {
						case 'skip':
							continue;
						case 'skipAndStop':
							dropAllRemaining = true;
							continue;
						case 'emit':
							lineReplacement = decision.lineReplacement;
							break;
					}
				}

				const replacements = splitPatchOnDiff
					? splitReplacement(lineReplacement, edit.removedLines)
					: [lineReplacement];
				for (const replacement of replacements) {
					yield {
						edit: replacement,
						isFromCursorJump: false,
						targetDocument,
						window,
						patchIndex: edit.patchIndex,
					} satisfies StreamedEdit;
				}
			}
		} catch (e: unknown) {
			if (e instanceof FetchStreamError) {
				return e.reason;
			}
			const err = ErrorUtils.fromUnknown(e);
			return new NoNextEditReason.Unexpected(err);
		}

		return new NoNextEditReason.NoSuggestions(currentDocument.content, window, undefined);
	}

	function resolveEdit(patch: Patch): LineReplacement {
		return new LineReplacement(new LineRange(patch.lineNumZeroBased + 1, patch.lineNumZeroBased + 1 + patch.removedLines.length), patch.addedLines);
	}

	function resolveTargetDocument(filePath: string, workspaceRoot: URI | undefined): DocumentId | undefined {
		if (isAbsolute(filePath)) {
			return DocumentId.create(URI.file(filePath).toString());
		}
		if (workspaceRoot) {
			return DocumentId.create(URI.joinPath(workspaceRoot, filePath).toString());
		}
		return undefined;
	}

	export function isGhostTextPatch(patch: Patch, cursorLineZeroBased: number, activeDocRelativePath: string, allowMultiLineRemoval: boolean): boolean {
		if (patch.lineNumZeroBased !== cursorLineZeroBased || patch.filePath !== activeDocRelativePath) {
			return false;
		}
		const removedLinesQualify = allowMultiLineRemoval ? patch.removedLines.length >= 1 : patch.removedLines.length === 1;
		if (!removedLinesQualify || patch.addedLines.length < 1) {
			return false;
		}
		if (!ResponseProcessor.isAdditiveEdit(patch.removedLines[0], patch.addedLines[0])) {
			return false;
		}
		return !isEmptyCursorLineShiftUp(patch);
	}

	export async function* extractEdits(linesStream: AsyncIterable<string>, cursorLineZeroBased?: number, activeDocRelativePath?: string, allowMultiLineRemoval: boolean = false): AsyncGenerator<Patch> {
		let currentPatch: Patch | null = null;
		let isFirstPatch = true;

		let progressiveRevealDone = false;

		let nextPatchIndex = 0;
		const parseNextPatchHeader = (line: string): Patch | null => {
			const patch = Patch.ofLine(line, nextPatchIndex);
			if (patch !== null) {
				nextPatchIndex++;
			}
			return patch;
		};

		for await (const line of linesStream) {
			if (line.trim() === ResponseTags.NO_EDIT) {
				break;
			}
			if (currentPatch === null) {
				currentPatch = parseNextPatchHeader(line);
				continue;
			}
			if (currentPatch.addLine(line)) {
				if (isFirstPatch && !progressiveRevealDone
					&& cursorLineZeroBased !== undefined
					&& activeDocRelativePath !== undefined
					&& currentPatch.addedLines.length === 1
					&& currentPatch.removedLines.length >= 1
				) {
					if (isGhostTextPatch(currentPatch, cursorLineZeroBased, activeDocRelativePath, allowMultiLineRemoval)) {
						const { early, continuation } = Patch.progressiveRevealParts(currentPatch);
						yield early;
						currentPatch = continuation;
					}
					progressiveRevealDone = true;
				}
				continue;
			}
			if (currentPatch.removedLines.length > 0 || currentPatch.addedLines.length > 0) {
				yield currentPatch;
			}
			currentPatch = parseNextPatchHeader(line);
			isFirstPatch = false;
		}
		if (currentPatch && (currentPatch.removedLines.length > 0 || currentPatch.addedLines.length > 0)) {
			yield currentPatch;
		}
	}
}
