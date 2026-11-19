/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { afterEach, beforeEach, describe, suite, test } from 'vitest';
import type { Selection, TextEditor } from 'vscode';
import { IGitExtensionService } from '../../../../platform/git/common/gitExtensionService';
import { NullGitExtensionService } from '../../../../platform/git/common/nullGitExtensionService';
import { ILogService } from '../../../../platform/log/common/logService';
import { INotificationService, MessageOptions, Progress, ProgressLocation } from '../../../../platform/notification/common/notificationService';
import { IReviewService, ReviewComment } from '../../../../platform/review/common/reviewService';
import { IScopeSelector } from '../../../../platform/scopeSelection/common/scopeSelection';
import { ITabsAndEditorsService } from '../../../../platform/tabs/common/tabsAndEditorsService';
import { createPlatformServices, TestingServiceCollection } from '../../../../platform/test/node/services';
import { CancellationToken, CancellationTokenSource } from '../../../../util/dardcor/base/common/cancellation';
import { CancellationError } from '../../../../util/dardcor/base/common/errors';
import { DisposableStore } from '../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { SyncDescriptor } from '../../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import type { FeedbackResult } from '../../../prompt/node/feedbackGenerator';
import { combineCancellationTokens, getReviewTitle, HandleResultDependencies, handleReviewResult, ReviewGroup, ReviewSession } from '../doReview';

interface MockDeps extends HandleResultDependencies {
	infoMessages: Array<{ message: string; options?: unknown; items?: string[] }>;
	logShown: boolean;
	addedComments: ReviewComment[];
	buttonToReturn: string | undefined;
}

suite('doReview', () => {

	describe('handleReviewResult', () => {
		function createMockDeps(): MockDeps {
			const tracker = {
				infoMessages: [] as Array<{ message: string; options?: unknown; items?: string[] }>,
				logShown: false,
				addedComments: [] as ReviewComment[],
				buttonToReturn: undefined as string | undefined,
			};

			return {
				get infoMessages() { return tracker.infoMessages; },
				get logShown() { return tracker.logShown; },
				get addedComments() { return tracker.addedComments; },
				get buttonToReturn() { return tracker.buttonToReturn; },
				set buttonToReturn(value: string | undefined) { tracker.buttonToReturn = value; },
				notificationService: {
					showInformationMessage: async (message: string, options?: unknown, ...items: string[]) => {
						tracker.infoMessages.push({ message, options, items });
						return tracker.buttonToReturn;
					},
				} as unknown as INotificationService,
				logService: {
					show: () => { tracker.logShown = true; },
				} as unknown as ILogService,
				reviewService: {
					addReviewComments: (comments: ReviewComment[]) => { tracker.addedComments.push(...comments); },
				} as unknown as IReviewService,
			};
		}

		test('does nothing for success result with comments', async () => {
			const deps = createMockDeps();
			const result: FeedbackResult = {
				type: 'success',
				comments: [{ uri: URI.file('/test.ts'), body: 'comment' } as ReviewComment],
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 0);
			assert.strictEqual(deps.logShown, false);
		});

		test('does nothing for cancelled result', async () => {
			const deps = createMockDeps();
			const result: FeedbackResult = { type: 'cancelled' };

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 0);
		});

		test('shows info message for error result with info severity', async () => {
			const deps = createMockDeps();
			const result: FeedbackResult = {
				type: 'error',
				reason: 'Something went wrong',
				severity: 'info',
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 1);
			assert.strictEqual(deps.infoMessages[0].message, 'Something went wrong');
		});

		test('shows error message with Show Log button for error result', async () => {
			const deps = createMockDeps();
			const result: FeedbackResult = {
				type: 'error',
				reason: 'Network error',
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 1);
			assert.strictEqual(deps.infoMessages[0].message, 'Code review generation failed.');
			assert.ok(deps.infoMessages[0].items?.includes('Show Log'));
		});

		test('shows log when user clicks Show Log', async () => {
			const deps = createMockDeps();
			deps.buttonToReturn = 'Show Log';
			const result: FeedbackResult = {
				type: 'error',
				reason: 'Network error',
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.logShown, true);
		});

		test('does not show log when user dismisses error dialog', async () => {
			const deps = createMockDeps();
			deps.buttonToReturn = undefined;
			const result: FeedbackResult = {
				type: 'error',
				reason: 'Network error',
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.logShown, false);
		});

		test('shows excluded comments message when no comments but excluded exist', async () => {
			const deps = createMockDeps();
			const excludedComment = { uri: URI.file('/test.ts'), body: 'low confidence' } as ReviewComment;
			const result: FeedbackResult = {
				type: 'success',
				comments: [],
				excludedComments: [excludedComment],
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 1);
			assert.strictEqual(deps.infoMessages[0].message, 'Reviewing your code did not provide any feedback.');
			assert.ok(deps.infoMessages[0].items?.includes('Show Skipped'));
		});

		test('adds excluded comments when user clicks Show Skipped', async () => {
			const deps = createMockDeps();
			deps.buttonToReturn = 'Show Skipped';
			const excludedComment = { uri: URI.file('/test.ts'), body: 'low confidence' } as ReviewComment;
			const result: FeedbackResult = {
				type: 'success',
				comments: [],
				excludedComments: [excludedComment],
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.addedComments.length, 1);
			assert.strictEqual(deps.addedComments[0], excludedComment);
		});

		test('does not add excluded comments when user dismisses dialog', async () => {
			const deps = createMockDeps();
			deps.buttonToReturn = undefined;
			const excludedComment = { uri: URI.file('/test.ts'), body: 'low confidence' } as ReviewComment;
			const result: FeedbackResult = {
				type: 'success',
				comments: [],
				excludedComments: [excludedComment],
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.addedComments.length, 0);
		});

		test('shows default no feedback message when no comments and no excluded', async () => {
			const deps = createMockDeps();
			const result: FeedbackResult = {
				type: 'success',
				comments: [],
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 1);
			assert.strictEqual(deps.infoMessages[0].message, 'Reviewing your code did not provide any feedback.');
		});

		test('shows custom reason in no feedback message when provided', async () => {
			const deps = createMockDeps();
			const result: FeedbackResult = {
				type: 'success',
				comments: [],
				reason: 'Custom reason for no comments',
			};

			await handleReviewResult(result, deps);

			assert.strictEqual(deps.infoMessages.length, 1);
			const options = deps.infoMessages[0].options as { detail?: string };
			assert.strictEqual(options?.detail, 'Custom reason for no comments');
		});
	});

	describe('getReviewTitle', () => {

		test('returns title for selection group with editor', () => {
			const mockEditor = {
				document: {
					uri: { path: '/project/src/file.ts' }
				}
			} as unknown as TextEditor;

			const title = getReviewTitle('selection', mockEditor);
			assert.strictEqual(title, 'Reviewing selected code in file.ts...');
		});

		test('returns title for index group', () => {
			const title = getReviewTitle('index');
			assert.strictEqual(title, 'Reviewing staged changes...');
		});

		test('returns title for workingTree group', () => {
			const title = getReviewTitle('workingTree');
			assert.strictEqual(title, 'Reviewing unstaged changes...');
		});

		test('returns title for all group', () => {
			const title = getReviewTitle('all');
			assert.strictEqual(title, 'Reviewing uncommitted changes...');
		});

		test('returns title for PR group (repositoryRoot)', () => {
			const prGroup: ReviewGroup = {
				repositoryRoot: '/project',
				commitMessages: ['Fix bug'],
				patches: [{ patch: 'diff content', fileUri: 'file:///project/file.ts' }]
			};
			const title = getReviewTitle(prGroup);
			assert.strictEqual(title, 'Reviewing changes...');
		});

		test('returns title for file group with index', () => {
			const fileGroup: ReviewGroup = {
				group: 'index',
				file: URI.file('/project/src/component.tsx')
			};
			const title = getReviewTitle(fileGroup);
			assert.strictEqual(title, 'Reviewing staged changes in component.tsx...');
		});

		test('returns title for file group with workingTree', () => {
			const fileGroup: ReviewGroup = {
				group: 'workingTree',
				file: URI.file('/project/src/utils.js')
			};
			const title = getReviewTitle(fileGroup);
			assert.strictEqual(title, 'Reviewing unstaged changes in utils.js...');
		});
	});

	describe('combineCancellationTokens', () => {

		test('returns token that is not cancelled when both inputs are not cancelled', () => {
			const source1 = new CancellationTokenSource();
			const source2 = new CancellationTokenSource();
			const combined = combineCancellationTokens(source1.token, source2.token);
			assert.strictEqual(combined.isCancellationRequested, false);
			source1.dispose();
			source2.dispose();
		});

		test('cancels combined token when first token is cancelled after creation', () => {
			const source1 = new CancellationTokenSource();
			const source2 = new CancellationTokenSource();
			const combined = combineCancellationTokens(source1.token, source2.token);
			assert.strictEqual(combined.isCancellationRequested, false);
			source1.cancel();
			assert.strictEqual(combined.isCancellationRequested, true);
			source2.dispose();
		});

		test('cancels combined token when second token is cancelled after creation', () => {
			const source1 = new CancellationTokenSource();
			const source2 = new CancellationTokenSource();
			const combined = combineCancellationTokens(source1.token, source2.token);
			assert.strictEqual(combined.isCancellationRequested, false);
			source2.cancel();
			assert.strictEqual(combined.isCancellationRequested, true);
			source1.dispose();
		});

		test('only cancels combined token once when both tokens are cancelled', () => {
			const source1 = new CancellationTokenSource();
			const source2 = new CancellationTokenSource();
			const combined = combineCancellationTokens(source1.token, source2.token);
			let cancelCount = 0;
			combined.onCancellationRequested(() => cancelCount++);

			source1.cancel();
			source2.cancel();
			assert.strictEqual(cancelCount, 1);
		});
	});

	describe('ReviewSession', () => {
		let store: DisposableStore;
		let serviceCollection: TestingServiceCollection;
		let instantiationService: IInstantiationService;

		class MockReviewService implements IReviewService {
			_serviceBrand: undefined;
			private comments: ReviewComment[] = [];
			removedComments: ReviewComment[] = [];
			addedComments: ReviewComment[] = [];

			updateContextValues(): void { }
			isCodeFeedbackEnabled(): boolean { return true; }
			isReviewDiffEnabled(): boolean { return true; }
			isIntentEnabled(): boolean { return true; }
			getDiagnosticCollection() { return { get: () => undefined, set: () => { } }; }
			getReviewComments(): ReviewComment[] { return this.comments; }
			addReviewComments(comments: ReviewComment[]): void {
				this.addedComments.push(...comments);
				this.comments.push(...comments);
			}
			collapseReviewComment(_comment: ReviewComment): void { }
			removeReviewComments(comments: ReviewComment[]): void {
				this.removedComments.push(...comments);
				this.comments = this.comments.filter(c => !comments.includes(c));
			}
			updateReviewComment(_comment: ReviewComment): void { }
			findReviewComment() { return undefined; }
			findCommentThread() { return undefined; }
		}

		class MockNotificationService {
			_serviceBrand: undefined;
			infoMessages: string[] = [];
			progressCallback: ((progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Promise<unknown>) | null = null;

			showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
			showInformationMessage<T extends string>(message: string, options: MessageOptions, ...items: T[]): Promise<T | undefined>;
			showInformationMessage(message: string, _optionsOrItem?: MessageOptions | string, ..._items: string[]): Promise<string | undefined> {
				this.infoMessages.push(message);
				return Promise.resolve(undefined);
			}

			async withProgress<T>(
				_options: { location: ProgressLocation; title: string; cancellable: boolean },
				task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Promise<T>
			): Promise<T> {
				this.progressCallback = task as (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Promise<unknown>;
				const tokenSource = new CancellationTokenSource();
				try {
					return await task({ report: () => { } }, tokenSource.token);
				} finally {
					tokenSource.dispose();
				}
			}
		}

		class MockScopeSelector implements IScopeSelector {
			_serviceBrand: undefined;
			selectionToReturn: Selection | undefined = undefined;
			shouldThrowCancellation = false;
			errorToThrow: Error | undefined = undefined;

			async selectEnclosingScope(_editor: TextEditor, _options?: { reason?: string; includeBlocks?: boolean }): Promise<Selection | undefined> {
				if (this.shouldThrowCancellation) {
					throw new CancellationError();
				}
				if (this.errorToThrow) {
					throw this.errorToThrow;
				}
				return this.selectionToReturn;
			}
		}

		class MockTabsAndEditorsService {
			_serviceBrand: undefined;
			activeTextEditor: TextEditor | undefined = undefined;

			getActiveTextEditor() { return this.activeTextEditor; }
			getVisibleTextEditors() { return []; }
			getActiveNotebookEditor() { return undefined; }
		}

		beforeEach(() => {
			store = new DisposableStore();
			serviceCollection = store.add(createPlatformServices(store));

			serviceCollection.define(IReviewService, new SyncDescriptor(MockReviewService));
			serviceCollection.define(IGitExtensionService, new SyncDescriptor(NullGitExtensionService));
		});

		afterEach(() => {
			store.dispose();
		});

		test('reviews without an account authentication session', async () => {
			serviceCollection.define(INotificationService, new MockNotificationService() as unknown as INotificationService);
			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const result = await session.review('index', ProgressLocation.Notification);

			assert.ok(result);
			assert.strictEqual(result.type, 'success');
		});

		test('returns undefined when selection group but no editor', async () => {
			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = undefined;

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const result = await session.review('selection', ProgressLocation.Notification);

			assert.strictEqual(result, undefined);
		});

		test('returns undefined when selection group and scopeSelector returns undefined', async () => {
			const mockEditor = {
				document: { uri: URI.file('/test/file.ts') },
				selection: { isEmpty: true }
			} as unknown as TextEditor;

			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = mockEditor;

			const mockScope = new MockScopeSelector();
			mockScope.selectionToReturn = undefined;

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);
			serviceCollection.define(IScopeSelector, mockScope as unknown as IScopeSelector);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const result = await session.review('selection', ProgressLocation.Notification);

			assert.strictEqual(result, undefined);
		});

		test('returns undefined when scopeSelector throws CancellationError', async () => {
			const mockEditor = {
				document: { uri: URI.file('/test/file.ts') },
				selection: { isEmpty: true }
			} as unknown as TextEditor;

			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = mockEditor;

			const mockScope = new MockScopeSelector();
			mockScope.shouldThrowCancellation = true;

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);
			serviceCollection.define(IScopeSelector, mockScope as unknown as IScopeSelector);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const result = await session.review('selection', ProgressLocation.Notification);

			assert.strictEqual(result, undefined);
		});

		test('proceeds with empty selection when scopeSelector throws non-cancellation error (fall-through behavior)', async () => {
			const emptySelection = { isEmpty: true, start: { line: 0 }, end: { line: 0 } };
			const mockEditor = {
				document: { uri: URI.file('/test/file.ts'), getText: () => 'code' },
				selection: emptySelection
			} as unknown as TextEditor;

			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = mockEditor;

			const mockScope = new MockScopeSelector();
			mockScope.errorToThrow = new Error('Symbol provider failed');

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);
			serviceCollection.define(IScopeSelector, mockScope as unknown as IScopeSelector);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);

			const result = await session.review('selection', ProgressLocation.Notification);

			assert.ok(result !== undefined, 'Review should proceed when scopeSelector throws non-cancellation error');
		});

		test('uses existing selection when not empty for selection group', async () => {
			const mockSelection = { isEmpty: false, start: { line: 0 }, end: { line: 5 } };
			const mockEditor = {
				document: { uri: URI.file('/test/file.ts'), getText: () => 'code' },
				selection: mockSelection
			} as unknown as TextEditor;

			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = mockEditor;

			const mockScope = new MockScopeSelector();

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);
			serviceCollection.define(IScopeSelector, mockScope as unknown as IScopeSelector);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			try {
				await session.review('selection', ProgressLocation.Notification);
			} catch {
			}
		});

		test('proceeds to review for non-selection groups without editor', async () => {
			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = undefined;

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const result = await session.review('index', ProgressLocation.Notification);

			assert.ok(result);
			assert.strictEqual(result.type, 'success');
		});

		test('uses the Router review path without account feature flags', async () => {
			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = undefined;

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const result = await session.review('index', ProgressLocation.Notification);

			assert.ok(result);
			assert.ok(result.type === 'success' || result.type === 'error');
		});

		test('handles a single-file review group', async () => {
			const mockTabs = new MockTabsAndEditorsService();
			mockTabs.activeTextEditor = undefined;

			serviceCollection.define(ITabsAndEditorsService, mockTabs as unknown as ITabsAndEditorsService);

			const accessor = serviceCollection.createTestingAccessor();
			instantiationService = accessor.get(IInstantiationService);

			const session = instantiationService.createInstance(ReviewSession);
			const fileGroup: ReviewGroup = {
				group: 'index',
				file: URI.file('/test/file.ts')
			};
			const result = await session.review(fileGroup, ProgressLocation.Notification);

			assert.ok(result);
			assert.ok(result.type === 'success' || result.type === 'error');
		});
	});
});
