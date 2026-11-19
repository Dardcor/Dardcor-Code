/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertFn } from '../../../../util/dardcor/base/common/assert';
import { BaseEdit } from '../../../../util/dardcor/editor/common/core/edits/edit';
import { LineEdit } from '../../../../util/dardcor/editor/common/core/edits/lineEdit';
import { BaseStringEdit, BaseStringReplacement, StringEdit } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { StringText } from '../../../../util/dardcor/editor/common/core/text/abstractText';
import { deserializeStringEdit, SerializedEdit, serializeStringEdit } from './editUtils';
import { RootedLineEdit } from './rootedLineEdit';

export class RootedEdit<TEdit extends BaseStringEdit<BaseStringReplacement<any>, any> = StringEdit> {

	public static toLineEdit(edit: RootedEdit<BaseStringEdit<BaseStringReplacement<any>, any>>): LineEdit {
		return LineEdit.fromStringEdit(edit.edit as StringEdit, edit.base);
	}

	constructor(
		public readonly base: StringText,
		public readonly edit: TEdit,
	) { }

	public getEditedState(): StringText {
		return this.edit.applyOnText(this.base);
	}

	public rebase(onto: StringEdit): RootedEdit {
		const result: RootedEdit = null!;


		assertFn(() => result.base.equals(onto.applyOnText(this.base)));
		assertFn(() => result.edit.applyOnText(result.base).equals(this.edit.applyOnText(onto.applyOnText(this.base))));

		return result;
	}

	public toString(): string {
		const e = RootedLineEdit.fromEdit(this);
		return e.toString();
	}

	public normalize(): RootedEdit {
		return new RootedEdit(this.base, this.edit.normalizeOnSource(this.base.value));
	}

	public equals(other: RootedEdit): boolean {
		return this.base.equals(other.base) && this.edit.equals(other.edit);
	}
}

export type TReplacement<TEdit> = TEdit extends BaseEdit<infer TReplacement, any> ? TReplacement : never;

export class SingleEdits<TEdit extends BaseStringEdit<BaseStringReplacement<any>, any> = StringEdit> {
	constructor(
		public readonly edits: readonly TEdit['TReplacement'][],
	) { }

	compose(): StringEdit {
		return StringEdit.compose(this.edits.map(e => e.toEdit()));
	}

	apply(value: string): string {
		return this.compose().apply(value);
	}

	isEmpty(): boolean {
		return this.edits.length === 0;
	}

	toEdits(): Edits<StringEdit> {
		return new Edits(StringEdit, this.edits.map(e => e.toEdit()));
	}
}

export class Edits<T extends BaseStringEdit<BaseStringReplacement<any>, any> = StringEdit> {
	public static single(edit: StringEdit): Edits {
		return new Edits(StringEdit, [edit]);
	}

	constructor(
		private readonly _editType: new (replacements: readonly TReplacement<T>[]) => T,
		public readonly edits: readonly T[],
	) { }

	compose(): T {
		let edit = new this._editType([]);
		for (const e of this.edits) {
			edit = edit.compose(e);
		}
		return edit;
	}

	add(edit: T): Edits<T> {
		return new Edits(this._editType, [...this.edits, edit]);
	}

	apply(value: string): string {
		return this.compose().apply(value);
	}

	isEmpty(): boolean {
		return this.edits.length === 0;
	}

	swap(editFirst: StringEdit): { edits: Edits; editLast: StringEdit } | undefined {
		let eM = editFirst;
		const newEdits: StringEdit[] = [];
		for (const e of this.edits) {
			const e_ = BaseStringEdit.trySwap(eM, e);
			if (!e_) {
				return undefined;
			}
			newEdits.push(e_.e1);
			eM = e_.e2;
		}
		return { edits: new Edits(StringEdit, newEdits), editLast: eM };
	}


	serialize(): SerializedEdit[] {
		return this.edits.map(e => serializeStringEdit(e));
	}

	public static deserialize(v: SerializedEdit[]): Edits {
		return new Edits(StringEdit, v.map(e => deserializeStringEdit(e)));
	}

	toHumanReadablePatch(base: StringText): string {
		let curBase = base;
		const result: string[] = [];
		for (const edit of this.edits) {
			const lineEdit = RootedEdit.toLineEdit(new RootedEdit(curBase, edit));
			result.push(lineEdit.humanReadablePatch(curBase.getLines()));
			curBase = edit.applyOnText(curBase);
		}
		return result.join('\n---\n');
	}
}
