/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../../base/common/map.js';
import { transaction } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { SyncDescriptor } from '../../../../../../platform/instantiation/common/descriptors.js';
import { ServiceCollection } from '../../../../../../platform/instantiation/common/serviceCollection.js';
import { workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { INotebookService } from '../../../../notebook/common/notebookService.js';
import { ChatEditingCheckpointTimelineImpl, IChatEditingTimelineFsDelegate } from '../../../browser/chatEditing/chatEditingCheckpointTimelineImpl.js';
import { FileOperation, FileOperationType } from '../../../browser/chatEditing/chatEditingOperations.js';
import { IModifiedEntryTelemetryInfo } from '../../../common/editing/chatEditingService.js';

suite('ChatEditingCheckpointTimeline', function () {

	const store = new DisposableStore();
	let timeline: ChatEditingCheckpointTimelineImpl;
	let fileContents: ResourceMap<string>;
	let fileDelegate: IChatEditingTimelineFsDelegate;

	const DEFAULT_TELEMETRY_INFO: IModifiedEntryTelemetryInfo = upcastPartial({
		agentId: 'testAgent',
		command: undefined,
		sessionResource: URI.parse('chat://test-session'),
		requestId: 'test-request',
		result: undefined,
		modelId: undefined,
		modeId: undefined,
		applyCodeBlockSuggestionId: undefined,
		feature: undefined,
	});

	function createTextEditOperation(uri: URI, requestId: string, epoch: number, edits: { range: Range; text: string }[]): FileOperation {
		return upcastPartial<FileOperation>({
			type: FileOperationType.TextEdit,
			uri,
			requestId,
			epoch,
			edits
		});
	}

	function createFileCreateOperation(uri: URI, requestId: string, epoch: number, initialContent: string): FileOperation {
		return upcastPartial<FileOperation>({
			type: FileOperationType.Create,
			uri,
			requestId,
			epoch,
			initialContent
		});
	}

	function createFileDeleteOperation(uri: URI, requestId: string, epoch: number, finalContent: string): FileOperation {
		return upcastPartial<FileOperation>({
			type: FileOperationType.Delete,
			uri,
			requestId,
			epoch,
			finalContent
		});
	}

	function createFileRenameOperation(oldUri: URI, newUri: URI, requestId: string, epoch: number): FileOperation {
		return upcastPartial<FileOperation>({
			type: FileOperationType.Rename,
			uri: newUri,
			requestId,
			epoch,
			oldUri,
			newUri
		});
	}

	setup(function () {
		fileContents = new ResourceMap<string>();

		fileDelegate = {
			createFile: async (uri: URI, initialContent: string) => {
				fileContents.set(uri, initialContent);
			},
			deleteFile: async (uri: URI) => {
				fileContents.delete(uri);
			},
			renameFile: async (fromUri: URI, toUri: URI) => {
				const content = fileContents.get(fromUri);
				if (content !== undefined) {
					fileContents.set(toUri, content);
					fileContents.delete(fromUri);
				}
			},
			setContents: async (uri: URI, content: string) => {
				fileContents.set(uri, content);
			}
		};

		const collection = new ServiceCollection();
		collection.set(INotebookService, new SyncDescriptor(TestNotebookService));
		const insta = store.add(workbenchInstantiationService(undefined, store).createChild(collection));

		timeline = insta.createInstance(ChatEditingCheckpointTimelineImpl, URI.parse('chat://test-session'), fileDelegate);
	});

	teardown(() => {
		store.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates initial checkpoint on construction', function () {
		const checkpoints = timeline.getStateForPersistence().checkpoints;
		assert.strictEqual(checkpoints.length, 1);
		assert.strictEqual(checkpoints[0].requestId, undefined);
		assert.strictEqual(checkpoints[0].label, 'Initial State');
	});

	test('canUndo and canRedo are initially false', function () {
		assert.strictEqual(timeline.canUndo.get(), false);
		assert.strictEqual(timeline.canRedo.get(), false);
	});

	test('createCheckpoint increments epoch and creates checkpoint', function () {
		const initialEpoch = timeline.getStateForPersistence().epochCounter;

		timeline.createCheckpoint('req1', 'stop1', 'Checkpoint 1');

		const state = timeline.getStateForPersistence();
		assert.strictEqual(state.checkpoints.length, 2);
		assert.strictEqual(state.checkpoints[1].requestId, 'req1');
		assert.strictEqual(state.checkpoints[1].undoStopId, 'stop1');
		assert.strictEqual(state.checkpoints[1].label, 'Checkpoint 1');
		assert.strictEqual(state.epochCounter, initialEpoch + 1);
	});

	test('createCheckpoint does not create duplicate checkpoints', function () {
		timeline.createCheckpoint('req1', 'stop1', 'Checkpoint 1');
		timeline.createCheckpoint('req1', 'stop1', 'Checkpoint 1 Duplicate');

		const checkpoints = timeline.getStateForPersistence().checkpoints;
		assert.strictEqual(checkpoints.length, 2);
		assert.strictEqual(checkpoints[1].label, 'Checkpoint 1');
	});

	test('incrementEpoch increases epoch counter', function () {
		const initialEpoch = timeline.getStateForPersistence().epochCounter;

		const epoch1 = timeline.incrementEpoch();
		const epoch2 = timeline.incrementEpoch();

		assert.strictEqual(epoch1, initialEpoch);
		assert.strictEqual(epoch2, initialEpoch + 1);
		assert.strictEqual(timeline.getStateForPersistence().epochCounter, initialEpoch + 2);
	});

	test('recordFileBaseline stores baseline', function () {
		const uri = URI.parse('file:///test.txt');
		const baseline = upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial content',
			epoch: 1,
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		});

		timeline.recordFileBaseline(baseline);

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);
		assert.strictEqual(timeline.hasFileBaseline(uri, 'req2'), false);
	});

	test('recordFileOperation stores operation', function () {
		const uri = URI.parse('file:///test.txt');
		const operation = createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 1), text: 'hello' }]
		);

		timeline.recordFileOperation(operation);

		const state = timeline.getStateForPersistence();
		assert.strictEqual(state.operations.length, 1);
		assert.strictEqual(state.operations[0].type, FileOperationType.TextEdit);
		assert.strictEqual(state.operations[0].requestId, 'req1');
	});

	test('basic undo/redo with text edits', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'hello',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start of Request');

		const editEpoch = timeline.incrementEpoch();
		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			editEpoch,
			[{ range: new Range(1, 1, 1, 6), text: 'goodbye' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'After Edit');

		assert.strictEqual(timeline.canUndo.get(), true);
		assert.strictEqual(timeline.canRedo.get(), false);

		await timeline.undoToLastCheckpoint();

		assert.strictEqual(timeline.canUndo.get(), false);
		assert.strictEqual(timeline.canRedo.get(), true);

		await timeline.redoToNextCheckpoint();

		assert.strictEqual(timeline.canUndo.get(), true);
	});

	test('file creation and deletion operations', async function () {
		const uri = URI.parse('file:///new.txt');

		const createEpoch = timeline.incrementEpoch();

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'new file content',
			epoch: createEpoch,
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createFileCreateOperation(
			uri,
			'req1',
			createEpoch,
			'new file content'
		));

		timeline.createCheckpoint('req1', 'created', 'File Created');

		await timeline.navigateToCheckpoint(timeline.getStateForPersistence().checkpoints[0].checkpointId);
		assert.strictEqual(fileContents.has(uri), false);

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'created')!);
		assert.strictEqual(fileContents.get(uri), 'new file content');

		const deleteEpoch = timeline.incrementEpoch();
		timeline.recordFileOperation(createFileDeleteOperation(
			uri,
			'req1',
			deleteEpoch,
			'new file content'
		));

		timeline.createCheckpoint('req1', 'deleted', 'File Deleted');

		await timeline.navigateToCheckpoint(timeline.getStateForPersistence().checkpoints[0].checkpointId);
		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'deleted')!);
		assert.strictEqual(fileContents.has(uri), false);

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(fileContents.get(uri), 'new file content');

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(fileContents.has(uri), false);
	});

	test('file rename operations', async function () {
		const oldUri = URI.parse('file:///old.txt');
		const newUri = URI.parse('file:///new.txt');

		const createEpoch = timeline.incrementEpoch();

		timeline.recordFileBaseline(upcastPartial({
			uri: oldUri,
			requestId: 'req1',
			content: 'content',
			epoch: createEpoch,
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createFileCreateOperation(
			oldUri,
			'req1',
			createEpoch,
			'content'
		));

		timeline.createCheckpoint('req1', 'created', 'File Created');

		await timeline.navigateToCheckpoint(timeline.getStateForPersistence().checkpoints[0].checkpointId);
		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'created')!);
		assert.strictEqual(fileContents.get(oldUri), 'content');

		const renameEpoch = timeline.incrementEpoch();
		timeline.recordFileOperation(createFileRenameOperation(
			oldUri,
			newUri,
			'req1',
			renameEpoch
		));

		timeline.createCheckpoint('req1', 'renamed', 'File Renamed');

		await timeline.navigateToCheckpoint(timeline.getStateForPersistence().checkpoints[0].checkpointId);
		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'renamed')!);
		assert.strictEqual(fileContents.has(oldUri), false);
		assert.strictEqual(fileContents.get(newUri), 'content');

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(fileContents.get(oldUri), 'content');
		assert.strictEqual(fileContents.has(newUri), false);
	});

	test('multiple sequential edits to same file', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'line1\nline2\nline3',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 6), text: 'LINE1' }]
		));

		timeline.createCheckpoint('req1', 'edit1', 'Edit 1');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(2, 1, 2, 6), text: 'LINE2' }]
		));

		timeline.createCheckpoint('req1', 'edit2', 'Edit 2');

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'edit1')!);
		assert.strictEqual(fileContents.get(uri), 'LINE1\nline2\nline3');

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'edit2')!);
		assert.strictEqual(fileContents.get(uri), 'LINE1\nLINE2\nline3');

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', undefined)!);
		assert.strictEqual(fileContents.get(uri), 'line1\nline2\nline3');
	});

	test('getCheckpointIdForRequest returns correct checkpoint', function () {
		timeline.createCheckpoint('req1', undefined, 'Start of req1');
		timeline.createCheckpoint('req1', 'stop1', 'Stop 1');
		timeline.createCheckpoint('req2', undefined, 'Start of req2');

		const req1Start = timeline.getCheckpointIdForRequest('req1', undefined);
		const req1Stop = timeline.getCheckpointIdForRequest('req1', 'stop1');
		const req2Start = timeline.getCheckpointIdForRequest('req2', undefined);

		assert.ok(req1Start);
		assert.ok(req1Stop);
		assert.ok(req2Start);
		assert.notStrictEqual(req1Start, req1Stop);
		assert.notStrictEqual(req1Start, req2Start);
	});

	test('getCheckpointIdForRequest returns undefined for non-existent checkpoint', function () {
		const checkpoint = timeline.getCheckpointIdForRequest('nonexistent', 'stop1');
		assert.strictEqual(checkpoint, undefined);
	});

	test('requestDisablement tracks disabled requests', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.createCheckpoint('req1', undefined, 'Start req1');
		timeline.recordFileOperation(createFileCreateOperation(uri, 'req1', timeline.incrementEpoch(), 'a'));

		timeline.createCheckpoint('req1', 'stop1', 'Stop req1');
		timeline.recordFileOperation(createTextEditOperation(uri, 'req1', timeline.incrementEpoch(), [{ range: new Range(1, 1, 1, 2), text: 'b' }]));

		timeline.createCheckpoint('req2', undefined, 'Start req2');
		timeline.recordFileOperation(createTextEditOperation(uri, 'req2', timeline.incrementEpoch(), [{ range: new Range(1, 1, 1, 2), text: 'c' }]));

		assert.deepStrictEqual(timeline.requestDisablement.get(), []);

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(fileContents.get(uri), 'b');
		assert.deepStrictEqual(timeline.requestDisablement.get(), [
			{ requestId: 'req2', afterUndoStop: undefined },
		]);

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(fileContents.get(uri), 'a');
		assert.deepStrictEqual(timeline.requestDisablement.get(), [
			{ requestId: 'req2', afterUndoStop: undefined },
			{ requestId: 'req1', afterUndoStop: 'stop1' },
		]);

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(fileContents.get(uri), undefined);
		assert.deepStrictEqual(timeline.requestDisablement.get(), [
			{ requestId: 'req2', afterUndoStop: undefined },
			{ requestId: 'req1', afterUndoStop: undefined },
		]);

		await timeline.redoToNextCheckpoint();
		assert.strictEqual(fileContents.get(uri), 'a');
		assert.deepStrictEqual(timeline.requestDisablement.get(), [
			{ requestId: 'req2', afterUndoStop: undefined },
			{ requestId: 'req1', afterUndoStop: 'stop1' },
		]);

		await timeline.redoToNextCheckpoint();
		assert.strictEqual(fileContents.get(uri), 'b');
		assert.deepStrictEqual(timeline.requestDisablement.get(), [
			{ requestId: 'req2', afterUndoStop: undefined },
		]);

		await timeline.redoToNextCheckpoint();
		assert.strictEqual(fileContents.get(uri), 'c');
	});

	test('persistence - save and restore state', function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 8), text: 'modified' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'Edit Complete');

		const savedState = timeline.getStateForPersistence();

		const collection = new ServiceCollection();
		collection.set(INotebookService, new SyncDescriptor(TestNotebookService));
		const insta = store.add(workbenchInstantiationService(undefined, store).createChild(collection));

		const newTimeline = insta.createInstance(
			ChatEditingCheckpointTimelineImpl,
			URI.parse('chat://test-session-2'),
			fileDelegate
		);

		transaction(tx => {
			newTimeline.restoreFromState(savedState, tx);
		});

		const restoredState = newTimeline.getStateForPersistence();
		assert.strictEqual(restoredState.checkpoints.length, savedState.checkpoints.length);
		assert.strictEqual(restoredState.operations.length, savedState.operations.length);
		assert.strictEqual(restoredState.currentEpoch, savedState.currentEpoch);
		assert.strictEqual(restoredState.epochCounter, savedState.epochCounter);
	});

	test('navigating between multiple requests', async function () {
		const uri1 = URI.parse('file:///file1.txt');
		const uri2 = URI.parse('file:///file2.txt');

		timeline.createCheckpoint('req1', undefined, 'Start req1');

		const create1Epoch = timeline.incrementEpoch();
		timeline.recordFileBaseline(upcastPartial({
			uri: uri1,
			requestId: 'req1',
			content: 'file1 modified',
			epoch: create1Epoch,
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createFileCreateOperation(
			uri1,
			'req1',
			create1Epoch,
			'file1 modified'
		));

		timeline.createCheckpoint('req1', 'stop1', 'Req1 complete');

		timeline.createCheckpoint('req2', undefined, 'Start req2');

		const create2Epoch = timeline.incrementEpoch();
		timeline.recordFileBaseline(upcastPartial({
			uri: uri2,
			requestId: 'req2',
			content: 'file2 modified',
			epoch: create2Epoch,
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createFileCreateOperation(
			uri2,
			'req2',
			create2Epoch,
			'file2 modified'
		));

		timeline.createCheckpoint('req2', 'stop1', 'Req2 complete');

		await timeline.navigateToCheckpoint(timeline.getStateForPersistence().checkpoints[0].checkpointId);
		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'stop1')!);
		assert.strictEqual(fileContents.get(uri1), 'file1 modified');
		assert.strictEqual(fileContents.has(uri2), false);

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req2', 'stop1')!);
		assert.strictEqual(fileContents.get(uri1), 'file1 modified');
		assert.strictEqual(fileContents.get(uri2), 'file2 modified');

		const initialCheckpoint = timeline.getStateForPersistence().checkpoints[0];
		await timeline.navigateToCheckpoint(initialCheckpoint.checkpointId);
		assert.strictEqual(fileContents.has(uri1), false);
		assert.strictEqual(fileContents.has(uri2), false);
	});

	test('getContentURIAtStop returns snapshot URI', function () {
		const fileUri = URI.parse('file:///test.txt');
		const snapshotUri = timeline.getContentURIAtStop('req1', fileUri, 'stop1');

		assert.ok(snapshotUri);
		assert.notStrictEqual(snapshotUri.toString(), fileUri.toString());
		assert.ok(snapshotUri.toString().includes('req1'));
	});

	test('undoing entire request when appropriate', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start req1');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 8), text: 'modified' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'Edit complete');

		assert.strictEqual(timeline.canUndo.get(), true);

		await timeline.undoToLastCheckpoint();

		const state = timeline.getStateForPersistence();
		assert.strictEqual(state.currentEpoch, 2);
	});

	test('operations use incrementing epochs', function () {
		const uri = URI.parse('file:///test.txt');

		const epoch1 = timeline.incrementEpoch();
		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			epoch1,
			[{ range: new Range(1, 1, 1, 1), text: 'edit1' }]
		));

		const epoch2 = timeline.incrementEpoch();
		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			epoch2,
			[{ range: new Range(2, 1, 2, 1), text: 'edit2' }]
		));

		const operations = timeline.getStateForPersistence().operations;
		assert.strictEqual(operations.length, 2);
		assert.strictEqual(operations[0].epoch, epoch1);
		assert.strictEqual(operations[1].epoch, epoch2);
	});

	test('navigateToCheckpoint throws error for invalid checkpoint ID', async function () {
		let errorThrown = false;
		try {
			await timeline.navigateToCheckpoint('invalid-checkpoint-id');
		} catch (error) {
			errorThrown = true;
			assert.ok(error instanceof Error);
			assert.ok((error as Error).message.includes('not found'));
		}
		assert.ok(errorThrown, 'Expected error to be thrown');
	});

	test('navigateToCheckpoint does nothing when already at target epoch', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		const createEpoch = timeline.incrementEpoch();
		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			createEpoch,
			[{ range: new Range(1, 1, 1, 8), text: 'modified' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'Checkpoint');

		const checkpointId = timeline.getCheckpointIdForRequest('req1', 'stop1')!;
		await timeline.navigateToCheckpoint(checkpointId);

		const stateBefore = timeline.getStateForPersistence();
		await timeline.navigateToCheckpoint(checkpointId);
		const stateAfter = timeline.getStateForPersistence();

		assert.strictEqual(stateBefore.currentEpoch, stateAfter.currentEpoch);
	});

	test('recording operation after undo truncates future history', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 8), text: 'edit1' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'Edit 1');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 6), text: 'edit2' }]
		));

		timeline.createCheckpoint('req1', 'stop2', 'Edit 2');

		const stateWithTwoEdits = timeline.getStateForPersistence();
		assert.strictEqual(stateWithTwoEdits.operations.length, 2);

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'stop1')!);

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 6), text: 'edit3' }]
		));

		const stateAfterNewEdit = timeline.getStateForPersistence();
		assert.strictEqual(stateAfterNewEdit.operations.length, 2);
		assert.strictEqual(stateAfterNewEdit.operations[1].type, FileOperationType.TextEdit);
	});

	test('redo after recording new operation should work', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 8), text: 'edit1' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'Edit 1');

		await timeline.undoToLastCheckpoint();
		assert.strictEqual(timeline.canRedo.get(), true);

		await timeline.redoToNextCheckpoint();

		assert.strictEqual(timeline.canUndo.get(), true);
	});

	test('redo when there is no checkpoint after operation', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 8), text: 'edit1' }]
		));

		const startCheckpoint = timeline.getCheckpointIdForRequest('req1', undefined)!;
		await timeline.navigateToCheckpoint(startCheckpoint);

		assert.strictEqual(timeline.canRedo.get(), true);

		await timeline.redoToNextCheckpoint();
		const state = timeline.getStateForPersistence();
		assert.ok(state.currentEpoch > 1);
	});

	test('getContentAtStop returns empty for non-existent file', async function () {
		const uri = URI.parse('file:///nonexistent.txt');
		const content = await timeline.getContentAtStop('req1', uri, 'stop1');

		assert.strictEqual(content, '');
	});

	test('getContentAtStop with epoch-based stopId', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		const editEpoch = timeline.incrementEpoch();
		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			editEpoch,
			[{ range: new Range(1, 1, 1, 8), text: 'modified' }]
		));

		const content = await timeline.getContentAtStop('req1', uri, `__epoch_${editEpoch + 1}`);

		assert.ok(content);
		assert.strictEqual(content, 'modified');
	});

	test('hasFileBaseline correctly reports baseline existence', function () {
		const uri = URI.parse('file:///test.txt');

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), false);

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'initial',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);
		assert.strictEqual(timeline.hasFileBaseline(uri, 'req2'), false);
	});

	test('hasFileBaseline returns true for files with create operations', function () {
		const uri = URI.parse('file:///created.txt');

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), false);

		timeline.recordFileOperation(createFileCreateOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			'created content'
		));

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);
		assert.strictEqual(timeline.hasFileBaseline(uri, 'req2'), false);
	});

	test('hasFileBaseline distinguishes between different request IDs for create operations', function () {
		const uri = URI.parse('file:///created.txt');

		timeline.recordFileOperation(createFileCreateOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			'content from req1'
		));

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);
		assert.strictEqual(timeline.hasFileBaseline(uri, 'req2'), false);
		assert.strictEqual(timeline.hasFileBaseline(uri, 'req3'), false);
	});

	test('hasFileBaseline returns true when both baseline and create operation exist', function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'baseline content',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createFileCreateOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			'created content'
		));

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);
	});

	test('hasFileBaseline with create operation followed by edit', function () {
		const uri = URI.parse('file:///created-and-edited.txt');

		timeline.recordFileOperation(createFileCreateOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			'initial content'
		));

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 16), text: 'edited content' }]
		));

		assert.strictEqual(timeline.hasFileBaseline(uri, 'req1'), true);
	});

	test('multiple text edits to same file are properly replayed', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'line1\nline2\nline3',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', undefined, 'Start');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 6), text: 'LINE1' }]
		));

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(2, 1, 2, 6), text: 'LINE2' }]
		));

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(3, 1, 3, 6), text: 'LINE3' }]
		));

		timeline.createCheckpoint('req1', 'all-edits', 'All edits');

		const initialCheckpoint = timeline.getStateForPersistence().checkpoints[0];
		await timeline.navigateToCheckpoint(initialCheckpoint.checkpointId);
		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'all-edits')!);

		assert.strictEqual(fileContents.get(uri), 'LINE1\nLINE2\nLINE3');
	});

	test('checkpoint with same requestId and undoStopId is not duplicated', function () {
		timeline.createCheckpoint('req1', 'stop1', 'First');
		timeline.createCheckpoint('req1', 'stop1', 'Second');

		const checkpoints = timeline.getStateForPersistence().checkpoints;
		const req1Stop1Checkpoints = checkpoints.filter(c => c.requestId === 'req1' && c.undoStopId === 'stop1');

		assert.strictEqual(req1Stop1Checkpoints.length, 1);
		assert.strictEqual(req1Stop1Checkpoints[0].label, 'First');
	});

	test('finding baseline after file rename operation', async function () {
		const oldUri = URI.parse('file:///old.txt');
		const newUri = URI.parse('file:///new.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri: oldUri,
			requestId: 'req1',
			content: 'initial content',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createTextEditOperation(
			oldUri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 16), text: 'modified content' }]
		));

		timeline.recordFileOperation(createFileRenameOperation(
			oldUri,
			newUri,
			'req1',
			timeline.incrementEpoch()
		));

		timeline.createCheckpoint('req1', 'renamed', 'After rename');

		const content = await timeline.getContentAtStop('req1', newUri, 'renamed');
		assert.strictEqual(content, 'modified content');
	});

	test('baseline lookup across different request IDs', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'req1 content',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 13), text: 'req1 modified' }]
		));

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req2',
			content: 'req2 content',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req2',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 13), text: 'req2 modified' }]
		));

		timeline.createCheckpoint('req2', 'stop1', 'Req2 checkpoint');

		const content = await timeline.getContentAtStop('req2', uri, 'stop1');
		assert.strictEqual(content, 'req2 modified');
	});

	test('getContentAtStop with file that does not exist in operations', async function () {
		const uri = URI.parse('file:///test.txt');

		timeline.recordFileBaseline(upcastPartial({
			uri,
			requestId: 'req1',
			content: 'content',
			epoch: timeline.incrementEpoch(),
			telemetryInfo: DEFAULT_TELEMETRY_INFO
		}));

		timeline.createCheckpoint('req1', 'stop1', 'Checkpoint');

		const differentUri = URI.parse('file:///different.txt');
		const content = await timeline.getContentAtStop('req1', differentUri, 'stop1');

		assert.strictEqual(content, '');
	});

	test('undoToLastCheckpoint when canUndo is false does nothing', async function () {
		assert.strictEqual(timeline.canUndo.get(), false);

		const stateBefore = timeline.getStateForPersistence();
		await timeline.undoToLastCheckpoint();
		const stateAfter = timeline.getStateForPersistence();

		assert.strictEqual(stateBefore.currentEpoch, stateAfter.currentEpoch);
	});

	test('redoToNextCheckpoint when canRedo is false does nothing', async function () {
		assert.strictEqual(timeline.canRedo.get(), false);

		const stateBefore = timeline.getStateForPersistence();
		await timeline.redoToNextCheckpoint();
		const stateAfter = timeline.getStateForPersistence();

		assert.strictEqual(stateBefore.currentEpoch, stateAfter.currentEpoch);
	});

	test('orphaned operations and checkpoints are removed after undo and new changes', async function () {
		const uri = URI.parse('file:///test.txt');

		const createEpoch = timeline.incrementEpoch();

		timeline.recordFileOperation(createFileCreateOperation(
			uri,
			'req1',
			createEpoch,
			'initial content'
		));

		timeline.createCheckpoint('req1', undefined, 'Start req1');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 16), text: 'first edit' }]
		));

		timeline.createCheckpoint('req1', 'stop1', 'First Edit');

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 11), text: 'second edit' }]
		));

		timeline.createCheckpoint('req1', 'stop2', 'Second Edit');

		let state = timeline.getStateForPersistence();
		assert.strictEqual(state.operations.length, 3);
		assert.strictEqual(state.checkpoints.length, 4);

		await timeline.navigateToCheckpoint(timeline.getCheckpointIdForRequest('req1', 'stop1')!);

		timeline.recordFileOperation(createTextEditOperation(
			uri,
			'req1',
			timeline.incrementEpoch(),
			[{ range: new Range(1, 1, 1, 11), text: 'replacement edit' }]
		));

		timeline.createCheckpoint('req1', 'stop2-new', 'Replacement Edit');

		state = timeline.getStateForPersistence();
		assert.strictEqual(state.operations.length, 3, 'Should still have 3 operations (create + first + replacement)');
		assert.strictEqual(state.checkpoints.length, 4, 'Should have 4 checkpoints (initial, start, stop1, stop2-new)');

		const thirdOp = state.operations[2];
		assert.strictEqual(thirdOp.type, FileOperationType.TextEdit);
		if (thirdOp.type === FileOperationType.TextEdit) {
			assert.strictEqual(thirdOp.edits[0].text, 'replacement edit');
		}

		const stop2NewCheckpoint = timeline.getCheckpointIdForRequest('req1', 'stop2-new');
		const stop2OldCheckpoint = timeline.getCheckpointIdForRequest('req1', 'stop2');
		assert.ok(stop2NewCheckpoint, 'New checkpoint should exist');
		assert.strictEqual(stop2OldCheckpoint, undefined, 'Old orphaned checkpoint should be removed');

		const initialCheckpoint = state.checkpoints[0];
		const startCheckpoint = timeline.getCheckpointIdForRequest('req1', undefined)!;
		const stop1Checkpoint = timeline.getCheckpointIdForRequest('req1', 'stop1')!;
		const stop2NewCheckpointId = timeline.getCheckpointIdForRequest('req1', 'stop2-new')!;

		await timeline.navigateToCheckpoint(initialCheckpoint.checkpointId);
		assert.strictEqual(fileContents.has(uri), false);

		await timeline.navigateToCheckpoint(startCheckpoint);
		assert.strictEqual(fileContents.get(uri), 'initial content');

		await timeline.navigateToCheckpoint(stop1Checkpoint);
		assert.strictEqual(fileContents.get(uri), 'first edit');

		await timeline.navigateToCheckpoint(stop2NewCheckpointId);
		assert.strictEqual(fileContents.get(uri), 'replacement edit');

		await timeline.navigateToCheckpoint(startCheckpoint);
		assert.strictEqual(fileContents.get(uri), 'initial content');

		await timeline.navigateToCheckpoint(stop1Checkpoint);
		assert.strictEqual(fileContents.get(uri), 'first edit');

		await timeline.navigateToCheckpoint(stop2NewCheckpointId);
		assert.strictEqual(fileContents.get(uri), 'replacement edit', 'Orphaned edit should never reappear');

		await timeline.navigateToCheckpoint(initialCheckpoint.checkpointId);
		await timeline.navigateToCheckpoint(stop2NewCheckpointId);
		assert.strictEqual(fileContents.get(uri), 'replacement edit', 'Content should still be correct after full timeline traversal');
	});

	test('undo/redo with multiple no-edit requests advances one request at a time', async function () {
		timeline.createCheckpoint('req1', undefined, 'Start req1');

		timeline.createCheckpoint('req2', undefined, 'Start req2');

		timeline.createCheckpoint('req3', undefined, 'Start req3');

		timeline.createCheckpoint('req4', undefined, 'Start req4');

		assert.strictEqual(timeline.canUndo.get(), true);

		await timeline.undoToLastCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4']);

		await timeline.undoToLastCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4', 'req3']);

		await timeline.undoToLastCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4', 'req3', 'req2']);

		await timeline.undoToLastCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4', 'req3', 'req2', 'req1']);

		assert.strictEqual(timeline.canUndo.get(), false);

		assert.strictEqual(timeline.canRedo.get(), true);

		await timeline.redoToNextCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4', 'req3', 'req2']);

		await timeline.redoToNextCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4', 'req3']);

		await timeline.redoToNextCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), ['req4']);

		await timeline.redoToNextCheckpoint();
		assert.deepStrictEqual(timeline.requestDisablement.get().map(d => d.requestId), []);

		assert.strictEqual(timeline.canRedo.get(), false);
	});
});

class TestNotebookService {
	getNotebookTextModel() { return undefined; }
	hasSupportedNotebooks() { return false; }
}
