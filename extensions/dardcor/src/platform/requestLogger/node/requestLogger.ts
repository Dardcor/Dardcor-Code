/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestMetadata } from '@vscode/copilot-api';
import { HTMLTracer, IChatEndpointInfo, RenderPromptResult } from '@vscode/prompt-tsx';
import { AsyncLocalStorage } from 'async_hooks';
import type { Event } from 'vscode';
import type { LanguageModelToolResult2 } from '../../../dardcorTypes';
import type { IModelAPIResponse } from '../../endpoint/common/endpointProvider';
import { CapturingToken } from '../common/capturingToken';
import { ILoggedPendingRequest, IRequestLogger, LoggedInfo, LoggedRequest, PendingLoggedChatRequest } from '../common/requestLogger';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IChatEndpoint } from '../../../platform/networking/common/networking';

const requestLogStorage = new AsyncLocalStorage<CapturingToken>();

const capturingTokenCorrelationMap = new Map<string, CapturingToken>();

export function getCurrentCapturingToken(): CapturingToken | undefined {
	return requestLogStorage.getStore();
}

export function storeCapturingTokenForCorrelation(correlationId: string): void {
	const token = requestLogStorage.getStore();
	if (token) {
		capturingTokenCorrelationMap.set(correlationId, token);
	}
}

export function retrieveCapturingTokenByCorrelation(correlationId: string): CapturingToken | undefined {
	const token = capturingTokenCorrelationMap.get(correlationId);
	if (token) {
		capturingTokenCorrelationMap.delete(correlationId);
	}
	return token;
}

export function runWithCapturingToken<T>(token: CapturingToken, fn: () => T): T {
	return requestLogStorage.run(token, fn);
}

export abstract class AbstractRequestLogger extends Disposable implements IRequestLogger {
	declare _serviceBrand: undefined;

	public get promptRendererTracing() {
		return false;
	}

	public captureInvocation<T>(request: CapturingToken, fn: () => Promise<T>): Promise<T> {
		return requestLogStorage.run(request, () => fn());
	}

	public abstract logModelListCall(id: string, requestMetadata: RequestMetadata, models: IModelAPIResponse[]): void;
	public abstract logToolCall(id: string, name: string | undefined, args: unknown, response: LanguageModelToolResult2): void;

	public logContentExclusionRules(_repos: string[], _rules: { patterns: string[]; ifAnyMatch: string[]; ifNoneMatch: string[] }[], _durationMs: number): void {
	}

	public logChatRequest(debugName: string, chatEndpoint: IChatEndpoint, chatParams: ILoggedPendingRequest): PendingLoggedChatRequest {
		return new PendingLoggedChatRequest(this, debugName, chatEndpoint, chatParams);
	}

	public abstract addPromptTrace(elementName: string, endpoint: IChatEndpointInfo, result: RenderPromptResult, trace: HTMLTracer): void;
	public abstract addEntry(entry: LoggedRequest): void;
	public abstract getRequests(): LoggedInfo[];
	public abstract getRequestById(id: string): LoggedInfo | undefined;
	abstract onDidChangeRequests: Event<void>;

	public enableWorkspaceEditTracing(): void {
	}

	public disableWorkspaceEditTracing(): void {
	}

	protected get currentRequest() {
		return requestLogStorage.getStore();
	}
}
