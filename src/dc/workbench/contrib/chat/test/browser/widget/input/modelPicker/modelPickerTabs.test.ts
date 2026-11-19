/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IStringDictionary } from '../../../../../../../../base/common/collections.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../../base/test/common/utils.js';
import { IModelConfigurationAccess, getModelConfigProperty, getModelConfigSummary, isExtendedContext, MODEL_CONFIG_GROUP_CONTEXT } from '../../../../../browser/widget/input/modelPicker/modelPickerModelConfig.js';
import { getModelBadge } from '../../../../../browser/widget/input/modelPicker/modelPickerBadges.js';
import { latestOfEachLine, parseModelLine } from '../../../../../browser/widget/input/modelPicker/modelPickerLineage.js';
import { buildSpeedVariants, collapseSpeedVariants } from '../../../../../browser/widget/input/modelPicker/modelPickerVariants.js';
import { buildModelPickerDestinations, buildModelPickerSections, hasPromotedModels, IModelPickerProviderPlaceholder } from '../../../../../browser/widget/input/modelPicker/modelPickerTabs.js';
import { getProviderGroupKey } from '../../../../../browser/widget/input/modelPicker/modelPickerItemPrimitives.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService, IModelControlEntry } from '../../../../../common/languageModels.js';

interface IFixtureModelOptions {
	readonly vendor?: string;
	readonly isBYOK?: boolean;
	readonly byokModelIdentifier?: string;
	readonly modelGroupId?: string;
}

function createModel(id: string, name: string, options: IFixtureModelOptions = {}): ILanguageModelChatMetadataAndIdentifier {
	const vendor = options.vendor ?? 'dardcor';
	return {
		identifier: `${vendor}/${id}`,
		metadata: {
			id,
			name,
			vendor,
			version: '1.0',
			family: id,
			isBYOK: options.isBYOK,
			byokModelIdentifier: options.byokModelIdentifier,
			modelGroup: options.modelGroupId ? { id: options.modelGroupId } : undefined,
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
		} as ILanguageModelChatMetadata,
	};
}

function createConfigurableModel(): ILanguageModelChatMetadataAndIdentifier {
	const model = createModel('gpt-5-5', 'GPT-5.5');
	return {
		...model,
		metadata: {
			...model.metadata,
			configurationSchema: {
				properties: {
					reasoningEffort: {
						type: 'string',
						group: 'navigation',
						enum: ['low', 'medium', 'xhigh'],
						enumItemLabels: ['Low', 'Medium', 'Extra high'],
						default: 'medium',
					},
					contextSize: {
						type: 'number',
						group: 'tokens',
						enum: [264000, 1000000],
						enumItemLabels: ['264K', '1M'],
						default: 264000,
					},
				},
			},
		},
	};
}

function createLanguageModelsService(): ILanguageModelsService {
	return {
		getVendors: () => [
			{ vendor: 'dardcor', displayName: 'Dardcor Router', isDefault: true },
			{ vendor: 'ollama', displayName: 'Ollama', isDefault: false },
			{ vendor: 'openai', displayName: 'OpenAI', isDefault: false },
		],
		getLanguageModelGroups: () => [],
	} as unknown as ILanguageModelsService;
}

function createConfigurationAccess(values: IStringDictionary<unknown> = {}): IModelConfigurationAccess {
	return {
		getModelConfiguration: () => values,
		setModelConfiguration: async () => { },
		getModelConfigurationActions: () => [],
	};
}

suite('Model picker destinations', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const service = createLanguageModelsService();
	const auto = createModel('auto', 'Auto');
	const gpt = createModel('gpt-5-5', 'GPT-5.5');
	const claude = createModel('claude-sonnet-5', 'Claude Sonnet 5');
	const gemini = createModel('gemini-3-1-pro', 'Gemini 3.1 Pro');
	const llama = createModel('llama-3', 'Llama 3', { vendor: 'ollama', isBYOK: true });
	const mistral = createModel('mistral', 'Mistral Large', { vendor: 'openai', isBYOK: true });

	const summarize = (models: readonly ILanguageModelChatMetadataAndIdentifier[], placeholders: readonly IModelPickerProviderPlaceholder[] = []) =>
		buildModelPickerDestinations(models, service, placeholders)
			.map(destination => ({ id: destination.id, label: destination.label, models: destination.models.map(model => model.metadata.name) }));

	const providerId = (vendor: string, label: string) => `provider:${getProviderGroupKey(vendor, label)}`;

	test('a host that relays the built-in provider keeps its models built in', () => {
		const relayed = createModel('gpt-5-5', 'GPT-5.5', {
			vendor: 'agent-host-dardcorcli',
			isBYOK: true,
			byokModelIdentifier: 'dardcor/gpt-5-5',
			modelGroupId: 'dardcor',
		});
		const relayedNative = createModel('cli-model', 'CLI Model', {
			vendor: 'agent-host-dardcorcli',
			isBYOK: true,
			modelGroupId: 'dardcorcli',
		});
		const relayedByok = createModel('llama-3', 'Llama 3', {
			vendor: 'agent-host-dardcorcli',
			isBYOK: true,
			modelGroupId: 'ollama',
		});
		assert.deepStrictEqual(
			summarize([relayed, relayedNative, relayedByok]),
			[
				{ id: 'builtIn', label: 'Dardcor Router', models: ['GPT-5.5', 'CLI Model'] },
				{ id: providerId('agent-host-dardcorcli', 'Ollama'), label: 'Ollama', models: ['Llama 3'] },
			],
		);
	});

	test('a plan that grants only Auto still opens on the built-in destination', () => {
		assert.deepStrictEqual(
			summarize([auto]),
			[{ id: 'builtIn', label: 'Dardcor Router', models: [] }],
		);
	});

	test('models from only the built-in provider yield a single destination', () => {
		assert.deepStrictEqual(
			summarize([auto, gpt, claude]),
			[{ id: 'builtIn', label: 'Dardcor Router', models: ['GPT-5.5', 'Claude Sonnet 5'] }],
		);
	});

	test('a provider the user added gets its own destination', () => {
		assert.deepStrictEqual(
			summarize([gpt, llama]),
			[
				{ id: 'builtIn', label: 'Dardcor Router', models: ['GPT-5.5'] },
				{ id: providerId('ollama', 'Ollama'), label: 'Ollama', models: ['Llama 3'] },
			],
		);
	});

	test('every provider the user added gets a destination, in name order', () => {
		assert.deepStrictEqual(
			summarize([gpt, mistral, llama]),
			[
				{ id: 'builtIn', label: 'Dardcor Router', models: ['GPT-5.5'] },
				{ id: providerId('ollama', 'Ollama'), label: 'Ollama', models: ['Llama 3'] },
				{ id: providerId('openai', 'OpenAI'), label: 'OpenAI', models: ['Mistral Large'] },
			],
		);
	});

	test('two providers sharing a display name each keep their own tab', () => {
		const sameName = createModel('local-1', 'Local One', { vendor: 'ollama', isBYOK: true });
		const alsoSameName = createModel('local-2', 'Local Two', { vendor: 'openai', isBYOK: true });
		const service = {
			getVendors: () => [
				{ vendor: 'dardcor', displayName: 'Dardcor Router', isDefault: true },
				{ vendor: 'ollama', displayName: 'Local Models', isDefault: false },
				{ vendor: 'openai', displayName: 'Local Models', isDefault: false },
			],
			getLanguageModelGroups: () => [],
		} as unknown as ILanguageModelsService;

		assert.deepStrictEqual(
			buildModelPickerDestinations([sameName, alsoSameName], service)
				.map(destination => ({ id: destination.id, label: destination.label, models: destination.models.map(model => model.metadata.name) })),
			[
				{ id: providerId('ollama', 'Local Models'), label: 'Local Models', models: ['Local One'] },
				{ id: providerId('openai', 'Local Models'), label: 'Local Models', models: ['Local Two'] },
			],
		);
	});

	test('a provider waiting on sign-in gets its own destination with no models', () => {
		assert.deepStrictEqual(
			summarize([gpt], [{ vendor: 'ollama', label: 'Ollama', message: 'Sign in to see available models.' }]),
			[
				{ id: 'builtIn', label: 'Dardcor Router', models: ['GPT-5.5'] },
				{ id: providerId('ollama', 'Ollama'), label: 'Ollama', models: [] },
			],
		);
	});

	test('the built-in provider waiting on sign-in still gets its destination', () => {
		assert.deepStrictEqual(
			summarize([], [{ vendor: 'dardcor', label: 'Dardcor Router', message: 'Sign in to see available models.' }]),
			[{ id: 'builtIn', label: 'Dardcor Router', models: [] }],
		);
	});

	test('sections place each model once, with the selected model in the shortlist', () => {
		const controlModels: IStringDictionary<IModelControlEntry> = {
			'gemini-3-1-pro': { label: 'Gemini 3.1 Pro', featured: true, exists: true },
		};
		const sections = buildModelPickerSections({
			models: [gpt, claude, gemini],
			selectedModelId: 'dardcor/gpt-5-5',
			recentModelIds: ['dardcor/gemini-3-1-pro'],
			pinnedModelIds: ['dardcor/claude-sonnet-5'],
			controlModels,
			showSuggested: true,
		});
		assert.deepStrictEqual(
			{
				pinned: sections.pinned.map(model => model.metadata.name),
				suggested: sections.suggested.map(model => model.metadata.name),
				other: sections.other,
			},
			{
				pinned: ['Claude Sonnet 5'],
				suggested: ['Gemini 3.1 Pro', 'GPT-5.5'],
				other: [],
			},
		);
	});

	test('a model superseded within its line falls through to the rest', () => {
		const sections = buildModelPickerSections({
			models: [createModel('example-5.5', 'Example 5.5'), createModel('example-5.6', 'Example 5.6'), claude],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: {},
			showSuggested: true,
		});
		assert.deepStrictEqual(
			{
				suggested: sections.suggested.map(model => model.metadata.name),
				other: sections.other.map(model => model.metadata.name),
				promoted: hasPromotedModels(sections),
			},
			{ suggested: ['Claude Sonnet 5', 'Example 5.6'], other: ['Example 5.5'], promoted: true },
		);
	});

	test('a retiring model sinks below the models that are staying', () => {
		const base = createModel('alpha', 'Alpha');
		const alpha = { ...base, metadata: { ...base.metadata, warningText: { model_pending_deprecation: 'Retiring soon.' } } };
		const sections = buildModelPickerSections({
			models: [alpha, claude, gemini],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: {
				'alpha': { label: 'Alpha', exists: true, demoted: true },
				'claude-sonnet-5': { label: 'Claude Sonnet 5', exists: true, demoted: true },
				'gemini-3-1-pro': { label: 'Gemini 3.1 Pro', exists: true, demoted: true },
			},
			showSuggested: true,
		});
		assert.deepStrictEqual(
			sections.other.map(model => model.metadata.name),
			['Claude Sonnet 5', 'Gemini 3.1 Pro', 'Alpha'],
		);
	});

	test('the built-in destination is the only one that recommends models', () => {
		const sections = buildModelPickerSections({
			models: [llama],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: { 'llama-3': { label: 'Llama 3', featured: true, exists: true } },
			showSuggested: false,
		});
		assert.deepStrictEqual(
			{ suggested: sections.suggested.length, other: sections.other.map(model => model.metadata.name) },
			{ suggested: 0, other: ['Llama 3'] },
		);
	});

	test('a destination with no shortlist puts every model in the list', () => {
		const sections = buildModelPickerSections({
			models: [llama, mistral],
			selectedModelId: 'ollama/llama-3',
			recentModelIds: ['openai/mistral'],
			pinnedModelIds: [],
			controlModels: {},
			showSuggested: false,
		});
		assert.deepStrictEqual(
			{
				suggested: sections.suggested.length,
				other: sections.other.map(model => model.metadata.name),
			},
			{ suggested: 0, other: ['Llama 3', 'Mistral Large'] },
		);
	});

	test('a model id splits into the line it belongs to and its version', () => {
		assert.deepStrictEqual(
			['example-5.5', 'example-5.6-sol', 'example-1.1-lite', 'example-opus-5', 'example-prime']
				.map(id => ({ id, ...parseModelLine(id) })),
			[
				{ id: 'example-5.5', line: 'example', version: [5, 5] },
				{ id: 'example-5.6-sol', line: 'example-sol', version: [5, 6] },
				{ id: 'example-1.1-lite', line: 'example-lite', version: [1, 1] },
				{ id: 'example-opus-5', line: 'example-opus', version: [5] },
				{ id: 'example-prime', line: 'example-prime', version: [] },
			],
		);
	});

	test('the shortlist is the newest of each line, so a launch needs no list edit', () => {
		const line = (id: string, vendor = 'dardcor') => createModel(id, id, { vendor });
		const shortlist = (models: readonly ILanguageModelChatMetadataAndIdentifier[]) =>
			latestOfEachLine(models).map(model => model.metadata.id).sort();

		const catalogue = [line('example-5.6-sol'), line('example-opus-4.8'), line('example-opus-5')];
		assert.deepStrictEqual(
			{
				today: shortlist(catalogue),
				afterLaunch: shortlist([...catalogue, line('example-5.7-sol'), line('example-6-vega')]),
				acrossLines: shortlist([line('example-5.5'), line('example-5.6-sol')]),
				perVendor: shortlist([line('example-5.4-mini'), line('example-5-mini', 'azure')]),
			},
			{
				today: ['example-5.6-sol', 'example-opus-5'],
				afterLaunch: ['example-5.7-sol', 'example-6-vega', 'example-opus-5'],
				acrossLines: ['example-5.5', 'example-5.6-sol'],
				perVendor: ['example-5-mini', 'example-5.4-mini'],
			},
		);
	});

	test('a line replaced by a different line is demoted by name, and promos still lead', () => {
		const sol = createModel('example-5.6-sol', 'Example 5.6 Sol');
		const codex = createModel('example-5.3-codex', 'Example 5.3 Codex');
		const promoCodex = { ...codex, metadata: { ...codex.metadata, promo: { id: 'p', discountPercent: 25, message: 'Save now.' } } };
		const sections = (codexModel: ILanguageModelChatMetadataAndIdentifier) => buildModelPickerSections({
			models: [sol, codexModel],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: { 'example-5.3-codex': { label: 'Example 5.3 Codex', exists: true, demoted: true } },
			showSuggested: true,
		});
		assert.deepStrictEqual(
			{
				demoted: {
					suggested: sections(codex).suggested.map(model => model.metadata.id),
					other: sections(codex).other.map(model => model.metadata.id),
				},
				withPromo: sections(promoCodex).suggested.map(model => model.metadata.id),
			},
			{
				demoted: { suggested: ['example-5.6-sol'], other: ['example-5.3-codex'] },
				withPromo: ['example-5.3-codex', 'example-5.6-sol'],
			},
		);
	});

	test('demoting every model leaves the list open rather than empty', () => {
		const sections = buildModelPickerSections({
			models: [gpt, claude],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: {
				'gpt-5-5': { label: 'GPT-5.5', exists: true, demoted: true },
				'claude-sonnet-5': { label: 'Claude Sonnet 5', exists: true, demoted: true },
			},
			showSuggested: true,
		});
		assert.deepStrictEqual(
			{
				suggested: sections.suggested.length,
				other: sections.other.map(model => model.metadata.name),
				folds: hasPromotedModels(sections),
			},
			{ suggested: 0, other: ['Claude Sonnet 5', 'GPT-5.5'], folds: false },
		);
	});

	test('an early-access build stays out of the shortlist without being named', () => {
		const sections = buildModelPickerSections({
			models: [gpt, createModel('example-3-eap', 'Example 3 EAP'), createModel('example-4-experimental', 'Example 4')],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: {},
			showSuggested: true,
		});
		assert.deepStrictEqual(
			{
				suggested: sections.suggested.map(model => model.metadata.id),
				other: sections.other.map(model => model.metadata.id),
			},
			{
				suggested: ['gpt-5-5'],
				other: ['example-3-eap', 'example-4-experimental'],
			},
		);
	});

	test('a demotion names one model, so a newer one in that line surfaces again', () => {
		const shortlist = (models: readonly ILanguageModelChatMetadataAndIdentifier[]) => buildModelPickerSections({
			models,
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: {
				'example-5.5': { label: 'Example 5.5', exists: true, demoted: true },
				'example-1-lite-picker': { label: 'Example 1 Lite', exists: true, demoted: true },
			},
			showSuggested: true,
		}).suggested.map(model => model.metadata.id).sort();

		const retired = createModel('example-5.5', 'Example 5.5');
		const variant = createModel('example-1-lite-picker', 'Example 1 Lite');
		assert.deepStrictEqual(
			{
				demoted: shortlist([retired, variant]),
				succeeded: shortlist([retired, variant, createModel('example-6', 'Example 6'), createModel('example-2-lite-picker', 'Example 2 Lite')]),
			},
			{ demoted: [], succeeded: ['example-2-lite-picker', 'example-6'] },
		);
	});

	test('a model is paired with the faster twin the provider names by id', () => {
		const standard = createModel('example-2.5', 'Example 2.5');
		const fast = createModel('example-2.5-fast', 'Example 2.5 (fast mode)');
		const orphan = createModel('some-model-fast', 'Some Model (fast mode)');
		const variants = buildSpeedVariants([gpt, standard, fast, orphan]);

		assert.deepStrictEqual(
			{
				fromStandard: variants.get(standard.identifier)?.fast.metadata.id,
				fromFast: variants.get(fast.identifier)?.standard.metadata.id,
				unpaired: [gpt, orphan].map(model => variants.has(model.identifier)),
			},
			{ fromStandard: 'example-2.5-fast', fromFast: 'example-2.5', unpaired: [false, false] },
		);
	});

	test('a pair takes one row, showing whichever twin is in use', () => {
		const standard = createModel('example-2.5', 'Example 2.5');
		const fast = createModel('example-2.5-fast', 'Example 2.5 (fast mode)');
		const models = [gpt, standard, fast];
		const variants = buildSpeedVariants(models);
		const names = (selected: string | undefined) =>
			collapseSpeedVariants(models, variants, selected).map(model => model.metadata.name);

		assert.deepStrictEqual(
			{
				neither: names(undefined),
				standardSelected: names(standard.identifier),
				fastSelected: names(fast.identifier),
			},
			{
				neither: ['GPT-5.5', 'Example 2.5'],
				standardSelected: ['GPT-5.5', 'Example 2.5'],
				fastSelected: ['GPT-5.5', 'Example 2.5 (fast mode)'],
			},
		);
	});

	test('badges rank a retiring model over an offer over the settings a model was tuned to', () => {
		const retiring = { ...gpt, metadata: { ...gpt.metadata, warningText: { model_pending_deprecation: 'Retiring soon.' } } };
		const promo = { ...claude, metadata: { ...claude.metadata, promo: { id: 'p', discountPercent: 25, message: 'Save now.' } } };
		const tuned = createConfigurableModel();
		const badge = (model: ILanguageModelChatMetadataAndIdentifier, values: IStringDictionary<unknown> = {}, providerLabel?: string) =>
			getModelBadge(model, { configurationAccess: createConfigurationAccess(values), providerLabel });

		assert.deepStrictEqual(
			{
				retiring: badge(retiring),
				promo: badge(promo),
				tuned: badge(tuned, { reasoningEffort: 'xhigh', contextSize: 1000000 }),
				untouched: badge(tuned),
				provider: badge(gpt, {}, 'Ollama'),
				plain: badge(gpt),
			},
			{
				retiring: { text: 'Retiring', tone: 'warning' },
				promo: { text: '25% off', tone: 'promo' },
				tuned: { text: 'Extra high \u00b7 1M', tone: 'selected' },
				untouched: undefined,
				provider: { text: 'Ollama', tone: 'neutral' },
				plain: undefined,
			},
		);
	});

	test('curated models the account cannot reach are named so their unlock path shows', () => {
		const controlModels: IStringDictionary<IModelControlEntry> = {
			'gpt-5-5': { label: 'GPT-5.5', featured: true, exists: true },
			'example-opus-5': { label: 'Claude Opus 5', featured: true, exists: false },
			'gpt-6': { label: 'GPT-6', featured: true, exists: false, minVSCodeVersion: '99.0.0' },
			'hidden': { label: 'Not Featured', featured: false, exists: false },
		};
		const sections = buildModelPickerSections({
			models: [gpt],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels,
			showSuggested: true,
			showUnavailable: true,
			currentVSCodeVersion: '1.100.0',
		});
		assert.deepStrictEqual(
			{
				suggested: sections.suggested.map(model => model.metadata.name),
				unavailable: sections.unavailable.map(entry => ({ id: entry.id, needsUpdate: entry.needsUpdate })),
			},
			{
				suggested: ['GPT-5.5'],
				unavailable: [{ id: 'example-opus-5', needsUpdate: false }, { id: 'gpt-6', needsUpdate: true }],
			},
		);
	});

	test('an offer on a model this build is too old to run does not break the shortlist', () => {
		const base = createModel('gpt-6', 'GPT-6');
		const gatedPromo = { ...base, metadata: { ...base.metadata, promo: { id: 'p', discountPercent: 25, message: 'Save now.' } } };
		const sections = buildModelPickerSections({
			models: [gatedPromo, gpt],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: { 'gpt-6': { label: 'GPT-6', featured: true, exists: true, minVSCodeVersion: '99.0.0' } },
			showSuggested: true,
			showUnavailable: true,
			currentVSCodeVersion: '1.100.0',
		});
		assert.deepStrictEqual(
			{
				suggested: sections.suggested.map(model => model.metadata.name),
				other: sections.other.map(model => model.metadata.name),
				unavailable: sections.unavailable.map(entry => ({ id: entry.id, needsUpdate: entry.needsUpdate })),
			},
			{ suggested: ['GPT-5.5'], other: [], unavailable: [{ id: 'gpt-6', needsUpdate: true }] },
		);
	});

	test('a model this build is too old to run is never offered as selectable', () => {
		const controlModels: IStringDictionary<IModelControlEntry> = {
			'gpt-5-5': { label: 'GPT-5.5', featured: true, exists: true, minVSCodeVersion: '99.0.0' },
		};
		const sections = buildModelPickerSections({
			models: [gpt, claude],
			selectedModelId: 'dardcor/gpt-5-5',
			recentModelIds: ['dardcor/gpt-5-5'],
			pinnedModelIds: ['dardcor/gpt-5-5'],
			controlModels: { ...controlModels, 'claude-sonnet-5': { label: 'Claude Sonnet 5', exists: true, demoted: true } },
			showSuggested: true,
			showUnavailable: true,
			currentVSCodeVersion: '1.100.0',
		});
		assert.deepStrictEqual(
			{
				pinned: sections.pinned.map(model => model.metadata.name),
				suggested: sections.suggested.map(model => model.metadata.name),
				other: sections.other.map(model => model.metadata.name),
				unavailable: sections.unavailable.map(entry => ({ id: entry.id, needsUpdate: entry.needsUpdate })),
			},
			{
				pinned: [],
				suggested: [],
				other: ['Claude Sonnet 5'],
				unavailable: [{ id: 'gpt-5-5', needsUpdate: true }],
			},
		);
	});

	test('surfaces that cannot act on locked models do not advertise them', () => {
		const sections = buildModelPickerSections({
			models: [gpt],
			selectedModelId: undefined,
			recentModelIds: [],
			pinnedModelIds: [],
			controlModels: { 'example-opus-5': { label: 'Claude Opus 5', featured: true, exists: false } },
			showSuggested: true,
		});
		assert.deepStrictEqual(sections.unavailable, []);
	});

	test('context is extended only at the largest configured window', () => {
		const model = createConfigurableModel();
		const read = (values: IStringDictionary<unknown>) => {
			const property = getModelConfigProperty(model, createConfigurationAccess(values), MODEL_CONFIG_GROUP_CONTEXT)!;
			return isExtendedContext(property);
		};
		assert.deepStrictEqual(
			{ default: read({}), standard: read({ contextSize: 264000 }), extended: read({ contextSize: 1000000 }) },
			{ default: false, standard: false, extended: true },
		);
	});

	test('the configuration summary names only what was changed from the defaults', () => {
		const model = createConfigurableModel();
		assert.deepStrictEqual(
			{
				defaults: getModelConfigSummary(model, createConfigurationAccess()),
				bothChanged: getModelConfigSummary(model, createConfigurationAccess({ reasoningEffort: 'xhigh', contextSize: 1000000 })),
				oneChanged: getModelConfigSummary(model, createConfigurationAccess({ contextSize: 1000000 })),
				noSchema: getModelConfigSummary(gpt, createConfigurationAccess()),
			},
			{ defaults: undefined, bothChanged: 'Extra high · 1M', oneChanged: '1M', noSchema: undefined },
		);
	});
});
