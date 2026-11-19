/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { escapeMarkdownSyntaxTokens, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { createBrowserPageLink, DEFAULT_ELEMENT_LABEL, errorResult, getSessionId, playwrightInvoke, resolveTargetSelector } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';

export const HighlightBrowserToolData: IToolData = {
	id: 'highlight_browser_element',
	toolReferenceName: BrowserChatToolReferenceName.HighlightElement,
	displayName: localize('highlightBrowserTool.displayName', 'Highlight Element'),
	userDescription: localize('highlightBrowserTool.userDescription', 'Highlight an element on screen in a browser page'),
	modelDescription: 'Highlight an element with a glowing visible outline on the screen in a browser page.',
	icon: Codicon.symbolColor,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			ref: {
				type: 'string',
				description: 'Element reference to highlight.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of element to highlight.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of element.'
			},
			durationMs: {
				type: 'number',
				description: 'Duration in milliseconds to keep the highlight active (default 3000ms).'
			},
		},
		required: ['pageId'],
	},
};

interface IHighlightBrowserToolParams {
	pageId: string;
	ref?: string;
	selector?: string;
	element?: string;
	durationMs?: number;
}

export class HighlightBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IHighlightBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
		return {
			invocationMessage: new MarkdownString(localize('browser.highlight.invocation', "Highlighting {0} in {1}", element, link)),
			pastTenseMessage: new MarkdownString(localize('browser.highlight.past', "Highlighted {0} in {1}", element, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IHighlightBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);
		if (!selector) {
			return errorResult('Either a "ref" or "selector" parameter is required.');
		}

		const duration = params.durationMs ?? 3000;

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, dur) => {
			return page.evaluate(({ s, d }) => {
				const el = document.querySelector(s) as HTMLElement | null;
				if (!el) {
					return { error: 'Element not found' };
				}
				const origOutline = el.style.outline;
				const origTransition = el.style.transition;
				el.style.transition = 'outline 0.2s ease-in-out';
				el.style.outline = '3px solid #9333ea';
				setTimeout(() => {
					el.style.outline = origOutline;
					el.style.transition = origTransition;
				}, d);
				return { highlighted: true, selector: s };
			}, { s: sel, d: duration });
		}, selector, duration);
	}
}
