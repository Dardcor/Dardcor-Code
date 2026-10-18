/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { BrowserViewUri } from '../../../../../platform/browserView/common/browserViewUri.js';
import { IInvokeFunctionResult, IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { IAgentNetworkFilterService } from '../../../../../platform/networkFilter/common/networkFilterService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IToolInvocation, IToolResult } from '../../../chat/common/tools/languageModelToolsService.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import { browserViewUrlMatches, BrowserViewSharingState, IBrowserViewWorkbenchService } from '../../common/browserView.js';
import { IRemoteExplorerService } from '../../../../services/remote/common/remoteExplorerService.js';
import { mapHasAddressLocalhostOrAllInterfaces } from '../../../../services/remote/common/tunnelModel.js';
import { extractLocalHostUriMetaDataForPortMapping } from '../../../../../platform/tunnel/common/tunnel.js';

// eslint-disable-next-line local/code-import-patterns
import type { Page } from 'playwright-core';

export const DEFAULT_ELEMENT_LABEL = localize('browser.element', 'element');

export function getSessionId(invocation: IToolInvocation): string {
	return invocation.context?.sessionResource?.toString() ?? '<default>';
}

export interface FormatBrowserEditorLinesOptions {
	indent?: string;
	numbered?: boolean;
	excludeIds?: boolean;
	agentNetworkFilterService?: IAgentNetworkFilterService;
}

export function formatBrowserEditorList(editorService: IEditorService, editors: readonly BrowserEditorInput[], options?: FormatBrowserEditorLinesOptions): string {
	const activeEditor = editorService.activeEditor;
	const visibleEditors = new Set(editorService.visibleEditors);
	const indent = options?.indent ?? '';
	const filterService = options?.agentNetworkFilterService;
	return editors.map((editor, index) => {
		const url = editor.url || 'about:blank';

		let blocked = false;
		if (filterService && url !== 'about:blank') {
			try { blocked = !filterService.isUriAllowed(URI.parse(url)); } catch { }
		}

		const title = blocked ? localize('browser.blockedByPolicy', "Blocked by network domain policy") : (editor.title || 'Untitled');
		const displayUrl = blocked ? '' : ` (${url})`;
		const hint = editor === activeEditor ? ' (active)' : visibleEditors.has(editor) ? ' (visible)' : ' (not visible)';
		const id = options?.excludeIds ? '' : `[${editor.id}] `;

		const bullet = (options?.numbered ?? options?.excludeIds) ? `${index + 1}. ` : '- ';
		return `${indent}${bullet}${id}${title}${displayUrl}${hint}`;
	}).join('\n');
}

export function getBrowserPagesContext(
	editorService: IEditorService,
	browserViewService: IBrowserViewWorkbenchService,
	agentNetworkFilterService: IAgentNetworkFilterService,
	options?: {
		activeSessionId?: string;
		canPromptUser?: boolean;
	},
): string | undefined {
	const views = [...browserViewService.getContextualBrowserViews({ activeSessionId: options?.activeSessionId }).values()];
	const sharedViews = views.filter(view => view.model?.sharingState === BrowserViewSharingState.Shared);
	const unsharedCount = views.length - sharedViews.length;

	if (sharedViews.length === 0 && unsharedCount === 0) {
		return undefined;
	}

	let value: string;
	if (sharedViews.length > 0) {
		value = 'The following browser pages are currently shared with you and can be interacted with using the browser tools:';
		value += '\n' + formatBrowserEditorList(editorService, sharedViews, { agentNetworkFilterService });
	} else {
		value = 'No browser pages are currently shared with you.';
	}

	if (unsharedCount > 0) {
		value += '\n\n';
		value += `${unsharedCount} ${unsharedCount === 1 ? 'page is' : 'pages are'} open but not shared.`;
		value += options?.canPromptUser
			? `\nUse the 'open_browser_page' tool to open a new page or to help the user share an existing page.`
			: `\nUse the 'open_browser_page' tool to open a new page.`;
	}

	return value;
}

export function createBrowserPageLink(pageId: string | URI): string {
	if (typeof pageId === 'string') {
		pageId = BrowserViewUri.forId(pageId);
	}
	return `[${BrowserEditorInput.DEFAULT_LABEL}](${pageId.toString()}?vscodeLinkType=browser)`;
}

export async function playwrightInvokeRaw<TArgs extends unknown[], TReturn>(
	playwrightService: IPlaywrightService,
	sessionId: string,
	pageId: string,
	fn: (page: Page, ...args: TArgs) => Promise<TReturn>,
	...args: TArgs
): Promise<TReturn> {
	return playwrightService.invokeFunctionRaw(sessionId, pageId, fn.toString(), ...args);
}

export async function playwrightInvoke<TArgs extends unknown[], TReturn>(
	playwrightService: IPlaywrightService,
	sessionId: string,
	pageId: string,
	fn: (page: Page, ...args: TArgs) => Promise<TReturn>,
	...args: TArgs
): Promise<IToolResult> {
	try {
		const result = await playwrightService.invokeFunction(sessionId, pageId, fn.toString(), args);
		return invokeFunctionResultToToolResult(result);
	} catch (e) {
		return errorResult(e instanceof Error ? e.message : String(e));
	}
}

export function invokeFunctionResultToToolResult(result: IInvokeFunctionResult, code?: string): IToolResult {
	const content: IToolResult['content'] = [];
	if (result.result !== undefined) {
		content.push({ kind: 'text', value: `Result: ${JSON.stringify(result.result)}` });
	}
	if (result.error) {
		content.push({ kind: 'text', value: result.error });
	}
	if (result.deferredResultId) {
		content.push({ kind: 'text', value: `[deferredResultId=${result.deferredResultId}] The code has not finished executing yet. Call run_playwright_code again with this deferredResultId and the same pageId (no code) to continue waiting.` });
	}
	content.push({ kind: 'text', value: result.summary });
	return {
		content,
		...(code ? {
			toolResultDetails: {
				input: code,
				inputLanguage: 'javascript',
				output: result.result || result.error
					? [{ type: 'embed' as const, isText: true, value: JSON.stringify(result.result ?? result.error, null, 2) }]
					: [],
				isError: !!result.error,
			},
		} : {}),
	};
}

export function errorResult(message: string): IToolResult {
	return {
		content: [{ kind: 'text', value: message }],
		toolResultError: message,
	};
}

export function rewriteRemoteLocalhostUrl(
	url: string,
	browserViewService: IBrowserViewWorkbenchService,
	remoteExplorerService: IRemoteExplorerService,
): { url: string; rewritten: boolean } {
	if (browserViewService.willUseRemoteProxy()) {
		return { url, rewritten: false };
	}

	let uri = URI.parse(url);

	if (uri.authority) {
		uri = uri.with({ authority: uri.authority.toLowerCase() });
	}

	const portMapping = extractLocalHostUriMetaDataForPortMapping(uri);
	if (!portMapping) {
		return { url, rewritten: false };
	}

	const tunnelModel = remoteExplorerService.tunnelModel;
	const forwarded = mapHasAddressLocalhostOrAllInterfaces(tunnelModel.forwarded, portMapping.address, portMapping.port)
		?? mapHasAddressLocalhostOrAllInterfaces(tunnelModel.detected, portMapping.address, portMapping.port);
	if (!forwarded?.localUri) {
		return { url, rewritten: false };
	}

	const rewritten = forwarded.localUri.with({ path: uri.path, query: uri.query, fragment: uri.fragment });
	return { url: rewritten.toString(), rewritten: true };
}

export function remoteUrlRewriteNotice(originalUrl: string, rewrittenUrl: string): { kind: 'text'; value: string } {
	return {
		kind: 'text',
		value: `Note: \`${originalUrl}\` was rewritten to \`${rewrittenUrl}\` because this is a remote workspace and the remote port is forwarded to a local address.`,
	};
}

export function findExistingPagesByHost(
	browserViewService: IBrowserViewWorkbenchService,
	url: string,
	options?: {
		includeBlank?: boolean;
		sharingState?: BrowserViewSharingState;
		activeSessionId?: string;
	}
): BrowserEditorInput[] {
	const results: BrowserEditorInput[] = [];
	for (const editor of browserViewService.getContextualBrowserViews({ activeSessionId: options?.activeSessionId }).values()) {
		if (!(editor instanceof BrowserEditorInput)) {
			continue;
		}
		if (options?.sharingState && editor.model?.sharingState !== options.sharingState) {
			continue;
		}
		if (browserViewUrlMatches(editor.url, url, options?.includeBlank)) {
			results.push(editor);
		}
	}
	return results;
}

export async function getExistingPagesResult(
	editorService: IEditorService,
	existing: BrowserEditorInput[],
	formatOptions?: FormatBrowserEditorLinesOptions
): Promise<IToolResult | undefined> {
	if (existing.length === 0) {
		return undefined;
	}

	const list = formatBrowserEditorList(editorService, existing, { indent: '  ', ...formatOptions });
	const links = existing.map(e => createBrowserPageLink(e.id));
	return {
		content: [{
			kind: 'text',
			value: `At least one similar page is already open:\n${list}\n\nUse an existing page or pass \`forceNew: true\` to open a new one.`
		}],
		toolResultMessage: new MarkdownString(localize('browser.open.alreadyOpen', "Already open: {0}", links.join(', '))),
	};
}
