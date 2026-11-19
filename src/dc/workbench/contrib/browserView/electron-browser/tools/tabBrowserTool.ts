/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { errorResult, getSessionId, playwrightInvoke } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';

export const TabBrowserToolData: IToolData = {
	id: 'manage_browser_tabs',
	toolReferenceName: BrowserChatToolReferenceName.ManageTabs,
	displayName: localize('tabBrowserTool.displayName', 'Manage Browser Tabs'),
	userDescription: localize('tabBrowserTool.userDescription', 'List, switch, or manage tabs in the browser context'),
	modelDescription: 'List open tabs, get tab information, or switch between tabs in the current browser page context.',
	icon: Codicon.window,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			action: {
				type: 'string',
				enum: ['list', 'new', 'close'],
				description: 'Action to perform with browser tabs. Default is "list".'
			},
			url: {
				type: 'string',
				description: 'URL to open when action is "new".'
			},
		},
		required: ['pageId'],
	},
};

interface ITabBrowserToolParams {
	pageId: string;
	action?: 'list' | 'new' | 'close';
	url?: string;
}

export class TabBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as ITabBrowserToolParams;
		const act = params.action ?? 'list';
		return {
			invocationMessage: new MarkdownString(localize('browser.tabs.invocation', "Managing browser tabs ({0})", act)),
			pastTenseMessage: new MarkdownString(localize('browser.tabs.past', "Managed browser tabs ({0})", act)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as ITabBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const action = params.action ?? 'list';

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, act, targetUrl) => {
			const context = page.context();
			const pages = context.pages();

			if (act === 'new' && targetUrl) {
				const newPage = await context.newPage();
				await newPage.goto(targetUrl);
				return { opened: true, url: targetUrl, pagesCount: context.pages().length };
			}

			if (act === 'close') {
				await page.close();
				return { closed: true, remainingPages: context.pages().length };
			}

			const tabs = await Promise.all(pages.map(async (p, idx) => {
				const pTitle = await p.title().catch(() => '');
				return {
					index: idx,
					url: p.url(),
					title: pTitle,
					isActive: p === page,
				};
			}));

			return { count: tabs.length, tabs };
		}, action, params.url);
	}
}
