/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IObservable, observableValue } from '../../../../base/common/observable.js';
import { language } from '../../../../base/common/platform.js';
import { WellDefinedPrefixTree } from '../../../../base/common/prefixTree.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { localize } from '../../../../nls.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IComputedStateAccessor, refreshComputedState } from './getComputedState.js';
import { TestCoverage } from './testCoverage.js';
import { TestId } from './testId.js';
import { makeEmptyCounts, maxPriority, statesInOrder, terminalStatePriorities, TestStateCount } from './testingStates.js';
import { getMarkId, IRichLocation, ISerializedTestResults, ITestItem, ITestMessage, ITestOutputMessage, ITestRunTask, ITestTaskState, ResolvedTestRunRequest, TestItemExpandState, TestMessageType, TestResultItem, TestResultState } from './testTypes.js';

export interface ITestRunTaskResults extends ITestRunTask {
	readonly coverage: IObservable<TestCoverage | undefined>;

	readonly otherMessages: ITestOutputMessage[];

	readonly output: ITaskRawOutput;
}

export interface ITestResult {
	readonly counts: Readonly<TestStateCount>;

	readonly id: string;

	readonly completedAt: number | undefined;

	readonly request: ResolvedTestRunRequest;

	readonly name: string;

	tests: IterableIterator<TestResultItem>;

	tasks: ReadonlyArray<ITestRunTaskResults>;

	getStateById(testExtId: string): TestResultItem | undefined;

	toJSON(): ISerializedTestResults | undefined;

	toJSONWithMessages(): ISerializedTestResults | undefined;
}

export interface ITaskRawOutput {
	readonly onDidWriteData: Event<VSBuffer>;
	readonly endPromise: Promise<void>;
	readonly buffers: VSBuffer[];
	readonly length: number;

	getRange(start: number, length: number): VSBuffer;
	getRangeIter(start: number, length: number): Iterable<VSBuffer>;
}

const emptyRawOutput: ITaskRawOutput = {
	buffers: [],
	length: 0,
	onDidWriteData: Event.None,
	endPromise: Promise.resolve(),
	getRange: () => VSBuffer.alloc(0),
	getRangeIter: () => [],
};

export class TaskRawOutput implements ITaskRawOutput {
	private readonly writeDataEmitter = new Emitter<VSBuffer>();
	private readonly endDeferred = new DeferredPromise<void>();
	private offset = 0;

	public readonly onDidWriteData = this.writeDataEmitter.event;

	public readonly endPromise = this.endDeferred.p;

	public readonly buffers: VSBuffer[] = [];

	public get length() {
		return this.offset;
	}

	getRange(start: number, length: number): VSBuffer {
		const buf = VSBuffer.alloc(length);
		let bufLastWrite = 0;
		for (const chunk of this.getRangeIter(start, length)) {
			buf.buffer.set(chunk.buffer, bufLastWrite);
			bufLastWrite += chunk.byteLength;
		}

		return bufLastWrite < length ? buf.slice(0, bufLastWrite) : buf;
	}

	*getRangeIter(start: number, length: number) {
		let soFar = 0;
		let internalLastRead = 0;
		for (const b of this.buffers) {
			if (internalLastRead + b.byteLength <= start) {
				internalLastRead += b.byteLength;
				continue;
			}

			const bstart = Math.max(0, start - internalLastRead);
			const bend = Math.min(b.byteLength, bstart + length - soFar);

			yield b.slice(bstart, bend);
			soFar += bend - bstart;
			internalLastRead += b.byteLength;

			if (soFar === length) {
				break;
			}
		}
	}

	public append(data: VSBuffer, marker?: number) {
		const offset = this.offset;
		let length = data.byteLength;
		if (marker === undefined) {
			this.push(data);
			return { offset, length };
		}

		const enum TrimBytes {
			CR = 13,
			LF = 10,
		}

		const start = VSBuffer.fromString(getMarkCode(marker, true));
		const end = VSBuffer.fromString(getMarkCode(marker, false));
		length += start.byteLength + end.byteLength;

		this.push(start);
		let trimLen = data.byteLength;
		for (; trimLen > 0; trimLen--) {
			const last = data.buffer[trimLen - 1];
			if (last !== TrimBytes.CR && last !== TrimBytes.LF) {
				break;
			}
		}

		this.push(data.slice(0, trimLen));
		this.push(end);
		this.push(data.slice(trimLen));


		return { offset, length };
	}

	private push(data: VSBuffer) {
		if (data.byteLength === 0) {
			return;
		}

		this.buffers.push(data);
		this.writeDataEmitter.fire(data);
		this.offset += data.byteLength;
	}

	public end() {
		this.endDeferred.complete();
	}
}

export const resultItemParents = function* (results: ITestResult, item: TestResultItem) {
	for (const id of TestId.fromString(item.item.extId).idsToRoot()) {
		yield results.getStateById(id.toString())!;
	}
};

export const maxCountPriority = (counts: Readonly<TestStateCount>) => {
	for (const state of statesInOrder) {
		if (counts[state] > 0) {
			return state;
		}
	}

	return TestResultState.Unset;
};

const getMarkCode = (marker: number, start: boolean) => `\x1b]633;SetMark;Id=${getMarkId(marker, start)};Hidden\x07`;

interface TestResultItemWithChildren extends TestResultItem {
	children: TestResultItemWithChildren[];
}

const itemToNode = (controllerId: string, item: ITestItem, parent: string | null): TestResultItemWithChildren => ({
	controllerId,
	expand: TestItemExpandState.NotExpandable,
	item: { ...item },
	children: [],
	tasks: [],
	ownComputedState: TestResultState.Unset,
	computedState: TestResultState.Unset,
});

export const enum TestResultItemChangeReason {
	ComputedStateChange,
	OwnStateChange,
	NewMessage,
}

export type TestResultItemChange = { item: TestResultItem; result: ITestResult } & (
	| { reason: TestResultItemChangeReason.ComputedStateChange }
	| { reason: TestResultItemChangeReason.OwnStateChange; previousState: TestResultState; previousOwnDuration: number | undefined }
	| { reason: TestResultItemChangeReason.NewMessage; message: ITestMessage }
);

export class LiveTestResult extends Disposable implements ITestResult {
	private readonly completeEmitter = this._register(new Emitter<void>());
	private readonly newTaskEmitter = this._register(new Emitter<number>());
	private readonly endTaskEmitter = this._register(new Emitter<number>());
	private readonly changeEmitter = this._register(new Emitter<TestResultItemChange>());
	private readonly testById = new Map<string, TestResultItemWithChildren>();
	private testMarkerCounter = 0;
	private _completedAt?: number;

	public readonly startedAt = Date.now();
	public readonly onChange = this.changeEmitter.event;
	public readonly onComplete = this.completeEmitter.event;
	public readonly onNewTask = this.newTaskEmitter.event;
	public readonly onEndTask = this.endTaskEmitter.event;
	public readonly tasks: (ITestRunTaskResults & { output: TaskRawOutput })[] = [];
	public readonly name = localize('runFinished', 'Test run at {0}', new Date().toLocaleString(language));

	public get completedAt() {
		return this._completedAt;
	}

	public readonly counts = makeEmptyCounts();

	public get tests() {
		return this.testById.values();
	}

	public getTestById(id: string) {
		return this.testById.get(id)?.item;
	}

	private readonly computedStateAccessor: IComputedStateAccessor<TestResultItemWithChildren> = {
		getOwnState: i => i.ownComputedState,
		getCurrentComputedState: i => i.computedState,
		setComputedState: (i, s) => i.computedState = s,
		getChildren: i => i.children,
		getParents: i => {
			const { testById: testByExtId } = this;
			return (function* () {
				const parentId = TestId.fromString(i.item.extId).parentId;
				if (parentId) {
					for (const id of parentId.idsToRoot()) {
						yield testByExtId.get(id.toString())!;
					}
				}
			})();
		},
	};

	constructor(
		public readonly id: string,
		public readonly persist: boolean,
		public readonly request: ResolvedTestRunRequest,
		public readonly insertOrder: number,
		@ITelemetryService private readonly telemetry: ITelemetryService,
	) {
		super();
	}

	public getStateById(extTestId: string) {
		return this.testById.get(extTestId);
	}

	public appendOutput(output: VSBuffer, taskId: string, location?: IRichLocation, testId?: string): void {
		const rawPreview = output.byteLength > 100 ? output.slice(0, 100).toString() + '…' : output.toString();
		const preview = removeAnsiEscapeCodes(rawPreview);
		let marker: number | undefined;

		if (testId || location) {
			marker = this.testMarkerCounter++;
		}

		const index = this.mustGetTaskIndex(taskId);
		const task = this.tasks[index];

		const { offset, length } = task.output.append(output, marker);
		const message: ITestOutputMessage = {
			location,
			message: preview,
			offset,
			length,
			marker,
			type: TestMessageType.Output,
		};

		const test = testId && this.testById.get(testId);
		if (test) {
			test.tasks[index].messages.push(message);
			this.changeEmitter.fire({ item: test, result: this, reason: TestResultItemChangeReason.NewMessage, message });
		} else {
			task.otherMessages.push(message);
		}
	}

	public addTask(task: ITestRunTask) {
		this.tasks.push({ ...task, coverage: observableValue(this, undefined), otherMessages: [], output: new TaskRawOutput() });

		for (const test of this.tests) {
			test.tasks.push({ duration: undefined, messages: [], state: TestResultState.Unset });
		}

		this.newTaskEmitter.fire(this.tasks.length - 1);
	}

	public addTestChainToRun(controllerId: string, chain: ReadonlyArray<ITestItem>) {
		let parent = this.testById.get(chain[0].extId);
		if (!parent) {
			parent = this.addTestToRun(controllerId, chain[0], null);
		}

		for (let i = 1; i < chain.length; i++) {
			parent = this.addTestToRun(controllerId, chain[i], parent.item.extId);
		}

		return undefined;
	}

	public updateState(testId: string, taskId: string, state: TestResultState, duration?: number) {
		const entry = this.testById.get(testId);
		if (!entry) {
			return;
		}

		const index = this.mustGetTaskIndex(taskId);

		const oldTerminalStatePrio = terminalStatePriorities[entry.tasks[index].state];
		const newTerminalStatePrio = terminalStatePriorities[state];

		if (oldTerminalStatePrio !== undefined &&
			(newTerminalStatePrio === undefined || newTerminalStatePrio < oldTerminalStatePrio)) {
			return;
		}

		this.fireUpdateAndRefresh(entry, index, state, duration);
	}

	public appendMessage(testId: string, taskId: string, message: ITestMessage) {
		const entry = this.testById.get(testId);
		if (!entry) {
			return;
		}

		entry.tasks[this.mustGetTaskIndex(taskId)].messages.push(message);
		this.changeEmitter.fire({ item: entry, result: this, reason: TestResultItemChangeReason.NewMessage, message });
	}

	public markTaskComplete(taskId: string) {
		const index = this.mustGetTaskIndex(taskId);
		const task = this.tasks[index];
		task.running = false;
		task.output.end();

		this.setAllToState(
			TestResultState.Skipped,
			taskId,
			t => t.state === TestResultState.Queued || t.state === TestResultState.Running,
		);

		this.endTaskEmitter.fire(index);
	}

	public markComplete() {
		if (this._completedAt !== undefined) {
			throw new Error('cannot complete a test result multiple times');
		}

		for (const task of this.tasks) {
			if (task.running) {
				this.markTaskComplete(task.id);
			}
		}

		this._completedAt = Date.now();
		this.completeEmitter.fire();

		this.telemetry.publicLog2<
			{ failures: number; passes: number; controller: string },
			{
				owner: 'connor4312';
				comment: 'Test outcome metrics. This helps us understand magnitude of feature use and how to build fix suggestions.';
				failures: { comment: 'Number of test failures'; classification: 'SystemMetaData'; purpose: 'FeatureInsight' };
				passes: { comment: 'Number of test failures'; classification: 'SystemMetaData'; purpose: 'FeatureInsight' };
				controller: { comment: 'The test controller being used'; classification: 'SystemMetaData'; purpose: 'FeatureInsight' };
			}
		>('test.outcomes', {
			failures: this.counts[TestResultState.Errored] + this.counts[TestResultState.Failed],
			passes: this.counts[TestResultState.Passed],
			controller: this.request.targets.map(t => t.controllerId).join(',')
		});
	}

	public markRetired(testIds: WellDefinedPrefixTree<undefined> | undefined) {
		for (const [id, test] of this.testById) {
			if (!test.retired && (!testIds || testIds.hasKeyOrParent(TestId.fromString(id).path))) {
				test.retired = true;
				this.changeEmitter.fire({ reason: TestResultItemChangeReason.ComputedStateChange, item: test, result: this });
			}
		}
	}

	public toJSON(): ISerializedTestResults | undefined {
		return this.completedAt && this.persist ? this.doSerialize.value : undefined;
	}

	public toJSONWithMessages(): ISerializedTestResults | undefined {
		return this.completedAt && this.persist ? this.doSerializeWithMessages.value : undefined;
	}

	protected setAllToState(state: TestResultState, taskId: string, when: (task: ITestTaskState, item: TestResultItem) => boolean) {
		const index = this.mustGetTaskIndex(taskId);
		for (const test of this.testById.values()) {
			if (when(test.tasks[index], test)) {
				this.fireUpdateAndRefresh(test, index, state);
			}
		}
	}

	private fireUpdateAndRefresh(entry: TestResultItem, taskIndex: number, newState: TestResultState, newOwnDuration?: number) {
		const previousOwnComputed = entry.ownComputedState;
		const previousOwnDuration = entry.ownDuration;
		const changeEvent: TestResultItemChange = {
			item: entry,
			result: this,
			reason: TestResultItemChangeReason.OwnStateChange,
			previousState: previousOwnComputed,
			previousOwnDuration: previousOwnDuration,
		};

		entry.tasks[taskIndex].state = newState;
		if (newOwnDuration !== undefined) {
			entry.tasks[taskIndex].duration = newOwnDuration;
			entry.ownDuration = Math.max(entry.ownDuration || 0, newOwnDuration);
		}

		const newOwnComputed = maxPriority(...entry.tasks.map(t => t.state));
		if (newOwnComputed === previousOwnComputed) {
			if (newOwnDuration !== previousOwnDuration) {
				this.changeEmitter.fire(changeEvent);
			}
			return;
		}

		entry.ownComputedState = newOwnComputed;
		this.counts[previousOwnComputed]--;
		this.counts[newOwnComputed]++;
		refreshComputedState(this.computedStateAccessor, entry).forEach(t =>
			this.changeEmitter.fire(t === entry ? changeEvent : {
				item: t,
				result: this,
				reason: TestResultItemChangeReason.ComputedStateChange,
			}),
		);
	}

	private addTestToRun(controllerId: string, item: ITestItem, parent: string | null) {
		const node = itemToNode(controllerId, item, parent);
		this.testById.set(item.extId, node);
		this.counts[TestResultState.Unset]++;

		if (parent) {
			this.testById.get(parent)?.children.push(node);
		}

		if (this.tasks.length) {
			for (let i = 0; i < this.tasks.length; i++) {
				node.tasks.push({ duration: undefined, messages: [], state: TestResultState.Unset });
			}
		}

		return node;
	}

	private mustGetTaskIndex(taskId: string) {
		const index = this.tasks.findIndex(t => t.id === taskId);
		if (index === -1) {
			throw new Error(`Unknown task ${taskId} in updateState`);
		}

		return index;
	}

	private readonly doSerialize = new Lazy((): ISerializedTestResults => ({
		id: this.id,
		completedAt: this.completedAt!,
		tasks: this.tasks.map(t => ({ id: t.id, name: t.name, ctrlId: t.ctrlId, hasCoverage: !!t.coverage.get() })),
		name: this.name,
		request: this.request,
		items: [...this.testById.values()].map(TestResultItem.serializeWithoutMessages),
	}));

	private readonly doSerializeWithMessages = new Lazy((): ISerializedTestResults => ({
		id: this.id,
		completedAt: this.completedAt!,
		tasks: this.tasks.map(t => ({ id: t.id, name: t.name, ctrlId: t.ctrlId, hasCoverage: !!t.coverage.get() })),
		name: this.name,
		request: this.request,
		items: [...this.testById.values()].map(TestResultItem.serialize),
	}));
}

export class HydratedTestResult implements ITestResult {
	public readonly counts = makeEmptyCounts();

	public readonly id: string;

	public readonly completedAt: number;

	public readonly tasks: ITestRunTaskResults[];

	public get tests() {
		return this.testById.values();
	}

	public readonly name: string;

	public readonly request: ResolvedTestRunRequest;

	private readonly testById = new Map<string, TestResultItem>();

	constructor(
		identity: IUriIdentityService,
		private readonly serialized: ISerializedTestResults,
		private readonly persist = true,
	) {
		this.id = serialized.id;
		this.completedAt = serialized.completedAt;
		this.tasks = serialized.tasks.map((task, i) => ({
			id: task.id,
			name: task.name || localize('testUnnamedTask', 'Unnamed Task'),
			ctrlId: task.ctrlId,
			running: false,
			coverage: observableValue(this, undefined),
			output: emptyRawOutput,
			otherMessages: []
		}));
		this.name = serialized.name;
		this.request = serialized.request;

		for (const item of serialized.items) {
			const de = TestResultItem.deserialize(identity, item);
			this.counts[de.ownComputedState]++;
			this.testById.set(item.item.extId, de);
		}
	}

	public getStateById(extTestId: string) {
		return this.testById.get(extTestId);
	}

	public toJSON(): ISerializedTestResults | undefined {
		return this.persist ? this.serialized : undefined;
	}

	public toJSONWithMessages(): ISerializedTestResults | undefined {
		return this.toJSON();
	}
}
