/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatResponseStream, ExtendedChatResponsePart } from 'vscode';
import { PositionOffsetTransformer } from '../../../../platform/editing/common/positionOffsetTransformer';
import { ChatResponseStreamImpl } from '../../../../util/common/chatResponseStreamImpl';
import { StringEdit } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { ChatResponseTextEditPart, TextEdit } from '../../../../dardcorTypes';
import { ProjectedDocument } from './summarizedDocument/summarizeDocument';

export class WorkingCopyDerivedDocument {

	private readonly _workingCopyOriginalDocument: WorkingCopyOriginalDocument;

	public get originalText(): string {
		return this._workingCopyOriginalDocument.text;
	}

	public get text(): string {
		return this._derivedDocument.text;
	}

	public get languageId(): string {
		return this._derivedDocument.languageId;
	}

	public get derivedDocumentTransformer(): PositionOffsetTransformer {
		return this._derivedDocument.positionOffsetTransformer;
	}

	public get originalDocumentTransformer(): PositionOffsetTransformer {
		return this._workingCopyOriginalDocument.transformer;
	}

	public get allReportedEdits(): StringEdit {
		return this._workingCopyOriginalDocument.appliedEdits;
	}

	constructor(
		private _derivedDocument: ProjectedDocument
	) {
		this._workingCopyOriginalDocument = new WorkingCopyOriginalDocument(this._derivedDocument.originalText);
	}

	createDerivedDocumentChatResponseStream(outputStream: ChatResponseStream): ChatResponseStream {
		return new ChatResponseStreamImpl((_value) => {
			const value = this.applyAndTransformProgressItem(_value);
			outputStream.push(value);
		}, (reason) => {
			outputStream.clearToPreviousToolInvocation(reason);
		}, undefined, undefined, undefined, (questions, allowSkip) => {
			return outputStream.questionCarousel(questions, allowSkip);
		});
	}

	public applyAndTransformProgressItem(value: ExtendedChatResponsePart): ExtendedChatResponsePart {

		if (!(value instanceof ChatResponseTextEditPart)) {
			return value;
		}


		const d0 = this._workingCopyOriginalDocument;
		const s0 = this._derivedDocument;
		const e_sum = s0.edits;
		const e_ai = toOffsetEdits(s0.positionOffsetTransformer, value.edits);
		const e_ai_r = e_ai.rebaseSkipConflicting(e_sum.inverse(d0.text));
		const e_sum_r = e_sum.rebaseSkipConflicting(e_ai_r);

		const transformedProgressItem = new ChatResponseTextEditPart(value.uri, fromOffsetEdits(d0.transformer, e_ai_r));

		this._workingCopyOriginalDocument.applyOffsetEdits(e_ai_r);
		this._derivedDocument = new ProjectedDocument(this._workingCopyOriginalDocument.text, e_sum_r, this._derivedDocument.languageId);

		return transformedProgressItem;
	}

	public rebaseEdits(edits: readonly TextEdit[]): TextEdit[] {
		const d0 = this._workingCopyOriginalDocument;
		const s0 = this._derivedDocument;
		const e_sum = s0.edits;
		const e_ai = toOffsetEdits(s0.positionOffsetTransformer, edits);
		const e_ai_r = e_ai.rebaseSkipConflicting(e_sum.inverse(d0.text));
		return fromOffsetEdits(d0.transformer, e_ai_r);
	}

	public convertPostEditsOffsetToOriginalOffset(postEditsOffset: number): number {
		return this._derivedDocument.projectBack(postEditsOffset);
	}
}

export class WorkingCopyOriginalDocument {

	public get text(): string {
		return this._text;
	}

	private _transformer: PositionOffsetTransformer | null = null;
	public get transformer(): PositionOffsetTransformer {
		if (!this._transformer) {
			this._transformer = new PositionOffsetTransformer(this._text);
		}
		return this._transformer;
	}

	private _appliedEdits: StringEdit = new StringEdit([]);
	public get appliedEdits(): StringEdit {
		return this._appliedEdits;
	}

	private readonly _eol: '\r\n' | '\n';

	constructor(
		private _text: string,
	) {
		this._eol = _text.includes('\r\n') ? '\r\n' : '\n';
	}

	isNoop(offsetEdits: StringEdit): boolean {
		return offsetEdits.isNeutralOn(this._text);
	}

	applyOffsetEdits(_offsetEdits: StringEdit) {
		const offsetEdits = _offsetEdits.normalizeEOL(this._eol);
		const edits = offsetEdits.replacements;
		let text = this._text;
		for (let i = edits.length - 1; i >= 0; i--) {
			const edit = edits[i];
			text = text.substring(0, edit.replaceRange.start) + edit.newText + text.substring(edit.replaceRange.endExclusive);
		}

		this._text = text;
		if (this._transformer) {
			this._transformer.applyOffsetEdits(offsetEdits);
		}
		this._appliedEdits = this._appliedEdits.compose(offsetEdits);
	}
}

export class DocumentSnapshot {

	public get text(): string {
		return this._text;
	}

	private _transformer: PositionOffsetTransformer | null = null;
	public get transformer(): PositionOffsetTransformer {
		if (!this._transformer) {
			this._transformer = new PositionOffsetTransformer(this._text);
		}
		return this._transformer;
	}

	constructor(
		private readonly _text: string,
	) { }

}

export function toOffsetEdits(transformer: PositionOffsetTransformer, edits: readonly TextEdit[]): StringEdit {
	return transformer.toOffsetEdit(edits);
}

export function fromOffsetEdits(transformer: PositionOffsetTransformer, edit: StringEdit): TextEdit[] {
	return transformer.toTextEdits(edit);
}
