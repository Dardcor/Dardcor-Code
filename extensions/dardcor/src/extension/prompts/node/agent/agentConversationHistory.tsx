/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AssistantMessage, BasePromptElementProps, Chunk, PrioritizedList, PromptElement, PromptSizing, UserMessage } from '@vscode/prompt-tsx';
import { IResultMetadata, Turn } from '../../../prompt/common/conversation';
import { IBuildPromptContext } from '../../../prompt/common/intents';
import { Tag } from '../base/tag';
import { ChatVariables } from '../panel/chatVariables';
import { ChatToolCalls } from '../panel/toolCalling';
import { EditedFileEvents, renderedMessageToTsxChildren } from './agentPrompt';

export interface AgentUserMessageInHistoryProps extends BasePromptElementProps {
	readonly turn: Turn;
	readonly userQueryTagName?: string;
}

export class AgentUserMessageInHistory extends PromptElement<AgentUserMessageInHistoryProps> {
	constructor(
		props: AgentUserMessageInHistoryProps,
	) {
		super(props);
	}

	override async render(state: void, sizing: PromptSizing) {
		const turn = this.props.turn;
		return <UserMessage>
			{turn.promptVariables && <ChatVariables flexGrow={1} priority={898} chatVariables={turn.promptVariables} isAgent={true} omitReferences />}
			{turn.editedFileEvents?.length &&
				<Tag name='context'>
					<EditedFileEvents flexGrow={2} editedFileEvents={turn.editedFileEvents} />
				</Tag>}
			<Tag name={this.props.userQueryTagName ?? 'userRequest'}>{turn.request.message}</Tag>
		</UserMessage>;
	}
}

export interface AgentConversationHistoryProps extends BasePromptElementProps {
	readonly priority: number;
	readonly promptContext: IBuildPromptContext;
	readonly userQueryTagName?: string;
}

export class AgentConversationHistory extends PromptElement<AgentConversationHistoryProps> {
	override async render(state: void, sizing: PromptSizing) {
		const history: PromptElement[] = [];
		const contextHistory = this.props.promptContext.history;

		let summaryTurnIndex = -1;
		let summaryRoundIndex = -1;
		findSummary: for (let t = contextHistory.length - 1; t >= 0; t--) {
			const rounds = contextHistory[t].rounds;
			for (let r = rounds.length - 1; r >= 0; r--) {
				if (rounds[r].summary) {
					summaryTurnIndex = t;
					summaryRoundIndex = r;
					break findSummary;
				}
			}
		}

		for (const [i, turn] of contextHistory.entries()) {
			if (i < summaryTurnIndex) {
				continue;
			}

			const metadata = turn.responseChatResult?.metadata as IResultMetadata | undefined;
			const isSummaryTurn = i === summaryTurnIndex;
			const rounds = turn.rounds;

			if (isSummaryTurn) {
				history.push(<UserMessage><Tag name='conversation-summary'>{rounds[summaryRoundIndex].summary}</Tag></UserMessage>);
			} else if (metadata?.renderedUserMessage) {
				history.push(<UserMessage><Chunk>{renderedMessageToTsxChildren(metadata.renderedUserMessage, false)}</Chunk></UserMessage>);
			} else {
				history.push(<AgentUserMessageInHistory turn={turn} userQueryTagName={this.props.userQueryTagName} />);
			}

			if (Array.isArray(metadata?.toolCallRounds) && metadata.toolCallRounds?.length > 0) {
				const toolCallRounds = isSummaryTurn ? rounds.slice(summaryRoundIndex + 1) : metadata.toolCallRounds;
				if (toolCallRounds.length > 0) {
					const toolCallResultInNextTurn = metadata.maxToolCallsExceeded;
					let toolCallResults = metadata.toolCallResults;
					if (toolCallResultInNextTurn) {
						const nextMetadata = contextHistory.at(i + 1)?.responseChatResult?.metadata as IResultMetadata | undefined;
						const mergeFrom = i === contextHistory.length - 1 ? this.props.promptContext.toolCallResults : nextMetadata?.toolCallResults;
						toolCallResults = { ...toolCallResults, ...mergeFrom };
					}

					history.push(<ChatToolCalls
						promptContext={this.props.promptContext}
						toolCallRounds={toolCallRounds}
						toolCallResults={toolCallResults}
						isHistorical={!(toolCallResultInNextTurn && i === contextHistory.length - 1)}
					/>);
				}
			} else if (!isSummaryTurn && turn.responseMessage) {
				history.push(<AssistantMessage>{turn.responseMessage?.message}</AssistantMessage>);
			}
		}

		return (<PrioritizedList priority={this.props.priority} descending={false}>{history}</PrioritizedList>);
	}
}
