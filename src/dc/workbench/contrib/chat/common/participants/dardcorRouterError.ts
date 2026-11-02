export function parseResetSeconds(delayStr?: string): number | undefined {
	if (!delayStr) {
		return undefined;
	}
	const str = delayStr.trim();
	const hMatch = str.match(/(\d+)\s*h(?:ours?|r)?/i);
	const mMatch = str.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
	const sMatch = str.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?/i);
	if (hMatch || mMatch || sMatch) {
		const h = hMatch ? parseInt(hMatch[1], 10) : 0;
		const m = mMatch ? parseInt(mMatch[1], 10) : 0;
		const s = sMatch ? parseFloat(sMatch[1]) : 0;
		const total = h * 3600 + m * 60 + Math.ceil(s);
		return total > 0 ? total : undefined;
	}
	const numMatch = str.match(/\b(\d+(?:\.\d+)?)\b/);
	if (numMatch) {
		const num = parseFloat(numMatch[1]);
		return !isNaN(num) && num > 0 ? Math.ceil(num) : undefined;
	}
	return undefined;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IParsedRouterError {
	statusCode: number;
	model?: string;
	provider?: string;
	statusMessage?: string;
	userMessage: string;
	resetDelay?: string;
	resetTimeStamp?: string;
	resetAfterSec?: number;
	isQuotaExhausted: boolean;
	isInsufficientCredits?: boolean;
	isForbiddenPlan?: boolean;
	isUnauthorized?: boolean;
	suggestedFreeModels?: string[];
	buyCreditsUrl?: string;
	currentBalance?: number;
	technicalDetails?: string;
}

export function parseDardcorRouterError(statusCode: number, rawError: string, fallbackModel?: string): IParsedRouterError {
	let detectedModel = fallbackModel;
	let detectedProvider: string | undefined;
	let userMessage = '';
	let statusMessage = '';
	let resetDelay: string | undefined;
	let resetTimeStamp: string | undefined;
	let resetAfterSec: number | undefined;
	let isQuotaExhausted = statusCode === 429;
	let isInsufficientCredits = statusCode === 402;
	let isForbiddenPlan = statusCode === 403;
	let isUnauthorized = statusCode === 401;
	let suggestedFreeModels: string[] | undefined;
	let buyCreditsUrl: string | undefined;
	let currentBalance: number | undefined;

	const trimmed = (rawError || '').trim();

	const bracketMatch = trimmed.match(/^\[([a-zA-Z0-9_\-\./]+)\]\s*(?:\[(\d{3})\])?:?\s*([\s\S]*)$/);
	let innerPayload = trimmed;
	if (bracketMatch) {
		const tag = bracketMatch[1];
		if (bracketMatch[2]) {
			const parsedCode = parseInt(bracketMatch[2], 10);
			if (!isNaN(parsedCode) && parsedCode > 0) {
				statusCode = parsedCode;
				if (statusCode === 429) {
					isQuotaExhausted = true;
				}
			}
		}
		if (tag.includes('/')) {
			const parts = tag.split('/');
			detectedProvider = parts[0];
			detectedModel = parts.slice(1).join('/');
		} else {
			detectedModel = tag;
		}
		innerPayload = bracketMatch[3] || '';
	}

	let parsedJson: any;
	try {
		parsedJson = JSON.parse(trimmed);
	} catch {
		const jsonMatch = innerPayload.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				parsedJson = JSON.parse(jsonMatch[0]);
			} catch { }
		}
	}

	if (parsedJson) {
		let errObj = parsedJson.error ?? parsedJson;

		if (typeof errObj?.message === 'string') {
			const nestedBracket = errObj.message.match(/^\[([a-zA-Z0-9_\-\./]+)\]\s*(?:\[(\d{3})\])?:?\s*([\s\S]*)$/);
			let nestedPayload = errObj.message;
			if (nestedBracket) {
				const tag = nestedBracket[1];
				if (tag.includes('/')) {
					const parts = tag.split('/');
					detectedProvider = detectedProvider || parts[0];
					detectedModel = parts.slice(1).join('/');
				} else {
					detectedModel = tag;
				}
				if (nestedBracket[2]) {
					const parsedCode = parseInt(nestedBracket[2], 10);
					if (parsedCode === 429) isQuotaExhausted = true;
				}
				nestedPayload = nestedBracket[3] || '';
			}

			const resetAfterMatch = errObj.message.match(/\(reset after ([^\)]+)\)/i);
			if (resetAfterMatch) {
				resetDelay = resetAfterMatch[1];
			}

			const innerJsonMatch = nestedPayload.match(/\{[\s\S]*\}/);
			if (innerJsonMatch) {
				try {
					const innerParsed = JSON.parse(innerJsonMatch[0]);
					if (innerParsed.error) {
						errObj = innerParsed.error;
					} else {
						errObj = innerParsed;
					}
				} catch { }
			}
		}

		if (typeof errObj === 'object' && errObj !== null) {
			if (typeof errObj.resetAfterSec === 'number') {
				resetAfterSec = errObj.resetAfterSec;
			} else if (typeof parsedJson.resetAfterSec === 'number') {
				resetAfterSec = parsedJson.resetAfterSec;
			} else if (typeof parsedJson.error?.resetAfterSec === 'number') {
				resetAfterSec = parsedJson.error.resetAfterSec;
			}
			if (errObj.retryAfter && !resetAfterSec) {
				const retryDate = new Date(errObj.retryAfter).getTime();
				if (!isNaN(retryDate)) {
					const diff = Math.max(Math.ceil((retryDate - Date.now()) / 1000), 1);
					resetAfterSec = diff;
				}
			}
			if (errObj.code === 429 || errObj.status === 'RESOURCE_EXHAUSTED' || errObj.type === 'insufficient_quota' || errObj.type === 'rate_limit_error') {
				isQuotaExhausted = true;
			}
			if (errObj.code === 402 || errObj.code === 'insufficient_credits' || errObj.status === 402) {
				isInsufficientCredits = true;
			}
			if (errObj.code === 403 || errObj.code === 'forbidden_plan_required' || errObj.status === 403) {
				isForbiddenPlan = true;
			}
			if (errObj.code === 401 || errObj.code === 'unauthorized' || errObj.status === 401) {
				isUnauthorized = true;
			}
			if (Array.isArray(errObj.suggested_free_models)) {
				suggestedFreeModels = errObj.suggested_free_models;
			}
			if (typeof errObj.buy_credits_url === 'string') {
				buyCreditsUrl = errObj.buy_credits_url;
			}
			if (typeof errObj.current_balance === 'number') {
				currentBalance = errObj.current_balance;
			}
			if (errObj.provider && !detectedProvider) {
				detectedProvider = errObj.provider;
			}
			if (errObj.model && !detectedModel) {
				detectedModel = errObj.model;
			}
			if (errObj.status) {
				statusMessage = String(errObj.status);
			}
			if (errObj.message && typeof errObj.message === 'string') {
				userMessage = errObj.message;
			} else if (errObj.type) {
				userMessage = String(errObj.type);
			}

			if (Array.isArray(errObj.details)) {
				for (const d of errObj.details) {
					if (d.reason === 'QUOTA_EXHAUSTED' || d.reason === 'RATE_LIMIT_EXCEEDED') {
						isQuotaExhausted = true;
					}
					if (d.metadata?.model && !detectedModel) {
						detectedModel = d.metadata.model;
					}
					if (d.metadata?.quotaResetDelay) {
						resetDelay = d.metadata.quotaResetDelay;
					}
					if (d.metadata?.quotaResetTimeStamp) {
						resetTimeStamp = d.metadata.quotaResetTimeStamp;
					}
					if (d.retryDelay && !resetDelay) {
						resetDelay = d.retryDelay;
					}
				}
			}
		}
	}

	if (!userMessage) {
		const quotaPhrases = [
			'quota reached',
			'quota exceeded',
			'resource has been exhausted',
			'resource_exhausted',
			'rate limit',
			'rate_limit',
			'insufficient_quota',
			'out of tokens',
			'too many requests'
		];
		const lower = trimmed.toLowerCase();
		if (quotaPhrases.some(p => lower.includes(p))) {
			isQuotaExhausted = true;
		}
		if (lower.includes('insufficient_credits') || lower.includes('insufficient balance') || lower.includes('credits required')) {
			isInsufficientCredits = true;
		}
		if (lower.includes('pricingurl') || lower.includes('pricing?')) {
			isForbiddenPlan = true;
		}
		if (lower.includes('unauthorized')) {
			isUnauthorized = true;
		}

		const resetsInMatch = trimmed.match(/Resets in ([^\.\n\r]+)/i);
		if (resetsInMatch) {
			resetDelay = resetsInMatch[1].trim();
		}
		const resetAfterMatch = trimmed.match(/reset after ([^\)\n\r]+)/i);
		if (resetAfterMatch && !resetDelay) {
			resetDelay = resetAfterMatch[1].trim();
		}

		if (isQuotaExhausted) {
			userMessage = 'The token quota limit has been reached for this model. Please switch to another model or wait until the quota resets.';
		} else if (isInsufficientCredits) {
			userMessage = 'Your account balance is insufficient for this paid model. Please switch to a free model or add credits.';
		} else {
			userMessage = trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed;
		}
	}

	if (resetDelay) {
		resetDelay = formatResetDelay(resetDelay);
	}

	if (resetTimeStamp) {
		resetTimeStamp = formatResetTimestamp(resetTimeStamp);
	}

	userMessage = cleanMessageText(userMessage);

	if (!detectedProvider && detectedModel) {
		detectedProvider = inferProviderFromModel(detectedModel);
	}

	if (resetDelay && !resetAfterSec) {
		resetAfterSec = parseResetSeconds(resetDelay);
	}
	if (resetAfterSec !== undefined && resetAfterSec > 0) {
		if (statusCode === 503 || statusCode === 429) {
			isQuotaExhausted = true;
		}
	}

	return {
		statusCode,
		model: detectedModel,
		provider: detectedProvider,
		statusMessage: statusMessage || (isInsufficientCredits ? 'INSUFFICIENT_CREDITS (402)' : isForbiddenPlan ? 'FORBIDDEN (403)' : isUnauthorized ? 'UNAUTHORIZED (401)' : isQuotaExhausted ? 'RESOURCE_EXHAUSTED (429)' : `HTTP ${statusCode}`),
		userMessage,
		resetDelay,
		resetTimeStamp,
		resetAfterSec,
		isQuotaExhausted,
		isInsufficientCredits,
		isForbiddenPlan,
		isUnauthorized,
		suggestedFreeModels,
		buyCreditsUrl,
		currentBalance,
		technicalDetails: trimmed.length > 300 ? trimmed.substring(0, 500) : undefined
	};
}

export function formatDardcorRouterError(statusCode: number, rawError: string, fallbackModel?: string): string {
	const parsed = parseDardcorRouterError(statusCode, rawError, fallbackModel);
	const modelDisplay = formatModelDisplayName(parsed.model || fallbackModel || 'Unknown Model');
	const providerDisplay = formatProviderDisplayName(parsed.provider);

	if (parsed.isInsufficientCredits) {
		const lines: string[] = [
			'### Insufficient Balance (*Paid Model Selected*)',
			'',
			`> **Model:** \`${modelDisplay}\``,
			`> **Provider:** **${providerDisplay}**`,
			`> **Status:** \`${parsed.statusMessage || 'HTTP 402 - INSUFFICIENT_CREDITS'}\``,
		];

		if (parsed.currentBalance !== undefined) {
			lines.push(`> **Current Balance:** \`$${parsed.currentBalance.toFixed(2)}\``);
		}

		lines.push(
			'',
			'**Provider Notice:**',
			`> *${parsed.userMessage || 'Your account balance is insufficient for this model.'}*`
		);

		return lines.join('\n');
	}

	if (parsed.isForbiddenPlan) {
		const lines: string[] = [
			'### Subscription Plan Required',
			'',
			`> **Model:** \`${modelDisplay}\``,
			`> **Provider:** **${providerDisplay}**`,
			`> **Status:** \`${parsed.statusMessage || 'HTTP 403 - FORBIDDEN'}\``,
			'',
			'**Provider Notice:**',
			`> *${parsed.userMessage || 'This model requires a paid plan or subscription upgrade.'}*`
		];
		return lines.join('\n');
	}

	if (parsed.isUnauthorized) {
		const lines: string[] = [
			'### Authentication Error (*Re-authentication Required*)',
			'',
			`> **Model:** \`${modelDisplay}\``,
			`> **Provider:** **${providerDisplay}**`,
			`> **Status:** \`${parsed.statusMessage || 'HTTP 401 - UNAUTHORIZED'}\``,
			'',
			'**Provider Notice:**',
			`> *${parsed.userMessage || 'Account credentials expired or invalid.'}*`
		];
		return lines.join('\n');
	}

	if (parsed.isQuotaExhausted) {
		const lines: string[] = [
			'### Token Quota Exhausted (*Rate Limit Reached*)',
			'',
			`> **Model:** \`${modelDisplay}\``,
			`> **Provider:** **${providerDisplay}**`,
			`> **Status:** \`${parsed.statusMessage || 'HTTP 429 - RESOURCE_EXHAUSTED'}\``,
		];

		if (parsed.resetDelay) {
			lines.push(`> **Reset Countdown:** \`${parsed.resetDelay}\``);
		}
		if (parsed.resetTimeStamp) {
			lines.push(`> **Reset Time:** \`${parsed.resetTimeStamp}\``);
		}

		lines.push(
			'',
			'**Provider Message:**',
			`> *${parsed.userMessage}*`
		);

		return lines.join('\n');
	}

	const lines: string[] = [
		`### Router Issue (${parsed.statusCode > 0 ? `HTTP ${parsed.statusCode}` : 'Connection Lost'})`,
		'',
		`> **Model:** \`${modelDisplay}\``,
		`> **Provider:** **${providerDisplay}**`,
		'',
		'**Issue Details:**',
		`> *${parsed.userMessage}*`
	];

	return lines.join('\n');
}

function formatResetDelay(delayStr: string): string {
	const match = delayStr.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
	if (match) {
		const parts: string[] = [];
		if (match[1]) parts.push(`${match[1]} ${parseInt(match[1], 10) === 1 ? 'hour' : 'hours'}`);
		if (match[2]) parts.push(`${match[2]} ${parseInt(match[2], 10) === 1 ? 'minute' : 'minutes'}`);
		if (match[3]) {
			const sec = Math.round(parseFloat(match[3]));
			if (sec > 0 || parts.length === 0) {
				parts.push(`${sec} ${sec === 1 ? 'second' : 'seconds'}`);
			}
		}
		if (parts.length > 0) {
			return parts.join(' ');
		}
	}
	const seconds = parseFloat(delayStr);
	if (!isNaN(seconds) && seconds > 0) {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.round(seconds % 60);
		const parts: string[] = [];
		if (h > 0) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
		if (m > 0) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
		if (s > 0 || parts.length === 0) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`);
		return parts.join(' ');
	}
	return delayStr;
}

function formatResetTimestamp(timestampStr: string): string {
	try {
		const date = new Date(timestampStr);
		if (!isNaN(date.getTime())) {
			return date.toLocaleString('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				timeZoneName: 'short'
			});
		}
	} catch { }
	return timestampStr;
}

export function cleanMessageText(text: string): string {
	let cleaned = text.trim();
	cleaned = cleaned.replace(/\]\(https?:\/\/[^\)]+\)\)*$/g, '');
	cleaned = cleaned.replace(/\s*\(reset after [^\)]+\)/gi, '');
	cleaned = cleaned.replace(/^"|"$/g, '');
	cleaned = cleaned.replace(/\\n/g, ' ');
	cleaned = cleaned.replace(/\\"/g, '"');
	cleaned = cleaned.replace(/;\s*origin:\s*[^\.\n\r]+/gi, '');
	cleaned = cleaned.replace(/vscode-file:\/\/[^\s\)\'\"\,]+/gi, '');
	cleaned = cleaned.replace(/\s{2,}/g, ' ');
	return cleaned;
}

export function formatModelDisplayName(modelId: string): string {
	const cleaned = (modelId || '').replace(/^(dardcor|ag|oc|opencode|ds|gemini|grok|claude|openai|cl|cline|cx|codex|qd|qdcn|qoder|kc|kilocode|cbai|cbcn|codebuddy|cu|cursor|zd|zed|cf|cloudflare|cmc|ocz|gh|v1m|tinyfish|atria|agnes|bai|dahl|tokenharbor|muse)\//i, '');
	return cleaned
		.split(/[-_]/)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function inferProviderFromModel(modelId: string): string {
	const lower = (modelId || '').toLowerCase();
	if (!lower) return 'Dardcor Router';
	if (lower.startsWith('antigravity/') || lower.startsWith('ag/')) return 'Antigravity';
	if (lower.startsWith('codex/') || lower.startsWith('cx/') || lower.includes('sol') || lower.includes('terra') || lower.includes('luna')) return 'OpenAI Codex';
	if (lower.startsWith('cline/') || lower.startsWith('cl/')) return 'Cline';
	if (lower.startsWith('qoder/') || lower.startsWith('qd/') || lower.startsWith('qdcn/')) return 'Qoder';
	if (lower.startsWith('kilocode/') || lower.startsWith('kc/')) return 'KiloCode';
	if (lower.startsWith('codebuddy/') || lower.startsWith('cbai/') || lower.startsWith('cbcn/')) return 'CodeBuddy';
	if (lower.startsWith('cursor/') || lower.startsWith('cu/')) return 'Cursor';
	if (lower.startsWith('zed/') || lower.startsWith('zd/')) return 'Zed';
	if (lower.startsWith('cloudflare/') || lower.startsWith('cf/')) return 'Cloudflare';
	if (lower.startsWith('github/') || lower.startsWith('gh/')) return 'GitHub';
	if (lower.startsWith('gemini-cli/') || lower.startsWith('gc/')) return 'Gemini CLI';
	if (lower.startsWith('grok-cli/') || lower.startsWith('gcli/') || lower.startsWith('gb/') || lower.includes('grok-build')) return 'Grok CLI (Grok Build)';
	if (lower.startsWith('ocg/')) return 'Cloud Go';
	if (lower.startsWith('oc/') || lower.includes('pickle')) return 'Free Tier';
	if (lower.startsWith('claude') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku')) return 'Anthropic (Claude)';
	if (lower.startsWith('gemini') || lower.includes('flash') || lower.includes('pro-exp')) return 'Google Gemini';
	if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.includes('openai')) return 'OpenAI';
	if (lower.startsWith('grok') || lower.includes('xai')) return 'xAI (Grok)';
	if (lower.startsWith('deepseek') || lower.includes('r1')) return 'DeepSeek';
	return 'Dardcor Router';
}

function formatProviderDisplayName(provider?: string): string {
	if (!provider) return 'Dardcor Router';
	const lower = provider.toLowerCase();
	if (lower.includes('antigravity') || lower === 'ag') return 'Antigravity';
	if (lower.includes('codex') || lower === 'cx') return 'OpenAI Codex';
	if (lower.includes('cline') || lower === 'cl') return 'Cline';
	if (lower.includes('qoder') || lower === 'qd' || lower === 'qdcn') return 'Qoder';
	if (lower.includes('kilocode') || lower === 'kc') return 'KiloCode';
	if (lower.includes('codebuddy') || lower === 'cbai' || lower === 'cbcn') return 'CodeBuddy';
	if (lower.includes('cursor') || lower === 'cu') return 'Cursor';
	if (lower.includes('zed') || lower === 'zd') return 'Zed';
	if (lower.includes('cloudflare') || lower === 'cf') return 'Cloudflare';
	if (lower.includes('github') || lower === 'gh') return 'GitHub';
	if (lower.includes('gemini-cli') || lower.includes('gc')) return 'Gemini CLI';
	if (lower.includes('grok-cli') || lower.includes('gcli') || lower.includes('grok-build') || lower.includes('gb')) return 'Grok CLI (Grok Build)';
	if (lower.includes('claude') || lower.includes('anthropic')) return 'Anthropic (Claude)';
	if (lower.includes('gemini') || lower.includes('google')) return 'Google Gemini';
	if (lower.includes('openai')) return 'OpenAI';
	if (lower.includes('grok') || lower.includes('xai')) return 'xAI (Grok)';
	if (lower.includes('deepseek')) return 'DeepSeek';
	return provider.charAt(0).toUpperCase() + provider.slice(1);
}


export type DardcorProviderIssueCategory = 'DOWN' | 'LIMIT' | 'ERROR';

export interface IDardcorProviderDiagnosis {
	category: DardcorProviderIssueCategory;
	provider: string;
	model: string;
	title: string;
	description: string;
}

export function diagnoseProviderIssue(statusCode: number, rawError: string, modelId?: string, lang: string = 'en'): IDardcorProviderDiagnosis {
	const parsed = parseDardcorRouterError(statusCode, rawError, modelId);
	const model = formatModelDisplayName(parsed.model || modelId || 'Unknown Model');
	const provider = formatProviderDisplayName(parsed.provider);
	const text = `${rawError || ''} ${parsed.userMessage || ''} ${parsed.technicalDetails || ''}`;
	const lower = text.toLowerCase();
	const isIndonesian = lang === 'id';

	// 1. DOWN: Server unreachable, DNS failure, 502 Bad Gateway, 504 Gateway Timeout, connection refused/reset, network drops
	const isDown = statusCode === 502 || statusCode === 504 ||
		(statusCode === 503 && !parsed.resetDelay && !parsed.resetAfterSec && !parsed.isQuotaExhausted) ||
		/enotfound|econnrefused|econnreset|etimedout|err_timed_out|connect timeout|fetch failed|server unreachable|bad gateway|gateway error|network error|connection lost/i.test(text);

	if (isDown) {
		let cause = isIndonesian ? 'Server upstream tidak dapat dijangkau' : 'Upstream server is unreachable';
		const hostMatch = text.match(/enotfound\s+([a-zA-Z0-9_\-\.]+)/i) || text.match(/getaddrinfo\s+enotfound\s+([a-zA-Z0-9_\-\.]+)/i);
		if (hostMatch) {
			cause = isIndonesian
				? `Domain upstream (${hostMatch[1]}) tidak dapat dihubungi atau server sedang down`
				: `Upstream host (${hostMatch[1]}) could not be resolved or server is down`;
		} else if (lower.includes('connect timeout')) {
			cause = isIndonesian ? 'Waktu koneksi ke server upstream habis (timeout)' : 'Upstream connection timed out';
		} else if (lower.includes('econnrefused')) {
			cause = isIndonesian ? 'Koneksi ditolak oleh server provider' : 'Connection refused by upstream provider';
		} else if (statusCode === 502) {
			cause = isIndonesian ? 'Gateway provider merespons HTTP 502 Bad Gateway' : 'Gateway responded with HTTP 502 Bad Gateway';
		} else if (statusCode === 504) {
			cause = isIndonesian ? 'Gateway provider mengalami timeout (HTTP 504)' : 'Gateway timed out (HTTP 504)';
		}

		return {
			category: 'DOWN',
			provider,
			model,
			title: isIndonesian ? 'Server Provider Down' : 'Provider Server Down',
			description: isIndonesian
				? `Server provider ${provider} sedang down atau tidak dapat dijangkau: ${cause}.`
				: `The ${provider} provider server is currently down or unreachable: ${cause}.`
		};
	}

	// 2. LIMIT: Quota limit, rate limit, token exhausted, 429
	const isLimit = statusCode === 429 || parsed.isQuotaExhausted || !!parsed.resetDelay || !!parsed.resetAfterSec ||
		/quota exceeded|rate_limit|rate limit|too many requests|resource_exhausted|resource has been exhausted|out of tokens|free usage limit|all \d+ accounts locked/i.test(text);

	if (isLimit) {
		const resetInfo = parsed.resetDelay
			? (isIndonesian ? ` (Reset dalam: ${parsed.resetDelay})` : ` (Resets in: ${parsed.resetDelay})`)
			: '';
		return {
			category: 'LIMIT',
			provider,
			model,
			title: isIndonesian ? 'Batas Kuota / Rate Limit Tercapai' : 'Quota / Rate Limit Exceeded',
			description: isIndonesian
				? `Batas kuota atau kecepatan (rate-limit) model ${model} pada provider ${provider} telah tercapai${resetInfo}.`
				: `The quota or rate-limit for model ${model} on provider ${provider} has been reached${resetInfo}.`
		};
	}

	// 3. ERROR: Authentication failure, plan required, payment, invalid model
	let errorCause = cleanMessageText(parsed.userMessage);
	if (parsed.isForbiddenPlan || statusCode === 403 || lower.includes('pricingurl') || lower.includes('subscription')) {
		errorCause = isIndonesian ? 'Model ini memerlukan paket berbayar atau langganan aktif' : 'This model requires a paid plan or active subscription';
	} else if (parsed.isInsufficientCredits || statusCode === 402 || lower.includes('insufficient_credits')) {
		errorCause = isIndonesian ? 'Saldo akun tidak mencukupi untuk model berbayar' : 'Insufficient account credits for this model';
	} else if (parsed.isUnauthorized || statusCode === 401 || lower.includes('unauthorized')) {
		errorCause = isIndonesian ? 'Kredensial atau token API kedaluwarsa atau tidak valid' : 'Account credentials or API token expired/invalid';
	} else if (statusCode === 404 || lower.includes('model_not_found')) {
		errorCause = isIndonesian ? 'Model tidak ditemukan pada provider upstream' : 'Model not found on upstream provider';
	} else if (!errorCause) {
		errorCause = isIndonesian ? 'Terjadi kesalahan konfigurasi atau autentikasi' : 'Configuration or authentication error encountered';
	}

	return {
		category: 'ERROR',
		provider,
		model,
		title: isIndonesian ? 'Kendala Provider' : 'Provider Error',
		description: isIndonesian
			? `Kendala akses pada provider ${provider}: ${errorCause}.`
			: `Access error on provider ${provider}: ${errorCause}.`
	};
}
