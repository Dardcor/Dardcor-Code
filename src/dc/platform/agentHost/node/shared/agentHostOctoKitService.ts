/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LRUCache } from '../../../../base/common/map.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { getSessionPullRequestUrlKey } from '../../common/state/sessionState.js';
import { IAgentHostGitHubEndpointService } from '../agentHostGitHubEndpointService.js';

export type FetchFunction = typeof globalThis.fetch;

export interface CreatedPullRequest {
	readonly url: string;
	readonly number: number;
	readonly nodeId?: string;
	readonly createdAt?: number;
	readonly state?: 'open' | 'closed';
}

export type AutoMergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

interface GitHubPullRequestResponseItem {
	readonly number?: unknown;
	readonly html_url?: unknown;
	readonly node_id?: unknown;
	readonly created_at?: unknown;
	readonly state?: unknown;
	readonly head?: { readonly sha?: unknown };
}

function toCreatedPullRequest(item: GitHubPullRequestResponseItem | undefined): CreatedPullRequest | undefined {
	const html_url = item?.html_url;
	const number = item?.number;
	const node_id = item?.node_id;
	const created_at = item?.created_at;
	const state = item?.state;
	const createdAt = typeof created_at === 'string' ? Date.parse(created_at) : undefined;
	return typeof html_url === 'string' && typeof number === 'number'
		? {
			number,
			url: html_url,
			nodeId: typeof node_id === 'string' ? node_id : undefined,
			...(createdAt !== undefined && Number.isFinite(createdAt) ? { createdAt } : {}),
			...(state === 'open' || state === 'closed' ? { state } : {}),
		}
		: undefined;
}

function selectAllowedPullRequest(items: readonly GitHubPullRequestResponseItem[], allowedPullRequestUrls: readonly string[]): GitHubPullRequestResponseItem | undefined {
	const itemsByUrl = new Map<string, GitHubPullRequestResponseItem>();
	for (const item of items) {
		if (typeof item.html_url === 'string') {
			itemsByUrl.set(getSessionPullRequestUrlKey(item.html_url), item);
		}
	}

	const allowed = allowedPullRequestUrls
		.map(url => itemsByUrl.get(getSessionPullRequestUrlKey(url)))
		.filter(item => item !== undefined);
	return allowed.find(item => item.state === 'open') ?? allowed[0];
}

interface GitHubIssueOrPullRequestResponseItem {
	readonly title?: unknown;
	readonly body?: unknown;
}

export interface GitHubIssueOrPullRequest {
	readonly title: string;
	readonly body: string;
}

export interface IGitHubApiResponse<T> {
	readonly data: T | undefined;
	readonly statusCode: number;
	readonly etag?: string;
}

export interface IAgentHostOctoKitService {
	readonly _serviceBrand: undefined;

	createPullRequest(
		owner: string,
		repo: string,
		title: string,
		body: string,
		head: string,
		base: string,
		draft: boolean,
		token: string,
		signal: AbortSignal,
	): Promise<CreatedPullRequest>;

	findPullRequestByHeadBranch(owner: string, repo: string, branch: string, token: string, signal: AbortSignal, headOwner?: string, allowedPullRequestUrls?: readonly string[]): Promise<CreatedPullRequest | undefined>;

	findPullRequestByHeadSha(owner: string, repo: string, sha: string, token: string, signal: AbortSignal, allowedPullRequestUrls?: readonly string[]): Promise<CreatedPullRequest | undefined>;

	getIssueOrPullRequest(owner: string, repo: string, number: number, token: string, signal: AbortSignal): Promise<GitHubIssueOrPullRequest>;

	/**
	 * Enables auto-merge on a pull request so GitHub merges it automatically
	 * once all required reviews and status checks pass.
	 *
	 * Issues the GraphQL `enablePullRequestAutoMerge` mutation. `pullRequestId`
	 * is the pull request's GraphQL global node id (see
	 * {@link CreatedPullRequest.nodeId}). Throws on GraphQL or transport errors,
	 * including when the repository does not allow the requested merge method or
	 * auto-merge is not enabled for the repository.
	 */
	enablePullRequestAutoMerge(pullRequestId: string, mergeMethod: AutoMergeMethod, token: string, signal: AbortSignal): Promise<void>;
}

export const IAgentHostOctoKitService = createDecorator<IAgentHostOctoKitService>('agentHostOctoKitService');

const GITHUB_API_VERSION = '2022-11-28';
const MAX_ERROR_RESPONSE_BODY_LENGTH = 500;

const MAX_COMMIT_PULL_REQUESTS = 100;

const COMMIT_PULL_REQUESTS_ROUTE = /^repos\/[^/]+\/[^/]+\/commits\/[^/]+\/pulls\?per_page=\d+$/;

const ENABLE_AUTO_MERGE_MUTATION = `mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
	enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
		pullRequest { id }
	}
}`;

function isMissingCommitPullRequestsResponse(routeSlug: string, method: 'GET' | 'POST', statusCode: number, responseText: string | undefined): boolean {
	if (method !== 'GET' || statusCode !== 422 || !COMMIT_PULL_REQUESTS_ROUTE.test(routeSlug) || responseText === undefined) {
		return false;
	}

	try {
		const body: { readonly message?: unknown } | null = JSON.parse(responseText);
		const message = body?.message;
		return typeof message === 'string' && message.startsWith('No commit found for SHA: ');
	} catch {
		return false;
	}
}

export class AgentHostOctoKitService implements IAgentHostOctoKitService {

	declare readonly _serviceBrand: undefined;

	private readonly _fetch: FetchFunction;

	private readonly pullRequestSearchCache = new LRUCache<string, { readonly etag: string; readonly items: readonly GitHubPullRequestResponseItem[] }>(100);

	constructor(
		fetchFn: FetchFunction | undefined,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostGitHubEndpointService private readonly _endpoint: IAgentHostGitHubEndpointService,
	) {
		this._fetch = fetchFn ?? globalThis.fetch;
	}

	async createPullRequest(
		owner: string,
		repo: string,
		title: string,
		body: string,
		head: string,
		base: string,
		draft: boolean,
		token: string,
		signal: AbortSignal,
	): Promise<CreatedPullRequest> {
		const response = await this._makeGHAPIRequest<GitHubPullRequestResponseItem>(
			`repos/${owner}/${repo}/pulls`,
			'POST',
			token,
			signal,
			{ title, body, head, base, draft },
		);

		const number = response.data?.number;
		const html_url = response.data?.html_url;
		if (typeof html_url !== 'string' || typeof number !== 'number') {
			throw new Error(`Failed to create pull request for ${owner}/${repo}`);
		}

		const node_id = response.data?.node_id;
		return { url: html_url, number, nodeId: typeof node_id === 'string' ? node_id : undefined };
	}

	async findPullRequestByHeadBranch(owner: string, repo: string, branch: string, token: string, signal: AbortSignal, headOwner = owner, allowedPullRequestUrls?: readonly string[]): Promise<CreatedPullRequest | undefined> {
		if (allowedPullRequestUrls?.length === 0) {
			return undefined;
		}
		const perPage = allowedPullRequestUrls ? 100 : 1;
		const routeSlug = `repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${headOwner}:${branch}`)}&state=all&sort=updated&direction=desc&per_page=${perPage}`;
		const items = await this._searchPullRequests(routeSlug, token, signal);
		return toCreatedPullRequest(allowedPullRequestUrls ? selectAllowedPullRequest(items, allowedPullRequestUrls) : items[0]);
	}

	async findPullRequestByHeadSha(owner: string, repo: string, sha: string, token: string, signal: AbortSignal, allowedPullRequestUrls?: readonly string[]): Promise<CreatedPullRequest | undefined> {
		if (allowedPullRequestUrls?.length === 0) {
			return undefined;
		}
		const routeSlug = `repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/pulls?per_page=${MAX_COMMIT_PULL_REQUESTS}`;
		const items = await this._searchPullRequests(routeSlug, token, signal);

		if (items.length >= MAX_COMMIT_PULL_REQUESTS) {
			this._logService.warn(`[AgentHostOctoKitService] Not resolving a pull request for ${sha}: more than ${MAX_COMMIT_PULL_REQUESTS} are associated with it`);
			return undefined;
		}

		const atHead = items.filter(item => item?.head?.sha === sha);
		if (allowedPullRequestUrls) {
			return toCreatedPullRequest(selectAllowedPullRequest(atHead, allowedPullRequestUrls));
		}
		const open = atHead.filter(item => item.state === 'open');
		const candidates = open.length > 0 ? open : atHead;

		return candidates.length === 1 ? toCreatedPullRequest(candidates[0]) : undefined;
	}

	private async _searchPullRequests(routeSlug: string, token: string, signal: AbortSignal): Promise<readonly GitHubPullRequestResponseItem[]> {
		const cacheKey = `${this._endpoint.getApiBaseUri()}/${routeSlug}`;
		const cached = this.pullRequestSearchCache.get(cacheKey);
		const response = await this._makeGHAPIRequest<GitHubPullRequestResponseItem[]>(routeSlug, 'GET', token, signal, undefined, cached?.etag);

		if (response.statusCode === 304) {
			return cached?.items ?? [];
		}

		const items = Array.isArray(response.data) ? response.data : [];
		if (response.etag) {
			this.pullRequestSearchCache.set(cacheKey, { etag: response.etag, items });
		}
		return items;
	}

	async getIssueOrPullRequest(owner: string, repo: string, number: number, token: string, signal: AbortSignal): Promise<GitHubIssueOrPullRequest> {
		const response = await this._makeGHAPIRequest<GitHubIssueOrPullRequestResponseItem>(
			`repos/${owner}/${repo}/issues/${number}`,
			'GET',
			token,
			signal,
		);
		const title = response.data?.title;
		const body = response.data?.body;
		if (typeof title !== 'string' || (typeof body !== 'string' && body !== null)) {
			throw new Error(`Failed to fetch issue or pull request ${owner}/${repo}#${number}`);
		}
		return { title, body: body ?? '' };
	}

	async enablePullRequestAutoMerge(pullRequestId: string, mergeMethod: AutoMergeMethod, token: string, signal: AbortSignal): Promise<void> {
		await this._makeGraphQLRequest(ENABLE_AUTO_MERGE_MUTATION, { pullRequestId, mergeMethod }, token, signal);
	}

	private async _makeGHAPIRequest<T>(
		routeSlug: string,
		method: 'GET' | 'POST',
		token: string,
		signal: AbortSignal,
		body?: Record<string, unknown>,
		etag?: string
	): Promise<IGitHubApiResponse<T>> {
		const url = `${this._endpoint.getApiBaseUri()}/${routeSlug}`;
		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github+json',
			'Authorization': `Bearer ${token}`,
			'X-GitHub-Api-Version': GITHUB_API_VERSION,
		};
		if (etag) {
			headers['If-None-Match'] = etag;
		}
		if (body) {
			headers['Content-Type'] = 'application/json';
		}

		let response: Response;
		try {
			response = await this._fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
				signal,
			});
		} catch (err) {
			if (signal.aborted) {
				throw err;
			}
			this._logService.error(`[AgentHostOctoKit] ${method} ${url} - Network error`, err);
			throw err;
		}

		const rateLimitHeader = response.headers.get('x-ratelimit-remaining');
		if (rateLimitHeader) {
			const rateLimitRemaining = parseRateLimitHeader(rateLimitHeader);
			if (rateLimitRemaining !== undefined && rateLimitRemaining < 100) {
				this._logService.warn(`[AgentHostOctoKitService] ${method} ${url} - GitHub API rate limit low: ${rateLimitRemaining} remaining`);
			}
		}

		const statusCode = response.status ?? 0;
		const responseETag = response.headers.get('etag') ?? undefined;

		if (
			statusCode === 204 ||
			statusCode === 304
		) {
			return { data: undefined, statusCode, etag: responseETag };
		}

		if (!response.ok) {
			const errorText = await response.text().catch(() => undefined);
			if (isMissingCommitPullRequestsResponse(routeSlug, method, statusCode, errorText)) {
				return { data: undefined, statusCode, etag: undefined };
			}
			const errorDetail = this._formatErrorResponseBody(errorText);
			this._logService.error(`[AgentHostOctoKit] ${method} ${url} - Status: ${response.status}${errorDetail ? ` - ${errorDetail}` : ''}`);
			throw new Error(`GitHub API request failed: ${method} ${routeSlug} - ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`);
		}

		try {
			const data = await response.json();
			return { data, statusCode, etag: responseETag };
		} catch (err) {
			this._logService.error(`[AgentHostOctoKit] ${method} ${url} - Failed to parse JSON`, err);
			throw err;
		}
	}

	private async _makeGraphQLRequest(
		query: string,
		variables: Record<string, unknown>,
		token: string,
		signal: AbortSignal,
	): Promise<unknown> {
		const url = this._endpoint.getGraphQlUri();
		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
			'X-GitHub-Api-Version': GITHUB_API_VERSION,
		};

		let response: Response;
		try {
			response = await this._fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify({ query, variables }),
				signal,
			});
		} catch (err) {
			if (signal.aborted) {
				throw err;
			}
			this._logService.error(`[AgentHostOctoKit] POST ${url} - Network error`, err);
			throw err;
		}

		if (!response.ok) {
			const errorText = await response.text().catch(() => undefined);
			const errorDetail = this._formatErrorResponseBody(errorText);
			this._logService.error(`[AgentHostOctoKit] POST ${url} - Status: ${response.status}${errorDetail ? ` - ${errorDetail}` : ''}`);
			throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`);
		}

		let json: { data?: unknown; errors?: ReadonlyArray<{ message?: unknown }> };
		try {
			json = await response.json();
		} catch (err) {
			this._logService.error(`[AgentHostOctoKit] POST ${url} - Failed to parse JSON`, err);
			throw err;
		}

		if (Array.isArray(json.errors) && json.errors.length > 0) {
			const message = json.errors.map(error => {
				return typeof error?.message === 'string'
					? error.message
					: JSON.stringify(error);
			}).join('; ');
			this._logService.error(`[AgentHostOctoKit] POST ${url} - GraphQL error: ${message}`);
			throw new Error(`GitHub GraphQL request failed: ${message}`);
		}

		return json.data;
	}

	private _formatErrorResponseBody(errorText: string | undefined): string | undefined {
		const normalized = errorText?.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return undefined;
		}
		return normalized.length > MAX_ERROR_RESPONSE_BODY_LENGTH
			? `${normalized.substring(0, MAX_ERROR_RESPONSE_BODY_LENGTH)}...`
			: normalized;
	}
}

function parseRateLimitHeader(value: string | string[] | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const str = Array.isArray(value) ? value[0] : value;
	const parsed = parseInt(str, 10);
	return isNaN(parsed) ? undefined : parsed;
}
