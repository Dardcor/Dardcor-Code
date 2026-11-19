/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IResponsePart } from '../../../platform/chat/common/chatMLFetcher';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { IWorkbenchService } from '../../../platform/workbench/common/workbenchService';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { Intent } from '../../common/constants';
import { parseSettingsAndCommands } from '../../context/node/resolvers/dardcorContext';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { IIntent, IIntentInvocation, IIntentInvocationContext, IIntentSlashCommandInfo, IntentLinkificationOptions, IResponseProcessorContext } from '../../prompt/node/intents';
import { PromptRenderer, RendererIntentInvocation } from '../../prompts/node/base/promptRenderer';
import { VscodePrompt } from '../../prompts/node/panel/dardcor';
import { ToolName } from '../../tools/common/toolNames';
import { IToolsService } from '../../tools/common/toolsService';


class VSCodeIntentInvocation extends RendererIntentInvocation implements IIntentInvocation {

	readonly linkification: IntentLinkificationOptions = { disable: true };

	constructor(
		intent: IIntent,
		location: ChatLocation,
		endpoint: IChatEndpoint,
		private readonly request: vscode.ChatRequest,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchService private readonly workbenchService: IWorkbenchService,
		@IToolsService private readonly toolsService: IToolsService,
	) {
		super(intent, location, endpoint);
	}

	async createRenderer(promptContext: IBuildPromptContext, endpoint: IChatEndpoint, progress: vscode.Progress<vscode.ChatResponseProgressPart | vscode.ChatResponseReferencePart>, token: vscode.CancellationToken) {
		return PromptRenderer.create(this.instantiationService, endpoint, VscodePrompt, {
			endpoint,
			promptContext
		});
	}

	processResponse(context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: vscode.ChatResponseStream, token: CancellationToken): Promise<void> {
		const responseProcessor = new VSCodeResponseProcessor(this.workbenchService);
		return responseProcessor.processResponse(context, inputStream, outputStream, token);
	}

	getAvailableTools(): vscode.LanguageModelToolInformation[] | Promise<vscode.LanguageModelToolInformation[]> | undefined {
		return this.toolsService.getEnabledTools(this.request, this.endpoint, tool =>
			tool.name === 'vscode_searchExtensions_internal' ||
			tool.name === ToolName.VSCodeAPI
		);
	}
}

class VSCodeResponseProcessor {
	private stagedTextToApply = '';
	constructor(private readonly workbenchService: IWorkbenchService) {
	}

	async processResponse(context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
		for await (const { delta } of inputStream) {
			if (token.isCancellationRequested) {
				return;
			}
			await this.applyDelta(delta.text, outputStream);
		}
	}

	private async processNonReporting(codeBlock: string, progress: vscode.ChatResponseStream) {
		const parsedCommands = await parseSettingsAndCommands(this.workbenchService, codeBlock);

		if (parsedCommands.length === 0) {
			progress.markdown('\n' + codeBlock + '\n');
		} else {
			for (const parsedCommand of parsedCommands) {
				if (parsedCommand.commandToRun) {
					progress.button(parsedCommand.commandToRun);
				}
			}
		}
	}

	private _incodeblock = false;
	private async applyDelta(textDelta: string, progress: vscode.ChatResponseStream) {

		textDelta = this.stagedTextToApply + textDelta;
		this.stagedTextToApply = '';
		const codeblockStart = textDelta.indexOf('```');

		if (this._incodeblock) {
			const codeblockEnd = textDelta.indexOf('```');
			if (codeblockEnd === -1) {
				this.stagedTextToApply = textDelta;
			} else {
				this._incodeblock = false;
				const codeBlock = '```' + textDelta.substring(0, codeblockEnd) + '```';
				await this.processNonReporting(codeBlock, progress);
				progress.markdown(textDelta.substring(codeblockEnd + 3));
			}
		}
		else if (codeblockStart !== -1) {
			this._incodeblock = true;
			const codeblockEnd = textDelta.indexOf('```', codeblockStart + 3);
			if (codeblockEnd !== -1) {
				this._incodeblock = false;
				progress.markdown(textDelta.substring(0, codeblockStart));
				const codeBlock = '```' + textDelta.substring(codeblockStart + 3, codeblockEnd) + '```';
				await this.processNonReporting(codeBlock, progress);
				progress.markdown(textDelta.substring(codeblockEnd + 3));
			} else {
				this.stagedTextToApply = textDelta.substring(codeblockStart + 3);
				const textToReport = textDelta.substring(0, codeblockStart);
				if (textToReport) {
					progress.markdown(textToReport);
				}
			}
		} else {
			progress.markdown(textDelta);
		}
	}
}

export class VscodeIntent implements IIntent {

	static readonly ID = Intent.VSCode;
	readonly id: string = VscodeIntent.ID;
	readonly locations = [ChatLocation.Panel];
	readonly description: string = l10n.t('Ask questions about VS Code');

	readonly commandInfo: IIntentSlashCommandInfo = {
		allowsEmptyArgs: true,
	};

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
	) { }

	async invoke(invocationContext: IIntentInvocationContext): Promise<IIntentInvocation> {
		const location = invocationContext.location;
		const endpoint = await this.endpointProvider.getChatEndpoint(invocationContext.request);
		return this.instantiationService.createInstance(VSCodeIntentInvocation, this, location, endpoint, invocationContext.request);
	}
}
