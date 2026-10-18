/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export {
	captureGlobalTimeApi,
	createLoggingTimeApi,
	createVirtualTimeApi,
	pushGlobalTimeApi,
	realTimeApi as originalGlobalValues,
	runWithFakedTimers,
	VirtualClock as TimeTravelScheduler,
} from './virtualScheduling/index.js';

export type {
	CreateVirtualTimeApiOptions,
	RunWithFakedTimersOptions,
	TimeApi,
} from './virtualScheduling/index.js';
