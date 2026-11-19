/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatEditingExplanationWidget.css';

import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { DetailedLineRangeMapping, LineRangeMapping } from '../../../../../editor/common/diff/rangeMapping.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { $, addDisposableListener, clearNode, getTotalWidth } from '../../../../../base/browser/dom.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { overviewRulerRangeHighlight } from '../../../../../editor/common/core/editorColorRegistry.js';
import { IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import { OverviewRulerLane } from '../../../../../editor/common/model.js';
import { themeColorFromId } from '../../../../../platform/theme/common/themeService.js';
import { ChatViewId, IChatWidget, IChatWidgetService } from '../chat.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import * as nls from '../../../../../nls.js';
import { IExplanationDiffInfo, IChangeExplanation as IChangeExplanationModel, IChatEditingExplanationModelManager } from './chatEditingExplanationModelManager.js';
import { autorun } from '../../../../../base/common/observable.js';

interface IChangeExplanation {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	explanation: string;
	read: boolean;
	loading: boolean;
	readonly originalText: string;
	readonly modifiedText: string;
}

function getChangeTexts(change: LineRangeMapping | DetailedLineRangeMapping, diffInfo: IExplanationDiffInfo): { originalText: string; modifiedText: string } {
	const originalLines: string[] = [];
	const modifiedLines: string[] = [];

	for (let i = change.original.startLineNumber; i < change.original.endLineNumberExclusive; i++) {
		const line = diffInfo.originalModel.getLineContent(i);
		originalLines.push(line);
	}

	for (let i = change.modified.startLineNumber; i < change.modified.endLineNumberExclusive; i++) {
		const line = diffInfo.modifiedModel.getLineContent(i);
		modifiedLines.push(line);
	}

	return {
		originalText: originalLines.join('\n'),
		modifiedText: modifiedLines.join('\n')
	};
}

function groupNearbyChanges<T extends LineRangeMapping>(changes: readonly T[], lineThreshold: number = 5): T[][] {
	if (changes.length === 0) {
		return [];
	}

	const groups: T[][] = [];
	let currentGroup: T[] = [changes[0]];

	for (let i = 1; i < changes.length; i++) {
		const firstChange = currentGroup[0];
		const currentChange = changes[i];

		const widgetLine = firstChange.modified.startLineNumber;
		const lastLine = currentChange.modified.startLineNumber;
		const verticalSpan = lastLine - widgetLine;

		if (verticalSpan <= lineThreshold) {
			currentGroup.push(currentChange);
		} else {
			groups.push(currentGroup);
			currentGroup = [currentChange];
		}
	}

	if (currentGroup.length > 0) {
		groups.push(currentGroup);
	}

	return groups;
}

export class ChatEditingExplanationWidget extends Disposable implements IOverlayWidget {

	private static _idPool = 0;
	private readonly _id: string = `chat-explanation-widget-${ChatEditingExplanationWidget._idPool++}`;

	private readonly _domNode: HTMLElement;
	private readonly _headerNode: HTMLElement;
	private readonly _readIndicator: HTMLElement;
	private readonly _titleNode: HTMLElement;
	private readonly _dismissButton: HTMLElement;
	private readonly _toggleButton: HTMLElement;
	private readonly _bodyNode: HTMLElement;
	private readonly _explanationItems: Map<number, { item: HTMLElement; readIndicator: HTMLElement; textElement: HTMLElement }> = new Map();

	private _position: IOverlayWidgetPosition | null = null;
	private _explanations: IChangeExplanation[] = [];
	private _isExpanded: boolean = true;
	private _isAllRead: boolean = false;
	private _disposed: boolean = false;
	private _startLineNumber: number = 1;
	private readonly _uri: URI;
	private readonly _rangeHighlightDecoration: IEditorDecorationsCollection;

	private readonly _eventStore = this._register(new DisposableStore());

	constructor(
		private readonly _editor: ICodeEditor,
		private _changes: readonly (LineRangeMapping | DetailedLineRangeMapping)[],
		diffInfo: IExplanationDiffInfo,
		private readonly _chatWidgetService: IChatWidgetService,
		private readonly _viewsService: IViewsService,
		private readonly _chatSessionResource?: URI,
	) {
		super();

		this._uri = diffInfo.modifiedModel.uri;

		this._rangeHighlightDecoration = this._editor.createDecorationsCollection();

		this._explanations = this._changes.map(change => {
			const { originalText, modifiedText } = getChangeTexts(change, diffInfo);
			return {
				startLineNumber: change.modified.startLineNumber,
				endLineNumber: change.modified.endLineNumberExclusive - 1,
				explanation: nls.localize('generatingExplanation', "Generating explanation..."),
				read: false,
				loading: true,
				originalText,
				modifiedText,
			};
		});

		this._domNode = $('div.chat-explanation-widget');

		this._headerNode = $('div.chat-explanation-header');

		this._readIndicator = $('div.chat-explanation-read-indicator');
		this._updateReadIndicator();
		this._headerNode.appendChild(this._readIndicator);

		this._titleNode = $('span.chat-explanation-title');
		this._updateTitle();
		this._headerNode.appendChild(this._titleNode);

		this._headerNode.appendChild($('span.chat-explanation-spacer'));

		this._toggleButton = $('div.chat-explanation-toggle');
		this._updateToggleButton();
		this._headerNode.appendChild(this._toggleButton);

		this._dismissButton = $('div.chat-explanation-dismiss');
		this._dismissButton.appendChild(renderIcon(Codicon.closeSmall));
		this._dismissButton.title = nls.localize('dismiss', "Dismiss");
		this._headerNode.appendChild(this._dismissButton);

		this._domNode.appendChild(this._headerNode);

		this._bodyNode = $('div.chat-explanation-body');
		this._buildExplanationItems();
		this._domNode.appendChild(this._bodyNode);

		const arrow = $('div.chat-explanation-arrow');
		this._domNode.appendChild(arrow);

		this._setupEventHandlers();

		this._domNode.classList.add('visible');

		this._editor.addOverlayWidget(this);
	}

	private _setupEventHandlers(): void {
		this._eventStore.add(addDisposableListener(this._readIndicator, 'click', (e) => {
			e.stopPropagation();
			this._isAllRead = !this._isAllRead;
			for (const exp of this._explanations) {
				exp.read = this._isAllRead;
			}
			this._updateReadIndicator();
			this._updateExplanationItemsReadState();
		}));

		this._eventStore.add(addDisposableListener(this._toggleButton, 'click', (e) => {
			e.stopPropagation();
			this._toggleExpanded();
		}));

		this._eventStore.add(addDisposableListener(this._headerNode, 'click', () => {
			this._toggleExpanded();
		}));

		this._eventStore.add(addDisposableListener(this._dismissButton, 'click', (e) => {
			e.stopPropagation();
			this._dismiss();
		}));
	}

	private _toggleExpanded(): void {
		this._isExpanded = !this._isExpanded;
		this._bodyNode.classList.toggle('collapsed', !this._isExpanded);
		this._updateToggleButton();
		this._editor.layoutOverlayWidget(this);
	}

	private _dismiss(): void {
		this._domNode.classList.add('fadeOut');

		const dispose = () => {
			this.dispose();
		};

		const handle = setTimeout(dispose, 150);
		this._domNode.addEventListener('animationend', () => {
			clearTimeout(handle);
			dispose();
		}, { once: true });
	}

	private _updateReadIndicator(): void {
		clearNode(this._readIndicator);
		const allRead = this._explanations.every(e => e.read);
		const someRead = this._explanations.some(e => e.read);
		this._isAllRead = allRead;

		if (allRead) {
			this._readIndicator.appendChild(renderIcon(Codicon.circle));
			this._readIndicator.classList.add('read');
			this._readIndicator.classList.remove('partial', 'unread');
			this._readIndicator.title = nls.localize('markAsUnread', "Mark as unread");
		} else if (someRead) {
			this._readIndicator.appendChild(renderIcon(Codicon.circleFilledCompact));
			this._readIndicator.classList.remove('read', 'unread');
			this._readIndicator.classList.add('partial');
			this._readIndicator.title = nls.localize('markAllAsRead', "Mark all as read");
		} else {
			this._readIndicator.appendChild(renderIcon(Codicon.circleFilledCompact));
			this._readIndicator.classList.remove('read', 'partial');
			this._readIndicator.classList.add('unread');
			this._readIndicator.title = nls.localize('markAsRead', "Mark as read");
		}
	}

	private _updateTitle(): void {
		const count = this._explanations.length;
		if (count === 1) {
			this._titleNode.textContent = nls.localize('oneChange', "1 change");
		} else {
			this._titleNode.textContent = nls.localize('nChanges', "{0} changes", count);
		}
	}

	private _updateToggleButton(): void {
		clearNode(this._toggleButton);
		if (this._isExpanded) {
			this._toggleButton.appendChild(renderIcon(Codicon.chevronUp));
			this._toggleButton.title = nls.localize('collapse', "Collapse");
		} else {
			this._toggleButton.appendChild(renderIcon(Codicon.chevronDown));
			this._toggleButton.title = nls.localize('expand', "Expand");
		}
	}

	private _buildExplanationItems(): void {
		clearNode(this._bodyNode);
		this._explanationItems.clear();

		for (let i = 0; i < this._explanations.length; i++) {
			const exp = this._explanations[i];
			const item = $('div.chat-explanation-item');

			const lineInfo = $('span.chat-explanation-line-info');
			if (exp.startLineNumber === exp.endLineNumber) {
				lineInfo.textContent = nls.localize('lineNumber', "Line {0}", exp.startLineNumber);
			} else {
				lineInfo.textContent = nls.localize('lineRange', "Lines {0}-{1}", exp.startLineNumber, exp.endLineNumber);
			}
			item.appendChild(lineInfo);

			const text = $('span.chat-explanation-text');
			if (exp.loading) {
				const loadingIcon = renderIcon(ThemeIcon.modify(Codicon.loading, 'spin'));
				loadingIcon.classList.add('chat-explanation-loading');
				text.appendChild(loadingIcon);
				const loadingText = document.createTextNode(' ' + exp.explanation);
				text.appendChild(loadingText);
			} else {
				text.textContent = exp.explanation;
			}
			item.appendChild(text);

			const itemReadIndicator = $('div.chat-explanation-item-read');
			this._updateItemReadIndicator(itemReadIndicator, exp.read);
			item.appendChild(itemReadIndicator);

			const replyButton = $('div.chat-explanation-reply-button');
			replyButton.appendChild(renderIcon(Codicon.arrowRight));
			replyButton.title = nls.localize('followUpOnChange', "Follow up on this change");
			item.appendChild(replyButton);

			this._eventStore.add(addDisposableListener(replyButton, 'click', async (e) => {
				e.stopPropagation();
				const range = new Range(exp.startLineNumber, 1, exp.endLineNumber, 1);
				let chatWidget: IChatWidget | undefined;
				if (this._chatSessionResource) {
					chatWidget = await this._chatWidgetService.openSession(this._chatSessionResource);
				} else {
					await this._viewsService.openView(ChatViewId, true);
					chatWidget = this._chatWidgetService.lastFocusedWidget;
				}
				if (chatWidget) {
					chatWidget.attachmentModel.addContext(
						chatWidget.attachmentModel.asFileVariableEntry(this._uri, range)
					);
				}
			}));

			this._eventStore.add(addDisposableListener(item, 'click', (e) => {
				e.stopPropagation();
				exp.read = !exp.read;
				this._updateItemReadIndicator(itemReadIndicator, exp.read);
				this._updateReadIndicator();
			}));

			this._eventStore.add(addDisposableListener(item, 'mouseenter', () => {
				const range = new Range(exp.startLineNumber, 1, exp.endLineNumber, this._editor.getModel()?.getLineMaxColumn(exp.endLineNumber) ?? 1);
				this._rangeHighlightDecoration.set([
					{
						range,
						options: {
							description: 'chat-explanation-range-highlight',
							className: 'rangeHighlight',
							isWholeLine: true,
							linesDecorationsClassName: 'chat-explanation-range-glyph',
						}
					},
					{
						range,
						options: {
							description: 'chat-explanation-range-highlight-overview',
							overviewRuler: {
								color: themeColorFromId(overviewRulerRangeHighlight),
								position: OverviewRulerLane.Full,
							}
						}
					}
				]);
			}));

			this._eventStore.add(addDisposableListener(item, 'mouseleave', () => {
				this._rangeHighlightDecoration.clear();
			}));

			this._explanationItems.set(i, { item, readIndicator: itemReadIndicator, textElement: text });
			this._bodyNode.appendChild(item);
		}
	}

	setExplanationByLineNumber(startLineNumber: number, endLineNumber: number, explanation: string): boolean {
		for (let i = 0; i < this._explanations.length; i++) {
			const exp = this._explanations[i];
			if (exp.startLineNumber === startLineNumber && exp.endLineNumber === endLineNumber) {
				exp.explanation = explanation;
				exp.loading = false;
				this._updateExplanationText(i);
				return true;
			}
		}
		return false;
	}

	get explanationCount(): number {
		return this._explanations.length;
	}

	private _updateExplanationText(index: number): void {
		const itemData = this._explanationItems.get(index);
		const exp = this._explanations[index];
		if (itemData && exp) {
			clearNode(itemData.textElement);
			itemData.textElement.textContent = exp.explanation;
		}
	}

	private _updateItemReadIndicator(element: HTMLElement, read: boolean): void {
		clearNode(element);
		if (read) {
			element.appendChild(renderIcon(Codicon.circle));
			element.classList.add('read');
			element.classList.remove('unread');
		} else {
			element.appendChild(renderIcon(Codicon.circleFilledCompact));
			element.classList.remove('read');
			element.classList.add('unread');
		}
	}

	private _updateExplanationItemsReadState(): void {
		this._explanationItems.forEach(({ readIndicator }, index) => {
			const exp = this._explanations[index];
			this._updateItemReadIndicator(readIndicator, exp.read);
		});
	}

	layout(startLineNumber: number): void {
		if (this._disposed) {
			return;
		}

		this._startLineNumber = startLineNumber;

		const lineHeight = this._editor.getOption(EditorOption.lineHeight);
		const { contentLeft, contentWidth, verticalScrollbarWidth } = this._editor.getLayoutInfo();
		const scrollTop = this._editor.getScrollTop();

		const widgetWidth = getTotalWidth(this._domNode) || 280;

		this._position = {
			stackOrdinal: 2,
			preference: {
				top: this._editor.getTopForLineNumber(startLineNumber) - scrollTop - lineHeight,
				left: contentLeft + contentWidth - (2 * verticalScrollbarWidth + widgetWidth)
			}
		};

		this._editor.layoutOverlayWidget(this);
	}

	toggle(show: boolean): void {
		this._domNode.classList.toggle('visible', show);
		if (show && this._explanations.length > 0) {
			this.layout(this._explanations[0].startLineNumber);
		}
	}

	relayout(): void {
		if (this._startLineNumber) {
			this.layout(this._startLineNumber);
		}
	}


	getId(): string {
		return this._id;
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return this._position;
	}

	override dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._rangeHighlightDecoration.clear();
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}
}

export class ChatEditingExplanationWidgetManager extends Disposable {

	private readonly _widgets: ChatEditingExplanationWidget[] = [];
	private _visible: boolean = false;

	private _chatSessionResource: URI | undefined;
	private _diffInfo: IExplanationDiffInfo | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _chatWidgetService: IChatWidgetService,
		private readonly _viewsService: IViewsService,
		modelManager: IChatEditingExplanationModelManager,
		private readonly _modelUri: URI,
	) {
		super();

		this._register(this._editor.onDidChangeModel(() => {
			const newUri = this._editor.getModel()?.uri;
			if (this._modelUri) {
				if (newUri && newUri.toString() === this._modelUri.toString()) {
					for (const widget of this._widgets) {
						widget.toggle(this._visible);
						widget.relayout();
					}
				} else {
					for (const widget of this._widgets) {
						widget.toggle(false);
					}
				}
			}
		}));

		this._register(autorun(r => {
			const state = modelManager.state.read(r);
			const uriState = state.get(this._modelUri);

			if (uriState) {
				this._diffInfo = uriState.diffInfo;
				this._chatSessionResource = uriState.chatSessionResource;

				if (this._widgets.length === 0 && this._diffInfo) {
					this._createWidgets(this._diffInfo, this._chatSessionResource);
				}
				if (uriState.progress === 'complete') {
					this._handleExplanations(this._modelUri, uriState.explanations);
				}
				this.show();
			} else {
				this.hide();
			}
		}));
	}

	private _createWidgets(diffInfo: IExplanationDiffInfo, chatSessionResource: URI | undefined): void {
		if (diffInfo.identical || diffInfo.changes.length === 0) {
			return;
		}

		const groups = groupNearbyChanges(diffInfo.changes, 5);

		for (const group of groups) {
			const widget = new ChatEditingExplanationWidget(
				this._editor,
				group,
				diffInfo,
				this._chatWidgetService,
				this._viewsService,
				chatSessionResource,
			);
			this._widgets.push(widget);
			this._register(widget);

			widget.layout(group[0].modified.startLineNumber);
		}

		this._register(Event.any(this._editor.onDidScrollChange, this._editor.onDidLayoutChange)(() => {
			for (const widget of this._widgets) {
				widget.relayout();
			}
		}));
	}

	private _handleExplanations(uri: URI, explanations: readonly IChangeExplanationModel[]): void {
		if (!this._modelUri || uri.toString() !== this._modelUri.toString()) {
			return;
		}

		for (const explanation of explanations) {
			for (const widget of this._widgets) {
				if (widget.setExplanationByLineNumber(
					explanation.startLineNumber,
					explanation.endLineNumber,
					explanation.explanation
				)) {
					break;
				}
			}
		}
	}

	show(): void {
		this._visible = true;
		for (const widget of this._widgets) {
			widget.toggle(true);
			widget.relayout();
		}
	}

	hide(): void {
		this._visible = false;
		for (const widget of this._widgets) {
			widget.toggle(false);
		}
	}

	private _clearWidgets(): void {
		for (const widget of this._widgets) {
			widget.dispose();
		}
		this._widgets.length = 0;
	}

	override dispose(): void {
		this._clearWidgets();
		super.dispose();
	}
}
