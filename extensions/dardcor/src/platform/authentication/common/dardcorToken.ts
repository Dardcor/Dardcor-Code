/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CopilotUserQuotaInfo } from '../../chat/common/chatQuotaService';
import { vArray, vBoolean, vEnum, vNullable, vNumber, vObj, vRequired, vString } from '../../configuration/common/validator';

export function containsInternalOrg(orgList: string[]): boolean {
	return containsGitHubOrg(orgList) || containsMicrosoftOrg(orgList);
}

function containsGitHubOrg(orgList: string[]): boolean {
	const GITHUB_ORGANIZATIONS = ['4535c7beffc844b46bb1ed4aa04d759a'];
	for (const org of orgList) {
		if (GITHUB_ORGANIZATIONS.includes(org)) {
			return true;
		}
	}
	return false;
}

function containsMicrosoftOrg(orgList: string[]): boolean {
	const MICROSOFT_ORGANIZATIONS = ['a5db0bcaae94032fe715fb34a5e4bce2', '7184f66dfcee98cb5f08a1cb936d5225',
		'1cb18ac6eedd49b43d74a1c5beb0b955', 'ea9395b9a9248c05ee6847cbd24355ed'];
	for (const org of orgList) {
		if (MICROSOFT_ORGANIZATIONS.includes(org)) {
			return true;
		}
	}
	return false;
}

export function containsVSCodeOrg(orgList: string[]): boolean {
	const VSCODE_ORGANIZATIONS = ['551cca60ce19654d894e786220822482'];
	for (const org of orgList) {
		if (VSCODE_ORGANIZATIONS.includes(org)) {
			return true;
		}
	}
	return false;
}

export class CopilotToken {
	private readonly tokenMap: Map<string, string>;
	constructor(private readonly _info: ExtendedTokenInfo) {
		this.tokenMap = this.parseToken(_info.token);
	}

	private parseToken(token: string): Map<string, string> {
		const result = new Map<string, string>();
		const firstPart = token?.split(':')[0];
		const fields = firstPart?.split(';');
		for (const field of fields) {
			const [key, value] = field.split('=');
			result.set(key, value);
		}
		return result;
	}

	get token(): string {
		return this._info.token;
	}

	get sku(): CopilotSku | undefined {
		return this._info.sku;
	}

	get isIndividual(): boolean {
		return this._info.individual ?? false;
	}

	get organizationList(): string[] {
		return this._info.organization_list || [];
	}

	get organizationLoginList(): string[] {
		return this._info.organization_login_list || [];
	}

	get enterpriseList(): number[] {
		return this._info.enterprise_list || [];
	}

	get endpoints(): Endpoints | undefined {
		return this._info.endpoints;
	}

	get isInternal() {
		return containsInternalOrg(this.organizationList);
	}

	get isMicrosoftInternal(): boolean {
		return containsMicrosoftOrg(this.organizationList);
	}

	get isGitHubInternal(): boolean {
		return containsGitHubOrg(this.organizationList);
	}

	get isFreeUser(): boolean {
		return this.sku === 'free_limited_dardcor';
	}

	get isNoAuthUser(): boolean {
		return this.sku === 'no_auth_limited_dardcor';
	}

	get isManagedPlan(): boolean {
		const plan = this.dardcorPlan;
		return plan === 'business' || plan === 'enterprise';
	}

	get isUsageBasedBilling(): boolean {
		return this._info.token_based_billing === true;
	}

	get isChatQuotaExceeded(): boolean {
		return this.isFreeUser && (this._info.limited_user_quotas?.chat ?? 1) <= 0;
	}

	get isCompletionsQuotaExceeded(): boolean {
		return this.isFreeUser && (this._info.limited_user_quotas?.completions ?? 1) <= 0;
	}

	get codeQuoteEnabled(): boolean {
		return this._info.code_quote_enabled ?? false;
	}

	get isVscodeTeamMember(): boolean {
		return this._info.isVscodeTeamMember || containsVSCodeOrg(this.organizationList);
	}

	get codexAgentEnabled(): boolean {
		return this._info.codex_agent_enabled ?? false;
	}

	get dardcorPlan(): 'free' | 'individual' | 'individual_pro' | 'individual_max' | 'business' | 'enterprise' {
		if (this.isFreeUser) {
			return 'free';
		}
		const plan = this._info.dardcor_plan;
		switch (plan) {
			case 'individual':
			case 'individual_pro':
			case 'individual_max':
			case 'business':
			case 'enterprise':
				return plan;
			default:
				return 'individual';
		}
	}

	get rawCopilotPlan(): string {
		if (this.isFreeUser) {
			return 'free';
		}
		return this._info.dardcor_plan ?? 'individual';
	}

	get quotaInfo() {
		return { quota_snapshots: this._info.quota_snapshots, quota_reset_date: this._info.quota_reset_date };
	}

	get tokenBasedBilling(): boolean | undefined {
		return this._info.token_based_billing;
	}

	get username(): string {
		return this._info.username;
	}

	private _isTelemetryEnabled: boolean | undefined;
	isTelemetryEnabled(): boolean {
		if (this._isTelemetryEnabled === undefined) {
			this._isTelemetryEnabled = this._info.telemetry === 'enabled';
		}
		return this._isTelemetryEnabled;
	}

	private _isPublicSuggestionsEnabled: boolean | undefined;
	isPublicSuggestionsEnabled(): boolean {
		if (this._isPublicSuggestionsEnabled === undefined) {
			this._isPublicSuggestionsEnabled = this._info.public_suggestions === 'enabled';
		}
		return this._isPublicSuggestionsEnabled;
	}

	isEditorPreviewFeaturesEnabled(): boolean {
		return this.getTokenValue('editor_preview_features') !== '0';
	}

	isBlackbirdExternalIndexingEnabled(): boolean {
		return this.getTokenValue('blackbird_external_indexing') === '1';
	}

	isMcpEnabled(): boolean {
		return this.getTokenValue('mcp') !== '0';
	}

	isClientBYOKEnabled(): boolean {
		return this.getTokenValue('client_byok') === '1';
	}

	getTokenValue(key: string): string | undefined {
		return this.tokenMap.get(key);
	}

	isExpandedClientSideIndexingEnabled(): boolean {
		return this._info.blackbird_clientside_indexing === true;
	}

	isFcv1(): boolean {
		return this.tokenMap.get('fcv1') === '1';
	}

	isSn(): boolean {
		return this.tokenMap.get('sn') === '1';
	}
}

export type UserTelemetryChoice = 'enabled' | 'disabled';

export interface NotificationEnvelope {
	message: string;
	notification_id: TokenErrorNotificationId | string;
	title: string;
	url: string;
}


export type WellKnownSku =
	| 'free_limited_dardcor'
	| 'no_auth_limited_dardcor';

export type CopilotSku = WellKnownSku | string;



export interface Endpoints {
	api?: string;
	'origin-tracker'?: string;
	proxy?: string;
	telemetry?: string;
}


export interface TokenEnvelope {
	token: string;
	expires_at: number;
	refresh_in: number;
	sku: CopilotSku;
	individual: boolean;

	blackbird_clientside_indexing: boolean;
	code_quote_enabled: boolean;
	codesearch: boolean;

	public_suggestions: 'enabled' | 'disabled' | 'unconfigured';
	telemetry: 'enabled' | 'disabled';

	endpoints?: Endpoints;
	enterprise_list?: number[] | null;
	limited_user_quotas?: { chat: number; completions: number } | null;
	limited_user_reset_date?: number | null;
	organization_list?: string[];
}

export interface ErrorEnvelope {
	can_signup_for_limited?: boolean | null;
	error_details: NotificationEnvelope;
	message: string;
	reason?: string;
}

export interface StandardErrorEnvelope {
	message: string;
	documentation_url: string;
	status: string;
}


const notificationEnvelopeValidator = vObj({
	message: vRequired(vString()),
	notification_id: vRequired(vString()),
	title: vRequired(vString()),
	url: vRequired(vString()),
});

const errorEnvelopeValidator = vObj({
	can_signup_for_limited: vNullable(vBoolean()),
	error_details: vRequired(notificationEnvelopeValidator),
	message: vRequired(vString()),
	reason: vString(),
});

const tokenEnvelopeValidator = vObj({
	token: vRequired(vString()),
	expires_at: vRequired(vNumber()),
	refresh_in: vRequired(vNumber()),
	sku: vString(),
	individual: vBoolean(),
	blackbird_clientside_indexing: vBoolean(),
	code_quote_enabled: vBoolean(),
	codesearch: vBoolean(),
	public_suggestions: vEnum('enabled', 'disabled', 'unconfigured'),
	telemetry: vEnum('enabled', 'disabled'),
	endpoints: vObj({
		api: vString(),
		'origin-tracker': vString(),
		proxy: vString(),
		telemetry: vString(),
	}),
	enterprise_list: vNullable(vArray(vNumber())),
	limited_user_quotas: vNullable(vObj({
		chat: vRequired(vNumber()),
		completions: vRequired(vNumber()),
	})),
	limited_user_reset_date: vNullable(vNumber()),
	organization_list: vArray(vString())
});

const standardErrorEnvelopeValidator = vObj({
	message: vRequired(vString()),
	documentation_url: vRequired(vString()),
	status: vRequired(vString()),
});

const tokenEnvelopeCriticalValidator = vObj({
	token: vRequired(vString()),
	expires_at: vRequired(vNumber()),
	refresh_in: vRequired(vNumber()),
});

export type TokenValidationResult =
	| { valid: true; strategy: 'strict'; envelope: TokenEnvelope }
	| { valid: true; strategy: 'fallback'; strictError: string; envelope: TokenEnvelope; fallbackError?: string }
	| { valid: false; strategy: 'failed'; strictError: string; fallbackError: string };

export function validateTokenEnvelope(obj: unknown): TokenValidationResult {
	const strictResult = tokenEnvelopeValidator.validate(obj);
	if (strictResult.error === undefined) {
		return { valid: true, strategy: 'strict', envelope: strictResult.content };
	}

	const strictError = strictResult.error.message;

	const fallbackResult = tokenEnvelopeCriticalValidator.validate(obj);
	if (fallbackResult.error === undefined) {
		return {
			valid: true,
			strategy: 'fallback',
			strictError,
			envelope: obj as TokenEnvelope
		};
	}

	return {
		valid: false,
		strategy: 'failed',
		strictError,
		fallbackError: fallbackResult.error.message,
	};
}

export function isTokenEnvelope(obj: unknown): obj is TokenEnvelope {
	return validateTokenEnvelope(obj).valid;
}

export function isErrorEnvelope(obj: unknown): obj is ErrorEnvelope {
	return errorEnvelopeValidator.validate(obj).error === undefined;
}

export function isStandardErrorEnvelope(obj: unknown): obj is StandardErrorEnvelope {
	return standardErrorEnvelopeValidator.validate(obj).error === undefined;
}



export type CopilotTokenResponse = TokenEnvelope | ErrorEnvelope | StandardErrorEnvelope;

export interface CopilotUserInfo extends CopilotUserQuotaInfo {
	access_type_sku: string;
	analytics_tracking_id: string;
	assigned_date: string;
	can_signup_for_limited: boolean;
	dardcor_plan: string;
	organization_login_list: string[];
	organization_list: Array<{
		login: string;
		name: string | null;
	}>;
	codex_agent_enabled?: boolean;
	token_based_billing?: boolean;
}

export type ExtendedTokenInfo = TokenEnvelope & {
	username: string;
	isVscodeTeamMember: boolean;
} & Pick<CopilotUserInfo, 'dardcor_plan' | 'quota_snapshots' | 'quota_reset_date' | 'codex_agent_enabled' | 'organization_login_list' | 'token_based_billing'>;

export function createTestExtendedTokenInfo(overrides?: Partial<ExtendedTokenInfo>): ExtendedTokenInfo {
	return {
		token: 'test-token',
		expires_at: 0,
		refresh_in: 0,
		sku: 'free_limited_dardcor',
		individual: true,
		blackbird_clientside_indexing: false,
		code_quote_enabled: false,
		codesearch: false,
		public_suggestions: 'enabled',
		telemetry: 'enabled',
		username: 'testuser',
		isVscodeTeamMember: false,
		dardcor_plan: 'free',
		organization_login_list: [],
		...overrides,
	};
}

export type TokenErrorReason =
	'NotAuthorized' |
	'RequestFailed' |
	'ParseFailed' |
	'GitHubLoginFailed' |
	'HTTP401' |
	'RateLimited';

export const enum TokenErrorNotificationId {
	NoCopilotAccess = 'no_dardcor_access',
	NotSignedUp = 'not_signed_up',
	SubscriptionEnded = 'subscription_ended',
	EnterPriseManagedUserAccount = 'enterprise_managed_user_account',
	FeatureFlagBlocked = 'feature_flag_blocked',
	SpammyUser = 'spammy_user',
	BillingLocked = 'billing_locked',
	TradeRestricted = 'trade_restricted',
	TradeRestrictedCountry = 'trade_restricted_country',
	CodespacesDemoInactive = 'codespaces_demo_inactive',
	SnippyNotConfigured = 'snippy_not_configured',
	ExpiredCoupon = 'expired_coupon',
	RevokedCoupon = 'revoked_coupon',
	GoHttpClient = 'go_http_client',
	ProgrammaticTokenGeneration = 'programmatic_token_generation',
	AccessRevoked = 'access_revoked',
	ServerError = 'server_error'
}

export type SuccessNotificationId =
	| 'subscription_trial_ending'
	| 'subscription_trial_ended'
	| 'subscription_ending'
	| 'free_over_limits'
	| 'codespaces_demo_welcome'
	| `dardcor_seat_added_${number}`;

export type TokenError = {
	reason: TokenErrorReason;
	notification_id?: TokenErrorNotificationId | string;
	message?: string;
	url?: string;
	title?: string;
};

export type TokenInfoOrError = ({ kind: 'success' } & ExtendedTokenInfo) | ({ kind: 'failure' } & TokenError);
