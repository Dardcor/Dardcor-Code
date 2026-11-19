/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { Selection, workspace, ConfigurationTarget } from 'vscode';
import { withRandomFileEditor, closeAllEditors } from './testUtils';
import { removeTag } from '../removeTag';
import { updateTag } from '../updateTag';
import { matchTag } from '../matchTag';
import { splitJoinTag } from '../splitJoinTag';
import { mergeLines } from '../mergeLines';

suite('Tests for Emmet actions on html tags', () => {
	teardown(closeAllEditors);

	const contents = `
	<div class="hello">
		<ul>
			<li><span>Hello</span></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<span/>
	</div>
	`;

	const spacedContents = `
	<div class="hello">
		<ul>

			<li><span>Hello</span></li>

			<li><span>There</span></li>

			<div><li><span>Bye</span></li></div>


		</ul>
		<span/>
	</div>
	`;

	const contentsWithTemplate = `
	<script type="text/template">
		<ul>
			<li><span>Hello</span></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<span/>
	</script>
	`;

	test('update tag with multiple cursors', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><section>Hello</section></li>
			<section><span>There</span></section>
			<section><li><span>Bye</span></li></section>
		</ul>
		<span/>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 17, 3, 17),
				new Selection(4, 5, 4, 5),
				new Selection(5, 35, 5, 35),
			];

			return updateTag('section')!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('update tag with entire node selected', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><section>Hello</section></li>
			<li><span>There</span></li>
			<section><li><span>Bye</span></li></section>
		</ul>
		<span/>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 7, 3, 25),
				new Selection(5, 3, 5, 39),
			];

			return updateTag('section')!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('update tag with template', () => {
		const expectedContents = `
	<script type="text/template">
		<section>
			<li><span>Hello</span></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</section>
		<span/>
	</script>
	`;

		return withRandomFileEditor(contentsWithTemplate, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(2, 4, 2, 4),
			];

			return updateTag('section')!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('remove tag with multiple cursors', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li>Hello</li>
			<span>There</span>
			<li><span>Bye</span></li>
		</ul>
		<span/>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 17, 3, 17),
				new Selection(4, 5, 4, 5),
				new Selection(5, 35, 5, 35),
			];

			return removeTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('remove tag with boundary conditions', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li>Hello</li>
			<li><span>There</span></li>
			<li><span>Bye</span></li>
		</ul>
		<span/>
	</div>
	`;

		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 7, 3, 25),
				new Selection(5, 3, 5, 39),
			];

			return removeTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});


	test('remove tag with template', () => {
		const expectedContents = `
	<script type="text/template">
		<li><span>Hello</span></li>
		<li><span>There</span></li>
		<div><li><span>Bye</span></li></div>
		<span/>
	</script>
	`;
		return withRandomFileEditor(contentsWithTemplate, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(2, 4, 2, 4),
			];

			return removeTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('remove tag with extra trim', () => {
		const expectedContents = `
	<div class="hello">
		<li><span>Hello</span></li>

		<li><span>There</span></li>

		<div><li><span>Bye</span></li></div>
		<span/>
	</div>
	`;
		return withRandomFileEditor(spacedContents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(2, 4, 2, 4),
			];

			return removeTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('split/join tag with multiple cursors', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><span/></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<span></span>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 17, 3, 17),
				new Selection(7, 5, 7, 5),
			];

			return splitJoinTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('split/join tag with boundary selection', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><span/></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<span></span>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 7, 3, 25),
				new Selection(7, 2, 7, 9),
			];

			return splitJoinTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('split/join tag with templates', () => {
		const expectedContents = `
	<script type="text/template">
		<ul>
			<li><span/></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<span></span>
	</script>
	`;
		return withRandomFileEditor(contentsWithTemplate, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 17, 3, 17),
				new Selection(7, 5, 7, 5),
			];

			return splitJoinTag()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('split/join tag in jsx with xhtml self closing tag', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><span /></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<span></span>
	</div>
	`;
		const oldValueForSyntaxProfiles = workspace.getConfiguration('emmet').inspect('syntaxProfiles');
		return workspace.getConfiguration('emmet').update('syntaxProfiles', { jsx: { selfClosingStyle: 'xhtml' } }, ConfigurationTarget.Global).then(() => {
			return withRandomFileEditor(contents, 'jsx', (editor, doc) => {
				editor.selections = [
					new Selection(3, 17, 3, 17),
					new Selection(7, 5, 7, 5),
				];

				return splitJoinTag()!.then(() => {
					assert.strictEqual(doc.getText(), expectedContents);
					return workspace.getConfiguration('emmet').update('syntaxProfiles', oldValueForSyntaxProfiles ? oldValueForSyntaxProfiles.globalValue : undefined, ConfigurationTarget.Global);
				});
			});
		});
	});

	test('match tag with multiple cursors', () => {
		return withRandomFileEditor(contents, 'html', (editor, _) => {
			editor.selections = [
				new Selection(1, 0, 1, 0),
				new Selection(1, 1, 1, 1),
				new Selection(1, 2, 1, 2),
				new Selection(1, 6, 1, 6),
				new Selection(1, 18, 1, 18),
				new Selection(1, 19, 1, 19),
			];

			matchTag();

			editor.selections.forEach(selection => {
				assert.strictEqual(selection.active.line, 8);
				assert.strictEqual(selection.active.character, 3);
				assert.strictEqual(selection.anchor.line, 8);
				assert.strictEqual(selection.anchor.character, 3);
			});

			return Promise.resolve();
		});
	});

	test('match tag with template scripts', () => {
		const templateScript = `
	<script type="text/template">
		<div>
			Hello
		</div>
	</script>`;

		return withRandomFileEditor(templateScript, 'html', (editor, _) => {
			editor.selections = [
				new Selection(2, 2, 2, 2),
			];

			matchTag();

			editor.selections.forEach(selection => {
				assert.strictEqual(selection.active.line, 4);
				assert.strictEqual(selection.active.character, 4);
				assert.strictEqual(selection.anchor.line, 4);
				assert.strictEqual(selection.anchor.character, 4);
			});

			return Promise.resolve();
		});
	});


	test('merge lines of tag with children when empty selection', () => {
		const expectedContents = `
	<div class="hello">
		<ul><li><span>Hello</span></li><li><span>There</span></li><div><li><span>Bye</span></li></div></ul>
		<span/>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(2, 3, 2, 3)
			];

			return mergeLines()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('merge lines of tag with children when full node selection', () => {
		const expectedContents = `
	<div class="hello">
		<ul><li><span>Hello</span></li><li><span>There</span></li><div><li><span>Bye</span></li></div></ul>
		<span/>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(2, 3, 6, 7)
			];

			return mergeLines()!.then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('merge lines is no-op when start and end nodes are on the same line', () => {
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 9, 3, 9),
				new Selection(4, 5, 4, 5),
				new Selection(5, 5, 5, 20)
			];

			return mergeLines()!.then(() => {
				assert.strictEqual(doc.getText(), contents);
				return Promise.resolve();
			});
		});
	});
});

