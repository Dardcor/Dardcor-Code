/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';

export const CDPErrorCode = {
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
	ServerError: -32000,
} as const;

export class CDPError extends Error {
	constructor(
		message: string,
		readonly code: number
	) {
		super(message);
		this.name = 'CDPError';
	}
}

export class CDPMethodNotFoundError extends CDPError {
	constructor(method: string) {
		super(`Method not found: ${method}`, CDPErrorCode.MethodNotFound);
		this.name = 'CDPMethodNotFoundError';
	}
}

export class CDPInvalidParamsError extends CDPError {
	constructor(message: string) {
		super(message, CDPErrorCode.InvalidParams);
		this.name = 'CDPInvalidParamsError';
	}
}

export class CDPInternalError extends CDPError {
	constructor(message: string) {
		super(message, CDPErrorCode.InternalError);
		this.name = 'CDPInternalError';
	}
}

export class CDPServerError extends CDPError {
	constructor(message: string) {
		super(message, CDPErrorCode.ServerError);
		this.name = 'CDPServerError';
	}
}

export interface CDPRequest {
	id: number;
	method: string;
	params?: unknown;
	sessionId?: string;
}

export interface CDPResponse {
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
	sessionId?: string;
}

export interface CDPEvent {
	method: string;
	params: unknown;
	sessionId?: string;
}

export interface CDPTargetInfo {
	targetId: string;
	type: string;
	title: string;
	url: string;
	attached: boolean;
	canAccessOpener: boolean;
	browserContextId?: string;
}

export interface CDPBrowserVersion {
	protocolVersion: string;
	product: string;
	revision: string;
	userAgent: string;
	jsVersion: string;
}

export interface CDPWindowBounds {
	left: number;
	top: number;
	width: number;
	height: number;
	windowState: string;
}

export interface ICDPTarget extends IDisposable {
	targetInfo: CDPTargetInfo;
	readonly onTargetInfoChanged: Event<CDPTargetInfo>;

	attach(): Promise<ICDPConnection>;

	readonly sessions: ReadonlyMap<string, ICDPConnection>;
	readonly onSessionCreated: Event<{ session: ICDPConnection; waitingForDebugger: boolean }>;
	notifySessionCreated(session: ICDPConnection, waitingForDebugger: boolean): void;

	readonly onClose: Event<void>;
}

export interface ICDPBrowserTarget extends ICDPTarget {

	getVersion(): CDPBrowserVersion;
	getWindowForTarget(target: ICDPTarget): { windowId: number; bounds: CDPWindowBounds };
	createTarget(url: string, browserContextId?: string, windowId?: number): Promise<ICDPTarget>;
	activateTarget(target: ICDPTarget): Promise<void>;
	closeTarget(target: ICDPTarget): Promise<boolean>;

	getBrowserContexts(): string[];
	createBrowserContext(): Promise<string>;
	disposeBrowserContext(browserContextId: string): Promise<void>;
}

export interface ICDPConnection extends IDisposable {
	readonly parentSessionId?: string;
	readonly sessionId: string;
	readonly targetId: string;

	readonly onEvent: Event<CDPEvent>;
	readonly onClose: Event<void>;

	sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown>;
}
