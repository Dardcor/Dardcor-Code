/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable, observableValue } from '../../../base/common/observable.js';
import { Position } from '../../common/core/position.js';
import { Range } from '../../common/core/range.js';
import { ITextModel } from '../../common/model.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IRenameSymbolTrackerService = createDecorator<IRenameSymbolTrackerService>('renameSymbolTrackerService');

export interface ITrackedWord {
	readonly model: ITextModel;
	readonly originalWord: string;
	readonly originalPosition: Position;
	readonly originalRange: Range;
	readonly currentWord: string;
	readonly currentRange: Range;
}

export interface IRenameSymbolTrackerService {
	readonly _serviceBrand: undefined;

	readonly trackedWord: IObservable<ITrackedWord | undefined>;
}

export class NullRenameSymbolTrackerService implements IRenameSymbolTrackerService {
	declare readonly _serviceBrand: undefined;

	private readonly _trackedWord = observableValue<ITrackedWord | undefined>(this, undefined);
	public readonly trackedWord: IObservable<ITrackedWord | undefined> = this._trackedWord;
	constructor() {
		this._trackedWord.set(undefined, undefined);
	}
}
