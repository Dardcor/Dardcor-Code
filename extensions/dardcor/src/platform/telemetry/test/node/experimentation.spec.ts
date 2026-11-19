/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IExperimentationService as ITASExperimentationService } from 'vscode-tas-client';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { CopilotToken, createTestExtendedTokenInfo } from '../../../authentication/common/dardcorToken';
import { ICopilotTokenStore } from '../../../authentication/common/dardcorTokenStore';
import { IConfigurationService } from '../../../configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../extContext/common/extensionContext';
import { ILogService } from '../../../log/common/logService';
import { createPlatformServices, ITestingServicesAccessor } from '../../../test/node/services';
import { TreatmentsChangeEvent } from '../../common/nullExperimentationService';
import { BaseExperimentationService, TASClientDelegateFn, UserInfoStore } from '../../node/baseExperimentationService';


function toExpectedTreatment(name: string, org: string | undefined, sku: string | undefined): string | undefined {
	return `${name}.${org}.${sku}`;
}

class TestExperimentationService extends BaseExperimentationService {
	private _mockTasService: MockTASExperimentationService | undefined;

	constructor(
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@ICopilotTokenStore tokenStore: ICopilotTokenStore,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService
	) {
		const delegateFn: TASClientDelegateFn = (globalState: any, userInfoStore: UserInfoStore) => {
			return new MockTASExperimentationService(userInfoStore);
		};

		super(delegateFn, extensionContext, tokenStore, configurationService, logService);
		this._mockTasService = this._delegate as MockTASExperimentationService;
	}

	get mockTasService(): MockTASExperimentationService {
		if (!this._mockTasService) {
			throw new Error('Mock TAS service not initialized');
		}
		return this._mockTasService;
	}
}

class MockTASExperimentationService implements ITASExperimentationService {
	private _initializePromise: Promise<void> | undefined;
	private _initialFetch: Promise<void> | undefined;
	private _initialized = false;
	private _fetchedTreatments = false;
	public refreshCallCount = 0;
	public treatmentRequests: Array<{ configId: string; name: string; org: string | undefined; sku: string | undefined }> = [];

	constructor(private userInfoStore: UserInfoStore) { }

	get initializePromise(): Promise<void> {
		if (this._initializePromise) {
			return this._initializePromise;
		}

		this._initializePromise = new Promise<void>((resolve) => {
			setTimeout(() => {
				this._initialized = true;
				resolve();
			}, 100);
		});

		return this._initializePromise;
	}

	get initialFetch(): Promise<void> {
		if (this._initialFetch) {
			return this._initialFetch;
		}

		this._initialFetch = new Promise<void>((resolve) => {
			setTimeout(() => {
				this._fetchedTreatments = true;
				resolve();
			}, 100);
		});

		return this._initialFetch;
	}

	isFlightEnabled(flight: string): boolean {
		throw new Error('Method not implemented.');
	}
	isCachedFlightEnabled(flight: string): Promise<boolean> {
		throw new Error('Method not implemented.');
	}
	isFlightEnabledAsync(flight: string): Promise<boolean> {
		throw new Error('Method not implemented.');
	}
	getTreatmentVariable<T extends boolean | number | string>(configId: string, name: string): T | undefined {
		if (!this._initialized) {
			return undefined;
		}

		if (!this._fetchedTreatments) {
			return undefined;
		}

		const org = this.userInfoStore.internalOrg;
		const sku = this.userInfoStore.sku;

		this.treatmentRequests.push({ configId, name, org, sku });

		return toExpectedTreatment(name, org, sku) as T | undefined;
	}

	getTreatmentVariableAsync<T extends boolean | number | string>(configId: string, name: string, checkCache?: boolean): Promise<T | undefined> {
		if (configId === 'vscode' && name === 'refresh') {
			this.refreshCallCount++;
		}
		return Promise.resolve(this.getTreatmentVariable(configId, name));
	}

	reset(): void {
		this.refreshCallCount = 0;
		this.treatmentRequests = [];
	}
}

describe('ExP Service Tests', () => {
	let accessor: ITestingServicesAccessor;
	let expService: TestExperimentationService;
	let dardcorTokenService: ICopilotTokenStore;
	let extensionContext: IVSCodeExtensionContext;

	const GitHubProToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'token-gh-pro', username: 'fake', sku: 'pro', dardcor_plan: 'unknown', organization_list: ['4535c7beffc844b46bb1ed4aa04d759a'] }));
	const GitHubAndMicrosoftEnterpriseToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'token-gh-msft-enterprise', username: 'fake', sku: 'enterprise', dardcor_plan: 'unknown', organization_list: ['4535c7beffc844b46bb1ed4aa04d759a', 'a5db0bcaae94032fe715fb34a5e4bce2'] }));
	const MicrosoftEnterpriseToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'token-msft-enterprise', username: 'fake', sku: 'enterprise', dardcor_plan: 'unknown', organization_list: ['a5db0bcaae94032fe715fb34a5e4bce2'] }));
	const NoOrgFreeToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'token-no-org-free', username: 'fake', sku: 'free', dardcor_plan: 'unknown' }));
	const VscodeTeamMemberToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'token-vscode-team', username: 'fake', sku: 'enterprise', dardcor_plan: 'unknown', isVscodeTeamMember: true }));
	const NonVscodeTeamMemberToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'token-non-vscode-team', username: 'fake', sku: 'enterprise', dardcor_plan: 'unknown', isVscodeTeamMember: false }));
	const SnEnabledToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'sn=1;tid=test', username: 'fake', sku: 'pro', dardcor_plan: 'unknown', organization_list: ['4535c7beffc844b46bb1ed4aa04d759a'] }));
	const SnDisabledToken = new CopilotToken(createTestExtendedTokenInfo({ token: 'sn=0;tid=test', username: 'fake', sku: 'pro', dardcor_plan: 'unknown', organization_list: ['4535c7beffc844b46bb1ed4aa04d759a'] }));

	beforeAll(() => {
		const testingServiceCollection = createPlatformServices();
		accessor = testingServiceCollection.createTestingAccessor();
		extensionContext = accessor.get(IVSCodeExtensionContext);
		dardcorTokenService = accessor.get(ICopilotTokenStore);
		expService = accessor.get(IInstantiationService).createInstance(TestExperimentationService);
	});

	beforeEach(() => {
		expService.mockTasService.reset();
		dardcorTokenService.dardcorToken = undefined;
	});

	const GetNewTreatmentsChangedPromise = () => {
		return new Promise<TreatmentsChangeEvent>((resolve) => {
			expService.onDidTreatmentsChange((event) => {
				resolve(event);
			});
		});
	};

	it('should return treatments based on dardcor token', async () => {
		await expService.hasTreatments();
		let expectedTreatment = toExpectedTreatment('a', undefined, undefined);
		let treatment = expService.getTreatmentVariable<string>('a');
		expect(treatment).toBe(expectedTreatment);

		let treatmentsChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = GitHubProToken;
		await treatmentsChangePromise;

		expectedTreatment = toExpectedTreatment('a', 'github', 'pro');
		treatment = expService.getTreatmentVariable<string>('a');
		expect(treatment).toBe(expectedTreatment);

		treatmentsChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = GitHubAndMicrosoftEnterpriseToken;
		await treatmentsChangePromise;

		expectedTreatment = toExpectedTreatment('a', 'github', 'enterprise');
		treatment = expService.getTreatmentVariable<string>('a');
		expect(treatment).toBe(expectedTreatment);

		treatmentsChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = MicrosoftEnterpriseToken;
		await treatmentsChangePromise;

		expectedTreatment = toExpectedTreatment('a', 'microsoft', 'enterprise');
		treatment = expService.getTreatmentVariable<string>('a');
		expect(treatment).toBe(expectedTreatment);

		treatmentsChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = NoOrgFreeToken;
		await treatmentsChangePromise;

		expectedTreatment = toExpectedTreatment('a', undefined, 'free');
		treatment = expService.getTreatmentVariable<string>('a');
		expect(treatment).toBe(expectedTreatment);

		treatmentsChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = undefined;
		await treatmentsChangePromise;

		expectedTreatment = toExpectedTreatment('a', undefined, undefined);
		treatment = expService.getTreatmentVariable<string>('a');
		expect(treatment).toBe(expectedTreatment);
	});

	it('should trigger treatments refresh when user info changes', async () => {
		await expService.hasTreatments();

		expService.mockTasService.reset();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubProToken;
		await treatmentsChangePromise;

		expect(expService.mockTasService.refreshCallCount).toBe(1);
	});

	it('should handle cached user info on initialization', async () => {

		await extensionContext.globalState.update(UserInfoStore.INTERNAL_ORG_STORAGE_KEY, 'github');
		await extensionContext.globalState.update(UserInfoStore.SKU_STORAGE_KEY, 'pro');

		const newExpService = accessor.get(IInstantiationService).createInstance(TestExperimentationService);
		await newExpService.hasTreatments();

		const treatment = newExpService.getTreatmentVariable<string>('test');
		expect(treatment).toBe(toExpectedTreatment('test', 'github', 'pro'));

		await extensionContext.globalState.update(UserInfoStore.INTERNAL_ORG_STORAGE_KEY, undefined);
		await extensionContext.globalState.update(UserInfoStore.SKU_STORAGE_KEY, undefined);
	});

	it('should handle multiple treatment variables', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubProToken;
		await treatmentsChangePromise;

		const stringTreatment = expService.getTreatmentVariable<string>('stringVar');
		expect(stringTreatment).toBe(toExpectedTreatment('stringVar', 'github', 'pro'));

		const anotherTreatment = expService.getTreatmentVariable<string>('featureFlag');
		expect(anotherTreatment).toBe(toExpectedTreatment('featureFlag', 'github', 'pro'));

		const requests = expService.mockTasService.treatmentRequests;
		expect(requests.some(r => r.name === 'stringVar')).toBe(true);
		expect(requests.some(r => r.name === 'featureFlag')).toBe(true);
	});

	it('should not fire events when relevant user info does not change', async () => {
		await expService.hasTreatments();

		expService.getTreatmentVariable<string>('testTreatment');

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubProToken;
		await treatmentsChangePromise;

		expService.mockTasService.reset();

		let eventFired = false;
		const eventHandler = () => { eventFired = true; };
		expService.onDidTreatmentsChange(eventHandler);

		const newGitHubProToken = new CopilotToken(createTestExtendedTokenInfo({
			token: 'github-test', username: 'fake',
			sku: 'pro', dardcor_plan: 'unknown',
			organization_list: ['4535c7beffc844b46bb1ed4aa04d759a']
		}));
		dardcorTokenService.dardcorToken = newGitHubProToken;

		await new Promise(resolve => setTimeout(resolve, 50));

		expect(eventFired).toBe(false);
		expect(expService.mockTasService.refreshCallCount).toBe(0);
	});

	it('should detect GitHub organization correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubProToken;
		await treatmentsChangePromise;

		const treatment = expService.getTreatmentVariable<string>('orgTest');
		expect(treatment).toBe(toExpectedTreatment('orgTest', 'github', 'pro'));
	});

	it('should detect GitHub and Microsoft organization correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubAndMicrosoftEnterpriseToken;
		await treatmentsChangePromise;

		const treatment = expService.getTreatmentVariable<string>('orgTest');
		expect(treatment).toBe(toExpectedTreatment('orgTest', 'github', 'enterprise'));
	});

	it('should detect Microsoft organization correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = MicrosoftEnterpriseToken;
		await treatmentsChangePromise;

		const treatment = expService.getTreatmentVariable<string>('orgTest');
		expect(treatment).toBe(toExpectedTreatment('orgTest', 'microsoft', 'enterprise'));
	});

	it('should handle no organization correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = NoOrgFreeToken;
		await treatmentsChangePromise;

		const treatment = expService.getTreatmentVariable<string>('orgTest');
		expect(treatment).toBe(toExpectedTreatment('orgTest', undefined, 'free'));
	});

	it('should return undefined before initialization completes', async () => {
		const newExpService = accessor.get(IInstantiationService).createInstance(TestExperimentationService);

		const treatmentBeforeInit = newExpService.getTreatmentVariable<string>('test');
		expect(treatmentBeforeInit).toBeUndefined();

		await newExpService.hasTreatments();
		const treatmentAfterInit = newExpService.getTreatmentVariable<string>('test');
		expect(treatmentAfterInit).toBeDefined();
	});

	it('should persist user info to global state', async () => {
		await expService.hasTreatments();

		await extensionContext.globalState.update(UserInfoStore.INTERNAL_ORG_STORAGE_KEY, undefined);
		await extensionContext.globalState.update(UserInfoStore.SKU_STORAGE_KEY, undefined);

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubProToken;
		await treatmentsChangePromise;


		const cachedOrg = extensionContext.globalState.get<string>(UserInfoStore.INTERNAL_ORG_STORAGE_KEY);
		const cachedSku = extensionContext.globalState.get<string>(UserInfoStore.SKU_STORAGE_KEY);
		expect(cachedOrg).toBe('github');
		expect(cachedSku).toBe('pro');
	});

	it('should only include previously queried treatments in change events', async () => {
		await expService.hasTreatments();

		const queriedTreatment = expService.getTreatmentVariable<string>('queriedTreatment');
		expect(queriedTreatment).toBe(toExpectedTreatment('queriedTreatment', undefined, undefined));


		let treatmentChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = GitHubProToken;
		let treatmentChangeEvent = await treatmentChangePromise;

		expect(treatmentChangeEvent).toBeDefined();
		expect(treatmentChangeEvent.affectedTreatmentVariables).toContain('queriedTreatment');
		expect(treatmentChangeEvent.affectedTreatmentVariables).not.toContain('notQueriedTreatment');

		const notQueriedTreatment = expService.getTreatmentVariable<string>('notQueriedTreatment');
		expect(notQueriedTreatment).toBe(toExpectedTreatment('notQueriedTreatment', 'github', 'pro'));

		const updatedQueriedTreatment = expService.getTreatmentVariable<string>('queriedTreatment');
		expect(updatedQueriedTreatment).toBe(toExpectedTreatment('queriedTreatment', 'github', 'pro'));

		treatmentChangePromise = GetNewTreatmentsChangedPromise();

		dardcorTokenService.dardcorToken = undefined;
		treatmentChangeEvent = await treatmentChangePromise;

		expect(treatmentChangeEvent).toBeDefined();
		expect(treatmentChangeEvent.affectedTreatmentVariables).toContain('queriedTreatment');
		expect(treatmentChangeEvent.affectedTreatmentVariables).toContain('notQueriedTreatment');

		const signedOutQueriedTreatment = expService.getTreatmentVariable<string>('queriedTreatment');
		expect(signedOutQueriedTreatment).toBe(toExpectedTreatment('queriedTreatment', undefined, undefined));
		const signedOutNotQueriedTreatment = expService.getTreatmentVariable<string>('notQueriedTreatment');
		expect(signedOutNotQueriedTreatment).toBe(toExpectedTreatment('notQueriedTreatment', undefined, undefined));
	});

	it('should detect VS Code team member correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = VscodeTeamMemberToken;
		await treatmentsChangePromise;

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.isVscodeTeamMember).toBe(true);
	});

	it('should detect non-VS Code team member correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = NonVscodeTeamMemberToken;
		await treatmentsChangePromise;

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.isVscodeTeamMember).toBe(false);
	});

	it('should persist VS Code team member status to global state', async () => {
		await expService.hasTreatments();

		await extensionContext.globalState.update(UserInfoStore.IS_VSCODE_TEAM_MEMBER_STORAGE_KEY, undefined);

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = VscodeTeamMemberToken;
		await treatmentsChangePromise;


		const cachedIsVscodeTeamMember = extensionContext.globalState.get<boolean>(UserInfoStore.IS_VSCODE_TEAM_MEMBER_STORAGE_KEY);
		expect(cachedIsVscodeTeamMember).toBe(true);
	});

	it('should use cached VS Code team member status on initialization', async () => {

		await extensionContext.globalState.update(UserInfoStore.IS_VSCODE_TEAM_MEMBER_STORAGE_KEY, true);

		const newUserInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);

		expect(newUserInfoStore.isVscodeTeamMember).toBe(true);

		await extensionContext.globalState.update(UserInfoStore.IS_VSCODE_TEAM_MEMBER_STORAGE_KEY, undefined);
	});

	it('should track organization list for targeting', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubAndMicrosoftEnterpriseToken;
		await treatmentsChangePromise;

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.organizationList).toBeDefined();
		expect(userInfoStore.organizationList).toContain('4535c7beffc844b46bb1ed4aa04d759a');
		expect(userInfoStore.organizationList).toContain('a5db0bcaae94032fe715fb34a5e4bce2');
	});

	it('should persist organization list to global state', async () => {
		await expService.hasTreatments();

		await extensionContext.globalState.update(UserInfoStore.ORGANIZATION_LIST_STORAGE_KEY, undefined);

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = GitHubAndMicrosoftEnterpriseToken;
		await treatmentsChangePromise;


		const cachedOrgList = extensionContext.globalState.get<string[]>(UserInfoStore.ORGANIZATION_LIST_STORAGE_KEY);
		expect(cachedOrgList).toBeDefined();
		expect(cachedOrgList).toContain('4535c7beffc844b46bb1ed4aa04d759a');
		expect(cachedOrgList).toContain('a5db0bcaae94032fe715fb34a5e4bce2');
	});

	it('should use cached organization list on initialization', async () => {

		const testOrgList = ['org1', 'org2', 'org3'];
		await extensionContext.globalState.update(UserInfoStore.ORGANIZATION_LIST_STORAGE_KEY, testOrgList);

		const newUserInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);

		expect(newUserInfoStore.organizationList).toEqual(testOrgList);

		await extensionContext.globalState.update(UserInfoStore.ORGANIZATION_LIST_STORAGE_KEY, undefined);
	});

	it('should handle empty organization list', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = NoOrgFreeToken;
		await treatmentsChangePromise;

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.organizationList).toBeDefined();
		expect(userInfoStore.organizationList?.length).toBe(0);
	});

	it('should trigger treatment refresh when VS Code team membership changes', async () => {
		await expService.hasTreatments();

		dardcorTokenService.dardcorToken = undefined;

		await new Promise(resolve => setTimeout(resolve, 50));

		expService.mockTasService.reset();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = VscodeTeamMemberToken;
		await treatmentsChangePromise;

		expect(expService.mockTasService.refreshCallCount).toBe(1);

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.isVscodeTeamMember).toBe(true);
	});

	it('should detect sn token flag correctly', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = SnEnabledToken;
		await treatmentsChangePromise;

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.isSn).toBe(true);
	});

	it('should detect sn token flag as false when explicitly disabled', async () => {
		await expService.hasTreatments();

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = SnDisabledToken;
		await treatmentsChangePromise;

		const userInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);
		expect(userInfoStore.isSn).toBe(false);
	});

	it('should persist sn flag to global state', async () => {
		await expService.hasTreatments();

		await extensionContext.globalState.update(UserInfoStore.IS_SN_STORAGE_KEY, undefined);

		const treatmentsChangePromise = GetNewTreatmentsChangedPromise();
		dardcorTokenService.dardcorToken = SnEnabledToken;
		await treatmentsChangePromise;


		const cachedIsSn = extensionContext.globalState.get<boolean>(UserInfoStore.IS_SN_STORAGE_KEY);
		expect(cachedIsSn).toBe(true);
	});

	it('should use cached sn flag on initialization', async () => {

		await extensionContext.globalState.update(UserInfoStore.IS_SN_STORAGE_KEY, true);

		const newUserInfoStore = new UserInfoStore(extensionContext, dardcorTokenService);

		expect(newUserInfoStore.isSn).toBe(true);

		await extensionContext.globalState.update(UserInfoStore.IS_SN_STORAGE_KEY, undefined);
	});
});
