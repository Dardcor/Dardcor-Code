/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Endpoints } from '@octokit/types';
import { CCAModel, RemoteAgentJobPayload } from '@vscode/copilot-api';
import { createServiceIdentifier } from '../../../util/common/services';
import { decodeBase64 } from '../../../util/dardcor/base/common/buffer';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { ILogService } from '../../log/common/logService';
import { IFetcherService } from '../../networking/common/fetcherService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { addPullRequestCommentGraphQLRequest, AssignableActor, closePullRequest, getPullRequestFromGlobalId, makeGitHubAPIRequest, makeSearchGraphQLRequest, PullRequestComment, PullRequestSearchItem, SessionInfo } from './githubAPI';

export interface AuthOptions {
	readonly createIfNone?: { readonly detail: string };
}

export type IGetRepositoryInfoResponseData = Endpoints['GET /repos/{owner}/{repo}']['response']['data'];

export const IGithubRepositoryService = createServiceIdentifier<IGithubRepositoryService>('IGithubRepositoryService');
export const IOctoKitService = createServiceIdentifier<IOctoKitService>('IOctoKitService');

export const VSCodeTeamId = 1682102;

export type GithubRepositoryItem = {
	name: string;
	path: string;
	html_url: string;
	type: 'file' | 'dir';
};

export interface JobInfo {
	job_id: string;
	session_id: string;
	problem_statement: string;
	content_filter_mode?: string;
	status: string;
	result?: string;
	actor: {
		id: number;
		login: string;
	};
	created_at: string;
	updated_at: string;
	pull_request: {
		id: number;
		number: number;
	};
	workflow_run?: {
		id: number;
	};
	error?: {
		message: string;
	};
	event_type?: string;
	event_url?: string;
	event_identifiers?: string[];
}

export interface IGithubRepositoryService {

	_serviceBrand: undefined;

	isAvailable(org: string, repo: string): Promise<boolean>;
	getRepositoryInfo(owner: string, repo: string): Promise<IGetRepositoryInfoResponseData>;
	getRepositoryItems(org: string, repo: string, path: string): Promise<GithubRepositoryItem[]>;
	getRepositoryItemContent(org: string, repo: string, path: string): Promise<Uint8Array | undefined>;
}

export interface IOctoKitUser {
	id: number;
	login: string;
	name: string | null;
	avatar_url: string;
}

export interface CCAEnabledResult {
	enabled: boolean | undefined;
	statusCode?: number;
}

export interface IOctoKitSessionInfo {
	name: string;
	owner_id: number;
	premium_requests: number;
	repo_id: number;
	resource_global_id: string;
	resource_id: number;
	resource_state: string;
	resource_type: string;
	state: string;
	user_id: number;
	workflow_run_id: number;
	last_updated_at: string;
	created_at: string;
}

export interface RemoteAgentJobResponse {
	job_id: string;
	session_id: string;
	actor: {
		id: number;
		login: string;
	};
	created_at: string;
	updated_at: string;
}

export interface ErrorResponseWithStatusCode {
	status: number;
}

export interface CustomAgentListItem {
	name: string;
	repo_owner_id: number;
	repo_owner: string;
	repo_id: number;
	repo_name: string;
	display_name: string;
	description: string;
	tools: string[];
	version: string;
	argument_hint?: string;
	metadata?: Record<string, string>;
	target?: string;
	config_error?: string;
	model?: string;
	disable_model_invocation?: boolean;
	user_invocable?: boolean;
	'mcp-servers'?: {
		[serverName: string]: {
			type: string;
			command?: string;
			args?: string[];
			tools?: string[];
			env?: { [key: string]: string };
			headers?: { [key: string]: string };
		};
	};
}

export interface CustomAgentListOptions {
	target?: 'github-dardcor' | 'vscode';
	excludeInvalidConfig?: boolean;
	dedupe?: boolean;
	includeSources?: ('repo' | 'org' | 'enterprise')[];
}

export interface CustomAgentListOptions {
	target?: 'github-dardcor' | 'vscode';
	excludeInvalidConfig?: boolean;
	dedupe?: boolean;
	includeSources?: ('repo' | 'org' | 'enterprise')[];
}

export interface CustomAgentDetails extends CustomAgentListItem {
	prompt: string;
}

export interface PullRequestFile {
	filename: string;
	status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	previous_filename?: string;
	sha?: string;
}

export interface RepositoryComparison {
	readonly baseSha: string;
	readonly headSha: string;
	readonly files: readonly PullRequestFile[];
}

export interface CreatedPullRequest {
	number: number;
	url: string;
}

interface GitHubContentResponse {
	content?: string;
	encoding?: string;
	sha?: string;
}

interface GitHubBlobResponse {
	content: string;
	encoding: string;
}

export const enum GitHubOutageStatus {
	None,
	Minor,
	Major,
	Critical
}

export class PermissiveAuthRequiredError extends Error {
	constructor() {
		super('Permissive authentication is required');
		this.name = 'PermissiveAuthRequiredError';
	}
}

export interface IOctoKitService {

	_serviceBrand: undefined;

	getCurrentAuthedUser(): Promise<IOctoKitUser | undefined>;

	getOpenPullRequestsForUser(owner: string, repo: string, authOptions: AuthOptions): Promise<PullRequestSearchItem[]>;

	getCopilotSessionsForPR(prId: string, authOptions: AuthOptions): Promise<SessionInfo[]>;

	getSessionLogs(sessionId: string, authOptions: AuthOptions): Promise<string>;

	getSessionInfo(sessionId: string, authOptions: AuthOptions): Promise<SessionInfo | undefined>;

	postCopilotAgentJob(
		owner: string,
		name: string,
		apiVersion: string,
		payload: RemoteAgentJobPayload,
		authOptions: AuthOptions,
	): Promise<RemoteAgentJobResponse | ErrorResponseWithStatusCode | undefined>;

	getJobByJobId(owner: string, repo: string, jobId: string, userAgent: string, authOptions: AuthOptions): Promise<JobInfo | undefined>;

	getJobBySessionId(owner: string, repo: string, sessionId: string, userAgent: string, authOptions: AuthOptions): Promise<JobInfo | undefined>;

	addPullRequestComment(pullRequestId: string, commentBody: string, authOptions: AuthOptions): Promise<PullRequestComment | null>;

	createPullRequest(owner: string, repo: string, title: string, body: string, head: string, base: string, draft: boolean, authOptions: AuthOptions): Promise<CreatedPullRequest>;

	getAllSessions(nwo: string | undefined, open: boolean, authOptions: AuthOptions): Promise<SessionInfo[]>;





	getPullRequestFromGlobalId(globalId: string, authOptions: AuthOptions): Promise<PullRequestSearchItem | null>;

	getCustomAgents(owner: string, repo: string, options: CustomAgentListOptions, authOptions: AuthOptions): Promise<CustomAgentListItem[]>;

	getCustomAgentDetails(owner: string, repo: string, agentName: string, version: string, authOptions: AuthOptions): Promise<CustomAgentDetails | undefined>;

	getPullRequestFiles(owner: string, repo: string, pullNumber: number, authOptions: AuthOptions): Promise<PullRequestFile[]>;

	compareCommits(owner: string, repo: string, base: string, head: string, authOptions: AuthOptions): Promise<RepositoryComparison | undefined>;

	getRepositoryById(id: number, authOptions: AuthOptions): Promise<{ owner: string; name: string } | undefined>;

	closePullRequest(owner: string, repo: string, pullNumber: number, authOptions: AuthOptions): Promise<boolean>;

	findPullRequestByHeadBranch(owner: string, repo: string, headBranch: string, authOptions: AuthOptions): Promise<PullRequestSearchItem | undefined>;

	getFileContent(owner: string, repo: string, ref: string, path: string, authOptions: AuthOptions): Promise<string>;

	getUserOrganizations(authOptions: AuthOptions, pageSize?: number): Promise<string[]>;

	isUserMemberOfOrg(org: string, authOptions: AuthOptions): Promise<boolean>;

	getOrganizationRepositories(org: string, authOptions: AuthOptions, pageSize?: number): Promise<string[]>;

	getOrgCustomInstructions(orgLogin: string, authOptions: AuthOptions): Promise<string | undefined>;

	getUserRepositories(authOptions: AuthOptions, query?: string): Promise<{ owner: string; name: string }[]>;

	getRecentlyCommittedRepositories(authOptions: AuthOptions): Promise<{ owner: string; name: string }[]>;

	getCopilotAgentModels(authOptions: AuthOptions): Promise<CCAModel[]>;

	getAssignableActors(owner: string, repo: string, authOptions: AuthOptions): Promise<AssignableActor[]>;

	isCCAEnabled(owner: string, repo: string, authOptions: AuthOptions): Promise<CCAEnabledResult>;

	getGitHubOutageStatus(): Promise<GitHubOutageStatus>;
}

export class BaseOctoKitService {

	private static readonly _outageStatusCacheTTL = 5 * 60 * 1000;
	private _cachedOutageStatus: { value: GitHubOutageStatus; timestamp: number } | undefined;

	private static readonly _userReposScopeCacheTTL = 5 * 60 * 1000;
	private _cachedUserReposScope: { token: string; qualifiers: string; timestamp: number } | undefined;

	constructor(
		protected readonly _capiClientService: ICAPIClientService,
		protected readonly _fetcherService: IFetcherService,
		protected readonly _logService: ILogService,
		protected readonly _telemetryService: ITelemetryService
	) { }

	async getCurrentAuthedUserWithToken(token: string): Promise<IOctoKitUser | undefined> {
		return this._makeGHAPIRequest('user', 'GET', token, undefined, undefined, 'github-rest-get-user');
	}

	async getGitHubOutageStatus(): Promise<GitHubOutageStatus> {
		const now = Date.now();
		if (this._cachedOutageStatus && (now - this._cachedOutageStatus.timestamp) < BaseOctoKitService._outageStatusCacheTTL) {
			return this._cachedOutageStatus.value;
		}
		try {
			const response = await this._fetcherService.fetch('https://www.githubstatus.com/api/v2/status.json', { method: 'GET', callSite: 'github-status' });
			const data = await response.json();
			const status = data?.status?.indicator;
			let result: GitHubOutageStatus;
			switch (status) {
				case 'none':
					result = GitHubOutageStatus.None;
					break;
				case 'minor':
					result = GitHubOutageStatus.Minor;
					break;
				case 'major':
					result = GitHubOutageStatus.Major;
					break;
				case 'critical':
					result = GitHubOutageStatus.Critical;
					break;
				default:
					result = GitHubOutageStatus.None;
					break;
			}
			this._cachedOutageStatus = { value: result, timestamp: now };
			return result;
		} catch {
			this._cachedOutageStatus = { value: GitHubOutageStatus.None, timestamp: now };
			return GitHubOutageStatus.None;
		}
	}

	protected async _makeGHAPIRequest(routeSlug: string, method: 'GET' | 'POST', token: string, body?: { [key: string]: any }, options?: { silent404?: boolean }, callSite: string = 'github-api-rest') {
		return makeGitHubAPIRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, routeSlug, method, token, { body, version: '2022-11-28', silent404: options?.silent404, callSite });
	}

	protected async getOpenPullRequestForUserWithToken(owner: string, repo: string, user: string, token: string) {
		const query = `repo:${owner}/${repo} is:open involves:${user}`;
		return makeSearchGraphQLRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, token, query);
	}

	protected async findPullRequestByHeadBranchWithToken(owner: string, repo: string, headBranch: string, token: string): Promise<PullRequestSearchItem | undefined> {
		const query = `repo:${owner}/${repo} head:${headBranch} is:pr`;
		const results = await makeSearchGraphQLRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, token, query, 5);
		return results.find(pr => pr.headRefName === headBranch);
	}

	protected async addPullRequestCommentWithToken(pullRequestId: string, commentBody: string, token: string): Promise<PullRequestComment | null> {
		return addPullRequestCommentGraphQLRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, token, pullRequestId, commentBody);
	}

	protected async createPullRequestWithToken(owner: string, repo: string, title: string, body: string, head: string, base: string, draft: boolean, token: string): Promise<CreatedPullRequest> {
		const response = await this._makeGHAPIRequest(`repos/${owner}/${repo}/pulls`, 'POST', token, {
			title,
			body,
			head,
			base,
			draft,
		});

		if (!response?.html_url || typeof response.number !== 'number') {
			throw new Error(`Failed to create pull request for ${owner}/${repo}`);
		}

		return {
			url: response.html_url,
			number: response.number,
		};
	}

	protected async getPullRequestFromSessionWithToken(globalId: string, token: string): Promise<PullRequestSearchItem | null> {
		return getPullRequestFromGlobalId(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, token, globalId);
	}

	protected async getPullRequestFilesWithToken(owner: string, repo: string, pullNumber: number, token: string): Promise<PullRequestFile[]> {
		const result = await makeGitHubAPIRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, `repos/${owner}/${repo}/pulls/${pullNumber}/files`, 'GET', token, { version: '2022-11-28', callSite: 'github-rest-get-pr-files' });
		return result || [];
	}

	protected async compareCommitsWithToken(owner: string, repo: string, base: string, head: string, token: string): Promise<RepositoryComparison | undefined> {
		const route = `repos/${owner}/${repo}/compare/${base}...${head}`;
		const response = await makeGitHubAPIRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, route, 'GET', token, { version: '2022-11-28', callSite: 'github-rest-compare-commits' });
		if (!response) {
			return undefined;
		}
		const typed = response as { base_commit?: { sha?: string }; merge_base_commit?: { sha?: string }; commits?: ReadonlyArray<{ sha?: string }>; files?: PullRequestFile[] };
		const baseSha = typed.merge_base_commit?.sha ?? typed.base_commit?.sha ?? base;
		const headSha = typed.commits?.[typed.commits.length - 1]?.sha ?? head;
		return { baseSha, headSha, files: typed.files ?? [] };
	}

	protected async getRepositoryByIdWithToken(id: number, token: string): Promise<{ owner: string; name: string } | undefined> {
		const response = await makeGitHubAPIRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, `repositories/${id}`, 'GET', token, { version: '2022-11-28', callSite: 'github-rest-get-repository-by-id' });
		if (!response) {
			return undefined;
		}
		const typed = response as { name?: string; owner?: { login?: string }; full_name?: string };
		if (typed.owner?.login && typed.name) {
			return { owner: typed.owner.login, name: typed.name };
		}
		if (typed.full_name) {
			const [owner, name] = typed.full_name.split('/');
			if (owner && name) {
				return { owner, name };
			}
		}
		return undefined;
	}

	protected async closePullRequestWithToken(owner: string, repo: string, pullNumber: number, token: string): Promise<boolean> {
		return closePullRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, token, owner, repo, pullNumber);
	}

	protected async getFileContentWithToken(owner: string, repo: string, ref: string, path: string, token: string): Promise<string> {
		const route = `repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
		const response = await makeGitHubAPIRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, route, 'GET', token, { callSite: 'github-rest-get-file-content' });

		if (!response || Array.isArray(response)) {
			throw new Error('Unable to fetch file content');
		}

		const typedResponse = response as GitHubContentResponse;

		if (typedResponse.content && typedResponse.encoding === 'base64') {
			return decodeBase64(typedResponse.content.replace(/\n/g, '')).toString();
		}

		if (typedResponse.sha) {
			const blob = await this.getBlobContentWithToken(owner, repo, typedResponse.sha, token);
			if (blob) {
				return blob;
			}
		}

		this._logService.error(`Failed to get file content for ${owner}/${repo}/${path} at ref ${ref}`);
		return '';
	}

	protected async getUserOrganizationsWithToken(token: string, pageSize: number = 100): Promise<string[]> {
		const result = await this._makeGHAPIRequest(`user/orgs?per_page=${pageSize}`, 'GET', token, undefined, undefined, 'github-rest-get-user-orgs');
		if (!result || !Array.isArray(result)) {
			return [];
		}
		return result.map((org: { login: string }) => org.login);
	}

	protected async isUserMemberOfOrgWithToken(org: string, token: string): Promise<boolean> {
		try {
			const result = await this._makeGHAPIRequest(`user/memberships/orgs/${encodeURIComponent(org)}`, 'GET', token, undefined, undefined, 'github-rest-check-org-membership');
			return result && (result.state === 'active' || result.state === 'pending');
		} catch {
			return false;
		}
	}

	protected async getOrganizationRepositoriesWithToken(org: string, token: string, pageSize: number = 100): Promise<string[]> {
		const result = await this._makeGHAPIRequest(`orgs/${org}/repos?per_page=${pageSize}&sort=updated`, 'GET', token, undefined, { silent404: true }, 'github-rest-get-org-repos');
		if (!result || !Array.isArray(result) || result.length === 0) {
			return [];
		}
		return result.map((repo: { name: string }) => repo.name);
	}

	protected async getUserRepositoriesWithToken(token: string, query?: string): Promise<{ owner: string; name: string }[]> {
		const trimmedQuery = query?.trim();

		if (trimmedQuery) {
			return this.searchUserRepositoriesWithToken(token, trimmedQuery);
		}

		const result = await this._makeGHAPIRequest(
			'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
			'GET',
			token,
			undefined,
			undefined,
			'github-rest-get-user-repos'
		);

		if (!result || !Array.isArray(result)) {
			return [];
		}

		return result
			.filter((repo: { permissions?: { push?: boolean } }) => repo.permissions?.push)
			.map((repo: { name: string; owner: { login: string } }) => ({
				owner: repo.owner.login,
				name: repo.name
			}));
	}

	private async searchUserRepositoriesWithToken(token: string, query: string): Promise<{ owner: string; name: string }[]> {
		const scope = await this._getUserReposSearchScope(token);
		if (!scope) {
			return [];
		}

		const searchQuery = encodeURIComponent(`${query} in:name fork:true ${scope}`);
		const result = await this._makeGHAPIRequest(
			`search/repositories?q=${searchQuery}&sort=updated&per_page=100`,
			'GET',
			token,
			undefined,
			undefined,
			'github-rest-search-repos'
		);

		if (!result || !Array.isArray(result.items)) {
			return [];
		}

		return result.items
			.filter((repo: { permissions?: { push?: boolean } }) => repo.permissions?.push)
			.map((repo: { name: string; owner: { login: string } }) => ({
				owner: repo.owner.login,
				name: repo.name
			}));
	}

	private async _getUserReposSearchScope(token: string): Promise<string | undefined> {
		const now = Date.now();
		if (this._cachedUserReposScope
			&& this._cachedUserReposScope.token === token
			&& (now - this._cachedUserReposScope.timestamp) < BaseOctoKitService._userReposScopeCacheTTL) {
			return this._cachedUserReposScope.qualifiers;
		}

		const [user, orgs] = await Promise.all([
			this._makeGHAPIRequest('user', 'GET', token, undefined, undefined, 'github-rest-get-user'),
			this.getUserOrganizationsWithToken(token)
		]);

		const qualifiers: string[] = [];
		if (user?.login) {
			qualifiers.push(`user:${user.login}`);
		}
		for (const org of orgs) {
			qualifiers.push(`org:${org}`);
		}
		if (qualifiers.length === 0) {
			return undefined;
		}

		const joined = qualifiers.join(' ');
		this._cachedUserReposScope = { token, qualifiers: joined, timestamp: now };
		return joined;
	}

	protected async getRecentlyCommittedReposWithToken(token: string): Promise<{ owner: string; name: string }[]> {
		const user = await this._makeGHAPIRequest('user', 'GET', token, undefined, undefined, 'github-rest-get-user');
		if (!user || !user.login) {
			return [];
		}

		const events = await this._makeGHAPIRequest(
			`users/${user.login}/events?per_page=100`,
			'GET',
			token,
			undefined,
			undefined,
			'github-rest-get-user-events'
		);

		if (!events || !Array.isArray(events)) {
			return [];
		}

		const repoSet = new Map<string, { owner: string; name: string }>();
		for (const event of events) {
			if (event.type === 'PushEvent' && event.repo?.name) {
				const [owner, name] = event.repo.name.split('/');
				if (owner && name && !repoSet.has(event.repo.name)) {
					repoSet.set(event.repo.name, { owner, name });
				}
			}
		}
		const items = Array.from(repoSet.values());
		return items || [];
	}

	private async getBlobContentWithToken(owner: string, repo: string, sha: string, token: string): Promise<string | undefined> {
		const blobRoute = `repos/${owner}/${repo}/git/blobs/${sha}`;
		const blobResponse = await makeGitHubAPIRequest(this._fetcherService, this._logService, this._telemetryService, this._capiClientService.dotcomAPIURL, blobRoute, 'GET', token, { version: '2022-11-28', callSite: 'github-rest-get-blob' });

		if (!blobResponse || Array.isArray(blobResponse)) {
			return undefined;
		}

		const typedBlob = blobResponse as GitHubBlobResponse;
		if (typedBlob.content && typedBlob.encoding === 'base64') {
			return decodeBase64(typedBlob.content.replace(/\n/g, '')).toString();
		}

		return undefined;
	}
}
