import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { GitHubHostCapabilities, IGitHubEndpointProvider } from './githubTypes.js';
import { GitHubCredential } from './githubCredentialService.js';
import { GitHubBackoffPolicy, gitHubBackoffDelay } from './githubBackoff.js';
import { IGitHubScheduler, systemGitHubScheduler } from './githubScheduler.js';
import { GitHubGraphQLError, IGitHubTransport } from './githubTransport.js';
const unavailableCapabilities: GitHubHostCapabilities = {
    graphql: false,
    mergeQueue: false,
    internalMergeStatus: false,
    reviewThreads: false,
    checkContextRequiredness: false,
};
const capabilitiesQuery = `query AgentHostGitHubCapabilities {
	pullRequest: __type(name: "PullRequest") { fields { name } }
	repository: __type(name: "Repository") { fields { name } }
	requirableByPullRequest: __type(name: "RequirableByPullRequest") { name }
	rateLimit { limit remaining used resetAt }
}`;
interface ITypeFields {
    readonly fields?: readonly {
        readonly name?: string;
    }[];
}
interface ICapabilitiesProbe {
    readonly pullRequest?: ITypeFields;
    readonly repository?: ITypeFields;
    readonly requirableByPullRequest?: {
        readonly name?: string;
    };
}
interface ICapabilitiesProbeResult {
    readonly capabilities: GitHubHostCapabilities;
    readonly cache: boolean;
}
interface ICachedCapabilities {
    readonly controller: AbortController;
    readonly promise: Promise<GitHubHostCapabilities>;
    waiters: number;
    settled: boolean;
}
const defaultProbeBackoff: GitHubBackoffPolicy = {
    immediateRetries: 0,
    base: 60000,
    maximum: 900000,
    jitter: 5000,
};
interface IDegradedCapabilities {
    readonly capabilities: GitHubHostCapabilities;
    readonly attempts: number;
    readonly retryAt: number;
    readonly generation: number;
}
export interface IGitHubCapabilities {
    getCapabilities(credential: GitHubCredential, enterpriseVersion: string | undefined, signal: AbortSignal): Promise<GitHubHostCapabilities>;
    clear(): void;
}
export class GitHubHostCapabilitiesService extends Disposable implements IGitHubCapabilities {
    private readonly _cache = new Map<string, ICachedCapabilities>();
    private readonly _degraded = new Map<string, IDegradedCapabilities>();
    private readonly _scheduler: IGitHubScheduler;
    constructor(scheduler: IGitHubScheduler | undefined, private readonly _policy: GitHubBackoffPolicy = defaultProbeBackoff, private readonly _transport: IGitHubTransport, private readonly _endpointService: IGitHubEndpointProvider, private readonly _logService?: ILogService) {
        super();
        this._scheduler = scheduler ?? systemGitHubScheduler;
        this._register(this._endpointService.onDidChange(() => this.clear()));
    }
    getCapabilities(credential: GitHubCredential, enterpriseVersion: string | undefined, signal: AbortSignal): Promise<GitHubHostCapabilities> {
        if (signal.aborted) {
            return Promise.reject(signal.reason);
        }
        const key = `${credential.account.host.toLowerCase()}\x00${enterpriseVersion ?? ''}`;
        const degraded = this._degraded.get(key);
        if (degraded && degraded.generation !== credential.generation) {
            this._degraded.delete(key);
            this._logService?.debug(`[GitHubHostCapabilitiesService] Discarding degraded capabilities for ${credential.account.host} because the credential changed`);
        }
        else if (degraded && this._scheduler.now() < degraded.retryAt) {
            this._logService?.trace(`[GitHubHostCapabilitiesService] Reusing degraded capabilities for ${credential.account.host} for another ${degraded.retryAt - this._scheduler.now()}ms`);
            return Promise.resolve(degraded.capabilities);
        }
        let cached = this._cache.get(key);
        if (!cached) {
            this._logService?.debug(`[GitHubHostCapabilitiesService] Probing capabilities for ${credential.account.host}${enterpriseVersion ? ` (${enterpriseVersion})` : ''}`);
            const controller = new AbortController();
            const entry: ICachedCapabilities = {
                controller,
                promise: this._probe(credential, controller.signal)
                    .then(result => {
                    if (result.cache) {
                        this._degraded.delete(key);
                    }
                    else {
                        this._recordDegraded(key, credential, result.capabilities);
                        if (this._cache.get(key) === entry) {
                            this._cache.delete(key);
                        }
                    }
                    this._logService?.debug(`[GitHubHostCapabilitiesService] Capabilities for ${credential.account.host}: ${formatCapabilities(result.capabilities)} (cached: ${result.cache})`);
                    return result.capabilities;
                })
                    .catch(error => {
                    if (this._cache.get(key) === entry) {
                        this._cache.delete(key);
                    }
                    this._logService?.debug(`[GitHubHostCapabilitiesService] Capability probe failed for ${credential.account.host} (${capabilityErrorKind(error)})`);
                    throw error;
                })
                    .finally(() => entry.settled = true),
                waiters: 0,
                settled: false,
            };
            cached = entry;
            this._cache.set(key, cached);
        }
        else {
            this._logService?.trace(`[GitHubHostCapabilitiesService] Reusing capability probe for ${credential.account.host}${enterpriseVersion ? ` (${enterpriseVersion})` : ''}`);
        }
        cached.waiters++;
        return waitForCapabilities(cached.promise, signal).finally(() => {
            cached.waiters--;
            if (cached.waiters === 0 && !cached.settled && this._cache.get(key) === cached) {
                this._cache.delete(key);
                cached.controller.abort(new Error('All GitHub capability waiters cancelled'));
            }
        });
    }
    clear(): void {
        if (this._cache.size > 0) {
            this._logService?.debug(`[GitHubHostCapabilitiesService] Clearing ${this._cache.size} cached capability probe(s)`);
        }
        for (const entry of this._cache.values()) {
            entry.controller.abort(new Error('GitHub capability cache was cleared'));
        }
        this._cache.clear();
        this._degraded.clear();
    }
    override dispose(): void {
        this.clear();
        super.dispose();
    }
    private _recordDegraded(key: string, credential: GitHubCredential, capabilities: GitHubHostCapabilities): void {
        const previous = this._degraded.get(key);
        const attempts = (previous?.generation === credential.generation ? previous.attempts : 0) + 1;
        const delay = gitHubBackoffDelay(this._policy, this._scheduler, attempts);
        this._degraded.set(key, { capabilities, attempts, retryAt: this._scheduler.now() + delay, generation: credential.generation });
        this._logService?.debug(`[GitHubHostCapabilitiesService] Reusing degraded capabilities for ${credential.account.host} for ${delay}ms after ${attempts} unusable probe(s)`);
    }
    private async _probe(credential: GitHubCredential, signal: AbortSignal): Promise<ICapabilitiesProbeResult> {
        const response = await this._transport.graphql<ICapabilitiesProbe>(credential.account, credential.token, this._endpointService.getGraphQlUri(), capabilitiesQuery, {}, AbortSignal.any([signal, credential.signal]), 'enrichment');
        if (response.errors.length > 0) {
            const schemaValidation = response.errors.every(isSchemaValidationError);
            const detail = response.errors.map(formatGraphQLError).join('; ');
            if (schemaValidation) {
                this._logService?.debug(`[GitHubHostCapabilitiesService] Host ${credential.account.host} lacks the expected GraphQL schema, disabling GraphQL capabilities: ${detail}`);
            }
            else {
                this._logService?.warn(`[GitHubHostCapabilitiesService] Capability probe for ${credential.account.host} returned errors, disabling GraphQL capabilities: ${detail}`);
            }
            return {
                capabilities: unavailableCapabilities,
                cache: schemaValidation,
            };
        }
        if (!response.data?.pullRequest) {
            this._logService?.warn(`[GitHubHostCapabilitiesService] Capability probe for ${credential.account.host} did not return the PullRequest type, disabling GraphQL capabilities`);
            return { capabilities: unavailableCapabilities, cache: false };
        }
        const pullRequestFields = fieldNames(response.data.pullRequest);
        const repositoryFields = fieldNames(response.data.repository);
        return {
            capabilities: {
                graphql: true,
                mergeQueue: pullRequestFields.has('mergeQueueEntry') && repositoryFields.has('mergeQueue'),
                internalMergeStatus: false,
                reviewThreads: pullRequestFields.has('reviewThreads'),
                checkContextRequiredness: typeof response.data.requirableByPullRequest?.name === 'string',
            },
            cache: true,
        };
    }
}
function formatCapabilities(capabilities: GitHubHostCapabilities): string {
    return [
        `graphql=${capabilities.graphql}`,
        `mergeQueue=${capabilities.mergeQueue}`,
        `reviewThreads=${capabilities.reviewThreads}`,
        `checkContextRequiredness=${capabilities.checkContextRequiredness}`,
    ].join(', ');
}
function capabilityErrorKind(error: unknown): string {
    return error instanceof Error ? error.name : typeof error;
}
function formatGraphQLError(error: GitHubGraphQLError): string {
    const kind = error.type ?? error.extensions?.code;
    return kind ? `${kind}: ${error.message ?? 'no message'}` : error.message ?? 'unknown error';
}
function waitForCapabilities(promise: Promise<GitHubHostCapabilities>, signal: AbortSignal): Promise<GitHubHostCapabilities> {
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        void promise.then(value => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, error => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
function isSchemaValidationError(error: GitHubGraphQLError): boolean {
    const type = error.type?.toUpperCase();
    const code = error.extensions?.code?.toUpperCase();
    return type === 'VALIDATION'
        || type === 'GRAPHQL_VALIDATION_ERROR'
        || type === 'GRAPHQL_VALIDATION_FAILED'
        || code === 'UNDEFINEDFIELD'
        || code === 'ARGUMENTNOTACCEPTED'
        || code === 'VARIABLEMISMATCH';
}
function fieldNames(type: ITypeFields | undefined): ReadonlySet<string> {
    const result = new Set<string>();
    for (const field of type?.fields ?? []) {
        if (typeof field.name === 'string') {
            result.add(field.name);
        }
    }
    return result;
}
