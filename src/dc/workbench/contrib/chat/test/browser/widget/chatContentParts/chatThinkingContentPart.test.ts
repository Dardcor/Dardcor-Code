/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { workbenchInstantiationService } from '../../../../../../test/browser/workbenchTestServices.js';
import { isResourceMultiDiffEditorInput } from '../../../../../../common/editor.js';
import { IEditorService } from '../../../../../../services/editor/common/editorService.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ITelemetryService } from '../../../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryServiceShape } from '../../../../../../../platform/telemetry/common/telemetryUtils.js';
import { ChatCollapsibleContentPart } from '../../../../browser/widget/chatContentParts/chatCollapsibleContentPart.js';
import { ChatThinkingContentPart, getToolInvocationIcon, maybePickFunWorkingMessage, splitReasoningSummaryRows } from '../../../../browser/widget/chatContentParts/chatThinkingContentPart.js';
import { IChatExternalEdit, IChatMarkdownContent, IChatThinkingPart, IChatToolInvocation, IChatToolInvocationSerialized } from '../../../../common/chatService/chatService.js';
import { IChatContentPartDiffData, IChatContentPartRenderContext, InlineTextModelCollection } from '../../../../browser/widget/chatContentParts/chatContentParts.js';
import { IChatRendererContent, IChatResponseViewModel } from '../../../../common/model/chatViewModel.js';
import { IChatMarkdownAnchorService } from '../../../../browser/widget/chatContentParts/chatMarkdownAnchorService.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IRenderedMarkdown, MarkdownRenderOptions, renderMarkdown } from '../../../../../../../base/browser/markdownRenderer.js';
import { IMarkdownString, MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { ChatConfiguration, ThinkingDisplayMode } from '../../../../common/constants.js';
import { EditorPool, DiffEditorPool } from '../../../../browser/widget/chatContentParts/chatContentCodePools.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { ILanguageModelsService } from '../../../../common/languageModels.js';
import { ToolDataSource } from '../../../../common/tools/languageModelToolsService.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';
import { chatSessionResourceToId } from '../../../../common/model/chatUri.js';
import { mock } from '../../../../../../../base/test/common/mock.js';

suite('ChatThinkingContentPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let disposables: DisposableStore;
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let mockConfigurationService: TestConfigurationService;
	let mockMarkdownRenderer: IMarkdownRenderer;
	let mockAnchorService: IChatMarkdownAnchorService;
	let mockHoverService: IHoverService;
	let mockLanguageModelsService: ILanguageModelsService;

	function createMockRenderContext(isComplete: boolean = false): IChatContentPartRenderContext {
		const mockElement: Partial<IChatResponseViewModel> = {
			isComplete,
			id: 'test-response-id',
			sessionResource: URI.parse('chat-session://test/session1'),
			get model() { return {} as IChatResponseViewModel['model']; }
		};

		return {
			element: mockElement as IChatResponseViewModel,
			inlineTextModels: {} as InlineTextModelCollection,
			elementIndex: 0,
			container: mainWindow.document.createElement('div'),
			content: [],
			contentIndex: 0,
			editorPool: {} as EditorPool,
			codeBlockStartIndex: 0,
			treeStartIndex: 0,
			diffEditorPool: {} as DiffEditorPool,
			currentWidth: observableValue('currentWidth', 500),
			onDidChangeVisibility: Event.None
		};
	}

	function createThinkingPart(value?: string, id?: string): IChatThinkingPart {
		return {
			kind: 'thinking',
			value: value ?? '',
			id: id ?? 'test-thinking-id'
		};
	}

	function createDiffData(added: number, removed: number, resourceName = 'file.ts', version = '1'): IChatContentPartDiffData {
		return {
			added,
			removed,
			resources: [{
				resource: URI.file(`/workspace/${resourceName}`),
				originalURI: URI.file(`/snapshots/${version}/before/${resourceName}`),
				modifiedURI: URI.file(`/snapshots/${version}/after/${resourceName}`),
			}],
		};
	}

	setup(() => {
		disposables = store.add(new DisposableStore());
		instantiationService = workbenchInstantiationService(undefined, store);

		mockConfigurationService = new TestConfigurationService();
		instantiationService.stub(IConfigurationService, mockConfigurationService);

		mockMarkdownRenderer = {
			render: (_markdown: IMarkdownString, options?: MarkdownRenderOptions, outElement?: HTMLElement): IRenderedMarkdown => {
				const element = outElement ?? mainWindow.document.createElement('div');
				const content = typeof _markdown === 'string' ? _markdown : (_markdown.value ?? '');
				element.textContent = content;
				return {
					element,
					dispose: () => { }
				};
			}
		};

		mockAnchorService = {
			_serviceBrand: undefined,
			register: () => toDisposable(() => { }),
			lastFocusedAnchor: undefined
		};
		instantiationService.stub(IChatMarkdownAnchorService, mockAnchorService);

		mockHoverService = {
			_serviceBrand: undefined,
			showHover: () => undefined,
			showDelayedHover: () => undefined,
			showAndFocusLastHover: () => { },
			hideHover: () => { },
			setupDelayedHover: () => toDisposable(() => { }),
			setupManagedHover: () => ({ dispose: () => { }, show: () => { }, hide: () => { }, update: () => { } }),
			showManagedHover: () => undefined,
			isHovered: () => false,
		} as unknown as IHoverService;
		instantiationService.stub(IHoverService, mockHoverService);

		mockLanguageModelsService = {
			_serviceBrand: undefined,
			onDidChangeLanguageModels: Event.None,
			getLanguageModelIds: () => [],
			lookupLanguageModel: () => undefined,
			selectLanguageModels: async () => [],
			registerLanguageModelChat: () => toDisposable(() => { }),
			sendChatRequest: async () => ({ stream: (async function* () { })(), result: Promise.resolve({}) }),
			computeTokenLength: async () => 0
		} as unknown as ILanguageModelsService;
		instantiationService.stub(ILanguageModelsService, mockLanguageModelsService);
	});

	teardown(() => {
		disposables.dispose();
	});

	test('replace thinking phrases suppresses fun default phrases', () => {
		mockConfigurationService.setUserConfiguration(ChatConfiguration.ThinkingPhrases, {
			mode: 'replace',
			phrases: ['Custom phrase'],
		});

		assert.strictEqual(maybePickFunWorkingMessage(mockConfigurationService, () => 0), undefined);
	});

	test('uses a search icon only when no problems were found', () => {
		assert.deepStrictEqual({
			referenceName: getToolInvocationIcon('problems', Codicon.error, 'Checked files, no problems found'),
			internalTool: getToolInvocationIcon('get_errors', Codicon.error, 'Checked files, no problems found'),
			contributedTool: getToolInvocationIcon('copilot_getErrors', Codicon.error, 'Checked files, no problems found'),
			problemsFound: getToolInvocationIcon('problems', Codicon.error, 'Checked files, 2 problems found'),
			unrelatedTool: getToolInvocationIcon('terminal', Codicon.terminal, 'No problems found'),
		}, {
			referenceName: Codicon.search,
			internalTool: Codicon.search,
			contributedTool: Codicon.search,
			problemsFound: Codicon.error,
			unrelatedTool: Codicon.terminal,
		});
	});

	test('uses a comment icon for comment tools', () => {
		assert.deepStrictEqual({
			addComment: getToolInvocationIcon('addComment'),
			listComments: getToolInvocationIcon('listComments'),
			deleteComments: getToolInvocationIcon('deleteComments'),
			resolveComments: getToolInvocationIcon('resolveComments'),
			viewUnreviewedComments: getToolInvocationIcon('viewUnreviewedComments'),
			prefixedComment: getToolInvocationIcon('mcp__host__addComment'),
		}, {
			addComment: Codicon.comment,
			listComments: Codicon.comment,
			deleteComments: Codicon.comment,
			resolveComments: Codicon.comment,
			viewUnreviewedComments: Codicon.comment,
			prefixedComment: Codicon.comment,
		});
	});

	suite('ThinkingDisplayMode.Collapsed', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('should start collapsed', () => {
			const content = createThinkingPart('**Analyzing code**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const animationContainer = part.domNode.querySelector('.chat-collapsible-content-animation');
			const animationContent = part.domNode.querySelector<HTMLElement>('.chat-collapsible-content-animation-inner');
			assert.deepStrictEqual({
				collapsed: part.domNode.classList.contains('chat-used-context-collapsed'),
				hasAnimationContainer: !!animationContainer,
				animationEnabled: part.domNode.classList.contains('chat-collapsible-content-animated'),
				contentIsInert: animationContent?.inert,
			}, {
				collapsed: true,
				hasAnimationContainer: true,
				animationEnabled: true,
				contentIsInert: true,
			});
		});

		test('logs telemetry when the user toggles the header', () => {
			const telemetryService = new class extends NullTelemetryServiceShape {
				readonly events: { readonly name: string; readonly data: unknown }[] = [];
				override publicLog2(eventName?: string, data?: unknown): void {
					if (eventName) {
						this.events.push({ name: eventName, data });
					}
				}
			}();
			instantiationService.stub(ITelemetryService, telemetryService);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				createThinkingPart('**Analyzing code**'),
				createMockRenderContext(false),
				mockMarkdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			assert.ok(button);
			button.click();
			button.click();

			assert.deepStrictEqual(telemetryService.events, [
				{ name: 'chat.collapsibleToggle', data: { kind: 'thinking', previousExpanded: false, thinkingStyle: ThinkingDisplayMode.Collapsed, inThinking: false } },
				{ name: 'chat.collapsibleToggle', data: { kind: 'thinking', previousExpanded: true, thinkingStyle: ThinkingDisplayMode.Collapsed, inThinking: false } },
			]);
		});

		test('should have chat-thinking-box class', () => {
			const content = createThinkingPart('**Processing**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			assert.ok(part.domNode.classList.contains('chat-thinking-box'), 'Should have chat-thinking-box class');
		});

		test('should extract title from bold markdown', () => {
			const content = createThinkingPart('**Reading configuration files**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.ok(button, 'Should have collapse button');
			const labelElement = button.querySelector('.icon-label');
			assert.ok(labelElement?.textContent?.includes('Reading configuration files') || button.textContent?.includes('Reading configuration files'),
				'Title should contain extracted text');
		});

		test('lazy rendering - should not render content until expanded', () => {
			const content = createThinkingPart('**Initial thinking content**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const contentList = part.domNode.querySelector('.chat-used-context-list');
			assert.strictEqual(contentList, null, 'Content should not be rendered when collapsed');
		});

		test('lazy rendering - should render content when expanded', () => {
			const content = createThinkingPart('**Thinking content to render**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.ok(button, 'Should have expand button');
			button.click();

			const contentList = part.domNode.querySelector('.chat-used-context-list');
			assert.ok(contentList, 'Content should be rendered after expanding');
		});

		test('user toggle event bubbles before expansion changes', () => {
			const content = createThinkingPart('**Thinking content to render**');
			const context = createMockRenderContext(false);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));
			const ancestor = mainWindow.document.createElement('div');
			ancestor.appendChild(part.domNode);
			mainWindow.document.body.appendChild(ancestor);
			disposables.add(toDisposable(() => ancestor.remove()));

			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			assert.ok(button);
			let toggleCount = 0;
			let expandedDuringToggle: string | null | undefined;
			const listener = () => {
				toggleCount++;
				expandedDuringToggle = button.ariaExpanded;
			};
			ancestor.addEventListener(ChatCollapsibleContentPart.userToggleEvent, listener);
			disposables.add(toDisposable(() => ancestor.removeEventListener(ChatCollapsibleContentPart.userToggleEvent, listener)));

			button.click();

			assert.deepStrictEqual({
				toggleCount,
				expandedDuringToggle,
				expandedAfterToggle: button.ariaExpanded,
			}, {
				toggleCount: 1,
				expandedDuringToggle: 'false',
				expandedAfterToggle: 'true',
			});
		});
	});

	suite('ThinkingDisplayMode.CollapsedPreview', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.CollapsedPreview);
		});

		test('should start expanded when streaming (not complete)', () => {
			const content = createThinkingPart('**Analyzing**\nSome detailed reasoning about the code structure');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			assert.strictEqual(part.domNode.classList.contains('chat-used-context-collapsed'), false,
				'Should be expanded during streaming in CollapsedPreview mode');
		});

		test('should be collapsed when complete', () => {
			const content = createThinkingPart('**Completed task**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			assert.strictEqual(part.domNode.classList.contains('chat-used-context-collapsed'), true,
				'Should be collapsed when complete');
		});

		test('should be collapsed when streamingCompleted is true even if element.isComplete is false (look-ahead completion)', () => {
			const content = createThinkingPart('**Finished analyzing**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			assert.strictEqual(part.domNode.classList.contains('chat-used-context-collapsed'), true,
				'Should be collapsed when streamingCompleted is true, even if element.isComplete is false');
		});

		test('should use lazy rendering when streamingCompleted is true even if element.isComplete is false', () => {
			const content = createThinkingPart('**Looking ahead completed**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const contentList = part.domNode.querySelector('.chat-used-context-list');
			assert.strictEqual(contentList, null, 'Content should not be rendered when streamingCompleted=true (collapsed = lazy)');
		});
	});

	suite('ThinkingDisplayMode.FixedScrolling', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.FixedScrolling);
		});

		test('should have fixed mode class', () => {
			const content = createThinkingPart('**Scrolling content**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			assert.ok(part.domNode.classList.contains('chat-thinking-fixed-mode'),
				'Should have fixed mode class');
			assert.strictEqual(part.domNode.querySelector('.chat-collapsible-content-animation'), null,
				'Fixed scrolling mode should not animate its content container');
		});

		test('should init content early (eager rendering)', () => {
			const content = createThinkingPart('**Fixed scrolling content**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const scrollableContent = part.domNode.querySelector('.monaco-scrollable-element');
			assert.ok(scrollableContent, 'Should have scrollable element in fixed mode (eager rendering)');
		});

		test('should create scrollable container', () => {
			const content = createThinkingPart('**Content with scrolling**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const scrollable = part.domNode.querySelector('.monaco-scrollable-element');
			assert.ok(scrollable, 'Should have scrollable container');
		});

		test('splits summary headers as they stream without replacing the scroll container', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const firstSummary = '**Evaluating issue and PR status**';
			const content = createThinkingPart('**Evaluating issue and PR sta');
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			const scrollable = part.domNode.querySelector('.monaco-scrollable-element');
			const firstRow = part.domNode.querySelector('.chat-thinking-item.markdown-content');
			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			const initialTitle = button?.textContent?.trim();

			part.updateThinking(createThinkingPart(
				`${firstSummary}\n\n**Analyzing code fix and lifecycle nuances**`,
				content.id
			));
			part.updateThinking(createThinkingPart(
				`${firstSummary}\n\n**Analyzing code fix and lifecycle nuances**\n\n**Evaluating PR merge status**`,
				content.id
			));

			const rows = Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'));
			assert.deepStrictEqual({
				scrollContainerPreserved: part.domNode.querySelector('.monaco-scrollable-element') === scrollable,
				firstRowPreserved: rows[0] === firstRow,
				rowTexts: rows.map(row => row.textContent?.trim()),
				hasLiteralMarkers: part.domNode.textContent?.includes('**') ?? false,
				initialTitle,
				streamingTitle: button?.textContent?.trim(),
				streamingAriaLabel: button?.ariaLabel,
			}, {
				scrollContainerPreserved: true,
				firstRowPreserved: true,
				rowTexts: ['Analyzing code fix and lifecycle nuances', 'Evaluating PR merge status'],
				hasLiteralMarkers: false,
				initialTitle: 'Thinking',
				streamingTitle: 'Thinking: Evaluating issue and PR status',
				streamingAriaLabel: 'Thinking: Evaluating issue and PR status',
			});
		});

		test('splits restored summary headers when fixed scrolling is expanded', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart([
				'**Evaluating issue and PR status**',
				'**Analyzing code fix and lifecycle nuances**',
				'**Evaluating PR merge status**',
			].join('\n\n'));
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(true),
				markdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			const rows = Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'));
			assert.deepStrictEqual({
				hasScrollContainer: !!part.domNode.querySelector('.monaco-scrollable-element'),
				rowTexts: rows.map(row => row.textContent?.trim()),
				title: part.domNode.querySelector('.chat-used-context-label .monaco-button')?.textContent?.trim(),
			}, {
				hasScrollContainer: true,
				rowTexts: ['Analyzing code fix and lifecycle nuances', 'Evaluating PR merge status'],
				title: 'Evaluating issue and PR status',
			});
		});

		test('should collapse without animation when streaming completes', async () => {
			const content = createThinkingPart('**Content with scrolling**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.appendItem(() => {
				const tool = $('div.test-completed-tool');
				tool.textContent = 'Completed tool';
				return { domNode: tool };
			}, 'test-tool');

			const contentList = part.domNode.querySelector<HTMLElement>('.chat-thinking-collapsible');
			assert.ok(contentList);
			Object.defineProperty(contentList, 'scrollHeight', { configurable: true, value: 400 });

			part.finalizeTitleIfDefault();
			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			assert.ok(button);
			const scrollable = part.domNode.querySelector<HTMLElement>('.monaco-scrollable-element');
			const completedHeight = scrollable?.style.maxHeight;
			const completionAnimationEnabled = part.domNode.classList.contains('chat-thinking-fixed-mode-animated');
			button.click();
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));

			const verticalScrollbar = part.domNode.querySelector('.scrollbar.vertical');
			assert.deepStrictEqual({
				completedHeight,
				completionAnimationEnabled,
				userAnimationEnabled: part.domNode.classList.contains('chat-thinking-fixed-mode-animated'),
				expandedHeight: scrollable?.style.maxHeight,
				scrollbarIsInvisible: verticalScrollbar?.classList.contains('invisible'),
				toolIsVisible: !!part.domNode.querySelector('.test-completed-tool'),
			}, {
				completedHeight: '0px',
				completionAnimationEnabled: false,
				userAnimationEnabled: true,
				expandedHeight: '400px',
				scrollbarIsInvisible: true,
				toolIsVisible: true,
			});
		});

		test('should animate the first expansion and subsequent collapse of restored content', async () => {
			const content = createThinkingPart('**Restored content**');
			const context = createMockRenderContext(false);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.appendItem(() => {
				const tool = $('div.test-restored-tool');
				tool.textContent = 'Restored tool';
				return { domNode: tool };
			}, 'restored-tool');

			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			assert.ok(button);
			button.click();

			const contentList = part.domNode.querySelector<HTMLElement>('.chat-thinking-collapsible');
			const scrollable = part.domNode.querySelector<HTMLElement>('.monaco-scrollable-element');
			assert.ok(contentList);
			assert.ok(scrollable);
			Object.defineProperty(contentList, 'scrollHeight', { configurable: true, value: 400 });
			const initialExpandedHeight = scrollable.style.maxHeight;
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
			const expandedHeight = scrollable.style.maxHeight;

			button.click();

			assert.deepStrictEqual({
				initialExpandedHeight,
				expandedHeight,
				collapsedHeight: scrollable.style.maxHeight,
				collapsedInert: scrollable.inert,
			}, {
				initialExpandedHeight: '0px',
				expandedHeight: '400px',
				collapsedHeight: '0px',
				collapsedInert: true,
			});
		});
	});

	suite('Thinking content updates', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('updateThinking should update content', () => {
			const content = createThinkingPart('**Initial**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			const updatedContent = createThinkingPart('**Updated thinking**', content.id);
			part.updateThinking(updatedContent);

			const thinkingItem = part.domNode.querySelector('.chat-thinking-item');
			assert.ok(thinkingItem, 'Should have thinking item');
		});

		test('re-splits a summary into rows as later headers stream in', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const firstSummary = '**Refactoring session policy and cleanup**';
			const content = createThinkingPart(firstSummary);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			part.updateThinking(createThinkingPart(
				`${firstSummary}\n\n**Updating session token handling**`,
				content.id
			));

			const rows = Array.from(part.domNode.querySelectorAll('.chat-thinking-item.markdown-content'));
			assert.deepStrictEqual({
				rowTexts: rows.map(row => row.textContent?.trim()),
				hasLiteralMarkers: part.domNode.textContent?.includes('**') ?? false,
			}, {
				rowTexts: ['Updating session token handling'],
				hasLiteralMarkers: false,
			});
		});

		test('should track multiple title extractions', () => {
			const content = createThinkingPart('**First title**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			part.updateThinking(createThinkingPart('**Second title**', content.id));
			part.updateThinking(createThinkingPart('**Third title**', content.id));

			assert.ok(part.domNode, 'Part should still be valid');
		});

		test('should restore the descriptive title after expand and collapse', () => {
			const content = createThinkingPart('**Read chatListRenderer.ts, lines 2230 to 2270**\nInspect grouping logic');
			const context = createMockRenderContext(false);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			assert.ok(button);

			button.click();
			part.updateThinking(createThinkingPart('**Read**\nInspect grouping logic', content.id));
			button.click();

			assert.strictEqual(button.textContent, 'Thinking: Read chatListRenderer.ts, lines 2230 to 2270');
		});
	});

	suite('Reasoning summary rows', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		function expandedSummaryRows(value: string): HTMLElement[] {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				createThinkingPart(value),
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();
			return Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'));
		}

		test('splitReasoningSummaryRows parses headers, bodies, and prose', () => {
			assert.deepStrictEqual({
				headersOnly: splitReasoningSummaryRows('**H1**\n\n**H2**\n\n**H3**'),
				headerBodies: splitReasoningSummaryRows('**H1**\n\nbody1\n\n**H2**\n\nbody2'),
				twoHeadersNoBody: splitReasoningSummaryRows('**H1**\n\n**H2**'),
				leadingProse: splitReasoningSummaryRows('intro\n\n**H1**\n\n**H2**'),
				keepLeadingHeader: splitReasoningSummaryRows('**H1**\n\n**H2**', false),
				singleHeader: splitReasoningSummaryRows('**Only header**'),
				prose: splitReasoningSummaryRows('Just thinking about the problem.'),
			}, {
				headersOnly: ['**H2**', '**H3**'],
				headerBodies: ['body1', '**H2**\n\nbody2'],
				twoHeadersNoBody: ['**H2**'],
				leadingProse: ['intro', '**H1**', '**H2**'],
				keepLeadingHeader: ['**H1**', '**H2**'],
				singleHeader: undefined,
				prose: undefined,
			});
		});

		test('keeps a later grouped block\'s leading header so no header is lost', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				createThinkingPart('**Reviewing the plan**\n\n**Weighing tradeoffs**'),
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			part.setupThinkingContainer(createThinkingPart('**Editing files**\n\n**Verifying the change**', 'block-2'));

			const rowTexts = Array.from(
				part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'),
				row => row.textContent?.trim()
			);
			assert.deepStrictEqual({
				rowTexts,
				hasLiteralMarkers: part.domNode.textContent?.includes('**') ?? false,
			}, {
				rowTexts: ['Weighing tradeoffs', 'Editing files', 'Verifying the change'],
				hasLiteralMarkers: false,
			});
		});

		test('renders each summary header as its own row and drops the leading header', () => {
			const rows = expandedSummaryRows([
				'**Analyzing bold syntax with spaces**',
				'**Examining special stripping logic**',
				'**Explaining Markdown bold whitespace nuances**',
			].join('\n\n'));

			assert.deepStrictEqual({
				rowTexts: rows.map(row => row.textContent?.trim()),
				hasLiteralMarkers: rows.some(row => row.textContent?.includes('**')),
				anyRowBold: rows.some(row => !!row.querySelector('strong')),
			}, {
				rowTexts: ['Examining special stripping logic', 'Explaining Markdown bold whitespace nuances'],
				hasLiteralMarkers: false,
				anyRowBold: false,
			});
		});

		test('keeps a section body attached to its header row', () => {
			const rows = expandedSummaryRows('**Reviewing the plan**\n\nWeigh the tradeoffs\n\n**Applying the change**\n\nEdit the file');

			assert.deepStrictEqual(rows.map(row => ({
				strong: Array.from(row.querySelectorAll('strong'), element => element.textContent),
				text: row.textContent?.replace(/\s+/g, ' ').trim(),
			})), [
				{ strong: [], text: 'Weigh the tradeoffs' },
				{ strong: ['Applying the change'], text: 'Applying the changeEdit the file' },
			]);
		});

		test('renders a single-header summary as one block', () => {
			const rows = expandedSummaryRows('**Working on it**');

			assert.deepStrictEqual({
				rowCount: rows.length,
				text: rows[0]?.textContent?.trim(),
				hasStrong: !!rows[0]?.querySelector('strong'),
			}, {
				rowCount: 1,
				text: 'Working on it',
				hasStrong: false,
			});
		});

		test('surfaces the dropped leading header as the finalized title', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart('**Reviewing the plan**');
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			part.updateThinking(createThinkingPart('**Reviewing the plan**\n\n**Weighing tradeoffs**\n\n**Applying the change**', content.id));
			part.finalizeTitleIfDefault();

			const titleButton = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.deepStrictEqual({
				title: titleButton?.textContent?.trim(),
				rows: Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'), row => row.textContent?.trim()),
			}, {
				title: 'Reviewing the plan',
				rows: ['Weighing tradeoffs', 'Applying the change'],
			});
		});

		test('keeps the dropped header as the title over a restored content title', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart('**Reviewing the plan**\n\n**Applying the change**');
			content.generatedTitle = 'Reviewed implementation details';
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(true),
				markdownRenderer,
				true
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.finalizeTitleIfDefault();
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			assert.deepStrictEqual({
				title: part.domNode.querySelector('.chat-used-context-label .monaco-button')?.textContent?.trim(),
				rows: Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'), row => row.textContent?.trim()),
				generatedTitle: content.generatedTitle,
			}, {
				title: 'Reviewing the plan',
				rows: ['Applying the change'],
				generatedTitle: 'Reviewing the plan',
			});
		});

		test('keeps the dropped header as the title when a titled tool joins the group', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart('**Analyzing the request**');
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			part.updateThinking(createThinkingPart('**Analyzing the request**\n\n**Planning the edits**', content.id));

			const toolInvocation = {
				kind: 'toolInvocation',
				toolId: 'edit',
				toolCallId: 'call-1',
				invocationMessage: 'Editing file.ts',
				originMessage: undefined,
				pastTenseMessage: undefined,
				presentation: undefined,
				source: ToolDataSource.Internal,
				isAttachedToThinking: false,
				generatedTitle: 'Edited implementation details',
				state: observableValue('state', {
					type: IChatToolInvocation.StateKind.Executing,
					confirmed: { type: 0 },
					progress: observableValue('progress', { progress: 0 }),
					parameters: {},
					confirmationMessages: undefined,
				}),
				toolSpecificDataKind: observableValue('tool', undefined),
				toJSON: () => ({} as IChatToolInvocationSerialized),
			} as unknown as IChatToolInvocation;
			part.appendItem(() => ({ domNode: $('div.test-tool-item') }), toolInvocation.toolId, toolInvocation);

			part.finalizeTitleIfDefault();

			const titleButton = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.deepStrictEqual({
				title: titleButton?.textContent?.trim(),
				summaryRows: Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'), row => row.textContent?.trim()),
			}, {
				title: 'Analyzing the request',
				summaryRows: ['Planning the edits'],
			});
		});

		test('keeps the dropped header as the title over a cached title', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const context = createMockRenderContext(true);
			const thinkingId = 'restored-summary-part';
			const cacheKey = `${chatSessionResourceToId(context.element.sessionResource)}:${thinkingId}`;
			instantiationService.get(IStorageService).store(
				'chat.thinkingTitleCache',
				JSON.stringify({ [cacheKey]: { title: 'Reviewed implementation details', storedAt: Date.now() } }),
				StorageScope.PROFILE,
				StorageTarget.MACHINE
			);
			const content = createThinkingPart('**Analyzing the request**\n\n**Verifying the result**', thinkingId);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				markdownRenderer,
				true
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.finalizeTitleIfDefault();
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			assert.deepStrictEqual({
				title: part.domNode.querySelector('.chat-used-context-label .monaco-button')?.textContent?.trim(),
				rows: Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'), row => row.textContent?.trim()),
				generatedTitle: content.generatedTitle,
			}, {
				title: 'Analyzing the request',
				rows: ['Verifying the result'],
				generatedTitle: 'Analyzing the request',
			});
		});

		test('surfaces the dropped header as the title when collapsed through completion', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart('**Analyzing the request**');
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.updateThinking(createThinkingPart('**Analyzing the request**\n\n**Planning the edits**', content.id));
			const toolInvocation = {
				kind: 'toolInvocation',
				toolId: 'edit',
				toolCallId: 'call-1',
				invocationMessage: 'Editing file.ts',
				originMessage: undefined,
				pastTenseMessage: undefined,
				presentation: undefined,
				source: ToolDataSource.Internal,
				isAttachedToThinking: false,
				generatedTitle: undefined,
				state: observableValue('state', {
					type: IChatToolInvocation.StateKind.Executing,
					confirmed: { type: 0 },
					progress: observableValue('progress', { progress: 0 }),
					parameters: {},
					confirmationMessages: undefined,
				}),
				toolSpecificDataKind: observableValue('tool', undefined),
				toJSON: () => ({} as IChatToolInvocationSerialized),
			} as unknown as IChatToolInvocation;
			part.appendItem(() => ({ domNode: $('div.test-tool-item') }), toolInvocation.toolId, toolInvocation);

			part.finalizeTitleIfDefault();

			const titleButton = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.strictEqual(titleButton?.textContent?.trim(), 'Analyzing the request');
		});

		test('tracks the dropped header off a later grouped block when the first has one header', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart('**Reading the file**', 'block-0');
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.setupThinkingContainer(createThinkingPart('**Analyzing the request**\n\n**Planning the edits**', 'block-1'));
			part.finalizeTitleIfDefault();

			const titleButton = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.strictEqual(titleButton?.textContent?.trim(), 'Analyzing the request');
		});

		test('does not drop a grouped block header that is not the tracked title', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options, target) => renderMarkdown(markdown, options, target),
			};
			const content = createThinkingPart('**Analyzing the request**\n\n**Reviewing constraints**', 'block-0');
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				markdownRenderer,
				false
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.setupThinkingContainer(createThinkingPart('**Editing files**\n\n**Verifying output**', 'block-1'));
			part.finalizeTitleIfDefault();
			part.domNode.querySelector<HTMLElement>('.monaco-button')?.click();

			const titleButton = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			const rows = Array.from(part.domNode.querySelectorAll<HTMLElement>('.chat-thinking-item.markdown-content'), row => row.textContent?.trim());
			assert.deepStrictEqual({
				title: titleButton?.textContent?.trim(),
				keepsLaterHeader: rows.includes('Editing files'),
			}, {
				title: 'Analyzing the request',
				keepsLaterHeader: true,
			});
		});
	});

	suite('Thinking group identity', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('distinguishes reasoning from grouped tool content', () => {
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				createThinkingPart('**Reviewed the implementation**'),
				createMockRenderContext(false),
				mockMarkdownRenderer,
				false
			));

			assert.deepStrictEqual({
				hasReasoning: part.hasReasoningContent(),
				hasGroupedItems: part.hasGroupedItems(),
			}, {
				hasReasoning: true,
				hasGroupedItems: false,
			});

			part.appendItem(() => ({ domNode: $('div.test-tool-item') }), 'test-tool');

			assert.strictEqual(part.hasGroupedItems(), true);
		});

		test('adds elapsed time to finalized reasoning-only headers', () => {
			const content = createThinkingPart('**Reviewed the implementation**');
			content.reasoningDurationMs = 1200;
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.finalizeTitleIfDefault();
			const button = part.domNode.querySelector<HTMLElement>('.monaco-button');
			button?.click();
			button?.click();

			assert.deepStrictEqual({
				generatedTitle: content.generatedTitle,
				labelHasDuration: /^Reviewed the implementation - \d+s$/.test(part.domNode.querySelector('.monaco-button')?.textContent ?? ''),
				ariaLabelHasDuration: /^Reviewed the implementation - \d+s$/.test(button?.ariaLabel ?? ''),
			}, {
				generatedTitle: 'Reviewed the implementation',
				labelHasDuration: true,
				ariaLabelHasDuration: true,
			});
		});

		test('restores the persisted duration when reasoning content is rehydrated', () => {
			const content = createThinkingPart('**Reviewed the implementation**');
			content.reasoningDurationMs = 2300;
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				createMockRenderContext(false),
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));
			part.finalizeTitleIfDefault();

			assert.strictEqual(part.domNode.querySelector('.monaco-button')?.textContent, 'Reviewed the implementation - 3s');
		});

		test('does not show zero or unknown reasoning duration', () => {
			const titles = [undefined, 0].map(reasoningDurationMs => {
				const content = createThinkingPart('**Reviewed the implementation**');
				content.reasoningDurationMs = reasoningDurationMs;
				const part = store.add(instantiationService.createInstance(
					ChatThinkingContentPart,
					content,
					createMockRenderContext(false),
					mockMarkdownRenderer,
					true
				));
				part.finalizeTitleIfDefault();
				return part.domNode.querySelector('.monaco-button')?.textContent;
			});

			assert.deepStrictEqual(titles, ['Reviewed the implementation', 'Reviewed the implementation']);
		});
	});

	suite('Tool invocation appending', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('appendItem should use lazy rendering when collapsed', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			let factoryCalled = false;
			const factory = () => {
				factoryCalled = true;
				return {
					domNode: $('div.test-tool-item'),
					disposable: undefined
				};
			};

			part.appendItem(factory, 'test-tool-id');

			assert.strictEqual(factoryCalled, false, 'Factory should not be called when collapsed (lazy rendering)');
		});

		test('appendItem should render immediately when expanded', () => {
			const content = createThinkingPart('**Working**\nSome detailed analysis of the problem');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			let factoryCalled = false;
			const factory = () => {
				factoryCalled = true;
				const div = $('div.test-tool-item');
				div.textContent = 'Test tool content';
				return { domNode: div };
			};

			part.appendItem(factory, 'test-tool-id');

			assert.strictEqual(factoryCalled, true, 'Factory should be called immediately when expanded');
		});

		test('lazy items should materialize when first expanded', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			let factoryCalled = false;
			const factory = () => {
				factoryCalled = true;
				const div = $('div.test-tool-item');
				div.textContent = 'Lazy content';
				return { domNode: div };
			};

			part.appendItem(factory, 'test-tool-id');
			assert.strictEqual(factoryCalled, false, 'Factory should not be called yet');

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			assert.strictEqual(factoryCalled, true, 'Factory should be called after expanding');
		});

		test('removeLazyItem should remove pending lazy items', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			let factoryCalled = false;
			const factory = () => {
				factoryCalled = true;
				return { domNode: $('div.test-tool-item') };
			};

			part.appendItem(factory, 'test-tool-to-remove');
			const removed = part.removeLazyItem('test-tool-to-remove');

			assert.strictEqual(removed, true, 'Should successfully remove the lazy item');
			assert.strictEqual(factoryCalled, false, 'Factory should never have been called');
		});

		test('lazy items should preserve append order when mixing tool and markdown items', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const appendOrder: string[] = [];

			part.appendItem(() => {
				appendOrder.push('tool1');
				const div = $('div.test-item');
				div.setAttribute('data-order', 'tool1');
				div.textContent = 'Tool 1';
				return { domNode: div };
			}, 'tool-1');

			const markdownItem: IChatMarkdownContent = {
				kind: 'markdownContent',
				content: { value: 'test markdown' }
			};
			part.appendItem(() => {
				appendOrder.push('markdown');
				const div = $('div.test-item');
				div.setAttribute('data-order', 'markdown');
				div.textContent = 'Markdown content';
				return { domNode: div };
			}, undefined, markdownItem);

			part.appendItem(() => {
				appendOrder.push('tool2');
				const div = $('div.test-item');
				div.setAttribute('data-order', 'tool2');
				div.textContent = 'Tool 2';
				return { domNode: div };
			}, 'tool-2');

			assert.strictEqual(appendOrder.length, 0, 'No items should be rendered while collapsed');

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			assert.strictEqual(appendOrder.length, 3, 'All 3 items should be rendered after expanding');

			assert.deepStrictEqual(appendOrder, ['tool1', 'markdown', 'tool2'],
				'Items should render in the same order they were appended (tool1, markdown, tool2)');

			const wrapper = part.domNode.querySelector('.chat-used-context-list');
			const toolWrappers = wrapper?.querySelectorAll('.chat-thinking-tool-wrapper');
			assert.ok(toolWrappers, 'Should have tool wrappers');
			assert.strictEqual(toolWrappers?.length, 3, 'Should have 3 tool wrappers');

			const domOrder = Array.from(toolWrappers!).map(el => {
				const testItem = el.querySelector('.test-item');
				return testItem?.getAttribute('data-order');
			});

			assert.deepStrictEqual(domOrder, ['tool1', 'markdown', 'tool2'],
				'DOM order should match append order (tool1, markdown, tool2)');
		});

		test('setupThinkingContainer should preserve order with lazy tool items', () => {
			const initialContent = createThinkingPart('**Initial thinking**', 'thinking-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				initialContent,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			let tool1Rendered = false;
			part.appendItem(() => {
				tool1Rendered = true;
				const div = $('div.test-item');
				div.setAttribute('data-test-id', 'tool1');
				div.textContent = 'Tool 1';
				return { domNode: div };
			}, 'tool-1');

			const newThinkingContent = createThinkingPart('**Second thinking section**', 'thinking-2');
			part.setupThinkingContainer(newThinkingContent);

			let tool2Rendered = false;
			part.appendItem(() => {
				tool2Rendered = true;
				const div = $('div.test-item');
				div.setAttribute('data-test-id', 'tool2');
				div.textContent = 'Tool 2';
				return { domNode: div };
			}, 'tool-2');

			assert.strictEqual(tool1Rendered, false, 'Tool 1 should not render while collapsed');
			assert.strictEqual(tool2Rendered, false, 'Tool 2 should not render while collapsed');

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			assert.strictEqual(tool1Rendered, true, 'Tool 1 should render after expand');
			assert.strictEqual(tool2Rendered, true, 'Tool 2 should render after expand');

			const wrapper = part.domNode.querySelector('.chat-used-context-list');
			assert.ok(wrapper, 'Should have wrapper');

			const children = Array.from(wrapper!.children);

			const tool1Index = children.findIndex(el =>
				el.classList.contains('chat-thinking-tool-wrapper') &&
				el.querySelector('[data-test-id="tool1"]')
			);
			const tool2Index = children.findIndex(el =>
				el.classList.contains('chat-thinking-tool-wrapper') &&
				el.querySelector('[data-test-id="tool2"]')
			);

			const thinkingItems = children.filter(el => el.classList.contains('chat-thinking-item'));

			assert.ok(thinkingItems.length >= 1, 'Should have at least one thinking item');
			assert.ok(tool1Index >= 0, 'Should find tool1');
			assert.ok(tool2Index >= 0, 'Should find tool2');

			assert.ok(tool1Index < tool2Index,
				`Tool1 (index ${tool1Index}) should come before Tool2 (index ${tool2Index}) in DOM order`);
		});

		test('markdown via updateThinking should preserve order with lazy tool items (BUG: markdown renders before tools)', () => {
			const initialContent = createThinkingPart('', 'thinking-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				initialContent,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.appendItem(() => {
				const div = $('div.test-item');
				div.setAttribute('data-test-id', 'tool1');
				div.setAttribute('data-order', '1');
				div.textContent = 'Tool 1';
				return { domNode: div };
			}, 'tool-1');

			const thinkingContent = createThinkingPart('**Analyzing the codebase**', 'thinking-2');
			part.setupThinkingContainer(thinkingContent);

			part.appendItem(() => {
				const div = $('div.test-item');
				div.setAttribute('data-test-id', 'tool2');
				div.setAttribute('data-order', '3');
				div.textContent = 'Tool 2';
				return { domNode: div };
			}, 'tool-2');

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			const wrapper = part.domNode.querySelector('.chat-used-context-list');
			assert.ok(wrapper, 'Should have wrapper after expanding');

			const children = Array.from(wrapper!.children);

			const tool1Index = children.findIndex(el =>
				el.querySelector('[data-test-id="tool1"]')
			);
			const tool2Index = children.findIndex(el =>
				el.querySelector('[data-test-id="tool2"]')
			);
			const markdownIndex = children.findIndex(el =>
				el.classList.contains('chat-thinking-item') && el.classList.contains('markdown-content')
			);

			assert.ok(tool1Index >= 0, `Should find tool1 in DOM (found at index ${tool1Index})`);
			assert.ok(tool2Index >= 0, `Should find tool2 in DOM (found at index ${tool2Index})`);
			assert.ok(markdownIndex >= 0, `Should find markdown in DOM (found at index ${markdownIndex})`);

			assert.ok(tool1Index < markdownIndex,
				`BUG: Tool1 (index ${tool1Index}) should come BEFORE markdown (index ${markdownIndex}) ` +
				`because tool1 was appended first. Current DOM order indicates markdown is eagerly ` +
				`placed first regardless of arrival order.`);
			assert.ok(markdownIndex < tool2Index,
				`Markdown (index ${markdownIndex}) should come before Tool2 (index ${tool2Index})`);
		});

		test('lazy thinking items should show updated content after streaming updates', () => {
			const initialContent = createThinkingPart('', 'thinking-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				initialContent,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const thinkingContent1 = createThinkingPart('**Starting analysis**', 'thinking-2');
			part.setupThinkingContainer(thinkingContent1);

			const thinkingContent2 = createThinkingPart('**Starting analysis** Looking at the code structure...', 'thinking-2');
			part.updateThinking(thinkingContent2);

			const thinkingContent3 = createThinkingPart('**Starting analysis** Looking at the code structure... Found the issue in the parser module.', 'thinking-2');
			part.updateThinking(thinkingContent3);

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			const wrapper = part.domNode.querySelector('.chat-used-context-list');
			assert.ok(wrapper, 'Should have wrapper after expanding');

			const thinkingItems = wrapper!.querySelectorAll('.chat-thinking-item.markdown-content');

			assert.strictEqual(thinkingItems.length, 1,
				`BUG: Should have exactly 1 thinking item, but got ${thinkingItems.length}. ` +
				`materializeLazyItem creates a duplicate container from the lazy item. ` +
				`Items: ${Array.from(thinkingItems).map(i => `"${i.textContent}"`).join(', ')}`);

			if (thinkingItems.length === 1) {
				const renderedText = thinkingItems[0].textContent || '';
				assert.ok(
					renderedText.includes('Found the issue in the parser module'),
					`Content should show latest streaming update. Got: "${renderedText}"`
				);
			}
		});

		test('lazy thinking items should work without streaming updates after setupThinkingContainer', () => {
			const initialContent = createThinkingPart('', 'thinking-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				initialContent,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const thinkingContent = createThinkingPart('**Analyzing files**', 'thinking-2');
			part.setupThinkingContainer(thinkingContent);

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			const wrapper = part.domNode.querySelector('.chat-used-context-list');
			assert.ok(wrapper, 'Should have wrapper after expanding');

			const thinkingItems = wrapper!.querySelectorAll('.chat-thinking-item.markdown-content');
			assert.strictEqual(thinkingItems.length, 1, 'Should have exactly 1 thinking item');

			const renderedText = thinkingItems[0].textContent || '';
			assert.ok(
				renderedText.includes('Analyzing files'),
				`Content should show setupThinkingContainer content. Got: "${renderedText}"`
			);
		});
	});

	suite('State management', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('markAsInactive should update isActive state', () => {
			const content = createThinkingPart('**Active thinking**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			assert.strictEqual(part.getIsActive(), true, 'Should start as active');

			part.markAsInactive();

			assert.strictEqual(part.getIsActive(), false, 'Should be inactive after markAsInactive');
		});

		test('dispose should set isActive to false', () => {
			const content = createThinkingPart('**Active thinking**');
			const context = createMockRenderContext(false);

			const part = instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			);

			assert.strictEqual(part.getIsActive(), true, 'Should start as active');

			part.dispose();

			assert.strictEqual(part.getIsActive(), false, 'Should be inactive after dispose');
		});

		test('collapseContent should collapse the part', () => {
			const content = createThinkingPart('**Content**\nSome detailed reasoning that differs from the title');
			const context = createMockRenderContext(false);

			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.CollapsedPreview);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			assert.strictEqual(part.domNode.classList.contains('chat-used-context-collapsed'), false);

			part.collapseContent();

			assert.strictEqual(part.domNode.classList.contains('chat-used-context-collapsed'), true,
				'Should be collapsed after collapseContent');
		});

		test('finalizeTitleIfDefault should update button icon to check', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.finalizeTitleIfDefault();

			const iconElement = part.domNode.querySelector('.codicon-check-compact');
			assert.ok(iconElement, 'Should have check icon after finalization');
			assert.ok(part.domNode.classList.contains('chat-collapsible-content-animated'), 'Should enable content animation after finalization');
		});

		test('finalizeTitleIfDefault should retain initial thinking title', () => {
			const content = createThinkingPart('**Reviewed renderer state**\nChecked completed response rendering');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.finalizeTitleIfDefault();

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.deepStrictEqual({
				generatedTitle: content.generatedTitle,
				label: button.textContent,
				ariaLabel: button.ariaLabel,
			}, {
				generatedTitle: 'Reviewed renderer state',
				label: 'Reviewed renderer state',
				ariaLabel: 'Reviewed renderer state',
			});
		});

		test('finalizeTitleIfDefault should retain restored terminal title', () => {
			const content = createThinkingPart('');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const terminalTool: IChatToolInvocationSerialized = {
				kind: 'toolInvocationSerialized',
				toolId: 'run_in_terminal',
				toolCallId: 'terminal-call-1',
				invocationMessage: 'Running npm test',
				originMessage: undefined,
				pastTenseMessage: undefined,
				presentation: undefined,
				isConfirmed: { type: 0 },
				isComplete: true,
				source: ToolDataSource.Internal,
				generatedTitle: 'Ran npm test',
				isAttachedToThinking: false,
				toolSpecificData: {
					kind: 'terminal',
					commandLine: { original: 'npm test' },
					language: 'shellscript',
				}
			};

			part.appendItem(() => ({ domNode: $('div.test-terminal-tool') }), terminalTool.toolId, terminalTool);
			part.finalizeTitleIfDefault();

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.deepStrictEqual({
				contentGeneratedTitle: content.generatedTitle,
				toolGeneratedTitle: terminalTool.generatedTitle,
				label: button.textContent,
				ariaLabel: button.ariaLabel,
			}, {
				contentGeneratedTitle: 'Ran npm test',
				toolGeneratedTitle: 'Ran npm test',
				label: 'Ran npm test',
				ariaLabel: 'Ran npm test',
			});
		});

		test('finalizeTitleIfDefault should restore cached title for a reasoning-only block keyed by thinking part id', () => {
			const context = createMockRenderContext(true);
			const thinkingId = 'reasoning-part-1';

			const storageService = instantiationService.get(IStorageService);
			const cacheKey = `${chatSessionResourceToId(context.element.sessionResource)}:${thinkingId}`;
			storageService.store(
				'chat.thinkingTitleCache',
				JSON.stringify({ [cacheKey]: { title: 'Analyzed authentication flow', storedAt: Date.now() } }),
				StorageScope.PROFILE,
				StorageTarget.MACHINE
			);

			const content = createThinkingPart('', thinkingId);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.finalizeTitleIfDefault();

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.deepStrictEqual({
				generatedTitle: content.generatedTitle,
				label: button.textContent,
				ariaLabel: button.ariaLabel,
			}, {
				generatedTitle: 'Analyzed authentication flow',
				label: 'Analyzed authentication flow',
				ariaLabel: 'Analyzed authentication flow',
			});
		});
	});

	suite('hasSameContent', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('should return true for tool invocations', () => {
			const content = createThinkingPart('**Working**', 'id-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const toolInvocation = {
				kind: 'toolInvocation' as const,
				toolId: 'test-tool',
				invocationMessage: 'Testing',
				resultDetails: [],
				isConfirmed: undefined,
				pastTenseMessage: undefined,
				isComplete: true,
				isCanceled: false
			} as unknown as IChatRendererContent;

			const result = part.hasSameContent(toolInvocation, [], context.element);
			assert.strictEqual(result, true, 'Should accept tool invocations as same content');
		});

		test('should return false when a tool becomes a parent subagent', () => {
			const content = createThinkingPart('**Working**', 'id-1');
			const context = createMockRenderContext(false);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));
			const toolInvocation = {
				kind: 'toolInvocation' as const,
				toolSpecificData: { kind: 'subagent' },
				subAgentInvocationId: undefined,
			} as unknown as IChatRendererContent;

			assert.strictEqual(part.hasSameContent(toolInvocation, [], context.element), false);
		});

		test('should return true for markdown content', () => {
			const content = createThinkingPart('**Working**', 'id-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const markdownContent = {
				kind: 'markdownContent' as const,
				content: { value: 'test' }
			} as unknown as IChatRendererContent;

			const result = part.hasSameContent(markdownContent, [], context.element);
			assert.strictEqual(result, true, 'Should accept markdown content as same content');
		});

		test('should return false for different thinking part with same id', () => {
			const content = createThinkingPart('**Working**', 'id-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const otherThinking: IChatRendererContent = createThinkingPart('**Different**', 'id-1');

			const result = part.hasSameContent(otherThinking, [], context.element);
			assert.strictEqual(result, false, 'Should return false for thinking part with same id');
		});

		test('should return true for thinking part with different id', () => {
			const content = createThinkingPart('**Working**', 'id-1');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const otherThinking: IChatRendererContent = createThinkingPart('**Different**', 'id-2');

			const result = part.hasSameContent(otherThinking, [], context.element);
			assert.strictEqual(result, true, 'Should return true for thinking part with different id');
		});
	});

	suite('DOM structure', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('should have proper aria-expanded attribute', () => {
			const content = createThinkingPart('**Content**\nSome detailed reasoning that differs from the title');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.ok(button, 'Button should exist');
			assert.strictEqual(button.getAttribute('aria-expanded'), 'false', 'Should have aria-expanded="false" when collapsed');

			button.click();

			assert.strictEqual(button.getAttribute('aria-expanded'), 'true', 'Should have aria-expanded="true" when expanded');
		});

		test('should show loading spinner while streaming', () => {
			const content = createThinkingPart('**Streaming content**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const circleIcon = part.domNode.querySelector('.codicon-circle-filled-compact');
			assert.ok(circleIcon, 'Should have circle-filled icon while streaming');
		});

		function createMockStreamingToolInvocation(toolId: string, invocationMessage: string, toolCallId: string): IChatToolInvocation {
			return {
				kind: 'toolInvocation',
				toolId,
				toolCallId,
				invocationMessage,
				originMessage: undefined,
				pastTenseMessage: undefined,
				presentation: undefined,
				source: ToolDataSource.Internal,
				isAttachedToThinking: false,
				generatedTitle: undefined,
				state: observableValue('state', {
					type: IChatToolInvocation.StateKind.Streaming,
					partialInput: observableValue('partialInput', undefined),
					streamingMessage: observableValue('streamingMessage', undefined),
				}),
				toolSpecificDataKind: observableValue('test', undefined),
				toJSON: () => ({} as IChatToolInvocationSerialized),
			} as IChatToolInvocation;
		}

		function createMockExecutingToolInvocation(
			toolId: string,
			invocationMessage: string | IMarkdownString,
			toolCallId: string,
			progress = observableValue<{ message?: string | IMarkdownString; progress: number | undefined }>('progress', { progress: 0 }),
		): IChatToolInvocation {
			return {
				kind: 'toolInvocation',
				toolId,
				toolCallId,
				invocationMessage,
				originMessage: undefined,
				pastTenseMessage: undefined,
				presentation: undefined,
				source: ToolDataSource.Internal,
				isAttachedToThinking: false,
				generatedTitle: undefined,
				state: observableValue('state', {
					type: IChatToolInvocation.StateKind.Executing,
					confirmed: { type: 0 },
					progress,
					parameters: {},
					confirmationMessages: undefined,
				}),
				toolSpecificDataKind: observableValue('test', undefined),
				toJSON: () => ({} as IChatToolInvocationSerialized),
			} as IChatToolInvocation;
		}

		function createMockSerializedImageToolInvocation(toolId: string, invocationMessage: string, toolCallId: string): IChatToolInvocationSerialized {
			return {
				kind: 'toolInvocationSerialized',
				toolId,
				toolCallId,
				invocationMessage,
				originMessage: undefined,
				pastTenseMessage: undefined,
				presentation: undefined,
				resultDetails: {
					output: {
						type: 'data',
						mimeType: 'image/png',
						base64Data: 'AQID'
					}
				},
				isConfirmed: { type: 0 },
				isComplete: true,
				source: ToolDataSource.Internal,
				generatedTitle: undefined,
				isAttachedToThinking: false,
			};
		}

		test('finalizeTitleIfDefault should promote a single tool out of thinking even when it is not complete', () => {
			const content = createThinkingPart('');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			(part.domNode.querySelector('.monaco-button') as HTMLElement)?.click();

			const originalParent = $('div.original-parent');
			mainWindow.document.body.appendChild(originalParent);
			disposables.add(toDisposable(() => originalParent.remove()));

			const executingTool = createMockExecutingToolInvocation('copilot_readFile', 'Reading file', 'call-1');
			assert.strictEqual(IChatToolInvocation.isComplete(executingTool), false, 'precondition: tool is not complete');

			const toolDom = $('div.chat-tool-invocation-part');
			const toolHeader = $('div.tool-header');
			toolHeader.textContent = 'Reading file';
			const toolBody = $('div.tool-body');
			toolBody.textContent = 'AGENTS.md';
			toolDom.append(toolHeader, toolBody);
			part.appendItem(() => ({ domNode: toolDom }), executingTool.toolId, executingTool, originalParent);

			const usedContextList = part.domNode.querySelector('.chat-used-context-list');
			const thinkingWrapper = toolDom.parentElement;
			const thinkingItemCountBeforeFinalize = usedContextList?.childElementCount;
			part.finalizeTitleIfDefault();

			assert.deepStrictEqual({
				thinkingItemCountBeforeFinalize,
				thinkingItemCountAfterFinalize: usedContextList?.childElementCount,
				toolChildCount: toolDom.childElementCount,
				toolParent: toolDom.parentElement === originalParent,
				thinkingWrapperRemoved: !thinkingWrapper?.parentElement,
				isAttachedToThinking: executingTool.isAttachedToThinking,
			}, {
				thinkingItemCountBeforeFinalize: 2,
				thinkingItemCountAfterFinalize: 0,
				toolChildCount: 2,
				toolParent: true,
				thinkingWrapperRemoved: true,
				isAttachedToThinking: false,
			});
		});

		test('finalizeTitleIfDefault should promote a lazy single tool without its thinking icon', () => {
			const content = createThinkingPart('');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const originalParent = $('div.original-parent');
			mainWindow.document.body.appendChild(originalParent);
			disposables.add(toDisposable(() => originalParent.remove()));

			const executingTool = createMockExecutingToolInvocation('copilot_readFile', 'Reading file', 'call-1');
			const toolDom = $('div.chat-tool-invocation-part');
			toolDom.textContent = 'Reading file';
			part.appendItem(() => ({ domNode: toolDom }), executingTool.toolId, executingTool, originalParent);

			part.finalizeTitleIfDefault();

			assert.deepStrictEqual({
				toolParent: toolDom.parentElement === originalParent,
				topLevelChildCount: originalParent.childElementCount,
				topLevelChild: originalParent.firstElementChild === toolDom,
				isAttachedToThinking: executingTool.isAttachedToThinking,
			}, {
				toolParent: true,
				topLevelChildCount: 1,
				topLevelChild: true,
				isAttachedToThinking: false,
			});
		});

		test('finalizeTitleIfDefault should keep a related item inside the preceding tool invocation part', () => {
			const content = createThinkingPart('');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const originalParent = $('div.original-parent');
			const toolInvocationPart = $('div.chat-tool-invocation-part');
			originalParent.append(toolInvocationPart, part.domNode);
			mainWindow.document.body.appendChild(originalParent);
			disposables.add(toDisposable(() => originalParent.remove()));

			(part.domNode.querySelector('.monaco-button') as HTMLElement)?.click();

			const editPill = $('div.chat-codeblock-pill-container');
			editPill.textContent = 'Edited AGENTS.md';
			const markdown: IChatMarkdownContent = { kind: 'markdownContent', content: { value: '' } };
			part.appendItem(() => ({ domNode: editPill }), 'edit-pill', markdown, originalParent);

			const thinkingWrapper = editPill.parentElement;
			part.finalizeTitleIfDefault();

			assert.deepStrictEqual({
				editPillParent: editPill.parentElement === toolInvocationPart,
				thinkingWrapperRemoved: !thinkingWrapper?.parentElement,
			}, {
				editPillParent: true,
				thinkingWrapperRemoved: true,
			});
		});

		test('finalizeTitleIfDefault should promote an external edit beside a hidden tool invocation', () => {
			const content = createThinkingPart('');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const originalParent = $('div.original-parent');
			const hiddenToolInvocationPart = $('div.chat-tool-invocation-part');
			hiddenToolInvocationPart.style.display = 'none';
			originalParent.append(hiddenToolInvocationPart, part.domNode);
			mainWindow.document.body.appendChild(originalParent);
			disposables.add(toDisposable(() => originalParent.remove()));

			(part.domNode.querySelector('.monaco-button') as HTMLElement)?.click();

			const editPill = $('div.chat-codeblock-pill-container');
			editPill.textContent = 'Edited package.json';
			const externalEdit: IChatExternalEdit = {
				kind: 'externalEdit',
				uri: URI.file('/workspace/package.json'),
				editKind: 'edit',
			};
			part.appendItem(() => ({ domNode: editPill }), 'external-edit', externalEdit, originalParent);

			const thinkingWrapper = editPill.parentElement;
			part.finalizeTitleIfDefault();

			assert.deepStrictEqual({
				editPillParent: editPill.parentElement === originalParent,
				hiddenToolChildCount: hiddenToolInvocationPart.childElementCount,
				thinkingWrapperRemoved: !thinkingWrapper?.parentElement,
			}, {
				editPillParent: true,
				hiddenToolChildCount: 0,
				thinkingWrapperRemoved: true,
			});
		});

		test('finalizeTitleIfDefault should use the original parent when finding a preceding tool invocation part', () => {
			const content = createThinkingPart('');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			const originalParent = $('div.original-parent');
			const originalToolInvocationPart = $('div.chat-tool-invocation-part');
			originalParent.append(originalToolInvocationPart, part.domNode);
			mainWindow.document.body.appendChild(originalParent);
			disposables.add(toDisposable(() => originalParent.remove()));

			(part.domNode.querySelector('.monaco-button') as HTMLElement)?.click();

			const editPill = $('div.chat-codeblock-pill-container');
			editPill.textContent = 'Edited AGENTS.md';
			const markdown: IChatMarkdownContent = { kind: 'markdownContent', content: { value: '' } };
			part.appendItem(() => ({ domNode: editPill }), 'edit-pill', markdown, originalParent);

			const unrelatedParent = $('div.unrelated-parent');
			const unrelatedToolInvocationPart = $('div.chat-tool-invocation-part');
			unrelatedParent.append(unrelatedToolInvocationPart, part.domNode);
			mainWindow.document.body.appendChild(unrelatedParent);
			disposables.add(toDisposable(() => unrelatedParent.remove()));

			part.finalizeTitleIfDefault();

			assert.deepStrictEqual({
				editPillParentIsOriginalTool: editPill.parentElement === originalToolInvocationPart,
				unrelatedToolChildCount: unrelatedToolInvocationPart.childElementCount,
			}, {
				editPillParentIsOriginalTool: true,
				unrelatedToolChildCount: 0,
			});
		});

		test('should show "Editing files" for streaming edit tools instead of generic display name', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const streamingReplaceTool = createMockStreamingToolInvocation(
				'copilot_replaceString', 'Replace String in File', 'call-1'
			);

			part.appendItem(() => {
				const div = $('div.test-item');
				div.textContent = 'Replace tool';
				return { domNode: div };
			}, streamingReplaceTool.toolId, streamingReplaceTool);

			const button = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.ok(button, 'Should have collapse button');
			const labelText = button.querySelector('.icon-label')?.textContent ?? button.textContent ?? '';
			assert.ok(labelText.includes('Editing files'), `Title should contain "Editing files" but got "${labelText}"`);
		});

		test('should show original message for non-edit streaming tools', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const streamingReadTool = createMockStreamingToolInvocation(
				'copilot_readFile', 'Reading file.ts', 'call-2'
			);

			part.appendItem(() => {
				const div = $('div.test-item');
				div.textContent = 'Read tool';
				return { domNode: div };
			}, streamingReadTool.toolId, streamingReadTool);

			const button = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.ok(button, 'Should have collapse button');
			const labelText = button.querySelector('.icon-label')?.textContent ?? button.textContent ?? '';
			assert.ok(labelText.includes('Reading file.ts'), `Title should contain "Reading file.ts" but got "${labelText}"`);
		});

		test('should show original message for non-streaming edit tools', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const executingReplaceTool = createMockExecutingToolInvocation(
				'copilot_replaceString', 'Replacing 5 lines in file.ts', 'call-3'
			);

			part.appendItem(() => {
				const div = $('div.test-item');
				div.textContent = 'Replace tool';
				return { domNode: div };
			}, executingReplaceTool.toolId, executingReplaceTool);

			const button = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.ok(button, 'Should have collapse button');
			const labelText = button.querySelector('.icon-label')?.textContent ?? button.textContent ?? '';
			assert.ok(labelText.includes('Replacing 5 lines in file.ts'), `Title should contain "Replacing 5 lines in file.ts" but got "${labelText}"`);
		});

		test('should preserve markdown file pills in the thinking header', () => {
			const markdownRenderer: IMarkdownRenderer = {
				render: (markdown, options) => renderMarkdown(markdown, options),
			};
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				createThinkingPart('**Working**'),
				createMockRenderContext(false),
				markdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const title = 'Edit [](claudeAgent.ts)';
			const progress = observableValue<{ message?: string | IMarkdownString; progress: number | undefined }>('progress', { progress: 0 });
			const editTool = createMockExecutingToolInvocation('edit', title, 'call-markdown', progress);
			part.appendItem(() => ({ domNode: $('div.test-item') }), editTool.toolId, editTool);

			const button = part.domNode.querySelector<HTMLElement>('.chat-used-context-label .monaco-button');
			const header = part.domNode.querySelector<HTMLElement>('.chat-used-context-label');
			const initialPill = header?.querySelector<HTMLElement>('.chat-inline-anchor-widget .icon-label');
			const invocationMessage = new MarkdownString(title);
			invocationMessage.baseUri = URI.file('/workspace/');
			progress.set({ message: invocationMessage, progress: undefined }, undefined);

			const updatedPill = header?.querySelector<HTMLElement>('.chat-inline-anchor-widget .icon-label');
			button?.click();
			button?.click();
			const restoredPill = header?.querySelector<HTMLElement>('.chat-inline-anchor-widget .icon-label');

			assert.deepStrictEqual({
				initialPill: initialPill?.textContent,
				updatedPill: updatedPill?.textContent,
				pillInsideCollapseButton: !!updatedPill?.closest('.monaco-button'),
				restoredPill: restoredPill?.textContent,
				ariaLabel: button?.ariaLabel,
			}, {
				initialPill: undefined,
				updatedPill: 'claudeAgent.ts',
				pillInsideCollapseButton: false,
				restoredPill: 'claudeAgent.ts',
				ariaLabel: 'Working: Edit claudeAgent.ts',
			});
		});

		test('should keep original message for create_file tool even when streaming', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const streamingCreateTool = createMockStreamingToolInvocation(
				'copilot_createFile', 'Creating newFile.ts', 'call-4'
			);

			part.appendItem(() => {
				const div = $('div.test-item');
				div.textContent = 'Create tool';
				return { domNode: div };
			}, streamingCreateTool.toolId, streamingCreateTool);

			const button = part.domNode.querySelector('.chat-used-context-label .monaco-button');
			assert.ok(button, 'Should have collapse button');
			const labelText = button.querySelector('.icon-label')?.textContent ?? button.textContent ?? '';
			assert.ok(labelText.includes('Creating newFile.ts'), `Title should contain "Creating newFile.ts" but got "${labelText}"`);
		});

		test('should show external resources for serialized image tools when initially collapsed and hide them when expanded', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const serializedImageTool = createMockSerializedImageToolInvocation(
				'chat_screenshot', 'Captured screenshot', 'image-call-1'
			);

			part.appendItem(() => {
				const div = $('div.test-item');
				div.textContent = 'Image tool';
				return { domNode: div };
			}, serializedImageTool.toolId, serializedImageTool);

			const externalResources = part.domNode.querySelector('.chat-thinking-external-resources') as HTMLElement;
			assert.ok(externalResources, 'Should render external resources container');
			assert.notStrictEqual(externalResources.style.display, 'none', 'Should show external resources while initially collapsed');

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.ok(button, 'Should have expand button');
			button.click();

			assert.strictEqual(externalResources.style.display, 'none', 'Should hide external resources when expanded');

			button.click();
			assert.notStrictEqual(externalResources.style.display, 'none', 'Should show external resources again after collapsing');
		});

		test('should not show external resources for terminal tools that render their own image pills', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);
			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const serializedTerminalImageTool: IChatToolInvocationSerialized = {
				...createMockSerializedImageToolInvocation('run_in_terminal', 'Ran command', 'terminal-image-call-1'),
				toolSpecificData: {
					kind: 'terminal',
					commandLine: { original: 'download image' },
					language: 'shellscript',
				},
			};

			part.appendItem(() => ({ domNode: $('div.test-terminal-tool') }), serializedTerminalImageTool.toolId, serializedTerminalImageTool);

			const externalResources = part.domNode.querySelector('.chat-thinking-external-resources') as HTMLElement;
			assert.deepStrictEqual({
				display: externalResources.style.display,
				attachmentCount: externalResources.querySelectorAll('.chat-attached-context-attachment').length,
			}, {
				display: 'none',
				attachmentCount: 0,
			});
		});
	});

	suite('Diff aggregation in thinking header', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('should show diff stats in finalized title when onDidChangeDiff fires', () => {
			const content = createThinkingPart('**Editing files**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const diffEmitter = store.add(new Emitter<IChatContentPartDiffData>());

			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill') }),
				'edit-part-1',
				undefined,
				undefined,
				diffEmitter.event
			);

			part.finalizeTitleIfDefault();

			diffEmitter.fire(createDiffData(10, 3));

			const addedEl = part.domNode.querySelector('.label-added');
			const removedEl = part.domNode.querySelector('.label-removed');
			const label = part.domNode.querySelector('.chat-used-context-label');
			const titleButton = label?.querySelector<HTMLElement>('.monaco-icon-button');
			const chevron = label?.querySelector<HTMLElement>('.chat-collapsible-hover-chevron');
			const initialExpanded = titleButton?.ariaExpanded;
			chevron?.click();
			assert.deepStrictEqual({
				added: addedEl?.textContent,
				removed: removedEl?.textContent,
				childClasses: [...label!.children].map(child => child.className),
				initialExpanded,
				expandedAfterChevronClick: titleButton?.ariaExpanded,
			}, {
				added: '+10',
				removed: '-3',
				childClasses: [
					'monaco-button monaco-icon-button monaco-text-button chat-thinking-title-with-diff',
					'monaco-button chat-thinking-title-diff',
					'chat-collapsible-hover-chevron codicon codicon-chevron-right-compact expanded',
				],
				initialExpanded: 'false',
				expandedAfterChevronClick: 'true',
			});
		});

		test('should aggregate diffs from multiple edit parts', () => {
			const content = createThinkingPart('**Editing files**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const diffEmitter1 = store.add(new Emitter<IChatContentPartDiffData>());
			const diffEmitter2 = store.add(new Emitter<IChatContentPartDiffData>());

			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill-1') }),
				'edit-part-1',
				undefined,
				undefined,
				diffEmitter1.event
			);

			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill-2') }),
				'edit-part-2',
				undefined,
				undefined,
				diffEmitter2.event
			);

			part.finalizeTitleIfDefault();

			diffEmitter1.fire(createDiffData(5, 2, 'first.ts'));
			diffEmitter2.fire(createDiffData(8, 1, 'second.ts'));

			const addedEl = part.domNode.querySelector('.label-added');
			const removedEl = part.domNode.querySelector('.label-removed');
			assert.strictEqual(addedEl?.textContent, '+13');
			assert.strictEqual(removedEl?.textContent, '-3');
		});

		test('should not show diff stats when diff parts exist but have no changes', () => {
			const content = createThinkingPart('**Editing files**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const diffEmitter = store.add(new Emitter<IChatContentPartDiffData>());

			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill') }),
				'edit-part-1',
				undefined,
				undefined,
				diffEmitter.event
			);

			part.finalizeTitleIfDefault();
			diffEmitter.fire(createDiffData(0, 0));

			const addedEl = part.domNode.querySelector('.label-added');
			const removedEl = part.domNode.querySelector('.label-removed');
			assert.strictEqual(addedEl, null);
			assert.strictEqual(removedEl, null);
		});

		test('should include diff stats in aria-label', () => {
			const content = createThinkingPart('**Editing files**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const diffEmitter = store.add(new Emitter<IChatContentPartDiffData>());

			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill') }),
				'edit-part-1',
				undefined,
				undefined,
				diffEmitter.event
			);

			part.finalizeTitleIfDefault();
			diffEmitter.fire(createDiffData(7, 2));

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			assert.ok(button?.ariaLabel?.includes('7'), 'aria-label should include added count');
			assert.ok(button?.ariaLabel?.includes('2'), 'aria-label should include removed count');
		});

		test('should not show diff stats when no diff events fired', () => {
			const content = createThinkingPart('**Analyzing code**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			part.finalizeTitleIfDefault();

			const diffContainer = part.domNode.querySelector('.chat-thinking-title-diff');
			assert.strictEqual(diffContainer, null, 'Should not render diff container when no diffs exist');
		});

		test('opens each file from its first original to its last modified snapshot', () => {
			let opened: unknown;
			instantiationService.stub(IEditorService, new class extends mock<IEditorService>() {
				override async openEditor(...args: unknown[]): Promise<undefined> {
					opened = args[0];
					return undefined;
				}
			}());

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				createThinkingPart('**Editing files**'),
				createMockRenderContext(true),
				mockMarkdownRenderer,
				true
			));
			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const firstAppEdit = store.add(new Emitter<IChatContentPartDiffData>());
			const utilEdit = store.add(new Emitter<IChatContentPartDiffData>());
			const lastAppEdit = store.add(new Emitter<IChatContentPartDiffData>());
			part.appendItem(() => ({ domNode: $('div') }), 'app-edit-1', undefined, undefined, firstAppEdit.event);
			part.appendItem(() => ({ domNode: $('div') }), 'util-edit', undefined, undefined, utilEdit.event);
			part.appendItem(() => ({ domNode: $('div') }), 'app-edit-2', undefined, undefined, lastAppEdit.event);
			part.finalizeTitleIfDefault();

			lastAppEdit.fire(createDiffData(4, 1, 'app.ts', 'last'));
			utilEdit.fire(createDiffData(2, 3, 'util.ts', 'only'));
			firstAppEdit.fire(createDiffData(5, 0, 'app.ts', 'first'));

			part.domNode.querySelector<HTMLElement>('.chat-thinking-title-diff')?.click();

			assert.ok(isResourceMultiDiffEditorInput(opened));
			assert.deepStrictEqual({
				label: opened.label,
				resources: opened.resources?.map(resource => ({
					original: resource.original.resource?.toString(),
					modified: resource.modified.resource?.toString(),
					goToFileResource: resource.goToFileResource?.toString(),
				})),
			}, {
				label: 'Section File Changes',
				resources: [{
					original: 'file:///snapshots/first/before/app.ts',
					modified: 'file:///snapshots/last/after/app.ts',
					goToFileResource: 'file:///workspace/app.ts',
				}, {
					original: 'file:///snapshots/only/before/util.ts',
					modified: 'file:///snapshots/only/after/util.ts',
					goToFileResource: 'file:///workspace/util.ts',
				}],
			});
		});

		test('removeEditPillByPartId cleans up lazy item and diff stats', () => {
			const content = createThinkingPart('**Editing files**');
			const context = createMockRenderContext(true);

			const part = store.add(instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				true
			));

			mainWindow.document.body.appendChild(part.domNode);
			disposables.add(toDisposable(() => part.domNode.remove()));

			const diffEmitter1 = store.add(new Emitter<IChatContentPartDiffData>());
			const diffEmitter2 = store.add(new Emitter<IChatContentPartDiffData>());

			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill-1') }),
				'edit-part-1',
				undefined,
				undefined,
				diffEmitter1.event
			);
			part.appendItem(
				() => ({ domNode: $('div.test-edit-pill-2') }),
				'edit-part-2',
				undefined,
				undefined,
				diffEmitter2.event
			);

			part.finalizeTitleIfDefault();

			diffEmitter1.fire(createDiffData(5, 2, 'first.ts'));
			diffEmitter2.fire(createDiffData(8, 1, 'second.ts'));

			part.removeEditPillByPartId('edit-part-1');

			const addedEl = part.domNode.querySelector('.label-added');
			const removedEl = part.domNode.querySelector('.label-removed');
			assert.strictEqual(addedEl?.textContent, '+8');
			assert.strictEqual(removedEl?.textContent, '-1');
		});
	});

	suite('eagerDisposable lifecycle', () => {
		setup(() => {
			mockConfigurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);
		});

		test('eagerDisposable is disposed when thinking part is disposed even if factory was never called', () => {
			const content = createThinkingPart('**Working**');
			const context = createMockRenderContext(false);

			const part = instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			);

			mainWindow.document.body.appendChild(part.domNode);

			let disposed = false;
			const eagerDisposable = toDisposable(() => { disposed = true; });
			const factory = () => ({
				domNode: $('div.test-item'),
				disposable: eagerDisposable,
			});

			part.appendItem(factory, 'test-tool', undefined, undefined, undefined, eagerDisposable);

			assert.strictEqual(disposed, false, 'Should not be disposed yet');

			part.domNode.remove();
			part.dispose();

			assert.strictEqual(disposed, true, 'eagerDisposable should be disposed with the thinking part');
		});

		test('eagerDisposable is disposed when thinking part is disposed after factory was called', () => {
			const content = createThinkingPart('**Working**\nSome detailed analysis');
			const context = createMockRenderContext(false);

			const part = instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			);

			mainWindow.document.body.appendChild(part.domNode);

			let disposed = false;
			const eagerDisposable = toDisposable(() => { disposed = true; });
			const factory = () => ({
				domNode: $('div.test-item'),
				disposable: eagerDisposable,
			});

			part.appendItem(factory, 'test-tool', undefined, undefined, undefined, eagerDisposable);

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			assert.strictEqual(disposed, false, 'Should not be disposed yet');

			part.domNode.remove();
			part.dispose();

			assert.strictEqual(disposed, true, 'eagerDisposable should be disposed even after being materialized');
		});

		test('appendItem without eagerDisposable disposes factory result on thinking part disposal', () => {
			const content = createThinkingPart('**Working**\nSome detailed analysis');
			const context = createMockRenderContext(false);

			const part = instantiationService.createInstance(
				ChatThinkingContentPart,
				content,
				context,
				mockMarkdownRenderer,
				false
			);

			mainWindow.document.body.appendChild(part.domNode);

			const button = part.domNode.querySelector('.monaco-button') as HTMLElement;
			button?.click();

			let disposed = false;
			const factory = () => ({
				domNode: $('div.test-item'),
				disposable: toDisposable(() => { disposed = true; }),
			});

			part.appendItem(factory, 'test-tool');

			assert.strictEqual(disposed, false, 'Should not be disposed yet');

			part.domNode.remove();
			part.dispose();

			assert.strictEqual(disposed, true, 'Factory disposable should be disposed with thinking part');
		});
	});
});
