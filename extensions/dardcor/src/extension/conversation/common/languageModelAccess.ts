/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { IChatEndpoint, IChatEndpointTokenPricing } from '../../../platform/networking/common/networking';
import * as l10n from '@vscode/l10n';
import type { LanguageModelChatInformation, LanguageModelConfigurationSchema } from 'vscode';

export function pickDefaultReasoningEffort(effortLevels: readonly string[], family: string): string | undefined {
	if (effortLevels.length === 0) {
		return undefined;
	}
	const lowerFamily = family.toLowerCase();
	const preferred = lowerFamily.startsWith('claude') || lowerFamily.includes('kimi-k3') ? 'high' : 'medium';
	if (effortLevels.includes(preferred)) {
		return preferred;
	}
	return effortLevels[0];
}

export function getReasoningEffortDescription(level: string): string {
	switch (level) {
		case 'none': return l10n.t('No reasoning applied');
		case 'minimal': return l10n.t('Minimal reasoning for fastest responses');
		case 'low': return l10n.t('Faster responses with less reasoning');
		case 'medium': return l10n.t('Balanced reasoning and speed');
		case 'high': return l10n.t('Greater reasoning depth but slower');
		case 'xhigh': return l10n.t('Highest reasoning depth but slowest');
		case 'max': return l10n.t('Absolute maximum capability with no constraints');
		default: return level;
	}
}

export function getReasoningEffortLabel(level: string): string {
	switch (level) {
		case 'none': return l10n.t('None');
		case 'minimal': return l10n.t('Minimal');
		case 'low': return l10n.t('Low');
		case 'medium': return l10n.t('Medium');
		case 'high': return l10n.t('High');
		case 'xhigh': return l10n.t('Extra High');
		case 'max': return l10n.t('Max');
		default: return level.charAt(0).toUpperCase() + level.slice(1);
	}
}

export function buildReasoningEffortSchemaProperty(effortLevels: readonly string[], family: string): NonNullable<LanguageModelConfigurationSchema['properties']>[string] {
	return {
		type: 'string',
		title: l10n.t('Thinking Effort'),
		enum: effortLevels,
		enumItemLabels: effortLevels.map(getReasoningEffortLabel),
		enumDescriptions: effortLevels.map(getReasoningEffortDescription),
		default: pickDefaultReasoningEffort(effortLevels, family),
		group: 'navigation',
	};
}

export function getModelCapabilitiesDescription(endpoint: IChatEndpoint | LanguageModelChatInformation | { name: string; family: string }): string | undefined {
	const name = endpoint.name.toLowerCase();
	const family = endpoint.family.toLowerCase();

	if (family.includes('claude') || name.includes('claude')) {
		if (name.includes('opus')) {
			return l10n.t('Most capable Claude model. Excellent for complex analysis, coding tasks, and nuanced creative writing.');
		}
		if (name.includes('sonnet')) {
			return l10n.t('Balanced Claude model offering strong performance for everyday coding and chat tasks at faster speeds.');
		}
		if (name.includes('haiku')) {
			return l10n.t('Fastest and most compact Claude model. Ideal for quick responses and simple tasks.');
		}
	}

	if (family.includes('gpt') || name.includes('gpt') || family.includes('codex') || name.includes('codex')) {
		if (name.includes('codex') || family.includes('codex')) {
			return l10n.t('OpenAI Codex model specialized for code generation, debugging, and software development tasks.');
		}
		if (name.includes('mini')) {
			return l10n.t('Lightweight GPT model for quick responses and simple tasks with low latency.');
		}
		if (name.includes('dardcor')) {
			return l10n.t('GPT model fine-tuned for Dardcor AI code completions.');
		}
		if (name.includes('4o')) {
			return l10n.t('Optimized GPT-4 model with faster responses and multimodal capabilities.');
		}
		if (name.includes('4.1')) {
			return l10n.t('Enhanced GPT-4 model with improved instruction following and coding performance.');
		}
		return l10n.t('OpenAI GPT model for coding and general assistance.');
	}

	if (family.includes('gemini') || name.includes('gemini')) {
		if (name.includes('flash')) {
			return l10n.t('Fast and efficient Gemini model optimized for quick responses and high throughput.');
		}
		if (name.includes('pro')) {
			return l10n.t("Google's advanced Gemini Pro model with strong reasoning and coding capabilities.");
		}
		return l10n.t('Google Gemini model with balanced performance for coding and general assistance.');
	}

	if (family.includes('grok') || name.includes('grok')) {
		return l10n.t('xAI Grok model optimized for fast code generation and development tasks.');
	}

	return undefined;
}

const AUTO_MODEL_DOCS_URL = 'https://docs.github.com/en/dardcor/concepts/models/auto-model-selection';

function classifyDiscountRange(discountRange?: { low: number; high: number }): { low: number; high?: number } | undefined {
	if (!discountRange) {
		return undefined;
	}
	const low = Math.round(discountRange.low * 100);
	const high = Math.round(discountRange.high * 100);
	if (low === high) {
		return low !== 0 ? { low } : undefined;
	}
	return { low, high };
}

export function getAutoModelDiscountLabel(discountRange?: { low: number; high: number }): string | undefined {
	const discount = classifyDiscountRange(discountRange);
	if (!discount) {
		return undefined;
	}
	return discount.high === undefined
		? l10n.t('{0}% discount', discount.low)
		: l10n.t('{0}% to {1}% discount', discount.low, discount.high);
}

export function getAutoModelDescription(discountRange?: { low: number; high: number }): string {
	const base = l10n.t('Auto routes based on your task and real-time system health and model performance.');
	const learnMore = l10n.t('[Learn More]({0})', AUTO_MODEL_DOCS_URL);
	const discount = classifyDiscountRange(discountRange);
	const discountSentence = !discount
		? undefined
		: discount.high === undefined
			? l10n.t('Models routed via auto receive a {0}% discount.', discount.low)
			: l10n.t('Models routed via auto receive a {0}% to {1}% discount.', discount.low, discount.high);
	return discountSentence ? `${base} ${discountSentence} ${learnMore}` : `${base} ${learnMore}`;
}

function formatAicPrice(price: number): string {
	if (price === 0) {
		return '0';
	}
	if (price < 0.01) {
		return price.toExponential(2);
	}
	return price.toFixed(4).replace(/\.?0+$/, '');
}

export function formatTokenCount(count: number): string {
	if (count >= 1_000_000) {
		const value = count / 1_000_000;
		const floored = Math.floor(value * 10) / 10;
		return floored % 1 === 0 ? `${floored.toFixed(0)}M` : `${floored.toFixed(1)}M`;
	} else if (count > 900_000) {
		return '1M';
	} else if (count >= 1000) {
		return `${Math.round(count / 1000)}K`;
	}
	return count.toString();
}

export function formatPricingLabel(pricing: IChatEndpointTokenPricing): string {
	return l10n.t(
		'In: {0} · Out: {1} AICs/1M tokens',
		formatAicPrice(pricing.default.inputPrice),
		formatAicPrice(pricing.default.outputPrice),
	);
}

const TOKENS_PER_MILLION = 1_000_000;
const NANO_AIU_DIVISOR = 1_000_000_000;

export interface IRawTokenPrices {
	batch_size?: number;
	input_price?: number;
	cache_price?: number;
	output_price?: number;
	default?: { input_price?: number; cache_price?: number; cache_write_price?: number; output_price?: number; context_max?: number };
	long_context?: { input_price?: number; cache_price?: number; cache_write_price?: number; output_price?: number; context_max?: number };
}

export interface INormalizedPriceTier {
	readonly inputPrice: number;
	readonly outputPrice: number;
	readonly cachePrice: number | undefined;
	readonly cacheWritePrice: number | undefined;
	readonly contextMax?: number;
}

export interface INormalizedTokenPricing {
	readonly default: INormalizedPriceTier;
	readonly longContext?: INormalizedPriceTier;
}

export function normalizeTokenPrices(tokenPrices: IRawTokenPrices | undefined): INormalizedTokenPricing | undefined {
	if (!tokenPrices) {
		return undefined;
	}
	const batchSize = tokenPrices.batch_size ?? TOKENS_PER_MILLION;
	const scale = TOKENS_PER_MILLION / batchSize;
	const defaultTier = tokenPrices.default;

	if (defaultTier && defaultTier.input_price !== undefined && defaultTier.output_price !== undefined) {
		const normalized: INormalizedPriceTier = {
			inputPrice: defaultTier.input_price * scale,
			outputPrice: defaultTier.output_price * scale,
			cachePrice: defaultTier.cache_price !== undefined ? defaultTier.cache_price * scale : undefined,
			cacheWritePrice: defaultTier.cache_write_price !== undefined ? defaultTier.cache_write_price * scale : undefined,
			contextMax: defaultTier.context_max,
		};
		let longContext: INormalizedPriceTier | undefined;
		const lc = tokenPrices.long_context;
		if (lc && lc.input_price !== undefined && lc.output_price !== undefined) {
			const lcNormalized: INormalizedPriceTier = {
				inputPrice: lc.input_price * scale,
				outputPrice: lc.output_price * scale,
				cachePrice: lc.cache_price !== undefined ? lc.cache_price * scale : undefined,
				cacheWritePrice: lc.cache_write_price !== undefined ? lc.cache_write_price * scale : undefined,
				contextMax: lc.context_max,
			};
			if (lcNormalized.inputPrice !== normalized.inputPrice
				|| lcNormalized.outputPrice !== normalized.outputPrice
				|| lcNormalized.cachePrice !== normalized.cachePrice
				|| lcNormalized.cacheWritePrice !== normalized.cacheWritePrice) {
				longContext = lcNormalized;
			}
		}
		return { default: normalized, longContext };
	}

	if (tokenPrices.input_price === undefined || tokenPrices.output_price === undefined) {
		return undefined;
	}
	return {
		default: {
			inputPrice: (tokenPrices.input_price / NANO_AIU_DIVISOR) * scale,
			outputPrice: (tokenPrices.output_price / NANO_AIU_DIVISOR) * scale,
			cachePrice: tokenPrices.cache_price !== undefined ? (tokenPrices.cache_price / NANO_AIU_DIVISOR) * scale : undefined,
			cacheWritePrice: undefined,
		},
	};
}
