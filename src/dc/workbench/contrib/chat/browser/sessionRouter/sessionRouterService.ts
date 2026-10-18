/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ChatMessageRole, getTextResponseFromStream, IChatMessage, ILanguageModelsService } from '../../common/languageModels.js';
import { buildRouterMessages, ISessionRouteRequest, ISessionRouteResult, ISessionRouter, parseRouterResponse } from '../../common/sessionRouter.js';

export class SessionRouterService implements ISessionRouter {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService,
	) { }

	async route(request: ISessionRouteRequest, token: CancellationToken): Promise<ISessionRouteResult[]> {
		if (!request.sessions.length) {
			return [];
		}
		const scored = await this.scoreWithModel(request, token);
		return scored ?? [];
	}

	private async scoreWithModel(request: ISessionRouteRequest, token: CancellationToken): Promise<ISessionRouteResult[] | undefined> {
		let modelId: string | undefined;
		try {
			const models = await this.languageModelsService.selectLanguageModels({ vendor: 'dardcor', id: 'dardcor-utility-small' });
			modelId = models.at(0);
		} catch (err) {
			this.logService.trace('[SessionRouter] model selection failed, routing to a new session', err);
		}
		if (!modelId) {
			return undefined;
		}

		const messages: IChatMessage[] = buildRouterMessages(request).map(message => ({
			role: message.role === 'system' ? ChatMessageRole.System : ChatMessageRole.User,
			content: [{ type: 'text', value: message.content }]
		}));

		try {
			const response = await this.languageModelsService.sendChatRequest(modelId, undefined, messages, {}, token);
			const text = await getTextResponseFromStream(response);
			const validIds = new Set(request.sessions.map(session => session.sessionId));
			return parseRouterResponse(text, validIds);
		} catch (err) {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			this.logService.trace('[SessionRouter] scoring request failed, routing to a new session', err);
			return undefined;
		}
	}
}
