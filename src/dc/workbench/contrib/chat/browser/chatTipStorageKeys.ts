/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const ChatTipStorageKeys = {
	DismissedTips: 'chat.tip.dismissed',
	LastTipId: 'chat.tip.lastTipId',
	ThinkingPhrasesEverModified: 'chat.tip.thinkingPhrasesEverModified',
};

export const TipEligibilityStorageKeys = {
	ExecutedCommands: 'chat.tips.executedCommands',
	UsedModes: 'chat.tips.usedModes',
	InvokedTools: 'chat.tips.invokedTools',
};

export const TipTrackingCommands = {
	AttachFilesReferenceUsed: 'chat.tips.attachFiles.referenceUsed',
	CreateAgentInstructionsUsed: 'chat.tips.createAgentInstructions.commandUsed',
	CreatePromptUsed: 'chat.tips.createPrompt.commandUsed',
	CreateAgentUsed: 'chat.tips.createAgent.commandUsed',
	CreateSkillUsed: 'chat.tips.createSkill.commandUsed',
	ForkConversationUsed: 'chat.tips.forkConversation.commandUsed',
} as const;
