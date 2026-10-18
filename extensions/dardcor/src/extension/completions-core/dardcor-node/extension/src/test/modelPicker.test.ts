/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { commands } from 'vscode';
import { SyncDescriptor } from '../../../../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService, ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { AvailableModelsManager, ICompletionsModelManagerService } from '../../../lib/src/openai/model';
import { ModelPickerManager } from './../modelPicker';
import { createExtensionTestingContext } from './context';

suite('ModelPickerManager unit tests', function () {
	let accessor: ServicesAccessor;
	let modelPicker: ModelPickerManager;
	let availableModelsManager: ICompletionsModelManagerService;
	let sandbox: sinon.SinonSandbox;
	let getGenericCompletionModelsStub: sinon.SinonStub;

	const fakeModels = [
		{
			modelId: 'model-a',
			label: 'Model A',
			type: 'model',
			alwaysShow: true,
			preview: false,
			tokenizer: 'o200k_base',
		},
		{
			modelId: 'model-b',
			label: 'Model B',
			type: 'model',
			alwaysShow: true,
			preview: false,
			tokenizer: 'cl100k_base',
		},
	];

	setup(function () {
		sandbox = sinon.createSandbox();
		const serviceCollection = createExtensionTestingContext();
		serviceCollection.define(ICompletionsModelManagerService, new SyncDescriptor(AvailableModelsManager, [true]));
		accessor = serviceCollection.createTestingAccessor();

		availableModelsManager = accessor.get(ICompletionsModelManagerService);
		getGenericCompletionModelsStub = sandbox.stub(availableModelsManager, 'getGenericCompletionModels').returns(fakeModels);
		modelPicker = accessor.get(IInstantiationService).createInstance(ModelPickerManager);
	});

	teardown(async function () {
		await commands.executeCommand('workbench.action.closeQuickOpen');
		sandbox.restore();
	});

	test('showModelPicker returns correct items', function () {
		const instantiationService = accessor.get(IInstantiationService);

		modelPicker = instantiationService.createInstance(ModelPickerManager);

		const quickPick = modelPicker.showModelPicker();

		assert(quickPick.items.length === 3, quickPick.items.length.toString());
		assert.strictEqual(quickPick.items[0].modelId, 'model-a');
		assert.strictEqual(quickPick.items[1].modelId, 'model-b');
		assert.strictEqual(quickPick.items[2].type, 'separator');
		assert.strictEqual(quickPick.items[2].type, 'separator');
	});

	test('hasMultipleModels is true when multiple models are available', function () {
		assert.strictEqual(modelPicker.hasMultipleModels(), true);
	});

	test('hasMultipleModels is false when one model is available', function () {
		getGenericCompletionModelsStub.returns([fakeModels[0]]);
		assert.strictEqual(modelPicker.hasMultipleModels(), false);
	});

	test('selecting a model updates user selection', async function () {
		const setModelStub = sandbox.stub(modelPicker, 'setUserSelectedCompletionModel').resolves();

		const quickPick = modelPicker.showModelPicker();

		const secondItem = quickPick.items[1];
		assert(secondItem !== undefined, 'model picker should have a model-b second item.');

		quickPick.activeItems = [secondItem];
		await modelPicker.handleModelSelection(quickPick);

		assert(setModelStub.calledOnce, 'setUserSelectedCompletionModel should be called once');
		assert.strictEqual(setModelStub.firstCall.args[0], secondItem.modelId);
	});

});
