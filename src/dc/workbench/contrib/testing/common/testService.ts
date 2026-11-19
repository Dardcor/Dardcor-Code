/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from '../../../../base/common/assert.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { LinkedList } from '../../../../base/common/linkedList.js';
import { MarshalledId } from '../../../../base/common/marshallingIds.js';
import { IObservable } from '../../../../base/common/observable.js';
import { IPrefixTreeNode, WellDefinedPrefixTree } from '../../../../base/common/prefixTree.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Location } from '../../../../editor/common/languages.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { MutableObservableValue } from './observableValue.js';
import { TestExclusions } from './testExclusions.js';
import { TestId, TestIdPathParts } from './testId.js';
import { ITestResult } from './testResult.js';
import { AbstractIncrementalTestCollection, ICallProfileRunHandler, IncrementalTestCollectionItem, InternalTestItem, IStartControllerTests, IStartControllerTestsResult, ITestItemContext, ResolvedTestRunRequest, TestControllerCapability, TestItemExpandState, TestMessageFollowupRequest, TestMessageFollowupResponse, TestRunProfileBitset, TestsDiff } from './testTypes.js';

export const ITestService = createDecorator<ITestService>('testService');

export interface IMainThreadTestController {
	readonly id: string;
	readonly label: IObservable<string>;
	readonly capabilities: IObservable<TestControllerCapability>;
	syncTests(token: CancellationToken): Promise<void>;
	refreshTests(token: CancellationToken): Promise<void>;
	configureRunProfile(profileId: number): void;
	expandTest(id: string, levels: number): Promise<void>;
	getRelatedCode(testId: string, token: CancellationToken): Promise<Location[]>;
	startContinuousRun(request: ICallProfileRunHandler[], token: CancellationToken): Promise<IStartControllerTestsResult[]>;
	runTests(request: IStartControllerTests[], token: CancellationToken): Promise<IStartControllerTestsResult[]>;
}

export interface IMainThreadTestHostProxy {
	provideTestFollowups(req: TestMessageFollowupRequest, token: CancellationToken): Promise<TestMessageFollowupResponse[]>;
	getTestsRelatedToCode(uri: URI, position: Position, token: CancellationToken): Promise<string[]>;
	executeTestFollowup(id: number): Promise<void>;
	disposeTestFollowups(ids: number[]): void;
}

export interface IMainThreadTestCollection extends AbstractIncrementalTestCollection<IncrementalTestCollectionItem> {
	readonly onBusyProvidersChange: Event<number>;

	busyProviders: number;

	rootIds: Iterable<string>;

	rootItems: Iterable<IncrementalTestCollectionItem>;

	all: Iterable<IncrementalTestCollectionItem>;

	getNodeById(id: string): IncrementalTestCollectionItem | undefined;

	getNodeByUrl(uri: URI): Iterable<IncrementalTestCollectionItem>;

	expand(testId: string, levels: number): Promise<void>;

	getReviverDiff(): TestsDiff;
}

export const testCollectionIsEmpty = (collection: IMainThreadTestCollection) =>
	!Iterable.some(collection.rootItems, r => r.children.size > 0);

export const getContextForTestItem = (collection: IMainThreadTestCollection, id: string | TestId) => {
	if (typeof id === 'string') {
		id = TestId.fromString(id);
	}

	if (id.isRoot) {
		return { controller: id.toString() };
	}

	const context: ITestItemContext = { $mid: MarshalledId.TestItemContext, tests: [] };
	for (const i of id.idsFromRoot()) {
		if (!i.isRoot) {
			const test = collection.getNodeById(i.toString());
			if (test) {
				context.tests.push(test);
			}
		}
	}

	return context;
};

export const expandAndGetTestById = async (collection: IMainThreadTestCollection, id: string, ct = CancellationToken.None) => {
	const idPath = [...TestId.fromString(id).idsFromRoot()];

	let expandToLevel = 0;
	for (let i = idPath.length - 1; !ct.isCancellationRequested && i >= expandToLevel;) {
		const id = idPath[i].toString();
		const existing = collection.getNodeById(id);
		if (!existing) {
			i--;
			continue;
		}

		if (i === idPath.length - 1) {
			return existing;
		}

		if (!existing.children.has(idPath[i + 1].toString())) {
			await collection.expand(id, 0);
		}

		expandToLevel = i + 1;
		i = idPath.length - 1;
	}
	return undefined;
};

export const waitForTestToBeIdle = (testService: ITestService, test: IncrementalTestCollectionItem) => {
	if (!test.item.busy) {
		return;
	}

	return new Promise<void>(resolve => {
		const l = testService.onDidProcessDiff(() => {
			if (testService.collection.getNodeById(test.item.extId)?.item.busy !== true) {
				resolve();
				l.dispose();
			}
		});
	});
};

export const testsInFile = async function* (testService: ITestService, ident: IUriIdentityService, uri: URI, waitForIdle = true, descendInFile = true): AsyncIterable<readonly IncrementalTestCollectionItem[]> {
	const canonicalUri = ident.asCanonicalUri(uri);

	const queue = new LinkedList<Iterable<string> | DeferredPromise<Iterable<string>>>();

	const existing = [...testService.collection.getNodeByUrl(canonicalUri)].sort((a, b) => a.item.extId.length - b.item.extId.length);

	for (let i = 0; i < existing.length - 1; i++) {
		const prefix = existing[i].item.extId + TestIdPathParts.Delimiter;
		for (let k = i + 1; k < existing.length; k++) {
			if (existing[k].item.extId.startsWith(prefix)) {
				existing.splice(k--, 1);
			}
		}
	}

	queue.push(existing.length ? existing.map(e => e.item.extId) : testService.collection.rootIds);

	let n = 0;
	let gather: IncrementalTestCollectionItem[] = [];
	while (queue.size > 0) {
		const next = queue.pop()!;
		let ids: Iterable<string>;
		if (!(next instanceof DeferredPromise)) {
			ids = next;
		} else if (next.isSettled) {
			ids = next.value || Iterable.empty();
		} else {
			if (gather.length) {
				yield gather;
				gather = [];
			}
			ids = await next.p;
		}

		for (const id of ids) {
			n++;
			const test = testService.collection.getNodeById(id);
			if (!test) {
				continue;
			}

			if (!test.item.uri) {
				queue.push(test.children);
				continue;
			}

			if (ident.extUri.isEqual(canonicalUri, test.item.uri)) {
				gather.push(test);

				if (!descendInFile) {
					continue;
				}
			}

			if (ident.extUri.isEqualOrParent(canonicalUri, test.item.uri)) {
				let prom: Promise<void> | undefined;
				if (test.expand === TestItemExpandState.Expandable) {
					prom = testService.collection.expand(test.item.extId, 1);
				}
				if (waitForIdle) {
					if (prom) {
						prom = prom.then(() => waitForTestToBeIdle(testService, test));
					} else if (test.item.busy) {
						prom = waitForTestToBeIdle(testService, test);
					}
				}

				if (prom) {
					queue.push(DeferredPromise.fromPromise(prom.then(() => test.children)));
				} else if (test.children.size) {
					queue.push(test.children);
				}
			}
		}
	}

	if (gather.length) {
		yield gather;
	}
};

export const testsUnderUri = async function* (testService: ITestService, ident: IUriIdentityService, uri: URI, waitForIdle = true): AsyncIterable<IncrementalTestCollectionItem> {

	const queue = [testService.collection.rootIds];
	while (queue.length) {
		for (const testId of queue.pop()!) {
			const test = testService.collection.getNodeById(testId);

			if (!test) {
			} else if (test.item.uri && ident.extUri.isEqualOrParent(test.item.uri, uri)) {
				yield test;
			} else if (!test.item.uri || ident.extUri.isEqualOrParent(uri, test.item.uri)) {
				if (test.expand === TestItemExpandState.Expandable) {
					await testService.collection.expand(test.item.extId, 1);
				}
				if (waitForIdle) {
					await waitForTestToBeIdle(testService, test);
				}
				queue.push(test.children.values());
			}
		}
	}
};

export const simplifyTestsToExecute = (collection: IMainThreadTestCollection, tests: IncrementalTestCollectionItem[]): IncrementalTestCollectionItem[] => {
	if (tests.length < 2) {
		return tests;
	}

	const tree = new WellDefinedPrefixTree<IncrementalTestCollectionItem>();
	for (const test of tests) {
		tree.insert(TestId.fromString(test.item.extId).path, test);
	}

	const out: IncrementalTestCollectionItem[] = [];

	const process = (currentId: string[], node: IPrefixTreeNode<IncrementalTestCollectionItem>) => {
		if (node.value) {
			return node.value;
		}

		assert(!!node.children, 'expect to have children');

		const thisChildren: IncrementalTestCollectionItem[] = [];
		for (const [part, child] of node.children) {
			currentId.push(part);
			const c = process(currentId, child);
			if (c) { thisChildren.push(c); }
			currentId.pop();
		}

		if (!thisChildren.length) {
			return;
		}

		const id = new TestId(currentId);
		const test = collection.getNodeById(id.toString());
		if (test?.children.size === thisChildren.length) {
			return test;
		}

		out.push(...thisChildren);
		return;
	};

	for (const [id, node] of tree.entries) {
		const n = process([id], node);
		if (n) { out.push(n); }
	}

	return out;
};

export interface AmbiguousRunTestsRequest {
	group: TestRunProfileBitset;
	tests: readonly InternalTestItem[];
	exclude?: InternalTestItem[];
	continuous?: boolean;
	preserveFocus?: boolean;
}

export interface ITestFollowup {
	message: string;
	execute(): Promise<void>;
}

export interface ITestFollowups extends IDisposable {
	followups: ITestFollowup[];
}

export interface ITestService {
	readonly _serviceBrand: undefined;
	readonly onDidCancelTestRun: Event<{ runId: string | undefined; taskId: string | undefined }>;

	readonly excluded: TestExclusions;

	readonly collection: IMainThreadTestCollection;

	readonly onWillProcessDiff: Event<TestsDiff>;

	readonly onDidProcessDiff: Event<TestsDiff>;

	readonly showInlineOutput: MutableObservableValue<boolean>;

	registerExtHost(controller: IMainThreadTestHostProxy): IDisposable;

	registerTestController(providerId: string, controller: IMainThreadTestController): IDisposable;

	getTestController(controllerId: string): IMainThreadTestController | undefined;

	refreshTests(controllerId?: string): Promise<void>;

	cancelRefreshTests(): void;

	startContinuousRun(req: ResolvedTestRunRequest, token: CancellationToken): Promise<void>;

	runTests(req: AmbiguousRunTestsRequest, token?: CancellationToken): Promise<ITestResult>;

	runResolvedTests(req: ResolvedTestRunRequest, token?: CancellationToken): Promise<ITestResult>;

	provideTestFollowups(req: TestMessageFollowupRequest, token: CancellationToken): Promise<ITestFollowups>;

	syncTests(): Promise<void>;

	cancelTestRun(runId?: string, taskId?: string): void;

	publishDiff(controllerId: string, diff: TestsDiff): void;

	getTestsRelatedToCode(uri: URI, position: Position, token?: CancellationToken): Promise<InternalTestItem[]>;

	getCodeRelatedToTest(test: InternalTestItem, token?: CancellationToken): Promise<Location[]>;
}
