/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface NewWorkerMessage {
	type: '_newWorker';
	id: string;
	port: any ;
	url: string;
	options: any | undefined;
}

export interface TerminateWorkerMessage {
	type: '_terminateWorker';
	id: string;
}
