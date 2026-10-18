/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import * as http from 'http';
import type { IMakeChatRequestOptions } from '../../../../platform/networking/common/networking';
import { APIUsage } from '../../../../platform/networking/common/openai';

export interface IParsedRequest {
	readonly model?: string;
	readonly messages: readonly Raw.ChatMessage[];
	readonly options?: IMakeChatRequestOptions['requestOptions'];
	readonly type?: string;
}

export interface IStreamEventData {
	readonly event: string;
	readonly data: string;
}

export interface IAgentTextBlock {
	readonly type: 'text';
	readonly content: string;
}

export interface IAgentToolCallBlock {
	readonly type: 'tool_call';
	readonly callId: string;
	readonly name: string;
	readonly input: object;
}

export type IAgentStreamBlock = IAgentTextBlock | IAgentToolCallBlock;

export interface IProtocolAdapter {
	readonly name: string;

	parseRequest(body: string): IParsedRequest;

	formatStreamResponse(
		streamData: IAgentStreamBlock,
		context: IStreamingContext
	): readonly IStreamEventData[];

	generateFinalEvents(context: IStreamingContext, usage?: APIUsage): readonly IStreamEventData[];

	generateInitialEvents?(context: IStreamingContext): readonly IStreamEventData[];

	getContentType(): string;

	extractAuthKey(headers: http.IncomingHttpHeaders): string | undefined;
}

export interface IProtocolAdapterFactory {
	createAdapter(): IProtocolAdapter;
}

export interface IStreamingContext {
	readonly requestId: string;
	readonly endpoint: {
		readonly modelId: string;
		readonly modelMaxPromptTokens: number;
	};
}
