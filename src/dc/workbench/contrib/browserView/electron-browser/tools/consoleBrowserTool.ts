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
import { createBrowserPageLink, errorResult, getSessionId, playwrightInvoke } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';

export const ConsoleBrowserToolData: IToolData = {
	id: 'get_browser_console_logs',
	toolReferenceName: BrowserChatToolReferenceName.GetConsoleLogs,
	displayName: localize('consoleBrowserTool.displayName', 'Get Browser Console Logs'),
	userDescription: localize('consoleBrowserTool.userDescription', 'Retrieve console logs, warnings, and errors from a browser page'),
	modelDescription: 'Get console messages, warnings, uncaught exceptions, and errors recorded by the browser page.',
	icon: Codicon.terminal,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			filter: {
				type: 'string',
				enum: ['all', 'error', 'warning', 'log'],
				description: 'Filter level for console logs. Default is "all".'
			},
		},
		required: ['pageId'],
	},
};

interface IConsoleBrowserToolParams {
	pageId: string;
	filter?: 'all' | 'error' | 'warning' | 'log';
}

export class ConsoleBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IConsoleBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		return {
			invocationMessage: new MarkdownString(localize('browser.console.invocation', "Retrieving console logs from {0}", link)),
			pastTenseMessage: new MarkdownString(localize('browser.console.past', "Retrieved console logs from {0}", link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IConsoleBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, flt) => {
			const msgs = await page.consoleMessages().catch(() => []);
			const filterLevel = flt ?? 'all';
			const logs = msgs.map(m => ({
				level: m.type(),
				text: m.text(),
				time: m.timestamp()
			}));
			if (filterLevel && filterLevel !== 'all') {
				return logs.filter(l => l.level === filterLevel);
			}
			return logs;
		}, params.filter ?? 'all');
	}
}
