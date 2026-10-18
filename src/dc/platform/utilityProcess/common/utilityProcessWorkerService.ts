/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IUtilityProcessWorkerProcess {

	readonly moduleId: string;

	readonly type: string;

	readonly name: string;

	readonly allowLoadingUnsignedLibraries?: boolean;
}

export interface IOnDidTerminateUtilityrocessWorkerProcess {

	readonly reason: IUtilityProcessWorkerProcessExit;
}

export interface IUtilityProcessWorkerProcessExit {

	readonly code?: number;

	readonly signal?: string;
}

export interface IUtilityProcessWorkerConfiguration {

	readonly process: IUtilityProcessWorkerProcess;

	readonly reply: {
		readonly windowId: number;
		readonly channel?: string;
		readonly nonce?: string;
	};
}

export interface IUtilityProcessWorkerCreateConfiguration extends IUtilityProcessWorkerConfiguration {
	readonly reply: {
		readonly windowId: number;
		readonly channel: string;
		readonly nonce: string;
	};
}

export const ipcUtilityProcessWorkerChannelName = 'utilityProcessWorker';

export interface IUtilityProcessWorkerService {

	readonly _serviceBrand: undefined;

	createWorker(configuration: IUtilityProcessWorkerCreateConfiguration): Promise<IOnDidTerminateUtilityrocessWorkerProcess>;

	disposeWorker(configuration: IUtilityProcessWorkerConfiguration): Promise<void>;
}
