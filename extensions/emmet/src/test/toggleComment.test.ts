/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { Selection } from 'vscode';
import { withRandomFileEditor, closeAllEditors } from './testUtils';
import { toggleComment as toggleCommentImpl } from '../toggleComment';

function toggleComment(): Thenable<boolean> {
	const result = toggleCommentImpl();
	assert.ok(result);
	return result!;
}

suite('Tests for Toggle Comment action from Emmet (HTML)', () => {
	teardown(closeAllEditors);

	const contents = `
	<div class="hello">
		<ul>
			<li><span>Hello</span></li>
			<li><span>There</span></li>
			<div><li><span>Bye</span></li></div>
		</ul>
		<ul>
			<!-- <li>Previously Commented Node</li> -->
			<li>Another Node</li>
		</ul>
		<span/>
		<style>
			.boo {
				margin: 10px;
				padding: 20px;
			}
			.hoo {
				margin: 10px;
				padding: 20px;
			}
		</style>
	</div>
	`;

	test('toggle comment with multiple cursors, but no selection (HTML)', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><!-- <span>Hello</span> --></li>
			<!-- <li><span>There</span></li> -->
			<!-- <div><li><span>Bye</span></li></div> -->
		</ul>
		<!-- <ul>
			<li>Previously Commented Node</li>
			<li>Another Node</li>
		</ul> -->
		<span/>
		<style>
			.boo {
				/* margin: 10px; */
				padding: 20px;
			}
			/* .hoo {
				margin: 10px;
				padding: 20px;
			} */
		</style>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 17, 3, 17),
				new Selection(4, 5, 4, 5),
				new Selection(5, 35, 5, 35),
				new Selection(7, 3, 7, 3),
				new Selection(14, 8, 14, 8),
				new Selection(18, 3, 18, 3)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('toggle comment with multiple cursors and whole node selected (HTML)', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><!-- <span>Hello</span> --></li>
			<!-- <li><span>There</span></li> -->
			<div><li><span>Bye</span></li></div>
		</ul>
		<!-- <ul>
			<li>Previously Commented Node</li>
			<li>Another Node</li>
		</ul> -->
		<span/>
		<style>
			.boo {
				/* margin: 10px; */
				padding: 20px;
			}
			/* .hoo {
				margin: 10px;
				padding: 20px;
			} */
		</style>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 7, 3, 25),
				new Selection(4, 3, 4, 30),
				new Selection(7, 2, 10, 7),
				new Selection(14, 4, 14, 17),
				new Selection(17, 3, 20, 4)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('toggle comment when multiple nodes are completely under single selection (HTML)', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<!-- <li><span>Hello</span></li>
			<li><span>There</span></li> -->
			<div><li><span>Bye</span></li></div>
		</ul>
		<ul>
			<!-- <li>Previously Commented Node</li> -->
			<li>Another Node</li>
		</ul>
		<span/>
		<style>
			.boo {
				/* margin: 10px;
				padding: 20px; */
			}
			.hoo {
				margin: 10px;
				padding: 20px;
			}
		</style>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 4, 4, 30),
				new Selection(14, 4, 15, 18)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('toggle comment when multiple nodes are partially under single selection (HTML)', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<!-- <li><span>Hello</span></li>
			<li><span>There</span></li> -->
			<div><li><span>Bye</span></li></div>
		</ul>
		<!-- <ul>
			<li>Previously Commented Node</li>
			<li>Another Node</li>
		</ul> -->
		<span/>
		<style>
			.boo {
				margin: 10px;
				padding: 20px;
			}
			.hoo {
				margin: 10px;
				padding: 20px;
			}
		</style>
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 24, 4, 20),
				new Selection(7, 2, 9, 10)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('toggle comment with multiple cursors selecting parent and child nodes', () => {
		const expectedContents = `
	<div class="hello">
		<ul>
			<li><!-- <span>Hello</span> --></li>
			<!-- <li><span>There</span></li> -->
			<div><li><span>Bye</span></li></div>
		</ul>
		<!-- <ul>
			<li>Previously Commented Node</li>
			<li>Another Node</li>
		</ul> -->
		<span/>
		<!-- <style>
			.boo {
				margin: 10px;
				padding: 20px;
			}
			.hoo {
				margin: 10px;
				padding: 20px;
			}
		</style> -->
	</div>
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(3, 17, 3, 17),
				new Selection(4, 5, 4, 5),
				new Selection(4, 17, 4, 17),
				new Selection(7, 3, 7, 3),
				new Selection(9, 10, 9, 10),
				new Selection(12, 3, 12, 3),
				new Selection(14, 8, 14, 8),
				new Selection(18, 3, 18, 3),
				new Selection(19, 8, 19, 8)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);

				return Promise.resolve();
			});
		});
	});

	test('toggle comment within script template', () => {
		const templateContents = `
	<script type="text/template">
		<li><span>Hello</span></li>
		<li><!-- <span>There</span> --></li>
		<div><li><span>Bye</span></li></div>
		<span/>
	</script>
	`;
		const expectedContents = `
	<script type="text/template">
		<!-- <li><span>Hello</span></li> -->
		<li><span>There</span></li>
		<div><li><!-- <span>Bye</span> --></li></div>
		<span/>
	</script>
	`;
		return withRandomFileEditor(templateContents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(2, 2, 2, 28),
				new Selection(3, 17, 3, 17),
				new Selection(4, 18, 4, 18),
			];
			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});
});

suite('Tests for Toggle Comment action from Emmet (CSS)', () => {
	teardown(closeAllEditors);

	const contents = `
	.one {
		margin: 10px;
		padding: 10px;
	}
	.two {
		height: 42px;
		display: none;
	}
	.three {
		width: 42px;
	}`;

	test('toggle comment with multiple cursors, but no selection (CSS)', () => {
		const expectedContents = `
	.one {
		/* margin: 10px; */
		padding: 10px;
	}
	/* .two {
		height: 42px;
		display: none;
	} */
	.three {
		width: 42px;
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 5, 2, 5),
				new Selection(5, 4, 5, 4),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment with multiple cursors and whole node selected (CSS)', () => {
		const expectedContents = `
	.one {
		/* margin: 10px; */
		/* padding: 10px; */
	}
	/* .two {
		height: 42px;
		display: none;
	} */
	.three {
		width: 42px;
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 2, 2, 15),
				new Selection(3, 0, 3, 16),
				new Selection(5, 1, 8, 2),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});



	test('toggle comment when multiple nodes of same parent are completely under single selection (CSS)', () => {
		const expectedContents = `
	.one {
/* 		margin: 10px;
		padding: 10px; */
	}
	/* .two {
		height: 42px;
		display: none;
	}
	.three {
		width: 42px;
	} */`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 0, 3, 16),
				new Selection(5, 1, 11, 2),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment when start and end of selection is inside properties of separate rules (CSS)', () => {
		const expectedContents = `
	.one {
		margin: 10px;
		/* padding: 10px;
	}
	.two {
		height: 42px; */
		display: none;
	}
	.three {
		width: 42px;
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(3, 7, 6, 6)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment when selection spans properties of separate rules, with start in whitespace and end inside the property (CSS)', () => {
		const expectedContents = `
	.one {
		margin: 10px;
		/* padding: 10px;
	}
	.two {
		height: 42px; */
		display: none;
	}
	.three {
		width: 42px;
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(3, 0, 6, 6)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment when selection spans properties of separate rules, with end in whitespace and start inside the property (CSS)', () => {
		const expectedContents = `
	.one {
		margin: 10px;
		/* padding: 10px;
	}
	.two {
		height: 42px; */
		display: none;
	}
	.three {
		width: 42px;
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(3, 7, 7, 0)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment when selection spans properties of separate rules, with both start and end in whitespace (CSS)', () => {
		const expectedContents = `
	.one {
		margin: 10px;
		/* padding: 10px;
	}
	.two {
		height: 42px; */
		display: none;
	}
	.three {
		width: 42px;
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(3, 0, 7, 0)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment when multiple nodes of same parent are partially under single selection (CSS)', () => {
		const expectedContents = `
	.one {
		/* margin: 10px;
		padding: 10px; */
	}
	/* .two {
		height: 42px;
		display: none;
	}
	.three {
		width: 42px;
 */	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 7, 3, 10),
				new Selection(5, 2, 11, 0),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});


});


suite('Tests for Toggle Comment action from Emmet in nested css (SCSS)', () => {
	teardown(closeAllEditors);

	const contents = `
	.one {
		height: 42px;

		.two {
			width: 42px;
		}

		.three {
			padding: 10px;
		}
	}`;

	test('toggle comment with multiple cursors selecting nested nodes (SCSS)', () => {
		const expectedContents = `
	.one {
		/* height: 42px; */

		/* .two {
			width: 42px;
		} */

		.three {
			/* padding: 10px; */
		}
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 5, 2, 5),
				new Selection(4, 4, 4, 4),
				new Selection(5, 5, 5, 5),
				new Selection(9, 5, 9, 5)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});
	test('toggle comment with multiple cursors selecting several nested nodes (SCSS)', () => {
		const expectedContents = `
	/* .one {
		height: 42px;

		.two {
			width: 42px;
		}

		.three {
			padding: 10px;
		}
	} */`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(1, 3, 1, 3),
				new Selection(2, 5, 2, 5),
				new Selection(4, 4, 4, 4),
				new Selection(5, 5, 5, 5),
				new Selection(9, 5, 9, 5)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment with multiple cursors, but no selection (SCSS)', () => {
		const expectedContents = `
	.one {
		/* height: 42px; */

		/* .two {
			width: 42px;
		} */

		.three {
			/* padding: 10px; */
		}
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 5, 2, 5),
				new Selection(4, 4, 4, 4),
				new Selection(9, 5, 9, 5)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return Promise.resolve();
			});
		});
	});

	test('toggle comment with multiple cursors and whole node selected (CSS)', () => {
		const expectedContents = `
	.one {
		/* height: 42px; */

		/* .two {
			width: 42px;
		} */

		.three {
			/* padding: 10px; */
		}
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 2, 2, 15),
				new Selection(4, 2, 6, 3),
				new Selection(9, 3, 9, 17)
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});



	test('toggle comment when multiple nodes are completely under single selection (CSS)', () => {
		const expectedContents = `
	.one {
		/* height: 42px;

		.two {
			width: 42px;
		} */

		.three {
			padding: 10px;
		}
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 2, 6, 3),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment when multiple nodes are partially under single selection (CSS)', () => {
		const expectedContents = `
	.one {
		/* height: 42px;

		.two {
			width: 42px;
	 */	}

		.three {
			padding: 10px;
		}
	}`;
		return withRandomFileEditor(contents, 'css', (editor, doc) => {
			editor.selections = [
				new Selection(2, 6, 6, 1),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});

	test('toggle comment doesn\'t fail when start and end nodes differ HTML', () => {
		const contents = `
	<div>
		<p>Hello</p>
	</div>
	`;
		const expectedContents = `
	<!-- <div>
		<p>Hello</p>
	</div> -->
	`;
		return withRandomFileEditor(contents, 'html', (editor, doc) => {
			editor.selections = [
				new Selection(1, 2, 2, 9),
			];

			return toggleComment().then(() => {
				assert.strictEqual(doc.getText(), expectedContents);
				return toggleComment().then(() => {
					assert.strictEqual(doc.getText(), contents);
					return Promise.resolve();
				});
			});
		});
	});
});
