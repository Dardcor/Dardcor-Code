/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { CellKind, NotebookSetting } from '../../common/notebookCommon.js';
import { createNotebookCellList, setupInstantiationService, withTestNotebook } from './testNotebookEditor.js';

suite('NotebookCellList', () => {
	let testDisposables: DisposableStore;
	let instantiationService: TestInstantiationService;

	teardown(() => {
		testDisposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	let config: TestConfigurationService;
	setup(() => {
		testDisposables = new DisposableStore();
		instantiationService = setupInstantiationService(testDisposables);
		config = new TestConfigurationService();
		instantiationService.stub(IConfigurationService, config);
	});

	test('revealElementsInView: reveal fully visible cell should not scroll', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					cellLineNumberStates: {},
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);
				cellList.scrollTop = 5;

				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.revealCells({ start: 1, end: 2 });
				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.revealCells({ start: 2, end: 3 });
				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.revealCells({ start: 3, end: 4 });
				assert.deepStrictEqual(cellList.scrollTop, 90);
			});
	});

	test('revealElementsInView: reveal partially visible cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.revealCells({ start: 3, end: 4 });
				assert.deepStrictEqual(cellList.scrollTop, 90);

				cellList.scrollTop = 5;
				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.revealCells({ start: 0, end: 1 });
				assert.deepStrictEqual(cellList.scrollTop, 0);
			});
	});

	test('revealElementsInView: reveal cell out of viewport', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.updateOptions({ paddingBottom: 100 });
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.revealCells({ start: 4, end: 5 });
				assert.deepStrictEqual(cellList.scrollTop, 140);
			});
	});

	test('updateElementHeight', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.updateElementHeight(0, 60);
				assert.deepStrictEqual(cellList.scrollTop, 0);

				cellList.scrollTop = 5;
				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.updateElementHeight(0, 80);
				assert.deepStrictEqual(cellList.scrollTop, 5);
			});
	});

	test('updateElementHeight with anchor', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 50);
				cellList.scrollTop = 5;
				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.setFocus([1]);
				cellList.updateElementHeight2(viewModel.cellAt(0)!, 100);
				assert.deepStrictEqual(cellList.scrollHeight, 400);

				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 150);
				assert.deepStrictEqual(cellList.scrollTop, 55);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 265);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 50);
				assert.deepStrictEqual(cellList.scrollTop, 55);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 265);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 250);
				assert.deepStrictEqual(cellList.scrollTop, 250 + 100 - cellList.renderHeight);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 250 + 100 - cellList.renderHeight + 210);
			});
	});

	test('updateElementHeight with no scrolling', async function () {
		config.setUserConfiguration(NotebookSetting.scrollToRevealCell, 'none');
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});
				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 50);
				cellList.scrollTop = 5;
				assert.deepStrictEqual(cellList.scrollTop, 5);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 215);

				cellList.setFocus([1]);
				cellList.updateElementHeight2(viewModel.cellAt(0)!, 100);
				assert.deepStrictEqual(cellList.scrollHeight, 400);

				assert.deepStrictEqual(cellList.scrollTop, 5);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 50);
				assert.deepStrictEqual(cellList.scrollTop, 5);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 250);
				assert.deepStrictEqual(cellList.scrollTop, 5);
			});
	});

	test('updateElementHeight with no scroll setting and cell editor focused', async function () {
		config.setUserConfiguration(NotebookSetting.scrollToRevealCell, 'none');
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});
				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.setFocus([1]);

				editor.focusNotebookCell(cellList.viewModel?.cellAt(1)!, 'editor');
				cellList.updateElementHeight2(viewModel.cellAt(0)!, 100);
				assert.deepStrictEqual(cellList.scrollHeight, 400);

				assert.deepStrictEqual(cellList.scrollTop, 50);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 50);
				assert.deepStrictEqual(cellList.scrollTop, 0);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 250);
				assert.deepStrictEqual(cellList.scrollTop, 250 + 100 - cellList.renderHeight);
			});
	});

	test('updateElementHeight with focused element out of viewport', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.setFocus([4]);
				cellList.updateElementHeight2(viewModel.cellAt(1)!, 130);
				assert.deepStrictEqual(cellList.scrollTop, 0);
			});
	});

	test('updateElementHeight of cells out of viewport should not trigger scroll #121140', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markup, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['# header c', 'markdown', CellKind.Markup, [], {}]
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false, false, false, false, false],
					editorViewStates: [null, null, null, null, null],
					cellTotalHeights: [50, 100, 50, 100, 50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(210, 100);

				assert.deepStrictEqual(cellList.scrollTop, 0);
				assert.deepStrictEqual(cellList.getViewScrollBottom(), 210);

				cellList.setFocus([1]);
				cellList.scrollTop = 80;
				assert.deepStrictEqual(cellList.scrollTop, 80);

				cellList.updateElementHeight2(viewModel.cellAt(0)!, 30);
				assert.deepStrictEqual(cellList.scrollTop, 60);
			});
	});

	test('visibleRanges should be exclusive of end', async function () {
		await withTestNotebook(
			[
			],
			async (editor, viewModel, disposables) => {
				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(100, 100);

				assert.deepStrictEqual(cellList.visibleRanges, []);
			});
	});

	test('visibleRanges should be exclusive of end 2', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markup, [], {}],
			],
			async (editor, viewModel, disposables) => {
				viewModel.restoreEditorViewState({
					editingCells: [false],
					editorViewStates: [null],
					cellTotalHeights: [50],
					cellLineNumberStates: {},
					collapsedInputCells: {},
					collapsedOutputCells: {},
				});

				const cellList = createNotebookCellList(instantiationService, disposables);
				cellList.attachViewModel(viewModel);

				cellList.layout(100, 100);

				assert.deepStrictEqual(cellList.visibleRanges, [{ start: 0, end: 1 }]);
			});
	});
});
