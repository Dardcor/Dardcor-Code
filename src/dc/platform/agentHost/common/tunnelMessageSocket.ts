/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';

export interface ITunnelMessageSocket extends IDisposable {
	send(data: string): void;
	readonly onDidReceiveMessage: Event<string>;
	readonly onDidClose: Event<ITunnelSocketCloseEvent>;
	close(): void;
}

export interface ITunnelSocketCloseEvent {
	readonly code?: number;
	readonly reason?: string;
	readonly error?: Error;
}

export interface ITunnelDuplexStream {
	on(event: 'data', listener: (chunk: Uint8Array) => void): void;
	on(event: 'error', listener: (err: Error) => void): void;
	on(event: 'close', listener: (hadError?: boolean) => void): void;
	on(event: 'end', listener: () => void): void;
	removeListener(event: 'data', listener: (chunk: Uint8Array) => void): void;
	removeListener(event: 'error', listener: (err: Error) => void): void;
	removeListener(event: 'close', listener: (hadError?: boolean) => void): void;
	removeListener(event: 'end', listener: () => void): void;
	write(chunk: Uint8Array | string): boolean;
	end(): void;
	destroy(): void;
}
