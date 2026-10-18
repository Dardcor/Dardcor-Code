/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type * as vscode from 'vscode';
import { CapturingToken } from '../../../../platform/requestLogger/common/capturingToken';
import type { TraceContext } from '../../../../platform/otel/common/otelService';
import { createServiceIdentifier } from '../../../../util/common/services';
import { Event } from '../../../../util/dardcor/base/common/event';
import type { ClaudeFolderInfo } from './claudeFolderInfo';
import type { ParsedClaudeModelId } from './claudeModelId';

export type UsageHandler = (usage: vscode.ChatResultUsage) => void;

export interface SessionState {
	modelId: ParsedClaudeModelId | undefined;
	permissionMode: PermissionMode;
	capturingToken: CapturingToken | undefined;
	folderInfo: ClaudeFolderInfo | undefined;
	usageHandler: UsageHandler | undefined;
	reasoningEffort: EffortLevel | undefined;
	traceContext: TraceContext | undefined;
	turnId: string | undefined;
}

export interface SessionStateChangeEvent {
	readonly sessionId: string;
	readonly modelId?: ParsedClaudeModelId;
	readonly permissionMode?: PermissionMode;
	readonly folderInfo?: ClaudeFolderInfo;
}

export interface IClaudeSessionStateService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeSessionState: Event<SessionStateChangeEvent>;

	getModelIdForSession(sessionId: string): ParsedClaudeModelId | undefined;

	setModelIdForSession(sessionId: string, modelId: ParsedClaudeModelId | undefined): void;

	getPermissionModeForSession(sessionId: string): PermissionMode;

	setPermissionModeForSession(sessionId: string, mode: PermissionMode): void;

	getCapturingTokenForSession(sessionId: string): CapturingToken | undefined;

	setCapturingTokenForSession(sessionId: string, token: CapturingToken | undefined): void;

	getFolderInfoForSession(sessionId: string): ClaudeFolderInfo | undefined;

	setFolderInfoForSession(sessionId: string, folderInfo: ClaudeFolderInfo): void;

	getUsageHandlerForSession(sessionId: string): UsageHandler | undefined;

	setUsageHandlerForSession(sessionId: string, handler: UsageHandler | undefined): void;

	getReasoningEffortForSession(sessionId: string): EffortLevel | undefined;

	setReasoningEffortForSession(sessionId: string, effort: EffortLevel | undefined): void;

	getTraceContextForSession(sessionId: string): TraceContext | undefined;

	setTraceContextForSession(sessionId: string, traceContext: TraceContext | undefined): void;

	getTurnIdForSession(sessionId: string): string | undefined;

	setTurnIdForSession(sessionId: string, turnId: string | undefined): void;
}

export const IClaudeSessionStateService = createServiceIdentifier<IClaudeSessionStateService>('IClaudeSessionStateService');
