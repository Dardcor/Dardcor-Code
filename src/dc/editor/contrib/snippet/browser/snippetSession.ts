/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { groupBy } from '../../../../base/common/arrays.js';
import { CharCode } from '../../../../base/common/charCode.js';
import { dispose } from '../../../../base/common/lifecycle.js';
import { getLeadingWhitespace } from '../../../../base/common/strings.js';
import './snippetSession.css';
import { IActiveCodeEditor } from '../../../browser/editorBrowser.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { EditOperation, ISingleEditOperation } from '../../../common/core/editOperation.js';
import { IPosition } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { Selection, SelectionDirection } from '../../../common/core/selection.js';
import { TextChange } from '../../../common/core/textChange.js';
import { ILanguageConfigurationService } from '../../../common/languages/languageConfigurationRegistry.js';
import { IIdentifiedSingleEditOperation, ITextModel, TrackedRangeStickiness } from '../../../common/model.js';
import { ModelDecorationOptions } from '../../../common/model/textModel.js';
import { OvertypingCapturer } from '../../suggest/browser/suggestOvertypingCapturer.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Choice, Marker, Placeholder, SnippetParser, Text, TextmateSnippet, Variable } from './snippetParser.js';
import { ClipboardBasedVariableResolver, CommentBasedVariableResolver, CompositeSnippetVariableResolver, ModelBasedVariableResolver, RandomBasedVariableResolver, SelectionBasedVariableResolver, TimeBasedVariableResolver, WorkspaceBasedVariableResolver } from './snippetVariables.js';
import { EditSources, TextModelEditSource } from '../../../common/textModelEditSource.js';

export class OneSnippet {

	private _placeholderDecorations?: Map<Placeholder, string>;
	private _placeholderGroups: Placeholder[][];
	private _offset: number = -1;
	_placeholderGroupsIdx: number;
	_nestingLevel: number = 1;

	private static readonly _decor = {
		active: ModelDecorationOptions.register({ description: 'snippet-placeholder-1', stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, className: 'snippet-placeholder' }),
		inactive: ModelDecorationOptions.register({ description: 'snippet-placeholder-2', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, className: 'snippet-placeholder' }),
		activeFinal: ModelDecorationOptions.register({ description: 'snippet-placeholder-3', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, className: 'finish-snippet-placeholder' }),
		inactiveFinal: ModelDecorationOptions.register({ description: 'snippet-placeholder-4', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, className: 'finish-snippet-placeholder' }),
	};

	constructor(
		private readonly _editor: IActiveCodeEditor,
		private readonly _snippet: TextmateSnippet,
		private readonly _snippetLineLeadingWhitespace: string
	) {
		this._placeholderGroups = groupBy(_snippet.placeholders, Placeholder.compareByIndex);
		this._placeholderGroupsIdx = -1;
	}

	initialize(textChange: TextChange): void {
		this._offset = textChange.newPosition;
	}

	dispose(): void {
		if (this._placeholderDecorations) {
			this._editor.removeDecorations([...this._placeholderDecorations.values()]);
		}
		this._placeholderGroups.length = 0;
	}

	private _initDecorations(): void {

		if (this._offset === -1) {
			throw new Error(`Snippet not initialized!`);
		}

		if (this._placeholderDecorations) {
			return;
		}

		this._placeholderDecorations = new Map<Placeholder, string>();
		const model = this._editor.getModel();

		this._editor.changeDecorations(accessor => {
			for (const placeholder of this._snippet.placeholders) {
				const placeholderOffset = this._snippet.offset(placeholder);
				const placeholderLen = this._snippet.fullLen(placeholder);
				const range = Range.fromPositions(
					model.getPositionAt(this._offset + placeholderOffset),
					model.getPositionAt(this._offset + placeholderOffset + placeholderLen)
				);
				const options = placeholder.isFinalTabstop ? OneSnippet._decor.inactiveFinal : OneSnippet._decor.inactive;
				const handle = accessor.addDecoration(range, options);
				this._placeholderDecorations!.set(placeholder, handle);
			}
		});
	}

	move(fwd: boolean | undefined): Selection[] {
		if (!this._editor.hasModel()) {
			return [];
		}

		this._initDecorations();

		const model = this._editor.getModel();

		if (this._placeholderGroupsIdx >= 0) {
			const operations: ISingleEditOperation[] = [];

			for (const placeholder of this._placeholderGroups[this._placeholderGroupsIdx]) {
				if (placeholder.transform) {
					const id = this._placeholderDecorations!.get(placeholder);
					const range = id ? model.getDecorationRange(id) : null;
					if (range) {
						const currentValue = model.getValueInRange(range);
						const transformedValueLines = placeholder.transform.resolve(currentValue).split(/\r\n|\r|\n/);
						for (let i = 1; i < transformedValueLines.length; i++) {
							transformedValueLines[i] = model.normalizeIndentation(this._snippetLineLeadingWhitespace + transformedValueLines[i]);
						}
						operations.push(EditOperation.replace(range, transformedValueLines.join(model.getEOL())));
					}
				}
			}
			if (operations.length > 0) {
				this._editor.executeEdits('snippet.placeholderTransform', operations);
			}

		}

		let couldSkipThisPlaceholder = false;
		if (fwd === true && this._placeholderGroupsIdx < this._placeholderGroups.length - 1) {
			this._placeholderGroupsIdx += 1;
			couldSkipThisPlaceholder = true;

		} else if (fwd === false && this._placeholderGroupsIdx > 0) {
			this._placeholderGroupsIdx -= 1;
			couldSkipThisPlaceholder = true;

		} else {
		}

		const newSelections = model.changeDecorations(accessor => {

			const activePlaceholders = new Set<Placeholder>();

			const selections: Selection[] = [];
			for (const placeholder of this._placeholderGroups[this._placeholderGroupsIdx]) {
				const id = this._placeholderDecorations!.get(placeholder);
				const range = id ? model.getDecorationRange(id) : null;

				couldSkipThisPlaceholder = couldSkipThisPlaceholder && this._hasPlaceholderBeenCollapsed(placeholder);

				if (!id || !range) {
					continue;
				}
				selections.push(new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn));

				accessor.changeDecorationOptions(id, placeholder.isFinalTabstop ? OneSnippet._decor.activeFinal : OneSnippet._decor.active);
				activePlaceholders.add(placeholder);

				for (const enclosingPlaceholder of this._snippet.enclosingPlaceholders(placeholder)) {
					const id = this._placeholderDecorations!.get(enclosingPlaceholder);
					if (id) {
						accessor.changeDecorationOptions(id, enclosingPlaceholder.isFinalTabstop ? OneSnippet._decor.activeFinal : OneSnippet._decor.active);
						activePlaceholders.add(enclosingPlaceholder);
					}
				}
			}

			for (const [placeholder, id] of this._placeholderDecorations!) {
				if (!activePlaceholders.has(placeholder)) {
					accessor.changeDecorationOptions(id, placeholder.isFinalTabstop ? OneSnippet._decor.inactiveFinal : OneSnippet._decor.inactive);
				}
			}

			return selections;
		});

		return !couldSkipThisPlaceholder ? newSelections ?? [] : this.move(fwd);
	}

	private _hasPlaceholderBeenCollapsed(placeholder: Placeholder): boolean {
		const model = this._editor.getModel();
		let marker: Marker | undefined = placeholder;
		while (marker) {
			if (marker instanceof Placeholder) {
				const id = this._placeholderDecorations!.get(marker);
				const range = id ? model.getDecorationRange(id) : null;
				if ((!range || range.isEmpty()) && marker.toString().length > 0) {
					return true;
				}
			}
			marker = marker.parent;
		}
		return false;
	}

	get isAtFirstPlaceholder() {
		return this._placeholderGroupsIdx <= 0 || this._placeholderGroups.length === 0;
	}

	get isAtLastPlaceholder() {
		return this._placeholderGroupsIdx === this._placeholderGroups.length - 1;
	}

	get hasPlaceholder() {
		return this._snippet.placeholders.length > 0;
	}

	get isTrivialSnippet(): boolean {
		if (this._snippet.placeholders.length === 0) {
			return true;
		}
		if (this._snippet.placeholders.length === 1) {
			const [placeholder] = this._snippet.placeholders;
			if (placeholder.isFinalTabstop) {
				if (this._snippet.rightMostDescendant === placeholder) {
					return true;
				}
			}
		}
		return false;
	}

	computePossibleSelections() {
		const result = new Map<number, Range[]>();
		for (const placeholdersWithEqualIndex of this._placeholderGroups) {
			let ranges: Range[] | undefined;

			for (const placeholder of placeholdersWithEqualIndex) {
				if (placeholder.isFinalTabstop) {
					break;
				}

				if (!ranges) {
					ranges = [];
					result.set(placeholder.index, ranges);
				}

				const id = this._placeholderDecorations!.get(placeholder)!;
				const range = this._editor.getModel().getDecorationRange(id);
				if (!range) {
					result.delete(placeholder.index);
					break;
				}

				ranges.push(range);
			}
		}
		return result;
	}

	get activeChoice(): { choice: Choice; range: Range } | undefined {
		if (!this._placeholderDecorations) {
			return undefined;
		}
		const placeholder = this._placeholderGroups[this._placeholderGroupsIdx][0];
		if (!placeholder?.choice) {
			return undefined;
		}
		const id = this._placeholderDecorations.get(placeholder);
		if (!id) {
			return undefined;
		}
		const range = this._editor.getModel().getDecorationRange(id);
		if (!range) {
			return undefined;
		}
		return { range, choice: placeholder.choice };
	}

	get hasChoice(): boolean {
		let result = false;
		this._snippet.walk(marker => {
			result = marker instanceof Choice;
			return !result;
		});
		return result;
	}

	get activePlaceholderCount(): number {
		return this._placeholderGroupsIdx < 0 ? 0 : this._placeholderGroups[this._placeholderGroupsIdx].length;
	}

	merge(others: OneSnippet[]): void {

		const model = this._editor.getModel();
		this._nestingLevel *= 10;

		this._editor.changeDecorations(accessor => {

			for (const placeholder of this._placeholderGroups[this._placeholderGroupsIdx]) {
				const nested = others.shift()!;
				console.assert(nested._offset !== -1);
				console.assert(!nested._placeholderDecorations);

				const indexLastPlaceholder = nested._snippet.placeholderInfo.last!.index;

				for (const nestedPlaceholder of nested._snippet.placeholderInfo.all) {
					if (nestedPlaceholder.isFinalTabstop) {
						nestedPlaceholder.index = placeholder.index + ((indexLastPlaceholder + 1) / this._nestingLevel);
					} else {
						nestedPlaceholder.index = placeholder.index + (nestedPlaceholder.index / this._nestingLevel);
					}
				}
				this._snippet.replace(placeholder, nested._snippet.children);

				const id = this._placeholderDecorations!.get(placeholder)!;
				accessor.removeDecoration(id);
				this._placeholderDecorations!.delete(placeholder);

				for (const placeholder of nested._snippet.placeholders) {
					const placeholderOffset = nested._snippet.offset(placeholder);
					const placeholderLen = nested._snippet.fullLen(placeholder);
					const range = Range.fromPositions(
						model.getPositionAt(nested._offset + placeholderOffset),
						model.getPositionAt(nested._offset + placeholderOffset + placeholderLen)
					);
					const handle = accessor.addDecoration(range, OneSnippet._decor.inactive);
					this._placeholderDecorations!.set(placeholder, handle);
				}
			}

			this._renormalizePlaceholderIndices();

			this._placeholderGroups = groupBy(this._snippet.placeholders, Placeholder.compareByIndex);
		});
	}

	private _renormalizePlaceholderIndices(): void {
		const placeholders = this._snippet.placeholders;
		const uniqueIndices = new Set<number>();
		for (const placeholder of placeholders) {
			if (!placeholder.isFinalTabstop) {
				uniqueIndices.add(placeholder.index);
			}
		}
		const sorted = [...uniqueIndices].sort((a, b) => a - b);
		const remap = new Map<number, number>();
		for (let i = 0; i < sorted.length; i++) {
			remap.set(sorted[i], i + 1);
		}
		for (const placeholder of placeholders) {
			if (!placeholder.isFinalTabstop) {
				placeholder.index = remap.get(placeholder.index)!;
			}
		}
		this._nestingLevel = 1;
	}

	getEnclosingRange(): Range | undefined {
		let result: Range | undefined;
		const model = this._editor.getModel();
		for (const decorationId of this._placeholderDecorations!.values()) {
			const placeholderRange = model.getDecorationRange(decorationId) ?? undefined;
			if (!result) {
				result = placeholderRange;
			} else {
				result = result.plusRange(placeholderRange!);
			}
		}
		return result;
	}
}

export interface ISnippetSessionInsertOptions {
	overwriteBefore: number;
	overwriteAfter: number;
	adjustWhitespace: boolean;
	clipboardText: string | undefined;
	overtypingCapturer: OvertypingCapturer | undefined;
}

const _defaultOptions: ISnippetSessionInsertOptions = {
	overwriteBefore: 0,
	overwriteAfter: 0,
	adjustWhitespace: true,
	clipboardText: undefined,
	overtypingCapturer: undefined
};

export interface ISnippetEdit {
	range: Range;
	template: string;
	keepWhitespace?: boolean;
}

export class SnippetSession {

	static adjustWhitespace(model: ITextModel, position: IPosition, adjustIndentation: boolean, snippet: TextmateSnippet, filter?: Set<Marker>): string {
		const line = model.getLineContent(position.lineNumber);
		const lineLeadingWhitespace = getLeadingWhitespace(line, 0, position.column - 1);

		let snippetTextString: string | undefined;

		snippet.walk(marker => {
			if (!(marker instanceof Text) || marker.parent instanceof Choice) {
				return true;
			}

			if (filter && !filter.has(marker)) {
				return true;
			}

			const lines = marker.value.split(/\r\n|\r|\n/);

			if (adjustIndentation) {
				const offset = snippet.offset(marker);
				if (offset === 0) {
					lines[0] = model.normalizeIndentation(lines[0]);

				} else {
					snippetTextString = snippetTextString ?? snippet.toString();
					const prevChar = snippetTextString.charCodeAt(offset - 1);
					if (prevChar === CharCode.LineFeed || prevChar === CharCode.CarriageReturn) {
						lines[0] = model.normalizeIndentation(lineLeadingWhitespace + lines[0]);
					}
				}
				for (let i = 1; i < lines.length; i++) {
					lines[i] = model.normalizeIndentation(lineLeadingWhitespace + lines[i]);
				}
			}

			const newValue = lines.join(model.getEOL());
			if (newValue !== marker.value) {
				marker.parent.replace(marker, [new Text(newValue)]);
				snippetTextString = undefined;
			}
			return true;
		});

		return lineLeadingWhitespace;
	}

	static adjustSelection(model: ITextModel, selection: Selection, overwriteBefore: number, overwriteAfter: number): Selection {
		if (overwriteBefore !== 0 || overwriteAfter !== 0) {
			const { positionLineNumber, positionColumn } = selection;
			const positionColumnBefore = positionColumn - overwriteBefore;
			const positionColumnAfter = positionColumn + overwriteAfter;

			const range = model.validateRange({
				startLineNumber: positionLineNumber,
				startColumn: positionColumnBefore,
				endLineNumber: positionLineNumber,
				endColumn: positionColumnAfter
			});

			selection = Selection.createWithDirection(
				range.startLineNumber, range.startColumn,
				range.endLineNumber, range.endColumn,
				selection.getDirection()
			);
		}
		return selection;
	}

	static createEditsAndSnippetsFromSelections(editor: IActiveCodeEditor, template: string, overwriteBefore: number, overwriteAfter: number, enforceFinalTabstop: boolean, adjustWhitespace: boolean, clipboardText: string | undefined, overtypingCapturer: OvertypingCapturer | undefined, languageConfigurationService: ILanguageConfigurationService): { edits: IIdentifiedSingleEditOperation[]; snippets: OneSnippet[] } {
		const edits: IIdentifiedSingleEditOperation[] = [];
		const snippets: OneSnippet[] = [];

		if (!editor.hasModel()) {
			return { edits, snippets };
		}
		const model = editor.getModel();

		const workspaceService = editor.invokeWithinContext(accessor => accessor.get(IWorkspaceContextService));
		const modelBasedVariableResolver = editor.invokeWithinContext(accessor => new ModelBasedVariableResolver(accessor.get(ILabelService), model));
		const readClipboardText = () => clipboardText;

		const firstBeforeText = model.getValueInRange(SnippetSession.adjustSelection(model, editor.getSelection(), overwriteBefore, 0));
		const firstAfterText = model.getValueInRange(SnippetSession.adjustSelection(model, editor.getSelection(), 0, overwriteAfter));

		const firstLineFirstNonWhitespace = model.getLineFirstNonWhitespaceColumn(editor.getSelection().positionLineNumber);

		const indexedSelections = editor.getSelections()
			.map((selection, idx) => ({ selection, idx }))
			.sort((a, b) => Range.compareRangesUsingStarts(a.selection, b.selection));

		for (const { selection, idx } of indexedSelections) {

			let extensionBefore = SnippetSession.adjustSelection(model, selection, overwriteBefore, 0);
			let extensionAfter = SnippetSession.adjustSelection(model, selection, 0, overwriteAfter);
			if (firstBeforeText !== model.getValueInRange(extensionBefore)) {
				extensionBefore = selection;
			}
			if (firstAfterText !== model.getValueInRange(extensionAfter)) {
				extensionAfter = selection;
			}

			const snippetSelection = selection
				.setStartPosition(extensionBefore.startLineNumber, extensionBefore.startColumn)
				.setEndPosition(extensionAfter.endLineNumber, extensionAfter.endColumn);

			const snippet = new SnippetParser().parse(template, true, enforceFinalTabstop);

			const start = snippetSelection.getStartPosition();
			const snippetLineLeadingWhitespace = SnippetSession.adjustWhitespace(
				model, start,
				adjustWhitespace || (idx > 0 && firstLineFirstNonWhitespace !== model.getLineFirstNonWhitespaceColumn(selection.positionLineNumber)),
				snippet,
			);

			snippet.resolveVariables(new CompositeSnippetVariableResolver([
				modelBasedVariableResolver,
				new ClipboardBasedVariableResolver(readClipboardText, idx, indexedSelections.length, editor.getOption(EditorOption.multiCursorPaste) === 'spread'),
				new SelectionBasedVariableResolver(model, selection, idx, overtypingCapturer),
				new CommentBasedVariableResolver(model, selection, languageConfigurationService),
				new TimeBasedVariableResolver,
				new WorkspaceBasedVariableResolver(workspaceService),
				new RandomBasedVariableResolver,
			]));

			edits[idx] = EditOperation.replace(snippetSelection, snippet.toString());
			edits[idx].identifier = { major: idx, minor: 0 };
			edits[idx]._isTracked = true;
			snippets[idx] = new OneSnippet(editor, snippet, snippetLineLeadingWhitespace);
		}

		return { edits, snippets };
	}

	static createEditsAndSnippetsFromEdits(editor: IActiveCodeEditor, snippetEdits: ISnippetEdit[], enforceFinalTabstop: boolean, adjustWhitespace: boolean, clipboardText: string | undefined, overtypingCapturer: OvertypingCapturer | undefined, languageConfigurationService: ILanguageConfigurationService): { edits: IIdentifiedSingleEditOperation[]; snippets: OneSnippet[] } {

		if (!editor.hasModel() || snippetEdits.length === 0) {
			return { edits: [], snippets: [] };
		}

		const edits: IIdentifiedSingleEditOperation[] = [];
		const model = editor.getModel();

		const parser = new SnippetParser();
		const snippet = new TextmateSnippet();

		const modelBasedVariableResolver = editor.invokeWithinContext(accessor => new ModelBasedVariableResolver(accessor.get(ILabelService), model));
		const timeBasedVariableResolver = new TimeBasedVariableResolver;
		const workspaceBasedVariableResolver = new WorkspaceBasedVariableResolver(editor.invokeWithinContext(accessor => accessor.get(IWorkspaceContextService)));
		const randomBasedVariableResolver = new RandomBasedVariableResolver;
		const readClipboardText = () => clipboardText;
		const clipboardSpread = editor.getOption(EditorOption.multiCursorPaste) === 'spread';

		const indexedSnippetEdits = snippetEdits
			.map((edit, idx) => ({ edit, idx }))
			.sort((a, b) => Range.compareRangesUsingStarts(a.edit.range, b.edit.range));

		let offset = 0;
		for (let i = 0; i < indexedSnippetEdits.length; i++) {
			const { edit: { range, template, keepWhitespace }, idx } = indexedSnippetEdits[i];

			if (i > 0) {
				const lastRange = indexedSnippetEdits[i - 1].edit.range;
				const textRange = Range.fromPositions(lastRange.getEndPosition(), range.getStartPosition());
				const textNode = new Text(model.getValueInRange(textRange));
				snippet.appendChild(textNode);
				offset += textNode.value.length;
			}

			const preExistingVariables = new Set<Variable>();
			snippet.walk(marker => {
				if (marker instanceof Variable) {
					preExistingVariables.add(marker);
				}
				return true;
			});

			const newNodes = parser.parseFragment(template, snippet);
			SnippetSession.adjustWhitespace(model, range.getStartPosition(), keepWhitespace !== undefined ? !keepWhitespace : adjustWhitespace, snippet, new Set(newNodes));

			const editSelection = Selection.fromRange(range, SelectionDirection.LTR);
			const editResolver = new CompositeSnippetVariableResolver([
				modelBasedVariableResolver,
				new ClipboardBasedVariableResolver(readClipboardText, idx, indexedSnippetEdits.length, clipboardSpread),
				new SelectionBasedVariableResolver(model, editSelection, idx, overtypingCapturer),
				new CommentBasedVariableResolver(model, editSelection, languageConfigurationService),
				timeBasedVariableResolver,
				workspaceBasedVariableResolver,
				randomBasedVariableResolver,
			]);

			snippet.walk(marker => {
				if (marker instanceof Variable && !preExistingVariables.has(marker)) {
					marker.resolve(editResolver);
				}
				return true;
			});

			const snippetText = snippet.toString();
			const snippetFragmentText = snippetText.slice(offset);
			offset = snippetText.length;

			const edit: IIdentifiedSingleEditOperation = EditOperation.replace(range, snippetFragmentText);
			edit.identifier = { major: i, minor: 0 };
			edit._isTracked = true;
			edits.push(edit);
		}

		parser.ensureFinalTabstop(snippet, enforceFinalTabstop, true);

		return {
			edits,
			snippets: [new OneSnippet(editor, snippet, '')]
		};
	}

	private readonly _templateMerges: [number, number, string | ISnippetEdit[]][] = [];
	private _snippets: OneSnippet[] = [];

	constructor(
		private readonly _editor: IActiveCodeEditor,
		private readonly _template: string | ISnippetEdit[],
		private readonly _options: ISnippetSessionInsertOptions = _defaultOptions,
		@ILanguageConfigurationService private readonly _languageConfigurationService: ILanguageConfigurationService
	) { }

	dispose(): void {
		dispose(this._snippets);
	}

	_logInfo(): string {
		return `template="${this._template}", merged_templates="${this._templateMerges.join(' -> ')}"`;
	}

	insert(editReason?: TextModelEditSource): void {
		if (!this._editor.hasModel()) {
			return;
		}

		const { edits, snippets } = typeof this._template === 'string'
			? SnippetSession.createEditsAndSnippetsFromSelections(this._editor, this._template, this._options.overwriteBefore, this._options.overwriteAfter, false, this._options.adjustWhitespace, this._options.clipboardText, this._options.overtypingCapturer, this._languageConfigurationService)
			: SnippetSession.createEditsAndSnippetsFromEdits(this._editor, this._template, false, this._options.adjustWhitespace, this._options.clipboardText, this._options.overtypingCapturer, this._languageConfigurationService);

		this._snippets = snippets;

		this._editor.executeEdits(editReason ?? EditSources.snippet(), edits, _undoEdits => {
			const undoEdits = _undoEdits.filter(edit => !!edit.identifier);
			for (let idx = 0; idx < snippets.length; idx++) {
				snippets[idx].initialize(undoEdits[idx].textChange);
			}

			if (this._snippets[0].hasPlaceholder) {
				return this._move(true);
			} else {
				return undoEdits
					.map(edit => Selection.fromPositions(edit.range.getEndPosition()));
			}
		});
		this._editor.revealRange(this._editor.getSelections()[0]);
	}

	merge(template: string, options: ISnippetSessionInsertOptions = _defaultOptions): void {
		if (!this._editor.hasModel()) {
			return;
		}
		this._templateMerges.push([this._snippets[0]._nestingLevel, this._snippets[0]._placeholderGroupsIdx, template]);
		const { edits, snippets } = SnippetSession.createEditsAndSnippetsFromSelections(this._editor, template, options.overwriteBefore, options.overwriteAfter, true, options.adjustWhitespace, options.clipboardText, options.overtypingCapturer, this._languageConfigurationService);

		this._editor.executeEdits('snippet', edits, _undoEdits => {
			const undoEdits = _undoEdits.filter(edit => !!edit.identifier);
			for (let idx = 0; idx < snippets.length; idx++) {
				snippets[idx].initialize(undoEdits[idx].textChange);
			}

			const isTrivialSnippet = snippets[0].isTrivialSnippet;
			const canMergeSnippets = snippets.length === this._snippets.reduce((count, snippet) => count + snippet.activePlaceholderCount, 0);
			if (!isTrivialSnippet && canMergeSnippets) {
				for (const snippet of this._snippets) {
					snippet.merge(snippets);
				}
				console.assert(snippets.length === 0);
			}

			if (this._snippets[0].hasPlaceholder && !isTrivialSnippet && canMergeSnippets) {
				return this._move(undefined);
			} else {
				return undoEdits.map(edit => Selection.fromPositions(edit.range.getEndPosition()));
			}
		});
	}

	next(): void {
		const newSelections = this._move(true);
		if (newSelections.length > 0) {
			this._editor.setSelections(newSelections);
			this._editor.revealPositionInCenterIfOutsideViewport(newSelections[0].getPosition());
		}
	}

	prev(): void {
		const newSelections = this._move(false);
		if (newSelections.length > 0) {
			this._editor.setSelections(newSelections);
			this._editor.revealPositionInCenterIfOutsideViewport(newSelections[0].getPosition());
		}
	}

	private _move(fwd: boolean | undefined): Selection[] {
		const selections: Selection[] = [];
		for (const snippet of this._snippets) {
			const oneSelection = snippet.move(fwd);
			selections.push(...oneSelection);
		}
		return selections;
	}

	get isAtFirstPlaceholder() {
		return this._snippets[0].isAtFirstPlaceholder;
	}

	get isAtLastPlaceholder() {
		return this._snippets[0].isAtLastPlaceholder;
	}

	get hasPlaceholder() {
		return this._snippets[0].hasPlaceholder;
	}

	get hasChoice(): boolean {
		return this._snippets[0].hasChoice;
	}

	get activeChoice(): { choice: Choice; range: Range } | undefined {
		return this._snippets[0].activeChoice;
	}

	isSelectionWithinPlaceholders(): boolean {

		if (!this.hasPlaceholder) {
			return false;
		}

		const selections = this._editor.getSelections();
		if (selections.length < this._snippets.length) {
			return false;
		}

		const allPossibleSelections = new Map<number, Range[]>();
		for (const snippet of this._snippets) {

			const possibleSelections = snippet.computePossibleSelections();

			if (allPossibleSelections.size === 0) {
				for (const [index, ranges] of possibleSelections) {
					ranges.sort(Range.compareRangesUsingStarts);
					for (const selection of selections) {
						if (ranges[0].containsRange(selection)) {
							allPossibleSelections.set(index, []);
							break;
						}
					}
				}
			}

			if (allPossibleSelections.size === 0) {
				return false;
			}

			allPossibleSelections.forEach((array, index) => {
				array.push(...possibleSelections.get(index)!);
			});
		}

		selections.sort(Range.compareRangesUsingStarts);

		for (const [index, ranges] of allPossibleSelections) {
			if (ranges.length !== selections.length) {
				allPossibleSelections.delete(index);
				continue;
			}

			ranges.sort(Range.compareRangesUsingStarts);

			for (let i = 0; i < ranges.length; i++) {
				if (!ranges[i].containsRange(selections[i])) {
					allPossibleSelections.delete(index);
					continue;
				}
			}
		}

		return allPossibleSelections.size > 0;
	}

	public getEnclosingRange(): Range | undefined {
		let result: Range | undefined;
		for (const snippet of this._snippets) {
			const snippetRange = snippet.getEnclosingRange();
			if (!result) {
				result = snippetRange;
			} else {
				result = result.plusRange(snippetRange!);
			}
		}
		return result;
	}
}
