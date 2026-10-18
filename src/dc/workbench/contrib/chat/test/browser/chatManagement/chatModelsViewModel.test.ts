/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IAction } from '../../../../../../base/common/actions.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IModelsControlManifest, ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelChatProvider, ILanguageModelChatSelector, ILanguageModelsGroup, ILanguageModelsService, IUserFriendlyLanguageModel, ILanguageModelProviderDescriptor } from '../../../common/languageModels.js';
import { ChatModelsViewModel, getManageModelsProviderLabel, ILanguageModelEntry, ILanguageModelProviderEntry, isLanguageModelProviderEntry, isLanguageModelGroupEntry } from '../../../browser/chatManagement/chatModelsViewModel.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { ILanguageModelsProviderGroup } from '../../../common/languageModelsConfiguration.js';
import { ChatAgentLocation } from '../../../common/constants.js';
import { languageModelSourcePresentationRegistry } from '../../../common/languageModelSourcePresentation.js';

class MockLanguageModelsService implements ILanguageModelsService {
	_serviceBrand: undefined;

	private vendors: IUserFriendlyLanguageModel[] = [];
	private models = new Map<string, ILanguageModelChatMetadata>();
	private modelsByVendor = new Map<string, string[]>();
	private modelGroups = new Map<string, ILanguageModelsGroup[]>();
	private hiddenModelIds = new Set<string>();
	readonly setModelsHiddenCalls: { readonly modelIdentifiers: readonly string[]; readonly hidden: boolean }[] = [];

	private readonly _onDidChangeLanguageModels = new Emitter<string>();
	readonly onDidChangeLanguageModels = this._onDidChangeLanguageModels.event;

	private readonly _onDidChangeLanguageModelVendors = new Emitter<readonly string[]>();
	readonly onDidChangeLanguageModelVendors = this._onDidChangeLanguageModelVendors.event;

	onDidChangeModelsControlManifest = Event.None;

	addVendor(vendor: IUserFriendlyLanguageModel): void {
		this.vendors.push(vendor);
		this.modelsByVendor.set(vendor.vendor, []);
		this.modelGroups.set(vendor.vendor, []);
	}

	addModel(vendorId: string, identifier: string, metadata: ILanguageModelChatMetadata, groupName?: string): void {
		this.models.set(identifier, metadata);
		const models = this.modelsByVendor.get(vendorId) || [];
		models.push(identifier);
		this.modelsByVendor.set(vendorId, models);

		const groups = this.modelGroups.get(vendorId) || [];
		let group = groupName ? groups.find(candidate => candidate.group?.name === groupName) : groups[0];
		if (!group) {
			group = {
				group: {
					vendor: vendorId,
					name: groupName ?? (this.vendors.find(v => v.vendor === vendorId)?.displayName || 'Default')
				},
				modelIdentifiers: []
			};
			groups.push(group);
		}
		group.modelIdentifiers.push(identifier);
		this.modelGroups.set(vendorId, groups);
	}

	registerLanguageModelProvider(vendor: string, provider: ILanguageModelChatProvider): IDisposable {
		throw new Error('Method not implemented.');
	}

	deltaLanguageModelChatProviderDescriptors(added: IUserFriendlyLanguageModel[], removed: IUserFriendlyLanguageModel[]): void {
		throw new Error('Method not implemented.');
	}

	getVendors(): ILanguageModelProviderDescriptor[] {
		return this.vendors.map(v => ({ ...v, isDefault: v.vendor === 'dardcor' }));
	}

	getLanguageModelIds(): string[] {
		return Array.from(this.models.keys());
	}

	lookupLanguageModel(identifier: string): ILanguageModelChatMetadata | undefined {
		return this.models.get(identifier);
	}

	lookupLanguageModelByQualifiedName(referenceName: string): ILanguageModelChatMetadataAndIdentifier | undefined {
		for (const [identifier, metadata] of this.models.entries()) {
			if (ILanguageModelChatMetadata.matchesQualifiedName(referenceName, metadata)) {
				return { metadata, identifier };
			}
		}
		return undefined;
	}

	getLanguageModels(): ILanguageModelChatMetadataAndIdentifier[] {
		const result: ILanguageModelChatMetadataAndIdentifier[] = [];
		for (const [identifier, metadata] of this.models.entries()) {
			result.push({ identifier, metadata });
		}
		return result;
	}

	setContributedSessionModels(): void {
	}

	clearContributedSessionModels(): void {
	}

	async selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]> {
		if (selector.vendor) {
			return this.modelsByVendor.get(selector.vendor) || [];
		}
		return Array.from(this.models.keys());
	}

	sendChatRequest(): Promise<any> {
		throw new Error('Method not implemented.');
	}

	computeTokenLength(): Promise<number> {
		throw new Error('Method not implemented.');
	}

	getModelConfiguration(_modelId: string): IStringDictionary<unknown> | undefined {
		return undefined;
	}

	async setModelConfiguration(_modelId: string, _values: IStringDictionary<unknown>): Promise<void> {
	}

	getModelConfigurationActions(_modelId: string): IAction[] {
		return [];
	}

	async configureLanguageModelsProviderGroup(vendorId: string, name?: string): Promise<void> {
	}

	async renameLanguageModelsProviderGroup(vendorId: string, providerGroupName: string): Promise<void> {
	}

	async updateLanguageModelsProviderGroupApiKey(vendorId: string, providerGroupName: string): Promise<void> {
	}

	async addLanguageModelsProviderGroupModel(vendorId: string, providerGroupName: string): Promise<void> {
	}

	async openLanguageModelsProviderGroupSettings(vendorId: string, providerGroupName: string): Promise<void> {
	}

	async configureModel(_modelId: string): Promise<void> {
	}

	async addLanguageModelsProviderGroup(name: string, vendorId: string, configuration: IStringDictionary<unknown> | undefined): Promise<void> {
	}

	getLanguageModelGroups(vendor: string): ILanguageModelsGroup[] {
		return this.modelGroups.get(vendor) || [];
	}

	hasResolvedVendor(vendor: string): boolean {
		return this.modelGroups.has(vendor);
	}

	async removeLanguageModelsProviderGroup(vendorId: string, providerGroupName: string): Promise<void> {
	}

	async migrateLanguageModelsProviderGroup(languageModelsProviderGroup: ILanguageModelsProviderGroup): Promise<void> { }

	getRecentlyUsedModelIds(): string[] { return []; }
	addToRecentlyUsedList(): void { }
	clearRecentlyUsedList(): void { }
	getPinnedModelIds(): string[] { return []; }
	pinModel(_modelIdentifier: string): void { }
	unpinModel(_modelIdentifier: string): void { }
	isModelPinned(_modelIdentifier: string): boolean { return false; }
	onDidChangePinnedModels = Event.None;
	isModelHidden(modelIdentifier: string): boolean { return this.hiddenModelIds.has(modelIdentifier); }
	isGroupHidden(_vendor: string, _groupName: string): boolean { return false; }
	setModelHidden(modelIdentifier: string, hidden: boolean): void {
		this.setModelsHidden([modelIdentifier], hidden);
	}
	setModelsHidden(modelIdentifiers: readonly string[], hidden: boolean): void {
		this.setModelsHiddenCalls.push({ modelIdentifiers: [...modelIdentifiers], hidden });
		for (const modelIdentifier of modelIdentifiers) {
			if (hidden) {
				this.hiddenModelIds.add(modelIdentifier);
			} else {
				this.hiddenModelIds.delete(modelIdentifier);
			}
		}
	}
	setGroupHidden(_vendor: string, _groupName: string, _hidden: boolean): void { }
	getHiddenModelIds(): string[] { return [...this.hiddenModelIds]; }
	onDidChangeModelVisibility = Event.None;
	getModelsControlManifest(): IModelsControlManifest { return { free: {}, paid: {} }; }
	restrictedChatParticipants = observableValue('restrictedChatParticipants', Object.create(null));
}

suite('ChatModelsViewModel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let languageModelsService: MockLanguageModelsService;
	let viewModel: ChatModelsViewModel;

	setup(async () => {
		store.add(languageModelSourcePresentationRegistry.register({
			ownerVendor: 'codex',
			sourceId: 'chatgptSubscription',
			label: 'ChatGPT',
			icon: Codicon.openai,
			description: 'Models provided by your ChatGPT subscription',
		}));
		languageModelsService = new MockLanguageModelsService();

		languageModelsService.addVendor({
			vendor: 'dardcor',
			displayName: 'Dardcor Router',
			managementCommand: undefined,
			when: undefined,
			configuration: undefined
		});

		languageModelsService.addVendor({
			vendor: 'openai',
			displayName: 'OpenAI',
			managementCommand: undefined,
			when: undefined,
			configuration: undefined
		});

		languageModelsService.addModel('dardcor', 'dardcor-gpt-4', {
			extension: new ExtensionIdentifier('github.dardcor'),
			id: 'gpt-4',
			name: 'GPT-4',
			family: 'gpt-4',
			version: '1.0',
			vendor: 'dardcor',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			capabilities: {
				toolCalling: true,
				vision: true,
				agentMode: false
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		languageModelsService.addModel('dardcor', 'dardcor-gpt-4o', {
			extension: new ExtensionIdentifier('github.dardcor'),
			id: 'gpt-4o',
			name: 'GPT-4o',
			family: 'gpt-4',
			version: '1.0',
			vendor: 'dardcor',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			capabilities: {
				toolCalling: true,
				vision: true,
				agentMode: true
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		languageModelsService.addModel('openai', 'openai-gpt-3.5', {
			extension: new ExtensionIdentifier('openai.api'),
			id: 'gpt-3.5-turbo',
			name: 'GPT-3.5 Turbo',
			family: 'gpt-3.5',
			version: '1.0',
			vendor: 'openai',
			maxInputTokens: 4096,
			maxOutputTokens: 2048,
			isUserSelectable: true,
			capabilities: {
				toolCalling: true,
				vision: false,
				agentMode: false
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		languageModelsService.addModel('openai', 'openai-gpt-4-vision', {
			extension: new ExtensionIdentifier('openai.api'),
			id: 'gpt-4-vision',
			name: 'GPT-4 Vision',
			family: 'gpt-4',
			version: '1.0',
			vendor: 'openai',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isUserSelectable: false,
			capabilities: {
				toolCalling: false,
				vision: true,
				agentMode: false
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		viewModel = store.add(new ChatModelsViewModel(languageModelsService));

		await viewModel.refresh();
	});

	test('should fetch all models without filters', () => {
		const results = viewModel.filter('');

		assert.strictEqual(results.length, 6);

		const vendors = results.filter(isLanguageModelProviderEntry);
		assert.strictEqual(vendors.length, 2);

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 4);
	});

	test('distinguishes the ChatGPT subscription from a custom group with the same name', async () => {
		const service = new MockLanguageModelsService();
		service.addVendor({ vendor: 'codex', displayName: 'Codex', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addVendor({ vendor: 'chatgpt', displayName: 'ChatGPT', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addVendor({ vendor: 'custom', displayName: 'Custom', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addModel('codex', 'codex:gpt-5.6', {
			extension: new ExtensionIdentifier('vscode.codex'),
			id: 'gpt-5.6',
			name: 'GPT-5.6',
			family: 'gpt-5.6',
			version: '1.0',
			vendor: 'codex',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			modelGroup: { id: 'chatgpt', sourceId: 'chatgptSubscription' },
		});
		service.addModel('custom', 'custom:gpt-5.6', {
			extension: new ExtensionIdentifier('example.custom'),
			id: 'gpt-5.6',
			name: 'GPT-5.6',
			family: 'gpt-5.6',
			version: '1.0',
			vendor: 'custom',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
		}, 'ChatGPT');

		const model = store.add(new ChatModelsViewModel(service));
		await model.refresh();
		const entries = model.filter('');
		const groups = entries.filter(isLanguageModelProviderEntry).map(entry => ({
			id: entry.id,
			label: entry.label,
			sourcePresentation: entry.sourcePresentation?.sourceId,
		}));
		const models = entries.filter(entry => !isLanguageModelProviderEntry(entry) && !isLanguageModelGroupEntry(entry)) as ILanguageModelEntry[];

		assert.deepStrictEqual({
			groups,
			providerLabels: models.map(entry => getManageModelsProviderLabel(entry.model)),
		}, {
			groups: [
				{ id: 'chatgpt-ChatGPT-chatgptSubscription', label: 'ChatGPT', sourcePresentation: 'chatgptSubscription' },
				{ id: 'custom-ChatGPT-configured', label: 'ChatGPT', sourcePresentation: undefined },
			],
			providerLabels: ['ChatGPT', 'ChatGPT'],
		});
	});

	test('shows the first-party ChatGPT subscription header even when it is the only group', async () => {
		const service = new MockLanguageModelsService();
		service.addVendor({ vendor: 'codex', displayName: 'Codex', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addVendor({ vendor: 'chatgpt', displayName: 'ChatGPT', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addModel('codex', 'codex:gpt-5.6', {
			extension: new ExtensionIdentifier('vscode.codex'),
			id: 'gpt-5.6',
			name: 'GPT-5.6',
			family: 'gpt-5.6',
			version: '1.0',
			vendor: 'codex',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			modelGroup: { id: 'chatgpt', sourceId: 'chatgptSubscription' },
		});

		const model = store.add(new ChatModelsViewModel(service));
		await model.refresh();

		assert.deepStrictEqual(model.filter('').map(entry => ({
			type: entry.type,
			label: isLanguageModelProviderEntry(entry) ? entry.label : undefined,
			sourcePresentation: isLanguageModelProviderEntry(entry) ? entry.sourcePresentation?.sourceId : undefined,
		})), [
			{ type: 'vendor', label: 'ChatGPT', sourcePresentation: 'chatgptSubscription' },
			{ type: 'model', label: undefined, sourcePresentation: undefined },
		]);
	});

	test('trusted source presentations are scoped to their owner vendor', async () => {
		const service = new MockLanguageModelsService();
		service.addVendor({ vendor: 'other', displayName: 'Other', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addModel('other', 'other:gpt-5.6', {
			extension: new ExtensionIdentifier('example.other'),
			id: 'gpt-5.6',
			name: 'GPT-5.6',
			family: 'gpt-5.6',
			version: '1.0',
			vendor: 'other',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			modelGroup: { id: 'chatgpt', sourceId: 'chatgptSubscription' },
		});

		const model = store.add(new ChatModelsViewModel(service));
		await model.refresh();
		const entry = model.filter('').find(candidate => !isLanguageModelProviderEntry(candidate) && !isLanguageModelGroupEntry(candidate)) as ILanguageModelEntry;
		assert.strictEqual(entry.model.provider.group.name, 'Chatgpt');
		assert.strictEqual(entry.model.provider.sourcePresentation, undefined);
	});

	test('group visibility toggles only the exact models rendered in that source group', async () => {
		const service = new MockLanguageModelsService();
		service.addVendor({ vendor: 'codex', displayName: 'Codex', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addVendor({ vendor: 'custom', displayName: 'Custom', managementCommand: undefined, when: undefined, configuration: undefined });
		const metadata = {
			extension: new ExtensionIdentifier('vscode.codex'),
			id: 'gpt-5.6',
			name: 'GPT-5.6',
			family: 'gpt-5.6',
			version: '1.0',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
		};
		service.addModel('codex', 'codex:gpt-5.6', { ...metadata, vendor: 'codex', modelGroup: { id: 'chatgpt', sourceId: 'chatgptSubscription' } });
		service.addModel('custom', 'custom:gpt-5.6', { ...metadata, extension: new ExtensionIdentifier('example.custom'), vendor: 'custom' }, 'ChatGPT');

		const model = store.add(new ChatModelsViewModel(service));
		await model.refresh();
		const subscriptionGroup = model.filter('').find(entry => isLanguageModelProviderEntry(entry) && entry.sourcePresentation !== undefined);
		assert.ok(subscriptionGroup && isLanguageModelProviderEntry(subscriptionGroup));

		model.toggleGroupHidden(subscriptionGroup);
		assert.deepStrictEqual({
			hiddenModelIds: service.getHiddenModelIds(),
			setModelsHiddenCalls: service.setModelsHiddenCalls,
		}, {
			hiddenModelIds: ['codex:gpt-5.6'],
			setModelsHiddenCalls: [{ modelIdentifiers: ['codex:gpt-5.6'], hidden: true }],
		});
	});

	test('the default provider Auto model is never listed, so a group toggle cannot hide it', async () => {
		const service = new MockLanguageModelsService();
		service.addVendor({ vendor: 'dardcor', displayName: 'Dardcor Router', managementCommand: undefined, when: undefined, configuration: undefined });
		service.addVendor({ vendor: 'dardcorcli', displayName: 'Dardcor CLI', managementCommand: undefined, when: undefined, configuration: undefined });
		const metadata = {
			extension: new ExtensionIdentifier('github.dardcor'),
			name: 'Auto',
			family: 'auto',
			version: '1.0',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
		};
		service.addModel('dardcor', 'dardcor/auto', { ...metadata, id: 'auto', vendor: 'dardcor' });
		service.addModel('dardcor', 'dardcor/gpt-5', { ...metadata, id: 'gpt-5', name: 'GPT-5', family: 'gpt-5', vendor: 'dardcor' });
		service.addModel('dardcorcli', 'dardcorcli/auto', { ...metadata, id: 'auto', vendor: 'dardcorcli' });

		const model = store.add(new ChatModelsViewModel(service));
		await model.refresh();
		const dardcorGroup = model.filter('').find(entry => isLanguageModelProviderEntry(entry) && entry.vendorEntry.vendor.vendor === 'dardcor');
		assert.ok(dardcorGroup && isLanguageModelProviderEntry(dardcorGroup));

		model.toggleGroupHidden(dardcorGroup);

		assert.deepStrictEqual({
			renderedModelIds: model.filter('').filter(entry => entry.type === 'model').map(entry => entry.model.identifier),
			setModelsHiddenCalls: service.setModelsHiddenCalls,
		}, {
			renderedModelIds: ['dardcor/gpt-5', 'dardcorcli/auto'],
			setModelsHiddenCalls: [{ modelIdentifiers: ['dardcor/gpt-5'], hidden: true }],
		});
	});

	test('should filter by provider name (vendor ID and display name)', () => {
		const resultsByDardcorId = viewModel.filter('@provider:dardcor');
		assert.strictEqual(resultsByDardcorId.length, 3);
		assert.strictEqual(resultsByDardcorId[0].type, 'vendor');
		assert.strictEqual(resultsByDardcorId[0].vendorEntry.vendor.vendor, 'dardcor');
		assert.strictEqual(resultsByDardcorId[1].type, 'model');
		assert.strictEqual(resultsByDardcorId[1].model.identifier, 'dardcor-gpt-4');
		assert.strictEqual(resultsByDardcorId[2].type, 'model');
		assert.strictEqual(resultsByDardcorId[2].model.identifier, 'dardcor-gpt-4o');

		const resultsByOpenAIName = viewModel.filter('@provider:OpenAI');
		assert.strictEqual(resultsByOpenAIName.length, 3);
		assert.strictEqual(resultsByOpenAIName[0].type, 'vendor');
		assert.strictEqual(resultsByOpenAIName[0].vendorEntry.vendor.vendor, 'openai');
		assert.strictEqual(resultsByOpenAIName[1].type, 'model');
		assert.strictEqual(resultsByOpenAIName[1].model.identifier, 'openai-gpt-3.5');
		assert.strictEqual(resultsByOpenAIName[2].type, 'model');
		assert.strictEqual(resultsByOpenAIName[2].model.identifier, 'openai-gpt-4-vision');
	});

	test('should filter by multiple providers with OR logic', () => {
		const results = viewModel.filter('@provider:dardcor @provider:openai');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 4);
	});

	test('should filter by single capability - tools', () => {
		const results = viewModel.filter('@capability:tools');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 3);
		assert.ok(models.every(m => m.model.metadata.capabilities?.toolCalling === true));
	});

	test('should filter by single capability - vision', () => {
		const results = viewModel.filter('@capability:vision');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 3);
		assert.ok(models.every(m => m.model.metadata.capabilities?.vision === true));
	});

	test('should filter by single capability - agent', () => {
		const results = viewModel.filter('@capability:agent');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].model.metadata.id, 'gpt-4o');
	});

	test('should filter by multiple capabilities with AND logic', () => {
		const results = viewModel.filter('@capability:tools @capability:vision');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 2);
		assert.ok(models.every(m =>
			m.model.metadata.capabilities?.toolCalling === true &&
			m.model.metadata.capabilities?.vision === true
		));
	});

	test('should filter by three capabilities with AND logic', () => {
		const results = viewModel.filter('@capability:tools @capability:vision @capability:agent');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].model.metadata.id, 'gpt-4o');
	});

	test('should return no results when filtering by incompatible capabilities', () => {
		const results = viewModel.filter('@capability:vision @capability:agent');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].model.metadata.id, 'gpt-4o');
	});

	test('should combine provider and capability filters', () => {
		const results = viewModel.filter('@provider:dardcor @capability:vision');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 2);
		assert.ok(models.every(m =>
			m.model.provider.vendor.vendor === 'dardcor' &&
			m.model.metadata.capabilities?.vision === true
		));
	});

	test('should filter by text matching model name', () => {
		const results = viewModel.filter('GPT-4o');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].model.metadata.name, 'GPT-4o');
		assert.ok(models[0].modelNameMatches);
	});

	test('should filter by text matching model id', () => {
		const results = viewModel.filter('gpt-4o');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].model.identifier, 'dardcor-gpt-4o');
		assert.ok(models[0].modelIdMatches);
	});

	test('should filter by text matching vendor name', () => {
		const results = viewModel.filter('GitHub');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 2);
		assert.ok(models.every(m => m.model.provider.group.name === 'Dardcor Router'));
	});

	test('should combine text search with capability filter', () => {
		const results = viewModel.filter('@capability:tools GPT');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 3);
		assert.ok(models.every(m => m.model.metadata.capabilities?.toolCalling === true));
	});

	test('should handle empty search value', () => {
		const results = viewModel.filter('');

		assert.ok(results.length > 0);
	});

	test('should handle search value with only whitespace', () => {
		const results = viewModel.filter('   ');

		assert.ok(results.length > 0);
	});

	test('should match capability text in free text search', () => {
		const results = viewModel.filter('vision');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.ok(models.length > 0);
		assert.ok(models.every(m =>
			m.model.metadata.capabilities?.vision === true ||
			m.model.metadata.name.toLowerCase().includes('vision')
		));
	});

	test('should toggle vendor collapsed state', () => {
		const vendorEntry = viewModel.viewModelEntries.find(r => isLanguageModelProviderEntry(r) && r.vendorEntry.vendor.vendor === 'dardcor') as ILanguageModelProviderEntry;
		viewModel.toggleCollapsed(vendorEntry);

		const results = viewModel.filter('');
		const dardcorVendor = results.find(r => isLanguageModelProviderEntry(r) && (r as ILanguageModelProviderEntry).vendorEntry.vendor.vendor === 'dardcor') as ILanguageModelProviderEntry;
		assert.ok(dardcorVendor);
		assert.strictEqual(dardcorVendor.collapsed, true);

		const dardcorModelsAfterCollapse = results.filter(r =>
			!isLanguageModelProviderEntry(r) && (r as ILanguageModelEntry).model.provider.vendor.vendor === 'dardcor'
		);
		assert.strictEqual(dardcorModelsAfterCollapse.length, 0);

		viewModel.toggleCollapsed(vendorEntry);
		const resultsAfterExpand = viewModel.filter('');
		const dardcorModelsAfterExpand = resultsAfterExpand.filter(r =>
			!isLanguageModelProviderEntry(r) && (r as ILanguageModelEntry).model.provider.vendor.vendor === 'dardcor'
		);
		assert.strictEqual(dardcorModelsAfterExpand.length, 2);
	});

	test('should handle quoted search strings', () => {
		const results = viewModel.filter('"GPT"');

		assert.ok(Array.isArray(results));
	});

	test('should remove filter keywords from text search', () => {
		const results = viewModel.filter('@provider:dardcor @capability:vision GPT');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 2);
		assert.ok(models.every(m => m.model.provider.vendor.vendor === 'dardcor'));
	});

	test('should handle case-insensitive capability matching', () => {
		const results1 = viewModel.filter('@capability:TOOLS');
		const results2 = viewModel.filter('@capability:tools');
		const results3 = viewModel.filter('@capability:Tools');

		const models1 = results1.filter(r => !isLanguageModelProviderEntry(r));
		const models2 = results2.filter(r => !isLanguageModelProviderEntry(r));
		const models3 = results3.filter(r => !isLanguageModelProviderEntry(r));

		assert.strictEqual(models1.length, models2.length);
		assert.strictEqual(models2.length, models3.length);
	});

	test('should support toolcalling alias for tools capability', () => {
		const resultsTools = viewModel.filter('@capability:tools');
		const resultsToolCalling = viewModel.filter('@capability:toolcalling');

		const modelsTools = resultsTools.filter(r => !isLanguageModelProviderEntry(r));
		const modelsToolCalling = resultsToolCalling.filter(r => !isLanguageModelProviderEntry(r));

		assert.strictEqual(modelsTools.length, modelsToolCalling.length);
	});

	test('should support agentmode alias for agent capability', () => {
		const resultsAgent = viewModel.filter('@capability:agent');
		const resultsAgentMode = viewModel.filter('@capability:agentmode');

		const modelsAgent = resultsAgent.filter(r => !isLanguageModelProviderEntry(r));
		const modelsAgentMode = resultsAgentMode.filter(r => !isLanguageModelProviderEntry(r));

		assert.strictEqual(modelsAgent.length, modelsAgentMode.length);
	});

	test('should include matched capabilities in results', () => {
		const results = viewModel.filter('@capability:tools @capability:vision');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.ok(models.length > 0);

		for (const model of models) {
			assert.ok(model.capabilityMatches);
			assert.ok(model.capabilityMatches.length > 0);
			assert.ok(model.capabilityMatches.some(c => c === 'toolCalling' || c === 'vision'));
		}
	});

	function createSingleVendorViewModel(includeSecondModel: boolean = true): { service: MockLanguageModelsService; viewModel: ChatModelsViewModel } {
		const service = new MockLanguageModelsService();
		service.addVendor({
			vendor: 'dardcor',
			displayName: 'Dardcor Router',
			managementCommand: undefined,
			when: undefined,
			configuration: undefined
		});

		service.addModel('dardcor', 'dardcor-gpt-4', {
			extension: new ExtensionIdentifier('github.dardcor'),
			id: 'gpt-4',
			name: 'GPT-4',
			family: 'gpt-4',
			version: '1.0',
			vendor: 'dardcor',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			capabilities: {
				toolCalling: true,
				vision: true,
				agentMode: false
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		if (includeSecondModel) {
			service.addModel('dardcor', 'dardcor-gpt-4o', {
				extension: new ExtensionIdentifier('github.dardcor'),
				id: 'gpt-4o',
				name: 'GPT-4o',
				family: 'gpt-4',
				version: '1.0',
				vendor: 'dardcor',
				maxInputTokens: 8192,
				maxOutputTokens: 4096,
				isUserSelectable: true,
				capabilities: {
					toolCalling: true,
					vision: true,
					agentMode: true
				},
				isDefaultForLocation: {
					[ChatAgentLocation.Chat]: true
				}
			});
		}

		const viewModel = store.add(new ChatModelsViewModel(service));
		return { service, viewModel };
	}

	test('should not show vendor header when only one vendor exists', async () => {
		const { viewModel: singleVendorViewModel } = createSingleVendorViewModel();
		await singleVendorViewModel.refresh();

		const results = singleVendorViewModel.filter('');

		const vendors = results.filter(isLanguageModelProviderEntry);
		assert.strictEqual(vendors.length, 0, 'Should not show vendor header when only one vendor exists');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 2, 'Should show all models');
		assert.ok(models.every(m => m.model.provider.vendor.vendor === 'dardcor'));
	});

	test('should show vendor headers when multiple vendors exist', () => {
		const results = viewModel.filter('');

		const vendors = results.filter(isLanguageModelProviderEntry);
		assert.strictEqual(vendors.length, 2, 'Should show vendor headers when multiple vendors exist');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 4);
	});

	test('should filter single vendor models by capability', async () => {
		const { viewModel: singleVendorViewModel } = createSingleVendorViewModel();
		await singleVendorViewModel.refresh();

		const results = singleVendorViewModel.filter('@capability:agent');

		const vendors = results.filter(isLanguageModelProviderEntry);
		assert.strictEqual(vendors.length, 0, 'Should not show vendor header');

		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 1);
		assert.strictEqual(models[0].model.metadata.id, 'gpt-4o');
	});

	test('should always place dardcor vendor at the top when multiple vendors exist', async () => {
		let results = viewModel.filter('');
		let vendors = results.filter(isLanguageModelProviderEntry) as ILanguageModelProviderEntry[];
		assert.strictEqual(vendors[0].vendorEntry.vendor.vendor, 'dardcor');

		languageModelsService.addVendor({
			vendor: 'anthropic',
			displayName: 'Anthropic',
			managementCommand: undefined,
			when: undefined,
			configuration: undefined
		});

		languageModelsService.addModel('anthropic', 'anthropic-claude', {
			extension: new ExtensionIdentifier('anthropic.api'),
			id: 'claude-3',
			name: 'Claude 3',
			family: 'claude',
			version: '1.0',
			vendor: 'anthropic',
			maxInputTokens: 100000,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			capabilities: {
				toolCalling: true,
				vision: false,
				agentMode: false
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		languageModelsService.addVendor({
			vendor: 'azure',
			displayName: 'Azure OpenAI',
			managementCommand: undefined,
			when: undefined,
			configuration: undefined
		});

		languageModelsService.addModel('azure', 'azure-gpt-4', {
			extension: new ExtensionIdentifier('microsoft.azure'),
			id: 'azure-gpt-4',
			name: 'Azure GPT-4',
			family: 'gpt-4',
			version: '1.0',
			vendor: 'azure',
			maxInputTokens: 8192,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			capabilities: {
				toolCalling: true,
				vision: false,
				agentMode: false
			},
			isDefaultForLocation: {
				[ChatAgentLocation.Chat]: true
			}
		});

		await viewModel.refresh();

		results = viewModel.filter('');
		vendors = results.filter(isLanguageModelProviderEntry) as ILanguageModelProviderEntry[];
		assert.strictEqual(vendors.length, 4);
		assert.strictEqual(vendors[0].vendorEntry.vendor.vendor, 'dardcor');
		assert.strictEqual(vendors[1].vendorEntry.vendor.vendor, 'anthropic');
		assert.strictEqual(vendors[2].vendorEntry.vendor.vendor, 'azure');
		assert.strictEqual(vendors[3].vendorEntry.vendor.vendor, 'openai');

		results = viewModel.filter('GPT');
		vendors = results.filter(isLanguageModelProviderEntry) as ILanguageModelProviderEntry[];
		if (vendors.length > 1) {
			assert.strictEqual(vendors[0].vendorEntry.vendor.vendor, 'dardcor');
		}

		results = viewModel.filter('@capability:tools');
		vendors = results.filter(isLanguageModelProviderEntry) as ILanguageModelProviderEntry[];
		if (vendors.length > 1) {
			assert.strictEqual(vendors[0].vendorEntry.vendor.vendor, 'dardcor');
		}
	});

	test('should show vendor headers when filtered', () => {
		const results = viewModel.filter('GPT');
		const vendors = results.filter(isLanguageModelProviderEntry);
		assert.ok(vendors.length > 0);
	});

	test('should not show vendor headers when filtered if only one vendor exists', async () => {
		const { viewModel: singleVendorViewModel } = createSingleVendorViewModel();
		await singleVendorViewModel.refresh();

		const results = singleVendorViewModel.filter('GPT');
		const vendors = results.filter(isLanguageModelProviderEntry);
		assert.strictEqual(vendors.length, 0);
	});

	test('should get configured vendors', () => {
		const vendors = viewModel.getConfiguredVendors();
		assert.ok(vendors.length > 0);
		assert.ok(vendors.some(v => v.vendor.vendor === 'dardcor'));
		assert.ok(vendors.some(v => v.vendor.vendor === 'openai'));
	});

	test('should return true for shouldRefilter when models not sorted', () => {
		viewModel.filter('');
		assert.strictEqual(viewModel.shouldRefilter(), false);

		const result = viewModel.shouldRefilter();
		assert.strictEqual(typeof result, 'boolean');
	});

	test('should collapse all groups and models', () => {
		const results1 = viewModel.filter('');
		let models = results1.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.ok(models.length > 0);

		viewModel.collapseAll();

		const results2 = viewModel.filter('');
		const vendors = results2.filter(isLanguageModelProviderEntry);
		models = results2.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];

		assert.ok(vendors.length > 0, 'Should have vendor headers');
		assert.strictEqual(models.length, 0, 'Should have no models visible after collapse all');
	});

	test('should match quoted search strings with filters', () => {
		const results = viewModel.filter('@capability:tools "GPT"');
		assert.ok(Array.isArray(results));
	});

	test('should filter by case-insensitive provider name', () => {
		const results1 = viewModel.filter('@provider:COPILOT');
		const results2 = viewModel.filter('@provider:dardcor');
		const results3 = viewModel.filter('@provider:CopiloT');

		const models1 = results1.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		const models2 = results2.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		const models3 = results3.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];

		assert.strictEqual(models1.length, models2.length);
		assert.strictEqual(models2.length, models3.length);
		assert.strictEqual(models1.length, 2);
	});

	test('should handle empty search returning all results', () => {
		const results = viewModel.filter('');
		assert.ok(results.length > 0);

		const vendors = results.filter(isLanguageModelProviderEntry);
		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];

		assert.strictEqual(vendors.length, 2);
		assert.strictEqual(models.length, 4);
	});

	test('should not find matches when searching for non-existent model', () => {
		const results = viewModel.filter('NonExistentModel123');
		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 0);
	});

	test('should not find matches when filtering by non-existent provider', () => {
		const results = viewModel.filter('@provider:nonexistent');
		const models = results.filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.strictEqual(models.length, 0);
	});

	test('should filter out agent-host BYOK model copies but keep native agent-host models', async () => {
		const service = new MockLanguageModelsService();
		service.addVendor({ vendor: 'agent-host-dardcorcli', displayName: 'Dardcor', managementCommand: undefined, when: undefined, configuration: undefined });

		service.addModel('agent-host-dardcorcli', 'agent-host-dardcorcli:claude-haiku-4.5', {
			extension: new ExtensionIdentifier('vscode.chat'),
			id: 'claude-haiku-4.5',
			name: 'Claude Haiku 4.5',
			family: 'claude-haiku-4.5',
			version: '1.0',
			vendor: 'agent-host-dardcorcli',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			targetChatSessionType: 'agent-host-dardcorcli',
			modelGroup: { id: 'dardcorcli' },
			capabilities: { toolCalling: true, vision: false, agentMode: true },
			isDefaultForLocation: {},
		});

		service.addModel('agent-host-dardcorcli', 'agent-host-dardcorcli:openrouter/aion-labs/aion-3.0', {
			extension: new ExtensionIdentifier('vscode.chat'),
			id: 'openrouter/aion-labs/aion-3.0',
			name: 'AionLabs: Aion-3.0',
			family: 'openrouter/aion-labs/aion-3.0',
			version: '1.0',
			vendor: 'agent-host-dardcorcli',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isUserSelectable: true,
			targetChatSessionType: 'agent-host-dardcorcli',
			modelGroup: { id: 'openrouter' },
			byokModelIdentifier: 'openrouter/OpenRouter 2/aion-labs/aion-3.0',
			capabilities: { toolCalling: true, vision: false, agentMode: true },
			isDefaultForLocation: {},
		});

		const agentHostViewModel = store.add(new ChatModelsViewModel(service));
		await agentHostViewModel.refresh();

		const models = agentHostViewModel.filter('').filter(r => !isLanguageModelProviderEntry(r) && !isLanguageModelGroupEntry(r)) as ILanguageModelEntry[];
		assert.deepStrictEqual(models.map(m => m.model.metadata.id), ['claude-haiku-4.5']);
	});

});
