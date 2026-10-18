/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { stringHash } from '../../../base/common/hash.js';
import { buildIdJagExchangeBody, buildResourceRedemptionBody, fetchAuthorizationServerMetadata, getClaimsFromJWT, IAuthorizationJWTClaims, IAuthorizationTokenResponse, isAuthorizationTokenResponse } from '../../../base/common/oauth.js';
import { DynamicAuthProvider } from './extHostAuthentication.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor<T> = new (...args: any[]) => T;

export const IDP_SCOPES: readonly string[] = ['openid', 'offline_access'];

interface IResourceCacheEntry {
	readonly resource: string;
	readonly scopes: readonly string[];
	readonly token: IAuthorizationTokenResponse;
	readonly account: vscode.AuthenticationSessionAccountInformation;
	readonly created_at: number;
}

export function cacheKey(resource: string, scopes: readonly string[]): string {
	return resource + '|' + [...scopes].sort().join(' ');
}

/**
 * Returns true if the cached token is past (or within 60s of) its expiry. Pure
 * and exported for testing.
 *
 * Mints fresh ID-JAG assertions are usually short-lived (minutes). We treat tokens as expired
 * 60s before their nominal expiry to avoid clock skew and in-flight redemptions racing past
 * `exp`. Tokens without `expires_in` defined are treated as never-expiring (cached
 * until the process exits); `expires_in: 0` is treated as immediately expired.
 */
export function isExpired(entry: { token: { expires_in?: number }; created_at: number }, now: number = Date.now()): boolean {
	if (entry.token.expires_in === undefined) {
		return false;
	}
	return now > entry.created_at + (entry.token.expires_in * 1000) - 60_000;
}

export function XaaifyAuthProvider<TBase extends Ctor<DynamicAuthProvider>>(Base: TBase): TBase {
	return class XaaAuthenticationProvider extends Base {
		private readonly _resourceTokens = new Map<string, IResourceCacheEntry>();
		private readonly _resourceClientSecrets = new Map<string, string>();

		private _resourceClientSecretKey(resource: string, clientId: string): string {
			return `${resource}|${clientId}`;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		constructor(...args: any[]) {
			super(...args);
			const issuer = this.authorizationServer;
			this.id = `xaa:${issuer.toString(true)}`;
			this._logger.trace(`[XAA] Provider constructed for issuer ${issuer.toString(true)}. authorization_endpoint=${this._serverMetadata.authorization_endpoint}, token_endpoint=${this._serverMetadata.token_endpoint}`);
		}

		override async getSessions(scopes: readonly string[] | undefined, options: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession[]> {
			const resource = options.resource;
			const audience = options.audience;
			if (!scopes && !resource && !audience) {
				return super.getSessions(scopes, options);
			}
			if (!resource || !scopes || !audience) {
				return [];
			}
			const key = cacheKey(resource, scopes);
			const entry = this._resourceTokens.get(key);
			if (entry && !isExpired(entry)) {
				return [toSession(entry.token, entry.scopes, entry.account)];
			}
			if (entry) {
				this._resourceTokens.delete(key);
			}

			const idpSession = await this._tryGetSilentIdpSession();
			if (!idpSession?.idToken) {
				return [];
			}
			try {
				const minted = await this._mintResourceToken(idpSession, [...scopes], audience, resource, options, true);
				if (!minted) {
					return [];
				}
				return [toSession(minted.token, minted.scopes, minted.account)];
			} catch (err) {
				this._logger.warn(`[XAA] Silent token mint failed for resource=${resource}; falling back to interactive. Error: ${(err as Error).message}`);
				return [];
			}
		}

		override async createSession(scopes: string[], options: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession> {
			const audience = options.audience;
			const resource = options.resource;
			this._logger.trace(`[XAA] createSession scopes=[${scopes.join(' ')}] audience=${audience} resource=${resource}`);
			if (!audience) {
				throw new Error('Enterprise-managed authentication requires `options.audience` (the resource\'s authorization server URL) but none was provided.');
			}
			if (!resource) {
				throw new Error('Enterprise-managed authentication requires `options.resource` (the resource indicator / MCP server URL) but none was provided.');
			}

			const idpSession = await this._ensureIdpSession();
			if (!idpSession.idToken) {
				throw new Error('IdP session is missing an id_token; the issuer must support OpenID Connect and the `openid` scope.');
			}

			const minted = await this._mintResourceToken(idpSession, scopes, audience, resource, options, false);
			if (!minted) {
				throw new Error('Failed to mint a resource access token for the enterprise-managed MCP server.');
			}
			return toSession(minted.token, minted.scopes, minted.account);
		}

		private async _mintResourceToken(
			idpSession: vscode.AuthenticationSession,
			scopes: string[],
			audience: string,
			resource: string,
			options: vscode.AuthenticationProviderSessionOptions,
			silent: boolean,
		): Promise<IResourceCacheEntry | undefined> {
			const jag = await this._exchangeForIdJag(idpSession.idToken!, audience, resource, scopes);

			const resourceTokenEndpoint = await this._discoverResourceTokenEndpoint(audience);

			let resourceClientId = this._clientId;
			let resourceClientIdFromJag = false;
			const configuredResourceClientId = typeof options.clientId === 'string' && options.clientId.length > 0 ? options.clientId : undefined;
			if (configuredResourceClientId) {
				resourceClientId = configuredResourceClientId;
				resourceClientIdFromJag = resourceClientId !== this._clientId;
			} else {
				try {
					const jagClaims = getClaimsFromJWT(jag);
					if (typeof jagClaims.client_id === 'string' && jagClaims.client_id.length > 0) {
						resourceClientId = jagClaims.client_id;
						resourceClientIdFromJag = resourceClientId !== this._clientId;
					}
				} catch (err) {
					this._logger.warn(`[XAA] Could not decode ID-JAG to read resource client_id; falling back to IdP client_id. Error: ${(err as Error).message}`);
				}
			}

			let resourceClientSecret: string | undefined = this._clientSecret;
			const configuredResourceClientSecret = typeof options.clientSecret === 'string' && options.clientSecret.length > 0 ? options.clientSecret : undefined;
			const secretCacheKey = this._resourceClientSecretKey(resource, resourceClientId);
			if (configuredResourceClientSecret) {
				resourceClientSecret = configuredResourceClientSecret;
				this._resourceClientSecrets.set(secretCacheKey, configuredResourceClientSecret);
			} else if (resourceClientIdFromJag) {
				if (this._resourceClientSecrets.has(secretCacheKey)) {
					resourceClientSecret = this._resourceClientSecrets.get(secretCacheKey);
				} else if (silent) {
					this._logger.info(`[XAA] Silent mint requires resource client_secret for '${resourceClientId}' but none is cached or configured; deferring to interactive flow.`);
					return undefined;
				} else {
					this._logger.info(`[XAA] Resource AS requires a distinct client_id '${resourceClientId}' — prompting for matching client_secret.`);
					const promptedSecret = await this._proxy.$promptForResourceClientSecret(resourceClientId, resource);
					if (promptedSecret === undefined) {
						return undefined;
					}
					this._resourceClientSecrets.set(secretCacheKey, promptedSecret);
					resourceClientSecret = promptedSecret.length > 0 ? promptedSecret : undefined;
				}
			}

			const resourceToken = await this._redeemAtResource(resourceTokenEndpoint, jag, resource, scopes, resourceClientId, resourceClientSecret);

			const entry: IResourceCacheEntry = {
				resource,
				scopes,
				token: resourceToken,
				account: idpSession.account,
				created_at: Date.now(),
			};
			this._resourceTokens.set(cacheKey(resource, scopes), entry);
			return entry;
		}

		private async _tryGetSilentIdpSession(): Promise<vscode.AuthenticationSession | undefined> {
			const cleanOptions: vscode.AuthenticationProviderSessionOptions = {};
			const existing = await super.getSessions(IDP_SCOPES as string[], cleanOptions);
			return existing.length ? existing[0] : undefined;
		}

		private async _ensureIdpSession(): Promise<vscode.AuthenticationSession> {
			this._logger.trace(`[XAA] _ensureIdpSession: scopes=[${IDP_SCOPES.join(' ')}] authorization_endpoint=${this._serverMetadata.authorization_endpoint}`);
			const silent = await this._tryGetSilentIdpSession();
			if (silent?.idToken) {
				this._logger.trace(`[XAA] _ensureIdpSession: reusing existing IdP session`);
				return silent;
			}
			this._logger.trace(`[XAA] _ensureIdpSession: creating new IdP session via super.createSession`);
			return super.createSession([...IDP_SCOPES], {});
		}

		private async _exchangeForIdJag(idToken: string, audience: string, resource: string, scopes: string[]): Promise<string> {
			const tokenEndpoint = this._serverMetadata.token_endpoint;
			if (!tokenEndpoint) {
				throw new Error('Issuer metadata is missing token_endpoint; cannot perform XAA token exchange.');
			}
			const body = buildIdJagExchangeBody(this._clientId, this._clientSecret, idToken, audience, resource, scopes);
			this._logger.trace(`[XAA] POST ${tokenEndpoint} (ID-JAG exchange) audience=${audience} resource=${resource} scope=${scopes.join(' ')}`);
			const response = await fetch(tokenEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Accept': 'application/json',
				},
				body: body.toString(),
			});
			if (!response.ok) {
				throw new Error(`XAA token exchange (IdP) failed: ${response.status} ${await safeText(response)}`);
			}
			const data: unknown = await response.json();
			const issued = (data && typeof data === 'object' && typeof (data as { access_token?: unknown }).access_token === 'string')
				? (data as { access_token: string }).access_token
				: undefined;
			if (!issued) {
				throw new Error(`XAA token exchange (IdP) returned no access_token. Response: ${JSON.stringify(data)}`);
			}
			return issued;
		}

		private async _discoverResourceTokenEndpoint(audience: string): Promise<string> {
			const { metadata, errors } = await fetchAuthorizationServerMetadata(audience);
			if (!metadata?.token_endpoint) {
				throw new Error(`Failed to discover resource authorization server metadata for '${audience}': ${errors.map(e => e.message).join('; ') || 'no token_endpoint in metadata'}`);
			}
			return metadata.token_endpoint;
		}

		private async _redeemAtResource(tokenEndpoint: string, idJag: string, resource: string, scopes: string[], resourceClientId: string, resourceClientSecret: string | undefined): Promise<IAuthorizationTokenResponse> {
			const body = buildResourceRedemptionBody(resourceClientId, resourceClientSecret, idJag, resource, scopes);
			this._logger.trace(`[XAA] POST ${tokenEndpoint} (ID-JAG redemption) client_id=${resourceClientId} resource=${resource} scope=${scopes.join(' ')}`);
			const response = await fetch(tokenEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Accept': 'application/json',
				},
				body: body.toString(),
			});
			if (!response.ok) {
				throw new Error(`XAA token exchange (resource) failed: ${response.status} ${await safeText(response)}`);
			}
			const data = await response.json();
			if (!isAuthorizationTokenResponse(data)) {
				throw new Error(`XAA token exchange (resource) returned an invalid token response: ${JSON.stringify(data)}`);
			}
			return data;
		}
	};
}

export function toSession(token: IAuthorizationTokenResponse, scopes: readonly string[], fallbackAccount?: vscode.AuthenticationSessionAccountInformation): vscode.AuthenticationSession {
	let account: vscode.AuthenticationSessionAccountInformation | undefined;
	if (token.id_token) {
		try {
			const claims: IAuthorizationJWTClaims = getClaimsFromJWT(token.id_token);
			account = {
				id: claims.sub || 'unknown',
				label: claims.preferred_username || claims.name || claims.email || 'XAA',
			};
		} catch {
		}
	}
	account ??= fallbackAccount ?? { id: 'unknown', label: 'XAA' };
	return {
		id: stringHash(token.access_token, 0).toString(),
		accessToken: token.access_token,
		account,
		scopes: [...scopes],
		idToken: token.id_token,
	};
}

async function safeText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return response.statusText;
	}
}
