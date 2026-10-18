/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findFirstIdxMonotonousOrArrLen } from '../../../../base/common/arraysFind.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createSingleCallFunction } from '../../../../base/common/functional.js';
import { Disposable, DisposableStore, dispose, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { TestingContextKeys } from './testingContextKeys.js';
import { ITestProfileService } from './testProfileService.js';
import { ITestResult, LiveTestResult, TestResultItemChange, TestResultItemChangeReason } from './testResult.js';
import { ITestResultStorage, RETAIN_MAX_RESULTS } from './testResultStorage.js';
import { ExtensionRunTestsRequest, ITestRunProfile, ResolvedTestRunRequest, TestResultItem, TestResultState, TestRunProfileBitset } from './testTypes.js';

export type ResultChangeEvent =
	| { completed: LiveTestResult }
	| { started: LiveTestResult }
	| { inserted: ITestResult }
	| { removed: ITestResult[] };

export interface ITestResultService {
	readonly _serviceBrand: undefined;
	readonly onResultsChanged: Event<ResultChangeEvent>;

	readonly onTestChanged: Event<TestResultItemChange>;

	readonly results: ReadonlyArray<ITestResult>;

	clear(): void;

	createLiveResult(req: ResolvedTestRunRequest | ExtensionRunTestsRequest): LiveTestResult;

	push<T extends ITestResult>(result: T): T;

	getResult(resultId: string): ITestResult | undefined;

	getStateById(extId: string): [results: ITestResult, item: TestResultItem] | undefined;
}

const isRunningTests = (service: ITestResultService) =>
	service.results.length > 0 && service.results[0].completedAt === undefined;

export const ITestResultService = createDecorator<ITestResultService>('testResultService');

export class TestResultService extends Disposable implements ITestResultService {
	declare _serviceBrand: undefined;
	private changeResultEmitter = this._register(new Emitter<ResultChangeEvent>());
	private _results: ITestResult[] = [];
	private readonly _resultsDisposables: DisposableStore[] = [];
	private testChangeEmitter = this._register(new Emitter<TestResultItemChange>());
	private insertOrderCounter = 0;

	public get results() {
		this.loadResults();
		return this._results;
	}

	public readonly onResultsChanged = this.changeResultEmitter.event;

	public readonly onTestChanged = this.testChangeEmitter.event;

	private readonly isRunning: IContextKey<boolean>;
	private readonly hasAnyResults: IContextKey<boolean>;
	private readonly loadResults = createSingleCallFunction(() => this.storage.read().then(loaded => {
		for (let i = loaded.length - 1; i >= 0; i--) {
			this.push(loaded[i]);
		}
	}));

	protected readonly persistScheduler = this._register(new RunOnceScheduler(() => this.persistImmediately(), 500));

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITestResultStorage private readonly storage: ITestResultStorage,
		@ITestProfileService private readonly testProfiles: ITestProfileService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();
		this._register(toDisposable(() => dispose(this._resultsDisposables)));
		this.isRunning = TestingContextKeys.isRunning.bindTo(contextKeyService);
		this.hasAnyResults = TestingContextKeys.hasAnyResults.bindTo(contextKeyService);
	}

	public getStateById(extId: string): [results: ITestResult, item: TestResultItem] | undefined {
		for (const result of this.results) {
			const lookup = result.getStateById(extId);
			if (lookup && lookup.computedState !== TestResultState.Unset) {
				return [result, lookup];
			}
		}

		return undefined;
	}

	public createLiveResult(req: ResolvedTestRunRequest | ExtensionRunTestsRequest) {
		if ('targets' in req) {
			const id = generateUuid();
			return this.push(new LiveTestResult(id, true, req, this.insertOrderCounter++, this.telemetryService));
		}

		let profile: ITestRunProfile | undefined;
		if (req.profile) {
			const profiles = this.testProfiles.getControllerProfiles(req.controllerId);
			profile = profiles.find(c => c.profileId === req.profile!.id);
		}

		const resolved: ResolvedTestRunRequest = {
			preserveFocus: req.preserveFocus,
			targets: [],
			exclude: req.exclude,
			continuous: req.continuous,
			group: profile?.group ?? TestRunProfileBitset.Run,
		};

		if (profile) {
			resolved.targets.push({
				profileId: profile.profileId,
				controllerId: req.controllerId,
				testIds: req.include,
			});
		}

		return this.push(new LiveTestResult(req.id, req.persist, resolved, this.insertOrderCounter++, this.telemetryService));
	}

	public push<T extends ITestResult>(result: T): T {
		if (result.completedAt === undefined) {
			this.results.unshift(result);
		} else {
			const index = findFirstIdxMonotonousOrArrLen(this.results, r => r.completedAt !== undefined && r.completedAt <= result.completedAt!);
			this.results.splice(index, 0, result);
			this.persistScheduler.schedule();
		}

		this.hasAnyResults.set(true);
		if (this.results.length > RETAIN_MAX_RESULTS) {
			this.results.pop();
			this._resultsDisposables.pop()?.dispose();
		}

		const ds = new DisposableStore();
		this._resultsDisposables.push(ds);

		if (result instanceof LiveTestResult) {
			ds.add(result);
			ds.add(result.onComplete(() => this.onComplete(result)));
			ds.add(result.onChange(this.testChangeEmitter.fire, this.testChangeEmitter));
			this.isRunning.set(true);
			this.changeResultEmitter.fire({ started: result });
		} else {
			this.changeResultEmitter.fire({ inserted: result });
			for (const item of result.tests) {
				for (const otherResult of this.results) {
					if (otherResult === result) {
						this.testChangeEmitter.fire({ item, result, reason: TestResultItemChangeReason.ComputedStateChange });
						break;
					} else if (otherResult.getStateById(item.item.extId) !== undefined) {
						break;
					}
				}
			}
		}

		return result;
	}

	public getResult(id: string) {
		return this.results.find(r => r.id === id);
	}

	public clear() {
		const keep: ITestResult[] = [];
		const removed: ITestResult[] = [];
		for (const result of this.results) {
			if (result.completedAt !== undefined) {
				removed.push(result);
			} else {
				keep.push(result);
			}
		}

		this._results = keep;
		this.persistScheduler.schedule();
		if (keep.length === 0) {
			this.hasAnyResults.set(false);
		}
		this.changeResultEmitter.fire({ removed });
	}

	private onComplete(result: LiveTestResult) {
		this.resort();
		this.updateIsRunning();
		this.persistScheduler.schedule();
		this.changeResultEmitter.fire({ completed: result });
	}

	private resort() {
		this.results.sort((a, b) => {
			if (!!a.completedAt !== !!b.completedAt) {
				return a.completedAt === undefined ? -1 : 1;
			}

			const aComp = a instanceof LiveTestResult ? a.insertOrder : -1;
			const bComp = b instanceof LiveTestResult ? b.insertOrder : -1;
			return bComp - aComp;
		});
	}

	private updateIsRunning() {
		this.isRunning.set(isRunningTests(this));
	}

	protected async persistImmediately() {
		await this.loadResults();
		this.storage.persist(this.results);
	}
}
