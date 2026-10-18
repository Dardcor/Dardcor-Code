/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from '../../../../base/common/arrays.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorunIterableDelta, ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { WellDefinedPrefixTree } from '../../../../base/common/prefixTree.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { StoredValue } from './storedValue.js';
import { TestId } from './testId.js';
import { TestingContextKeys } from './testingContextKeys.js';
import { ITestProfileService } from './testProfileService.js';
import { ITestService } from './testService.js';
import { ITestRunProfile, TestRunProfileBitset } from './testTypes.js';

export const ITestingContinuousRunService = createDecorator<ITestingContinuousRunService>('testingContinuousRunService');

export interface ITestingContinuousRunService {
	readonly _serviceBrand: undefined;

	readonly lastRunProfileIds: ReadonlySet<number>;

	readonly onDidChange: Event<string | undefined>;

	isSpecificallyEnabledFor(testId: string): boolean;

	isEnabledForAParentOf(testId: string): boolean;

	isEnabledForAChildOf(testId: string): boolean;

	isEnabledForProfile(profile: ITestRunProfile): boolean;

	isEnabled(): boolean;

	start(profile: ITestRunProfile[] | TestRunProfileBitset, testId?: string): void;

	stopProfile(profile: ITestRunProfile): void;

	stop(testId?: string): void;
}

type RunningRef = { path: readonly string[]; profiles: ISettableObservable<ITestRunProfile[]>; autoSetDefault?: boolean; handle: DisposableStore };

export class TestingContinuousRunService extends Disposable implements ITestingContinuousRunService {
	declare readonly _serviceBrand: undefined;

	private readonly changeEmitter = this._register(new Emitter<string | undefined>());
	private readonly running = new WellDefinedPrefixTree<RunningRef>();
	private readonly lastRun: StoredValue<Set<number>>;

	public readonly onDidChange = this.changeEmitter.event;

	public get lastRunProfileIds() {
		return this.lastRun.get(new Set());
	}

	constructor(
		@ITestService private readonly testService: ITestService,
		@IStorageService storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITestProfileService private readonly testProfileService: ITestProfileService,
	) {
		super();
		const isGloballyOn = TestingContextKeys.isContinuousModeOn.bindTo(contextKeyService);
		this._register(this.onDidChange(() => {
			isGloballyOn.set(!!this.running.root.value);
		}));
		this.lastRun = this._register(new StoredValue<Set<number>>({
			key: 'lastContinuousRunProfileIds',
			scope: StorageScope.WORKSPACE,
			target: StorageTarget.MACHINE,
			serialization: {
				deserialize: v => new Set(JSON.parse(v)),
				serialize: v => JSON.stringify([...v])
			},
		}, storageService));

		this._register(toDisposable(() => {
			for (const cts of this.running.values()) {
				cts.handle.dispose();
			}
		}));
	}

	public isSpecificallyEnabledFor(testId: string): boolean {
		return this.running.size > 0 && this.running.hasKey(TestId.fromString(testId).path);
	}

	public isEnabledForAParentOf(testId: string): boolean {
		return !!this.running.root.value || (this.running.size > 0 && this.running.hasKeyOrParent(TestId.fromString(testId).path));
	}

	public isEnabledForProfile({ profileId, controllerId }: ITestRunProfile): boolean {
		for (const node of this.running.values()) {
			if (node.profiles.get().some(p => p.profileId === profileId && p.controllerId === controllerId)) {
				return true;
			}
		}

		return false;
	}

	public isEnabledForAChildOf(testId: string): boolean {
		return !!this.running.root.value || (this.running.size > 0 && this.running.hasKeyOrChildren(TestId.fromString(testId).path));
	}

	public isEnabled(): boolean {
		return !!this.running.root.value || this.running.size > 0;
	}

	public start(profiles: ITestRunProfile[] | TestRunProfileBitset, testId?: string): void {
		const store = new DisposableStore();

		let actualProfiles: ISettableObservable<ITestRunProfile[]>;
		if (profiles instanceof Array) {
			actualProfiles = observableValue('crProfiles', profiles);
		} else {
			const getRelevant = () => this.testProfileService.getGroupDefaultProfiles(profiles)
				.filter(p => p.supportsContinuousRun && (!testId || TestId.root(testId) === p.controllerId));
			actualProfiles = observableValue('crProfiles', getRelevant());
			store.add(this.testProfileService.onDidChange(() => {
				if (ref.autoSetDefault) {
					const newRelevant = getRelevant();
					if (!arrays.equals(newRelevant, actualProfiles.get())) {
						actualProfiles.set(getRelevant(), undefined);
					}
				}
			}));
		}

		const path = testId ? TestId.fromString(testId).path : [];
		const ref: RunningRef = { profiles: actualProfiles, handle: store, path, autoSetDefault: typeof profiles === 'number' };

		const existing = this.running.find(path);
		if (existing) {
			store.dispose();
			ref.autoSetDefault = existing.autoSetDefault = false;
			existing.profiles.set([...new Set([...actualProfiles.get(), ...existing.profiles.get()])], undefined);
			this.changeEmitter.fire(testId);
			return;
		}

		this.running.insert(path, ref);

		const cancellationStores = new DisposableMap<ITestRunProfile, CancellationTokenSource>();
		store.add(toDisposable(() => {
			for (const cts of cancellationStores.values()) {
				cts.cancel();
			}
			cancellationStores.dispose();
		}));
		store.add(autorunIterableDelta(reader => actualProfiles.read(reader), ({ addedValues, removedValues }) => {
			for (const profile of addedValues) {
				const cts = new CancellationTokenSource();
				this.testService.startContinuousRun({
					continuous: true,
					group: profile.group,
					targets: [{
						testIds: [testId ?? profile.controllerId],
						controllerId: profile.controllerId,
						profileId: profile.profileId
					}],
				}, cts.token);
				cancellationStores.set(profile, cts);
			}

			for (const profile of removedValues) {
				cancellationStores.get(profile)?.cancel();
				cancellationStores.deleteAndDispose(profile);
			}

			this.lastRun.store(new Set([...cancellationStores.keys()].map(p => p.profileId)));
		}));

		this.changeEmitter.fire(testId);
	}

	stopProfile({ profileId, controllerId }: ITestRunProfile): void {
		const toDelete: RunningRef[] = [];
		for (const node of this.running.values()) {
			const profs = node.profiles.get();
			const filtered = profs.filter(p => p.profileId !== profileId || p.controllerId !== controllerId);
			if (filtered.length === profs.length) {
				continue;
			} else if (filtered.length === 0) {
				toDelete.push(node);
			} else {
				node.profiles.set(filtered, undefined);
			}
		}

		for (let i = toDelete.length - 1; i >= 0; i--) {
			toDelete[i].handle.dispose();
			this.running.delete(toDelete[i].path);
		}

		this.changeEmitter.fire(undefined);
	}

	public stop(testId?: string): void {
		const cancellations = [...this.running.deleteRecursive(testId ? TestId.fromString(testId).path : [])];
		for (let i = cancellations.length - 1; i >= 0; i--) {
			cancellations[i].handle.dispose();
		}

		this.changeEmitter.fire(testId);
	}
}
