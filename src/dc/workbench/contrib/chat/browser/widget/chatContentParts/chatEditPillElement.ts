/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../../../base/browser/mouseEvent.js';
import { HoverStyle } from '../../../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../../../base/browser/ui/hover/hoverWidget.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import type { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { FileKind } from '../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
import { IOpenEditorOptions, registerOpenEditorListeners } from '../../../../../../platform/editor/browser/editor.js';
import { getCompactCodicon } from '../../chatIcons.js';
import './media/chatCodeBlockPill.css';

const $ = dom.$;

export class ChatEditPillElement extends Disposable {

	readonly element: HTMLElement;
	protected readonly pillElement: HTMLElement;
	protected readonly statusIndicatorContainer: HTMLElement;
	protected readonly statusIconEl: HTMLElement;
	protected readonly statusLabelEl: HTMLElement;
	protected readonly progressFillEl: HTMLElement;
	protected readonly fileIconEl: HTMLElement;
	protected readonly fileIconLabelEl: HTMLElement;
	protected readonly labelDetailEl: HTMLElement;

	private readonly _hover = this._register(new MutableDisposable());
	private _tooltip: string | undefined;

	private _uri: URI | undefined;
	get uri(): URI | undefined { return this._uri; }

	private _statusIconClasses: string[] = [];
	private _pillIconClasses: string[] = [];

	private _labelAddedEl: HTMLElement | undefined;
	private _labelRemovedEl: HTMLElement | undefined;

	private readonly _onDidClick = this._register(new Emitter<IOpenEditorOptions>());
	readonly onDidClick: Event<IOpenEditorOptions> = this._onDidClick.event;

	private readonly _onDidContextMenu = this._register(new Emitter<StandardMouseEvent>());
	readonly onDidContextMenu: Event<StandardMouseEvent> = this._onDidContextMenu.event;

	constructor(
		@ILabelService protected readonly labelService: ILabelService,
		@IModelService protected readonly modelService: IModelService,
		@ILanguageService protected readonly languageService: ILanguageService,
		@IHoverService protected readonly hoverService: IHoverService,
	) {
		super();

		this.element = $('div.chat-codeblock-pill-container');

		this.statusIndicatorContainer = $('div.status-indicator-container');
		this.statusIconEl = $('span.status-icon');
		this.statusLabelEl = $('span.status-label', {}, '');
		this.statusIndicatorContainer.append(this.statusIconEl, this.statusLabelEl);

		this.pillElement = $('.chat-codeblock-pill-widget');
		this.pillElement.tabIndex = 0;
		this.pillElement.classList.add('show-file-icons');
		this.pillElement.role = 'button';
		this.progressFillEl = $('span.progress-fill');
		this.fileIconEl = $('span.icon');
		this.fileIconLabelEl = $('span.icon-label', {}, '');
		this.labelDetailEl = $('span.label-detail', {}, '');
		this.pillElement.append(this.progressFillEl, this.fileIconEl, this.fileIconLabelEl, this.labelDetailEl);

		this.element.append(this.statusIndicatorContainer, this.pillElement);

		this._register(registerOpenEditorListeners(this.pillElement, opts => this._onDidClick.fire(opts)));
		this._register(dom.addDisposableListener(this.pillElement, dom.EventType.CONTEXT_MENU, e => {
			const event = new StandardMouseEvent(dom.getWindow(e), e);
			dom.EventHelper.stop(e, true);
			this._onDidContextMenu.fire(event);
		}));
	}

	setUri(uri: URI): void {
		this._uri = uri;
		const iconText = this.labelService.getUriBasenameLabel(uri);
		this.fileIconLabelEl.textContent = iconText;
		const fileKind = uri.path.endsWith('/') ? FileKind.FOLDER : FileKind.FILE;
		this.fileIconEl.classList.remove(...this._pillIconClasses);
		this._pillIconClasses = getIconClasses(this.modelService, this.languageService, uri, fileKind);
		this.fileIconEl.classList.add(...this._pillIconClasses);
		this.setTooltip(this.labelService.getUriLabel(uri, { relative: true }));
	}

	setStatus(icon: ThemeIcon | undefined, label: string): void {
		this.statusIconEl.classList.remove(...this._statusIconClasses);
		this._statusIconClasses = icon ? ThemeIcon.asClassNameArray(getCompactCodicon(icon)) : [];
		if (this._statusIconClasses.length > 0) {
			this.statusIconEl.classList.add(...this._statusIconClasses);
		}
		this.statusLabelEl.textContent = label;
	}

	setLabelDetail(text: string): void {
		this.labelDetailEl.textContent = text;
	}

	setProgressFill(percent: number | undefined): void {
		if (typeof percent === 'number') {
			this.progressFillEl.style.width = `${percent}%`;
			this.pillElement.classList.add('progress-filling');
		} else {
			this.progressFillEl.style.width = '0%';
			this.pillElement.classList.remove('progress-filling');
		}
	}

	setDiff(diff: { added: number; removed: number } | undefined): void {
		if (!diff) {
			this._labelAddedEl?.remove();
			this._labelRemovedEl?.remove();
			this._labelAddedEl = undefined;
			this._labelRemovedEl = undefined;
			return;
		}
		if (!this._labelAddedEl) {
			this._labelAddedEl = this.pillElement.appendChild($('span.label-added'));
		}
		if (!this._labelRemovedEl) {
			this._labelRemovedEl = this.pillElement.appendChild($('span.label-removed'));
		}
		this._labelAddedEl.textContent = `+${diff.added}`;
		this._labelRemovedEl.textContent = `-${diff.removed}`;
	}

	setAriaLabel(label: string): void {
		this.element.ariaLabel = label;
	}

	setTooltip(tooltip: string): void {
		this._tooltip = tooltip;
		if (!this._hover.value) {
			this._hover.value = this.hoverService.setupDelayedHover(this.pillElement, () => ({
				content: this._tooltip!,
				style: HoverStyle.Pointer,
				position: { hoverPosition: HoverPosition.BELOW },
				persistence: { hideOnKeyDown: true },
			}));
		}
	}
}

export async function isResourceContentEmpty(textModelService: ITextModelService, uri: URI): Promise<boolean> {
	try {
		const ref = await textModelService.createModelReference(uri);
		try {
			return ref.object.textEditorModel.getValueLength() === 0;
		} finally {
			ref.dispose();
		}
	} catch {
		return false;
	}
}
