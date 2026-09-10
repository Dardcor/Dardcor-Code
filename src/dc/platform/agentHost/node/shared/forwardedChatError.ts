import { CopilotApiError, COPILOT_API_ERROR_STATUS_STREAMING } from './copilotApiService.js';
export const PROXY_ERROR_PREFIX = 'VSCODE_PROXY_ERROR:';
const MAX_FORWARDED_MARKER_B64_LENGTH = 8 * 1024;
const FORWARDED_MARKER_B64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
export interface IForwardedChatFetchError {
    readonly type: string;
    readonly reason?: string;
    readonly requestId?: string;
    readonly serverRequestId?: string;
    readonly category?: string;
    readonly retryAfter?: number;
    readonly isAuto?: boolean;
    readonly capiError?: {
        readonly code?: string;
        readonly message?: string;
    };
}
export interface IForwardedChatError {
    readonly fetchError: IForwardedChatFetchError;
    readonly copilotPlan?: string;
    readonly isUsageBasedBilling?: boolean;
    readonly quotaResetDate?: string;
}
function statusToFetchType(status: number): string {
    switch (status) {
        case 402:
            return 'quotaExceeded';
        case 429:
            return 'rateLimited';
        case 499:
            return 'canceled';
        case 400:
            return 'badRequest';
        case 401:
        case 403:
            return 'agent_unauthorized';
        case 404:
            return 'notFound';
        default:
            return 'failed';
    }
}
export function buildForwardedChatError(err: CopilotApiError): IForwardedChatError {
    const status = err.status === COPILOT_API_ERROR_STATUS_STREAMING ? 502 : err.status;
    const requestId = typeof err.envelope.request_id === 'string' ? err.envelope.request_id : '';
    const capiError = extractCapiError(err.envelope.error.message) ?? { code: err.envelope.error.type, message: err.envelope.error.message };
    return {
        fetchError: {
            type: statusToFetchType(status),
            reason: capiError.message ?? err.envelope.error.message,
            requestId,
            capiError,
        },
    };
}
function extractCapiError(message: string): {
    code?: string;
    message?: string;
} | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(message);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    const error = (parsed as {
        error?: unknown;
    }).error;
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    const code = (error as {
        code?: unknown;
    }).code;
    const msg = (error as {
        message?: unknown;
    }).message;
    if (typeof code !== 'string' && typeof msg !== 'string') {
        return undefined;
    }
    return {
        code: typeof code === 'string' ? code : undefined,
        message: typeof msg === 'string' ? msg : undefined,
    };
}
export function encodeForwardedChatError(forwarded: IForwardedChatError): string {
    return `${PROXY_ERROR_PREFIX}${Buffer.from(JSON.stringify(forwarded)).toString('base64')}`;
}
export interface ISdkChatErrorFields {
    readonly errorType: string;
    readonly errorCode?: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly providerCallId?: string;
    readonly serviceRequestId?: string;
}
function sdkErrorTypeToFetchType(errorType: string, statusCode: number | undefined): string | undefined {
    switch (errorType) {
        case 'quota':
            return 'quotaExceeded';
        case 'rate_limit':
            return 'rateLimited';
        case 'context_limit':
            return 'length';
        case 'authentication':
        case 'authorization':
            return 'agent_unauthorized';
    }
    return statusCode !== undefined ? statusToFetchType(statusCode) : undefined;
}
export function buildForwardedChatErrorFromFields(data: ISdkChatErrorFields): IForwardedChatError | undefined {
    const type = sdkErrorTypeToFetchType(data.errorType, data.statusCode);
    if (!type) {
        return undefined;
    }
    const code = data.errorCode ?? (type === 'quotaExceeded' ? 'quota_exceeded' : undefined);
    const capiError = (code || data.message) ? { code, message: data.message } : undefined;
    return {
        fetchError: {
            type,
            reason: data.message,
            requestId: data.providerCallId ?? '',
            serverRequestId: data.serviceRequestId,
            ...(capiError && { capiError }),
        },
    };
}
export function tryParseForwardedChatError(errorText: string | undefined): IForwardedChatError | undefined {
    if (!errorText) {
        return undefined;
    }
    const idx = errorText.indexOf(PROXY_ERROR_PREFIX);
    if (idx === -1) {
        return undefined;
    }
    const start = idx + PROXY_ERROR_PREFIX.length;
    const end = errorText.slice(start).search(/[\s"']/);
    const b64 = end === -1 ? errorText.slice(start) : errorText.slice(start, start + end);
    if (b64.length === 0 || b64.length > MAX_FORWARDED_MARKER_B64_LENGTH || !FORWARDED_MARKER_B64_PATTERN.test(b64)) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(Buffer.from(b64, 'base64').toString()) as IForwardedChatError;
        if (parsed && typeof parsed === 'object' && parsed.fetchError && typeof parsed.fetchError.type === 'string') {
            return parsed;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export function stripProxyErrorMarker(text: string): string {
    const idx = text.indexOf(PROXY_ERROR_PREFIX);
    if (idx === -1) {
        return text;
    }
    return text.slice(0, idx).trim() || text.slice(0, idx);
}
export function toChatErrorMeta(forwarded: IForwardedChatError): Record<string, unknown> {
    return { chatError: forwarded };
}
export function tryBuildChatErrorMeta(errorText: string | undefined): Record<string, unknown> | undefined {
    const forwarded = tryParseForwardedChatError(errorText);
    return forwarded ? toChatErrorMeta(forwarded) : undefined;
}
export function tryBuildChatErrorMetaFromFields(data: ISdkChatErrorFields): Record<string, unknown> | undefined {
    const forwarded = buildForwardedChatErrorFromFields(data);
    return forwarded ? toChatErrorMeta(forwarded) : undefined;
}
export function extractForwardedErrorInfo(message: string): {
    message: string;
    _meta?: Record<string, unknown>;
} {
    const forwarded = tryParseForwardedChatError(message);
    if (!forwarded) {
        return { message };
    }
    return { message: stripProxyErrorMarker(message), _meta: toChatErrorMeta(forwarded) };
}
