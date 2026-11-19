/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { localize } from '../../../../nls.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ChatConfiguration, ChatModeKind } from '../common/constants.js';
import { ChatContextKeys } from '../common/actions/chatContextKeys.js';
import { localChatSessionType } from '../common/chatSessionsService.js';
import { ITipExclusionConfig } from './chatTipEligibilityTracker.js';
import { TipTrackingCommands } from './chatTipStorageKeys.js';
import {
	GENERATE_AGENT_COMMAND_ID,
	GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID,
	GENERATE_PROMPT_COMMAND_ID,
	GENERATE_SKILL_COMMAND_ID,
	INSERT_FORK_CONVERSATION_COMMAND_ID,
	INSERT_TROUBLESHOOT_COMMAND_ID,
} from './actions/chatActions.js';

export const enum ChatTipTier {
	Foundational = 'foundational',
	Qol = 'qol',
}

export interface ITipBuildContext {
	readonly keybindingService: IKeybindingService;
}

export function getCommandLabel(commandId: string): string {
	const command = MenuRegistry.getCommand(commandId);
	if (command?.title) {
		return typeof command.title === 'string' ? command.title : command.title.value;
	}
	const parts = commandId.split('.');
	return parts[parts.length - 1];
}

function formatKeybinding(ctx: ITipBuildContext, commandId: string): string {
	const kb = ctx.keybindingService.lookupKeybinding(commandId);
	return kb ? ` (${kb.getLabel()})` : '';
}

export function extractCommandIds(markdown: string): string[] {
	const commandPattern = /\[.*?\]\(command:([^?\s)]+)/g;
	const commands = new Set<string>();
	let match;
	while ((match = commandPattern.exec(markdown)) !== null) {
		commands.add(match[1]);
	}
	return [...commands];
}

export interface ITipDefinition extends ITipExclusionConfig {
	readonly id: string;
	readonly tier: ChatTipTier;
	readonly priority?: number;
	buildMessage(ctx: ITipBuildContext): MarkdownString;
	readonly when?: ContextKeyExpression;
	readonly requiresCommands?: readonly string[];
	readonly requiresModeNames?: readonly string[];
	readonly onlyWhenModelIds?: readonly string[];
	readonly excludeWhenSettingsChanged?: readonly string[];
	readonly dismissWhenCommandsClicked?: readonly string[];
}


export const TIP_CATALOG: readonly ITipDefinition[] = [
	{
		id: 'tip.switchToAuto',
		tier: ChatTipTier.Foundational,
		priority: 0,
		buildMessage(_ctx) {
			return new MarkdownString(
				localize(
					'tip.switchToAuto',
					"Using GPT-4.1? Try switching to [Auto](command:workbench.action.chat.openModelPicker \"Open Model Picker\") in the model picker for better coding performance."
				)
			);
		},
		onlyWhenModelIds: ['gpt-4.1'],
	},
	{
		id: 'tip.init',
		tier: ChatTipTier.Foundational,
		priority: 50,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID);
			return new MarkdownString(
				localize(
					'tip.init',
					"Use [{0}](command:{1} \"Run /init\"){2} to generate or update a workspace instructions file for AI coding agents.",
					'/init',
					GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID,
					kb
				)
			);
		},
		when: ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
		excludeWhenCommandsExecuted: [
			GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID,
			TipTrackingCommands.CreateAgentInstructionsUsed,
		],
	},
	{
		id: 'tip.createPrompt',
		tier: ChatTipTier.Foundational,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, GENERATE_PROMPT_COMMAND_ID);
			return new MarkdownString(
				localize(
					'tip.createPrompt',
					"Use [{0}](command:{1} \"Run /create-prompt\"){2} to generate a reusable prompt file with the agent.",
					'/create-prompt',
					GENERATE_PROMPT_COMMAND_ID,
					kb
				)
			);
		},
		when: ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
		excludeWhenCommandsExecuted: [
			GENERATE_PROMPT_COMMAND_ID,
			TipTrackingCommands.CreatePromptUsed,
		],
	},
	{
		id: 'tip.createAgent',
		tier: ChatTipTier.Foundational,
		priority: 30,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, GENERATE_AGENT_COMMAND_ID);
			return new MarkdownString(
				localize(
					'tip.createAgent',
					"Use [{0}](command:{1} \"Run /create-agent\"){2} to scaffold a custom agent for your workflow.",
					'/create-agent',
					GENERATE_AGENT_COMMAND_ID,
					kb
				)
			);
		},
		when: ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
		excludeWhenCommandsExecuted: [
			GENERATE_AGENT_COMMAND_ID,
			TipTrackingCommands.CreateAgentUsed,
		],
	},
	{
		id: 'tip.createSkill',
		tier: ChatTipTier.Foundational,
		priority: 40,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, GENERATE_SKILL_COMMAND_ID);
			return new MarkdownString(
				localize(
					'tip.createSkill',
					"Use [{0}](command:{1} \"Run /create-skill\"){2} to create a skill the agent can load when relevant.",
					'/create-skill',
					GENERATE_SKILL_COMMAND_ID,
					kb
				)
			);
		},
		when: ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
		excludeWhenCommandsExecuted: [
			GENERATE_SKILL_COMMAND_ID,
			TipTrackingCommands.CreateSkillUsed,
		],
	},
	{
		id: 'tip.planMode',
		tier: ChatTipTier.Foundational,
		priority: 20,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, 'workbench.action.chat.openPlan');
			return new MarkdownString(
				localize(
					'tip.planMode',
					"Try the [{0}](command:workbench.action.chat.open?%5B%7B%22mode%22%3A%22Plan%22%7D%5D \"Start Plan Mode\"){1} to research and plan before implementing changes.",
					'Plan agent',
					kb
				)
			);
		},
		when: ChatContextKeys.chatModeName.notEqualsTo('Plan'),
		requiresModeNames: ['Plan'],
		excludeWhenCommandsExecuted: ['workbench.action.chat.openPlan'],
		excludeWhenModesUsed: ['Plan'],
	},
	{
		id: 'tip.attachFiles',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize('tip.attachFiles', "Reference files or folders with # to give the agent more context about the task.")
			);
		},
		excludeWhenCommandsExecuted: [
			'workbench.action.chat.attachContext',
			'workbench.action.chat.attachFile',
			'workbench.action.chat.attachFolder',
			'workbench.action.chat.attachSelection',
			TipTrackingCommands.AttachFilesReferenceUsed,
		],
	},
	{
		id: 'tip.codeActions',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize('tip.codeActions', "Select a code block in the editor and right-click to access more AI actions.")
			);
		},
		excludeWhenCommandsExecuted: ['inlineChat.start'],
	},
	{
		id: 'tip.undoChanges',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize('tip.undoChanges', "Hover a previous request and select \"Restore Checkpoint\" to undo changes after that point in the chat conversation.")
			);
		},
		when: ContextKeyExpr.and(
			ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
			ContextKeyExpr.or(
				ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
				ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Edit),
			),
		),
		excludeWhenCommandsExecuted: ['workbench.action.chat.restoreCheckpoint', 'workbench.action.chat.restoreLastCheckpoint'],
	},
	{
		id: 'tip.messageQueueing',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize('tip.messageQueueing', "Steer the agent mid-task by sending follow-up messages. They queue and apply in order.")
			);
		},
		when: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
		excludeWhenCommandsExecuted: ['workbench.action.chat.queueMessage', 'workbench.action.chat.steerWithMessage'],
	},
	{
		id: 'tip.forkConversation',
		tier: ChatTipTier.Qol,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, INSERT_FORK_CONVERSATION_COMMAND_ID);
			return new MarkdownString(
				localize(
					'tip.forkConversation',
					"Use [{0}](command:{1} \"Run /fork\"){2} to branch the conversation. Explore a different approach without losing the original context.",
					'/fork',
					INSERT_FORK_CONVERSATION_COMMAND_ID,
					kb
				)
			);
		},
		excludeWhenCommandsExecuted: [
			INSERT_FORK_CONVERSATION_COMMAND_ID,
			'workbench.action.chat.forkConversation',
			TipTrackingCommands.ForkConversationUsed,
		],
	},
	{
		id: 'tip.mermaid',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize('tip.mermaid', "Ask the agent to draw an architectural diagram or flow chart. It can render Mermaid diagrams directly in chat.")
			);
		},
		when: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
		excludeWhenToolsInvoked: ['renderMermaidDiagram'],
	},
	{
		id: 'tip.subagents',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize('tip.subagents', "Have another task to work on? Start a new session to run multiple agents at once.")
			);
		},
		when: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
		excludeWhenToolsInvoked: ['runSubagent'],
	},
	{
		id: 'tip.thinkingPhrases',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize(
					'tip.thinkingPhrases',
					"Customize the loading messages shown while the agent works with [{0}](command:workbench.action.openSettings?%5B%22{1}%22%5D \"Open Settings\").",
					'thinking phrases',
					ChatConfiguration.ThinkingPhrases
				)
			);
		},
		when: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
		excludeWhenSettingsChanged: [ChatConfiguration.ThinkingPhrases],
		dismissWhenCommandsClicked: ['workbench.action.openSettings'],
	},
	{
		id: 'tip.autoAcceptDelay',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize(
					'tip.autoAcceptDelay',
					"Configure [{0}](command:workbench.action.openSettings?%5B%22chat.editing.autoAcceptDelay%22%5D \"Open Settings\") to automatically accept changes from the agent after a short countdown.",
					'auto-accept delay'
				)
			);
		},
		when: ContextKeyExpr.or(
			ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
			ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Edit),
		),
		excludeWhenSettingsChanged: ['chat.editing.autoAcceptDelay'],
		dismissWhenCommandsClicked: ['workbench.action.openSettings'],
	},
	{
		id: 'tip.troubleshoot',
		tier: ChatTipTier.Qol,
		buildMessage(ctx) {
			const kb = formatKeybinding(ctx, INSERT_TROUBLESHOOT_COMMAND_ID);
			return new MarkdownString(
				localize(
					'tip.troubleshoot',
					"Something not working? Type [{0}](command:{1} \"Run /troubleshoot\"){2} <question> to diagnose issues from debug logs.",
					'/troubleshoot',
					INSERT_TROUBLESHOOT_COMMAND_ID,
					kb
				)
			);
		},
		when: ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
		excludeWhenToolsInvoked: ['listDebugEvents'],
	},
	{
		id: 'tip.copilotCli',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize(
					'tip.copilotCli',
					"Run agents in parallel with [Dardcor CLI](command:workbench.action.chat.openNewChatSessionInPlace.copilotcli?%5B%22sidebar%22%5D \"Switch to Dardcor CLI\")."
				)
			);
		},
		when: ContextKeyExpr.and(
			ChatContextKeys.chatSessionType.isEqualTo(localChatSessionType),
			ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
			ChatContextKeys.hasCanDelegateProviders,
		),
		excludeWhenCommandsExecuted: ['workbench.action.chat.openNewChatSessionInPlace.copilotcli'],
	},
	{
		id: 'tip.defaultPermissions',
		tier: ChatTipTier.Qol,
		buildMessage() {
			return new MarkdownString(
				localize(
					'tip.defaultPermissions',
					"Configure [{0}](command:workbench.action.openSettings?%5B%22{1}%22%5D \"Open Settings\") to start new sessions in Bypass Approvals or Autopilot mode.",
					'default permissions',
					ChatConfiguration.DefaultPermissionLevel
				)
			);
		},
		when: ContextKeyExpr.or(
			ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
			ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Edit),
		),
		excludeWhenSettingsChanged: [ChatConfiguration.DefaultPermissionLevel],
		dismissWhenCommandsClicked: ['workbench.action.openSettings'],
	},
];
