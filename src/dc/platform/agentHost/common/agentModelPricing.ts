/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionModelInfo } from './state/protocol/state.js';
import type { IAgentModelInfo } from './agent.js';

export interface IAgentModelPricingMeta {
	readonly multiplierNumeric?: number;
	readonly inputCost?: number;
	readonly cacheCost?: number;
	readonly cacheWriteCost?: number;
	readonly outputCost?: number;
	readonly longContextInputCost?: number;
	readonly longContextCacheCost?: number;
	readonly longContextCacheWriteCost?: number;
	readonly longContextOutputCost?: number;
	readonly priceCategory?: string;
	readonly category?: string;
	readonly discountPercent?: number;
	readonly promo?: {
		readonly id: string;
		readonly discountPercent: number;
		readonly endsAt?: string;
		readonly message: string;
		readonly showBanner?: boolean;
	};
}

const NUMBER_KEYS = [
	'multiplierNumeric',
	'inputCost',
	'cacheCost',
	'cacheWriteCost',
	'outputCost',
	'longContextInputCost',
	'longContextCacheCost',
	'longContextCacheWriteCost',
	'longContextOutputCost',
	'discountPercent',
] as const satisfies readonly (keyof IAgentModelPricingMeta)[];

const COPILOT_MODEL_PICKER_CATEGORY_META_KEY = 'copilot.modelPickerCategory';

export function readAgentModelPricingMeta(model: IAgentModelInfo | SessionModelInfo): IAgentModelPricingMeta {
	const meta = model._meta;
	if (!meta) {
		return {};
	}
	const result: { -readonly [K in keyof IAgentModelPricingMeta]: IAgentModelPricingMeta[K] } = {};
	for (const key of NUMBER_KEYS) {
		const value = meta[key];
		if (typeof value === 'number') {
			result[key] = value;
		}
	}
	if (typeof meta.priceCategory === 'string') {
		result.priceCategory = meta.priceCategory;
	}
	if (typeof meta.category === 'string') {
		result.category = meta.category;
	} else if (typeof meta[COPILOT_MODEL_PICKER_CATEGORY_META_KEY] === 'string') {
		result.category = meta[COPILOT_MODEL_PICKER_CATEGORY_META_KEY];
	}
	const rawPromo = meta.promo;
	if (rawPromo && typeof rawPromo === 'object' && !Array.isArray(rawPromo)) {
		const p = rawPromo as Record<string, unknown>;
		if (typeof p.id === 'string' && typeof p.discountPercent === 'number' && typeof p.message === 'string') {
			result.promo = {
				id: p.id,
				discountPercent: p.discountPercent,
				message: p.message,
				...(typeof p.endsAt === 'string' ? { endsAt: p.endsAt } : {}),
				...(typeof p.showBanner === 'boolean' ? { showBanner: p.showBanner } : {}),
			};
		}
	}
	return result;
}

export function createAgentModelPricingMeta(pricing: IAgentModelPricingMeta): Record<string, unknown> | undefined {
	const entries = Object.entries(pricing).filter(([, value]) => value !== undefined);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function normalizeCAPIBilling(raw: unknown): ICAPIModelBilling | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const billing = raw as Record<string, unknown>;
	const multiplier = typeof billing.multiplier === 'number' ? billing.multiplier : undefined;
	const priceCategory = typeof billing.priceCategory === 'string' ? billing.priceCategory
		: typeof (billing as Record<string, unknown>).price_category === 'string' ? (billing as Record<string, unknown>).price_category as string
			: undefined;
	const discountPercent = typeof billing.discountPercent === 'number' ? billing.discountPercent
		: typeof (billing as Record<string, unknown>).discount_percent === 'number' ? (billing as Record<string, unknown>).discount_percent as number
			: undefined;

	const rawTokenPrices = (billing.tokenPrices ?? billing.token_prices) as Record<string, unknown> | undefined;
	let tokenPrices: ICAPIModelBilling['tokenPrices'] = undefined;
	if (rawTokenPrices && typeof rawTokenPrices === 'object') {
		const defaultTier = rawTokenPrices.default as Record<string, unknown> | undefined;
		const hasDefault = defaultTier && typeof defaultTier === 'object';
		const batchSize = asNumber(rawTokenPrices.batchSize) ?? asNumber(rawTokenPrices.batch_size) ?? 1_000_000;
		const scale = batchSize > 0 ? 1_000_000 / batchSize : 1;
		const price = (...values: unknown[]): number | undefined => {
			const value = values.map(asNumber).find(candidate => candidate !== undefined);
			return value === undefined ? undefined : value * scale;
		};

		const inputPrice = price(rawTokenPrices.inputPrice, hasDefault ? defaultTier.input_price : undefined);
		const cachePrice = price(rawTokenPrices.cacheReadPrice, rawTokenPrices.cachePrice, hasDefault ? defaultTier.cache_read_price : undefined, hasDefault ? defaultTier.cache_price : undefined);
		const cacheWritePrice = price(rawTokenPrices.cacheWritePrice, hasDefault ? defaultTier.cache_write_price : undefined);
		const outputPrice = price(rawTokenPrices.outputPrice, hasDefault ? defaultTier.output_price : undefined);
		const contextMax = asNumber(rawTokenPrices.maxPromptTokens) ?? asNumber(rawTokenPrices.contextMax) ?? asNumber(hasDefault ? defaultTier.max_prompt_tokens : undefined) ?? asNumber(hasDefault ? defaultTier.context_max : undefined);

		const rawLong = (rawTokenPrices.longContext ?? rawTokenPrices.long_context) as Record<string, unknown> | undefined;
		let longContext: { readonly contextMax?: number; readonly inputPrice?: number; readonly cachePrice?: number; readonly cacheWritePrice?: number; readonly outputPrice?: number } | undefined;
		if (rawLong && typeof rawLong === 'object') {
			longContext = {
				inputPrice: price(rawLong.inputPrice, rawLong.input_price),
				cachePrice: price(rawLong.cacheReadPrice, rawLong.cachePrice, rawLong.cache_read_price, rawLong.cache_price),
				cacheWritePrice: price(rawLong.cacheWritePrice, rawLong.cache_write_price),
				outputPrice: price(rawLong.outputPrice, rawLong.output_price),
				contextMax: asNumber(rawLong.maxPromptTokens) ?? asNumber(rawLong.contextMax) ?? asNumber(rawLong.max_prompt_tokens) ?? asNumber(rawLong.context_max),
			};
		}

		tokenPrices = { inputPrice, cachePrice, cacheWritePrice, outputPrice, contextMax, longContext };
	}

	return { multiplier, priceCategory, discountPercent, promo: normalizePromo(billing), tokenPrices };
}

function asNumber(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

function normalizePromo(billing: Record<string, unknown>): ICAPIModelBilling['promo'] {
	const raw = billing.promo as Record<string, unknown> | undefined;
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const id = typeof raw.id === 'string' ? raw.id : undefined;
	const discountPercent = asNumber(raw.discountPercent) ?? asNumber(raw.discount_percent);
	const endsAt = typeof raw.endsAt === 'string' ? raw.endsAt
		: typeof raw.ends_at === 'string' ? raw.ends_at
			: undefined;
	const message = typeof raw.message === 'string' ? raw.message : undefined;
	const showBanner = typeof raw.showBanner === 'boolean' ? raw.showBanner
		: typeof raw.show_banner === 'boolean' ? raw.show_banner
			: undefined;
	if (id && typeof discountPercent === 'number' && message) {
		return { id, discountPercent, message, ...(endsAt ? { endsAt } : {}), ...(showBanner !== undefined ? { showBanner } : {}) };
	}
	return undefined;
}

export interface ICAPIModelBilling {
	readonly multiplier?: number;
	readonly priceCategory?: string;
	readonly discountPercent?: number;
	readonly promo?: {
		readonly id: string;
		readonly discountPercent: number;
		readonly endsAt?: string;
		readonly message: string;
		readonly showBanner?: boolean;
	};
	readonly tokenPrices?: {
		readonly contextMax?: number;
		readonly inputPrice?: number;
		readonly cachePrice?: number;
		readonly cacheWritePrice?: number;
		readonly outputPrice?: number;
		readonly longContext?: {
			readonly contextMax?: number;
			readonly inputPrice?: number;
			readonly cachePrice?: number;
			readonly cacheWritePrice?: number;
			readonly outputPrice?: number;
		};
	};
}

export function createPricingMetaFromBilling(billing: ICAPIModelBilling | undefined, priceCategory?: string, category?: string): Record<string, unknown> | undefined {
	const tokenPrices = billing?.tokenPrices;
	const longContext = tokenPrices?.longContext;

	const showLongContext = longContext !== undefined && (
		(longContext.inputPrice !== undefined && longContext.inputPrice !== tokenPrices?.inputPrice) ||
		(longContext.outputPrice !== undefined && longContext.outputPrice !== tokenPrices?.outputPrice) ||
		(longContext.cachePrice !== undefined && longContext.cachePrice !== tokenPrices?.cachePrice) ||
		(longContext.cacheWritePrice !== undefined && longContext.cacheWritePrice !== tokenPrices?.cacheWritePrice)
	);

	return createAgentModelPricingMeta({
		multiplierNumeric: typeof billing?.multiplier === 'number' ? billing.multiplier : undefined,
		inputCost: tokenPrices?.inputPrice,
		cacheCost: tokenPrices?.cachePrice,
		cacheWriteCost: tokenPrices?.cacheWritePrice,
		outputCost: tokenPrices?.outputPrice,
		longContextInputCost: showLongContext ? (longContext.inputPrice ?? tokenPrices?.inputPrice) : undefined,
		longContextCacheCost: showLongContext ? (longContext.cachePrice ?? tokenPrices?.cachePrice) : undefined,
		longContextCacheWriteCost: showLongContext ? (longContext.cacheWritePrice ?? tokenPrices?.cacheWritePrice) : undefined,
		longContextOutputCost: showLongContext ? (longContext.outputPrice ?? tokenPrices?.outputPrice) : undefined,
		priceCategory: priceCategory ?? (typeof billing?.priceCategory === 'string' ? billing.priceCategory : undefined),
		category,
		discountPercent: typeof billing?.discountPercent === 'number' ? billing.discountPercent : undefined,
		promo: billing?.promo,
	});
}

export function hasLongContextSurcharge(billing: ICAPIModelBilling | undefined): boolean {
	const tokenPrices = billing?.tokenPrices;
	const longContext = tokenPrices?.longContext;
	if (!longContext) {
		return false;
	}
	return (longContext.inputPrice !== undefined && longContext.inputPrice !== tokenPrices?.inputPrice)
		|| (longContext.outputPrice !== undefined && longContext.outputPrice !== tokenPrices?.outputPrice)
		|| (longContext.cachePrice !== undefined && longContext.cachePrice !== tokenPrices?.cachePrice)
		|| (longContext.cacheWritePrice !== undefined && longContext.cacheWritePrice !== tokenPrices?.cacheWritePrice);
}
