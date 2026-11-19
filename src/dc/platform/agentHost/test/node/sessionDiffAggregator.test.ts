/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileEditKind, type ISessionFileDiff } from '../../common/state/sessionState.js';
import { encodeString, TestDiffComputeService, TestSessionDatabase } from '../common/sessionTestHelpers.js';
import { computeSessionDiffs, computeTurnDiffs, computeUnionedDiffs } from '../../node/sessionDiffAggregator.js';
import { parseSessionDbUri } from '../../common/sessionDbUri.js';

const TEST_SESSION_URI = 'session://test-session';

const createTestDiffService = () => new TestDiffComputeService();

function fileDiff(path: string, added: number, removed: number): ISessionFileDiff {
	const uri = URI.file(path).toString();
	return { after: { uri, content: { uri } }, diff: { added, removed } };
}

function getDiffUri(diff: ISessionFileDiff): string | undefined {
	return diff.after?.uri ?? diff.before?.uri;
}

interface ISimpleDiff {
	uri: string | undefined;
	added: number;
	removed: number;
}

function simplify(diff: ISessionFileDiff): ISimpleDiff {
	return {
		uri: getDiffUri(diff),
		added: diff.diff?.added ?? 0,
		removed: diff.diff?.removed ?? 0,
	};
}

function simpleDiff(path: string, added: number, removed: number): ISimpleDiff {
	return { uri: URI.file(path).toString(), added, removed };
}

suite('computeSessionDiffs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();


	test('returns empty array for no edits', async () => {
		const db = new TestSessionDatabase();
		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(TEST_SESSION_URI, db, diffService);
		assert.deepStrictEqual(result, []);
	});

	test('computes diffs for a single edited file', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('line1\nline2'), afterContent: encodeString('line1\nline2\nline3'),
		});

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(TEST_SESSION_URI, db, diffService);

		assert.deepStrictEqual(result.map(simplify), [simpleDiff('/a.txt', 1, 0)]);
		assert.strictEqual(diffService.callCount, 1);
	});

	test('populates before/after with session-db content URIs for edits', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('v1'), afterContent: encodeString('v2'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('v2'), afterContent: encodeString('v3'),
		});

		const result = await computeSessionDiffs(TEST_SESSION_URI, db, createTestDiffService());

		assert.strictEqual(result.length, 1);
		const [diff] = result;
		const fileUri = URI.file('/a.txt').toString();
		assert.strictEqual(diff.before?.uri, fileUri);
		assert.strictEqual(diff.after?.uri, fileUri);

		const beforeFields = parseSessionDbUri(diff.before!.content.uri);
		assert.deepStrictEqual(beforeFields, {
			sessionUri: TEST_SESSION_URI,
			toolCallId: 'tc1',
			filePath: '/a.txt',
			part: 'before',
		});

		const afterFields = parseSessionDbUri(diff.after!.content.uri);
		assert.deepStrictEqual(afterFields, {
			sessionUri: TEST_SESSION_URI,
			toolCallId: 'tc2',
			filePath: '/a.txt',
			part: 'after',
		});
	});

	test('omits before for creates and after for deletes', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/created.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('new'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/deleted.txt', kind: FileEditKind.Delete,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('bye'),
		});

		const result = await computeSessionDiffs(TEST_SESSION_URI, db, createTestDiffService());
		result.sort((a, b) => (getDiffUri(a) ?? '').localeCompare(getDiffUri(b) ?? ''));

		assert.strictEqual(result.length, 2);
		const [created, deleted] = result;
		assert.strictEqual(created.before, undefined, 'create has no before');
		assert.ok(created.after, 'create has after');
		assert.ok(deleted.before, 'delete has before');
		assert.strictEqual(deleted.after, undefined, 'delete has no after');
	});

	test('skips files with no net change', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('same'), afterContent: encodeString('different'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('different'), afterContent: encodeString('same'),
		});

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(TEST_SESSION_URI, db, diffService);

		assert.deepStrictEqual(result, []);
		assert.strictEqual(diffService.callCount, 0, 'no diff computation needed for zero net change');
	});

	test('tracks rename chains correctly', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('hello'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/b.txt', kind: FileEditKind.Rename, originalPath: '/a.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('hello'), afterContent: encodeString('hello world'),
		});

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(TEST_SESSION_URI, db, diffService);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(getDiffUri(result[0]), URI.file('/b.txt').toString(), 'uses terminal path after rename');
	});


	test('incremental: reuses previousDiffs for untouched files', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a-before'), afterContent: encodeString('a-after'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/b.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('b-before'), afterContent: encodeString('b-after\nnew'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 42, 7),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		result.sort((a, b) => (getDiffUri(a) ?? '').localeCompare(getDiffUri(b) ?? ''));

		assert.deepStrictEqual(result.map(simplify), [
			simpleDiff('/a.txt', 42, 7),
			simpleDiff('/b.txt', 1, 0),
		]);
		assert.strictEqual(diffService.callCount, 1, 'only touched file should be diffed');
	});

	test('incremental: recomputes file edited in current turn', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('original'), afterContent: encodeString('after-turn1'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('after-turn1'), afterContent: encodeString('after-turn2\nextra'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 100, 100),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.deepStrictEqual(result.map(simplify), [simpleDiff('/a.txt', 1, 0)]);
		assert.strictEqual(diffService.callCount, 1);
	});

	test('incremental: rename in current turn drops old URI from previousDiffs', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/old.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('content'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/new.txt', kind: FileEditKind.Rename,
			originalPath: '/old.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('content'), afterContent: encodeString('content'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/old.txt', 5, 0),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(getDiffUri(result[0]), URI.file('/new.txt').toString(), 'uses new URI after rename');
	});

	test('incremental: file with zero net change in current turn is excluded even if in previousDiffs', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('original'), afterContent: encodeString('modified'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('modified'), afterContent: encodeString('original'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 10, 5),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.deepStrictEqual(result, []);
	});

	test('incremental: previousDiffs entry for file not in current identities is dropped (slow path)', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('before'), afterContent: encodeString('after'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('after'), afterContent: encodeString('latest\nline'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 1, 0),
			fileDiff('/orphan.txt', 99, 99),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(getDiffUri(result[0]), URI.file('/a.txt').toString());
	});

	test('full mode recomputes all files (no incremental options)', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a'), afterContent: encodeString('a\nb'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/b.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('new'),
		});

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(TEST_SESSION_URI, db, diffService);

		assert.strictEqual(result.length, 2);
		assert.strictEqual(diffService.callCount, 2, 'both files should be diffed in full mode');
	});


	test('incremental fast path: new files only uses getFileEditsByTurn, not getAllFileEdits', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/old.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('old-before'), afterContent: encodeString('old-after'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/new.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('brand new'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/old.txt', 3, 1),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.strictEqual(db.getFileEditsByTurnCalls, 1);
		assert.strictEqual(db.getAllFileEditsCalls, 0, 'fast path should not call getAllFileEdits');

		result.sort((a, b) => (getDiffUri(a) ?? '').localeCompare(getDiffUri(b) ?? ''));
		assert.deepStrictEqual(result.map(simplify), [
			simpleDiff('/new.txt', 1, 0),
			simpleDiff('/old.txt', 3, 1),
		]);
	});

	test('incremental slow path: re-edit of existing file falls back to getAllFileEdits', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('original'), afterContent: encodeString('turn1'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('turn1'), afterContent: encodeString('turn2\nextra'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 5, 0),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.strictEqual(db.getFileEditsByTurnCalls, 1, 'should try turn-scoped query first');
		assert.strictEqual(db.getAllFileEditsCalls, 1, 'should fall back to getAllFileEdits');

		assert.deepStrictEqual(result.map(simplify), [simpleDiff('/a.txt', 1, 0)]);
	});

	test('incremental slow path: rename in current turn falls back to getAllFileEdits', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('content'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc2', filePath: '/b.txt', kind: FileEditKind.Rename,
			originalPath: '/a.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('content'), afterContent: encodeString('content'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 1, 0),
		];

		const diffService = createTestDiffService();
		await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.strictEqual(db.getAllFileEditsCalls, 1, 'should fall back for renames');
	});

	test('incremental: no edits in turn returns previousDiffs unchanged', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('before'), afterContent: encodeString('after'),
		});

		const previousDiffs: ISessionFileDiff[] = [
			fileDiff('/a.txt', 5, 2),
		];

		const diffService = createTestDiffService();
		const result = await computeSessionDiffs(
			TEST_SESSION_URI,
			db,
			diffService,
			{ changedTurnId: 't2', previousDiffs },
		);

		assert.strictEqual(db.getAllFileEditsCalls, 0, 'no computation needed');
		assert.deepStrictEqual(result, previousDiffs);
	});

	test('throws when a folderScope is combined with incremental mode (unsupported combination)', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('before'), afterContent: encodeString('after'),
		});

		await assert.rejects(
			() => computeSessionDiffs(
				TEST_SESSION_URI,
				db,
				createTestDiffService(),
				{ changedTurnId: 't1', previousDiffs: [] },
				[URI.file('/a')],
			),
			/folderScope` is not supported in incremental mode/,
		);
	});
});

suite('computeUnionedDiffs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const PEER_CHAT_URI = 'ahp-chat://peer/encoded';

	test('returns empty array when no source has edits', async () => {
		const result = await computeUnionedDiffs(
			[{ sessionUri: TEST_SESSION_URI, db: new TestSessionDatabase() }],
			createTestDiffService(),
		);
		assert.deepStrictEqual(result, []);
	});

	test('unions edits from the session DB and a peer chat DB', async () => {
		const sessionDb = new TestSessionDatabase();
		sessionDb.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a1'), afterContent: encodeString('a1\na2'),
		});

		const peerDb = new TestSessionDatabase();
		peerDb.addEdit({
			turnId: 'pt1', toolCallId: 'ptc1', filePath: '/b.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			beforeContent: undefined, afterContent: encodeString('b1\nb2\nb3'),
		});

		const result = await computeUnionedDiffs(
			[
				{ sessionUri: TEST_SESSION_URI, db: sessionDb },
				{ sessionUri: PEER_CHAT_URI, db: peerDb },
			],
			createTestDiffService(),
		);

		assert.deepStrictEqual(
			result.map(simplify).sort((x, y) => (x.uri ?? '').localeCompare(y.uri ?? '')),
			[simpleDiff('/a.txt', 1, 0), simpleDiff('/b.txt', 3, 0)],
		);

		const peerDiff = result.find(d => getDiffUri(d) === URI.file('/b.txt').toString())!;
		const afterFields = parseSessionDbUri(peerDiff.after!.content.uri);
		assert.deepStrictEqual(afterFields, {
			sessionUri: PEER_CHAT_URI,
			toolCallId: 'ptc1',
			filePath: '/b.txt',
			part: 'after',
		});
	});

	test('a file edited by multiple sources takes before from the first and after from the last source', async () => {
		const sessionDb = new TestSessionDatabase();
		sessionDb.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/shared.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('v1'), afterContent: encodeString('v2'),
		});

		const peerDb = new TestSessionDatabase();
		peerDb.addEdit({
			turnId: 'pt1', toolCallId: 'ptc1', filePath: '/shared.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('v2'), afterContent: encodeString('v3'),
		});

		const result = await computeUnionedDiffs(
			[
				{ sessionUri: TEST_SESSION_URI, db: sessionDb },
				{ sessionUri: PEER_CHAT_URI, db: peerDb },
			],
			createTestDiffService(),
		);

		assert.strictEqual(result.length, 1);
		const [diff] = result;

		assert.deepStrictEqual(parseSessionDbUri(diff.before!.content.uri), {
			sessionUri: TEST_SESSION_URI,
			toolCallId: 'tc1',
			filePath: '/shared.txt',
			part: 'before',
		});
		assert.deepStrictEqual(parseSessionDbUri(diff.after!.content.uri), {
			sessionUri: PEER_CHAT_URI,
			toolCallId: 'ptc1',
			filePath: '/shared.txt',
			part: 'after',
		});
	});
});

suite('computeTurnDiffs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();


	test('no folderScope returns all of the turn\'s edits', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a/x.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('1'), afterContent: encodeString('1\n2'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/repo/b/y.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('new'),
		});
		db.addEdit({
			turnId: 't2', toolCallId: 'tc3', filePath: '/repo/a/z.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a'), afterContent: encodeString('a\nb'),
		});

		const result = await computeTurnDiffs(TEST_SESSION_URI, db, createTestDiffService(), 't1');

		assert.deepStrictEqual(
			result.map(simplify).sort((x, y) => (x.uri ?? '').localeCompare(y.uri ?? '')),
			[simpleDiff('/repo/a/x.txt', 1, 0), simpleDiff('/repo/b/y.txt', 1, 0)],
		);
	});


	test('folderScope [A] includes only edits under A (B excluded)', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a/x.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('1'), afterContent: encodeString('1\n2'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/repo/b/y.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('b'), afterContent: encodeString('b\nc'),
		});

		const result = await computeTurnDiffs(
			TEST_SESSION_URI, db, createTestDiffService(), 't1', [URI.file('/repo/a')],
		);

		assert.deepStrictEqual(result.map(simplify), [simpleDiff('/repo/a/x.txt', 1, 0)]);
	});

	test('folderScope: rename and delete within scope are kept; edits/renames out of scope are excluded', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a/new.txt', kind: FileEditKind.Rename,
			originalPath: '/repo/a/old.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('hello'), afterContent: encodeString('hello\nworld'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/repo/a/gone.txt', kind: FileEditKind.Delete,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('bye'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc3', filePath: '/repo/b/keep.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('k'), afterContent: encodeString('k\nk2'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc4', filePath: '/repo/b/moved.txt', kind: FileEditKind.Rename,
			originalPath: '/repo/a/moving.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('m'), afterContent: encodeString('m\nm2'),
		});

		const result = await computeTurnDiffs(
			TEST_SESSION_URI, db, createTestDiffService(), 't1', [URI.file('/repo/a')],
		);

		const uris = new Set(result.map(getDiffUri));
		assert.strictEqual(result.length, 2, 'exactly the two in-scope files are reported');
		assert.ok(uris.has(URI.file('/repo/a/new.txt').toString()), 'in-scope rename kept at terminal path');
		assert.ok(uris.has(URI.file('/repo/a/gone.txt').toString()), 'in-scope delete kept');
		assert.ok(!uris.has(URI.file('/repo/b/keep.txt').toString()), 'out-of-scope edit excluded');
		assert.ok(!uris.has(URI.file('/repo/b/moved.txt').toString()), 'rename moving a file out of scope excluded');

		const rename = result.find(d => getDiffUri(d) === URI.file('/repo/a/new.txt').toString())!;
		assert.ok(rename.before, 'rename keeps a before snapshot');
		assert.ok(rename.after, 'rename keeps an after snapshot');
		const del = result.find(d => getDiffUri(d) === URI.file('/repo/a/gone.txt').toString())!;
		assert.ok(del.before, 'delete has a before');
		assert.strictEqual(del.after, undefined, 'delete has no after');
	});

	test('folderScope: rename chains are followed before scoping — in-scope edit then rename OUT of scope reports nothing (no stale path)', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a/x.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('1'), afterContent: encodeString('1\n2'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/repo/b/x.txt', kind: FileEditKind.Rename,
			originalPath: '/repo/a/x.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('1\n2'), afterContent: encodeString('1\n2\n3'),
		});

		const result = await computeTurnDiffs(
			TEST_SESSION_URI, db, createTestDiffService(), 't1', [URI.file('/repo/a')],
		);

		assert.deepStrictEqual(result.map(simplify), []);
	});

	test('folderScope: rename chains are followed before scoping — edit OUT of scope then rename INTO scope keeps the full before/after chain', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/b/y.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('1'), afterContent: encodeString('1\n2'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/repo/a/y.txt', kind: FileEditKind.Rename,
			originalPath: '/repo/b/y.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('1\n2'), afterContent: encodeString('1\n2\n3'),
		});

		const result = await computeTurnDiffs(
			TEST_SESSION_URI, db, createTestDiffService(), 't1', [URI.file('/repo/a')],
		);

		assert.deepStrictEqual(result.map(simplify), [simpleDiff('/repo/a/y.txt', 2, 0)]);
	});

	test('folderScope: a file path exactly at a folder root is kept', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a/x.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a'), afterContent: encodeString('a\nb'),
		});

		const result = await computeTurnDiffs(
			TEST_SESSION_URI, db, createTestDiffService(), 't1', [URI.file('/repo/a/x.txt')],
		);

		assert.deepStrictEqual(result.map(simplify), [simpleDiff('/repo/a/x.txt', 1, 0)]);
	});

	test('folderScope: an empty scope excludes every edit', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a/x.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a'), afterContent: encodeString('a\nb'),
		});

		const result = await computeTurnDiffs(
			TEST_SESSION_URI, db, createTestDiffService(), 't1', [],
		);

		assert.deepStrictEqual(result, []);
	});


	test('G1: Edit A → Rename A→B → Create A yields two identities (moved B and new A), not one merged entry', async () => {
		const db = new TestSessionDatabase();
		db.addEdit({
			turnId: 't1', toolCallId: 'tc1', filePath: '/repo/a.txt', kind: FileEditKind.Edit,
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a1'), afterContent: encodeString('a1\na2'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc2', filePath: '/repo/b.txt', kind: FileEditKind.Rename,
			originalPath: '/repo/a.txt',
			addedLines: undefined, removedLines: undefined,
			beforeContent: encodeString('a1\na2'), afterContent: encodeString('a1\na2\na3'),
		});
		db.addEdit({
			turnId: 't1', toolCallId: 'tc3', filePath: '/repo/a.txt', kind: FileEditKind.Create,
			addedLines: undefined, removedLines: undefined,
			afterContent: encodeString('brand new a'),
		});

		const result = await computeTurnDiffs(TEST_SESSION_URI, db, createTestDiffService(), 't1');

		const uris = new Set(result.map(getDiffUri));
		assert.strictEqual(result.length, 2, 'the moved file (B) and the recreated file (A) are distinct identities');
		assert.ok(uris.has(URI.file('/repo/b.txt').toString()), 'the renamed file appears at its destination path B');
		assert.ok(uris.has(URI.file('/repo/a.txt').toString()), 'the recreated file A is a fresh identity');
	});
});
