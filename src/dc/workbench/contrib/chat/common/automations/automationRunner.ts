/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { AutomationRunTrigger, IAutomationDescriptor, IAutomationRun } from './automation.js';

export const IAutomationRunner = createDecorator<IAutomationRunner>('automationRunner');

export type AutomationDispatchFailure =
	| 'deleted'
	| 'targetUnavailable'
	| 'cancelled'
	| 'error';

export type IAutomationRunDispatch =
	| { readonly kind: 'started'; readonly run: IAutomationRun; readonly sessionResource: URI }
	| { readonly kind: 'alreadyRunning'; readonly activeRun: IAutomationRun }
	| { readonly kind: 'notStarted'; readonly reason: AutomationDispatchFailure; readonly run?: IAutomationRun };

export interface IAutomationRunOperation {
	readonly whenDispatched: Promise<IAutomationRunDispatch>;

	readonly whenCompleted: Promise<void>;
}

export interface IAutomationRunner {
	readonly _serviceBrand: undefined;

	runOnce(
		automation: IAutomationDescriptor,
		trigger: AutomationRunTrigger,
		leaderWindowId: number,
		token?: CancellationToken,
	): IAutomationRunOperation;
}
