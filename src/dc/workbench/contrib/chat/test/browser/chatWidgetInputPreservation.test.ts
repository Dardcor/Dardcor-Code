/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IChatWidget, setModelPreservingInputTypedWhileLoading } from '../../browser/chat.js';

suite('setModelPreservingInputTypedWhileLoading', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class FakeInputWidget {
		constructor(private input: string, private readonly boundDraft: string) { }
		getInput(): string { return this.input; }
		setInput(query?: string): void { this.input = query ?? ''; }
		bind(): void { this.input = this.boundDraft; }
		asWidget(): IChatWidget { return this as unknown as IChatWidget; }
	}

	test('restores text typed during load onto an empty session', () => {
		const widget = new FakeInputWidget( '', '');
		const inputBeforeLoad = widget.getInput();
		widget.setInput('the');

		setModelPreservingInputTypedWhileLoading(widget.asWidget(), inputBeforeLoad, () => widget.bind());

		assert.strictEqual(widget.getInput(), 'the');
	});

	test('does not clobber the loaded session\'s own persisted draft', () => {
		const widget = new FakeInputWidget('', 'session draft');
		const inputBeforeLoad = widget.getInput();
		widget.setInput('the');

		setModelPreservingInputTypedWhileLoading(widget.asWidget(), inputBeforeLoad, () => widget.bind());

		assert.strictEqual(widget.getInput(), 'session draft');
	});

	test('does not carry a previous session\'s leftover draft over on a plain switch', () => {
		const widget = new FakeInputWidget('previous draft', '');
		const inputBeforeLoad = widget.getInput();

		setModelPreservingInputTypedWhileLoading(widget.asWidget(), inputBeforeLoad, () => widget.bind());

		assert.strictEqual(widget.getInput(), '');
	});

});
