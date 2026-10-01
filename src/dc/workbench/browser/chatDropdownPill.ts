import { $ } from '../../base/browser/dom.js';
import { IActionViewItemOptions } from '../../base/browser/ui/actionbar/actionViewItems.js';
import type { IManagedHoverContent, IManagedHoverOptions } from '../../base/browser/ui/hover/hover.js';
import { IAction } from '../../base/common/actions.js';
import { Codicon } from '../../base/common/codicons.js';
import { onUnexpectedError } from '../../base/common/errors.js';
import { IObservable, autorun, derived } from '../../base/common/observable.js';
import { ThemeIcon } from '../../base/common/themables.js';
import { asCssVariable } from '../../platform/theme/common/colorUtils.js';
import { ActionListItemKind, IActionListDelegate, IActionListItem } from '../../platform/actionWidget/browser/actionList.js';
import { IActionWidgetService } from '../../platform/actionWidget/browser/actionWidget.js';
import { getIconClasses } from '../../editor/common/services/getIconClasses.js';
import { ILanguageService } from '../../editor/common/languages/language.js';
import { IModelService } from '../../editor/common/services/model.js';
import { FileKind } from '../../platform/files/common/files.js';
import { ChatPillActionViewItem, getChatPillEntries, type IChatPill, type IChatPillEntry, type IChatPillSection } from './chatPills.js';
import { ChatResourcePillActionViewItem } from './chatResourcePill.js';
import type { ResourceLabels } from './labels.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';

export const enum ChatPillSingleEntry {
	Inline = 'inline',
	InlineResource = 'inlineResource',
	Summary = 'summary',
}

export interface IChatDropdownPillOptions {
	readonly widgetId: string;
	readonly icon: ThemeIcon | IObservable<ThemeIcon>;
	readonly title: string;
	readonly summaryLabel: (count: number) => string;
	readonly summaryAriaLabel: (count: number) => string;
	readonly singleEntry?: ChatPillSingleEntry;
}

function getInlineEntry(entries: readonly IChatPillEntry[], options: IChatDropdownPillOptions): IChatPillEntry | undefined {
	if (entries.length !== 1) {
		return undefined;
	}
	const entry = entries[0];
	switch (options.singleEntry ?? ChatPillSingleEntry.Inline) {
		case ChatPillSingleEntry.Inline: return entry;
		case ChatPillSingleEntry.InlineResource: return entry.resource ? entry : undefined;
		case ChatPillSingleEntry.Summary: return undefined;
	}
}

export class ChatDropdownPillActionViewItem extends ChatPillActionViewItem {

	protected override get itemModifierClass(): string { return 'chat-dropdown-pill'; }
	protected override get buttonModifierClass(): string { return 'chat-dropdown-pill-button'; }

	constructor(
		action: IAction,
		options: IActionViewItemOptions,
		private readonly _sections: IObservable<readonly IChatPillSection[]>,
		private readonly _pillOptions: IChatDropdownPillOptions,
		@IActionWidgetService private readonly _actionWidgetService: IActionWidgetService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IModelService private readonly _modelService: IModelService,
	) {
		super(undefined, action, options);
	}

	private _dropdownVisible = false;
	private _entries: readonly IChatPillEntry[] = [];
	private _summaryIcon: ThemeIcon | undefined;

	protected override renderContent(): void {
		this._register(autorun(reader => {
			const previous = this._getPresentation();
			this._entries = getChatPillEntries(this._sections.read(reader));
			this._summaryIcon = ThemeIcon.isThemeIcon(this._pillOptions.icon) ? this._pillOptions.icon : this._pillOptions.icon.read(reader);
			const current = this._getPresentation();
			if (previous.label !== current.label || previous.summarized !== current.summarized || !iconsEqual(previous.icon, current.icon)) {
				this.updateLabel();
			}
			if (previous.hoverContent !== current.hoverContent) {
				this.updateTooltip();
			}
			if (previous.ariaLabel !== current.ariaLabel) {
				this.updateAriaLabel();
			}
			if (previous.ariaDescription !== current.ariaDescription) {
				this._updateAriaDescription(current.ariaDescription);
			}
			if (previous.summarized !== current.summarized) {
				this._updatePopupState();
			}
			if (this._dropdownVisible) {
				if (current.summarized) {
					this._actionWidgetService.updateItems(this._getDropdownItems());
				} else {
					this._actionWidgetService.hide();
				}
			}
		}));
	}

	private _getPresentation(): { readonly summarized: boolean; readonly icon: ThemeIcon | undefined; readonly label: string; readonly hoverContent: IManagedHoverContent; readonly ariaLabel: string | undefined; readonly ariaDescription: string | undefined } {
		return {
			summarized: this.isSummarized,
			icon: this.isSummarized ? this._summaryIcon : this.entries.at(0)?.icon,
			label: this.getLabelText(),
			hoverContent: this.getHoverContents(),
			ariaLabel: this.getAriaLabel(),
			ariaDescription: this.isSummarized ? undefined : this.entries.at(0)?.ariaDescription,
		};
	}

	private _updatePopupState(): void {
		const element = this.button?.element;
		if (!element) {
			return;
		}
		if (this.isSummarized) {
			element.setAttribute('aria-haspopup', 'listbox');
			element.setAttribute('aria-expanded', String(this._dropdownVisible));
		} else {
			element.removeAttribute('aria-haspopup');
			element.removeAttribute('aria-expanded');
		}
	}

	private _updateAriaDescription(description: string | undefined): void {
		const element = this.button?.element;
		if (!element) {
			return;
		}
		if (description) {
			element.setAttribute('aria-description', description);
		} else {
			element.removeAttribute('aria-description');
		}
	}

	protected get isSummarized(): boolean {
		const entries = this.entries;
		return entries.length > 0 && !getInlineEntry(entries, this._pillOptions);
	}

	protected get entries(): readonly IChatPillEntry[] {
		return this._entries;
	}

	protected override getIconElement(): HTMLElement | undefined {
		const icon = this.isSummarized ? this._summaryIcon : this.entries.at(0)?.icon;
		return icon ? this.createIconElement(icon) : undefined;
	}

	protected createIconElement(icon: ThemeIcon): HTMLElement {
		const iconElement = $(`span.chat-pill-icon${ThemeIcon.asCSSSelector(icon)}`, { 'aria-hidden': 'true' });
		if (icon.color) {
			iconElement.style.setProperty('color', asCssVariable(icon.color.id), 'important');
		}
		return iconElement;
	}

	protected override getLabelText(): string {
		return this.isSummarized
			? this._pillOptions.summaryLabel(this.entries.length)
			: this.entries.at(0)?.pillLabel ?? this.entries.at(0)?.label ?? '';
	}

	protected override getAdditionalLabelContent(): Array<HTMLElement | string> {
		return this.isSummarized ? [$(`span.chat-pill-chevron${ThemeIcon.asCSSSelector(Codicon.chevronDownCompact)}`, { 'aria-hidden': 'true' })] : [];
	}

	protected override getTooltip(): string {
		if (this.isSummarized) {
			return this._pillOptions.summaryAriaLabel(this.entries.length);
		}
		const entry = this.entries.at(0);
		return entry?.tooltip ?? entry?.label ?? this._pillOptions.title;
	}

	protected override getHoverContents(): IManagedHoverContent {
		return this.isSummarized
			? super.getHoverContents()
			: this.entries.at(0)?.pillHover ?? super.getHoverContents();
	}

	protected override getAriaLabel(): string | undefined {
		return this.isSummarized
			? this._pillOptions.summaryAriaLabel(this.entries.length)
			: this.entries.at(0)?.ariaLabel ?? super.getAriaLabel();
	}

	protected override getHoverOptions(): IManagedHoverOptions | undefined {
		const toolbarActions = this.isSummarized ? undefined : this.entries.at(0)?.toolbarActions;
		return toolbarActions?.length ? {
			trapFocus: true,
			actions: toolbarActions.map(action => ({
				commandId: action.id,
				label: action.label,
				iconClass: action.class,
				run: () => { void action.run(); },
			})),
		} : undefined;
	}

	protected override onDidClickButton(): void {
		if (!this.isSummarized) {
			this.openEntry(this.entries.at(0));
			return;
		}
		this.showDropdown();
	}

	protected override hasOpenDropdown(): boolean {
		return this._dropdownVisible;
	}

	protected openEntry(entry: IChatPillEntry | undefined): void {
		try {
			entry?.open();
		} catch (error) {
			onUnexpectedError(error);
		}
	}

	protected showDropdown(): void {
		const sections = this._sections.get().filter(section => section.entries.length > 0);
		const trigger = this.button?.element;
		if (!trigger || this._actionWidgetService.isVisible || sections.length === 0) {
			return;
		}

		const items = this._getDropdownItems(sections);
		const delegate: IActionListDelegate<IChatPillEntry> = {
			onSelect: entry => {
				this._actionWidgetService.hide();
				this.openEntry(entry);
			},
			onHide: () => {
				this._dropdownVisible = false;
				this._updatePopupState();
				if (trigger.isConnected) {
					trigger.focus();
				}
			},
		};
		this._dropdownVisible = true;
		this._updatePopupState();
		this._actionWidgetService.show(
			this._pillOptions.widgetId,
			false,
			items,
			delegate,
			trigger,
			undefined,
			[],
			{
				getAriaLabel: item => item.label ?? '',
				getWidgetAriaLabel: () => this._pillOptions.title,
			},
			{ minWidth: 240, maxWidth: 460, widgetClassName: 'show-file-icons' },
		);
	}

	private _getDropdownItems(sections = this._sections.get().filter(section => section.entries.length > 0)): IActionListItem<IChatPillEntry>[] {
		const items: IActionListItem<IChatPillEntry>[] = [];
		for (const section of sections) {
			if (items.length > 0) {
				items.push({ kind: ActionListItemKind.Separator, label: '' });
			}
			items.push({ kind: ActionListItemKind.Header, label: section.title, group: { title: section.title } });
			for (const entry of section.entries) {
				items.push({
					kind: ActionListItemKind.Action,
					label: entry.label,
					group: { title: '', ...(entry.icon ? { icon: entry.icon } : {}) },
					...(entry.resource ? { iconClasses: getIconClasses(this._modelService, this._languageService, entry.resource, FileKind.FILE) } : {}),
					...(entry.toolbarActions?.length ? { toolbarActions: [...entry.toolbarActions] } : {}),
					ariaDescription: entry.ariaDescription,
					hover: entry.hover,
					item: entry,
				});
			}
		}
		return items;
	}

	override dispose(): void {
		if (this._dropdownVisible) {
			this._actionWidgetService.hide(true);
		}
		super.dispose();
	}
}

function iconsEqual(first: ThemeIcon | undefined, second: ThemeIcon | undefined): boolean {
	return first === second || (!!first && !!second && ThemeIcon.isEqual(first, second));
}

export function createChatSectionPill(
	action: IAction,
	sections: IObservable<readonly IChatPillSection[]>,
	options: IChatDropdownPillOptions,
	resourceLabels: ResourceLabels,
	instantiationService: IInstantiationService,
): IObservable<IChatPill> {
	const singleResourceEntry = derived<IChatPillEntry | undefined>(reader => {
		const entry = getInlineEntry(getChatPillEntries(sections.read(reader)), options);
		return entry?.resource ? entry : undefined;
	});
	const isResource = derived(reader => !!singleResourceEntry.read(reader));
	const resourcePill: IChatPill = {
		action,
		createActionViewItem: viewItemOptions => new ChatResourcePillActionViewItem(action, viewItemOptions, singleResourceEntry, resourceLabels),
	};
	const dropdownPill: IChatPill = {
		action,
		createActionViewItem: viewItemOptions => instantiationService.createInstance(ChatDropdownPillActionViewItem, action, viewItemOptions, sections, options),
	};

	return derived<IChatPill>(reader => isResource.read(reader)
		? resourcePill
		: dropdownPill);
}
