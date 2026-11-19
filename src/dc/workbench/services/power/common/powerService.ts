/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type SystemIdleState = 'active' | 'idle' | 'locked' | 'unknown';

export type ThermalState = 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';

export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

export const IPowerService = createDecorator<IPowerService>('powerService');

export interface IPowerService {

	readonly _serviceBrand: undefined;

	readonly onDidSuspend: Event<void>;
	readonly onDidResume: Event<void>;
	readonly onDidChangeOnBatteryPower: Event<boolean>;
	readonly onDidChangeThermalState: Event<ThermalState>;
	readonly onDidChangeSpeedLimit: Event<number>;
	readonly onWillShutdown: Event<void>;
	readonly onDidLockScreen: Event<void>;
	readonly onDidUnlockScreen: Event<void>;

	getSystemIdleState(idleThreshold: number): Promise<SystemIdleState>;
	getSystemIdleTime(): Promise<number>;
	getCurrentThermalState(): Promise<ThermalState>;
	isOnBatteryPower(): Promise<boolean>;
	startPowerSaveBlocker(type: PowerSaveBlockerType): Promise<number>;
	stopPowerSaveBlocker(id: number): Promise<boolean>;
	isPowerSaveBlockerStarted(id: number): Promise<boolean>;
}
