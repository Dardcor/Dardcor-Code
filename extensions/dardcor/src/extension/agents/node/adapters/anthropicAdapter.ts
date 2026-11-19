/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import * as http from 'http';
import type { OpenAiFunctionTool } from '../../../../platform/networking/common/fetch';
import { IMakeChatRequestOptions } from '../../../../platform/networking/common/networking';
import { APIUsage } from '../../../../platform/networking/common/openai';
import { coalesce } from '../../../../util/dardcor/base/common/arrays';
import { anthropicMessagesToRawMessages } from '../../../byok/common/anthropicMessageConverter';
import { IAgentStreamBlock, IParsedRequest, IProtocolAdapter, IProtocolAdapterFactory, IStreamEventData, IStreamingContext } from './types';

export class AnthropicAdapterFactory implements IProtocolAdapterFactory {
	createAdapter(): IProtocolAdapter {
		return new AnthropicAdapter();
	}
}

class AnthropicAdapter implements IProtocolAdapter {
	readonly name = 'anthropic';

	private currentBlockIndex = 0;
	private hasTextBlock = false;
	private hadToolCalls = false;
	parseRequest(body: string): IParsedRequest {
		const requestBody: Anthropic.MessageStreamParams = JSON.parse(body);

		let systemText = '';
		if (typeof requestBody.system === 'string') {
			systemText = requestBody.system;
		} else if (Array.isArray(requestBody.system) && requestBody.system.length > 0) {
			systemText = requestBody.system.map(s => s.text).join('\n');
		}

		const type = systemText.includes('You are a helpful AI assistant tasked with summarizing conversations') ? 'summary' : undefined;

		const rawMessages = anthropicMessagesToRawMessages(requestBody.messages, { type: 'text', text: systemText });

		const options: IMakeChatRequestOptions['requestOptions'] = {
			temperature: requestBody.temperature,
		};

		if (requestBody.tools && requestBody.tools.length > 0) {
			const tools = coalesce(requestBody.tools.map(tool => {
				if ('input_schema' in tool) {
					const chatTool: OpenAiFunctionTool = {
						type: 'function',
						function: {
							name: tool.name,
							description: tool.description || '',
							parameters: tool.input_schema || {},
						}
					};
					return chatTool;
				}
				return undefined;
			}));
			if (tools.length) {
				options.tools = tools;
			}
		}

		return {
			model: requestBody.model,
			messages: rawMessages,
			options,
			type
		};
	}

	formatStreamResponse(
		streamData: IAgentStreamBlock,
		context: IStreamingContext
	): IStreamEventData[] {
		const events: IStreamEventData[] = [];

		if (streamData.type === 'text') {
			if (!this.hasTextBlock) {
				const contentBlockStart: Anthropic.RawContentBlockStartEvent = {
					type: 'content_block_start',
					index: this.currentBlockIndex,
					content_block: {
						type: 'text',
						text: '',
						citations: null
					}
				};
				events.push({
					event: contentBlockStart.type,
					data: this.formatEventData(contentBlockStart)
				});
				this.hasTextBlock = true;
			}

			const contentDelta: Anthropic.RawContentBlockDeltaEvent = {
				type: 'content_block_delta',
				index: this.currentBlockIndex,
				delta: {
					type: 'text_delta',
					text: streamData.content
				}
			};
			events.push({
				event: contentDelta.type,
				data: this.formatEventData(contentDelta)
			});

		} else if (streamData.type === 'tool_call') {
			if (this.hasTextBlock) {
				const contentBlockStop: Anthropic.RawContentBlockStopEvent = {
					type: 'content_block_stop',
					index: this.currentBlockIndex
				};
				events.push({
					event: contentBlockStop.type,
					data: this.formatEventData(contentBlockStop)
				});
				this.currentBlockIndex++;
				this.hasTextBlock = false;
			}

			this.hadToolCalls = true;

			const toolBlockStart: Anthropic.RawContentBlockStartEvent = {
				type: 'content_block_start',
				index: this.currentBlockIndex,
				content_block: {
					type: 'tool_use',
					id: streamData.callId,
					name: streamData.name,
					input: {},
					caller: { type: 'direct' },
				}
			};
			events.push({
				event: toolBlockStart.type,
				data: this.formatEventData(toolBlockStart)
			});

			const toolBlockContent: Anthropic.RawContentBlockDeltaEvent = {
				type: 'content_block_delta',
				index: this.currentBlockIndex,
				delta: {
					type: 'input_json_delta',
					partial_json: JSON.stringify(streamData.input || {})
				}
			};
			events.push({
				event: toolBlockContent.type,
				data: this.formatEventData(toolBlockContent)
			});

			const toolBlockStop: Anthropic.RawContentBlockStopEvent = {
				type: 'content_block_stop',
				index: this.currentBlockIndex
			};
			events.push({
				event: toolBlockStop.type,
				data: this.formatEventData(toolBlockStop)
			});

			this.currentBlockIndex++;
		}

		return events;
	}

	generateFinalEvents(context: IStreamingContext, usage?: APIUsage): IStreamEventData[] {
		const events: IStreamEventData[] = [];

		if (this.hasTextBlock) {
			const contentBlockStop: Anthropic.RawContentBlockStopEvent = {
				type: 'content_block_stop',
				index: this.currentBlockIndex
			};
			events.push({
				event: contentBlockStop.type,
				data: this.formatEventData(contentBlockStop)
			});
		}

		const adjustedUsage = this.adjustTokenUsageForContextWindow(context, usage);

		const messageDelta: Anthropic.RawMessageDeltaEvent = {
			type: 'message_delta',
			delta: {
				stop_reason: this.hadToolCalls ? 'tool_use' : 'end_turn',
				stop_sequence: null,
				stop_details: null,
				container: null
			},
			usage: {
				output_tokens: adjustedUsage.completion_tokens,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				input_tokens: adjustedUsage.prompt_tokens,
				server_tool_use: null
			}
		};
		events.push({
			event: messageDelta.type,
			data: this.formatEventData(messageDelta)
		});

		const messageStop: Anthropic.RawMessageStopEvent = {
			type: 'message_stop'
		};
		events.push({
			event: messageStop.type,
			data: this.formatEventData(messageStop)
		});

		return events;
	}

	private adjustTokenUsageForContextWindow(context: IStreamingContext, usage?: APIUsage): APIUsage {
		if (!usage) {
			return {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0
			};
		}

		if (context.endpoint.modelId === 'gpt-4o-mini') {
			return usage;
		}

		const realContextLimit = context.endpoint.modelMaxPromptTokens;
		const agentAssumedContextLimit = 200000;

		const scalingFactor = agentAssumedContextLimit / realContextLimit;

		const adjustedPromptTokens = Math.floor(usage.prompt_tokens * scalingFactor);
		const adjustedCompletionTokens = Math.floor(usage.completion_tokens * scalingFactor);
		const adjustedTotalTokens = adjustedPromptTokens + adjustedCompletionTokens;

		return {
			...usage,
			prompt_tokens: adjustedPromptTokens,
			completion_tokens: adjustedCompletionTokens,
			total_tokens: adjustedTotalTokens,
		};
	}

	generateInitialEvents(context: IStreamingContext): IStreamEventData[] {
		const adjustedUsage = this.adjustTokenUsageForContextWindow(context, undefined);

		const messageStart: Anthropic.RawMessageStartEvent = {
			type: 'message_start',
			message: {
				id: context.requestId,
				type: 'message',
				role: 'assistant',
				model: context.endpoint.modelId,
				content: [],
				container: null,
				stop_reason: null,
				stop_sequence: null,
				stop_details: null,
				usage: {
					input_tokens: adjustedUsage.prompt_tokens,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
					output_tokens: 1,
					service_tier: null,
					server_tool_use: null,
					cache_creation: null,
				} as Anthropic.Usage
			}
		};

		return [{
			event: messageStart.type,
			data: this.formatEventData(messageStart)
		}];
	}

	getContentType(): string {
		return 'text/event-stream';
	}

	extractAuthKey(headers: http.IncomingHttpHeaders): string | undefined {
		return headers['x-api-key'] as string | undefined;
	}

	private formatEventData(data: unknown): string {
		return JSON.stringify(data).replace(/\n/g, '\\n');
	}
}
