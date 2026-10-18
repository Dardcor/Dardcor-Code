/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { binarySearch2 } from '../../../../base/common/arrays.js';
import { StringEdit } from '../../core/edits/stringEdit.js';
import { OffsetRange } from '../../core/ranges/offsetRange.js';

export interface IAnnotation<T> {
	range: OffsetRange;
	annotation: T;
}

export interface IAnnotatedString<T> {
	setAnnotations(annotations: AnnotationsUpdate<T>): void;
	getAnnotationsIntersecting(range: OffsetRange): IAnnotation<T>[];
	getAllAnnotations(): IAnnotation<T>[];
	applyEdit(edit: StringEdit): IAnnotation<T>[];
	clone(): IAnnotatedString<T>;
}

export class AnnotatedString<T> implements IAnnotatedString<T> {

	private _annotations: IAnnotation<T>[] = [];

	constructor(annotations: IAnnotation<T>[] = []) {
		this._annotations = annotations;
	}

	public setAnnotations(annotations: AnnotationsUpdate<T>): void {
		for (const annotation of annotations.annotations) {
			const startIndex = this._getStartIndexOfIntersectingAnnotation(annotation.range.start);
			const endIndexExclusive = this._getEndIndexOfIntersectingAnnotation(annotation.range.endExclusive);
			if (annotation.annotation !== undefined) {
				this._annotations.splice(startIndex, endIndexExclusive - startIndex, { range: annotation.range, annotation: annotation.annotation });
			} else {
				this._annotations.splice(startIndex, endIndexExclusive - startIndex);
			}
		}
	}

	public getAnnotationsIntersecting(range: OffsetRange): IAnnotation<T>[] {
		const startIndex = this._getStartIndexOfIntersectingAnnotation(range.start);
		const endIndexExclusive = this._getEndIndexOfIntersectingAnnotation(range.endExclusive);
		return this._annotations.slice(startIndex, endIndexExclusive);
	}

	private _getStartIndexOfIntersectingAnnotation(offset: number): number {
		const startIndexWhereToReplace = binarySearch2(this._annotations.length, (index) => {
			return this._annotations[index].range.start - offset;
		});
		let startIndex: number;
		if (startIndexWhereToReplace >= 0) {
			startIndex = startIndexWhereToReplace;
			const nextCandidate = this._annotations[startIndex]?.range;
			if (nextCandidate && nextCandidate.endExclusive === offset) {
				startIndex--;
			}
		} else {
			const candidate = this._annotations[- (startIndexWhereToReplace + 2)]?.range;
			if (candidate && offset >= candidate.start && offset < candidate.endExclusive) {
				startIndex = - (startIndexWhereToReplace + 2);
			} else {
				startIndex = - (startIndexWhereToReplace + 1);
			}
		}
		return startIndex;
	}

	private _getEndIndexOfIntersectingAnnotation(offset: number): number {
		const endIndexWhereToReplace = binarySearch2(this._annotations.length, (index) => {
			return this._annotations[index].range.endExclusive - offset;
		});
		let endIndexExclusive: number;
		if (endIndexWhereToReplace >= 0) {
			endIndexExclusive = endIndexWhereToReplace + 1;
			const nextCandidate = this._annotations[endIndexExclusive]?.range;
			if (nextCandidate && nextCandidate.start === offset) {
				endIndexExclusive++;
			}
		} else {
			const candidate = this._annotations[-(endIndexWhereToReplace + 1)]?.range;
			if (candidate && offset >= candidate.start && offset <= candidate.endExclusive) {
				endIndexExclusive = - endIndexWhereToReplace;
			} else {
				endIndexExclusive = - (endIndexWhereToReplace + 1);
			}
		}
		return endIndexExclusive;
	}

	public getAllAnnotations(): IAnnotation<T>[] {
		return this._annotations.slice();
	}

	public applyEdit(edit: StringEdit): IAnnotation<T>[] {
		const annotations = this._annotations.slice();

		const finalAnnotations: IAnnotation<T>[] = [];
		const deletedAnnotations: IAnnotation<T>[] = [];

		let offset = 0;

		for (const e of edit.replacements) {
			while (true) {
				const annotation = annotations[0];
				if (!annotation) {
					break;
				}
				const range = annotation.range;
				if (range.endExclusive >= e.replaceRange.start) {
					break;
				}
				annotations.shift();
				const newAnnotation = { range: range.delta(offset), annotation: annotation.annotation };
				if (!newAnnotation.range.isEmpty) {
					finalAnnotations.push(newAnnotation);
				} else {
					deletedAnnotations.push(newAnnotation);
				}
			}

			const intersecting: IAnnotation<T>[] = [];
			while (true) {
				const annotation = annotations[0];
				if (!annotation) {
					break;
				}
				const range = annotation.range;
				if (!range.intersectsOrTouches(e.replaceRange)) {
					break;
				}
				annotations.shift();
				intersecting.push(annotation);
			}

			for (let i = intersecting.length - 1; i >= 0; i--) {
				const annotation = intersecting[i];
				let r = annotation.range;

				const shouldExtend = i === 0 && (e.replaceRange.endExclusive > r.start) && (e.replaceRange.start < r.endExclusive);
				const overlap = r.intersect(e.replaceRange)!.length;
				r = r.deltaEnd(-overlap + (shouldExtend ? e.newText.length : 0));

				const rangeAheadOfReplaceRange = r.start - e.replaceRange.start;
				if (rangeAheadOfReplaceRange > 0) {
					r = r.delta(-rangeAheadOfReplaceRange);
				}

				if (!shouldExtend && rangeAheadOfReplaceRange >= 0) {
					r = r.delta(e.newText.length);
				}

				r = r.delta(-(e.newText.length - e.replaceRange.length));

				annotations.unshift({ annotation: annotation.annotation, range: r });
			}

			offset += e.newText.length - e.replaceRange.length;
		}

		while (true) {
			const annotation = annotations[0];
			if (!annotation) {
				break;
			}
			annotations.shift();
			const newAnnotation = { annotation: annotation.annotation, range: annotation.range.delta(offset) };
			if (!newAnnotation.range.isEmpty) {
				finalAnnotations.push(newAnnotation);
			} else {
				deletedAnnotations.push(newAnnotation);
			}
		}
		this._annotations = finalAnnotations;
		return deletedAnnotations;
	}

	public clone(): IAnnotatedString<T> {
		return new AnnotatedString<T>(this._annotations.slice());
	}
}

export interface IAnnotationUpdate<T> {
	range: OffsetRange;
	annotation: T | undefined;
}

type DefinedValue = object | string | number | boolean;

export type ISerializedAnnotation<TSerializedProperty extends DefinedValue> = {
	range: { start: number; endExclusive: number };
	annotation: TSerializedProperty | undefined;
};

export class AnnotationsUpdate<T> {

	public static create<T>(annotations: IAnnotationUpdate<T>[]): AnnotationsUpdate<T> {
		return new AnnotationsUpdate(annotations);
	}

	private _annotations: IAnnotationUpdate<T>[];

	private constructor(annotations: IAnnotationUpdate<T>[]) {
		this._annotations = annotations;
	}

	get annotations(): IAnnotationUpdate<T>[] {
		return this._annotations;
	}

	public rebase(edit: StringEdit): void {
		const annotatedString = new AnnotatedString<T | undefined>(this._annotations);
		annotatedString.applyEdit(edit);
		this._annotations = annotatedString.getAllAnnotations();
	}

	public serialize<TSerializedProperty extends DefinedValue>(serializingFunc: (annotation: T) => TSerializedProperty): ISerializedAnnotation<TSerializedProperty>[] {
		return this._annotations.map(annotation => {
			const range = { start: annotation.range.start, endExclusive: annotation.range.endExclusive };
			if (!annotation.annotation) {
				return { range, annotation: undefined };
			}
			return { range, annotation: serializingFunc(annotation.annotation) };
		});
	}

	static deserialize<T, TSerializedProperty extends DefinedValue>(serializedAnnotations: ISerializedAnnotation<TSerializedProperty>[], deserializingFunc: (annotation: TSerializedProperty) => T): AnnotationsUpdate<T> {
		const annotations: IAnnotationUpdate<T>[] = serializedAnnotations.map(serializedAnnotation => {
			const range = new OffsetRange(serializedAnnotation.range.start, serializedAnnotation.range.endExclusive);
			if (!serializedAnnotation.annotation) {
				return { range, annotation: undefined };
			}
			return { range, annotation: deserializingFunc(serializedAnnotation.annotation) };
		});
		return new AnnotationsUpdate(annotations);
	}
}
