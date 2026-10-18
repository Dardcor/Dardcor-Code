/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { CancellationToken } from '../../../../util/dardcor/base/common/cancellation';
import { IInstantiationService, createDecorator } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../dardcorTypes';
import { ToolName } from '../../../tools/common/toolNames';
import { IToolsService } from '../../../tools/common/toolsService';
import {
	ClaudeToolPermissionContext,
	ClaudeToolPermissionResult,
	IClaudeToolConfirmationParams,
	IClaudeToolPermissionHandler
} from './claudeToolPermission';
import { getToolPermissionHandlerRegistry } from './claudeToolPermissionRegistry';
import { ClaudeToolInputMap, ClaudeToolNames } from './claudeTools';

export const IClaudeToolPermissionService = createDecorator<IClaudeToolPermissionService>('claudeToolPermissionService');

export interface IClaudeToolPermissionService {
	readonly _serviceBrand: undefined;

	canUseTool(
		toolName: string,
		input: Record<string, unknown>,
		context: ClaudeToolPermissionContext
	): Promise<ClaudeToolPermissionResult>;
}

const DenyToolMessage = 'The user declined to run the tool';

export class ClaudeToolPermissionService implements IClaudeToolPermissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _handlerCache = new Map<ClaudeToolNames, IClaudeToolPermissionHandler>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IToolsService private readonly toolsService: IToolsService,
	) { }

	public async canUseTool(
		toolName: string,
		input: Record<string, unknown>,
		context: ClaudeToolPermissionContext
	): Promise<ClaudeToolPermissionResult> {
		if (context.permissionMode === 'bypassPermissions') {
			return { behavior: 'allow', updatedInput: input };
		}

		const handler = this._getHandler(toolName as ClaudeToolNames);

		if (handler?.handle) {
			return handler.handle(toolName as ClaudeToolNames, input as ClaudeToolInputMap[ClaudeToolNames], context);
		}

		if (handler?.canAutoApprove) {
			const canAutoApprove = await handler.canAutoApprove(toolName as ClaudeToolNames, input as ClaudeToolInputMap[ClaudeToolNames], context);
			if (canAutoApprove) {
				return { behavior: 'allow', updatedInput: input };
			}
		}

		const confirmationParams = handler?.getConfirmationParams
			? handler.getConfirmationParams(toolName as ClaudeToolNames, input as ClaudeToolInputMap[ClaudeToolNames])
			: this._getDefaultConfirmationParams(toolName, input);

		return this._showConfirmation(confirmationParams, input, context);
	}

	private _getHandler(toolName: ClaudeToolNames): IClaudeToolPermissionHandler | undefined {
		if (this._handlerCache.has(toolName)) {
			return this._handlerCache.get(toolName);
		}

		const registration = getToolPermissionHandlerRegistry().find(r => r.toolNames.includes(toolName));
		if (!registration) {
			return undefined;
		}

		const handler = this.instantiationService.createInstance(registration.ctor);
		for (const name of registration.toolNames) {
			this._handlerCache.set(name, handler);
		}

		return handler;
	}

	private _getDefaultConfirmationParams(toolName: string, input: Record<string, unknown>): IClaudeToolConfirmationParams {
		return {
			title: l10n.t('Use {0}?', toolName),
			message: `\`\`\`\n${JSON.stringify(input, null, 2)}\n\`\`\``
		};
	}

	private async _showConfirmation(
		params: IClaudeToolConfirmationParams,
		input: Record<string, unknown>,
		context: ClaudeToolPermissionContext
	): Promise<ClaudeToolPermissionResult> {
		try {
			const result = await this.toolsService.invokeTool(ToolName.CoreConfirmationTool, {
				input: params,
				toolInvocationToken: context.toolInvocationToken,
			}, CancellationToken.None);

			const firstResultPart = result.content.at(0);
			if (firstResultPart instanceof LanguageModelTextPart && firstResultPart.value === 'yes') {
				return {
					behavior: 'allow',
					updatedInput: input
				};
			}
		} catch { }

		return {
			behavior: 'deny',
			message: DenyToolMessage
		};
	}
}
