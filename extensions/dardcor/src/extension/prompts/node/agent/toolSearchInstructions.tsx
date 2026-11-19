/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptElementProps, PromptSizing } from '@vscode/prompt-tsx';
import type { LanguageModelToolInformation } from 'vscode';
import { CUSTOM_TOOL_SEARCH_NAME } from '../../../../platform/networking/common/anthropic';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { IToolDeferralService } from '../../../../platform/networking/common/toolDeferralService';
import { Tag } from '../base/tag';

export interface ToolSearchToolPromptProps extends BasePromptElementProps {
	readonly availableTools: readonly LanguageModelToolInformation[] | undefined;
}

export interface DeferredToolListReminderProps extends BasePromptElementProps {
	readonly availableTools: readonly LanguageModelToolInformation[] | undefined;
}

export function hasDeferredTool(
	availableTools: readonly LanguageModelToolInformation[] | undefined,
	toolDeferralService: IToolDeferralService,
): boolean {
	return !!availableTools?.some(tool => !toolDeferralService.isNonDeferredTool(tool.name));
}

export class ToolSearchToolPromptOptimized extends PromptElement<ToolSearchToolPromptProps> {
	constructor(
		props: PromptElementProps<ToolSearchToolPromptProps>,
		@IToolDeferralService private readonly toolDeferralService: IToolDeferralService,
	) {
		super(props);
	}

	async render(state: void, sizing: PromptSizing) {
		const endpoint = sizing.endpoint as IChatEndpoint | undefined;
		if (!endpoint?.supportsToolSearch || !hasDeferredTool(this.props.availableTools, this.toolDeferralService)) {
			return;
		}

		return <Tag name='toolSearchInstructions'>
			You MUST use {CUSTOM_TOOL_SEARCH_NAME} to load deferred tools BEFORE calling them. Calling a deferred tool without loading it first will fail.<br />
			<br />
			Describe what capability you need in natural language. The search uses semantic similarity to find the most relevant tools.<br />
			<br />
			Do NOT call {CUSTOM_TOOL_SEARCH_NAME} again for a tool already returned by a previous search. If a search returns no matching tools, the tool is not available. Do not retry with different patterns.<br />
		</Tag>;
	}
}

export class DeferredToolListReminder extends PromptElement<DeferredToolListReminderProps> {
	constructor(
		props: PromptElementProps<DeferredToolListReminderProps>,
		@IToolDeferralService private readonly toolDeferralService: IToolDeferralService,
	) {
		super(props);
	}

	async render(state: void, sizing: PromptSizing) {
		const endpoint = sizing.endpoint as IChatEndpoint | undefined;
		if (!endpoint?.supportsToolSearch || !this.props.availableTools) {
			return;
		}

		const deferredTools = this.props.availableTools
			.filter(tool => !this.toolDeferralService.isNonDeferredTool(tool.name))
			.map(tool => tool.name)
			.sort();

		if (deferredTools.length === 0) {
			return;
		}

		return <Tag name='availableDeferredTools'>
			Available deferred tools (must be loaded with {CUSTOM_TOOL_SEARCH_NAME} before use):<br />
			{deferredTools.join('\n')}
		</Tag>;
	}
}

export { CUSTOM_TOOL_SEARCH_NAME };
