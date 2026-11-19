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

export const InspectBrowserToolData: IToolData = {
	id: 'inspect_browser_element',
	toolReferenceName: BrowserChatToolReferenceName.InspectElement,
	displayName: localize('inspectBrowserTool.displayName', 'Inspect Browser Element'),
	userDescription: localize('inspectBrowserTool.userDescription', 'Inspect element attributes, text, styles, and dimensions'),
	modelDescription: 'Inspect details of an element in a browser page, including attributes, computed styles, inner HTML, and bounding box.',
	icon: Codicon.inspect,
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
				description: 'Element reference to inspect.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of element to inspect.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of element.'
			},
		},
		required: ['pageId'],
	},
};

interface IInspectBrowserToolParams {
	pageId: string;
	ref?: string;
	selector?: string;
	element?: string;
}

export class InspectBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IInspectBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
		return {
			invocationMessage: new MarkdownString(localize('browser.inspect.invocation', "Inspecting {0} in {1}", element, link)),
			pastTenseMessage: new MarkdownString(localize('browser.inspect.past', "Inspected {0} in {1}", element, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IInspectBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);
		if (!selector) {
			return errorResult('Either a "ref" or "selector" parameter is required.');
		}

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel) => {
			return page.evaluate((s) => {
				const el = document.querySelector(s) as HTMLElement | null;
				if (!el) {
					return { error: 'Element not found' };
				}
				const rect = el.getBoundingClientRect();
				const attrs: Record<string, string> = {};
				for (let i = 0; i < el.attributes.length; i++) {
					const a = el.attributes[i];
					attrs[a.name] = a.value;
				}
				const comp = window.getComputedStyle(el);
				return {
					tagName: el.tagName.toLowerCase(),
					id: el.id,
					className: el.className,
					attributes: attrs,
					boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
					styles: {
						display: comp.display,
						visibility: comp.visibility,
						color: comp.color,
						backgroundColor: comp.backgroundColor,
						fontSize: comp.fontSize,
					},
					textContent: (el.textContent || '').trim().slice(0, 300),
					outerHTML: el.outerHTML.slice(0, 500),
				};
			}, sel);
		}, selector);
	}
}
