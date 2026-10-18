/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Chunk, PrioritizedList, PromptElement, PromptElementProps, UserMessage } from '@vscode/prompt-tsx';
import type { LanguageModelToolResult } from 'vscode';
import { truncate } from '../../../../util/dardcor/base/common/strings';
import { IToolCall, IToolCallRound } from '../../../prompt/common/intents';
import { Tag } from '../base/tag';
import { ToolResult } from '../panel/toolCalling';
import { DefaultOpenAIKeepGoingReminder } from './openai/defaultOpenAIPrompt';
import { SummarizedAgentHistoryProps } from './summarizedConversationHistory';

export class SimpleSummarizedHistory extends PromptElement<SummarizedAgentHistoryProps> {
	override async render() {
		const historyEntries = this.getEntriesToRender();
		const firstEntry = historyEntries.at(0);
		const restEntries = historyEntries.slice(1);

		return <UserMessage priority={this.props.priority}>
			The following is a compressed version of the preceeding history in the current conversation. The first message is kept, some history may be truncated after that:<br />
			{firstEntry && this.renderEntry(firstEntry, Number.MAX_SAFE_INTEGER)}
			<PrioritizedList priority={5000} descending={false}>
				{...restEntries.map(entry => this.renderEntry(entry))}
			</PrioritizedList>
		</UserMessage>;
	}

	private getEntriesToRender(): (IRoundHistoryEntry | string)[] {
		const entries: (IRoundHistoryEntry | string)[] = [];

		for (const round of Array.from(this.props.promptContext.toolCallRounds ?? []).reverse()) {
			entries.unshift({ round, results: this.props.promptContext.toolCallResults });
			if (round.summary) {
				return entries;
			}
		}

		if (this.props.promptContext.query) {
			entries.unshift(this.props.promptContext.query);
		}

		for (const turn of Array.from(this.props.promptContext.history ?? []).reverse()) {
			for (const round of Array.from(turn.rounds).reverse()) {
				const results = turn.resultMetadata?.toolCallResults;
				entries.unshift({ round, results });
				if (round.summary) {
					return entries;
				}
			}
			entries.unshift(turn.request.message);
		}

		return entries;
	}

	private renderEntry(entry: IRoundHistoryEntry | string, priorityOverride?: number) {
		if (typeof entry === 'string') {
			return <ChunkTag name='user' priority={priorityOverride}>
				{entry}
			</ChunkTag>;
		}

		if (entry.round.summary) {
			return <ChunkTag name='conversation-summary' priority={priorityOverride}>
				{entry.round.summary}
				{this.props.endpoint.family === 'gpt-4.1' && <Tag name='reminderInstructions'>
					<DefaultOpenAIKeepGoingReminder />
				</Tag>}
			</ChunkTag>;
		}

		return this.renderRound(entry.round, entry.results ?? {});
	}

	private renderRound(round: IToolCallRound, results: Record<string, LanguageModelToolResult>) {
		const asstMsg = round.response ?
			<ChunkTag name='assistant'>
				{round.response}
			</ChunkTag> :
			<ChunkTag name='assistant' />;
		return [
			asstMsg,
			...round.toolCalls.map(toolCall => this.renderToolCall(toolCall, results[toolCall.id]))
		];
	}

	private renderToolCall(toolCall: IToolCall, result: LanguageModelToolResult | undefined) {
		return <ChunkTag name='tool'>
			Used tool "{toolCall.name}" with arguments: {truncate(toolCall.arguments, 200)}<br />
			{result ?
				<ToolResult content={result.content} truncate={this.props.maxToolResultLength / 2} toolCallId={toolCall.id} sessionId={this.props.promptContext.request?.sessionId} /> :
				<>Tool result empty</>}
		</ChunkTag>;
	}
}

type ChunkTagProps = PromptElementProps<{
	readonly name: string;
	readonly attrs?: Record<string, string | undefined | boolean | number>;
}>;

class ChunkTag extends PromptElement<ChunkTagProps> {
	render() {
		const { name, children, attrs = {} } = this.props;

		return <Chunk>
			<Tag name={name} attrs={attrs}>
				{children}
			</Tag>
		</Chunk>;
	}
}

interface IRoundHistoryEntry {
	readonly round: IToolCallRound;
	readonly results?: Record<string, LanguageModelToolResult>;
}
