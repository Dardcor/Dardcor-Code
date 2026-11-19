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

export const StorageBrowserToolData: IToolData = {
	id: 'manage_browser_storage',
	toolReferenceName: BrowserChatToolReferenceName.ManageStorage,
	displayName: localize('storageBrowserTool.displayName', 'Manage Browser Storage'),
	userDescription: localize('storageBrowserTool.userDescription', 'Inspect or manage cookies, localStorage, or sessionStorage'),
	modelDescription: 'Inspect, set, or clear browser cookies, localStorage, or sessionStorage.',
	icon: Codicon.database,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			kind: {
				type: 'string',
				enum: ['cookies', 'local', 'session'],
				description: 'Storage type to manage.'
			},
			action: {
				type: 'string',
				enum: ['get', 'set', 'clear'],
				description: 'Action to perform. Default is "get".'
			},
			key: {
				type: 'string',
				description: 'Storage item key (for local/session storage).'
			},
			value: {
				type: 'string',
				description: 'Storage item value to set (for local/session storage).'
			},
		},
		required: ['pageId', 'kind'],
	},
};

interface IStorageBrowserToolParams {
	pageId: string;
	kind: 'cookies' | 'local' | 'session';
	action?: 'get' | 'set' | 'clear';
	key?: string;
	value?: string;
}

export class StorageBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IStorageBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const act = params.action ?? 'get';
		return {
			invocationMessage: new MarkdownString(localize('browser.storage.invocation', "{0} {1} storage in {2}", act, params.kind, link)),
			pastTenseMessage: new MarkdownString(localize('browser.storage.past', "{0} {1} storage in {2}", act, params.kind, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IStorageBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const action = params.action ?? 'get';

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, knd, act, k, v) => {
			if (knd === 'cookies') {
				const context = page.context();
				if (act === 'clear') {
					await context.clearCookies();
					return { cleared: true };
				}
				if (act === 'set' && k) {
					await context.addCookies([{ name: k, value: v ?? '', url: page.url() }]);
					return { set: true, name: k, value: v ?? '' };
				}
				const cookies = await context.cookies();
				return { cookies };
			}

			const storageKey = knd === 'session' ? 'sessionStorage' : 'localStorage';

			return page.evaluate(({ sKey, actionType, itemKey, itemVal }) => {
				const storage = (window as unknown as Record<string, Storage>)[sKey];
				if (!storage) {
					return { error: 'Storage not available' };
				}

				if (actionType === 'clear') {
					storage.clear();
					return { cleared: true };
				}

				if (actionType === 'set' && itemKey) {
					storage.setItem(itemKey, itemVal ?? '');
					return { set: true, key: itemKey, value: itemVal };
				}

				if (itemKey) {
					return { key: itemKey, value: storage.getItem(itemKey) };
				}

				const all: Record<string, string> = {};
				for (let i = 0; i < storage.length; i++) {
					const curKey = storage.key(i);
					if (curKey) {
						all[curKey] = storage.getItem(curKey) ?? '';
					}
				}
				return all;
			}, { sKey: storageKey, actionType: act, itemKey: k, itemVal: v });
		}, params.kind, action, params.key, params.value);
	}
}
