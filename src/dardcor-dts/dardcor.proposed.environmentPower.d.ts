/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export namespace env {

		export namespace power {


			export const onDidSuspend: Event<void>;

			export const onDidResume: Event<void>;

			export const onDidChangeOnBatteryPower: Event<boolean>;

			export const onDidChangeThermalState: Event<ThermalState>;

			export const onDidChangeSpeedLimit: Event<number>;

			export const onWillShutdown: Event<void>;

			export const onDidLockScreen: Event<void>;

			export const onDidUnlockScreen: Event<void>;


			export function getSystemIdleState(idleThresholdSeconds: number): Thenable<SystemIdleState>;

			export function getSystemIdleTime(): Thenable<number>;

			export function getCurrentThermalState(): Thenable<ThermalState>;

			export function isOnBatteryPower(): Thenable<boolean>;


			export function startPowerSaveBlocker(type: PowerSaveBlockerType): Thenable<PowerSaveBlocker>;


			export type SystemIdleState = 'active' | 'idle' | 'locked' | 'unknown';

			export type ThermalState = 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';

			export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

			export interface PowerSaveBlocker extends Disposable {
				readonly id: number;

				readonly isStarted: boolean;
			}
		}
	}
}
