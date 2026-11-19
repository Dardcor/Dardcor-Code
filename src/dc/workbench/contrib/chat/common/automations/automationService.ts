/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../../base/common/observable.js';
import { stableStringify } from '../../../../../base/common/objects.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ChatPermissionLevel } from '../constants.js';
import { IAutomationDescriptor, IAutomationRun, AutomationRunTrigger, IAutomationSchedule, IAutomationSessionTemplate, AutomationTarget } from './automation.js';

export const IAutomationService = createDecorator<IAutomationService>('automationService');
export const ConfigureAutomationToolReferenceName = 'configureAutomation';

export type AutomationCatalogueState = 'loading' | 'ready' | 'unavailable' | 'error';

export function combineAutomationCatalogueStates(states: readonly AutomationCatalogueState[]): AutomationCatalogueState {
	if (states.includes('error')) {
		return 'error';
	}
	if (states.includes('loading')) {
		return 'loading';
	}
	if (states.includes('unavailable')) {
		return 'unavailable';
	}
	return 'ready';
}

export type AutomationMutationGuard = () => void;

export class AutomationActiveRunError extends Error {
	constructor(
		readonly automationId: string,
		readonly runId: string,
	) {
		super(`Automation '${automationId}' has active run '${runId}'.`);
	}
}

export function isAutomationActiveRunError(error: unknown): boolean {
	return error instanceof AutomationActiveRunError
		|| (error instanceof AggregateError && error.errors.length > 0 && error.errors.every(isAutomationActiveRunError));
}

export class AutomationSessionTemplateAuthorityError extends Error {
	constructor() {
		super('A canonical Automation session template cannot be updated through legacy configuration aliases.');
	}
}

export function assertAutomationSessionTemplateAuthority(current: IAutomationDescriptor, patch: IUpdateAutomationOptions): void {
	const targetAuthorityChanged = patch.target !== undefined
		&& (patch.target.providerId !== current.target.providerId || patch.target.sessionTypeId !== current.target.sessionTypeId);
	const legacyConfigurationPatched = patch.modelId !== undefined || patch.mode !== undefined || patch.permissionLevel !== undefined;
	if (current.sessionTemplate && patch.sessionTemplate === undefined && !targetAuthorityChanged && legacyConfigurationPatched) {
		throw new AutomationSessionTemplateAuthorityError();
	}
}

export interface ICreateAutomationOptions {
	readonly name: string;
	readonly prompt: string;
	readonly schedule: IAutomationSchedule;
	readonly target: AutomationTarget;
	readonly sessionTemplate?: IAutomationSessionTemplate;
	readonly modelId?: string;
	readonly mode?: string;
	readonly permissionLevel?: string;
	readonly enabled?: boolean;
}

export interface IUpdateAutomationOptions {
	readonly name?: string;
	readonly prompt?: string;
	readonly schedule?: IAutomationSchedule;
	readonly target?: AutomationTarget;
	readonly sessionTemplate?: IAutomationSessionTemplate | null;
	readonly modelId?: string | null;
	readonly mode?: string | null;
	readonly permissionLevel?: string | null;
	readonly enabled?: boolean;
}

export type IGuardedAutomationUpdateResult =
	| { readonly kind: 'updated'; readonly automation: IAutomationDescriptor }
	| { readonly kind: 'conflict'; readonly current: IAutomationDescriptor | undefined };

export function serializeAutomationEditableState(automation: IAutomationDescriptor): string {
	const target = automation.target.kind === 'quickChat'
		? {
			kind: automation.target.kind,
			providerId: automation.target.providerId,
			sessionTypeId: automation.target.sessionTypeId,
		}
		: {
			kind: automation.target.kind,
			folderUri: automation.target.folderUri.toString(),
			providerId: automation.target.providerId,
			sessionTypeId: automation.target.sessionTypeId,
			isolation: automation.target.isolation.kind === 'worktree'
				? { kind: automation.target.isolation.kind, branch: automation.target.isolation.branch }
				: { kind: automation.target.isolation.kind },
		};
	return stableStringify({
		name: automation.name,
		prompt: automation.prompt,
		schedule: {
			interval: automation.schedule.interval,
			scheduleHour: automation.schedule.scheduleHour,
			scheduleMinute: automation.schedule.scheduleMinute,
			scheduleDay: automation.schedule.scheduleDay,
		},
		target,
		sessionTemplate: automation.sessionTemplate,
		modelId: automation.modelId,
		mode: automation.mode,
		permissionLevel: automation.permissionLevel ?? ChatPermissionLevel.Default,
		enabled: automation.enabled,
	});
}

export interface IUpdateAutomationRunOptions {
	readonly status?: IAutomationRun['status'];
	readonly sessionResource?: URI;
	readonly completedAt?: string;
	readonly errorMessage?: string;
}

export interface IAutomationRunClaim {
	readonly claimed: boolean;
	readonly run: IAutomationRun;
	readonly externalDispatch?: {
		readonly sessionResource?: URI;
		readonly whenCompleted: Promise<void>;
		cancel?(): void;
	};
}

export interface IAutomationStore {
	readonly catalogueState: IObservable<AutomationCatalogueState>;

	readonly automations: IObservable<readonly IAutomationDescriptor[]>;

	readonly runs: IObservable<readonly IAutomationRun[]>;

	getAutomation(id: string): IAutomationDescriptor | undefined;

	runsFor(automationId: string): IObservable<readonly IAutomationRun[]>;

	createAutomation(options: ICreateAutomationOptions, mutationGuard?: AutomationMutationGuard): Promise<IAutomationDescriptor>;
	updateAutomation(id: string, patch: IUpdateAutomationOptions): Promise<IAutomationDescriptor>;
	updateAutomationIfUnchanged(id: string, patch: IUpdateAutomationOptions, expected: IAutomationDescriptor, mutationGuard?: AutomationMutationGuard): Promise<IGuardedAutomationUpdateResult>;
	deleteAutomation(id: string, mutationGuard?: AutomationMutationGuard): Promise<void>;

	recordRunStart(automationId: string, trigger: AutomationRunTrigger, leaderWindowId: number): Promise<IAutomationRunClaim>;

	updateRun(runId: string, patch: IUpdateAutomationRunOptions): Promise<IAutomationRun | undefined>;
	deleteRun(runId: string): Promise<void>;

	getActiveRunFor(automationId: string): IAutomationRun | undefined;

	markStaleRunsFailed(reason: string): Promise<void>;
}

export interface IAutomationService extends IAutomationStore {
	readonly _serviceBrand: undefined;
	canRunAutomation?(automationId: string): boolean;
	canUpdateAutomation?(automationId: string): boolean;
	canDeleteAutomation?(automationId: string): boolean;
	isSchedulingOwnedByHost?(automationId: string): boolean;
	startStaleRunRecovery(reason: string): Promise<void>;
	stopStaleRunRecovery(): void;
}
