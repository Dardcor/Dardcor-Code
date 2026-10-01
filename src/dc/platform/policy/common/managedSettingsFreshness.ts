import type { ManagedSettingsChannel } from './copilotManagedSettings.js';
export const enum ManagedSettingsFreshnessState {
    NotRequired = 'notRequired',
    Pending = 'pending',
    Satisfied = 'satisfied',
    Blocked = 'blocked'
}
export const enum ManagedSettingsFreshnessFailure {
    NoUrl = 'noUrl',
    NoToken = 'noToken',
    Network = 'network',
    RateLimited = 'rateLimited',
    HttpError = 'httpError',
    Malformed = 'malformed',
    UpdateRequired = 'updateRequired'
}
export interface IManagedSettingsFreshnessScope {
    readonly accountId: string;
    readonly authenticationProviderId: string;
    readonly endpointOrigin: string;
}
interface IManagedSettingsFreshnessEffective {
    readonly source: ManagedSettingsChannel;
    readonly scope?: IManagedSettingsFreshnessScope;
    readonly lastAttemptAt?: number;
}
type ManagedSettingsFreshnessBlocked = IManagedSettingsFreshnessEffective & {
    readonly state: ManagedSettingsFreshnessState.Blocked;
} & ({
    readonly failure: ManagedSettingsFreshnessFailure.HttpError;
    readonly httpStatus: number;
} | {
    readonly failure: Exclude<ManagedSettingsFreshnessFailure, ManagedSettingsFreshnessFailure.HttpError>;
});
export type IManagedSettingsFreshness = {
    readonly state: ManagedSettingsFreshnessState.NotRequired;
} | (IManagedSettingsFreshnessEffective & {
    readonly state: ManagedSettingsFreshnessState.Pending;
}) | (IManagedSettingsFreshnessEffective & {
    readonly state: ManagedSettingsFreshnessState.Satisfied;
    readonly scope: IManagedSettingsFreshnessScope;
    readonly satisfiedAt: number;
}) | ManagedSettingsFreshnessBlocked;
export const MANAGED_SETTINGS_FRESHNESS_NOT_REQUIRED: IManagedSettingsFreshness = { state: ManagedSettingsFreshnessState.NotRequired };
export function isManagedSettingsFreshnessBlocking(freshness: IManagedSettingsFreshness): boolean {
    return freshness.state === ManagedSettingsFreshnessState.Pending
        || freshness.state === ManagedSettingsFreshnessState.Blocked;
}
function isSameScope(a: IManagedSettingsFreshnessScope, b: IManagedSettingsFreshnessScope): boolean {
    return a.accountId === b.accountId
        && a.authenticationProviderId === b.authenticationProviderId
        && a.endpointOrigin === b.endpointOrigin;
}
export function isManagedSettingsFreshnessSatisfiedFor(freshness: IManagedSettingsFreshness, scope: IManagedSettingsFreshnessScope): boolean {
    return freshness.state === ManagedSettingsFreshnessState.Satisfied
        && isSameScope(freshness.scope, scope);
}
