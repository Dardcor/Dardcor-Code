/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as perf from '../../../../base/common/performance.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { ILifecycleService, LifecyclePhase } from '../../lifecycle/common/lifecycle.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { ITelemetryData, ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { Barrier, timeout } from '../../../../base/common/async.js';
import { IWorkbenchLayoutService } from '../../layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../panecomposite/browser/panecomposite.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { TelemetryTrustedValue } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { isWeb } from '../../../../base/common/platform.js';
import { createBlobWorker } from '../../../../platform/webWorker/browser/webWorkerServiceImpl.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ITerminalBackendRegistry, TerminalExtensions } from '../../../../platform/terminal/common/terminal.js';

export interface IMemoryInfo {
	readonly workingSetSize: number;
	readonly privateBytes: number;
	readonly sharedBytes: number;
}

export interface IStartupMetrics {

	readonly initialStartup: boolean;

	readonly emptyWorkbench: boolean;

	readonly isLatestVersion: boolean;

	readonly didUseCachedData: boolean;

	readonly windowKind: number;

	readonly windowCount: number;

	readonly viewletId?: string;

	readonly auxiliaryViewletId?: string;

	readonly panelId?: string;

	readonly editorIds: string[];

	readonly ellapsed: number;

	readonly timers: {
		readonly ellapsedAppReady?: number;

		readonly ellapsedNlsGeneration?: number;

		readonly ellapsedLoadMainBundle?: number;

		readonly ellapsedRunMainBundle?: number;

		readonly ellapsedCrashReporter?: number;

		readonly ellapsedMainServer?: number;

		readonly ellapsedWindowCreate?: number;

		readonly ellapsedBrowserWindowCreate?: number;

		readonly ellapsedWindowRestoreState?: number;

		readonly ellapsedWindowMaximize?: number;

		readonly ellapsedWindowLoad?: number;

		readonly ellapsedWindowLoadToRequire: number;

		readonly ellapsedWaitForWindowConfig: number;

		readonly ellapsedStorageInit: number;

		readonly ellapsedWorkspaceServiceInit: number;

		readonly ellapsedSharedProcesConnected: number;

		/**
		 * The time it took to initialize required user data (settings & global state) using settings sync service.
		 *
		 * * Happens in the renderer-process (only in Web)
		 * * Measured with the `willInitRequiredUserData` and `didInitRequiredUserData` performance marks.
		 */
		readonly ellapsedRequiredUserDataInit: number;

		readonly ellapsedOtherUserDataInit: number;

		readonly ellapsedRequire: number;

		readonly ellapsedExtensions: number;

		readonly ellapsedExtensionsReady: number;

		readonly ellapsedViewletRestore: number;

		readonly ellapsedAuxiliaryViewletRestore: number;

		readonly ellapsedPanelRestore: number;

		readonly ellapsedEditorRestore: number;

		readonly ellapsedWorkbenchContributions: number;

		readonly ellapsedWorkbench: number;

		readonly ellapsedRenderer: number;
	};

	readonly hasAccessibilitySupport: boolean;
	readonly isVMLikelyhood?: number;
	readonly platform?: string;
	readonly release?: string;
	readonly arch?: string;
	readonly totalmem?: number;
	readonly freemem?: number;
	readonly meminfo?: IMemoryInfo;
	readonly cpus?: { count: number; speed: number; model: string };
	readonly loadavg?: number[];
	readonly isARM64Emulated?: boolean;
}

export interface ITimerService {
	readonly _serviceBrand: undefined;

	whenReady(): Promise<boolean>;

	perfBaseline: Promise<number>;

	readonly startupMetrics: IStartupMetrics;

	setPerformanceMarks(source: string, marks: perf.PerformanceMark[]): void;

	getPerformanceMarks(): [source: string, marks: readonly perf.PerformanceMark[]][];

	getDuration(from: string, to: string): number;

	getStartTime(mark: string): number;
}

export const ITimerService = createDecorator<ITimerService>('timerService');


class PerfMarks {

	private readonly _entries: [string, perf.PerformanceMark[]][] = [];

	setMarks(source: string, entries: perf.PerformanceMark[]): void {
		this._entries.push([source, entries]);
	}

	getDuration(from: string, to: string): number {
		const fromEntry = this._findEntry(from);
		if (!fromEntry) {
			return 0;
		}
		const toEntry = this._findEntry(to);
		if (!toEntry) {
			return 0;
		}
		return toEntry.startTime - fromEntry.startTime;
	}

	getStartTime(mark: string): number {
		const entry = this._findEntry(mark);
		return entry ? entry.startTime : -1;
	}

	private _findEntry(name: string): perf.PerformanceMark | void {
		for (const [, marks] of this._entries) {
			for (let i = marks.length - 1; i >= 0; i--) {
				if (marks[i].name === name) {
					return marks[i];
				}
			}
		}
	}

	getEntries() {
		return this._entries.slice(0);
	}
}

export type Writeable<T> = { -readonly [P in keyof T]: Writeable<T[P]> };

export abstract class AbstractTimerService implements ITimerService {

	declare readonly _serviceBrand: undefined;

	private readonly _barrier = new Barrier();
	private readonly _marks = new PerfMarks();
	private readonly _rndValueShouldSendTelemetry = Math.random() < .03;

	private _startupMetrics?: IStartupMetrics;

	readonly perfBaseline: Promise<number>;

	constructor(
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IPaneCompositePartService private readonly _paneCompositeService: IPaneCompositePartService,
		@IEditorService private readonly _editorService: IEditorService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		Promise.all([
			this._extensionService.whenInstalledExtensionsRegistered(),
			_lifecycleService.when(LifecyclePhase.Restored),
			layoutService.whenRestored,
			Promise.all(Array.from(Registry.as<ITerminalBackendRegistry>(TerminalExtensions.Backend).backends.values()).map(e => e.whenReady))
		]).then(() => {
			this.setPerformanceMarks('renderer', perf.getMarks());
			return this._computeStartupMetrics();
		}).then(metrics => {
			this._startupMetrics = metrics;
			this._reportStartupTimes(metrics);
			this._barrier.open();
		});


		this.perfBaseline = this._barrier.wait()
			.then(() => this._lifecycleService.when(LifecyclePhase.Eventually))
			.then(() => timeout(this._startupMetrics!.timers.ellapsedRequire))
			.then(() => {


				const jsSrc = (function (this: WindowOrWorkerGlobalScope) {
					let tooSlow = false;
					function fib(n: number): number {
						if (tooSlow) {
							return 0;
						}
						if (performance.now() - t1 >= 1000) {
							tooSlow = true;
						}
						if (n <= 2) {
							return n;
						}
						return fib(n - 1) + fib(n - 2);
					}

					const t1 = performance.now();
					fib(24);
					const value = Math.round(performance.now() - t1);
					self.postMessage({ value: tooSlow ? -1 : value });

				}).toString();

				const blob = new Blob([`(${jsSrc})();`], { type: 'application/javascript' });
				const blobUrl = URL.createObjectURL(blob);

				const worker = createBlobWorker(blobUrl, { name: 'perfBaseline' });
				return new Promise<number>(resolve => {
					worker.onmessage = e => resolve(e.data.value);

				}).finally(() => {
					worker.terminate();
					URL.revokeObjectURL(blobUrl);
				});
			});
	}

	whenReady(): Promise<boolean> {
		return this._barrier.wait();
	}

	get startupMetrics(): IStartupMetrics {
		if (!this._startupMetrics) {
			throw new Error('illegal state, MUST NOT access startupMetrics before whenReady has resolved');
		}
		return this._startupMetrics;
	}

	setPerformanceMarks(source: string, marks: perf.PerformanceMark[]): void {
		const codeMarks = marks.filter(mark => mark.name.startsWith('code/'));
		this._marks.setMarks(source, codeMarks);
		this._reportPerformanceMarks(source, codeMarks);
	}

	getPerformanceMarks(): [source: string, marks: readonly perf.PerformanceMark[]][] {
		return this._marks.getEntries();
	}

	getDuration(from: string, to: string): number {
		return this._marks.getDuration(from, to);
	}

	getStartTime(mark: string): number {
		return this._marks.getStartTime(mark);
	}

	private _reportStartupTimes(metrics: IStartupMetrics): void {
		this._telemetryService.publicLog('startupTimeVaried', metrics as unknown as ITelemetryData);
	}

	protected _shouldReportPerfMarks(): boolean {
		return this._rndValueShouldSendTelemetry;
	}

	private _reportPerformanceMarks(source: string, marks: perf.PerformanceMark[]) {

		if (!this._shouldReportPerfMarks()) {
			return;
		}


		type Mark = { source: string; name: TelemetryTrustedValue<string>; startTime: number };
		type MarkClassification = {
			owner: 'jrieken';
			comment: 'Information about a performance marker';
			source: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Where this marker was generated, e.g main, renderer, extension host' };
			name: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The name of this marker (as defined in source code)' };
			startTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The absolute timestamp (unix time)' };
		};

		for (const mark of marks) {
			this._telemetryService.publicLog2<Mark, MarkClassification>('startup.timer.mark', {
				source,
				name: new TelemetryTrustedValue(mark.name),
				startTime: mark.startTime
			});
		}

	}

	private async _computeStartupMetrics(): Promise<IStartupMetrics> {
		const initialStartup = this._isInitialStartup();
		let startMark: string;
		if (isWeb) {
			startMark = 'code/timeOrigin';
		} else {
			startMark = initialStartup ? 'code/didStartMain' : 'code/willOpenNewWindow';
		}

		const activeViewlet = this._paneCompositeService.getActivePaneComposite(ViewContainerLocation.Sidebar);
		const activeAuxiliaryViewlet = this._paneCompositeService.getActivePaneComposite(ViewContainerLocation.AuxiliaryBar);
		const activePanel = this._paneCompositeService.getActivePaneComposite(ViewContainerLocation.Panel);
		const info: Writeable<IStartupMetrics> = {

			ellapsed: this._marks.getDuration(startMark, 'code/didStartWorkbench'),

			isLatestVersion: Boolean(await this._updateService.isLatestVersion()),
			didUseCachedData: this._didUseCachedData(),
			windowKind: this._lifecycleService.startupKind,
			windowCount: await this._getWindowCount(),
			viewletId: activeViewlet?.getId(),
			auxiliaryViewletId: activeAuxiliaryViewlet?.getId(),
			editorIds: this._editorService.visibleEditors.map(input => input.typeId),
			panelId: activePanel ? activePanel.getId() : undefined,

			timers: {
				ellapsedAppReady: initialStartup ? this._marks.getDuration('code/didStartMain', 'code/mainAppReady') : undefined,
				ellapsedNlsGeneration: initialStartup ? this._marks.getDuration('code/willGenerateNls', 'code/didGenerateNls') : undefined,
				ellapsedLoadMainBundle: initialStartup ? this._marks.getDuration('code/willLoadMainBundle', 'code/didLoadMainBundle') : undefined,
				ellapsedRunMainBundle: initialStartup ? this._marks.getDuration('code/didStartMain', 'code/didRunMainBundle') : undefined,
				ellapsedCrashReporter: initialStartup ? this._marks.getDuration('code/willStartCrashReporter', 'code/didStartCrashReporter') : undefined,
				ellapsedMainServer: initialStartup ? this._marks.getDuration('code/willStartMainServer', 'code/didStartMainServer') : undefined,
				ellapsedWindowCreate: initialStartup ? this._marks.getDuration('code/willCreateCodeWindow', 'code/didCreateCodeWindow') : undefined,
				ellapsedWindowRestoreState: initialStartup ? this._marks.getDuration('code/willRestoreCodeWindowState', 'code/didRestoreCodeWindowState') : undefined,
				ellapsedBrowserWindowCreate: initialStartup ? this._marks.getDuration('code/willCreateCodeBrowserWindow', 'code/didCreateCodeBrowserWindow') : undefined,
				ellapsedWindowMaximize: initialStartup ? this._marks.getDuration('code/willMaximizeCodeWindow', 'code/didMaximizeCodeWindow') : undefined,
				ellapsedWindowLoad: initialStartup ? this._marks.getDuration('code/mainAppReady', 'code/willOpenNewWindow') : undefined,
				ellapsedWindowLoadToRequire: this._marks.getDuration('code/willOpenNewWindow', 'code/willLoadWorkbenchMain'),
				ellapsedRequire: this._marks.getDuration('code/willLoadWorkbenchMain', 'code/didLoadWorkbenchMain'),
				ellapsedWaitForWindowConfig: this._marks.getDuration('code/willWaitForWindowConfig', 'code/didWaitForWindowConfig'),
				ellapsedStorageInit: this._marks.getDuration('code/willInitStorage', 'code/didInitStorage'),
				ellapsedSharedProcesConnected: this._marks.getDuration('code/willConnectSharedProcess', 'code/didConnectSharedProcess'),
				ellapsedWorkspaceServiceInit: this._marks.getDuration('code/willInitWorkspaceService', 'code/didInitWorkspaceService'),
				ellapsedRequiredUserDataInit: this._marks.getDuration('code/willInitRequiredUserData', 'code/didInitRequiredUserData'),
				ellapsedOtherUserDataInit: this._marks.getDuration('code/willInitOtherUserData', 'code/didInitOtherUserData'),
				ellapsedExtensions: this._marks.getDuration('code/willLoadExtensions', 'code/didLoadExtensions'),
				ellapsedEditorRestore: this._marks.getDuration('code/willRestoreEditors', 'code/didRestoreEditors'),
				ellapsedViewletRestore: this._marks.getDuration('code/willRestoreViewlet', 'code/didRestoreViewlet'),
				ellapsedAuxiliaryViewletRestore: this._marks.getDuration('code/willRestoreAuxiliaryBar', 'code/didRestoreAuxiliaryBar'),
				ellapsedPanelRestore: this._marks.getDuration('code/willRestorePanel', 'code/didRestorePanel'),
				ellapsedWorkbenchContributions: this._marks.getDuration('code/willCreateWorkbenchContributions/1', 'code/didCreateWorkbenchContributions/2'),
				ellapsedWorkbench: this._marks.getDuration('code/willStartWorkbench', 'code/didStartWorkbench'),
				ellapsedExtensionsReady: this._marks.getDuration(startMark, 'code/didLoadExtensions'),
				ellapsedRenderer: this._marks.getDuration('code/didStartRenderer', 'code/didStartWorkbench')
			},

			platform: undefined,
			release: undefined,
			arch: undefined,
			totalmem: undefined,
			freemem: undefined,
			meminfo: undefined,
			cpus: undefined,
			loadavg: undefined,
			isVMLikelyhood: undefined,
			initialStartup,
			hasAccessibilitySupport: this._accessibilityService.isScreenReaderOptimized(),
			emptyWorkbench: this._contextService.getWorkbenchState() === WorkbenchState.EMPTY
		};

		await this._extendStartupInfo(info);
		return info;
	}

	protected abstract _isInitialStartup(): boolean;

	protected abstract _didUseCachedData(): boolean;

	protected abstract _getWindowCount(): Promise<number>;

	protected abstract _extendStartupInfo(info: Writeable<IStartupMetrics>): Promise<void>;
}


export class TimerService extends AbstractTimerService {

	protected _isInitialStartup(): boolean {
		return false;
	}
	protected _didUseCachedData(): boolean {
		return false;
	}
	protected async _getWindowCount(): Promise<number> {
		return 1;
	}
	protected async _extendStartupInfo(info: Writeable<IStartupMetrics>): Promise<void> {
		info.isVMLikelyhood = 0;
		info.isARM64Emulated = false;
		info.platform = navigator.userAgent;
		info.release = navigator.appVersion;
	}
}
