/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDardcorRouterModel {
	readonly id: string;
	readonly object?: string;
	readonly name: string;
	readonly vendor: string;
	readonly owned_by?: string;
	readonly model_picker_enabled: boolean;
	readonly is_chat_default: boolean;
	readonly is_chat_fallback: boolean;
	readonly model_picker_price_category?: string;
	readonly supported_endpoints?: readonly string[];
	readonly preview?: boolean;
	readonly billing?: {
		readonly is_premium?: boolean;
		readonly multiplier?: number;
		readonly restricted_to?: readonly string[];
		readonly token_prices?: {
			readonly default?: IDardcorRouterModelPriceTier;
			readonly long_context?: IDardcorRouterModelPriceTier;
		};
	};
	readonly capabilities?: {
		readonly contextWindow?: number;
		readonly maxOutput?: number;
		readonly tools?: boolean;
		readonly vision?: boolean;
		readonly reasoning?: boolean;
		readonly thinkingFormat?: string;
		readonly reasoning_effort?: readonly string[];
		readonly limits?: {
			readonly max_context_window_tokens?: number;
			readonly max_output_tokens?: number;
			readonly max_prompt_tokens?: number;
		};
		readonly supports?: {
			readonly tool_calls?: boolean;
			readonly vision?: boolean;
			readonly reasoning_effort?: readonly string[];
			readonly adaptive_thinking?: boolean;
		};
	};
	readonly context_length?: number;
	readonly max_completion_tokens?: number;
	readonly policy?: { readonly state?: string; readonly terms?: string };
}

export interface IDardcorRouterModelPriceTier {
	readonly input_price?: number;
	readonly output_price?: number;
	readonly cache_price?: number;
	readonly cache_write_price?: number;
	readonly context_max?: number;
}
