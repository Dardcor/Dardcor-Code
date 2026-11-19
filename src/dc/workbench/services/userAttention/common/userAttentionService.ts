/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IUserAttentionService = createDecorator<IUserAttentionService>('userAttentionService');

export interface IUserAttentionService {
	readonly _serviceBrand: undefined;

	readonly isVsCodeFocused: IObservable<boolean>;

	readonly isUserActive: IObservable<boolean>;

	readonly hasUserAttention: IObservable<boolean>;

	readonly totalFocusTimeMs: number;

	fireAfterGivenFocusTimePassed(focusTimeMs: number, callback: () => void): IDisposable;
}
