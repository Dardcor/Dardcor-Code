/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from './buffer.js';

const WELL_KNOWN_ROUTE = '/.well-known';
export const AUTH_PROTECTED_RESOURCE_METADATA_DISCOVERY_PATH = `${WELL_KNOWN_ROUTE}/oauth-protected-resource`;
export const AUTH_SERVER_METADATA_DISCOVERY_PATH = `${WELL_KNOWN_ROUTE}/oauth-authorization-server`;
export const OPENID_CONNECT_DISCOVERY_PATH = `${WELL_KNOWN_ROUTE}/openid-configuration`;
export const AUTH_SCOPE_SEPARATOR = ' ';

export const GRANT_TYPE_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

export const TOKEN_TYPE_ACCESS_TOKEN = 'urn:ietf:params:oauth:token-type:access_token';

export const TOKEN_TYPE_ID_TOKEN = 'urn:ietf:params:oauth:token-type:id_token';

export const TOKEN_TYPE_ID_JAG = 'urn:ietf:params:oauth:token-type:id-jag';

export const GRANT_TYPE_JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

export function buildIdJagExchangeBody(clientId: string, clientSecret: string | undefined, idToken: string, audience: string, resource: string | undefined, scopes: readonly string[]): URLSearchParams {
	const body = new URLSearchParams();
	body.append('client_id', clientId);
	if (clientSecret) {
		body.append('client_secret', clientSecret);
	}
	body.append('grant_type', GRANT_TYPE_TOKEN_EXCHANGE);
	body.append('subject_token', idToken);
	body.append('subject_token_type', TOKEN_TYPE_ID_TOKEN);
	body.append('requested_token_type', TOKEN_TYPE_ID_JAG);
	body.append('audience', audience);
	if (resource) {
		body.append('resource', resource);
	}
	if (scopes.length) {
		body.append('scope', scopes.join(AUTH_SCOPE_SEPARATOR));
	}
	return body;
}

export function buildResourceRedemptionBody(clientId: string, clientSecret: string | undefined, idJag: string, resource: string | undefined, scopes: readonly string[]): URLSearchParams {
	const body = new URLSearchParams();
	body.append('client_id', clientId);
	if (clientSecret) {
		body.append('client_secret', clientSecret);
	}
	body.append('grant_type', GRANT_TYPE_JWT_BEARER);
	body.append('assertion', idJag);
	if (resource) {
		body.append('resource', resource);
	}
	if (scopes.length) {
		body.append('scope', scopes.join(AUTH_SCOPE_SEPARATOR));
	}
	return body;
}


export const enum AuthorizationErrorType {
	InvalidRequest = 'invalid_request',
	InvalidClient = 'invalid_client',
	InvalidGrant = 'invalid_grant',
	UnauthorizedClient = 'unauthorized_client',
	UnsupportedGrantType = 'unsupported_grant_type',
	InvalidScope = 'invalid_scope'
}

export const enum AuthorizationDeviceCodeErrorType {
	AuthorizationPending = 'authorization_pending',
	SlowDown = 'slow_down',
	AccessDenied = 'access_denied',
	ExpiredToken = 'expired_token'
}

export const enum AuthorizationRegistrationErrorType {
	InvalidRedirectUri = 'invalid_redirect_uri',
	InvalidClientMetadata = 'invalid_client_metadata',
	InvalidSoftwareStatement = 'invalid_software_statement',
	UnapprovedSoftwareStatement = 'unapproved_software_statement'
}

export interface IAuthorizationProtectedResourceMetadata {
	resource: string;

	resource_name?: string;

	authorization_servers?: string[];

	jwks_uri?: string;

	scopes_supported?: string[];

	bearer_methods_supported?: string[];

	resource_signing_alg_values_supported?: string[];

	resource_encryption_alg_values_supported?: string[];

	resource_encryption_enc_values_supported?: string[];

	resource_documentation?: string;

	resource_policy_uri?: string;

	resource_tos_uri?: string;
}

export interface IAuthorizationServerMetadata {
	issuer: string;

	authorization_endpoint?: string;

	token_endpoint?: string;

	device_authorization_endpoint?: string;

	jwks_uri?: string;

	registration_endpoint?: string;

	scopes_supported?: string[];

	response_types_supported: string[];

	response_modes_supported?: string[];

	grant_types_supported?: string[];

	token_endpoint_auth_methods_supported?: string[];

	token_endpoint_auth_signing_alg_values_supported?: string[];

	service_documentation?: string;

	ui_locales_supported?: string[];

	op_policy_uri?: string;

	op_tos_uri?: string;

	revocation_endpoint?: string;

	revocation_endpoint_auth_methods_supported?: string[];

	revocation_endpoint_auth_signing_alg_values_supported?: string[];

	introspection_endpoint?: string;

	introspection_endpoint_auth_methods_supported?: string[];

	introspection_endpoint_auth_signing_alg_values_supported?: string[];

	code_challenge_methods_supported?: string[];

	client_id_metadata_document_supported?: boolean;
}

export interface IAuthorizationDynamicClientRegistrationRequest {
	redirect_uris?: string[];

	token_endpoint_auth_method?: string;

	grant_types?: string[];

	response_types?: string[];

	client_name?: string;

	client_uri?: string;

	logo_uri?: string;

	scope?: string;

	contacts?: string[];

	tos_uri?: string;

	policy_uri?: string;

	jwks_uri?: string;

	jwks?: object;

	software_id?: string;

	software_version?: string;

	software_statement?: string;

	application_type?: 'native' | 'web' | string;

	[key: string]: unknown;
}

export interface IAuthorizationDynamicClientRegistrationResponse {
	client_id: string;

	client_secret?: string;

	client_secret_expires_at?: number;

	client_name?: string;

	client_uri?: string;

	redirect_uris?: string[];

	grant_types?: string[];

	response_types?: string[];

	token_endpoint_auth_method?: string;
}

export interface IAuthorizationAuthorizeResponse {
	code: string;

	state: string;
}

export interface IAuthorizationAuthorizeErrorResponse {
	error: string;

	error_description?: string;

	error_uri?: string;

	state: string;
}

export interface IAuthorizationTokenResponse {
	access_token: string;

	token_type: string;

	expires_in?: number;

	refresh_token?: string;

	scope?: string;

	id_token?: string;
}

export interface IAuthorizationTokenErrorResponse {
	error: string;

	error_description?: string;

	error_uri?: string;
}

export interface IAuthorizationDeviceResponse {
	device_code: string;

	user_code: string;

	verification_uri: string;

	verification_uri_complete?: string;

	expires_in: number;

	interval?: number;
}

export interface IAuthorizationErrorResponse {
	error: AuthorizationErrorType | string;

	error_description?: string;

	error_uri?: string;
}

export interface IAuthorizationDeviceTokenErrorResponse extends IAuthorizationErrorResponse {
	error: AuthorizationErrorType | AuthorizationDeviceCodeErrorType | string;
}

export interface IAuthorizationRegistrationErrorResponse {
	error: AuthorizationRegistrationErrorType | string;

	error_description?: string;
}

export interface IAuthorizationJWTClaims {
	jti: string;

	sub: string;

	iss: string;

	aud?: string | string[];

	exp?: number;

	nbf?: number;

	iat?: number;

	azp?: string;

	scope?: string;

	name?: string;

	given_name?: string;

	family_name?: string;

	middle_name?: string;

	preferred_username?: string;

	email?: string;

	email_verified?: boolean;

	picture?: string;

	auth_time?: number;

	acr?: string;

	amr?: string[];

	sid?: string;

	address?: {
		formatted?: string;
		street_address?: string;
		locality?: string;
		region?: string;
		postal_code?: string;
		country?: string;
	};

	groups?: string[];

	roles?: string[];

	[key: string]: unknown;
}



export function isAuthorizationProtectedResourceMetadata(obj: unknown): obj is IAuthorizationProtectedResourceMetadata {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}

	const metadata = obj as IAuthorizationProtectedResourceMetadata;
	if (!metadata.resource) {
		return false;
	}
	if (metadata.scopes_supported !== undefined && !Array.isArray(metadata.scopes_supported)) {
		return false;
	}
	return true;
}

const urisToCheck: Array<keyof IAuthorizationServerMetadata> = [
	'issuer',
	'authorization_endpoint',
	'token_endpoint',
	'registration_endpoint',
	'jwks_uri'
];
export function isAuthorizationServerMetadata(obj: unknown): obj is IAuthorizationServerMetadata {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const metadata = obj as IAuthorizationServerMetadata;
	if (!metadata.issuer) {
		throw new Error('Authorization server metadata must have an issuer');
	}

	for (const uri of urisToCheck) {
		if (!metadata[uri]) {
			continue;
		}
		if (typeof metadata[uri] !== 'string') {
			throw new Error(`Authorization server metadata '${uri}' must be a string`);
		}
		if (!metadata[uri].startsWith('https://') && !metadata[uri].startsWith('http://')) {
			throw new Error(`Authorization server metadata '${uri}' must start with http:// or https://`);
		}
	}
	return true;
}

export function isAuthorizationDynamicClientRegistrationResponse(obj: unknown): obj is IAuthorizationDynamicClientRegistrationResponse {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const response = obj as IAuthorizationDynamicClientRegistrationResponse;
	return response.client_id !== undefined;
}

export function isAuthorizationAuthorizeResponse(obj: unknown): obj is IAuthorizationAuthorizeResponse {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const response = obj as IAuthorizationAuthorizeResponse;
	return response.code !== undefined && response.state !== undefined;
}

export function isAuthorizationTokenResponse(obj: unknown): obj is IAuthorizationTokenResponse {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const response = obj as IAuthorizationTokenResponse;
	return response.access_token !== undefined && response.token_type !== undefined;
}

export function isAuthorizationDeviceResponse(obj: unknown): obj is IAuthorizationDeviceResponse {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const response = obj as IAuthorizationDeviceResponse;
	return response.device_code !== undefined && response.user_code !== undefined && response.verification_uri !== undefined && response.expires_in !== undefined;
}

export function isAuthorizationErrorResponse(obj: unknown): obj is IAuthorizationErrorResponse {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const response = obj as IAuthorizationErrorResponse;
	return response.error !== undefined;
}

export function isAuthorizationRegistrationErrorResponse(obj: unknown): obj is IAuthorizationRegistrationErrorResponse {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const response = obj as IAuthorizationRegistrationErrorResponse;
	return response.error !== undefined;
}


export function getDefaultMetadataForUrl(authorizationServer: URL): IAuthorizationServerMetadata {
	return {
		issuer: authorizationServer.toString(),
		authorization_endpoint: new URL('/authorize', authorizationServer).toString(),
		token_endpoint: new URL('/token', authorizationServer).toString(),
		registration_endpoint: new URL('/register', authorizationServer).toString(),
		response_types_supported: ['code', 'id_token', 'id_token token'],
	};
}

const grantTypesSupported = ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'];

export const DEFAULT_AUTH_FLOW_PORT = 33418;
export async function fetchDynamicRegistration(serverMetadata: IAuthorizationServerMetadata, clientName: string, scopes?: string[]): Promise<IAuthorizationDynamicClientRegistrationResponse> {
	if (!serverMetadata.registration_endpoint) {
		throw new Error('Server does not support dynamic registration');
	}

	const requestBody: IAuthorizationDynamicClientRegistrationRequest = {
		client_name: clientName,
		client_uri: 'https://www.dardcor-code.web.id',
		grant_types: serverMetadata.grant_types_supported
			? serverMetadata.grant_types_supported.filter(gt => grantTypesSupported.includes(gt))
			: grantTypesSupported,
		response_types: ['code'],
		redirect_uris: [
			'https://insiders.vscode.dev/redirect',
			'https://vscode.dev/redirect',
			'http://127.0.0.1/',
			`http://127.0.0.1:${DEFAULT_AUTH_FLOW_PORT}/`
		],
		scope: scopes?.join(AUTH_SCOPE_SEPARATOR),
		token_endpoint_auth_method: 'none',
		application_type: 'native'
	};

	const response = await fetch(serverMetadata.registration_endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(requestBody)
	});

	if (!response.ok) {
		const result = await response.text();
		let errorDetails: string = result;

		try {
			const errorResponse = JSON.parse(result);
			if (isAuthorizationRegistrationErrorResponse(errorResponse)) {
				errorDetails = `${errorResponse.error}${errorResponse.error_description ? `: ${errorResponse.error_description}` : ''}`;
			}
		} catch {
		}

		throw new Error(`Registration to ${serverMetadata.registration_endpoint} failed: ${errorDetails}`);
	}

	const registration = await response.json();
	if (isAuthorizationDynamicClientRegistrationResponse(registration)) {
		return registration;
	}
	throw new Error(`Invalid authorization dynamic client registration response: ${JSON.stringify(registration)}`);
}

export interface IAuthenticationChallenge {
	scheme: string;
	params: Record<string, string>;
}

export function parseWWWAuthenticateHeader(wwwAuthenticateHeaderValue: string): IAuthenticationChallenge[] {
	const challenges: IAuthenticationChallenge[] = [];


	const tokens: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < wwwAuthenticateHeaderValue.length; i++) {
		const char = wwwAuthenticateHeaderValue[i];

		if (char === '"') {
			inQuotes = !inQuotes;
			current += char;
		} else if (char === ',' && !inQuotes) {
			if (current.trim()) {
				tokens.push(current.trim());
			}
			current = '';
		} else {
			current += char;
		}
	}

	if (current.trim()) {
		tokens.push(current.trim());
	}

	let currentChallenge: { scheme: string; params: Record<string, string> } | undefined;

	for (const token of tokens) {
		const hasEquals = token.includes('=');

		if (!hasEquals) {
			if (currentChallenge) {
				challenges.push(currentChallenge);
			}
			currentChallenge = { scheme: token.trim(), params: {} };
		} else {

			const spaceIndex = token.indexOf(' ');
			if (spaceIndex > 0) {
				const beforeSpace = token.substring(0, spaceIndex);
				const afterSpace = token.substring(spaceIndex + 1);

				if (!beforeSpace.includes('=') && afterSpace.includes('=')) {
					if (currentChallenge) {
						challenges.push(currentChallenge);
					}
					currentChallenge = { scheme: beforeSpace.trim(), params: {} };

					const equalIndex = afterSpace.indexOf('=');
					if (equalIndex > 0) {
						const key = afterSpace.substring(0, equalIndex).trim();
						const value = afterSpace.substring(equalIndex + 1).trim().replace(/^"|"$/g, '');
						if (key && value !== undefined) {
							currentChallenge.params[key] = value;
						}
					}
					continue;
				}
			}

			if (currentChallenge) {
				const equalIndex = token.indexOf('=');
				if (equalIndex > 0) {
					const key = token.substring(0, equalIndex).trim();
					const value = token.substring(equalIndex + 1).trim().replace(/^"|"$/g, '');
					if (key && value !== undefined) {
						currentChallenge.params[key] = value;
					}
				}
			}
		}
	}

	if (currentChallenge) {
		challenges.push(currentChallenge);
	}

	return challenges;
}

export function getClaimsFromJWT(token: string): IAuthorizationJWTClaims {
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw new Error('Invalid JWT token format: token must have three parts separated by dots');
	}

	const [header, payload, _signature] = parts;

	try {
		const decodedHeader = JSON.parse(decodeBase64(header).toString());
		if (typeof decodedHeader !== 'object') {
			throw new Error('Invalid JWT token format: header is not a JSON object');
		}

		const decodedPayload = JSON.parse(decodeBase64(payload).toString());
		if (typeof decodedPayload !== 'object') {
			throw new Error('Invalid JWT token format: payload is not a JSON object');
		}

		return decodedPayload;
	} catch (e) {
		if (e instanceof Error) {
			throw new Error(`Failed to parse JWT token: ${e.message}`);
		}
		throw new Error('Failed to parse JWT token');
	}
}

export function scopesMatch(scopes1: readonly string[] | undefined, scopes2: readonly string[] | undefined): boolean {
	if (scopes1 === scopes2) {
		return true;
	}
	if (!scopes1 || !scopes2) {
		return false;
	}
	if (scopes1.length !== scopes2.length) {
		return false;
	}

	const sortedScopes1 = [...scopes1].sort();
	const sortedScopes2 = [...scopes2].sort();

	return sortedScopes1.every((scope, index) => scope === sortedScopes2[index]);
}

interface CommonResponse {
	status: number;
	statusText: string;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

interface IFetcher {
	(input: string, init: { method: string; headers: Record<string, string> }): Promise<CommonResponse>;
}

export interface IFetchResourceMetadataOptions {
	sameOriginHeaders?: Record<string, string>;
	/**
	 * Optional custom fetch implementation (defaults to global fetch)
	 */
	fetch?: IFetcher;
}

export async function fetchResourceMetadata(
	targetResource: string,
	resourceMetadataUrl: string | undefined,
	options: IFetchResourceMetadataOptions = {}
): Promise<{ metadata: IAuthorizationProtectedResourceMetadata; discoveryUrl: string; errors: Error[] }> {
	const {
		sameOriginHeaders = {},
		fetch: fetchImpl = fetch
	} = options;

	const targetResourceUrlObj = new URL(targetResource);

	const fetchPrm = async (prmUrl: string, validateUrl: string) => {
		let headers: Record<string, string> = {
			'Accept': 'application/json'
		};

		const resourceMetadataUrlObj = new URL(prmUrl);
		if (resourceMetadataUrlObj.origin === targetResourceUrlObj.origin) {
			headers = {
				...headers,
				...sameOriginHeaders
			};
		}

		const response = await fetchImpl(prmUrl, { method: 'GET', headers });
		if (response.status !== 200) {
			let errorText: string;
			try {
				errorText = await response.text();
			} catch {
				errorText = response.statusText;
			}
			throw new Error(`Failed to fetch resource metadata from ${prmUrl}: ${response.status} ${errorText}`);
		}

		const body = await response.json();
		if (isAuthorizationProtectedResourceMetadata(body)) {
			const prmValue = new URL(body.resource).toString();
			const expectedResource = new URL(validateUrl).toString();
			if (prmValue !== expectedResource) {
				throw new Error(`Protected Resource Metadata 'resource' property value "${prmValue}" does not match expected value "${expectedResource}" for URL ${prmUrl}. Per RFC 9728, these MUST match. See https://datatracker.ietf.org/doc/html/rfc9728#PRConfigurationValidation`);
			}
			return body;
		} else {
			throw new Error(`Invalid resource metadata from ${prmUrl}. Expected to follow shape of https://datatracker.ietf.org/doc/html/rfc9728#name-protected-resource-metadata (Hints: is scopes_supported an array? Is resource a string?). Current payload: ${JSON.stringify(body)}`);
		}
	};

	const errors: Error[] = [];
	if (resourceMetadataUrl) {
		try {
			const metadata = await fetchPrm(resourceMetadataUrl, targetResource);
			return { metadata, discoveryUrl: resourceMetadataUrl, errors };
		} catch (e) {
			errors.push(e instanceof Error ? e : new Error(String(e)));
		}
	}

	const hasPathComponent = targetResourceUrlObj.pathname !== '/';
	const rootUrl = `${targetResourceUrlObj.origin}${AUTH_PROTECTED_RESOURCE_METADATA_DISCOVERY_PATH}`;

	if (hasPathComponent) {
		const pathAppendedUrl = `${rootUrl}${targetResourceUrlObj.pathname}`;
		try {
			const metadata = await fetchPrm(pathAppendedUrl, targetResource);
			return { metadata, discoveryUrl: pathAppendedUrl, errors };
		} catch (e) {
			errors.push(e instanceof Error ? e : new Error(String(e)));
		}
	}

	try {
		const metadata = await fetchPrm(rootUrl, targetResourceUrlObj.origin);
		return { metadata, discoveryUrl: rootUrl, errors };
	} catch (e) {
		errors.push(e instanceof Error ? e : new Error(String(e)));
	}

	if (errors.length === 1) {
		throw errors[0];
	} else {
		throw new AggregateError(errors, 'Failed to fetch resource metadata from all attempted URLs');
	}
}

export interface IFetchAuthorizationServerMetadataOptions {
	additionalHeaders?: Record<string, string>;
	/**
	 * Optional custom fetch implementation (defaults to global fetch)
	 */
	fetch?: IFetcher;
}

async function tryParseAuthServerMetadata(response: CommonResponse): Promise<IAuthorizationServerMetadata | undefined> {
	if (response.status !== 200) {
		return undefined;
	}
	try {
		const body = await response.json();
		if (isAuthorizationServerMetadata(body)) {
			return body;
		}
	} catch {
	}
	return undefined;
}

async function getErrText(res: CommonResponse): Promise<string> {
	try {
		return await res.text();
	} catch {
		return res.statusText;
	}
}

export async function fetchAuthorizationServerMetadata(
	authorizationServer: string,
	options: IFetchAuthorizationServerMetadataOptions = {}
): Promise<{ metadata: IAuthorizationServerMetadata; discoveryUrl: string; errors: Error[] }> {
	const {
		additionalHeaders = {},
		fetch: fetchImpl = fetch
	} = options;

	const authorizationServerUrl = new URL(authorizationServer);
	const extraPath = authorizationServerUrl.pathname === '/' ? '' : authorizationServerUrl.pathname;

	const errors: Error[] = [];

	const doFetch = async (url: string): Promise<IAuthorizationServerMetadata | undefined> => {
		try {
			const rawResponse = await fetchImpl(url, {
				method: 'GET',
				headers: {
					...additionalHeaders,
					'Accept': 'application/json'
				}
			});
			const metadata = await tryParseAuthServerMetadata(rawResponse);
			if (metadata) {
				return metadata;
			}
			errors.push(new Error(`Failed to fetch authorization server metadata from ${url}: ${rawResponse.status} ${await getErrText(rawResponse)}`));
			return undefined;
		} catch (e) {
			errors.push(e instanceof Error ? e : new Error(String(e)));
			return undefined;
		}
	};

	const pathToFetch = new URL(AUTH_SERVER_METADATA_DISCOVERY_PATH, authorizationServer).toString() + extraPath;
	let metadata = await doFetch(pathToFetch);
	if (metadata) {
		return { metadata, discoveryUrl: pathToFetch, errors };
	}

	const openidPathInsertionUrl = new URL(OPENID_CONNECT_DISCOVERY_PATH, authorizationServer).toString() + extraPath;
	metadata = await doFetch(openidPathInsertionUrl);
	if (metadata) {
		return { metadata, discoveryUrl: openidPathInsertionUrl, errors };
	}

	const openidPathAdditionUrl = authorizationServer.endsWith('/')
		? authorizationServer + OPENID_CONNECT_DISCOVERY_PATH.substring(1)
		: authorizationServer + OPENID_CONNECT_DISCOVERY_PATH;
	metadata = await doFetch(openidPathAdditionUrl);
	if (metadata) {
		return { metadata, discoveryUrl: openidPathAdditionUrl, errors };
	}

	if (errors.length === 1) {
		throw errors[0];
	} else {
		throw new AggregateError(errors, 'Failed to fetch authorization server metadata from all attempted URLs');
	}
}
