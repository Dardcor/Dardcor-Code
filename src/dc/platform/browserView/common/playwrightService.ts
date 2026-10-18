/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPlaywrightService = createDecorator<IPlaywrightService>('playwrightService');

export interface IInvokeFunctionResult {
	result?: unknown;
	error?: string;
	summary: string;
	deferredResultId?: string;
}

export interface IPlaywrightService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeTrackedPages: Event<readonly string[]>;

	startTrackingPage(viewId: string): Promise<void>;

	/** Waits for the exact BrowserView page to be mapped and its document to be usable. */
	waitForPageReady(sessionId: string, pageId: string, timeoutMs?: number): Promise<{ url: string; title: string; readyState: string }>;

	stopTrackingPage(viewId: string): Promise<void>;

	isPageTracked(viewId: string): Promise<boolean>;

	getTrackedPages(): Promise<readonly string[]>;

	openPage(sessionId: string, url: string): Promise<{ pageId: string; summary: string }>;

	getSummary(sessionId: string, pageId: string): Promise<string>;

	getAndClearDiagnostics(sessionId: string, pageId: string): Promise<readonly string[]>;

	invokeFunctionRaw<T>(sessionId: string, pageId: string, fnDef: string, ...args: unknown[]): Promise<T>;

	invokeFunction(sessionId: string, pageId: string, fnDef: string, args?: unknown[], timeoutMs?: number): Promise<IInvokeFunctionResult>;

	waitForDeferredResult(sessionId: string, deferredResultId: string, timeoutMs: number): Promise<IInvokeFunctionResult>;

	replyToFileChooser(sessionId: string, pageId: string, files: string[]): Promise<{ summary: string }>;

	replyToDialog(sessionId: string, pageId: string, accept: boolean, promptText?: string): Promise<{ summary: string }>;

	disposeSession(sessionId: string): Promise<void>;
}

export interface IPlaywrightPageGroup {
	addView(viewId: string): Promise<void>;
	removeView(viewId: string): Promise<void>;
}

export interface IPlaywrightTargetMatchCandidate {
	readonly viewId: string;
	readonly targetId?: string;
	readonly url: string;
}

function normalizePlaywrightTargetUrl(url: string): string {
	try {
		return new URL(url).href;
	} catch {
		return url.trim();
	}
}

export function matchPlaywrightTargetToView(
	targetId: string | undefined,
	pageUrl: string,
	viewCandidates: readonly IPlaywrightTargetMatchCandidate[],
	pageCandidates: readonly { targetId?: string; url: string }[],
): string | undefined {
	if (targetId) {
		return viewCandidates.find(candidate => candidate.targetId === targetId)?.viewId;
	}
	const normalizedUrl = normalizePlaywrightTargetUrl(pageUrl);
	const matchingViews = viewCandidates.filter(candidate => normalizePlaywrightTargetUrl(candidate.url) === normalizedUrl);
	const matchingPages = pageCandidates.filter(candidate => normalizePlaywrightTargetUrl(candidate.url) === normalizedUrl);
	return matchingViews.length === 1 && matchingPages.length === 1 ? matchingViews[0].viewId : undefined;
}

export function isBrowserDocumentReadyState(readyState: string): boolean {
	return readyState === 'interactive' || readyState === 'complete';
}

/** Resolves only after every browser group has attached the page, rolling back partial attachment on failure. */
export async function attachPlaywrightPageToGroups(viewId: string, groups: readonly IPlaywrightPageGroup[]): Promise<void> {
	const results = await Promise.allSettled(groups.map(group => group.addView(viewId)));
	const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
	if (!failure) {
		return;
	}
	await Promise.allSettled(groups.map(group => group.removeView(viewId)));
	const detail = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
	throw new Error(`Playwright could not attach browser page "${viewId}": ${detail}`);
}
