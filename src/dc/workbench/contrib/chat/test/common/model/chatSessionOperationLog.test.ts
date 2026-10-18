/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { hasKey } from '../../../../../../base/common/types.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { OffsetRange } from '../../../../../../editor/common/core/ranges/offsetRange.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IExtensionService } from '../../../../../services/extensions/common/extensions.js';
import { TestExtensionService, TestStorageService } from '../../../../../test/common/workbenchTestServices.js';
import { IChatService } from '../../../common/chatService/chatService.js';
import { ChatAgentLocation } from '../../../common/constants.js';
import { ChatModel } from '../../../common/model/chatModel.js';
import { ChatPlanReviewData } from '../../../common/model/chatProgressTypes/chatPlanReviewData.js';
import { ChatSessionOperationLog } from '../../../common/model/chatSessionOperationLog.js';
import * as Adapt from '../../../common/model/objectMutationLog.js';
import { equals } from '../../../../../../base/common/objects.js';
import { ChatAgentService, IChatAgentService } from '../../../common/participants/chatAgents.js';
import { ChatRequestTextPart } from '../../../common/requestParser/chatParserTypes.js';
import { MockChatService } from '../chatService/mockChatService.js';

suite('ChatSessionOperationLog', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	interface TestItem {
		id: string;
		value: number;
	}

	interface TestObject {
		name: string;
		count?: number;
		items: TestItem[];
		metadata?: { tags: string[] };
	}

	function createTestSchema() {
		const itemSchema = Adapt.object<TestItem, TestItem>({
			id: Adapt.t(i => i.id, Adapt.key()),
			value: Adapt.t(i => i.value, Adapt.value()),
		});

		return Adapt.object<TestObject, TestObject>({
			name: Adapt.t(o => o.name, Adapt.value()),
			count: Adapt.t(o => o.count, Adapt.value()),
			items: Adapt.t(o => o.items, Adapt.array(itemSchema)),
			metadata: Adapt.v(o => o.metadata, equals),
		});
	}

	function simulateFileRoundtrip(adapter: Adapt.ObjectMutationLog<TestObject, TestObject>, initial: TestObject, updates: TestObject[]): TestObject {
		let fileContent = adapter.createInitial(initial);

		for (const update of updates) {
			const result = adapter.write(update);
			if (result.op === 'replace') {
				fileContent = result.data;
			} else {
				fileContent = VSBuffer.concat([fileContent, result.data]);
			}
			adapter.confirmWrite();
		}

		const reader = new Adapt.ObjectMutationLog(createTestSchema());
		return reader.read(fileContent);
	}

	test('persists plan review changes through the operation log', () => {
		const store = testDisposables.add(new DisposableStore());
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IStorageService, store.add(new TestStorageService()));
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IExtensionService, new TestExtensionService());
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
		instantiationService.stub(IChatAgentService, store.add(instantiationService.createInstance(ChatAgentService)));
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(IChatService, new MockChatService());

		const model = store.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const text = 'Create a plan';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)],
		}, { variables: [] }, 0);
		const review = new ChatPlanReviewData('Plan summary', 'Generated summary', [{ label: 'Approve' }], true);
		model.acceptResponseProgress(request, review);

		const writer = new ChatSessionOperationLog();
		const initial = writer.createInitial(model);
		review.isOutdated = true;
		const update = writer.write(model);
		writer.confirmWrite();

		const reader = new ChatSessionOperationLog();
		const restored = reader.read(VSBuffer.concat([initial, update.data]));
		const restoredReview = restored.requests[0].response?.[0];
		if (!restoredReview || !hasKey(restoredReview, { kind: true }) || restoredReview.kind !== 'planReview') {
			assert.fail('Expected a restored plan review');
		}
		assert.strictEqual(restoredReview.isOutdated, true);
	});

	suite('Transform factories', () => {
		test('key uses strict equality by default', () => {
			const transform = Adapt.key<string>();
			assert.strictEqual(transform.equals('a', 'a'), true);
			assert.strictEqual(transform.equals('a', 'b'), false);
		});

		test('key uses custom comparator', () => {
			const transform = Adapt.key<{ id: number }>((a, b) => a.id === b.id);
			assert.strictEqual(transform.equals({ id: 1 }, { id: 1 }), true);
			assert.strictEqual(transform.equals({ id: 1 }, { id: 2 }), false);
		});

		test('primitive uses strict equality', () => {
			const transform = Adapt.value<number, number>();
			assert.strictEqual(transform.equals(1, 1), true);
			assert.strictEqual(transform.equals(1, 2), false);
		});

		test('primitive with custom comparator', () => {
			const transform = Adapt.value<string, string>((a, b) => a.toLowerCase() === b.toLowerCase());
			assert.strictEqual(transform.equals('ABC', 'abc'), true);
			assert.strictEqual(transform.equals('ABC', 'def'), false);
		});

		test('object extracts and compares properties', () => {
			const schema = Adapt.object<{ x: number; y: string }, { x: number; y: string }>({
				x: Adapt.t(o => o.x, Adapt.value()),
				y: Adapt.t(o => o.y, Adapt.value()),
			});

			const extracted = schema.extract({ x: 1, y: 'test' });
			assert.strictEqual(extracted.x, 1);
			assert.strictEqual(extracted.y, 'test');
		});

		test('t composes getter with transform', () => {
			const transform = Adapt.t(
				(obj: { nested: { value: number } }) => obj.nested.value,
				Adapt.value<number, number>()
			);

			assert.strictEqual(transform.extract({ nested: { value: 42 } }), 42);
		});

		test('differentiated uses separate extract and equals functions', () => {
			const transform = Adapt.v<{ type: string; data: number }, string>(
				obj => `${obj.type}:${obj.data}`,
				(a, b) => a.split(':')[0] === b.split(':')[0],
			);

			const extracted = transform.extract({ type: 'test', data: 123 });
			assert.strictEqual(extracted, 'test:123');

			assert.strictEqual(transform.equals('test:123', 'test:456'), true);
			assert.strictEqual(transform.equals('test:123', 'other:123'), false);
		});
	});

	suite('LogAdapter', () => {
		test('createInitial creates valid log entry', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const initial: TestObject = { name: 'test', count: 0, items: [] };
			const buffer = adapter.createInitial(initial);

			const content = buffer.toString();
			const entry = JSON.parse(content.trim());
			assert.strictEqual(entry.kind, 0);
			assert.deepStrictEqual(entry.v, initial);
		});

		test('read reconstructs initial state', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const initial: TestObject = { name: 'test', count: 5, items: [{ id: 'a', value: 1 }] };
			const buffer = adapter.createInitial(initial);

			const reader = new Adapt.ObjectMutationLog(schema);
			const result = reader.read(buffer);

			assert.deepStrictEqual(result, initial);
		});

		test('write returns empty data when no changes', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [] };
			adapter.createInitial(obj);

			const result = adapter.write(obj);
			assert.strictEqual(result.op, 'append');
			assert.strictEqual(result.data.toString(), '');
		});

		test('write detects primitive changes', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [] };
			adapter.createInitial(obj);

			const updated = { ...obj, count: 10 };
			const result = adapter.write(updated);

			assert.strictEqual(result.op, 'append');
			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 1);
			assert.deepStrictEqual(entry.k, ['count']);
			assert.strictEqual(entry.v, 10);
		});

		test('write detects array append', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [{ id: 'a', value: 1 }] };
			adapter.createInitial(obj);

			const updated: TestObject = { ...obj, items: [...obj.items, { id: 'b', value: 2 }] };
			const result = adapter.write(updated);

			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 2);
			assert.deepStrictEqual(entry.k, ['items']);
			assert.deepStrictEqual(entry.v, [{ id: 'b', value: 2 }]);
			assert.strictEqual(entry.i, undefined);
		});

		test('write detects array append nested', () => {
			type Item = { id: string; value: number[] };
			const itemSchema = Adapt.object<Item, Item>({
				id: Adapt.t(i => i.id, Adapt.key()),
				value: Adapt.t(i => i.value, Adapt.array(Adapt.value())),
			});

			type TestObject = { items: Item[] };
			const schema = Adapt.object<TestObject, TestObject>({
				items: Adapt.t(o => o.items, Adapt.array(itemSchema)),
			});

			const adapter = new Adapt.ObjectMutationLog(schema);

			adapter.createInitial({ items: [{ id: 'a', value: [1, 2] }] });


			const result1 = adapter.write({ items: [{ id: 'a', value: [1, 2, 3] }] });
			adapter.confirmWrite();
			assert.deepStrictEqual(
				JSON.parse(result1.data.toString().trim()),
				{ kind: 2, k: ['items', 0, 'value'], v: [3] },
			);

			const result2 = adapter.write({ items: [{ id: 'b', value: [1, 2, 3] }] });
			assert.deepStrictEqual(
				JSON.parse(result2.data.toString().trim()),
				{ kind: 2, k: ['items'], i: 0, v: [{ id: 'b', value: [1, 2, 3] }] },
			);
		});

		test('write detects array truncation', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }] };
			adapter.createInitial(obj);

			const updated: TestObject = { ...obj, items: [obj.items[0]] };
			const result = adapter.write(updated);

			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 2);
			assert.deepStrictEqual(entry.k, ['items']);
			assert.strictEqual(entry.i, 1);
			assert.strictEqual(entry.v, undefined);
		});

		test('write detects array item modification and recurses into object', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = {
				name: 'test',
				count: 0,
				items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }]
			};
			adapter.createInitial(obj);

			const updated: TestObject = {
				...obj,
				items: [{ id: 'a', value: 1 }, { id: 'b', value: 999 }, { id: 'c', value: 3 }]
			};
			const result = adapter.write(updated);

			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 1);
			assert.deepStrictEqual(entry.k, ['items', 1, 'value']);
			assert.strictEqual(entry.v, 999);
		});

		test('read applies multiple entries correctly', () => {
			const schema = createTestSchema();
			const initial: TestObject = { name: 'test', count: 0, items: [] };

			const entries = [
				{ kind: 0, v: initial },
				{ kind: 1, k: ['count'], v: 5 },
				{ kind: 2, k: ['items'], v: [{ id: 'a', value: 1 }] },
				{ kind: 2, k: ['items'], v: [{ id: 'b', value: 2 }] },
			];
			const logContent = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

			const adapter = new Adapt.ObjectMutationLog(schema);
			const result = adapter.read(VSBuffer.fromString(logContent));

			assert.strictEqual(result.count, 5);
			assert.strictEqual(result.items.length, 2);
			assert.deepStrictEqual(result.items[0], { id: 'a', value: 1 });
			assert.deepStrictEqual(result.items[1], { id: 'b', value: 2 });
		});

		test('roundtrip preserves data through multiple updates', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const initial: TestObject = { name: 'test', count: 0, items: [] };
			const updates: TestObject[] = [
				{ name: 'test', count: 1, items: [] },
				{ name: 'test', count: 1, items: [{ id: 'a', value: 10 }] },
				{ name: 'test', count: 2, items: [{ id: 'a', value: 10 }, { id: 'b', value: 20 }] },
				{ name: 'test', count: 2, items: [{ id: 'a', value: 10 }] },
			];

			const result = simulateFileRoundtrip(adapter, initial, updates);
			assert.deepStrictEqual(result, updates[updates.length - 1]);
		});

		test('compacts log when entry count exceeds threshold', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema, 3);

			const obj: TestObject = { name: 'test', count: 0, items: [] };
			adapter.createInitial(obj);

			adapter.write({ ...obj, count: 1 });
			adapter.confirmWrite();
			adapter.write({ ...obj, count: 2 });
			adapter.confirmWrite();

			const before = adapter.write({ ...obj, count: 3 });
			adapter.confirmWrite();
			assert.strictEqual(before.op, 'append');

			const result = adapter.write({ ...obj, count: 4 });
			assert.strictEqual(result.op, 'replace');

			const lines = result.data.toString().split('\n').filter(l => l.trim());
			assert.strictEqual(lines.length, 1);
			const entry = JSON.parse(lines[0]);
			assert.strictEqual(entry.kind, 0);
		});

		test('handles deepCompare property changes', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [], metadata: { tags: ['a'] } };
			adapter.createInitial(obj);

			const updated: TestObject = { ...obj, metadata: { tags: ['a', 'b'] } };
			const result = adapter.write(updated);

			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 1);
			assert.deepStrictEqual(entry.k, ['metadata']);
			assert.deepStrictEqual(entry.v, { tags: ['a', 'b'] });
		});

		test('handles differentiated property changes', () => {
			interface DiffObj {
				data: { type: string; version: number };
			}
			const schema = Adapt.object<DiffObj, { data: string }>({
				data: Adapt.t(
					o => o.data,
					Adapt.v<{ type: string; version: number }, string>(
						obj => `${obj.type}:${obj.version}`,
						(a, b) => a.split(':')[0] === b.split(':')[0],
					)
				),
			});

			const adapter = new Adapt.ObjectMutationLog(schema);

			adapter.createInitial({ data: { type: 'foo', version: 1 } });

			const result1 = adapter.write({ data: { type: 'bar', version: 2 } });
			adapter.confirmWrite();
			assert.notStrictEqual(result1.data.toString(), '', 'different type should trigger change');
			const entry1 = JSON.parse(result1.data.toString().trim());
			assert.strictEqual(entry1.kind, 1);
			assert.deepStrictEqual(entry1.k, ['data']);
			assert.strictEqual(entry1.v, 'bar:2');

			const result2 = adapter.write({ data: { type: 'bar', version: 3 } });
			assert.strictEqual(result2.data.toString(), '', 'same type prefix should not trigger change');
		});

		test('read throws on empty log file', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			assert.throws(() => adapter.read(VSBuffer.fromString('')), /Empty log file/);
		});

		test('write without prior read creates initial entry', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 5, items: [] };
			const result = adapter.write(obj);

			assert.strictEqual(result.op, 'replace');
			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 0);
		});

		test('sealed objects skip non-key field comparison when both are sealed', () => {
			interface SealedItem {
				id: string;
				value: number;
				isSealed: boolean;
			}

			interface SealedTestObject {
				items: SealedItem[];
			}

			const itemSchema = Adapt.object<SealedItem, SealedItem>({
				id: Adapt.t(i => i.id, Adapt.key()),
				value: Adapt.t(i => i.value, Adapt.value()),
				isSealed: Adapt.t(i => i.isSealed, Adapt.value()),
			}, {
				sealed: (obj) => obj.isSealed,
			});

			const schema = Adapt.object<SealedTestObject, SealedTestObject>({
				items: Adapt.t(o => o.items, Adapt.array(itemSchema)),
			});

			const adapter = new Adapt.ObjectMutationLog(schema);

			adapter.createInitial({ items: [{ id: 'a', value: 1, isSealed: true }] });

			const result1 = adapter.write({ items: [{ id: 'a', value: 999, isSealed: true }] });
			assert.strictEqual(result1.data.toString(), '', 'sealed item value change should be ignored');
		});

		test('sealed objects still detect key changes', () => {
			interface SealedItem {
				id: string;
				value: number;
				isSealed: boolean;
			}

			interface SealedTestObject {
				items: SealedItem[];
			}

			const itemSchema = Adapt.object<SealedItem, SealedItem>({
				id: Adapt.t(i => i.id, Adapt.key()),
				value: Adapt.t(i => i.value, Adapt.value()),
				isSealed: Adapt.t(i => i.isSealed, Adapt.value()),
			}, {
				sealed: (obj) => obj.isSealed,
			});

			const schema = Adapt.object<SealedTestObject, SealedTestObject>({
				items: Adapt.t(o => o.items, Adapt.array(itemSchema)),
			});

			const adapter = new Adapt.ObjectMutationLog(schema);

			adapter.createInitial({ items: [{ id: 'a', value: 1, isSealed: true }] });

			const result = adapter.write({ items: [{ id: 'b', value: 1, isSealed: true }] });
			assert.notStrictEqual(result.data.toString(), '', 'key change should be detected even when sealed');

			const entry = JSON.parse(result.data.toString().trim());
			assert.strictEqual(entry.kind, 2);
		});

		test('sealed objects diff normally when one is not sealed', () => {
			interface SealedItem {
				id: string;
				value: number;
				isSealed: boolean;
			}

			interface SealedTestObject {
				items: SealedItem[];
			}

			const itemSchema = Adapt.object<SealedItem, SealedItem>({
				id: Adapt.t(i => i.id, Adapt.key()),
				value: Adapt.t(i => i.value, Adapt.value()),
				isSealed: Adapt.t(i => i.isSealed, Adapt.value()),
			}, {
				sealed: (obj) => obj.isSealed,
			});

			const schema = Adapt.object<SealedTestObject, SealedTestObject>({
				items: Adapt.t(o => o.items, Adapt.array(itemSchema)),
			});

			const adapter = new Adapt.ObjectMutationLog(schema);

			adapter.createInitial({ items: [{ id: 'a', value: 1, isSealed: false }] });

			const result1 = adapter.write({ items: [{ id: 'a', value: 999, isSealed: false }] });
			assert.notStrictEqual(result1.data.toString(), '', 'non-sealed item should detect value change');

			const entry = JSON.parse(result1.data.toString().trim());
			assert.strictEqual(entry.kind, 1);
			assert.deepStrictEqual(entry.k, ['items', 0, 'value']);
			assert.strictEqual(entry.v, 999);
		});

		test('sealed transition from unsealed to sealed detects final changes', () => {
			interface SealedItem {
				id: string;
				value: number;
				isSealed: boolean;
			}

			interface SealedTestObject {
				items: SealedItem[];
			}

			const itemSchema = Adapt.object<SealedItem, SealedItem>({
				id: Adapt.t(i => i.id, Adapt.key()),
				value: Adapt.t(i => i.value, Adapt.value()),
				isSealed: Adapt.t(i => i.isSealed, Adapt.value()),
			}, {
				sealed: (obj) => obj.isSealed,
			});

			const schema = Adapt.object<SealedTestObject, SealedTestObject>({
				items: Adapt.t(o => o.items, Adapt.array(itemSchema)),
			});

			const adapter = new Adapt.ObjectMutationLog(schema);

			adapter.createInitial({ items: [{ id: 'a', value: 1, isSealed: false }] });

			const result = adapter.write({ items: [{ id: 'a', value: 999, isSealed: true }] });
			assert.notStrictEqual(result.data.toString(), '', 'transition to sealed should detect value change');

			const lines = result.data.toString().trim().split('\n');
			assert.strictEqual(lines.length, 2, 'should have two change entries');
		});

		test('write detects property set to undefined', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const initial: TestObject = { name: 'test', count: 5, items: [], metadata: { tags: ['foo'] } };

			const result = simulateFileRoundtrip(adapter, initial, [
				{ name: 'test', count: 10, items: [], metadata: { tags: ['foo'] } },
				{ name: 'test', count: undefined, items: [], metadata: undefined },
			]);
			assert.deepStrictEqual(result, { name: 'test', count: undefined, items: [], metadata: undefined });

			const result2 = simulateFileRoundtrip(adapter, initial, [
				{ name: 'test', count: 10, items: [], metadata: { tags: ['foo'] } },
				{ name: 'test', count: undefined, items: [], metadata: undefined },
				{ name: 'test', count: 12, items: [], metadata: { tags: ['bar'] } },
			]);
			assert.deepStrictEqual(result2, { name: 'test', count: 12, items: [], metadata: { tags: ['bar'] } });
		});

		test('delete followed by set restores property', () => {
			const schema = createTestSchema();
			const initial: TestObject = { name: 'test', count: 0, items: [], metadata: { tags: ['a'] } };

			const entries = [
				{ kind: 0, v: initial },
				{ kind: 3, k: ['metadata'] },
				{ kind: 1, k: ['metadata'], v: { tags: ['b', 'c'] } },
			];
			const logContent = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

			const adapter = new Adapt.ObjectMutationLog(schema);
			const result = adapter.read(VSBuffer.fromString(logContent));

			assert.deepStrictEqual(result.metadata, { tags: ['b', 'c'] });
		});

		test('write without confirmWrite resets to initial on next write', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [] };

			const result1 = adapter.write(obj);
			assert.strictEqual(result1.op, 'replace');

			const result2 = adapter.write({ ...obj, count: 2 });
			assert.deepStrictEqual(
				{ op: result2.op, entry: JSON.parse(result2.data.toString().trim()) },
				{ op: 'replace', entry: { kind: 0, v: { name: 'test', count: 2, items: [] } } },
			);
		});

		test('confirmWrite commits state so next write is incremental', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [] };
			adapter.createInitial(obj);

			adapter.write({ ...obj, count: 1 });
			adapter.confirmWrite();

			const result = adapter.write({ ...obj, count: 2 });
			assert.deepStrictEqual(
				{ op: result.op, entry: JSON.parse(result.data.toString().trim()) },
				{ op: 'append', entry: { kind: 1, k: ['count'], v: 2 } },
			);
		});

		test('read throws on log file missing initial entry', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const logContent = JSON.stringify({ kind: 1, k: ['count'], v: 5 }) + '\n';
			assert.throws(() => adapter.read(VSBuffer.fromString(logContent)), /missing an initial entry/);
		});

		test('failed first write followed by successful write produces valid roundtrip', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const initial: TestObject = { name: 'test', count: 0, items: [] };

			const r1 = adapter.write(initial);
			assert.strictEqual(r1.op, 'replace');

			const r2 = adapter.write({ ...initial, count: 3 });
			assert.strictEqual(r2.op, 'replace');
			adapter.confirmWrite();
			const fileContent = r2.data;

			const reader = new Adapt.ObjectMutationLog(createTestSchema());
			const result = reader.read(fileContent);
			assert.strictEqual(result.count, 3);
		});

		test('unconfirmed append after createInitial still diffs against initial', () => {
			const schema = createTestSchema();
			const adapter = new Adapt.ObjectMutationLog(schema);

			const obj: TestObject = { name: 'test', count: 0, items: [] };
			let fileContent = adapter.createInitial(obj);

			const r1 = adapter.write({ ...obj, count: 1 });
			assert.strictEqual(r1.op, 'append');

			const r2 = adapter.write({ ...obj, count: 2 });
			assert.strictEqual(r2.op, 'append');
			adapter.confirmWrite();
			fileContent = VSBuffer.concat([fileContent, r2.data]);

			const reader = new Adapt.ObjectMutationLog(createTestSchema());
			const result = reader.read(fileContent);
			assert.strictEqual(result.count, 2);
		});
	});

	suite('persistence size safety net', () => {
		test('makeTruncatingReplacer truncates an oversized string', () => {
			const big = 'x'.repeat(2 * 1024 * 1024);
			const obj = { content: big, label: 'ok' };
			const json = JSON.stringify(obj, Adapt.makeTruncatingReplacer(1024 * 1024, 10 * 1024 * 1024));
			const parsed = JSON.parse(json);
			assert.notStrictEqual(parsed.content, big);
			assert.ok(parsed.content.startsWith('[VS Code:'));
			assert.strictEqual(parsed.label, 'ok');
		});

		test('makeTruncatingReplacer respects total budget without overshooting', () => {
			const STRING_CAP = 1024 * 1024;
			const TOTAL_CAP = 1024 * 1024;
			const medium = 'y'.repeat(200 * 1024);
			const obj: any = {};
			for (let i = 0; i < 20; i++) {
				obj[`k${i}`] = medium;
			}
			const json = JSON.stringify(obj, Adapt.makeTruncatingReplacer(STRING_CAP, TOTAL_CAP));
			const parsed = JSON.parse(json);
			const preservedChars = Object.values(parsed)
				.filter((v): v is string => typeof v === 'string' && v === medium)
				.reduce((sum, v) => sum + v.length, 0);
			assert.ok(preservedChars <= TOTAL_CAP, `preserved ${preservedChars} chars exceeded budget ${TOTAL_CAP}`);
			assert.strictEqual(parsed.k0, medium);
			assert.ok(Object.values(parsed).some(v => typeof v === 'string' && (v as string).includes('entry exceeded size budget')));
		});

		test('stringifyEntryWithFallback succeeds with no overhead on small entries', () => {
			const entry = { kind: 0, v: { foo: 'bar', n: 42 } };
			const out = Adapt.stringifyEntryWithFallback(entry);
			assert.strictEqual(out, JSON.stringify(entry));
		});

		test('stringifyEntryWithFallback rethrows non-RangeError', () => {
			const circular: any = {};
			circular.self = circular;
			assert.throws(() => Adapt.stringifyEntryWithFallback(circular), TypeError);
		});

		test('stringifyEntryWithFallback recovers when JSON.stringify throws RangeError', () => {
			let calls = 0;
			const entry = {
				toJSON() {
					calls++;
					if (calls === 1) {
						throw new RangeError('Invalid string length');
					}
					return { content: 'recovered' };
				},
			};
			const out = Adapt.stringifyEntryWithFallback(entry);
			assert.strictEqual(calls, 2, 'should have been called twice (initial + retry)');
			assert.deepStrictEqual(JSON.parse(out), { content: 'recovered' });
		});

		test('stringifyEntryWithFallback applies truncating replacer on RangeError retry', () => {
			const big = 'x'.repeat(2 * 1024 * 1024);
			let calls = 0;
			const entry = {
				toJSON() {
					calls++;
					if (calls === 1) {
						throw new RangeError('Invalid string length');
					}
					return { content: big, label: 'ok' };
				},
			};
			const out = Adapt.stringifyEntryWithFallback(entry);
			const parsed = JSON.parse(out);
			assert.notStrictEqual(parsed.content, big);
			assert.ok(parsed.content.startsWith('[VS Code:'), `unexpected: ${parsed.content.slice(0, 80)}`);
			assert.strictEqual(parsed.label, 'ok');
		});

		test('deepCloneWithFallback returns a structural clone on the common path', () => {
			const original = { a: 1, nested: { b: 'two', list: [1, 2, 3] } };
			const clone = Adapt.deepCloneWithFallback(original);
			assert.deepStrictEqual(clone, original);
			assert.notStrictEqual(clone, original);
			assert.notStrictEqual(clone.nested, original.nested);
		});

		test('deepCloneWithFallback recovers from RangeError during the clone', () => {
			const big = 'x'.repeat(2 * 1024 * 1024);
			let calls = 0;
			const value: { huge: string; label: string; toJSON(): { huge: string; label: string } } = {
				huge: big,
				label: 'ok',
				toJSON() {
					calls++;
					if (calls === 1) {
						throw new RangeError('Invalid string length');
					}
					return { huge: big, label: 'ok' };
				},
			};
			const clone = Adapt.deepCloneWithFallback(value);
			assert.strictEqual(calls, 2, 'should have been called twice (initial + retry)');
			assert.strictEqual(clone.label, 'ok');
			assert.notStrictEqual(clone.huge, big);
			assert.ok(clone.huge.startsWith('[VS Code:'), `unexpected: ${clone.huge.slice(0, 80)}`);
		});

		test('value().extract recovers when the deep-clone throws RangeError', () => {
			const big = 'x'.repeat(2 * 1024 * 1024);
			let calls = 0;
			const huge = {
				kept: 'meta',
				toJSON() {
					calls++;
					if (calls === 1) {
						throw new RangeError('Invalid string length');
					}
					return { dump: big, kept: 'meta' };
				},
			};
			const transform = Adapt.value<typeof huge, { dump: string; kept: string }>((a, b) => a.dump === b.dump && a.kept === b.kept);
			const extracted = transform.extract(huge);
			assert.strictEqual(calls, 2);
			assert.strictEqual(extracted.kept, 'meta');
			assert.ok(extracted.dump.startsWith('[VS Code:'));
		});
	});
});
