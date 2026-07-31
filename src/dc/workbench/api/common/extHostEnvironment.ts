import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtHostEnvironment {
	readonly appName: string;
	readonly appRoot: string;
	readonly language: string;
	readonly machineId: string;
	readonly sessionId: string;
	readonly isNewAppInstall: boolean;
	readonly isTelemetryEnabled: boolean;
	readonly shell: string;
	readonly uiKind: number;
}

export class ExtHostEnvironment implements IExtHostEnvironment {
	readonly appName = 'Dardcor Code';
	readonly appRoot = '';
	readonly language = 'en';
	readonly machineId = 'unknown';
	readonly sessionId = 'unknown';
	readonly isNewAppInstall = false;
	readonly isTelemetryEnabled = false;
	readonly shell = '';
	readonly uiKind = 1; // 1 = Desktop, 2 = Web

	constructor(initData?: any) {
		if (initData) {
			Object.assign(this, initData);
		}
	}
}
