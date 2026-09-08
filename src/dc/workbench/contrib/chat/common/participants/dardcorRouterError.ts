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
	isQuotaExhausted: boolean;
	technicalDetails?: string;
}

/**
 * Parses raw error text from Dardcor Router (handling nested JSON, Cloud Code / Google ErrorInfo,
 * OpenAI, Anthropic, Gemini, DeepSeek, and local router formats).
 */
export function parseDardcorRouterError(statusCode: number, rawError: string, fallbackModel?: string): IParsedRouterError {
	let detectedModel = fallbackModel;
	let detectedProvider: string | undefined;
	let userMessage = '';
	let statusMessage = '';
	let resetDelay: string | undefined;
	let resetTimeStamp: string | undefined;
	let isQuotaExhausted = statusCode === 429;

	const trimmed = (rawError || '').trim();

	// Check for bracketed provider/model tag, e.g. "[antigravity/claude-opus-4-6-thinking] [429]: ..."
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

	// Try parsing JSON
	let parsedJson: any;
	try {
		parsedJson = JSON.parse(trimmed);
	} catch {
		// Look for embedded JSON substring { ... }
		const jsonMatch = innerPayload.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				parsedJson = JSON.parse(jsonMatch[0]);
			} catch { }
		}
	}

	if (parsedJson) {
		// Traverse nested error object
		let errObj = parsedJson.error ?? parsedJson;

		// Sometimes error.message is itself a string with another nested JSON:
		// e.g. error.message = "[antigravity/claude-opus-4-6-thinking] [429]: {\n \"error\": ..."
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

			// Extract reset after if present in message: e.g. "(reset after 4s)"
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

		// Extract fields from errObj
		if (typeof errObj === 'object' && errObj !== null) {
			if (errObj.code === 429 || errObj.status === 'RESOURCE_EXHAUSTED' || errObj.type === 'insufficient_quota' || errObj.type === 'rate_limit_error') {
				isQuotaExhausted = true;
			}
			if (errObj.status) {
				statusMessage = String(errObj.status);
			}
			if (errObj.message && typeof errObj.message === 'string') {
				userMessage = errObj.message;
			} else if (errObj.type) {
				userMessage = String(errObj.type);
			}

			// Extract Google / CloudCode ErrorInfo details
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

	// Fallback message extraction from raw string
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

		// Extract any "Resets in ..." or "reset after ..." text
		const resetsInMatch = trimmed.match(/Resets in ([^\.\n\r]+)/i);
		if (resetsInMatch) {
			resetDelay = resetsInMatch[1].trim();
		}
		const resetAfterMatch = trimmed.match(/reset after ([^\)\n\r]+)/i);
		if (resetAfterMatch && !resetDelay) {
			resetDelay = resetAfterMatch[1].trim();
		}

		// Clean up user message
		if (isQuotaExhausted) {
			userMessage = 'The token quota limit has been reached for this model. Please switch to another model or wait until the quota resets.';
		} else {
			// Strip raw json braces if too ugly
			userMessage = trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed;
		}
	}

	// Format reset delay human-readable
	if (resetDelay) {
		resetDelay = formatResetDelay(resetDelay);
	}

	// Format reset timestamp human-readable
	if (resetTimeStamp) {
		resetTimeStamp = formatResetTimestamp(resetTimeStamp);
	}

	// Clean userMessage from raw JSON strings or broken brackets
	userMessage = cleanMessageText(userMessage);

	// Infer provider name from model if still unknown
	if (!detectedProvider && detectedModel) {
		detectedProvider = inferProviderFromModel(detectedModel);
	}

	return {
		statusCode,
		model: detectedModel,
		provider: detectedProvider,
		statusMessage: statusMessage || (isQuotaExhausted ? 'RESOURCE_EXHAUSTED (429)' : `HTTP ${statusCode}`),
		userMessage,
		resetDelay,
		resetTimeStamp,
		isQuotaExhausted,
		technicalDetails: trimmed.length > 300 ? trimmed.substring(0, 500) : undefined
	};
}

/**
 * Formats the parsed error into a beautiful, neat, and structured Markdown card in English.
 */
export function formatDardcorRouterError(statusCode: number, rawError: string, fallbackModel?: string): string {
	const parsed = parseDardcorRouterError(statusCode, rawError, fallbackModel);
	const modelDisplay = formatModelDisplayName(parsed.model || fallbackModel || 'Unknown Model');
	const providerDisplay = formatProviderDisplayName(parsed.provider);

	if (parsed.isQuotaExhausted) {
		const lines: string[] = [
			'### ⚠️ Token Quota Exhausted (*Rate Limit Reached*)',
			'',
			`> 🤖 **Model:** \`${modelDisplay}\``,
			`> 📡 **Provider:** **${providerDisplay}**`,
			`> ⚡ **Status:** \`${parsed.statusMessage || 'HTTP 429 - RESOURCE_EXHAUSTED'}\``,
		];

		if (parsed.resetDelay) {
			lines.push(`> ⏳ **Reset Countdown:** \`${parsed.resetDelay}\``);
		}
		if (parsed.resetTimeStamp) {
			lines.push(`> 🗓️ **Reset Time:** \`${parsed.resetTimeStamp}\``);
		}

		lines.push(
			'',
			'**Provider Message:**',
			`> *${parsed.userMessage}*`,
			'',
			'---',
			'💡 **Suggested Actions:**',
			'1. **Switch Model:** Click the model picker at the bottom of the chat to select another model with available quota (e.g., **Gemini 2.5 Flash**, **Claude 3.7 Sonnet**, or other Dardcor models).',
			'2. **Check Router Status:** Open the Dardcor Router status to monitor remaining quotas or connect a different provider account.',
			'3. **Wait for Reset:** The quota will automatically replenish once the cooldown period above expires.'
		);

		return lines.join('\n');
	}

	// For non-quota errors (e.g. 401 Unauthorized, 500 Server Error, Network Error)
	const lines: string[] = [
		`### ⚠️ Router Issue (${parsed.statusCode > 0 ? `HTTP ${parsed.statusCode}` : 'Connection Lost'})`,
		'',
		`> 🤖 **Model:** \`${modelDisplay}\``,
		`> 📡 **Provider:** **${providerDisplay}**`,
		'',
		'**Issue Details:**',
		`> *${parsed.userMessage}*`,
		'',
		'---',
		'💡 **Suggestions:**',
		'- Ensure **Dardcor Router** server is running and active (port `25128`).',
		'- Verify that your API key or provider account connection in the router is valid.',
		'- Try selecting another model from a different provider.'
	];

	return lines.join('\n');
}

function formatResetDelay(delayStr: string): string {
	// e.g. "166h47m22.700871438s" -> "166 hours 47 minutes 22 seconds"
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
	// Fallback: e.g. "600442s"
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

function cleanMessageText(text: string): string {
	let cleaned = text.trim();
	// Remove trailing JSON fragments, unclosed quotes, brackets, or weird markdown urls like "](https://microsoft.com)))"
	cleaned = cleaned.replace(/\]\(https?:\/\/[^\)]+\)\)*$/g, '');
	cleaned = cleaned.replace(/\s*\(reset after [^\)]+\)/gi, '');
	cleaned = cleaned.replace(/^"|"$/g, '');
	cleaned = cleaned.replace(/\\n/g, ' ');
	cleaned = cleaned.replace(/\\"/g, '"');
	cleaned = cleaned.replace(/\s{2,}/g, ' ');
	return cleaned;
}

function formatModelDisplayName(modelId: string): string {
	const cleaned = modelId.replace(/^(ag|oc|ds|opencode|gemini|grok|claude|openai)\//i, '');
	return cleaned
		.split(/[-_]/)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function inferProviderFromModel(modelId: string): string {
	const lower = modelId.toLowerCase();
	if (lower.startsWith('antigravity/') || lower.startsWith('ag/')) return 'Antigravity';
	if (lower.startsWith('claude') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku')) return 'Anthropic (Claude)';
	if (lower.startsWith('gemini') || lower.includes('flash') || lower.includes('pro-exp')) return 'Google Gemini';
	if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.includes('openai')) return 'OpenAI';
	if (lower.startsWith('grok') || lower.includes('xai')) return 'xAI (Grok)';
	if (lower.startsWith('deepseek') || lower.includes('r1')) return 'DeepSeek';
	if (lower.startsWith('oc/') || lower.includes('opencode') || lower.includes('pickle')) return 'OpenCode (Local)';
	return 'Dardcor Router';
}

function formatProviderDisplayName(provider?: string): string {
	if (!provider) return 'Dardcor Router';
	const lower = provider.toLowerCase();
	if (lower.includes('antigravity')) return 'Antigravity';
	if (lower.includes('claude') || lower.includes('anthropic')) return 'Anthropic (Claude)';
	if (lower.includes('gemini') || lower.includes('google')) return 'Google Gemini';
	if (lower.includes('openai')) return 'OpenAI';
	if (lower.includes('grok') || lower.includes('xai')) return 'xAI (Grok)';
	if (lower.includes('deepseek')) return 'DeepSeek';
	if (lower.includes('opencode') || lower.includes('oc')) return 'OpenCode Local';
	return provider.charAt(0).toUpperCase() + provider.slice(1);
}
