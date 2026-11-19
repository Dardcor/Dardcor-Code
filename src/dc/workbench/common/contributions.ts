/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService, IConstructorSignature, ServicesAccessor, BrandedService } from '../../platform/instantiation/common/instantiation.js';
import { ILifecycleService, LifecyclePhase } from '../services/lifecycle/common/lifecycle.js';
import { Registry } from '../../platform/registry/common/platform.js';
import { IdleDeadline, DeferredPromise, runWhenGlobalIdle } from '../../base/common/async.js';
import { mark } from '../../base/common/performance.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IEnvironmentService } from '../../platform/environment/common/environment.js';
import { getOrSet } from '../../base/common/map.js';
import { Disposable, DisposableStore, isDisposable } from '../../base/common/lifecycle.js';
import { IEditorPaneService } from '../services/editor/common/editorPaneService.js';

export interface IWorkbenchContribution {
}

export namespace Extensions {
	export const Workbench = 'workbench.contributions.kind';
}

export const enum WorkbenchPhase {

	BlockStartup = LifecyclePhase.Starting,

	BlockRestore = LifecyclePhase.Ready,

	AfterRestored = LifecyclePhase.Restored,

	Eventually = LifecyclePhase.Eventually
}

export interface ILazyWorkbenchContributionInstantiation {
	readonly lazy: true;
}

export interface IOnEditorWorkbenchContributionInstantiation {
	readonly editorTypeId: string;
}

function isOnEditorWorkbenchContributionInstantiation(obj: unknown): obj is IOnEditorWorkbenchContributionInstantiation {
	const candidate = obj as IOnEditorWorkbenchContributionInstantiation | undefined;
	return !!candidate && typeof candidate.editorTypeId === 'string';
}

export type WorkbenchContributionInstantiation = WorkbenchPhase | ILazyWorkbenchContributionInstantiation | IOnEditorWorkbenchContributionInstantiation;

function toWorkbenchPhase(phase: LifecyclePhase.Restored | LifecyclePhase.Eventually): WorkbenchPhase.AfterRestored | WorkbenchPhase.Eventually {
	switch (phase) {
		case LifecyclePhase.Restored:
			return WorkbenchPhase.AfterRestored;
		case LifecyclePhase.Eventually:
			return WorkbenchPhase.Eventually;
	}
}

function toLifecyclePhase(instantiation: WorkbenchPhase): LifecyclePhase {
	switch (instantiation) {
		case WorkbenchPhase.BlockStartup:
			return LifecyclePhase.Starting;
		case WorkbenchPhase.BlockRestore:
			return LifecyclePhase.Ready;
		case WorkbenchPhase.AfterRestored:
			return LifecyclePhase.Restored;
		case WorkbenchPhase.Eventually:
			return LifecyclePhase.Eventually;
	}
}

type IWorkbenchContributionSignature<Service extends BrandedService[]> = new (...services: Service) => IWorkbenchContribution;

export interface IWorkbenchContributionsRegistry {

	registerWorkbenchContribution<Services extends BrandedService[]>(contribution: IWorkbenchContributionSignature<Services>, phase: LifecyclePhase.Restored | LifecyclePhase.Eventually): void;

	start(accessor: ServicesAccessor): void;

	readonly whenRestored: Promise<void>;

	readonly timings: Map<LifecyclePhase, Array<[string , number ]>>;
}

interface IWorkbenchContributionRegistration {
	readonly id: string | undefined;
	readonly ctor: IConstructorSignature<IWorkbenchContribution>;
}

export class WorkbenchContributionsRegistry extends Disposable implements IWorkbenchContributionsRegistry {

	static readonly INSTANCE = new WorkbenchContributionsRegistry();

	private static readonly BLOCK_BEFORE_RESTORE_WARN_THRESHOLD = 20;
	private static readonly BLOCK_AFTER_RESTORE_WARN_THRESHOLD = 100;

	private instantiationService: IInstantiationService | undefined;
	private lifecycleService: ILifecycleService | undefined;
	private logService: ILogService | undefined;
	private environmentService: IEnvironmentService | undefined;
	private editorPaneService: IEditorPaneService | undefined;

	private readonly contributionsByPhase = new Map<LifecyclePhase, IWorkbenchContributionRegistration[]>();
	private readonly contributionsByEditor = new Map<string, IWorkbenchContributionRegistration[]>();
	private readonly contributionsById = new Map<string, IWorkbenchContributionRegistration>();

	private readonly instancesById = new Map<string, IWorkbenchContribution>();
	private readonly instanceDisposables = this._register(new DisposableStore());

	private readonly timingsByPhase = new Map<LifecyclePhase, Array<[string , number ]>>();
	get timings() { return this.timingsByPhase; }

	private readonly pendingRestoredContributions = new DeferredPromise<void>();
	readonly whenRestored = this.pendingRestoredContributions.p;

	registerWorkbenchContribution2(id: string, ctor: IConstructorSignature<IWorkbenchContribution>, phase: WorkbenchPhase.BlockStartup | WorkbenchPhase.BlockRestore): void;
	registerWorkbenchContribution2(id: string | undefined, ctor: IConstructorSignature<IWorkbenchContribution>, phase: WorkbenchPhase.AfterRestored | WorkbenchPhase.Eventually): void;
	registerWorkbenchContribution2(id: string, ctor: IConstructorSignature<IWorkbenchContribution>, lazy: ILazyWorkbenchContributionInstantiation): void;
	registerWorkbenchContribution2(id: string, ctor: IConstructorSignature<IWorkbenchContribution>, onEditor: IOnEditorWorkbenchContributionInstantiation): void;
	registerWorkbenchContribution2(id: string | undefined, ctor: IConstructorSignature<IWorkbenchContribution>, instantiation: WorkbenchContributionInstantiation): void {
		const contribution: IWorkbenchContributionRegistration = { id, ctor };

		if (
			this.instantiationService && this.lifecycleService && this.logService && this.environmentService && this.editorPaneService &&
			(
				(typeof instantiation === 'number' && this.lifecycleService.phase >= instantiation) ||
				(typeof id === 'string' && isOnEditorWorkbenchContributionInstantiation(instantiation) && this.editorPaneService.didInstantiateEditorPane(instantiation.editorTypeId))
			)
		) {
			this.safeCreateContribution(this.instantiationService, this.logService, this.environmentService, contribution, typeof instantiation === 'number' ? toLifecyclePhase(instantiation) : this.lifecycleService.phase);
		}

		else {

			if (typeof instantiation === 'number') {
				getOrSet(this.contributionsByPhase, toLifecyclePhase(instantiation), []).push(contribution);
			}

			if (typeof id === 'string') {

				if (!this.contributionsById.has(id)) {
					this.contributionsById.set(id, contribution);
				} else {
					console.error(`IWorkbenchContributionsRegistry#registerWorkbenchContribution(): Can't register multiple contributions with same id '${id}'`);
				}

				if (isOnEditorWorkbenchContributionInstantiation(instantiation)) {
					getOrSet(this.contributionsByEditor, instantiation.editorTypeId, []).push(contribution);
				}
			}
		}
	}

	registerWorkbenchContribution(ctor: IConstructorSignature<IWorkbenchContribution>, phase: LifecyclePhase.Restored | LifecyclePhase.Eventually): void {
		this.registerWorkbenchContribution2(undefined, ctor, toWorkbenchPhase(phase));
	}

	getWorkbenchContribution<T extends IWorkbenchContribution>(id: string): T {
		if (this.instancesById.has(id)) {
			return this.instancesById.get(id) as T;
		}

		const instantiationService = this.instantiationService;
		const lifecycleService = this.lifecycleService;
		const logService = this.logService;
		const environmentService = this.environmentService;
		if (!instantiationService || !lifecycleService || !logService || !environmentService) {
			throw new Error(`IWorkbenchContributionsRegistry#getContribution('${id}'): cannot be called before registry started`);
		}

		const contribution = this.contributionsById.get(id);
		if (!contribution) {
			throw new Error(`IWorkbenchContributionsRegistry#getContribution('${id}'): contribution with that identifier is unknown.`);
		}

		if (lifecycleService.phase < LifecyclePhase.Restored) {
			logService.warn(`IWorkbenchContributionsRegistry#getContribution('${id}'): contribution instantiated before LifecyclePhase.Restored!`);
		}

		this.safeCreateContribution(instantiationService, logService, environmentService, contribution, lifecycleService.phase);

		const instance = this.instancesById.get(id);
		if (!instance) {
			throw new Error(`IWorkbenchContributionsRegistry#getContribution('${id}'): failed to create contribution.`);
		}

		return instance as T;
	}

	start(accessor: ServicesAccessor): void {
		const instantiationService = this.instantiationService = accessor.get(IInstantiationService);
		const lifecycleService = this.lifecycleService = accessor.get(ILifecycleService);
		const logService = this.logService = accessor.get(ILogService);
		const environmentService = this.environmentService = accessor.get(IEnvironmentService);
		const editorPaneService = this.editorPaneService = accessor.get(IEditorPaneService);

		this._register(lifecycleService.onDidShutdown(() => {
			this.instanceDisposables.clear();
		}));

		for (const phase of [LifecyclePhase.Starting, LifecyclePhase.Ready, LifecyclePhase.Restored, LifecyclePhase.Eventually]) {
			this.instantiateByPhase(instantiationService, lifecycleService, logService, environmentService, phase);
		}

		for (const editorTypeId of this.contributionsByEditor.keys()) {
			if (editorPaneService.didInstantiateEditorPane(editorTypeId)) {
				this.onEditor(editorTypeId, instantiationService, lifecycleService, logService, environmentService);
			}
		}
		this._register(editorPaneService.onWillInstantiateEditorPane(e => this.onEditor(e.typeId, instantiationService, lifecycleService, logService, environmentService)));
	}

	private onEditor(editorTypeId: string, instantiationService: IInstantiationService, lifecycleService: ILifecycleService, logService: ILogService, environmentService: IEnvironmentService): void {
		const contributions = this.contributionsByEditor.get(editorTypeId);
		if (contributions) {
			this.contributionsByEditor.delete(editorTypeId);

			for (const contribution of contributions) {
				this.safeCreateContribution(instantiationService, logService, environmentService, contribution, lifecycleService.phase);
			}
		}
	}

	private instantiateByPhase(instantiationService: IInstantiationService, lifecycleService: ILifecycleService, logService: ILogService, environmentService: IEnvironmentService, phase: LifecyclePhase): void {

		if (lifecycleService.phase >= phase) {
			this.doInstantiateByPhase(instantiationService, logService, environmentService, phase);
		}

		else {
			lifecycleService.when(phase).then(() => this.doInstantiateByPhase(instantiationService, logService, environmentService, phase));
		}
	}

	private async doInstantiateByPhase(instantiationService: IInstantiationService, logService: ILogService, environmentService: IEnvironmentService, phase: LifecyclePhase): Promise<void> {
		const contributions = this.contributionsByPhase.get(phase);
		if (contributions) {
			this.contributionsByPhase.delete(phase);

			switch (phase) {
				case LifecyclePhase.Starting:
				case LifecyclePhase.Ready: {


					mark(`code/willCreateWorkbenchContributions/${phase}`);

					for (const contribution of contributions) {
						this.safeCreateContribution(instantiationService, logService, environmentService, contribution, phase);
					}

					mark(`code/didCreateWorkbenchContributions/${phase}`);

					break;
				}

				case LifecyclePhase.Restored:
				case LifecyclePhase.Eventually: {


					if (phase === LifecyclePhase.Eventually) {
						await this.pendingRestoredContributions.p;
					}

					this.doInstantiateWhenIdle(contributions, instantiationService, logService, environmentService, phase);

					break;
				}
			}
		}
	}

	private doInstantiateWhenIdle(contributions: IWorkbenchContributionRegistration[], instantiationService: IInstantiationService, logService: ILogService, environmentService: IEnvironmentService, phase: LifecyclePhase): void {
		mark(`code/willCreateWorkbenchContributions/${phase}`);

		let i = 0;
		const forcedTimeout = phase === LifecyclePhase.Eventually ? 3000 : 500;

		const instantiateSome = (idle: IdleDeadline) => {
			while (i < contributions.length) {
				const contribution = contributions[i++];
				this.safeCreateContribution(instantiationService, logService, environmentService, contribution, phase);
				if (idle.timeRemaining() < 1) {
					runWhenGlobalIdle(instantiateSome, forcedTimeout);
					break;
				}
			}

			if (i === contributions.length) {
				mark(`code/didCreateWorkbenchContributions/${phase}`);

				if (phase === LifecyclePhase.Restored) {
					this.pendingRestoredContributions.complete();
				}
			}
		};

		runWhenGlobalIdle(instantiateSome, forcedTimeout);
	}

	private safeCreateContribution(instantiationService: IInstantiationService, logService: ILogService, environmentService: IEnvironmentService, contribution: IWorkbenchContributionRegistration, phase: LifecyclePhase): void {
		if (typeof contribution.id === 'string' && this.instancesById.has(contribution.id)) {
			return;
		}

		const now = Date.now();

		try {
			if (typeof contribution.id === 'string') {
				mark(`code/willCreateWorkbenchContribution/${phase}/${contribution.id}`);
			}

			const instance = instantiationService.createInstance(contribution.ctor);
			if (typeof contribution.id === 'string') {
				this.instancesById.set(contribution.id, instance);
				this.contributionsById.delete(contribution.id);
			}
			if (isDisposable(instance)) {
				this.instanceDisposables.add(instance);
			}
		} catch (error) {
			logService.error(`Unable to create workbench contribution '${contribution.id ?? contribution.ctor.name}'.`, error);
		} finally {
			if (typeof contribution.id === 'string') {
				mark(`code/didCreateWorkbenchContribution/${phase}/${contribution.id}`);
			}
		}

		if (typeof contribution.id === 'string' || !environmentService.isBuilt ) {
			const time = Date.now() - now;
			if (time > (phase < LifecyclePhase.Restored ? WorkbenchContributionsRegistry.BLOCK_BEFORE_RESTORE_WARN_THRESHOLD : WorkbenchContributionsRegistry.BLOCK_AFTER_RESTORE_WARN_THRESHOLD)) {
				logService.warn(`Creation of workbench contribution '${contribution.id ?? contribution.ctor.name}' took ${time}ms.`);
			}

			if (typeof contribution.id === 'string') {
				let timingsForPhase = this.timingsByPhase.get(phase);
				if (!timingsForPhase) {
					timingsForPhase = [];
					this.timingsByPhase.set(phase, timingsForPhase);
				}

				timingsForPhase.push([contribution.id, time]);
			}
		}
	}
}

export const registerWorkbenchContribution2 = WorkbenchContributionsRegistry.INSTANCE.registerWorkbenchContribution2.bind(WorkbenchContributionsRegistry.INSTANCE) as {
	<Services extends BrandedService[]>(id: string, ctor: IWorkbenchContributionSignature<Services>, instantiation: WorkbenchContributionInstantiation): void;
};

export const getWorkbenchContribution = WorkbenchContributionsRegistry.INSTANCE.getWorkbenchContribution.bind(WorkbenchContributionsRegistry.INSTANCE);

Registry.add(Extensions.Workbench, WorkbenchContributionsRegistry.INSTANCE);
