/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AgentInput,
	AskUserQuestionInput,
	BashInput,
	FileEditInput,
	FileReadInput,
	FileWriteInput,
	GlobInput,
	GrepInput,
	NotebookEditInput,
	ExitPlanModeInput as SDKExitPlanModeInput,
	TaskOutputInput,
	TaskStopInput,
	TodoWriteInput,
	WebFetchInput,
	WebSearchInput,
} from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import { URI } from '../../../../util/dardcor/base/common/uri';

export interface ExitPlanModeInput extends SDKExitPlanModeInput {
	readonly plan?: string;
}

export interface EnterPlanModeInput {
}

export enum ClaudeToolNames {
	Agent = 'Agent',
	Task = 'Task',
	Bash = 'Bash',
	Glob = 'Glob',
	Grep = 'Grep',
	LS = 'LS',
	EnterPlanMode = 'EnterPlanMode',
	ExitPlanMode = 'ExitPlanMode',
	Read = 'Read',
	Edit = 'Edit',
	MultiEdit = 'MultiEdit',
	Write = 'Write',
	NotebookEdit = 'NotebookEdit',
	WebFetch = 'WebFetch',
	TodoWrite = 'TodoWrite',
	WebSearch = 'WebSearch',
	BashOutput = 'BashOutput',
	KillBash = 'KillBash',
	AskUserQuestion = 'AskUserQuestion',
}



export interface LSInput {
	readonly path: string;
}

export interface ClaudeToolInputMap {
	[ClaudeToolNames.Agent]: AgentInput;
	[ClaudeToolNames.Task]: AgentInput;
	[ClaudeToolNames.Bash]: BashInput;
	[ClaudeToolNames.Glob]: GlobInput;
	[ClaudeToolNames.Grep]: GrepInput;
	[ClaudeToolNames.LS]: LSInput;
	[ClaudeToolNames.EnterPlanMode]: EnterPlanModeInput;
	[ClaudeToolNames.ExitPlanMode]: ExitPlanModeInput;
	[ClaudeToolNames.Read]: FileReadInput;
	[ClaudeToolNames.Edit]: FileEditInput;
	[ClaudeToolNames.MultiEdit]: FileEditInput;
	[ClaudeToolNames.Write]: FileWriteInput;
	[ClaudeToolNames.NotebookEdit]: NotebookEditInput;
	[ClaudeToolNames.WebFetch]: WebFetchInput;
	[ClaudeToolNames.TodoWrite]: TodoWriteInput;
	[ClaudeToolNames.WebSearch]: WebSearchInput;
	[ClaudeToolNames.BashOutput]: TaskOutputInput;
	[ClaudeToolNames.KillBash]: TaskStopInput;
	[ClaudeToolNames.AskUserQuestion]: AskUserQuestionInput;
}

export const claudeEditTools: readonly string[] = [ClaudeToolNames.Edit, ClaudeToolNames.MultiEdit, ClaudeToolNames.Write, ClaudeToolNames.NotebookEdit];

export function getAffectedUrisForEditTool(toolName: string, toolInput: unknown): URI[] {
	switch (toolName) {
		case ClaudeToolNames.Edit:
		case ClaudeToolNames.MultiEdit:
			return [URI.file((toolInput as FileEditInput).file_path)];
		case ClaudeToolNames.Write:
			return [URI.file((toolInput as FileWriteInput).file_path)];
		case ClaudeToolNames.NotebookEdit:
			return [URI.file((toolInput as NotebookEditInput).notebook_path)];
		default:
			return [];
	}
}
