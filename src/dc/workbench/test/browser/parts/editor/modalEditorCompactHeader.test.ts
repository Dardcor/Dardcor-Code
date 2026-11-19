/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModalEditorOptions, IModalEditorOptionsProvider, isModalEditorOptionsProvider } from '../../../../../platform/editor/common/editor.js';

const MODAL_HEADER_HEIGHT = 33;

function applyCompactHeaderClass(modalElement: { classList: DOMTokenList }, activeEditor: unknown): void {
	const editorModalOptions = isModalEditorOptionsProvider(activeEditor) ? activeEditor.getModalEditorOptions() : undefined;
	modalElement.classList.toggle('compact-header', !!editorModalOptions?.compactHeader);
}

function resolveHeaderHeight(headerElement: { offsetHeight: number }): number {
	return headerElement.offsetHeight || MODAL_HEADER_HEIGHT;
}

class TestEditor implements IModalEditorOptionsProvider {
	constructor(private readonly options: IModalEditorOptions | undefined) { }
	getModalEditorOptions(): IModalEditorOptions | undefined { return this.options; }
}

suite('Modal Editor Compact Header', () => {

	const disposables = new DisposableStore();

	teardown(() => disposables.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	test('isModalEditorOptionsProvider type guard', () => {
		assert.strictEqual(isModalEditorOptionsProvider(undefined), false);
		assert.strictEqual(isModalEditorOptionsProvider(null), false);
		assert.strictEqual(isModalEditorOptionsProvider({}), false);
		assert.strictEqual(isModalEditorOptionsProvider({ getModalEditorOptions: 'nope' }), false);
		assert.strictEqual(isModalEditorOptionsProvider(new TestEditor({ compactHeader: true })), true);
	});

	test('compact-header class toggles based on active editor options', () => {
		const modalElement = document.createElement('div');

		applyCompactHeaderClass(modalElement, undefined);
		assert.strictEqual(modalElement.classList.contains('compact-header'), false);

		applyCompactHeaderClass(modalElement, { });
		assert.strictEqual(modalElement.classList.contains('compact-header'), false);

		applyCompactHeaderClass(modalElement, new TestEditor(undefined));
		assert.strictEqual(modalElement.classList.contains('compact-header'), false);

		applyCompactHeaderClass(modalElement, new TestEditor({ compactHeader: false }));
		assert.strictEqual(modalElement.classList.contains('compact-header'), false);

		applyCompactHeaderClass(modalElement, new TestEditor({ compactHeader: true }));
		assert.strictEqual(modalElement.classList.contains('compact-header'), true);

		applyCompactHeaderClass(modalElement, new TestEditor({ compactHeader: false }));
		assert.strictEqual(modalElement.classList.contains('compact-header'), false);
	});

	test('header height prefers measured offsetHeight over fallback constant', () => {
		assert.strictEqual(resolveHeaderHeight({ offsetHeight: 0 }), MODAL_HEADER_HEIGHT);

		assert.strictEqual(resolveHeaderHeight({ offsetHeight: 33 }), 33);

		assert.strictEqual(resolveHeaderHeight({ offsetHeight: 40 }), 40);
	});
});
