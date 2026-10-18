/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IStringDictionary } from '../../../../../../../base/common/collections.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';
import { ChatModelConfigurationStore } from '../../../../browser/widget/input/chatModelConfigurationStore.js';
import { resolveContextWindowInputTokens } from '../../../../browser/widgetHosts/viewPane/chatContextUsageWidget.js';
import { ILanguageModelChatMetadata, ILanguageModelConfigurationSchema, ILanguageModelsService } from '../../../../common/languageModels.js';

const schema: ILanguageModelConfigurationSchema = {
	properties: {
		thinkingEffort: { enum: ['low', 'medium', 'high'], default: 'medium' },
	}
};

const schemaWithContextSize: ILanguageModelConfigurationSchema = {
	properties: {
		thinkingEffort: { enum: ['low', 'medium', 'high'], default: 'medium' },
		contextSize: { type: 'number', default: 200_000 },
	}
};

const MODEL = 'copilot/gpt';
const KEY = 'chat.modelConfiguration.panel';

function createStubService(global?: IStringDictionary<unknown>): ILanguageModelsService {
	return {
		onDidChangeLanguageModels: Event.None,
		lookupLanguageModel: (_id: string) => ({ configurationSchema: schema } as ILanguageModelChatMetadata),
		getModelConfiguration: (_id: string) => global,
		setModelConfiguration: async (_id: string, _values: IStringDictionary<unknown>) => { },
	} as unknown as ILanguageModelsService;
}

suite('ChatModelConfigurationStore', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createStore(storage: InMemoryStorageService, service: ILanguageModelsService): ChatModelConfigurationStore {
		return store.add(new ChatModelConfigurationStore(() => KEY, service, storage));
	}

	interface IControllableService {
		readonly service: ILanguageModelsService;
		readonly setConfigCalls: Array<{ modelId: string; values: IStringDictionary<unknown> }>;
		fireModelsChanged(): void;
		setRegistered(registered: boolean): void;
		setGlobal(value: IStringDictionary<unknown> | undefined): void;
	}



	function createControllableService(): IControllableService {
		const emitter = store.add(new Emitter<string>());
		let registered = true;
		let global: IStringDictionary<unknown> | undefined;
		const setConfigCalls: Array<{ modelId: string; values: IStringDictionary<unknown> }> = [];
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => registered ? ({ configurationSchema: schema } as ILanguageModelChatMetadata) : undefined,
			getModelConfiguration: (_id: string) => global,
			setModelConfiguration: async (modelId: string, values: IStringDictionary<unknown>) => { setConfigCalls.push({ modelId, values }); },
		} as unknown as ILanguageModelsService;
		return {
			service,
			setConfigCalls,
			fireModelsChanged: () => emitter.fire('copilot'),
			setRegistered: (value: boolean) => { registered = value; },
			setGlobal: (value: IStringDictionary<unknown> | undefined) => { global = value; },
		};
	}

	test('non-default value round-trips through storage to a newly opened editor', () => {
		const storage = store.add(new InMemoryStorageService());

		const editorA = createStore(storage, createStubService());
		editorA.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editorA.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		const editorB = createStore(storage, createStubService());
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
	});

	test('already-open editor keeps its own snapshot when another editor writes', () => {
		const storage = store.add(new InMemoryStorageService());

		const editorA = createStore(storage, createStubService());
		const editorB = createStore(storage, createStubService());

		editorA.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		editorB.setModelConfiguration(MODEL, { thinkingEffort: 'low' });
		assert.deepStrictEqual(editorA.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'low' });
	});

	test('a config write from another editor does not clobber an open editor via the model-change event', () => {

		const storage = store.add(new InMemoryStorageService());
		const emitter = store.add(new Emitter<string>());
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => ({ configurationSchema: schema } as ILanguageModelChatMetadata),
			getModelConfiguration: (_id: string) => undefined,
			setModelConfiguration: async (_id: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;

		const editorA = store.add(new ChatModelConfigurationStore(() => KEY, service, storage));
		const editorB = store.add(new ChatModelConfigurationStore(() => KEY, service, storage));

		editorA.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
		editorB.setModelConfiguration(MODEL, { thinkingEffort: 'low' });


		emitter.fire('copilot');

		assert.deepStrictEqual(
			{ a: editorA.getModelConfiguration(MODEL), b: editorB.getModelConfiguration(MODEL) },
			{ a: { thinkingEffort: 'high' }, b: { thinkingEffort: 'low' } },
		);
	});

	test('explicit reset-to-default does not revert to a stale global value (issue #320393)', () => {
		const storage = store.add(new InMemoryStorageService());

		const editorA = createStore(storage, createStubService({ thinkingEffort: 'high' }));


		assert.deepStrictEqual(editorA.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		editorA.setModelConfiguration(MODEL, { thinkingEffort: 'medium' });

		const editorB = createStore(storage, createStubService({ thinkingEffort: 'high' }));
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'medium' });
	});

	test('onDidChange fires for the changed model', () => {
		const storage = store.add(new InMemoryStorageService());
		const editor = createStore(storage, createStubService());

		const fired: string[] = [];
		store.add(editor.onDidChange(id => fired.push(id)));

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(fired, [MODEL]);
	});

	test('setting an unchanged value does not fire onDidChange or rewrite storage', () => {
		const storage = store.add(new InMemoryStorageService());
		const editor = createStore(storage, createStubService());
		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });

		const fired: string[] = [];
		store.add(editor.onDidChange(id => fired.push(id)));
		let writes = 0;
		const ds = store.add(new DisposableStore());
		store.add(storage.onDidChangeValue(StorageScope.APPLICATION, KEY, ds)(() => writes++));

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		editor.restoreModelConfiguration(MODEL, { thinkingEffort: 'high' });

		assert.deepStrictEqual(fired, []);
		assert.strictEqual(writes, 0);
	});

	test('restoreModelConfiguration seeds the snapshot and persists to the scoped bucket', () => {
		const storage = store.add(new InMemoryStorageService());
		const editor = createStore(storage, createStubService());

		editor.restoreModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		const editorB = createStore(storage, createStubService());
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
	});

	test('restoreModelConfiguration ignores values that the current schema rejects', () => {
		const storage = store.add(new InMemoryStorageService());
		const editor = createStore(storage, createStubService());

		editor.restoreModelConfiguration(MODEL, { thinkingEffort: 'extreme', removedProp: 42 });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'medium' });

		const editorB = createStore(storage, createStubService());
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'medium' });
	});

	test('clear() drops in-memory snapshots so the next read re-seeds from storage', () => {
		const storage = store.add(new InMemoryStorageService());
		const editor = createStore(storage, createStubService());

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		storage.store(KEY, JSON.stringify({ [MODEL]: { thinkingEffort: 'low' } }), StorageScope.APPLICATION, StorageTarget.USER);
		editor.clear();
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'low' });
	});

	test('hostile model identifiers do not pollute the bucket prototype', () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store(KEY, '{"__proto__":{"polluted":true},"copilot/gpt":{"thinkingEffort":"high"}}', StorageScope.APPLICATION, StorageTarget.USER);

		const editor = createStore(storage, createStubService());
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
		assert.strictEqual(({} as IStringDictionary<unknown>)['polluted'], undefined);
	});

	test('re-selecting the current value does not rewrite the profile-global configuration', () => {
		const storage = store.add(new InMemoryStorageService());
		const controls = createControllableService();
		const editor = createStore(storage, controls.service);

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.strictEqual(controls.setConfigCalls.length, 1);

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.strictEqual(controls.setConfigCalls.length, 1);
	});

	test('model change refreshes only pre-config-load snapshots, not bucket-backed ones', () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store(KEY, JSON.stringify({ [MODEL]: { thinkingEffort: 'high' } }), StorageScope.APPLICATION, StorageTarget.USER);

		const controls = createControllableService();

		controls.setRegistered(false);
		const editor = createStore(storage, controls.service);

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
		const OTHER = 'copilot/other';
		assert.strictEqual(editor.getModelConfiguration(OTHER), undefined);

		const fired: string[] = [];
		store.add(editor.onDidChange(id => fired.push(id)));


		controls.setRegistered(true);
		controls.setGlobal({ thinkingEffort: 'low' });
		controls.fireModelsChanged();

		assert.deepStrictEqual(fired, [OTHER]);
		assert.deepStrictEqual(editor.getModelConfiguration(OTHER), { thinkingEffort: 'low' });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
	});

	test('model change merges newly available schema defaults into non-empty pre-config-load snapshots', () => {
		const storage = store.add(new InMemoryStorageService());
		const emitter = store.add(new Emitter<string>());
		let registered = false;
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => registered ? ({ configurationSchema: schemaWithContextSize } as ILanguageModelChatMetadata) : undefined,
			getModelConfiguration: (_id: string) => ({ thinkingEffort: 'high' }),
			setModelConfiguration: async (_modelId: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
		const editor = createStore(storage, service);

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		const fired: string[] = [];
		store.add(editor.onDidChange(id => fired.push(id)));

		registered = true;
		emitter.fire('copilot');

		assert.deepStrictEqual(
			{ fired, configuration: editor.getModelConfiguration(MODEL) },
			{ fired: [MODEL], configuration: { thinkingEffort: 'high', contextSize: 200_000 } }
		);
	});

	test('reload: a bucket-backed snapshot missing contextSize heals once the schema loads (regression for #320393)', () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store(KEY, JSON.stringify({ [MODEL]: { thinkingEffort: 'high' } }), StorageScope.APPLICATION, StorageTarget.USER);

		const emitter = store.add(new Emitter<string>());
		let registered = false;
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => registered ? ({ configurationSchema: schemaWithContextSize } as ILanguageModelChatMetadata) : undefined,
			getModelConfiguration: (_id: string) => undefined,
			setModelConfiguration: async (_modelId: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
		const editor = createStore(storage, service);

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		const fired: string[] = [];
		store.add(editor.onDidChange(id => fired.push(id)));

		registered = true;
		emitter.fire('copilot');

		assert.deepStrictEqual(
			{ fired, configuration: editor.getModelConfiguration(MODEL) },
			{ fired: [MODEL], configuration: { thinkingEffort: 'high', contextSize: 200_000 } }
		);
	});

	function createMultiKeyService(): ILanguageModelsService {
		return {
			onDidChangeLanguageModels: Event.None,
			lookupLanguageModel: (_id: string) => ({ configurationSchema: schemaWithContextSize } as ILanguageModelChatMetadata),
			getModelConfiguration: (_id: string) => undefined,
			setModelConfiguration: async (_id: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
	}

	test('changing one config key preserves the other key and its default (multi-key independence)', () => {
		const storage = store.add(new InMemoryStorageService());
		const editor = createStore(storage, createMultiKeyService());

		editor.setModelConfiguration(MODEL, { contextSize: 1_000_000 });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'medium', contextSize: 1_000_000 });

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high', contextSize: 1_000_000 });
	});

	test('a non-default contextSize round-trips to a new editor and reselecting the default clears it', () => {
		const storage = store.add(new InMemoryStorageService());

		const editorA = createStore(storage, createMultiKeyService());
		editorA.setModelConfiguration(MODEL, { contextSize: 1_000_000 });

		const editorB = createStore(storage, createMultiKeyService());
		assert.deepStrictEqual(editorB.getModelConfiguration(MODEL), { thinkingEffort: 'medium', contextSize: 1_000_000 });

		editorB.setModelConfiguration(MODEL, { contextSize: 200_000 });
		const editorC = createStore(storage, createMultiKeyService());
		assert.deepStrictEqual(editorC.getModelConfiguration(MODEL), { thinkingEffort: 'medium', contextSize: 200_000 });
	});

	test('healing does not reset a user-chosen full-window contextSize back to the default', () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store(KEY, JSON.stringify({ [MODEL]: { contextSize: 1_000_000 } }), StorageScope.APPLICATION, StorageTarget.USER);

		const emitter = store.add(new Emitter<string>());
		let registered = false;
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => registered ? ({ configurationSchema: schemaWithContextSize } as ILanguageModelChatMetadata) : undefined,
			getModelConfiguration: (_id: string) => undefined,
			setModelConfiguration: async (_modelId: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
		const editor = createStore(storage, service);

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { contextSize: 1_000_000 });

		registered = true;
		emitter.fire('copilot');

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'medium', contextSize: 1_000_000 });
	});

	test('restoreModelConfiguration does not write the profile-global value', () => {

		const storage = store.add(new InMemoryStorageService());
		const controls = createControllableService();
		const editor = createStore(storage, controls.service);

		editor.restoreModelConfiguration(MODEL, { thinkingEffort: 'high' });

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
		assert.strictEqual(controls.setConfigCalls.length, 0);
	});

	test('a per-scope storage key change segregates buckets (issue #320393)', () => {
		const storage = store.add(new InMemoryStorageService());
		let key = 'chat.modelConfiguration.scopeA';
		const service = createStubService();
		const editor = store.add(new ChatModelConfigurationStore(() => key, service, storage));

		editor.setModelConfiguration(MODEL, { thinkingEffort: 'high' });
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });

		key = 'chat.modelConfiguration.scopeB';
		editor.clear();
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'medium' });

		key = 'chat.modelConfiguration.scopeA';
		editor.clear();
		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { thinkingEffort: 'high' });
	});

	test('reload: an empty pre-config-load snapshot resolves to the default contextSize once the schema loads', () => {

		const storage = store.add(new InMemoryStorageService());

		const emitter = store.add(new Emitter<string>());
		let registered = false;
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => registered ? ({ configurationSchema: schemaWithContextSize } as ILanguageModelChatMetadata) : undefined,
			getModelConfiguration: (_id: string) => undefined,
			setModelConfiguration: async (_modelId: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
		const editor = createStore(storage, service);

		assert.strictEqual(editor.getModelConfiguration(MODEL), undefined);

		const fired: string[] = [];
		store.add(editor.onDidChange(id => fired.push(id)));

		registered = true;
		emitter.fire('copilot');

		assert.deepStrictEqual(
			{ fired, configuration: editor.getModelConfiguration(MODEL) },
			{ fired: [MODEL], configuration: { thinkingEffort: 'medium', contextSize: 200_000 } }
		);
	});

	test('integration: store heals + notifies so the widget denominator drops from the full window to the default tier', () => {

		const FULL_WINDOW = 1_000_000;
		const DEFAULT_TIER = 200_000;
		const storage = store.add(new InMemoryStorageService());
		const emitter = store.add(new Emitter<string>());
		let registered = false;
		const metadata = () => registered
			? ({ configurationSchema: schemaWithContextSize, maxInputTokens: FULL_WINDOW } as ILanguageModelChatMetadata)
			: undefined;
		const service = {
			onDidChangeLanguageModels: emitter.event,
			lookupLanguageModel: (_id: string) => metadata(),
			getModelConfiguration: (_id: string) => ({ thinkingEffort: 'high' }),
			setModelConfiguration: async (_modelId: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
		const editor = createStore(storage, service);

		const computeDenominator = () => resolveContextWindowInputTokens(
			editor.getModelConfiguration(MODEL),
			metadata()?.configurationSchema,
			metadata()?.maxInputTokens,
		);
		const denominators: (number | undefined)[] = [computeDenominator()];
		store.add(editor.onDidChange(id => { if (id === MODEL) { denominators.push(computeDenominator()); } }));

		registered = true;
		emitter.fire('copilot');

		assert.deepStrictEqual(denominators, [undefined, DEFAULT_TIER]);
	});

	test('restore preserves a reopened conversation\'s config for an unregistered model instead of re-pinning a shared stale value', () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store(KEY, JSON.stringify({ [MODEL]: { contextSize: 936_000 } }), StorageScope.APPLICATION, StorageTarget.USER);
		const service = {
			onDidChangeLanguageModels: Event.None,
			lookupLanguageModel: (_id: string) => undefined,
			getModelConfiguration: (_id: string) => undefined,
			setModelConfiguration: async (_id: string, _values: IStringDictionary<unknown>) => { },
		} as unknown as ILanguageModelsService;
		const editor = createStore(storage, service);

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { contextSize: 936_000 });

		editor.restoreModelConfiguration(MODEL, { contextSize: 200_000 });

		assert.deepStrictEqual(editor.getModelConfiguration(MODEL), { contextSize: 200_000 });
	});
});
