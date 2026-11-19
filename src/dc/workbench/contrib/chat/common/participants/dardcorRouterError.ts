/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function parseResetSeconds(delayStr?: string): number | undefined {
	if (!delayStr) {
		return undefined;
	}
	const str = delayStr.trim();
	const hMatch = str.match(/\b(\d+)\s*(?:h|hours?|hrs?)\b/i);
	const mMatch = str.match(/\b(\d+)\s*(?:m|min|mins?|minutes?)\b/i);
	const sMatch = str.match(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs?|seconds?)\b/i);
	if (hMatch || mMatch || sMatch) {
		const h = hMatch ? parseInt(hMatch[1], 10) : 0;
		const m = mMatch ? parseInt(mMatch[1], 10) : 0;
		const s = sMatch ? parseFloat(sMatch[1]) : 0;
		const total = h * 3600 + m * 60 + Math.ceil(s);
		return total > 0 ? total : undefined;
	}
	if (/^\s*\d+(?:\.\d+)?\s*$/.test(str)) {
		const num = parseFloat(str);
		return !isNaN(num) && num > 0 ? Math.ceil(num) : undefined;
	}
	return undefined;
}

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
			'> Model quota temporarily reached. Please switch to another model in the bottom-right selector to resume immediately.'
		);

		return lines.join('\n');
	}

	const lines: string[] = [
		`### Model Issue (${parsed.statusCode > 0 ? `HTTP ${parsed.statusCode}` : 'Connection Interrupted'})`,
		'',
		`> Model \`${modelDisplay}\` on provider **${providerDisplay}** is currently unavailable or encountered an error. Please select another model in the bottom-right model picker to automatically continue the task.`
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
	const cleaned = (modelId || '')
		.replace(/^(dardcor|ag|oc|opencode|ds|gemini|grok|claude|openai|cl|cline|cx|codex|qd|qdcn|qoder|kc|kilocode|cbai|cbcn|codebuddy|cu|cursor|zd|zed|cf|cloudflare|cmc|ocz|gh|v1m|tinyfish|atria|agnes|bai|dahl|tokenharbor|muse)\//i, '')
		.replace(/(\d+)[-_](\d+)/g, '$1.$2');
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

const DIAGNOSIS_I18N: Record<string, {
	downTitle: string;
	limitTitle: string;
	errorTitle: string;
	downDesc: (provider: string, cause: string) => string;
	limitDesc: (provider: string, model: string, reset: string) => string;
	errorDesc: (provider: string, cause: string) => string;
	upstreamUnreachable: string;
	domainUnreachable: (host: string) => string;
	timeout: string;
	refused: string;
	badGateway: string;
	gatewayTimeout: string;
	paidRequired: string;
	insufficientCredits: string;
	credentialsExpired: string;
	modelNotFound: string;
	configError: string;
	resetIn: (delay: string) => string;
}> = {
	id: {
		downTitle: 'Server Provider Down',
		limitTitle: 'Batas Kuota / Rate Limit Tercapai',
		errorTitle: 'Kendala Provider',
		downDesc: (p, c) => `Server provider ${p} sedang down atau tidak dapat dijangkau: ${c}.`,
		limitDesc: (p, m, r) => `Batas kuota atau kecepatan (rate-limit) model ${m} pada provider ${p} telah tercapai${r}.`,
		errorDesc: (p, c) => `Kendala akses pada provider ${p}: ${c}.`,
		upstreamUnreachable: 'Server upstream tidak dapat dijangkau',
		domainUnreachable: (h) => `Domain upstream (${h}) tidak dapat dihubungi atau server sedang down`,
		timeout: 'Waktu koneksi ke server upstream habis (timeout)',
		refused: 'Koneksi ditolak oleh server provider',
		badGateway: 'Gateway provider merespons HTTP 502 Bad Gateway',
		gatewayTimeout: 'Gateway provider mengalami timeout (HTTP 504)',
		paidRequired: 'Model ini memerlukan paket berbayar atau langganan aktif',
		insufficientCredits: 'Saldo akun tidak mencukupi untuk model berbayar',
		credentialsExpired: 'Kredensial atau token API kedaluwarsa atau tidak valid',
		modelNotFound: 'Model tidak ditemukan pada provider upstream',
		configError: 'Terjadi kesalahan konfigurasi atau autentikasi',
		resetIn: (d) => ` (Reset dalam: ${d})`
	},
	en: {
		downTitle: 'Provider Server Down',
		limitTitle: 'Quota / Rate Limit Exceeded',
		errorTitle: 'Provider Error',
		downDesc: (p, c) => `The ${p} provider server is currently down or unreachable: ${c}.`,
		limitDesc: (p, m, r) => `The quota or rate-limit for model ${m} on provider ${p} has been reached${r}.`,
		errorDesc: (p, c) => `Access error on provider ${p}: ${c}.`,
		upstreamUnreachable: 'Upstream server is unreachable',
		domainUnreachable: (h) => `Upstream host (${h}) could not be resolved or server is down`,
		timeout: 'Upstream connection timed out',
		refused: 'Connection refused by upstream provider',
		badGateway: 'Gateway responded with HTTP 502 Bad Gateway',
		gatewayTimeout: 'Gateway timed out (HTTP 504)',
		paidRequired: 'This model requires a paid plan or active subscription',
		insufficientCredits: 'Insufficient account credits for this model',
		credentialsExpired: 'Account credentials or API token expired/invalid',
		modelNotFound: 'Model not found on upstream provider',
		configError: 'Configuration or authentication error encountered',
		resetIn: (d) => ` (Resets in: ${d})`
	},
	ja: {
		downTitle: 'プロバイダーサーバーダウン',
		limitTitle: 'クォータ / レート制限超過',
		errorTitle: 'プロバイダーエラー',
		downDesc: (p, c) => `プロバイダー ${p} のサーバーがダウンしているか接続できません: ${c}。`,
		limitDesc: (p, m, r) => `プロバイダー ${p} のモデル ${m} のクォータまたはレート制限に達しました${r}。`,
		errorDesc: (p, c) => `プロバイダー ${p} へのアクセスエラー: ${c}。`,
		upstreamUnreachable: 'アップストリームサーバーに接続できません',
		domainUnreachable: (h) => `アップストリームホスト (${h}) に接続できないかサーバーがダウンしています`,
		timeout: 'アップストリーム接続がタイムアウトしました',
		refused: 'プロバイダーサーバーにより接続が拒否されました',
		badGateway: 'HTTP 502 Bad Gateway が返されました',
		gatewayTimeout: 'ゲートウェイがタイムアウトしました (HTTP 504)',
		paidRequired: 'このモデルには有料プランまたはアクティブなサブスクリプションが必要です',
		insufficientCredits: 'このモデルを使用するためのアカウント残高が不足しています',
		credentialsExpired: '認証情報またはAPIトークンの期限が切れているか無効です',
		modelNotFound: 'アップストリームプロバイダーでモデルが見つかりません',
		configError: '設定または認証エラーが発生しました',
		resetIn: (d) => ` (リセットまで: ${d})`
	},
	zh: {
		downTitle: '提供商服务器宕机',
		limitTitle: '配额 / 速率限制已超',
		errorTitle: '提供商错误',
		downDesc: (p, c) => `提供商 ${p} 服务器当前宕机或无法连接：${c}。`,
		limitDesc: (p, m, r) => `提供商 ${p} 上的模型 ${m} 配额或速率限制已耗尽${r}。`,
		errorDesc: (p, c) => `提供商 ${p} 访问错误：${c}。`,
		upstreamUnreachable: '上游服务器无法访问',
		domainUnreachable: (h) => `无法解析上游主机 (${h}) 或服务器已宕机`,
		timeout: '连接上游服务器超时',
		refused: '上游提供商拒绝连接',
		badGateway: '网关返回 HTTP 502 Bad Gateway',
		gatewayTimeout: '网关超时 (HTTP 504)',
		paidRequired: '该模型需要付费计划或有效订阅',
		insufficientCredits: '该模型账户积分不足',
		credentialsExpired: '账户凭证或 API Token 已过期或无效',
		modelNotFound: '在上游提供商中未找到该模型',
		configError: '发生配置或身份验证错误',
		resetIn: (d) => ` (重置时间：${d})`
	},
	ko: {
		downTitle: '공급자 서버 다운',
		limitTitle: '할당량 / 전송 속도 제한 초과',
		errorTitle: '공급자 오류',
		downDesc: (p, c) => `공급자 ${p} 서버가 다운되었거나 연결할 수 없습니다: ${c}.`,
		limitDesc: (p, m, r) => `공급자 ${p}의 모델 ${m} 할당량 또는 호출 속도 제한에 도달했습니다${r}.`,
		errorDesc: (p, c) => `공급자 ${p} 접근 오류: ${c}.`,
		upstreamUnreachable: '업스트림 서버에 연결할 수 없습니다',
		domainUnreachable: (h) => `업스트림 호스트 (${h})를 확인할 수 없거나 서버가 다운되었습니다`,
		timeout: '업스트림 연결 시간이 초과되었습니다',
		refused: '공급자 서버에서 연결을 거부했습니다',
		badGateway: '게이트웨이에서 HTTP 502 Bad Gateway가 반환되었습니다',
		gatewayTimeout: '게이트웨이 시간 초과 (HTTP 504)',
		paidRequired: '이 모델은 유료 플랜 또는 활성 구독이 필요합니다',
		insufficientCredits: '이 모델에 대한 계정 크레딧이 부족합니다',
		credentialsExpired: '계정 자격 증명 또는 API 토큰이 만료되었거나 유효하지 않습니다',
		modelNotFound: '업스트림 공급자에서 모델을 찾을 수 없습니다',
		configError: '구성 또는 인증 오류가 발생했습니다',
		resetIn: (d) => ` (재설정: ${d})`
	},
	es: {
		downTitle: 'Servidor del proveedor caído',
		limitTitle: 'Límite de cuota / tasa superado',
		errorTitle: 'Error del proveedor',
		downDesc: (p, c) => `El servidor del proveedor ${p} está caído o inaccesible: ${c}.`,
		limitDesc: (p, m, r) => `Se ha alcanzado la cuota o el límite de tasa del modelo ${m} en el proveedor ${p}${r}.`,
		errorDesc: (p, c) => `Error de acceso en el proveedor ${p}: ${c}.`,
		upstreamUnreachable: 'El servidor ascendente es inaccesible',
		domainUnreachable: (h) => `No se pudo resolver el host ascendente (${h}) o el servidor está caído`,
		timeout: 'Se agotó el tiempo de conexión con el servidor ascendente',
		refused: 'Conexión rechazada por el proveedor ascendente',
		badGateway: 'La puerta de enlace respondió con HTTP 502 Bad Gateway',
		gatewayTimeout: 'Tiempo de espera de la puerta de enlace agotado (HTTP 504)',
		paidRequired: 'Este modelo requiere un plan de pago o una suscripción activa',
		insufficientCredits: 'Créditos de cuenta insuficientes para este modelo',
		credentialsExpired: 'Las credenciales de la cuenta o el token API han caducado o no son válidos',
		modelNotFound: 'Modelo no encontrado en el proveedor ascendente',
		configError: 'Se encontró un error de configuración o autenticación',
		resetIn: (d) => ` (Se restablece en: ${d})`
	},
	fr: {
		downTitle: 'Serveur du fournisseur indisponible',
		limitTitle: 'Quota / Limite de débit dépassée',
		errorTitle: 'Erreur du fournisseur',
		downDesc: (p, c) => `Le serveur du fournisseur ${p} est actuellement indisponible ou inaccessible : ${c}.`,
		limitDesc: (p, m, r) => `Le quota ou la limite de débit pour le modèle ${m} sur le fournisseur ${p} est atteint${r}.`,
		errorDesc: (p, c) => `Erreur d'accès sur le fournisseur ${p} : ${c}.`,
		upstreamUnreachable: 'Le serveur amont est inaccessible',
		domainUnreachable: (h) => `L'hôte amont (${h}) est introuvable ou le serveur est indisponible`,
		timeout: 'La connexion amont a expiré',
		refused: 'Connexion refusée par le fournisseur amont',
		badGateway: 'La passerelle a répondu par HTTP 502 Bad Gateway',
		gatewayTimeout: 'Délai d’attente de la passerelle dépassé (HTTP 504)',
		paidRequired: 'Ce modèle nécessite un abonnement payant ou une souscription active',
		insufficientCredits: 'Crédits de compte insuffisants pour ce modèle',
		credentialsExpired: 'Identifiants ou jeton API expirés ou invalides',
		modelNotFound: 'Modèle introuvable chez le fournisseur amont',
		configError: 'Erreur de configuration ou d’authentification rencontrée',
		resetIn: (d) => ` (Réinitialisation dans : ${d})`
	},
	de: {
		downTitle: 'Provider-Server nicht erreichbar',
		limitTitle: 'Kontingent / Ratenlimit überschritten',
		errorTitle: 'Provider-Fehler',
		downDesc: (p, c) => `Der Server des Providers ${p} ist derzeit nicht erreichbar: ${c}.`,
		limitDesc: (p, m, r) => `Das Kontingent oder Ratenlimit für das Modell ${m} bei Provider ${p} wurde erreicht${r}.`,
		errorDesc: (p, c) => `Zugriffsfehler beim Provider ${p}: ${c}.`,
		upstreamUnreachable: 'Upstream-Server ist nicht erreichbar',
		domainUnreachable: (h) => `Upstream-Host (${h}) konnte nicht aufgelöst werden oder ist offline`,
		timeout: 'Upstream-Verbindung abgelaufen',
		refused: 'Verbindung vom Upstream-Provider abgelehnt',
		badGateway: 'Gateway antwortete mit HTTP 502 Bad Gateway',
		gatewayTimeout: 'Gateway-Timeout (HTTP 504)',
		paidRequired: 'Dieses Modell erfordert einen kostenpflichtigen Plan oder ein aktives Abonnement',
		insufficientCredits: 'Unzureichendes Kontoguthaben für dieses Modell',
		credentialsExpired: 'Anmeldeinformationen oder API-Token abgelaufen oder ungültig',
		modelNotFound: 'Modell beim Upstream-Provider nicht gefunden',
		configError: 'Konfigurations- oder Authentifizierungsfehler aufgetreten',
		resetIn: (d) => ` (Zurücksetzung in: ${d})`
	},
	pt: {
		downTitle: 'Servidor do provedor indisponível',
		limitTitle: 'Limite de cota / taxa excedido',
		errorTitle: 'Erro do provedor',
		downDesc: (p, c) => `O servidor do provedor ${p} está fora do ar ou inacessível: ${c}.`,
		limitDesc: (p, m, r) => `A cota ou limite de taxa para o modelo ${m} no provedor ${p} foi atingida${r}.`,
		errorDesc: (p, c) => `Erro de acesso no provedor ${p}: ${c}.`,
		upstreamUnreachable: 'Servidor upstream inacessível',
		domainUnreachable: (h) => `Host upstream (${h}) não pôde ser resolvido ou o servidor está fora`,
		timeout: 'Tempo de conexão upstream esgotado',
		refused: 'Conexão recusada pelo provedor upstream',
		badGateway: 'Gateway respondeu com HTTP 502 Bad Gateway',
		gatewayTimeout: 'Tempo limite do gateway esgotado (HTTP 504)',
		paidRequired: 'Este modelo requer um plano pago ou assinatura ativa',
		insufficientCredits: 'Créditos de conta insuficientes para este modelo',
		credentialsExpired: 'Credenciais de conta ou token de API expirados/inválidos',
		modelNotFound: 'Modelo não encontrado no provedor upstream',
		configError: 'Erro de configuração ou autenticação encontrado',
		resetIn: (d) => ` (Reinicia em: ${d})`
	},
	ru: {
		downTitle: 'Сервер провайдера недоступен',
		limitTitle: 'Превышен лимит квоты / скорости',
		errorTitle: 'Ошибка провайдера',
		downDesc: (p, c) => `Сервер провайдера ${p} в настоящее время недоступен: ${c}.`,
		limitDesc: (p, m, r) => `Достигнут лимит квоты или скорости для модели ${m} у провайдера ${p}${r}.`,
		errorDesc: (p, c) => `Ошибка доступа к провайдеру ${p}: ${c}.`,
		upstreamUnreachable: 'Вышестоящий сервер недоступен',
		domainUnreachable: (h) => `Хост (${h}) не распознан или сервер выключен`,
		timeout: 'Истекло время ожидания соединения с сервером',
		refused: 'Соединение отклонено вышестоящим провайдером',
		badGateway: 'Шлюз ответил HTTP 502 Bad Gateway',
		gatewayTimeout: 'Время ожидания шлюза истекло (HTTP 504)',
		paidRequired: 'Для этой модели требуется платный тариф или активная подписка',
		insufficientCredits: 'Недостаточно средств на счете для этой модели',
		credentialsExpired: 'Учетные данные или API-токен истекли или недействительны',
		modelNotFound: 'Модель не найдена у вышестоящего провайдера',
		configError: 'Произошла ошибка конфигурации или аутентификации',
		resetIn: (d) => ` (Сброс через: ${d})`
	},
	it: {
		downTitle: 'Server del provider non raggiungibile',
		limitTitle: 'Limite di quota / frequenza superato',
		errorTitle: 'Errore del provider',
		downDesc: (p, c) => `Il server del provider ${p} è attualmente inattivo o non raggiungibile: ${c}.`,
		limitDesc: (p, m, r) => `La quota o il limite di richieste per il modello ${m} sul provider ${p} è stato raggiunto${r}.`,
		errorDesc: (p, c) => `Errore di accesso sul provider ${p}: ${c}.`,
		upstreamUnreachable: 'Server upstream non raggiungibile',
		domainUnreachable: (h) => `Impossibile risolvere l'host upstream (${h}) o server non attivo`,
		timeout: 'Connessione upstream scaduta',
		refused: 'Connessione rifiutata dal provider upstream',
		badGateway: 'Il gateway ha risposto con HTTP 502 Bad Gateway',
		gatewayTimeout: 'Timeout del gateway (HTTP 504)',
		paidRequired: 'Questo modello richiede un piano a pagamento o un abbonamento attivo',
		insufficientCredits: 'Crediti account insufficienti per questo modello',
		credentialsExpired: 'Credenziali o token API scaduti o non validi',
		modelNotFound: 'Modello non trovato sul provider upstream',
		configError: 'Si è verificato un errore di configurazione o autenticazione',
		resetIn: (d) => ` (Ripristino tra: ${d})`
	},
	ar: {
		downTitle: 'خادم المزود متوقف',
		limitTitle: 'تم تجاوز الحصة / حد المعدل',
		errorTitle: 'خطأ في المزود',
		downDesc: (p, c) => `خادم المزود ${p} متوقف حالياً أو لا يمكن الوصول إليه: ${c}.`,
		limitDesc: (p, m, r) => `تم الوصول إلى الحصة أو حد المعدل للنموذج ${m} على المزود ${p}${r}.`,
		errorDesc: (p, c) => `خطأ في الوصول إلى المزود ${p}: ${c}.`,
		upstreamUnreachable: 'الخادم الرئيسي غير قابل للوصول',
		domainUnreachable: (h) => `تعذر حل المضيف الرئيسي (${h}) أو الخادم متوقف`,
		timeout: 'انتهت مهلة الاتصال بالخادم الرئيسي',
		refused: 'رفض المزود الرئيسي الاتصال',
		badGateway: 'استجاب البوابة بـ HTTP 502 Bad Gateway',
		gatewayTimeout: 'انتهت مهلة البوابة (HTTP 504)',
		paidRequired: 'يتطلب هذا النموذج خطة مدفوعة أو اشتراكاً نشطاً',
		insufficientCredits: 'رصيد الحساب غير كافٍ لهذا النموذج',
		credentialsExpired: 'انتهت صلاحية بيانات الاعتماد أو رمز API أو أنها غير صالحة',
		modelNotFound: 'النموذج غير موجود لدى المزود الرئيسي',
		configError: 'حدث خطأ في التكوين أو المصادقة',
		resetIn: (d) => ` (إعادة الضبط خلال: ${d})`
	},
	nl: {
		downTitle: 'Provider-server niet bereikbaar',
		limitTitle: 'Quoturn / snelheidslimiet overschreden',
		errorTitle: 'Providerfout',
		downDesc: (p, c) => `De server van provider ${p} is momenteel offline of onbereikbaar: ${c}.`,
		limitDesc: (p, m, r) => `Het quotum of de snelheidslimiet voor model ${m} op provider ${p} is bereikt${r}.`,
		errorDesc: (p, c) => `Toegangsfout op provider ${p}: ${c}.`,
		upstreamUnreachable: 'Upstream-server is onbereikbaar',
		domainUnreachable: (h) => `Upstream-host (${h}) kan niet worden herleid of server is offline`,
		timeout: 'Upstream-verbinding is verlopen',
		refused: 'Verbinding geweigerd door upstream-provider',
		badGateway: 'Gateway reageerde met HTTP 502 Bad Gateway',
		gatewayTimeout: 'Gateway-time-out (HTTP 504)',
		paidRequired: 'Dit model vereist een betaald abonnement',
		insufficientCredits: 'Onvoldoende accountsaldo voor dit model',
		credentialsExpired: 'Accountgegevens of API-token verlopen/ongeldig',
		modelNotFound: 'Model niet gevonden bij upstream-provider',
		configError: 'Configuratie- of verificatiefout opgetreden',
		resetIn: (d) => ` (Opnieuw instellen over: ${d})`
	},
	tr: {
		downTitle: 'Sağlayıcı Sunucusu Kapalı',
		limitTitle: 'Kota / Hız Sınırı Aşıldı',
		errorTitle: 'Sağlayıcı Hatası',
		downDesc: (p, c) => `${p} sağlayıcı sunucusu şu anda kapalı veya ulaşılamıyor: ${c}.`,
		limitDesc: (p, m, r) => `${p} sağlayıcısındaki ${m} modeli için kota veya hız sınırına ulaşıldı${r}.`,
		errorDesc: (p, c) => `${p} sağlayıcısında erişim hatası: ${c}.`,
		upstreamUnreachable: 'Yukarı akış sunucusuna ulaşılamıyor',
		domainUnreachable: (h) => `Yukarı akış ana bilgisayarı (${h}) çözümlenemedi veya sunucu kapalı`,
		timeout: 'Yukarı akış bağlantı zaman aşımına uğradı',
		refused: 'Yukarı akış sağlayıcısı tarafından bağlantı reddedildi',
		badGateway: 'Ağ geçidi HTTP 502 Bad Gateway yanıtı verdi',
		gatewayTimeout: 'Ağ geçidi zaman aşımı (HTTP 504)',
		paidRequired: 'Bu model ücretli bir plan veya aktif abonelik gerektirir',
		insufficientCredits: 'Bu model için yetersiz hesap kredisi',
		credentialsExpired: 'Hesap kimlik bilgileri veya API anahtarının süresi dolmuş/geçersiz',
		modelNotFound: 'Yukarı akış sağlayıcısında model bulunamadı',
		configError: 'Yapılandırma veya kimlik doğrulama hatasıyla karşılaşıldı',
		resetIn: (d) => ` (Sıfırlanma süresi: ${d})`
	},
	vi: {
		downTitle: 'Máy chủ nhà cung cấp bị tắt',
		limitTitle: 'Đã vượt quá hạn mức / tốc độ',
		errorTitle: 'Lỗi nhà cung cấp',
		downDesc: (p, c) => `Máy chủ của nhà cung cấp ${p} hiện đang ngừng hoạt động hoặc không thể truy cập: ${c}.`,
		limitDesc: (p, m, r) => `Hạn mức hoặc giới hạn tốc độ cho mô hình ${m} trên nhà cung cấp ${p} đã đạt mức tối đa${r}.`,
		errorDesc: (p, c) => `Lỗi truy cập trên nhà cung cấp ${p}: ${c}.`,
		upstreamUnreachable: 'Không thể kết nối đến máy chủ thượng nguồn',
		domainUnreachable: (h) => `Không thể phân giải máy chủ (${h}) hoặc máy chủ bị tắt`,
		timeout: 'Kết nối máy chủ thượng nguồn đã hết thời gian',
		refused: 'Kết nối bị từ chối bởi nhà cung cấp thượng nguồn',
		badGateway: 'Cổng phản hồi với mã HTTP 502 Bad Gateway',
		gatewayTimeout: 'Hết thời gian chờ cổng (HTTP 504)',
		paidRequired: 'Mô hình này yêu cầu gói trả phí hoặc đăng ký đang hoạt động',
		insufficientCredits: 'Không đủ số dư tài khoản cho mô hình này',
		credentialsExpired: 'Thông tin đăng nhập hoặc mã thông báo API đã hết hạn/không hợp lệ',
		modelNotFound: 'Không tìm thấy mô hình trên nhà cung cấp thượng nguồn',
		configError: 'Gặp lỗi cấu hình hoặc xác thực',
		resetIn: (d) => ` (Đặt lại sau: ${d})`
	}
};

export function diagnoseProviderIssue(statusCode: number, rawError: string, modelId?: string, lang: string = 'en'): IDardcorProviderDiagnosis {
	const parsed = parseDardcorRouterError(statusCode, rawError, modelId);
	const model = formatModelDisplayName(parsed.model || modelId || 'Unknown Model');
	const provider = formatProviderDisplayName(parsed.provider);
	const text = `${rawError || ''} ${parsed.userMessage || ''} ${parsed.technicalDetails || ''}`;
	const lower = text.toLowerCase();
	const loc = DIAGNOSIS_I18N[lang] || DIAGNOSIS_I18N.en;

	const isDown = statusCode === 502 || statusCode === 504 ||
		(statusCode === 503 && !parsed.resetDelay && !parsed.resetAfterSec && !parsed.isQuotaExhausted) ||
		/enotfound|econnrefused|econnreset|etimedout|err_timed_out|connect timeout|fetch failed|server unreachable|bad gateway|gateway error|network error|connection lost/i.test(text);

	if (isDown) {
		let cause = loc.upstreamUnreachable;
		const hostMatch = text.match(/enotfound\s+([a-zA-Z0-9_\-\.]+)/i) || text.match(/getaddrinfo\s+enotfound\s+([a-zA-Z0-9_\-\.]+)/i);
		if (hostMatch) {
			cause = loc.domainUnreachable(hostMatch[1]);
		} else if (lower.includes('connect timeout')) {
			cause = loc.timeout;
		} else if (lower.includes('econnrefused')) {
			cause = loc.refused;
		} else if (statusCode === 502) {
			cause = loc.badGateway;
		} else if (statusCode === 504) {
			cause = loc.gatewayTimeout;
		}

		return {
			category: 'DOWN',
			provider,
			model,
			title: loc.downTitle,
			description: loc.downDesc(provider, cause)
		};
	}

	const isLimit = statusCode === 429 || parsed.isQuotaExhausted || !!parsed.resetDelay || !!parsed.resetAfterSec ||
		/quota exceeded|rate_limit|rate limit|too many requests|resource_exhausted|resource has been exhausted|out of tokens|free usage limit|all \d+ accounts locked/i.test(text);

	if (isLimit) {
		const resetInfo = parsed.resetDelay ? loc.resetIn(parsed.resetDelay) : '';
		return {
			category: 'LIMIT',
			provider,
			model,
			title: loc.limitTitle,
			description: loc.limitDesc(provider, model, resetInfo)
		};
	}

	let errorCause = cleanMessageText(parsed.userMessage);
	if (parsed.isForbiddenPlan || statusCode === 403 || lower.includes('pricingurl') || lower.includes('subscription')) {
		errorCause = loc.paidRequired;
	} else if (parsed.isInsufficientCredits || statusCode === 402 || lower.includes('insufficient_credits')) {
		errorCause = loc.insufficientCredits;
	} else if (parsed.isUnauthorized || statusCode === 401 || lower.includes('unauthorized')) {
		errorCause = loc.credentialsExpired;
	} else if (statusCode === 404 || lower.includes('model_not_found')) {
		errorCause = loc.modelNotFound;
	} else if (!errorCause) {
		errorCause = loc.configError;
	}

	return {
		category: 'ERROR',
		provider,
		model,
		title: loc.errorTitle,
		description: loc.errorDesc(provider, errorCause)
	};
}
