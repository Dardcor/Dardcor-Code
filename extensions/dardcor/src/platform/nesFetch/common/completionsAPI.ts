/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DardcorAnnotation } from '../../completions-core/common/openai/dardcorAnnotations';

export interface Completion {
	choices: Completion.Choice[];
	system_fingerprint: string;
	object: string;
	usage: Completion.Usage | undefined;
}

export namespace Completion {
	export interface Choice {
		index: number;
		finish_reason: FinishReason | null;
		logprobs?: LogProbs | null;
		text: string | undefined;
		dardcor_annotations?: { [key: string]: DardcorAnnotation[] };
	}

	export enum FinishReason {
		Stop = 'stop',
		Length = 'length',
		ContentFilter = 'content_filter',
	}

	export type LogProbs = {
		tokens: string[];
		token_logprobs: number[];
		text_offset: number[];
		top_logprobs: Record<string, number>[];
	};

	export interface Usage {
		completion_tokens: number;
		prompt_tokens: number;
		total_tokens: number;
		completion_tokens_details: TokensDetails;
		prompt_tokens_details: TokensDetails;
	}

	export interface TokensDetails {
		audio_tokens: number;
		reasoning_tokens: number;
	}
}
