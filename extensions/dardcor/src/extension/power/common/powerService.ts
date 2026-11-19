/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../util/dardcor/base/common/event';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { createDecorator } from '../../../util/dardcor/platform/instantiation/common/instantiation';

export const IPowerService = createDecorator<IPowerService>('IPowerService');

export interface IPowerService {
	readonly _serviceBrand: undefined;

	readonly onDidSuspend: Event<void>;

	readonly onDidResume: Event<void>;

	acquirePowerSaveBlocker(): IDisposable;
}

export class NullPowerService implements IPowerService {
	declare readonly _serviceBrand: undefined;

	readonly onDidSuspend = Event.None;
	readonly onDidResume = Event.None;

	acquirePowerSaveBlocker(): IDisposable {
		return { dispose: () => { } };
	}
}
