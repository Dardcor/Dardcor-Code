/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../../base/common/actions.js';
import { binarySearch } from '../../../../base/common/arrays.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IModelDeltaDecoration } from '../../../../editor/common/model.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITestMessage } from './testTypes.js';

export interface ITestingDecorationsService {
	_serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	invalidateResultMessage(message: ITestMessage): void;

	syncDecorations(resource: URI): Iterable<ITestDecoration> & {
		readonly size: number;
		getById(decorationId: string): ITestDecoration | undefined;
	};

	getDecoratedTestPosition(resource: URI, testId: string): Position | undefined;

	updateDecorationsAlternateAction(resource: URI, isAlt: boolean): void;
}

export interface ITestDecoration {
	readonly id: string;

	readonly line: number;

	readonly editorDecoration: IModelDeltaDecoration;

	getContextMenuActions(): { object: IAction[]; dispose(): void };
}

export class TestDecorations<T extends { id: string; line: number } = ITestDecoration> {
	public value: T[] = [];
	public push(value: T) {
		const searchIndex = binarySearch(this.value, value, (a, b) => a.line - b.line);
		this.value.splice(searchIndex < 0 ? ~searchIndex : searchIndex, 0, value);
	}

	public *lines(): Iterable<[number, T[]]> {
		if (!this.value.length) {
			return;
		}

		let startIndex = 0;
		let startLine = this.value[0].line;
		for (let i = 1; i < this.value.length; i++) {
			const v = this.value[i];
			if (v.line !== startLine) {
				yield [startLine, this.value.slice(startIndex, i)];
				startLine = v.line;
				startIndex = i;
			}
		}

		yield [startLine, this.value.slice(startIndex)];
	}
}

export const ITestingDecorationsService = createDecorator<ITestingDecorationsService>('testingDecorationService');

