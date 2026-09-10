import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IGitHubScheduler, schedulerDelay } from './githubScheduler.js';
export interface GitHubBackoffPolicy {
    readonly immediateRetries: number;
    readonly base: number;
    readonly maximum: number;
    readonly jitter: number;
    readonly decay?: number;
}
export function gitHubBackoffDelay(policy: GitHubBackoffPolicy, scheduler: IGitHubScheduler, attempts: number, minimum = 0): number {
    const escalated = attempts <= policy.immediateRetries
        ? 0
        : Math.min(policy.base * 2 ** (attempts - policy.immediateRetries - 1), policy.maximum);
    const delay = Math.max(escalated, minimum);
    return delay === 0 ? 0 : delay + scheduler.jitter(policy.jitter);
}
interface IBackoffState {
    readonly key: string;
    readonly attempts: number;
    readonly recordedAt: number;
    readonly blockedUntil: number;
}
export class GitHubBackoffGate extends Disposable {
    private readonly _lifetime = new AbortController();
    private _changed = new AbortController();
    private _state: IBackoffState | undefined;
    constructor(private readonly _label: string, private readonly _policy: GitHubBackoffPolicy, private readonly _scheduler: IGitHubScheduler, private readonly _logService?: ILogService) {
        super();
    }
    async wait(key: string, signal: AbortSignal): Promise<boolean> {
        let waited = false;
        while (this._state) {
            const state = this._state;
            if (state.key !== key) {
                this._set(undefined);
                return waited;
            }
            const remaining = state.blockedUntil - this._scheduler.now();
            if (remaining <= 0) {
                return waited;
            }
            this._logService?.debug(`[GitHubBackoffGate] Delaying ${this._label} by ${remaining}ms after ${state.attempts} consecutive failure(s)`);
            const changed = this._changed.signal;
            waited = true;
            try {
                await schedulerDelay(this._scheduler, remaining, AbortSignal.any([signal, this._lifetime.signal, changed]));
            }
            catch (error) {
                if (!changed.aborted || signal.aborted || this._lifetime.signal.aborted) {
                    throw error;
                }
            }
        }
        return waited;
    }
    fail(key: string): void {
        const now = this._scheduler.now();
        const state = this._state;
        const continues = state !== undefined
            && state.key === key
            && now - state.recordedAt <= (this._policy.decay ?? Number.POSITIVE_INFINITY);
        const attempts = (continues ? state.attempts : 0) + 1;
        const delay = gitHubBackoffDelay(this._policy, this._scheduler, attempts);
        this._set({ key, attempts, recordedAt: now, blockedUntil: now + delay });
        if (delay > 0) {
            this._logService?.warn(`[GitHubBackoffGate] Backing off ${this._label} by ${delay}ms after ${attempts} consecutive failure(s)`);
        }
    }
    reset(): void {
        if (this._state) {
            this._set(undefined);
        }
    }
    override dispose(): void {
        this._state = undefined;
        this._lifetime.abort(new Error(`GitHub ${this._label} backoff was disposed`));
        super.dispose();
    }
    private _set(state: IBackoffState | undefined): void {
        this._state = state;
        this._changed.abort();
        this._changed = new AbortController();
    }
}
