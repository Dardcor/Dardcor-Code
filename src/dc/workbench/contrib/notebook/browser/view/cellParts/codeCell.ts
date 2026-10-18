/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { localize } from '../../../../../../nls.js';
import * as DOM from '../../../../../../base/browser/dom.js';
import { raceCancellation } from '../../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Event } from '../../../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { clamp } from '../../../../../../base/common/numbers.js';
import * as strings from '../../../../../../base/common/strings.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { EditorOption } from '../../../../../../editor/common/config/editorOptions.js';
import { IDimension } from '../../../../../../editor/common/core/2d/dimension.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { tokenizeToStringSync } from '../../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { IReadonlyTextBuffer, ITextModel } from '../../../../../../editor/common/model.js';
import { CodeActionController } from '../../../../../../editor/contrib/codeAction/browser/codeActionController.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { INotebookExecutionStateService } from '../../../common/notebookExecutionStateService.js';
import { CellFocusMode, EXPAND_CELL_INPUT_COMMAND_ID, IActiveNotebookEditorDelegate } from '../../notebookBrowser.js';
import { CodeCellViewModel, outputDisplayLimit } from '../../viewModel/codeCellViewModel.js';
import { CellPartsCollection } from '../cellPart.js';
import { NotebookCellEditorPool } from '../notebookCellEditorPool.js';
import { CodeCellRenderTemplate, collapsedCellTTPolicy } from '../notebookRenderingCommon.js';
import { CellEditorOptions } from './cellEditorOptions.js';
import { CellOutputContainer } from './cellOutput.js';
import { CollapsedCodeCellExecutionIcon } from './codeCellExecutionIcon.js';
import { INotebookLoggingService } from '../../../common/notebookLoggingService.js';


export class CodeCell extends Disposable {
	private _outputContainerRenderer: CellOutputContainer;
	private _inputCollapseElement: HTMLElement | undefined;

	private _renderedInputCollapseState: boolean | undefined;
	private _renderedOutputCollapseState: boolean | undefined;
	private _isDisposed: boolean = false;
	private readonly cellParts: CellPartsCollection;

	private _collapsedExecutionIcon: CollapsedCodeCellExecutionIcon;
	private _cellEditorOptions: CellEditorOptions;
	private _useNewApproachForEditorLayout = true;
	private _pointerDownInEditor = false;
	private _pointerDraggingInEditor = false;
	private readonly _cellLayout: CodeCellLayout;
	private readonly _debug: (output: string) => void;
	constructor(
		private readonly notebookEditor: IActiveNotebookEditorDelegate,
		private readonly viewCell: CodeCellViewModel,
		private readonly templateData: CodeCellRenderTemplate,
		private readonly editorPool: NotebookCellEditorPool,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IConfigurationService private configurationService: IConfigurationService,
		@INotebookExecutionStateService notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookLoggingService notebookLogService: INotebookLoggingService,
	) {
		super();
		const cellIndex = this.notebookEditor.getCellIndex(this.viewCell);
		const debugPrefix = `[Cell ${cellIndex}]`;
		const debug = this._debug = (output: string) => {
			notebookLogService.debug('CellLayout', `${debugPrefix} ${output}`);
		};

		this._cellEditorOptions = this._register(new CellEditorOptions(this.notebookEditor.getBaseCellEditorOptions(viewCell.language), this.notebookEditor.notebookOptions, this.configurationService));
		this._outputContainerRenderer = this.instantiationService.createInstance(CellOutputContainer, notebookEditor, viewCell, templateData, { limit: outputDisplayLimit });
		this.cellParts = this._register(templateData.cellParts.concatContentPart([this._cellEditorOptions, this._outputContainerRenderer], DOM.getWindow(notebookEditor.getDomNode())));

		const initialEditorDimension = { height: this.calculateInitEditorHeight(), width: this.viewCell.layoutInfo.editorWidth };
		this._cellLayout = new CodeCellLayout(this._useNewApproachForEditorLayout, notebookEditor, viewCell, templateData, { debug }, initialEditorDimension);
		this.initializeEditor(initialEditorDimension);
		this._renderedInputCollapseState = false;

		this.registerNotebookEditorListeners();
		this.registerViewCellLayoutChange();
		this.registerCellEditorEventListeners();
		this.registerMouseListener();

		this._register(Event.any(this.viewCell.onDidStartExecution, this.viewCell.onDidStopExecution)((e) => {
			this.cellParts.updateForExecutionState(this.viewCell, e);
		}));

		this._register(this.viewCell.onDidChangeState(e => {
			this.cellParts.updateState(this.viewCell, e);

			if (e.outputIsHoveredChanged) {
				this.updateForOutputHover();
			}

			if (e.outputIsFocusedChanged) {
				this.updateForOutputFocus();
			}

			if (e.metadataChanged || e.internalMetadataChanged) {
				this.updateEditorOptions();
			}

			if (e.inputCollapsedChanged || e.outputCollapsedChanged) {
				this.viewCell.pauseLayout();
				const updated = this.updateForCollapseState();
				this.viewCell.resumeLayout();
				if (updated) {
					this.relayoutCell();
				}
			}

			if (e.focusModeChanged) {
				this.updateEditorForFocusModeChange(true);
			}
		}));

		this.updateEditorOptions();
		this.updateEditorForFocusModeChange(false);
		this.updateForOutputHover();
		this.updateForOutputFocus();

		this.cellParts.scheduleRenderCell(this.viewCell);

		this._register(toDisposable(() => {
			this.cellParts.unrenderCell(this.viewCell);
		}));


		this.viewCell.editorHeight = initialEditorDimension.height;
		this._outputContainerRenderer.render();
		this._renderedOutputCollapseState = false;
		this.initialViewUpdateExpanded();

		this._register(this.viewCell.onLayoutInfoRead(() => {
			this.cellParts.prepareLayout();
		}));

		const executionItemElement = DOM.append(this.templateData.cellInputCollapsedContainer, DOM.$('.collapsed-execution-icon'));
		this._register(toDisposable(() => {
			executionItemElement.remove();
		}));
		this._collapsedExecutionIcon = this._register(this.instantiationService.createInstance(CollapsedCodeCellExecutionIcon, this.notebookEditor, this.viewCell, executionItemElement));
		this.updateForCollapseState();

		this._register(Event.runAndSubscribe(viewCell.onDidChangeOutputs, this.updateForOutputs.bind(this)));
		this._register(Event.runAndSubscribe(viewCell.onDidChangeLayout, this.updateForLayout.bind(this)));

		this._cellEditorOptions.setLineNumbers(this.viewCell.lineNumbers);
		templateData.editor.updateOptions(this._cellEditorOptions.getUpdatedValue(this.viewCell.internalMetadata, this.viewCell.uri));
	}

	private updateCodeCellOptions(templateData: CodeCellRenderTemplate) {
		templateData.editor.updateOptions(this._cellEditorOptions.getUpdatedValue(this.viewCell.internalMetadata, this.viewCell.uri));

		const cts = new CancellationTokenSource();
		this._register({ dispose() { cts.dispose(true); } });
		raceCancellation(this.viewCell.resolveTextModel(), cts.token).then(model => {
			if (this._isDisposed) {
				return;
			}

			if (model) {
				model.updateOptions({
					indentSize: this._cellEditorOptions.indentSize,
					tabSize: this._cellEditorOptions.tabSize,
					insertSpaces: this._cellEditorOptions.insertSpaces,
				});
			}
		});
	}

	private _pendingLayout: IDisposable | undefined;

	private updateForLayout(): void {
		this._pendingLayout?.dispose();
		this._pendingLayout = DOM.modify(DOM.getWindow(this.notebookEditor.getDomNode()), () => {
			this.cellParts.updateInternalLayoutNow(this.viewCell);
		});
	}

	private updateForOutputHover() {
		this.templateData.container.classList.toggle('cell-output-hover', this.viewCell.outputIsHovered);
	}

	private updateForOutputFocus() {
		this.templateData.container.classList.toggle('cell-output-focus', this.viewCell.outputIsFocused);
	}

	private calculateInitEditorHeight() {
		const lineNum = this.viewCell.lineCount;
		const lineHeight = this.viewCell.layoutInfo.fontInfo?.lineHeight || 17;
		const editorPadding = this.notebookEditor.notebookOptions.computeEditorPadding(this.viewCell.internalMetadata, this.viewCell.uri);
		const editorHeight = this.viewCell.layoutInfo.editorHeight === 0
			? lineNum * lineHeight + editorPadding.top + editorPadding.bottom
			: this.viewCell.layoutInfo.editorHeight;
		return editorHeight;
	}

	private initializeEditor(dimension: IDimension) {
		this._debug(`Initialize Editor ${dimension.height} x ${dimension.width}, Scroll Top = ${this.notebookEditor.scrollTop}`);
		this._cellLayout.layoutEditor('init');
		this.layoutEditor(dimension);

		const cts = new CancellationTokenSource();
		this._register({ dispose() { cts.dispose(true); } });
		raceCancellation(this.viewCell.resolveTextModel(), cts.token).then(model => {
			if (this._isDisposed || model?.isDisposed()) {
				return;
			}

			if (model && this.templateData.editor) {
				this._reigsterModelListeners(model);

				this.templateData.editor.setModel(model);

				if (this._isDisposed) {
					return;
				}

				model.updateOptions({
					indentSize: this._cellEditorOptions.indentSize,
					tabSize: this._cellEditorOptions.tabSize,
					insertSpaces: this._cellEditorOptions.insertSpaces,
				});
				this.viewCell.attachTextEditor(this.templateData.editor, this.viewCell.layoutInfo.estimatedHasHorizontalScrolling);
				const focusEditorIfNeeded = () => {
					if (
						this.notebookEditor.getActiveCell() === this.viewCell &&
						this.viewCell.focusMode === CellFocusMode.Editor &&
						(this.notebookEditor.hasEditorFocus() || this.notebookEditor.getDomNode().ownerDocument.activeElement === this.notebookEditor.getDomNode().ownerDocument.body))
					{
						this.templateData.editor.focus();
					}
				};
				focusEditorIfNeeded();

				const realContentHeight = this.templateData.editor.getContentHeight();
				if (realContentHeight !== dimension.height) {
					this.onCellEditorHeightChange('onDidResolveTextModel');
				}

				if (this._isDisposed) {
					return;
				}

				focusEditorIfNeeded();
			}

			this._register(this._cellEditorOptions.onDidChange(() => this.updateCodeCellOptions(this.templateData)));
		});
	}

	private updateForOutputs(): void {
		DOM.setVisibility(this.viewCell.outputsViewModels.length > 0, this.templateData.focusSinkElement);
	}

	private updateEditorOptions() {
		const editor = this.templateData.editor;
		if (!editor) {
			return;
		}

		const isReadonly = this.notebookEditor.isReadOnly;
		const padding = this.notebookEditor.notebookOptions.computeEditorPadding(this.viewCell.internalMetadata, this.viewCell.uri);
		const options = editor.getOptions();
		if (options.get(EditorOption.readOnly) !== isReadonly || options.get(EditorOption.padding) !== padding) {
			editor.updateOptions({
				readOnly: this.notebookEditor.isReadOnly, padding: this.notebookEditor.notebookOptions.computeEditorPadding(this.viewCell.internalMetadata, this.viewCell.uri)
			});
		}
	}

	private registerNotebookEditorListeners() {
		this._register(this.notebookEditor.onDidScroll(() => {
			this.adjustEditorPosition();
			this._cellLayout.layoutEditor('nbDidScroll');
		}));

		this._register(this.notebookEditor.onDidChangeLayout(() => {
			this.adjustEditorPosition();
			this.onCellWidthChange('nbLayoutChange');
		}));
	}

	private adjustEditorPosition() {
		if (this._useNewApproachForEditorLayout) {
			return;
		}
		const extraOffset = -6 - 1 ;
		const min = 0;

		const scrollTop = this.notebookEditor.scrollTop;
		const elementTop = this.notebookEditor.getAbsoluteTopOfElement(this.viewCell);
		const diff = scrollTop - elementTop + extraOffset;

		const notebookEditorLayout = this.notebookEditor.getLayoutInfo();

		const editorMaxHeight = notebookEditorLayout.height
			- notebookEditorLayout.stickyHeight
			- 26 ;

		const maxTop =
			this.viewCell.layoutInfo.editorHeight
			- editorMaxHeight
			;
		const top = maxTop > 20 ?
			clamp(min, diff, maxTop) :
			min;
		this.templateData.editorPart.style.top = `${top}px`;
		this.templateData.editor.setScrollTop(top);
	}

	private registerViewCellLayoutChange() {
		this._register(this.viewCell.onDidChangeLayout((e) => {
			if (e.outerWidth !== undefined) {
				const layoutInfo = this.templateData.editor.getLayoutInfo();
				if (layoutInfo.width !== this.viewCell.layoutInfo.editorWidth) {
					this.onCellWidthChange('viewCellLayoutChange');
					this.adjustEditorPosition();
				}
			}
		}));
	}

	private registerCellEditorEventListeners() {
		this._register(this.templateData.editor.onDidContentSizeChange((e) => {
			if (e.contentHeightChanged) {
				if (this.viewCell.layoutInfo.editorHeight !== e.contentHeight) {
					this.onCellEditorHeightChange(`onDidContentSizeChange`);
					this.adjustEditorPosition();
				}
			}
		}));

		if (this._useNewApproachForEditorLayout) {
			this._register(this.templateData.editor.onDidScrollChange(e => {
				if (this._pointerDownInEditor || this._pointerDraggingInEditor) {
					return;
				}
				if (this._cellLayout.editorVisibility === 'Invisible' || !this.templateData.editor.hasTextFocus()) {
					return;
				}
				if (this._cellLayout._lastChangedEditorScrolltop === e.scrollTop || this._cellLayout.isUpdatingLayout) {
					return;
				}
				const scrollTop = this.notebookEditor.scrollTop;
				const diff = e.scrollTop - (this._cellLayout._lastChangedEditorScrolltop ?? 0);
				if (this._cellLayout.editorVisibility === 'Full (Small Viewport)' && typeof this._cellLayout._lastChangedEditorScrolltop === 'number') {
					this._debug(`Scroll Change (1) = ${e.scrollTop} changed by ${diff} (notebook scrollTop: ${scrollTop}, setEditorScrollTop: ${e.scrollTop})`);
				} else if (this._cellLayout.editorVisibility === 'Bottom Clipped' && typeof this._cellLayout._lastChangedEditorScrolltop === 'number') {
					this._debug(`Scroll Change (2) = ${e.scrollTop} changed by ${diff} (notebook scrollTop: ${scrollTop}, setNotebookScrollTop: ${scrollTop + e.scrollTop})`);
					this.notebookEditor.setScrollTop(scrollTop + e.scrollTop);
				} else if (this._cellLayout.editorVisibility === 'Top Clipped' && typeof this._cellLayout._lastChangedEditorScrolltop === 'number') {
					const newScrollTop = scrollTop + diff - 1;
					this._debug(`Scroll Change (3) = ${e.scrollTop} changed by ${diff} (notebook scrollTop: ${scrollTop}, setNotebookScrollTop?: ${newScrollTop})`);
					if (scrollTop !== newScrollTop) {
						this.notebookEditor.setScrollTop(newScrollTop);
					}
				} else {
					this._debug(`Scroll Change (4) = ${e.scrollTop} changed by ${diff} (notebook scrollTop: ${scrollTop})`);
					this._cellLayout._lastChangedEditorScrolltop = undefined;
				}
			}));
		}

		this._register(this.templateData.editor.onDidChangeCursorSelection((e) => {
			if (
				e.source === 'restoreState' || e.oldModelVersionId === 0
				|| !this.templateData.editor.hasTextFocus()
			) {
				return;
			}

			if ((this._pointerDownInEditor || this._pointerDraggingInEditor) && this._useNewApproachForEditorLayout) {
				return;
			}

			const selections = this.templateData.editor.getSelections();

			if (selections?.length) {
				const contentHeight = this.templateData.editor.getContentHeight();
				const layoutContentHeight = this.viewCell.layoutInfo.editorHeight;

				if (contentHeight !== layoutContentHeight) {
					if (!this._useNewApproachForEditorLayout) {
						this._debug(`onDidChangeCursorSelection`);
						this.onCellEditorHeightChange('onDidChangeCursorSelection');
					}

					if (this._isDisposed) {
						return;
					}
				}
				const lastSelection = selections[selections.length - 1];
				this.notebookEditor.revealRangeInViewAsync(this.viewCell, lastSelection);
			}
		}));

		this._register(this.templateData.editor.onDidBlurEditorWidget(() => {
			CodeActionController.get(this.templateData.editor)?.hideLightBulbWidget();
		}));
	}

	private _reigsterModelListeners(model: ITextModel) {
		this._register(model.onDidChangeTokens(() => {
			if (this.viewCell.isInputCollapsed && this._inputCollapseElement) {
				const content = this._getRichTextFromLineTokens(model);
				this._inputCollapseElement.innerHTML = (collapsedCellTTPolicy?.createHTML(content) ?? content) as string;
				this._attachInputExpandButton(this._inputCollapseElement);
			}
		}));
	}

	private registerMouseListener() {
		const resetPointerState = () => {
			this._pointerDownInEditor = false;
			this._pointerDraggingInEditor = false;
			this._cellLayout.setPointerDown(false);
		};

		this._register(this.templateData.editor.onMouseDown(e => {
			if (e.event.rightButton) {
				e.event.preventDefault();
			}

			if (this._useNewApproachForEditorLayout) {
				if (e.event.leftButton) {
					this._pointerDownInEditor = true;
					this._pointerDraggingInEditor = false;
					this._cellLayout.setPointerDown(false);
				}
			}
		}));

		if (this._useNewApproachForEditorLayout) {
			this._register(this.templateData.editor.onMouseMove(e => {
				if (!this._pointerDownInEditor) {
					return;
				}

				if (!e.event.leftButton) {
					resetPointerState();
					return;
				}

				if (!this._pointerDraggingInEditor) {
					this._pointerDraggingInEditor = true;
					this._cellLayout.setPointerDown(true);
				}
			}));
		}

		if (this._useNewApproachForEditorLayout) {
			const win = DOM.getWindow(this.notebookEditor.getDomNode());
			this._register(DOM.addDisposableListener(win, 'mouseup', resetPointerState));
			this._register(DOM.addDisposableListener(win, 'pointerup', resetPointerState));
			this._register(DOM.addDisposableListener(win, 'pointercancel', resetPointerState));
			this._register(DOM.addDisposableListener(win, 'blur', resetPointerState));
			this._register(DOM.addDisposableListener(win, 'keydown', e => {
				if (e.key === 'Escape' && (this._pointerDownInEditor || this._pointerDraggingInEditor)) {
					resetPointerState();
				}
			}));
		}
	}

	private shouldPreserveEditor() {
		return this.notebookEditor.getActiveCell() === this.viewCell
			&& this.viewCell.focusMode === CellFocusMode.Editor
			&& (this.notebookEditor.hasEditorFocus() || this.notebookEditor.getDomNode().ownerDocument.activeElement === this.notebookEditor.getDomNode().ownerDocument.body);
	}

	private updateEditorForFocusModeChange(sync: boolean) {
		if (this.shouldPreserveEditor()) {
			if (sync) {
				this.templateData.editor.focus();
			} else {
				this._register(DOM.runAtThisOrScheduleAtNextAnimationFrame(DOM.getWindow(this.templateData.container), () => {
					this.templateData.editor.focus();
				}));
			}
		}

		this.templateData.container.classList.toggle('cell-editor-focus', this.viewCell.focusMode === CellFocusMode.Editor);
		this.templateData.container.classList.toggle('cell-output-focus', this.viewCell.focusMode === CellFocusMode.Output);
	}
	private updateForCollapseState(): boolean {
		if (this.viewCell.isOutputCollapsed === this._renderedOutputCollapseState &&
			this.viewCell.isInputCollapsed === this._renderedInputCollapseState) {
			return false;
		}

		this.viewCell.layoutChange({ editorHeight: true });

		if (this.viewCell.isInputCollapsed) {
			this._collapseInput();
		} else {
			this._showInput();
		}

		if (this.viewCell.isOutputCollapsed) {
			this._collapseOutput();
		} else {
			this._showOutput(false);
		}

		this.relayoutCell();

		this._renderedOutputCollapseState = this.viewCell.isOutputCollapsed;
		this._renderedInputCollapseState = this.viewCell.isInputCollapsed;

		return true;
	}

	private _collapseInput() {
		DOM.hide(this.templateData.editorPart);
		this.templateData.container.classList.toggle('input-collapsed', true);

		this._removeInputCollapsePreview();

		this._collapsedExecutionIcon.setVisibility(true);

		const richEditorText = this.templateData.editor.hasModel() ? this._getRichTextFromLineTokens(this.templateData.editor.getModel()) : this._getRichText(this.viewCell.textBuffer, this.viewCell.language);
		const element = DOM.$('div.cell-collapse-preview');
		element.innerHTML = (collapsedCellTTPolicy?.createHTML(richEditorText) ?? richEditorText) as string;
		this._inputCollapseElement = element;
		this.templateData.cellInputCollapsedContainer.appendChild(element);
		this._attachInputExpandButton(element);

		DOM.show(this.templateData.cellInputCollapsedContainer);
	}

	private _attachInputExpandButton(element: HTMLElement) {
		const expandIcon = DOM.$('span.expandInputIcon');
		const keybinding = this.keybindingService.lookupKeybinding(EXPAND_CELL_INPUT_COMMAND_ID);
		if (keybinding) {
			element.title = localize('cellExpandInputButtonLabelWithDoubleClick', "Double-click to expand cell input ({0})", keybinding.getLabel());
			expandIcon.title = localize('cellExpandInputButtonLabel', "Expand Cell Input ({0})", keybinding.getLabel());
		}

		expandIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.more));
		element.appendChild(expandIcon);
	}

	private _showInput() {
		this._collapsedExecutionIcon.setVisibility(false);
		DOM.show(this.templateData.editorPart);
		DOM.hide(this.templateData.cellInputCollapsedContainer);
	}

	private _getRichText(buffer: IReadonlyTextBuffer, language: string) {
		return tokenizeToStringSync(this.languageService, buffer.getLineContent(1), language);
	}

	private _getRichTextFromLineTokens(model: ITextModel) {
		let result = `<div class="monaco-tokenized-source">`;

		const firstLineTokens = model.tokenization.getLineTokens(1);
		const viewLineTokens = firstLineTokens.inflate();
		const line = model.getLineContent(1);
		let startOffset = 0;
		for (let j = 0, lenJ = viewLineTokens.getCount(); j < lenJ; j++) {
			const type = viewLineTokens.getClassName(j);
			const endIndex = viewLineTokens.getEndOffset(j);
			result += `<span class="${type}">${strings.escape(line.substring(startOffset, endIndex))}</span>`;
			startOffset = endIndex;
		}

		result += `</div>`;
		return result;
	}

	private _removeInputCollapsePreview() {
		const children = this.templateData.cellInputCollapsedContainer.children;
		const elements = [];
		for (let i = 0; i < children.length; i++) {
			if (children[i].classList.contains('cell-collapse-preview')) {
				elements.push(children[i]);
			}
		}

		elements.forEach(element => {
			element.remove();
		});
	}

	private _updateOutputInnerContainer(hide: boolean) {
		const children = this.templateData.outputContainer.domNode.children;
		for (let i = 0; i < children.length; i++) {
			if (children[i].classList.contains('output-inner-container')) {
				DOM.setVisibility(!hide, children[i] as HTMLElement);
			}
		}
	}

	private _collapseOutput() {
		this.templateData.container.classList.toggle('output-collapsed', true);
		DOM.show(this.templateData.cellOutputCollapsedContainer);
		this._updateOutputInnerContainer(true);
		this._outputContainerRenderer.viewUpdateHideOuputs();
	}

	private _showOutput(initRendering: boolean) {
		this.templateData.container.classList.toggle('output-collapsed', false);
		DOM.hide(this.templateData.cellOutputCollapsedContainer);
		this._updateOutputInnerContainer(false);
		this._outputContainerRenderer.viewUpdateShowOutputs(initRendering);
	}

	private initialViewUpdateExpanded(): void {
		this.templateData.container.classList.toggle('input-collapsed', false);
		DOM.show(this.templateData.editorPart);
		DOM.hide(this.templateData.cellInputCollapsedContainer);
		this.templateData.container.classList.toggle('output-collapsed', false);
		this._showOutput(true);
	}

	private layoutEditor(dimension: IDimension): void {
		if (this._useNewApproachForEditorLayout) {
			return;
		}
		const editorLayout = this.notebookEditor.getLayoutInfo();
		const maxHeight = Math.min(
			editorLayout.height
			- editorLayout.stickyHeight
			- 26 ,
			dimension.height
		);
		this._debug(`Layout Editor: Width = ${dimension.width}, Height = ${maxHeight} (Requested: ${dimension.height}, Editor Layout Height: ${editorLayout.height}, Sticky: ${editorLayout.stickyHeight})`);
		this.templateData.editor.layout({
			width: dimension.width,
			height: maxHeight
		}, true);
	}

	private onCellWidthChange(dbgReasonForChange: CellLayoutChangeReason): void {
		this._debug(`Cell Editor Width Change, ${dbgReasonForChange}, Content Height = ${this.templateData.editor.getContentHeight()}`);
		const height = this.templateData.editor.getContentHeight();
		if (this.templateData.editor.hasModel()) {
			this._debug(`**** Updating Cell Editor Height (1), ContentHeight: ${height}, CodeCellLayoutInfo.EditorWidth ${this.viewCell.layoutInfo.editorWidth}, EditorLayoutInfo ${this.templateData.editor.getLayoutInfo().height} ****`);
			this.viewCell.editorHeight = height;
			this.relayoutCell();
			this.layoutEditor(
				{
					width: this.viewCell.layoutInfo.editorWidth,
					height
				}
			);
		} else {
			this._debug(`Cell Editor Width Change without model, return (1), ContentHeight: ${height}, CodeCellLayoutInfo.EditorWidth ${this.viewCell.layoutInfo.editorWidth}, EditorLayoutInfo ${this.templateData.editor.getLayoutInfo().height}`);
		}
		this._cellLayout.layoutEditor(dbgReasonForChange);
	}

	private onCellEditorHeightChange(dbgReasonForChange: CellLayoutChangeReason): void {
		const height = this.templateData.editor.getContentHeight();
		if (!this.templateData.editor.hasModel()) {
			this._debug(`Cell Editor Height Change without model, return (2), ContentHeight: ${height}, CodeCellLayoutInfo.EditorWidth ${this.viewCell.layoutInfo.editorWidth}, EditorLayoutInfo ${this.templateData.editor.getLayoutInfo()}`);
		}
		this._debug(`Cell Editor Height Change (${dbgReasonForChange}): ${height}`);
		this._debug(`**** Updating Cell Editor Height (2), ContentHeight: ${height}, CodeCellLayoutInfo.EditorWidth ${this.viewCell.layoutInfo.editorWidth}, EditorLayoutInfo ${this.templateData.editor.getLayoutInfo().height} ****`);
		const viewLayout = this.templateData.editor.getLayoutInfo();
		this.viewCell.editorHeight = height;
		this.relayoutCell();
		this.layoutEditor(
			{
				width: viewLayout.width,
				height
			}
		);
		this._cellLayout.layoutEditor(dbgReasonForChange);
	}

	relayoutCell() {
		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	override dispose() {
		this._isDisposed = true;

		if (this.shouldPreserveEditor()) {
			this.editorPool.preserveFocusedEditor(this.viewCell);
		}

		this.viewCell.detachTextEditor();
		this._removeInputCollapsePreview();
		this._outputContainerRenderer.dispose();
		this._pendingLayout?.dispose();

		super.dispose();
	}
}

type CellLayoutChangeReason = 'nbLayoutChange' | 'nbDidScroll' | 'viewCellLayoutChange' | 'init' | 'onDidChangeCursorSelection' | 'onDidContentSizeChange' | 'onDidResolveTextModel';

export class CodeCellLayout {
	private _editorVisibility?: 'Full' | 'Top Clipped' | 'Bottom Clipped' | 'Full (Small Viewport)' | 'Invisible';
	public get editorVisibility() {
		return this._editorVisibility;
	}
	private _isUpdatingLayout?: boolean;
	public get isUpdatingLayout() {
		return this._isUpdatingLayout;
	}
	public _previousScrollBottom?: number;
	public _lastChangedEditorScrolltop?: number;
	private _initialized: boolean = false;
	private _pointerDown: boolean = false;
	private _establishedContentHeight?: number;
	constructor(
		private readonly _enabled: boolean,
		private readonly notebookEditor: IActiveNotebookEditorDelegate,
		private readonly viewCell: CodeCellViewModel,
		private readonly templateData: CodeCellRenderTemplate,
		private readonly _logService: { debug: (output: string) => void },
		private readonly _initialEditorDimension: IDimension
	) {
	}

	public setPointerDown(isDown: boolean) {
		this._pointerDown = isDown;
	}
	public layoutEditor(reason: CellLayoutChangeReason): void {
		if (!this._enabled) {
			return;
		}
		const element = this.templateData.editorPart;
		if (this.viewCell.isInputCollapsed) {
			element.style.top = '';
			return;
		}

		const LINE_HEIGHT = this.notebookEditor.getLayoutInfo().fontInfo.lineHeight;
		const CELL_TOP_MARGIN = this.viewCell.layoutInfo.topMargin;
		const CELL_OUTLINE_WIDTH = this.viewCell.layoutInfo.outlineWidth;
		const STATUSBAR_HEIGHT = this.viewCell.layoutInfo.statusBarHeight;


		const editor = this.templateData.editor;
		const editorLayout = this.templateData.editor.getLayoutInfo();
		const editorWidth = this._initialized && (reason === 'nbLayoutChange' || reason === 'viewCellLayoutChange') ? this.viewCell.layoutInfo.editorWidth : editorLayout.width;
		const editorHeight = this.viewCell.layoutInfo.editorHeight;
		const scrollTop = this.notebookEditor.scrollTop;
		const elementTop = this.notebookEditor.getAbsoluteTopOfElement(this.viewCell);
		const elementBottom = this.notebookEditor.getAbsoluteBottomOfElement(this.viewCell);
		const elementHeight = this.notebookEditor.getHeightOfElement(this.viewCell);
		let editorContentHeight: number;
		const isInit = !this._initialized && reason === 'init';
		if (isInit) {
			editorContentHeight = this._initialEditorDimension.height;
			this._establishedContentHeight = editorContentHeight;
		} else {
			const gotContentHeight = editor.getContentHeight();
			const fallbackEditorContentHeight = gotContentHeight === -1 ? Math.max(editor.getLayoutInfo().height, this._initialEditorDimension.height) : gotContentHeight;
			const shouldRefreshContentHeight = !this._initialized || reason === 'onDidContentSizeChange' || reason === 'viewCellLayoutChange' || reason === 'nbLayoutChange';
			if (shouldRefreshContentHeight) {
				editorContentHeight = fallbackEditorContentHeight;
				this._establishedContentHeight = editorContentHeight;
			} else {
				editorContentHeight = this._establishedContentHeight ?? fallbackEditorContentHeight;
			}
		}
		const editorBottom = elementTop + this.viewCell.layoutInfo.outputContainerOffset;
		const scrollBottom = this.notebookEditor.scrollBottom;
		const viewportHeight = scrollBottom - scrollTop === 0 ? this.notebookEditor.getLayoutInfo().height : scrollBottom - scrollTop;
		const outputContainerOffset = this.viewCell.layoutInfo.outputContainerOffset;
		const scrollDirection: 'down' | 'up' = typeof this._previousScrollBottom === 'number' ? (scrollBottom < this._previousScrollBottom ? 'up' : 'down') : 'down';
		this._previousScrollBottom = scrollBottom;

		let top = Math.max(0, scrollTop - elementTop - CELL_TOP_MARGIN - CELL_OUTLINE_WIDTH);
		const possibleEditorHeight = editorHeight - top;
		if (possibleEditorHeight < LINE_HEIGHT) {
			top = top - (LINE_HEIGHT - possibleEditorHeight) - CELL_OUTLINE_WIDTH;
		}

		let height = editorContentHeight;
		let editorScrollTop = 0;
		if (scrollTop <= (elementTop + CELL_TOP_MARGIN)) {
			const minimumEditorHeight = LINE_HEIGHT + this.notebookEditor.notebookOptions.getLayoutConfiguration().editorTopPadding;
			if (scrollBottom >= editorBottom) {
				height = clamp(editorContentHeight, minimumEditorHeight, editorContentHeight);
				this._editorVisibility = 'Full';
			} else {
				height = clamp(scrollBottom - (elementTop + CELL_TOP_MARGIN) - STATUSBAR_HEIGHT, minimumEditorHeight, editorContentHeight) + (2 * CELL_OUTLINE_WIDTH);
				this._editorVisibility = 'Bottom Clipped';
				editorScrollTop = 0;
			}
		} else {
			if (viewportHeight <= editorContentHeight && scrollBottom <= editorBottom) {
				const minimumEditorHeight = LINE_HEIGHT + this.notebookEditor.notebookOptions.getLayoutConfiguration().editorTopPadding;
				height = clamp(viewportHeight - STATUSBAR_HEIGHT, minimumEditorHeight, editorContentHeight - STATUSBAR_HEIGHT) + (2 * CELL_OUTLINE_WIDTH);
				this._editorVisibility = 'Full (Small Viewport)';
				editorScrollTop = top;
			} else {
				const minimumEditorHeight = LINE_HEIGHT;
				height = clamp(editorContentHeight - (scrollTop - (elementTop + CELL_TOP_MARGIN)), minimumEditorHeight, editorContentHeight);
				if (scrollTop > editorBottom) {
					this._editorVisibility = 'Invisible';
				} else {
					this._editorVisibility = 'Top Clipped';
				}
				editorScrollTop = editorContentHeight - height;
			}
		}

		this._logService.debug(`${reason} (${this._editorVisibility}, ${this._initialized})`);
		this._logService.debug(`=> Editor Top = ${top}px (editHeight = ${editorHeight}, editContentHeight: ${editorContentHeight})`);
		this._logService.debug(`=> eleTop = ${elementTop}, eleBottom = ${elementBottom}, eleHeight = ${elementHeight}`);
		this._logService.debug(`=> scrollTop = ${scrollTop}, top = ${top}`);
		this._logService.debug(`=> cellTopMargin = ${CELL_TOP_MARGIN}, cellBottomMargin = ${this.viewCell.layoutInfo.topMargin}, cellOutline = ${CELL_OUTLINE_WIDTH}`);
		this._logService.debug(`=> scrollBottom: ${scrollBottom}, editBottom: ${editorBottom}, viewport: ${viewportHeight}, scroll: ${scrollDirection}, contOffset: ${outputContainerOffset})`);
		this._logService.debug(`=> Editor Height = ${height}px, Width: ${editorWidth}px, Initial Width: ${this._initialEditorDimension.width}, EditorScrollTop = ${editorScrollTop}px, StatusbarHeight = ${STATUSBAR_HEIGHT}, lineHeight = ${this.notebookEditor.getLayoutInfo().fontInfo.lineHeight}`);

		try {
			this._isUpdatingLayout = true;
			element.style.top = `${top}px`;
			editor.layout({
				width: this._initialized ? editorWidth : this._initialEditorDimension.width,
				height
			}, true);
			if (!this._pointerDown && editorScrollTop >= 0) {
				this._lastChangedEditorScrolltop = editorScrollTop;
				editor.setScrollTop(editorScrollTop);
			}
		} finally {
			this._initialized = true;
			this._isUpdatingLayout = false;
			this._logService.debug('Updated Editor Layout');
		}
	}
}
