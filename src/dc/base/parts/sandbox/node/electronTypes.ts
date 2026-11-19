/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface MessagePortMain extends NodeJS.EventEmitter {


	on(event: 'close', listener: Function): this;
	off(event: 'close', listener: Function): this;
	once(event: 'close', listener: Function): this;
	addListener(event: 'close', listener: Function): this;
	removeListener(event: 'close', listener: Function): this;
	on(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	off(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	once(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	addListener(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	removeListener(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	close(): void;
	postMessage(message: unknown, transfer?: MessagePortMain[]): void;
	start(): void;
}

export interface MessageEvent {
	data: unknown;
	ports: MessagePortMain[];
}

export interface ParentPort extends NodeJS.EventEmitter {


	on(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	off(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	once(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	addListener(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	removeListener(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	postMessage(message: unknown): void;
}

export interface UtilityNodeJSProcess extends NodeJS.Process {

	parentPort: ParentPort;
}

export function isUtilityProcess(process: NodeJS.Process): process is UtilityNodeJSProcess {
	return !!(process as UtilityNodeJSProcess).parentPort;
}
