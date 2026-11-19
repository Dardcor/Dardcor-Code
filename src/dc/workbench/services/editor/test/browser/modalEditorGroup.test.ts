/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { workbenchInstantiationService, registerTestEditor, TestFileEditorInput, createEditorParts } from '../../../../test/browser/workbenchTestServices.js';
import { GroupsOrder, IEditorGroupsService } from '../../common/editorGroupsService.js';
import { EditorExtensions, EditorInputCapabilities, IEditorFactoryRegistry } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { MockScopableContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { SideBySideEditorInput } from '../../../../common/editor/sideBySideEditorInput.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IEditorService, MODAL_GROUP, MODAL_GROUP_TYPE } from '../../common/editorService.js';
import { findGroup } from '../../common/editorGroupFinder.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorService } from '../../browser/editorService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { Memento } from '../../../../common/memento.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { EditorPartModalVisibleContext } from '../../../../common/contextkeys.js';

suite('Modal Editor Group', () => {

	const TEST_EDITOR_ID = 'MyFileEditorForModalEditorGroup';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForModalEditorGroup';

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput), new SyncDescriptor(SideBySideEditorInput)], TEST_EDITOR_INPUT_ID));
	});

	teardown(() => {
		disposables.clear();
	});

	function createTestFileEditorInput(resource: URI, typeId: string): TestFileEditorInput {
		return disposables.add(new TestFileEditorInput(resource, typeId));
	}

	test('MODAL_GROUP constant is defined correctly', () => {
		assert.strictEqual(MODAL_GROUP, -4);
		assert.strictEqual(typeof MODAL_GROUP, 'number');
	});

	test('MODAL_GROUP_TYPE type exists', () => {
		const modalGroupValue: MODAL_GROUP_TYPE = MODAL_GROUP;
		assert.strictEqual(modalGroupValue, -4);
	});

	test('createModalEditorPart creates a modal editor part', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.ok(modalPart);
		assert.ok(modalPart.activeGroup);
		assert.strictEqual(typeof modalPart.close, 'function');

		await modalPart.close();
	});

	test('modal editor part has correct initial state', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.strictEqual(modalPart.activeGroup.count, 0);

		await modalPart.close();
	});

	test('modal editor part can open editors', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		assert.strictEqual(modalPart.activeGroup.count, 1);
		assert.strictEqual(modalPart.activeGroup.activeEditor, input);

		await modalPart.close();
	});

	test('modal editor part is added to parts list', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const initialGroupCount = parts.groups.length;

		const modalPart = await parts.createModalEditorPart();

		assert.strictEqual(parts.groups.length, initialGroupCount + 1);

		await modalPart.close();
	});

	test('closing modal part fires onWillClose event', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.ok(typeof modalPart.onWillClose === 'function');
		assert.ok(modalPart.onWillClose !== undefined);

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		const result = await modalPart.close();
		assert.strictEqual(result, true);
	});

	test('modal editor part close returns true when no confirming editors', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		const result = await modalPart.close();

		assert.strictEqual(result, true);
	});

	test('modal editor part getGroups returns groups in correct order', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		const allGroups = parts.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		const modalGroup = modalPart.activeGroup;

		assert.ok(allGroups.some(g => g.id === modalGroup.id));

		await modalPart.close();
	});

	test('modal editor part is singleton - subsequent calls return same instance', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart1 = await parts.createModalEditorPart();
		const modalPart2 = await parts.createModalEditorPart();

		assert.ok(modalPart1);
		assert.ok(modalPart2);
		assert.strictEqual(modalPart1, modalPart2);
		assert.strictEqual(modalPart1.activeGroup.id, modalPart2.activeGroup.id);

		await modalPart1.close();
	});

	test('createModalEditorPart is race-proof: concurrent creation returns same singleton instance', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		let addGroupCount = 0;
		disposables.add(parts.onDidAddGroup(() => {
			addGroupCount++;
		}));

		const [modalPart1, modalPart2, modalPart3] = await Promise.all([
			parts.createModalEditorPart(),
			parts.createModalEditorPart(),
			parts.createModalEditorPart()
		]);

		assert.strictEqual(modalPart1, modalPart2);
		assert.strictEqual(modalPart2, modalPart3);
		assert.strictEqual(modalPart1.activeGroup.id, modalPart2.activeGroup.id);
		assert.strictEqual(modalPart1.activeGroup.id, modalPart3.activeGroup.id);

		assert.strictEqual(addGroupCount, 1);

		await modalPart1.close();
	});

	test('modal editor part singleton is reset after close', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart1 = await parts.createModalEditorPart();
		const firstGroupId = modalPart1.activeGroup.id;

		await modalPart1.close();

		const modalPart2 = await parts.createModalEditorPart();

		assert.notStrictEqual(modalPart2.activeGroup.id, firstGroupId);

		await modalPart2.close();
	});

	test('modal editor part onDidAddGroup fires only once for singleton', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		let addGroupCount = 0;
		disposables.add(parts.onDidAddGroup(() => {
			addGroupCount++;
		}));

		await parts.createModalEditorPart();
		await parts.createModalEditorPart();

		assert.strictEqual(addGroupCount, 1);

		await (await parts.createModalEditorPart()).close();
	});

	test('modal editor part enforces no tabs mode', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.strictEqual(modalPart.partOptions.showTabs, 'none');

		await modalPart.close();
	});

	test('modal editor part enforces closeEmptyGroups', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.strictEqual(modalPart.partOptions.closeEmptyGroups, true);

		await modalPart.close();
	});

	test('closing all editors in modal removes the modal group', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		const modalGroupId = modalPart.activeGroup.id;

		assert.ok(parts.getGroup(modalGroupId));

		await modalPart.activeGroup.closeAllEditors();

		assert.strictEqual(parts.getGroup(modalGroupId), undefined);
	});

	test('modal editor part does not persist state', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		assert.ok(modalPart.activeGroup);

		await modalPart.close();
	});

	test('activePart returns modal when focused', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		modalPart.activeGroup.focus();

		const groups = parts.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.ok(groups.some(g => g.id === modalPart.activeGroup.id));

		await modalPart.close();
	});

	test('modal part group can be found by id', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const modalGroup = modalPart.activeGroup;
		const foundGroup = parts.getGroup(modalGroup.id);

		assert.ok(foundGroup);
		assert.strictEqual(foundGroup!.id, modalGroup.id);

		await modalPart.close();
	});

	test('onDidAddGroup fires when modal is created', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		let addedGroupId: number | undefined;
		disposables.add(parts.onDidAddGroup(group => {
			addedGroupId = group.id;
		}));

		const modalPart = await parts.createModalEditorPart();

		assert.ok(addedGroupId !== undefined);
		assert.strictEqual(addedGroupId, modalPart.activeGroup.id);

		await modalPart.close();
	});

	test('onDidRemoveGroup fires when modal is closed', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const modalGroupId = modalPart.activeGroup.id;

		let removedGroupId: number | undefined;
		disposables.add(parts.onDidRemoveGroup(group => {
			removedGroupId = group.id;
		}));

		await modalPart.close();

		assert.ok(removedGroupId !== undefined);
		assert.strictEqual(removedGroupId, modalGroupId);
	});

	test('activeModalEditorPart is set when modal is created and cleared on close', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);
		const contextKeyService = instantiationService.invokeFunction(accessor => accessor.get(IContextKeyService));

		assert.deepStrictEqual({
			activeModalEditorPart: parts.activeModalEditorPart,
			modalEditorVisible: EditorPartModalVisibleContext.getValue(contextKeyService),
		}, {
			activeModalEditorPart: undefined,
			modalEditorVisible: false,
		});

		const modalPart = await parts.createModalEditorPart();
		assert.deepStrictEqual({
			activeModalEditorPart: parts.activeModalEditorPart,
			modalEditorVisible: EditorPartModalVisibleContext.getValue(contextKeyService),
		}, {
			activeModalEditorPart: modalPart,
			modalEditorVisible: true,
		});

		await modalPart.close();
		assert.deepStrictEqual({
			activeModalEditorPart: parts.activeModalEditorPart,
			modalEditorVisible: EditorPartModalVisibleContext.getValue(contextKeyService),
		}, {
			activeModalEditorPart: undefined,
			modalEditorVisible: false,
		});
	});

	test('findGroup returns main part group when modal is active and preferredGroup is not MODAL_GROUP', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const mainGroup = parts.mainPart.activeGroup;

		const modalPart = await parts.createModalEditorPart();
		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		const newInput = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
		const [group] = await instantiationService.invokeFunction(accessor => findGroup(accessor, { resource: newInput.resource }, undefined));

		assert.strictEqual(group.id, mainGroup.id);
	});

	test('findGroup closes modal when preferredGroup is not MODAL_GROUP and preserveFocus is not set', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();
		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		assert.ok(parts.activeModalEditorPart);

		const newInput = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
		await instantiationService.invokeFunction(accessor => findGroup(accessor, { resource: newInput.resource }, undefined));

		assert.strictEqual(parts.activeModalEditorPart, undefined);
	});

	test('findGroup keeps modal open when preserveFocus is true', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();
		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input, { pinned: true });

		assert.ok(parts.activeModalEditorPart);

		const newInput = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
		await instantiationService.invokeFunction(accessor => findGroup(accessor, { resource: newInput.resource, options: { preserveFocus: true } }, undefined));

		assert.strictEqual(parts.activeModalEditorPart, modalPart);

		await modalPart.close();
	});

	test('modal editor part starts not maximized', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.strictEqual(modalPart.maximized, false);

		await modalPart.close();
	});

	test('modal editor part toggleMaximized toggles state', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		assert.strictEqual(modalPart.maximized, false);

		modalPart.toggleMaximized();
		assert.strictEqual(modalPart.maximized, true);

		modalPart.toggleMaximized();
		assert.strictEqual(modalPart.maximized, false);

		await modalPart.close();
	});

	test('modal editor part fires onDidChangeMaximized', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();

		const events: boolean[] = [];
		disposables.add(modalPart.onDidChangeMaximized(maximized => events.push(maximized)));

		modalPart.toggleMaximized();
		modalPart.toggleMaximized();

		assert.deepStrictEqual(events, [true, false]);

		await modalPart.close();
	});

	test('modal editor part remembers maximized state across instances', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart1 = await parts.createModalEditorPart();
		modalPart1.toggleMaximized();
		assert.strictEqual(modalPart1.maximized, true);
		await modalPart1.close();

		const modalPart2 = await parts.createModalEditorPart();
		assert.strictEqual(modalPart2.maximized, true);
		await modalPart2.close();

		const modalPart3 = await parts.createModalEditorPart();
		assert.strictEqual(modalPart3.maximized, true);
		modalPart3.toggleMaximized();
		assert.strictEqual(modalPart3.maximized, false);
		await modalPart3.close();

		const modalPart4 = await parts.createModalEditorPart();
		assert.strictEqual(modalPart4.maximized, false);
		await modalPart4.close();
	});

	suite('useModal: all', () => {

		test('findGroup creates modal and returns its active group', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'all');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			const result = instantiationService.invokeFunction(accessor => findGroup(accessor, { resource: input.resource }, undefined));

			assert.ok(result instanceof Promise);
			const [group] = await result;

			assert.ok(parts.activeModalEditorPart);
			assert.strictEqual(group.id, parts.activeModalEditorPart.activeGroup.id);

			await parts.activeModalEditorPart.close();
		});

		test('findGroup does not auto-close modal', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'all');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const modalPart = await parts.createModalEditorPart();
			const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			await modalPart.activeGroup.openEditor(input, { pinned: true });

			const newInput = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
			const result = instantiationService.invokeFunction(accessor => findGroup(accessor, { resource: newInput.resource }, undefined));

			const [group] = result instanceof Promise ? await result : result;

			assert.ok(parts.activeModalEditorPart);
			assert.strictEqual(group.id, modalPart.activeGroup.id);

			await modalPart.close();
		});

		test('findGroup auto-closes modal when setting is not all', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'off');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const modalPart = await parts.createModalEditorPart();
			const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			await modalPart.activeGroup.openEditor(input, { pinned: true });

			assert.ok(parts.activeModalEditorPart);

			const newInput = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
			await instantiationService.invokeFunction(accessor => findGroup(accessor, { resource: newInput.resource }, undefined));

			assert.strictEqual(parts.activeModalEditorPart, undefined);
		});

		test('shows tabs when multiple editors are open', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'all');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
			instantiationService.stub(IEditorService, editorService);

			const input1 = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			await editorService.openEditor(input1, { pinned: true }, MODAL_GROUP);

			const modalPart = parts.activeModalEditorPart!;
			assert.ok(modalPart);

			assert.strictEqual(modalPart.partOptions.showTabs, 'none');

			const input2 = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
			await editorService.openEditor(input2, { pinned: true }, MODAL_GROUP);

			assert.strictEqual(modalPart.partOptions.showTabs, 'multiple');

			await modalPart.close();
		});

		test('hides tabs when not in all mode even with multiple editors', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'some');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
			instantiationService.stub(IEditorService, editorService);

			const input1 = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			await editorService.openEditor(input1, { pinned: true }, MODAL_GROUP);

			const modalPart = parts.activeModalEditorPart!;
			assert.ok(modalPart);

			const input2 = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
			await editorService.openEditor(input2, { pinned: true }, MODAL_GROUP);

			assert.strictEqual(modalPart.partOptions.showTabs, 'none');

			await modalPart.close();
		});
	});

	test('modal editor part editors can be moved to another group', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();
		const input1 = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const input2 = createTestFileEditorInput(URI.file('foo/baz'), TEST_EDITOR_INPUT_ID);
		await modalPart.activeGroup.openEditor(input1, { pinned: true });
		await modalPart.activeGroup.openEditor(input2, { pinned: true });

		assert.strictEqual(modalPart.activeGroup.count, 2);

		const targetGroup = parts.mainPart.activeGroup;
		for (const group of modalPart.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			group.moveEditors(group.editors.map(editor => ({ editor, options: { preserveFocus: true } })), targetGroup);
		}

		assert.strictEqual(targetGroup.count, 2);
		assert.strictEqual(modalPart.activeGroup.count, 0);

		await modalPart.close();
		assert.strictEqual(parts.activeModalEditorPart, undefined);
	});

	test('openEditor with MODAL_GROUP ignores preserveFocus', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);

		const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const pane = await editorService.openEditor(input, { pinned: true, preserveFocus: true }, MODAL_GROUP);

		assert.ok(pane);
		assert.strictEqual(pane.options?.preserveFocus, false);

		await parts.activeModalEditorPart?.close();
	});

	test('modal editor part state is remembered on close and reused on next open', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart1 = await parts.createModalEditorPart({ maximized: true });
		await modalPart1.close();

		const modalPart2 = await parts.createModalEditorPart();
		assert.strictEqual(modalPart2.maximized, true);

		await modalPart2.close();
	});

	test('modal editor part state restores from profile storage', async () => {
		const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const storageService = instantiationService.get(IStorageService) as TestStorageService;

		storageService.store('memento/workbench.editorParts', JSON.stringify({
			'editorparts.modalState': {
				maximized: true,
				size: { width: 500, height: 400 },
				position: { left: 100, top: 50 }
			}
		}), StorageScope.PROFILE, StorageTarget.MACHINE);
		Memento.clear(StorageScope.PROFILE);

		const parts = await createEditorParts(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, parts);

		const modalPart = await parts.createModalEditorPart();
		assert.strictEqual(modalPart.maximized, true);

		await modalPart.close();
	});

	suite('RequiresModal capability', () => {

		test('findGroup respects useModal: off for editor with RequiresModal', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'off');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			input.capabilities = EditorInputCapabilities.RequiresModal;

			const result = instantiationService.invokeFunction(accessor => findGroup(accessor, { editor: input, options: {} }, undefined));

			const [group] = result instanceof Promise ? await result : result;

			assert.strictEqual(parts.activeModalEditorPart, undefined);
			assert.strictEqual(group.id, parts.mainPart.activeGroup.id);
		});

		test('findGroup opens modal for editor with RequiresModal when useModal is some', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'some');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			input.capabilities = EditorInputCapabilities.RequiresModal;

			const result = instantiationService.invokeFunction(accessor => findGroup(accessor, { editor: input, options: {} }, undefined));

			assert.ok(result instanceof Promise);
			const [group] = await result;

			assert.ok(parts.activeModalEditorPart);
			assert.strictEqual(group.id, parts.activeModalEditorPart.activeGroup.id);

			await parts.activeModalEditorPart.close();
		});

		test('findGroup does not close modal for RequiresModal editor when modal is already open', async () => {
			const instantiationService = workbenchInstantiationService({ contextKeyService: instantiationService => instantiationService.createInstance(MockScopableContextKeyService) }, disposables);
			instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
			const configurationService = new TestConfigurationService();
			await configurationService.setUserConfiguration('workbench.editor.useModal', 'some');
			instantiationService.stub(IConfigurationService, configurationService);
			const parts = await createEditorParts(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, parts);

			const modalPart = await parts.createModalEditorPart();
			const existingInput = createTestFileEditorInput(URI.file('foo/existing'), TEST_EDITOR_INPUT_ID);
			await modalPart.activeGroup.openEditor(existingInput, { pinned: true });

			const input = createTestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
			input.capabilities = EditorInputCapabilities.RequiresModal;

			const result = instantiationService.invokeFunction(accessor => findGroup(accessor, { editor: input, options: {} }, undefined));

			assert.ok(result instanceof Promise);
			const [group] = await result;

			assert.ok(parts.activeModalEditorPart);
			assert.strictEqual(parts.activeModalEditorPart, modalPart);
			assert.strictEqual(group.id, modalPart.activeGroup.id);

			await modalPart.close();
		});
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
