/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { decodeBase64 } from '../../../util/dardcor/base/common/buffer';
import { Event } from '../../../util/dardcor/base/common/event';
import { URI } from '../../../util/dardcor/base/common/uri';

export const IChatDebugFileLoggerService = createServiceIdentifier<IChatDebugFileLoggerService>('IChatDebugFileLoggerService');

export function sessionResourceToId(sessionResource: URI): string {
	const pathSegment = sessionResource.path.replace(/^\//, '').split('/').pop() || '';
	if (!pathSegment) {
		return pathSegment;
	}
	if (sessionResource.scheme === 'vscode-chat-session') {
		try {
			return new TextDecoder().decode(decodeBase64(pathSegment).buffer);
		} catch {
		}
	}
	return pathSegment;
}

export interface IChatDebugFileLoggerService {
	readonly _serviceBrand: undefined;

	startSession(sessionId: string): Promise<void>;

	startChildSession(childSessionId: string, parentSessionId: string, label: string, parentToolSpanId?: string): void;

	registerSpanSession(spanId: string, sessionId: string): void;

	endSession(sessionId: string): Promise<void>;

	flush(sessionId: string): Promise<void>;

	/**
	 * Get the URI of the debug logs directory, or undefined if it cannot be
	 * determined (e.g. no storage is available at all, or an error occurs).
	 * Resolves to workspace-scoped storage when a workspace/folder is open and
	 * only falls back to global storage when no workspace is open. The directory
	 * may not actually exist on disk yet if no sessions have been started.
	 */
	readonly debugLogsDir: URI | undefined;

	getLogPath(sessionId: string): URI | undefined;

	getSessionDir(sessionId: string): URI | undefined;

	getActiveSessionIds(): string[];

	isDebugLogUri(uri: URI): boolean;

	getSessionDirForResource(sessionResource: URI): URI | undefined;

	setModelSnapshot(models: readonly unknown[]): void;

	readonly onDidEmitEntry: Event<{ sessionId: string; entry: IDebugLogEntry }>;

	readEntries(sessionId: string): Promise<IDebugLogEntry[]>;

	readTailEntries(sessionId: string, count: number): Promise<IDebugLogEntry[]>;

	streamEntries(sessionId: string, onEntry: (entry: IDebugLogEntry) => void): Promise<void>;

	listSessionIds(): Promise<string[]>;
}

export interface IDebugLogEntry {
	readonly v?: number;
	readonly rIdx?: number;
	readonly ts: number;
	readonly dur: number;
	readonly sid: string;
	readonly type: 'session_start' | 'tool_call' | 'llm_request' | 'user_message' | 'agent_response' | 'subagent' | 'discovery' | 'error' | 'generic' | 'child_session_ref' | 'hook' | 'turn_start' | 'turn_end';
	readonly name: string;
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly status: 'ok' | 'error';
	readonly attrs: Record<string, string | number | boolean | undefined>;
}

export class NullChatDebugFileLoggerService implements IChatDebugFileLoggerService {
	declare readonly _serviceBrand: undefined;

	async startSession(): Promise<void> { }
	startChildSession(): void { }
	registerSpanSession(): void { }
	async endSession(): Promise<void> { }
	async flush(): Promise<void> { }
	getLogPath(_sessionId?: string): URI | undefined { return undefined; }
	getSessionDir(_sessionId?: string): URI | undefined { return undefined; }
	getActiveSessionIds(): string[] { return []; }
	isDebugLogUri(): boolean { return false; }
	getSessionDirForResource(): URI | undefined { return undefined; }
	setModelSnapshot(): void { }
	readonly debugLogsDir: URI | undefined = undefined;
	readonly onDidEmitEntry: Event<{ sessionId: string; entry: IDebugLogEntry }> = Event.None;
	async readEntries(): Promise<IDebugLogEntry[]> { return []; }
	async readTailEntries(): Promise<IDebugLogEntry[]> { return []; }
	async streamEntries(): Promise<void> { }
	async listSessionIds(): Promise<string[]> { return []; }
}
