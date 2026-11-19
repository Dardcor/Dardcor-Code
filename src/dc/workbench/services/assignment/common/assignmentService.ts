/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { IKeyValueStorage, IExperimentationTelemetry, IExperimentationFilterProvider, ExperimentationService as TASClient } from 'tas-client';
import { Memento } from '../../../common/memento.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryData } from '../../../../base/common/actions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ASSIGNMENT_REFETCH_INTERVAL, ASSIGNMENT_STORAGE_KEY, AssignmentFilterProvider, IAssignmentService, TargetPopulation, VSCodeCoreAssignmentsFilterProvider, WindowKind } from '../../../../platform/assignment/common/assignment.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { resolveAmdNodeModulePath } from '../../../../amdX.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { timeout } from '../../../../base/common/async.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { CopilotAssignmentFilterProvider, GitHubCoreAssignmentsFilterProvider } from './assignmentFilters.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { AssignmentContextFilter } from './assignmentContextFilter.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { experimentsEnabled } from '../../telemetry/common/workbenchTelemetryUtils.js';

export interface IAssignmentFilter {
	readonly id: string;
	exclude(assignment: string): boolean;
	onDidChange: Event<void>;
}

export const IWorkbenchAssignmentService = createDecorator<IWorkbenchAssignmentService>('assignmentService');

export interface IWorkbenchAssignmentService extends IAssignmentService {
	getCurrentExperiments(): Promise<string[] | undefined>;
	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void;
}

class MementoKeyValueStorage implements IKeyValueStorage {

	private readonly mementoObj: Record<string, unknown>;

	constructor(private readonly memento: Memento<Record<string, unknown>>) {
		this.mementoObj = memento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	async getValue<T>(key: string, defaultValue?: T | undefined): Promise<T | undefined> {
		const value = await this.mementoObj[key] as T | undefined;

		return value || defaultValue;
	}

	setValue<T>(key: string, value: T): void {
		this.mementoObj[key] = value;
		this.memento.saveMemento();
	}
}

class WorkbenchAssignmentServiceTelemetry extends Disposable implements IExperimentationTelemetry {

	private readonly _onDidUpdateAssignmentContext = this._register(new Emitter<void>());
	readonly onDidUpdateAssignmentContext = this._onDidUpdateAssignmentContext.event;

	private _previousAssignmentContext: string | undefined;
	private _lastAssignmentContext: string | undefined;
	get assignmentContext(): string[] | undefined {
		return this._lastAssignmentContext?.split(';');
	}

	constructor(
		private readonly telemetryService: ITelemetryService,
		private readonly productService: IProductService,
		private readonly contextFilter: AssignmentContextFilter
	) {
		super();

		this._register(this.contextFilter.onDidChange(() => {
			if (this._previousAssignmentContext) {
				this._setAssignmentContext(this._previousAssignmentContext);
			}
		}));
	}

	private _setAssignmentContext(value: string): void {
		const filteredValue = this.contextFilter.filter(value);
		this._lastAssignmentContext = filteredValue;
		this._onDidUpdateAssignmentContext.fire();

		if (this.productService.tasConfig?.assignmentContextTelemetryPropertyName) {
			this.telemetryService.setExperimentProperty(this.productService.tasConfig.assignmentContextTelemetryPropertyName, filteredValue);
		}
	}

	setSharedProperty(name: string, value: string): void {
		if (name === this.productService.tasConfig?.assignmentContextTelemetryPropertyName) {
			this._previousAssignmentContext = value;
			return this._setAssignmentContext(value);
		}

		this.telemetryService.setExperimentProperty(name, value);
	}

	postEvent(eventName: string, props: Map<string, string>): void {
		const data: ITelemetryData = {};
		for (const [key, value] of props.entries()) {
			data[key] = value;
		}

		this.telemetryService.publicLog(eventName, data);
	}
}

export class WorkbenchAssignmentService extends Disposable implements IAssignmentService {

	declare readonly _serviceBrand: undefined;

	private tasClient: Promise<TASClient> | undefined;
	private readonly tasSetupDisposables = this._register(new DisposableStore());

	private assignmentsEndpoint: string | undefined;

	private networkInitialized = false;
	private setupGeneration = 0;
	private revokeCurrentSetup: (() => void) | undefined;
	private readonly overrideInitDelay: Promise<void>;

	private readonly contextFilter: AssignmentContextFilter;
	private readonly telemetry: WorkbenchAssignmentServiceTelemetry;
	private readonly keyValueStorage: IKeyValueStorage;

	private readonly experimentsEnabled: boolean;

	private readonly _onDidRefetchAssignments = this._register(new Emitter<void>());
	public readonly onDidRefetchAssignments = this._onDidRefetchAssignments.event;

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IRequestService private readonly requestService: IRequestService,
	) {
		super();

		this.experimentsEnabled = experimentsEnabled(configurationService, productService, this.environmentService);

		if (this.experimentsEnabled) {
			this.tasClient = this.setupTASClient();

			this.defaultAccountService.getDefaultAccount().then(() => this.recreateTasClientIfEndpointChanged());
			this._register(this.defaultAccountService.onDidChangeDefaultAccount(() => this.recreateTasClientIfEndpointChanged()));

			this._register(toDisposable(() => {
				this.revokeCurrentSetup?.();
				WorkbenchAssignmentService.disposeTasClient(this.tasClient);
			}));
		}

		this.contextFilter = this._register(new AssignmentContextFilter(storageService));
		this.telemetry = this._register(new WorkbenchAssignmentServiceTelemetry(telemetryService, productService, this.contextFilter));
		this._register(this.telemetry.onDidUpdateAssignmentContext(() => this._onDidRefetchAssignments.fire()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('experiments.override')) {
				this._onDidRefetchAssignments.fire();
			}
		}));

		this.keyValueStorage = new MementoKeyValueStorage(new Memento<Record<string, unknown>>('experiment.service.memento', storageService));

		const overrideDelaySetting = configurationService.getValue('experiments.overrideDelay');
		const overrideDelay = typeof overrideDelaySetting === 'number' ? overrideDelaySetting : 0;
		this.overrideInitDelay = timeout(overrideDelay);
	}

	async getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		const result = await this.doGetTreatment<T>(name);

		type TASClientReadTreatmentData = {
			treatmentName: string;
			treatmentValue: string;
		};

		type TASClientReadTreatmentClassification = {
			owner: 'sbatten';
			comment: 'Logged when a treatment value is read from the experiment service';
			treatmentValue: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The value of the read treatment' };
			treatmentName: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The name of the treatment that was read' };
		};

		this.telemetryService.publicLog2<TASClientReadTreatmentData, TASClientReadTreatmentClassification>('tasClientReadTreatmentComplete', {
			treatmentName: name,
			treatmentValue: JSON.stringify(result)
		});

		return result;
	}

	private async doGetTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		await this.overrideInitDelay;

		const override = this.configurationService.getValue<T>(`experiments.override.${name}`);
		if (override !== undefined) {
			return override;
		}

		if (!this.tasClient) {
			return undefined;
		}

		if (!this.experimentsEnabled) {
			return undefined;
		}

		let result: T | undefined;
		const client = await this.tasClient;

		if (this.networkInitialized) {
			result = client.getTreatmentVariable<T>('vscode', name);
		} else {
			result = await client.getTreatmentVariableAsync<T>('vscode', name, true);
		}

		result = client.getTreatmentVariable<T>('vscode', name);
		return result;
	}

	private getAssignmentsEndpoint(): string | undefined {
		const account = this.defaultAccountService.currentDefaultAccount;
		const endpoints = account?.entitlementsData?.endpoints;
		const exp = endpoints?.exp;
		if (!exp) {
			return undefined;
		}
		return `${exp.replace(/\/+$/, '')}/api/v1/assignments`;
	}

	private recreateTasClientIfEndpointChanged(): void {
		if (this._store.isDisposed) {
			return;
		}
		const next = this.getAssignmentsEndpoint();
		if (next !== this.assignmentsEndpoint) {
			this.tasClient = this.setupTASClient();
		}
	}

	private readonly assignmentsFetch = async (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }): Promise<{ status: number; json(): Promise<unknown> }> => {
		const context = await this.requestService.request({
			type: init.method,
			url,
			data: init.body,
			headers: init.headers,
			disableCache: true,
			callSite: 'assignmentService.assignments',
		}, CancellationToken.None);
		return {
			status: context.res.statusCode ?? 0,
			json: async () => (await asJson(context)) ?? {},
		};
	};

	private async setupTASClient(): Promise<TASClient> {
		this.tasSetupDisposables.clear();

		const generation = ++this.setupGeneration;
		this.networkInitialized = false;

		this.revokeCurrentSetup?.();
		WorkbenchAssignmentService.disposeTasClient(this.tasClient);

		let revoked = false;
		this.revokeCurrentSetup = () => { revoked = true; };

		const service = this;

		const keyValueStorage: IKeyValueStorage = {
			getValue<T>(key: string, defaultValue?: T): Promise<T | undefined> {
				return service.keyValueStorage.getValue<T>(key, defaultValue);
			},
			setValue<T>(key: string, value: T): void {
				if (!revoked) {
					service.keyValueStorage.setValue<T>(key, value);
				}
			},
		};

		const telemetry: IExperimentationTelemetry = {
			setSharedProperty(name: string, value: string): void {
				if (!revoked) {
					service.telemetry.setSharedProperty(name, value);
				}
			},
			postEvent(eventName: string, props: Map<string, string>): void {
				if (!revoked) {
					service.telemetry.postEvent(eventName, props);
				}
			},
		};

		const targetPopulation = this.productService.quality === 'stable' ?
			TargetPopulation.Public : (this.productService.quality === 'exploration' ?
				TargetPopulation.Exploration : TargetPopulation.Insiders);

		const filterProvider = new AssignmentFilterProvider(
			this.productService.version,
			this.productService.nameLong,
			this.telemetryService.machineId,
			this.telemetryService.devDeviceId,
			targetPopulation,
			this.productService.date ?? '',
			WindowKind.Editor
		);

		const extensionsFilterProvider = this.instantiationService.createInstance(CopilotAssignmentFilterProvider);
		this.tasSetupDisposables.add(extensionsFilterProvider);
		this.tasSetupDisposables.add(extensionsFilterProvider.onDidChangeFilters(() => this.refetchAssignments()));

		const assignmentsEndpoint = this.getAssignmentsEndpoint();
		this.assignmentsEndpoint = assignmentsEndpoint;
		let assignmentsFilterProviders: IExperimentationFilterProvider[] | undefined;
		if (assignmentsEndpoint) {
			const coreAssignmentsFilterProvider = new VSCodeCoreAssignmentsFilterProvider(
				this.productService.version,
				this.productService.nameLong,
				this.telemetryService.devDeviceId,
				targetPopulation,
				this.productService.date ?? '',
				WindowKind.Editor
			);
			const githubAssignmentsFilterProvider = this.instantiationService.createInstance(GitHubCoreAssignmentsFilterProvider);
			this.tasSetupDisposables.add(githubAssignmentsFilterProvider);
			this.tasSetupDisposables.add(githubAssignmentsFilterProvider.onDidChangeFilters(() => this.refetchAssignments()));
			assignmentsFilterProviders = [coreAssignmentsFilterProvider, githubAssignmentsFilterProvider];
		}

		const tasConfig = this.productService.tasConfig!;

		const tasClientUrl = resolveAmdNodeModulePath('tas-client', 'dist/tas-client.min.js');
		const tasClientModule = await import(/* webpackIgnore: true */ /* @vite-ignore */ `${tasClientUrl}`) as typeof import('tas-client');

		const fetchStopWatch = StopWatch.create();
		const tasClient = new tasClientModule.ExperimentationService({
			filterProviders: [filterProvider, extensionsFilterProvider],
			telemetry,
			storageKey: ASSIGNMENT_STORAGE_KEY,
			keyValueStorage,
			assignmentContextTelemetryPropertyName: tasConfig.assignmentContextTelemetryPropertyName,
			telemetryEventName: tasConfig.telemetryEventName,
			endpoint: tasConfig.endpoint,
			assignmentsEndpoint,
			assignmentsFilterProviders,
			assignmentsFetch: assignmentsEndpoint
				// @ts-ignore
				? (url, init) => (revoked ? Promise.resolve({ status: 0, json: async () => ({}) }) : service.assignmentsFetch(url, init))
				: undefined,
			refetchInterval: ASSIGNMENT_REFETCH_INTERVAL,
		});

		await tasClient.initializePromise;
		tasClient.initialFetch.then(() => {
			if (generation !== this.setupGeneration) {
				return;
			}
			this.networkInitialized = true;
			this.logFetchLatency('initial', fetchStopWatch.elapsed());
		}).catch(() => undefined);

		return tasClient;
	}

	private logFetchLatency(fetchType: 'initial' | 'refetch', durationMs: number): void {
		type TASClientFetchLatencyData = {
			fetchType: string;
			durationMs: number;
		};

		type TASClientFetchLatencyClassification = {
			owner: 'sbatten';
			comment: 'Measures the client-side latency of fetching treatment assignments from the experiment service (TAS)';
			fetchType: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether this was the initial fetch or a refetch' };
			durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Time in milliseconds the fetch took to complete' };
		};

		this.telemetryService.publicLog2<TASClientFetchLatencyData, TASClientFetchLatencyClassification>('tasClientFetchLatency', {
			fetchType,
			durationMs
		});
	}

	private async refetchAssignments(): Promise<void> {
		if (!this.tasClient) {
			return;
		}

		const tasClient = await this.tasClient;
		await tasClient.initialFetch;

		const refetchStopWatch = StopWatch.create();
		await tasClient.getTreatmentVariableAsync('vscode', 'refresh', false);
		this.logFetchLatency('refetch', refetchStopWatch.elapsed());
	}

	async getCurrentExperiments(): Promise<string[] | undefined> {
		if (!this.tasClient) {
			return undefined;
		}

		if (!this.experimentsEnabled) {
			return undefined;
		}

		await this.tasClient;

		return this.telemetry.assignmentContext;
	}

	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void {
		this.contextFilter.addFilter(filter);
	}

	private static disposeTasClient(client: Promise<TASClient> | undefined): void {
		client?.then(c => c.dispose()).catch(() => undefined);
	}
}

registerSingleton(IWorkbenchAssignmentService, WorkbenchAssignmentService, InstantiationType.Delayed);

const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
registry.registerConfiguration({
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.enableExperiments': {
			'type': 'boolean',
			'description': localize('workbench.enableExperiments', "Fetches experiments to run from a Microsoft online service."),
			'default': true,
			'scope': ConfigurationScope.APPLICATION,
			'restricted': true,
			'tags': ['usesOnlineServices']
		}
	}
});
