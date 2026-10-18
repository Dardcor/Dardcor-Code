/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { StoredValue } from './storedValue.js';
import { TestId } from './testId.js';
import { IMainThreadTestController } from './testService.js';
import { ITestItem, ITestRunProfile, InternalTestItem, TestRunProfileBitset, testRunProfileBitsetList } from './testTypes.js';
import { TestingContextKeys } from './testingContextKeys.js';

export const ITestProfileService = createDecorator<ITestProfileService>('testProfileService');

export interface ITestProfileService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	addProfile(controller: IMainThreadTestController, profile: ITestRunProfile): void;

	updateProfile(controllerId: string, profileId: number, update: Partial<ITestRunProfile>): void;

	removeProfile(controllerId: string, profileId?: number): void;

	capabilitiesForTest(test: ITestItem): number;

	configure(controllerId: string, profileId: number): void;

	all(): Iterable<Readonly<{
		controller: IMainThreadTestController;
		profiles: ITestRunProfile[];
	}>>;

	getGroupDefaultProfiles(group: TestRunProfileBitset, controllerId?: string): ITestRunProfile[];

	setGroupDefaultProfiles(group: TestRunProfileBitset, profiles: ITestRunProfile[]): void;

	getControllerProfiles(controllerId: string): ITestRunProfile[];

	getDefaultProfileForTest(group: TestRunProfileBitset, test: InternalTestItem): ITestRunProfile | undefined;
}

export const canUseProfileWithTest = (profile: ITestRunProfile, test: InternalTestItem) =>
	profile.controllerId === test.controllerId && (TestId.isRoot(test.item.extId) || !profile.tag || test.item.tags.includes(profile.tag));

const sorter = (a: ITestRunProfile, b: ITestRunProfile) => {
	if (a.isDefault !== b.isDefault) {
		return a.isDefault ? -1 : 1;
	}

	return a.label.localeCompare(b.label);
};

interface IExtendedTestRunProfile extends ITestRunProfile {
	wasInitiallyDefault: boolean;
}

export const capabilityContextKeys = (capabilities: number): [key: string, value: boolean][] => [
	[TestingContextKeys.hasRunnableTests.key, (capabilities & TestRunProfileBitset.Run) !== 0],
	[TestingContextKeys.hasDebuggableTests.key, (capabilities & TestRunProfileBitset.Debug) !== 0],
	[TestingContextKeys.hasCoverableTests.key, (capabilities & TestRunProfileBitset.Coverage) !== 0],
];

type DefaultsMap = { [controllerId: string]: { [profileId: number]: boolean } };

export class TestProfileService extends Disposable implements ITestProfileService {
	declare readonly _serviceBrand: undefined;
	private readonly userDefaults: StoredValue<DefaultsMap>;
	private readonly capabilitiesContexts: { [K in TestRunProfileBitset]: IContextKey<boolean> };
	private readonly changeEmitter = this._register(new Emitter<void>());
	private readonly controllerProfiles = new Map< string, {
		profiles: IExtendedTestRunProfile[];
		controller: IMainThreadTestController;
	}>();

	public readonly onDidChange = this.changeEmitter.event;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService storageService: IStorageService,
	) {
		super();

		storageService.remove('testingPreferredProfiles', StorageScope.WORKSPACE);
		this.userDefaults = this._register(new StoredValue({
			key: 'testingPreferredProfiles2',
			scope: StorageScope.WORKSPACE,
			target: StorageTarget.MACHINE,
		}, storageService));

		this.capabilitiesContexts = {
			[TestRunProfileBitset.Run]: TestingContextKeys.hasRunnableTests.bindTo(contextKeyService),
			[TestRunProfileBitset.Debug]: TestingContextKeys.hasDebuggableTests.bindTo(contextKeyService),
			[TestRunProfileBitset.Coverage]: TestingContextKeys.hasCoverableTests.bindTo(contextKeyService),
			[TestRunProfileBitset.HasNonDefaultProfile]: TestingContextKeys.hasNonDefaultProfile.bindTo(contextKeyService),
			[TestRunProfileBitset.HasConfigurable]: TestingContextKeys.hasConfigurableProfile.bindTo(contextKeyService),
			[TestRunProfileBitset.SupportsContinuousRun]: TestingContextKeys.supportsContinuousRun.bindTo(contextKeyService),
		};

		this.refreshContextKeys();
	}

	public addProfile(controller: IMainThreadTestController, profile: ITestRunProfile): void {
		const previousExplicitDefaultValue = this.userDefaults.get()?.[controller.id]?.[profile.profileId];
		const extended: IExtendedTestRunProfile = {
			...profile,
			isDefault: previousExplicitDefaultValue ?? profile.isDefault,
			wasInitiallyDefault: profile.isDefault,
		};

		let record = this.controllerProfiles.get(profile.controllerId);
		if (record) {
			record.profiles.push(extended);
			record.profiles.sort(sorter);
		} else {
			record = {
				profiles: [extended],
				controller,
			};
			this.controllerProfiles.set(profile.controllerId, record);
		}

		this.refreshContextKeys();
		this.changeEmitter.fire();
	}

	public updateProfile(controllerId: string, profileId: number, update: Partial<ITestRunProfile>): void {
		const ctrl = this.controllerProfiles.get(controllerId);
		if (!ctrl) {
			return;
		}

		const profile = ctrl.profiles.find(c => c.controllerId === controllerId && c.profileId === profileId);
		if (!profile) {
			return;
		}

		Object.assign(profile, update);
		ctrl.profiles.sort(sorter);

		if (update.isDefault !== undefined) {
			const map = deepClone(this.userDefaults.get({}));
			setIsDefault(map, profile, update.isDefault);
			this.userDefaults.store(map);
		}

		this.changeEmitter.fire();
	}

	public configure(controllerId: string, profileId: number) {
		this.controllerProfiles.get(controllerId)?.controller.configureRunProfile(profileId);
	}

	public removeProfile(controllerId: string, profileId?: number): void {
		const ctrl = this.controllerProfiles.get(controllerId);
		if (!ctrl) {
			return;
		}

		if (!profileId) {
			this.controllerProfiles.delete(controllerId);
			this.changeEmitter.fire();
			return;
		}

		const index = ctrl.profiles.findIndex(c => c.profileId === profileId);
		if (index === -1) {
			return;
		}

		ctrl.profiles.splice(index, 1);
		this.refreshContextKeys();
		this.changeEmitter.fire();
	}

	public capabilitiesForTest(test: ITestItem) {
		const ctrl = this.controllerProfiles.get(TestId.root(test.extId));
		if (!ctrl) {
			return 0;
		}

		let capabilities = 0;
		for (const profile of ctrl.profiles) {
			if (!profile.tag || test.tags.includes(profile.tag)) {
				capabilities |= capabilities & profile.group ? TestRunProfileBitset.HasNonDefaultProfile : profile.group;
			}
		}

		return capabilities;
	}

	public all() {
		return this.controllerProfiles.values();
	}

	public getControllerProfiles(profileId: string) {
		return this.controllerProfiles.get(profileId)?.profiles ?? [];
	}

	public getGroupDefaultProfiles(group: TestRunProfileBitset, controllerId?: string) {
		const allProfiles = controllerId
			? (this.controllerProfiles.get(controllerId)?.profiles || [])
			: [...Iterable.flatMap(this.controllerProfiles.values(), c => c.profiles)];
		const defaults = allProfiles.filter(c => c.group === group && c.isDefault);

		if (defaults.length === 0) {
			const first = allProfiles.find(p => p.group === group);
			if (first) {
				defaults.push(first);
			}
		}

		return defaults;
	}

	public setGroupDefaultProfiles(group: TestRunProfileBitset, profiles: ITestRunProfile[]) {
		const next: DefaultsMap = {};
		for (const ctrl of this.controllerProfiles.values()) {
			next[ctrl.controller.id] = {};
			for (const profile of ctrl.profiles) {
				if (profile.group !== group) {
					continue;
				}

				setIsDefault(next, profile, profiles.some(p => p.profileId === profile.profileId));
			}

			for (const profile of ctrl.profiles) {
				if (profile.group === group) {
					continue;
				}
				const matching = ctrl.profiles.find(p => p.group === group && p.label === profile.label);
				if (matching) {
					setIsDefault(next, profile, matching.isDefault);
				}
			}

			ctrl.profiles.sort(sorter);
		}

		this.userDefaults.store(next);
		this.changeEmitter.fire();
	}

	getDefaultProfileForTest(group: TestRunProfileBitset, test: InternalTestItem): ITestRunProfile | undefined {
		return this.getControllerProfiles(test.controllerId).find(p => (p.group & group) !== 0 && canUseProfileWithTest(p, test));
	}

	private refreshContextKeys() {
		let allCapabilities = 0;
		for (const { profiles } of this.controllerProfiles.values()) {
			for (const profile of profiles) {
				allCapabilities |= allCapabilities & profile.group ? TestRunProfileBitset.HasNonDefaultProfile : profile.group;
				allCapabilities |= profile.supportsContinuousRun ? TestRunProfileBitset.SupportsContinuousRun : 0;
			}
		}

		for (const group of testRunProfileBitsetList) {
			this.capabilitiesContexts[group].set((allCapabilities & group) !== 0);
		}
	}
}

const setIsDefault = (map: DefaultsMap, profile: IExtendedTestRunProfile, isDefault: boolean) => {
	profile.isDefault = isDefault;
	map[profile.controllerId] ??= {};
	if (profile.isDefault !== profile.wasInitiallyDefault) {
		map[profile.controllerId][profile.profileId] = profile.isDefault;
	} else {
		delete map[profile.controllerId][profile.profileId];
	}
};
