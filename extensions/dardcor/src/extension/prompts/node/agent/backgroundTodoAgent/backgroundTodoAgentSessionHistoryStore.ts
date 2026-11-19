/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../../util/dardcor/base/common/lifecycle';
import { ThinkingData } from '../../../../../platform/thinking/common/thinking';
import { IBuildPromptContext, IToolCall, IToolCallRound } from '../../../../prompt/common/intents';
import { ToolName } from '../../../../tools/common/toolNames';

type BGToolCall = Pick<IToolCall, 'name' | 'arguments'>;
export type BGToolCallRound = Pick<IToolCallRound, 'id' | 'response'> & { index: number; toolCalls: BGToolCall[]; thinking?: string };

type TurnHistory = {
	old: BGToolCallRound[];
	new: BGToolCallRound[];
	unprocessedSubstantiveRoundCount: number;
};

export type ReadOnlyTurnHistory = {
	old: ReadonlyArray<Readonly<BGToolCallRound>>;
	new: ReadonlyArray<Readonly<BGToolCallRound>>;
	unprocessedSubstantiveRoundCount: number;
};

export class BackgroundTodoAgentSessionHistoryStore extends Disposable {
	private readonly trackedToolCallRoundIds = new Set<string>();
	private readonly turnHistories = new Map<string, TurnHistory>();
	private readonly turnUserRequest = new Map<string, string>();

	private index = 0;

	constructor() {
		super();
		this._register(toDisposable(() => {
			this.trackedToolCallRoundIds.clear();
			this.turnHistories.clear();
			this.turnUserRequest.clear();
		}));
	}

	trackPromptContext(turnId: string, promptContext: IBuildPromptContext) {
		if (!this.turnUserRequest.has(turnId)) {
			this.turnUserRequest.set(turnId, promptContext.query);
		}
		this.trackToolCalls(turnId, promptContext.toolCallRounds ?? []);
	}

	private trackToolCalls(turnId: string, toolCallRounds: readonly IToolCallRound[]) {
		let turnHistory = this.turnHistories.get(turnId);
		if (turnHistory === undefined) {
			turnHistory = { old: [], new: [], unprocessedSubstantiveRoundCount: 0 };
			this.turnHistories.set(turnId, turnHistory);
		}
		const processedToolCalls: BGToolCallRound[] = [];
		toolCallRounds.forEach((tcr => {
			if (!this.trackedToolCallRoundIds.has(tcr.id)) {
				const { toolCallRound, substantiveToolCallCount } = processToolCallRound(this.index++, tcr);
				if (substantiveToolCallCount > 0) {
					turnHistory.unprocessedSubstantiveRoundCount++;
				}
				processedToolCalls.push(toolCallRound);
				this.trackedToolCallRoundIds.add(tcr.id);
			}
		}));
		turnHistory.new.push(...processedToolCalls);
	}

	getTurnHistory(turnId: string): ReadOnlyTurnHistory | undefined {
		const history = this.turnHistories.get(turnId);
		if (history === undefined) {
			return undefined;
		}
		return {
			old: [...history.old],
			new: [...history.new],
			unprocessedSubstantiveRoundCount: history.unprocessedSubstantiveRoundCount,
		};
	}

	markToolCallsAsProcessed(turnId: string, toolCallRoundIds: ReadonlyArray<Readonly<BGToolCallRound>>) {
		const turnHistory = this.turnHistories.get(turnId);
		if (turnHistory === undefined) {
			return;
		}

		const toolCallIdSet = new Set<string>(toolCallRoundIds.map(t => t.id));
		const unprocessedToolCallRounds: BGToolCallRound[] = [];
		for (const toolCallRound of turnHistory.new) {
			if (toolCallIdSet.has(toolCallRound.id)) {
				turnHistory.old.push(toolCallRound);
				if (toolCallRound.toolCalls.length > 0) {
					turnHistory.unprocessedSubstantiveRoundCount--;
				}
			} else {
				unprocessedToolCallRounds.push(toolCallRound);
			}
		}
		turnHistory.new = unprocessedToolCallRounds;
	}
}

function processToolCallRound(index: number, toolCall: IToolCallRound): {
	toolCallRound: BGToolCallRound;
	substantiveToolCallCount: number;
} {
	const substantiveToolCalls = toolCall.toolCalls.filter(isSubstantiveTool);

	const toolCallRound = {
		id: toolCall.id,
		index: index,
		response: toolCall.response,
		thinking: processThinkingData(toolCall.thinking),
		toolCalls: substantiveToolCalls.map(t => ({
			name: t.name,
			arguments: t.arguments.trim().slice(0, 200),
		}))
	};

	return { toolCallRound, substantiveToolCallCount: substantiveToolCalls.length };
}

function processThinkingData(thinkingData: ThinkingData | undefined) {
	const thinkingText = thinkingData?.text;
	if (thinkingText === undefined || typeof thinkingText === 'string') {
		return thinkingText?.trim();
	}
	return thinkingText.join('\n').trim().slice(0, 400);
}

const EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
	ToolName.CoreManageTodoList,
	ToolName.ToolSearch,
	ToolName.CoreAskQuestions,
	ToolName.SwitchAgent,
	ToolName.CoreConfirmationTool,
	ToolName.CoreConfirmationToolWithOptions,
	ToolName.CoreTerminalConfirmationTool,
	ToolName.CoreReviewPlan,
	ToolName.ResolveMemoryFileUri,
	ToolName.Memory,
	ToolName.Skill,
	ToolName.SessionStoreSql,
	ToolName.EditFilesPlaceholder,

	ToolName.Codebase,
	ToolName.FindFiles,
	ToolName.FindTextInFiles,
	ToolName.ReadFile,
	ToolName.ViewImage,
	ToolName.ListDirectory,
	ToolName.ReadProjectStructure,
	ToolName.SearchWorkspaceSymbols,
	ToolName.GetScmChanges,
	ToolName.FetchWebPage,
	ToolName.GithubSemanticRepoSearch,
	ToolName.GithubTextSearch,
	ToolName.FindTestFiles,
	ToolName.GetNotebookSummary,
	ToolName.ReadCellOutput,
	ToolName.CoreTestFailure,

	ToolName.CoreRunInTerminal,
	ToolName.CoreSendToTerminal,
	ToolName.CoreGetTerminalOutput,
	ToolName.CoreKillTerminal,
	ToolName.CoreTerminalSelection,
	ToolName.CoreTerminalLastCommand,
	ToolName.CoreGetTaskOutput,

	ToolName.CoreOpenBrowserPage,
	ToolName.CoreScreenshotPage,
	ToolName.CoreNavigatePage,
	ToolName.CoreReadPage,
	ToolName.CoreRunPlaywrightCode,
]);

function isSubstantiveTool(toolCall: IToolCall): boolean {
	return !EXCLUDED_TOOLS.has(toolCall.name);
}
