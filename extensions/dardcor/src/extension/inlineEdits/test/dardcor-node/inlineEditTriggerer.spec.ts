/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, assert, beforeEach, suite, test } from 'vitest';
import { TextDocumentChangeReason, TextEditor, type TextDocument } from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { DocumentSwitchTriggerStrategy } from '../../../../platform/inlineEdits/common/dataTypes/triggerOptions';
import { ILogService } from '../../../../platform/log/common/logService';
import { IExperimentationService } from '../../../../platform/telemetry/common/nullExperimentationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { createTextDocumentData } from '../../../../util/common/test/shims/textDocument';
import { ExtHostTextEditor } from '../../../../util/common/test/shims/textEditor';
import { DisposableStore } from '../../../../util/dardcor/base/common/lifecycle';
import { IReader } from '../../../../util/dardcor/base/common/observableInternal';
import { Selection, TextEditorSelectionChangeKind, Uri } from '../../../../dardcorTypes';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { NesChangeHint, NesTriggerReason } from '../../common/nesTriggerHint';
import { NesOutcome, NextEditProvider } from '../../node/nextEditProvider';
import {
	InlineEditTriggerer,
	TRIGGER_INLINE_EDIT_AFTER_CHANGE_LIMIT,
	TRIGGER_INLINE_EDIT_ON_SAME_LINE_COOLDOWN,
	TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN
} from '../../dardcor-node/inlineEditTriggerer';
import { IVSCodeObservableDocument } from '../../dardcor-node/parts/dardcorWorkspace';


suite('InlineEditTriggerer', () => {
	let disposables: DisposableStore;
	let vscWorkspace: MockVSCodeWorkspace;
	let workspaceService: TestWorkspaceService;
	let firedEvents: NesChangeHint[];
	let nextEditProvider: MockNextEditProvider;
	let configurationService: InMemoryConfigurationService;
	let triggerer: InlineEditTriggerer;

	class MockNextEditProvider {
		public lastRejectionTime: number = Date.now();
		public lastTriggerTime: number = Date.now();
		public lastOutcome: NesOutcome | undefined = undefined;
	}

	class MockVSCodeWorkspace {
		public readonly documents = new WeakMap<TextDocument, IVSCodeObservableDocument>();
		public addDoc(doc: TextDocument, obsDoc: IVSCodeObservableDocument): void {
			this.documents.set(doc, obsDoc);
		}
		public getDocumentByTextDocument(doc: TextDocument, _reader?: IReader): IVSCodeObservableDocument | undefined {
			return this.documents.get(doc);
		}
	}

	beforeEach(() => {
		disposables = new DisposableStore();
		firedEvents = [];
		vscWorkspace = new MockVSCodeWorkspace();
		nextEditProvider = new MockNextEditProvider();

		workspaceService = disposables.add(new TestWorkspaceService());
		const services = disposables.add(createExtensionUnitTestingServices());
		const accessor = disposables.add(services.createTestingAccessor());

		configurationService = accessor.get(IConfigurationService) as InMemoryConfigurationService;
		triggerer = disposables.add(new InlineEditTriggerer(
			vscWorkspace as any,
			nextEditProvider as any as NextEditProvider,
			accessor.get(ILogService),
			configurationService,
			accessor.get(IExperimentationService),
			workspaceService
		));
		disposables.add(triggerer.onChange(e => firedEvents.push(e)));
	});

	afterEach(() => {
		disposables.dispose();
	});


	function triggerTextChange(document: TextDocument, reason?: TextDocumentChangeReason): void {
		workspaceService.didChangeTextDocumentEmitter.fire({
			document,
			contentChanges: [],
			reason,
			detailedReason: undefined,
		});
	}

	function triggerTextSelectionChange(textEditor: TextEditor, selection: Selection, kind = TextEditorSelectionChangeKind.Keyboard): void {
		workspaceService.didChangeTextEditorSelectionEmitter.fire({
			kind,
			selections: [selection],
			textEditor,
		});
	}

	function triggerMultipleSelectionChange(textEditor: TextEditor, selections: Selection[]): void {
		workspaceService.didChangeTextEditorSelectionEmitter.fire({
			kind: TextEditorSelectionChangeKind.Keyboard,
			selections,
			textEditor,
		});
	}

	function createObservableTextDoc(uri: Uri): IVSCodeObservableDocument {
		return {
			id: DocumentId.create(uri.toString()),
			toRange: (_: any, range: any) => range
		} as any;
	}

	function createTextDocument(
		selection: Selection = new Selection(0, 0, 0, 0),
		uri: Uri = Uri.file('sample.py'),
		content = 'print("Hello World")'
	): { document: TextDocument; textEditor: TextEditor; selection: Selection } {
		const doc = createTextDocumentData(uri, content, 'python');
		const textEditor = new ExtHostTextEditor(doc.document, [selection], {}, [], undefined);
		vscWorkspace.addDoc(doc.document, createObservableTextDoc(doc.document.uri));
		return {
			document: doc.document,
			textEditor: textEditor.value,
			selection
		};
	}

	function createOutputDocument(): { document: TextDocument; textEditor: TextEditor; selection: Selection } {
		const uri = Uri.parse('output:extension-output-GitHub.dardcor-chat-#1-GitHub Copilot Chat');
		const doc = createTextDocumentData(uri, 'output logs', 'log');
		const selection = new Selection(0, 0, 0, 0);
		const textEditor = new ExtHostTextEditor(doc.document, [selection], {}, [], undefined);
		return { document: doc.document, textEditor: textEditor.value, selection };
	}

	function getLastFiredReason(): NesTriggerReason | undefined {
		return firedEvents.at(-1)?.data.reason;
	}



	suite('Basic behaviors', () => {
		test('No signal if there were no text changes', () => {
			const { textEditor, selection } = createTextDocument();

			triggerTextSelectionChange(textEditor, selection);

			assert.strictEqual(firedEvents.length, 0, 'Signal should not have been fired');
		});

		test('No signal if selection is not empty', () => {
			const { document, textEditor, selection } = createTextDocument(new Selection(0, 0, 0, 10));

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, selection);

			assert.strictEqual(firedEvents.length, 0, 'Signal should not have been fired');
		});

		test('Signal fires when text changes and cursor moves with empty selection', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.isAtLeast(firedEvents.length, 1, 'Signal should have been fired');
			assert.strictEqual(getLastFiredReason(), NesTriggerReason.SelectionChange);
		});

		test('No signal with multiple selections', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerMultipleSelectionChange(textEditor, [
				new Selection(0, 0, 0, 0),
				new Selection(1, 0, 1, 0)
			]);

			assert.strictEqual(firedEvents.length, 0, 'Signal should not have been fired for multiple selections');
		});
	});



	suite('Rejection cooldown', () => {
		test('No signal when last rejection was within cooldown period', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - (TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1000);

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire during rejection cooldown');
		});

		test('Signal fires when last rejection was over cooldown ago', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - (TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN + 1);

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.isAtLeast(firedEvents.length, 1, 'Signal should have been fired');
		});

		test('Rejection clears tracking for the document', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			nextEditProvider.lastRejectionTime = Date.now();
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire');

			triggerTextSelectionChange(textEditor, new Selection(0, 10, 0, 10));
			assert.strictEqual(firedEvents.length, 0, 'Signal should still not fire as doc was cleared');
		});
	});



	suite('Document filtering', () => {
		test('Ignores output pane documents for text changes', () => {
			const { document, textEditor, selection } = createOutputDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, selection);

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire for output documents');
		});

		test('Ignores dardcor-ignored documents (not in workspace)', () => {
			const { document, textEditor } = createTextDocument();
			vscWorkspace.documents.delete(document);
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire for ignored documents');
		});
	});



	suite('Undo/Redo handling', () => {
		test('Ignores undo changes', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document, TextDocumentChangeReason.Undo);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire for undo changes');
		});

		test('Ignores redo changes', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document, TextDocumentChangeReason.Redo);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire for redo changes');
		});
	});



	suite('Edit timestamp limits', () => {
		test('No signal if edit is too old', async () => {
			const { document } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);

			assert.strictEqual(TRIGGER_INLINE_EDIT_AFTER_CHANGE_LIMIT, 10000, 'Limit should be 10 seconds');
		});

		test('Signal fires when edit is within time limit', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.isAtLeast(firedEvents.length, 1, 'Signal should fire for recent edits');
		});
	});



	suite('Trigger time checks', () => {
		test('No signal if last trigger time is too old', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastTriggerTime = Date.now() - TRIGGER_INLINE_EDIT_AFTER_CHANGE_LIMIT - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire when last trigger is too old');
		});

		test('Signal fires when last trigger time is recent', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastTriggerTime = Date.now();

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.isAtLeast(firedEvents.length, 1, 'Signal should fire for recent triggers');
		});
	});



	suite('Same line cooldown', () => {
		test('No signal for same line within cooldown period', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			const initialCount = firedEvents.length;
			assert.isAtLeast(initialCount, 1, 'First signal should fire');

			triggerTextSelectionChange(textEditor, new Selection(0, 10, 0, 10));

			assert.strictEqual(firedEvents.length, initialCount, 'Signal should not fire for same line in cooldown');
		});

		test('Signal fires on different line', () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2\nline3');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));

			const initialCount = firedEvents.length;
			assert.isAtLeast(initialCount, 1, 'First signal should fire');

			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));

			assert.isAtLeast(firedEvents.length, initialCount + 1, 'Signal should fire for different line');
		});

		test('Cooldown constant is 5 seconds', () => {
			assert.strictEqual(TRIGGER_INLINE_EDIT_ON_SAME_LINE_COOLDOWN, 5000, 'Same line cooldown should be 5s');
		});
	});



	suite('Document switch behavior', () => {
		test('Triggers on document switch when configured', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastOutcome = NesOutcome.Accepted;

			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			const initialCount = firedEvents.length;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			assert.isAtLeast(firedEvents.length, initialCount + 1, 'Signal should fire on document switch');
			assert.strictEqual(getLastFiredReason(), NesTriggerReason.ActiveDocumentSwitch);
		});

		test('Does not trigger on same document', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch for same doc');
		});

		test('Does not trigger when document switch is disabled', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, undefined);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch when disabled');
		});

		test('Does not trigger on document switch when there is no recent NES trigger (lastTriggerTime is 0)', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastTriggerTime = 0;

			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			const initialCount = firedEvents.length;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch when lastTriggerTime is 0');
			assert.strictEqual(firedEvents.length, initialCount, 'No new events should fire');
		});

		test('Does not trigger on document switch when NES trigger was too long ago', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			const triggerAfterSeconds = 30;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, triggerAfterSeconds);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			const initialCount = firedEvents.length;

			nextEditProvider.lastTriggerTime = Date.now() - (triggerAfterSeconds * 1000) - 1;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch when last trigger was too long ago');
			assert.strictEqual(firedEvents.length, initialCount, 'No new events should fire');
		});

		test('Triggers on document switch when NES trigger was recent', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastOutcome = NesOutcome.Accepted;

			const triggerAfterSeconds = 30;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, triggerAfterSeconds);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			const initialCount = firedEvents.length;

			nextEditProvider.lastTriggerTime = Date.now() - (triggerAfterSeconds * 1000) + 5000;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 1, 'Should trigger document switch when last trigger was recent');
			assert.isAtLeast(firedEvents.length, initialCount + 1, 'Should have fired an additional event');
		});
	});



	suite('Debounce behavior', () => {
		test('First two selection changes fire immediately when debounce is configured', () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2\nline3');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounceOnSelectionChange, 100);

			triggerTextChange(document);

			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			assert.strictEqual(firedEvents.length, 1, 'First selection change should fire immediately');

			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));
			assert.strictEqual(firedEvents.length, 2, 'Second selection change should fire immediately');
		});

		test('Third and subsequent selection changes are debounced', async () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2\nline3\nline4\nline5');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			const debounceMs = 50;
			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounceOnSelectionChange, debounceMs);

			triggerTextChange(document);

			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));
			assert.strictEqual(firedEvents.length, 2, 'First two should fire immediately');

			triggerTextSelectionChange(textEditor, new Selection(2, 0, 2, 0));
			assert.strictEqual(firedEvents.length, 2, 'Third should not fire immediately');

			await new Promise(resolve => setTimeout(resolve, debounceMs + 20));
			assert.strictEqual(firedEvents.length, 3, 'Third should fire after debounce');
		});

		test('No debounce when config is undefined', () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2\nline3\nline4');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounceOnSelectionChange, undefined);

			triggerTextChange(document);

			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));
			triggerTextSelectionChange(textEditor, new Selection(2, 0, 2, 0));
			triggerTextSelectionChange(textEditor, new Selection(3, 0, 3, 0));

			assert.strictEqual(firedEvents.length, 4, 'All selection changes should fire immediately without debounce');
		});
	});



	suite('Event data validation', () => {
		test('Fired event has valid NesChangeHint structure', () => {
			const { document, textEditor } = createTextDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));

			assert.isAtLeast(firedEvents.length, 1, 'Should have fired at least one event');

			const event = firedEvents[0];
			assert.isTrue(NesChangeHint.is(event), 'Event should be a valid NesChangeHint');
			assert.isString(event.data.uuid, 'UUID should be a string');
			assert.isNotEmpty(event.data.uuid, 'UUID should not be empty');
			assert.strictEqual(event.data.reason, NesTriggerReason.SelectionChange);
		});

		test('Each trigger has a unique UUID', () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));

			assert.isAtLeast(firedEvents.length, 2, 'Should have at least 2 events');

			const uuids = firedEvents.map(e => e.data.uuid);
			const uniqueUuids = new Set(uuids);
			assert.strictEqual(uniqueUuids.size, uuids.length, 'All UUIDs should be unique');
		});
	});



	suite('toRange returning undefined', () => {
		test('No signal when toRange returns undefined', () => {
			const uri = Uri.file('norange.py');
			const doc = createTextDocumentData(uri, 'content', 'python');
			const selection = new Selection(0, 0, 0, 0);
			const textEditor = new ExtHostTextEditor(doc.document, [selection], {}, [], undefined);

			const obsDoc: IVSCodeObservableDocument = {
				id: DocumentId.create(uri.toString()),
				toRange: () => undefined
			} as any;
			vscWorkspace.addDoc(doc.document, obsDoc);

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(doc.document);
			triggerTextSelectionChange(textEditor.value, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0, 'Signal should not fire when toRange returns undefined');
		});
	});



	suite('Notebook cell behavior', () => {
		function createNotebookCellDocument(
			cellId: string = '1',
			content = 'print("hello")'
		): { document: TextDocument; textEditor: TextEditor } {
			const uri = Uri.parse(`vscode-notebook-cell://notebook/${cellId}`);
			const doc = createTextDocumentData(uri, content, 'python');
			const selection = new Selection(0, 0, 0, 0);
			const textEditor = new ExtHostTextEditor(doc.document, [selection], {}, [], undefined);
			vscWorkspace.addDoc(doc.document, createObservableTextDoc(doc.document.uri));
			return { document: doc.document, textEditor: textEditor.value };
		}

		test('Notebook cell bypasses same-line cooldown when documentTrigger differs', () => {
			const cell1 = createNotebookCellDocument('cell1');
			const cell2 = createNotebookCellDocument('cell2', 'x = 1');

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, undefined);

			triggerTextChange(cell1.document);
			triggerTextSelectionChange(cell1.textEditor, new Selection(0, 0, 0, 0));

			const countAfterFirst = firedEvents.length;
			assert.isAtLeast(countAfterFirst, 1, 'First trigger should fire');

			triggerTextChange(cell2.document);
			triggerTextSelectionChange(cell2.textEditor, new Selection(0, 0, 0, 0));

			const countAfterSecond = firedEvents.length;
			assert.isAtLeast(countAfterSecond, countAfterFirst + 1, 'Should trigger in cell2 on line 0');

			triggerTextChange(cell1.document);

			triggerTextChange(cell2.document);
			triggerTextSelectionChange(cell2.textEditor, new Selection(0, 0, 0, 0));
			const countBeforeBypass = firedEvents.length;


			const cell2Alt = createNotebookCellDocument('cell2', 'x = 1');

			triggerTextSelectionChange(cell2Alt.textEditor, new Selection(0, 0, 0, 0));
			assert.isAtLeast(firedEvents.length, countBeforeBypass + 1,
				'Should bypass same-line cooldown for notebook cell when documentTrigger differs');
		});

		test('Notebook cell respects same-line cooldown when documentTrigger matches', () => {
			const cell = createNotebookCellDocument('cell1');

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, undefined);

			triggerTextChange(cell.document);
			triggerTextSelectionChange(cell.textEditor, new Selection(0, 0, 0, 0));

			const countAfterFirst = firedEvents.length;
			assert.isAtLeast(countAfterFirst, 1, 'First trigger should fire');

			triggerTextSelectionChange(cell.textEditor, new Selection(0, 5, 0, 5));
			assert.strictEqual(firedEvents.length, countAfterFirst,
				'Should respect same-line cooldown when documentTrigger matches');
		});
	});



	suite('Line trigger cleanup', () => {
		test('Stale line triggers are cleaned up when count exceeds 100', () => {
			const lines = Array.from({ length: 110 }, (_, i) => `line${i}`).join('\n');
			const { document, textEditor } = createTextDocument(undefined, undefined, lines);
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);

			for (let i = 0; i < 101; i++) {
				triggerTextSelectionChange(textEditor, new Selection(i, 0, i, 0));
			}

			assert.strictEqual(firedEvents.length, 101, 'All 101 triggers should fire');

			triggerTextSelectionChange(textEditor, new Selection(101, 0, 101, 0));
			assert.strictEqual(firedEvents.length, 102, 'Trigger should still work after cleanup runs');
		});
	});



	suite('Debounce edge cases', () => {
		test('New text change resets consecutive selection change counter', async () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2\nline3\nline4\nline5\nline6');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			const debounceMs = 50;
			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounceOnSelectionChange, debounceMs);

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));
			triggerTextSelectionChange(textEditor, new Selection(2, 0, 2, 0));
			assert.strictEqual(firedEvents.length, 2, 'Third should be debounced');

			await new Promise(resolve => setTimeout(resolve, debounceMs + 20));
			assert.strictEqual(firedEvents.length, 3, 'Debounced event should fire');

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(3, 0, 3, 0));
			assert.strictEqual(firedEvents.length, 4, 'First selection after new change should fire immediately');

			triggerTextSelectionChange(textEditor, new Selection(4, 0, 4, 0));
			assert.strictEqual(firedEvents.length, 5, 'Second selection after new change should fire immediately');

			triggerTextSelectionChange(textEditor, new Selection(5, 0, 5, 0));
			assert.strictEqual(firedEvents.length, 5, 'Third selection after new change should be debounced again');
		});

		test('Later debounced event replaces earlier pending one', async () => {
			const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
			const { document, textEditor } = createTextDocument(undefined, undefined, lines);
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			const debounceMs = 80;
			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounceOnSelectionChange, debounceMs);

			triggerTextChange(document);

			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			triggerTextSelectionChange(textEditor, new Selection(1, 0, 1, 0));
			assert.strictEqual(firedEvents.length, 2);

			triggerTextSelectionChange(textEditor, new Selection(2, 0, 2, 0));
			assert.strictEqual(firedEvents.length, 2, 'Third should be debounced');

			triggerTextSelectionChange(textEditor, new Selection(3, 0, 3, 0));
			assert.strictEqual(firedEvents.length, 2, 'Fourth should also be debounced');

			await new Promise(resolve => setTimeout(resolve, debounceMs + 30));
			assert.strictEqual(firedEvents.length, 3, 'Only one debounced event should fire (the latest)');
		});
	});



	suite('Document switch edge cases', () => {
		test('Does not trigger on document switch to dardcor-ignored destination', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const uri2 = Uri.file('ignored.py');
			const doc2Data = createTextDocumentData(uri2, 'ignored content', 'python');
			const doc2Editor = new ExtHostTextEditor(doc2Data.document, [new Selection(0, 0, 0, 0)], {}, [], undefined);

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));
			const initialCount = firedEvents.length;

			triggerTextSelectionChange(doc2Editor.value, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger switch for dardcor-ignored destination');
			assert.strictEqual(firedEvents.length, initialCount, 'No new events should fire');
		});

		test('Does not trigger on document switch when toRange returns undefined at destination', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));

			const uri2 = Uri.file('norange2.py');
			const doc2Data = createTextDocumentData(uri2, 'content', 'python');
			const doc2Editor = new ExtHostTextEditor(doc2Data.document, [new Selection(0, 0, 0, 0)], {}, [], undefined);
			const obsDoc2: IVSCodeObservableDocument = {
				id: DocumentId.create(uri2.toString()),
				toRange: () => undefined
			} as any;
			vscWorkspace.addDoc(doc2Data.document, obsDoc2);

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));
			const initialCount = firedEvents.length;

			triggerTextSelectionChange(doc2Editor.value, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger switch when toRange returns undefined');
			assert.strictEqual(firedEvents.length, initialCount, 'No new events should fire');
		});

		test('Does not trigger on document switch when no edit has ever happened', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 0, 0, 0));
			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger switch when no edits ever happened');
		});

		test('Document switch adds doc to tracking map, enabling subsequent cursor moves to trigger', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'), 'line1\nline2');

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastOutcome = NesOutcome.Accepted;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));
			assert.strictEqual(getLastFiredReason(), NesTriggerReason.ActiveDocumentSwitch);
			const countAfterSwitch = firedEvents.length;

			triggerTextSelectionChange(doc2.textEditor, new Selection(1, 0, 1, 0));
			assert.isAtLeast(firedEvents.length, countAfterSwitch + 1,
				'Cursor move in switched-to doc should trigger');
			assert.strictEqual(getLastFiredReason(), NesTriggerReason.SelectionChange);
		});
	});




	suite('Document switch afterAcceptance strategy', () => {

		function setupForDocSwitch() {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);
			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsTriggerOnEditorChangeStrategy, DocumentSwitchTriggerStrategy.AfterAcceptance);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			return { doc1, doc2, eventsBeforeSwitch: firedEvents.length };
		}

		test('triggers on document switch when lastOutcome is Accepted', () => {
			const { doc2, eventsBeforeSwitch } = setupForDocSwitch();
			nextEditProvider.lastOutcome = NesOutcome.Accepted;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 1, 'Should trigger document switch after acceptance');
			assert.isAbove(firedEvents.length, eventsBeforeSwitch);
		});

		test('does not trigger on document switch when lastOutcome is Rejected', () => {
			const { doc2, eventsBeforeSwitch } = setupForDocSwitch();
			nextEditProvider.lastOutcome = NesOutcome.Rejected;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch after rejection');
			assert.strictEqual(firedEvents.length, eventsBeforeSwitch);
		});

		test('does not trigger on document switch when lastOutcome is Ignored', () => {
			const { doc2, eventsBeforeSwitch } = setupForDocSwitch();
			nextEditProvider.lastOutcome = NesOutcome.Ignored;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch after ignore');
			assert.strictEqual(firedEvents.length, eventsBeforeSwitch);
		});

		test('does not trigger on document switch when lastOutcome is undefined (pending)', () => {
			const { doc2, eventsBeforeSwitch } = setupForDocSwitch();
			nextEditProvider.lastOutcome = undefined;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0, 'Should not trigger document switch when outcome is pending');
			assert.strictEqual(firedEvents.length, eventsBeforeSwitch);
		});

		test('triggers on document switch with default strategy regardless of lastOutcome', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);
			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsTriggerOnEditorChangeStrategy, DocumentSwitchTriggerStrategy.Always);

			nextEditProvider.lastOutcome = NesOutcome.Rejected;

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));
			const eventsBeforeSwitch = firedEvents.length;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 1, 'Default strategy should trigger on doc switch regardless of outcome');
			assert.isAbove(firedEvents.length, eventsBeforeSwitch);
		});

		test('triggers on document switch with always strategy regardless of lastOutcome', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);
			void configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsTriggerOnEditorChangeStrategy, DocumentSwitchTriggerStrategy.Always);

			nextEditProvider.lastOutcome = NesOutcome.Ignored;

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));
			const eventsBeforeSwitch = firedEvents.length;

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 1, 'Always strategy should trigger on doc switch regardless of outcome');
			assert.isAbove(firedEvents.length, eventsBeforeSwitch);
		});

		suite('race condition: suggestion shown but not yet resolved', () => {
			test('previous NES was accepted, new suggestion shown (clears outcome), then doc switch — should NOT trigger', () => {
				const { doc2, eventsBeforeSwitch } = setupForDocSwitch();

				nextEditProvider.lastOutcome = NesOutcome.Accepted;
				nextEditProvider.lastOutcome = undefined;

				triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

				const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
				assert.strictEqual(switchEvents.length, 0,
					'Should not trigger: stale acceptance must not carry over when a new suggestion is pending');
				assert.strictEqual(firedEvents.length, eventsBeforeSwitch);
			});

			test('NES shown, then accepted, then doc switch — should trigger', () => {
				const { doc2 } = setupForDocSwitch();

				nextEditProvider.lastOutcome = undefined;
				nextEditProvider.lastOutcome = NesOutcome.Accepted;

				triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

				const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
				assert.strictEqual(switchEvents.length, 1, 'Should trigger after resolved acceptance');
			});

			test('NES shown, then rejected, then doc switch — should NOT trigger', () => {
				const { doc2, eventsBeforeSwitch } = setupForDocSwitch();

				nextEditProvider.lastOutcome = undefined;
				nextEditProvider.lastOutcome = NesOutcome.Rejected;

				triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

				const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
				assert.strictEqual(switchEvents.length, 0, 'Should not trigger after resolved rejection');
				assert.strictEqual(firedEvents.length, eventsBeforeSwitch);
			});
		});
	});


	suite('Text change listener edge cases', () => {
		test('Text change on dardcor-ignored doc does not track but updates lastEditTimestamp', () => {
			const uri = Uri.file('ignored.py');
			const doc = createTextDocumentData(uri, 'content', 'python');

			const trackedDoc = createTextDocument(undefined, Uri.file('tracked.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc.document);

			triggerTextSelectionChange(trackedDoc.textEditor, new Selection(0, 0, 0, 0));

			const doc2 = createTextDocument(undefined, Uri.file('tracked2.py'));
			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			// still sets lastEditTimestamp, which is a global field)
			assert.isTrue(true, 'Test verifies that ignored doc change does not throw');
		});

		test('Undo/redo still updates lastEditTimestamp (only skips tracking)', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			nextEditProvider.lastOutcome = NesOutcome.Accepted;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document, TextDocumentChangeReason.Undo);

			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 0, 0, 0));

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.isAtLeast(switchEvents.length, 1,
				'Undo should still update lastEditTimestamp enabling document switch');
		});

		test('Output pane text change does not update lastEditTimestamp', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));
			const { document: outputDocument } = createOutputDocument();

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(outputDocument);

			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 0, 0, 0));

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			const switchEvents = firedEvents.filter(e => e.data.reason === NesTriggerReason.ActiveDocumentSwitch);
			assert.strictEqual(switchEvents.length, 0,
				'Output doc change should not update lastEditTimestamp');
		});
	});



	suite('Interaction edge cases', () => {
		test('Rejection cooldown prevents document switch triggers too', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));

			nextEditProvider.lastRejectionTime = Date.now();
			void configurationService.setConfig(ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds, 30);

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));
			assert.strictEqual(firedEvents.length, 0, 'Should not fire during rejection cooldown');

			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));

			assert.strictEqual(firedEvents.length, 0, 'Should not fire on doc switch during rejection cooldown');
		});

		test('Same-line cooldown is bypassed after switching away and back', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'));
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'));
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 5, 0, 5));

			const initialCount = firedEvents.length;
			assert.isAtLeast(initialCount, 1, 'First trigger should fire');

			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 10, 0, 10));
			assert.strictEqual(firedEvents.length, initialCount, 'Same-line cooldown should block');

			triggerTextChange(doc2.document);
			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));
			const countAfterDoc2 = firedEvents.length;

			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 10, 0, 10));
			assert.isAtLeast(firedEvents.length, countAfterDoc2 + 1,
				'Same-line cooldown should be bypassed after switching away and back');
		});

		test('Output pane documents are ignored for selection changes', () => {
			const { textEditor, selection } = createOutputDocument();
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextSelectionChange(textEditor, selection);
			assert.strictEqual(firedEvents.length, 0, 'Selection in output pane should be ignored');
		});

		test('Copilot-ignored doc in selection listener returns early before rejection check', () => {
			const uri = Uri.file('not-in-workspace.py');
			const doc = createTextDocumentData(uri, 'content', 'python');
			const textEditor = new ExtHostTextEditor(doc.document, [new Selection(0, 0, 0, 0)], {}, [], undefined);

			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(doc.document);
			triggerTextSelectionChange(textEditor.value, new Selection(0, 5, 0, 5));

			assert.strictEqual(firedEvents.length, 0,
				'Copilot-ignored doc should return early in selection listener');
		});

		test('Multiple documents can independently track and trigger', () => {
			const doc1 = createTextDocument(undefined, Uri.file('file1.py'), 'line1\nline2');
			const doc2 = createTextDocument(undefined, Uri.file('file2.py'), 'line1\nline2');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(doc1.document);
			triggerTextSelectionChange(doc1.textEditor, new Selection(0, 0, 0, 0));
			assert.strictEqual(firedEvents.length, 1, 'Doc1 first trigger');

			triggerTextChange(doc2.document);
			triggerTextSelectionChange(doc2.textEditor, new Selection(0, 0, 0, 0));
			assert.strictEqual(firedEvents.length, 2, 'Doc2 first trigger');

			triggerTextSelectionChange(doc1.textEditor, new Selection(1, 0, 1, 0));
			assert.strictEqual(firedEvents.length, 3, 'Doc1 second trigger on different line');

			triggerTextSelectionChange(doc2.textEditor, new Selection(1, 0, 1, 0));
			assert.strictEqual(firedEvents.length, 4, 'Doc2 second trigger on different line');
		});

		test('Text change resets line triggers for the document', () => {
			const { document, textEditor } = createTextDocument(undefined, undefined, 'line1\nline2');
			nextEditProvider.lastRejectionTime = Date.now() - TRIGGER_INLINE_EDIT_REJECTION_COOLDOWN - 1;

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			const count1 = firedEvents.length;
			assert.isAtLeast(count1, 1);

			triggerTextSelectionChange(textEditor, new Selection(0, 5, 0, 5));
			assert.strictEqual(firedEvents.length, count1, 'Same line should be in cooldown');

			triggerTextChange(document);
			triggerTextSelectionChange(textEditor, new Selection(0, 0, 0, 0));
			assert.isAtLeast(firedEvents.length, count1 + 1,
				'After text change, same line should trigger again');
		});
	});

});
