/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/statusbarpart.css';
import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore, disposeIfDisposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { MultiWindowParts, Part } from '../../part.js';
import { EventType as TouchEventType, Gesture, GestureEvent } from '../../../../base/browser/touch.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarStyleOverride, isStatusbarEntryLocation, IStatusbarEntryLocation, isStatusbarEntryPriority, IStatusbarEntryPriority } from '../../../services/statusbar/browser/statusbar.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IAction, Separator, toAction } from '../../../../base/common/actions.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { STATUS_BAR_BACKGROUND, STATUS_BAR_FOREGROUND, STATUS_BAR_NO_FOLDER_BACKGROUND, STATUS_BAR_ITEM_HOVER_BACKGROUND, STATUS_BAR_BORDER, STATUS_BAR_NO_FOLDER_FOREGROUND, STATUS_BAR_NO_FOLDER_BORDER, STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND, STATUS_BAR_ITEM_FOCUS_BORDER, STATUS_BAR_FOCUS_BORDER } from '../../../common/theme.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { contrastBorder, activeContrastBorder } from '../../../../platform/theme/common/colorRegistry.js';
import { EventHelper, addDisposableListener, EventType, clearNode, getWindow, isHTMLElement, $ } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Parts, IWorkbenchLayoutService, LayoutSettings } from '../../../services/layout/browser/layoutService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { equals } from '../../../../base/common/arrays.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { ToggleStatusbarVisibilityAction } from '../../actions/layoutActions.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { isHighContrast } from '../../../../platform/theme/common/theme.js';
import { hash } from '../../../../base/common/hash.js';
import { WorkbenchHoverDelegate } from '../../../../platform/hover/browser/hover.js';
import { HideStatusbarEntryAction, ManageExtensionAction, ToggleStatusbarEntryVisibilityAction } from './statusbarActions.js';
import { IStatusbarViewModelEntry, StatusbarViewModel } from './statusbarModel.js';
import { StatusbarEntryItem } from './statusbarItem.js';
import { StatusBarFocused } from '../../../common/contextkeys.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IView } from '../../../../base/browser/ui/grid/grid.js';
import { isManagedHoverTooltipHTMLElement, isManagedHoverTooltipMarkdownString } from '../../../../base/browser/ui/hover/hover.js';

export interface IStatusbarEntryContainer extends IDisposable {

	readonly onDidChangeEntryVisibility: Event<{ id: string; visible: boolean }>;

	addEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priority?: number | IStatusbarEntryPriority): IStatusbarEntryAccessor;
	addEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priority?: number | IStatusbarEntryPriority | IStatusbarEntryLocation): IStatusbarEntryAccessor;

	addEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, location?: IStatusbarEntryLocation): IStatusbarEntryAccessor;

	isEntryVisible(id: string): boolean;

	updateEntryVisibility(id: string, visible: boolean): void;

	overrideEntry(id: string, override: Partial<IStatusbarEntry>): IDisposable;

	focus(preserveEntryFocus?: boolean): void;

	focusNextEntry(): void;

	focusPreviousEntry(): void;

	isEntryFocused(): boolean;

	overrideStyle(style: IStatusbarStyleOverride): IDisposable;
}

interface IPendingStatusbarEntry {
	readonly id: string;
	readonly alignment: StatusbarAlignment;
	readonly priority: IStatusbarEntryPriority;

	entry: IStatusbarEntry;
	accessor?: IStatusbarEntryAccessor;
}

class StatusbarPart extends Part implements IStatusbarEntryContainer {

	static readonly HEIGHT = 22;

	static readonly FLOATING_BOTTOM_PADDING = 10;


	private get floatingBottomPadding(): number {
		return this.getId() === Parts.STATUSBAR_PART && this.layoutService.isFloatingPanelsEnabled() ? StatusbarPart.FLOATING_BOTTOM_PADDING : 0;
	}

	readonly minimumWidth: number = 0;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	get minimumHeight(): number { return StatusbarPart.HEIGHT + this.floatingBottomPadding; }
	get maximumHeight(): number { return StatusbarPart.HEIGHT + this.floatingBottomPadding; }


	private styleElement: HTMLStyleElement | undefined;

	private pendingEntries: IPendingStatusbarEntry[] = [];

	private readonly viewModel: StatusbarViewModel;

	readonly onDidChangeEntryVisibility: Event<{ id: string; visible: boolean }>;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	private readonly onDidOverrideEntry = this._register(new Emitter<string>());
	private readonly entryOverrides = new Map<string, Partial<IStatusbarEntry>>();

	private leftItemsContainer: HTMLElement | undefined;
	private rightItemsContainer: HTMLElement | undefined;

	private readonly hoverDelegate: WorkbenchHoverDelegate;

	private readonly compactEntriesDisposable = this._register(new MutableDisposable<DisposableStore>());
	private readonly styleOverrides = new Set<IStatusbarStyleOverride>();

	constructor(
		id: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super(id, { hasTitle: false }, themeService, storageService, layoutService);

		this.viewModel = this._register(new StatusbarViewModel(storageService));
		this.onDidChangeEntryVisibility = this.viewModel.onDidChangeEntryVisibility;

		this.hoverDelegate = this._register(this.instantiationService.createInstance(WorkbenchHoverDelegate, 'element', {
			instantHover: true,
			dynamicDelay(content) {
				if (
					typeof content === 'function' ||
					isHTMLElement(content) ||
					(isManagedHoverTooltipMarkdownString(content) && typeof content.markdown === 'function') ||
					isManagedHoverTooltipHTMLElement(content)
				) {
					return 500;
				}

				return undefined;
			}
		}, (_, focus?: boolean) => (
			{
				persistence: {
					hideOnKeyDown: true,
					sticky: focus
				},
				appearance: {
					maxHeightRatio: 0.9
				}
			}
		)));

		this.registerListeners();
	}

	private registerListeners(): void {

		this._register(this.onDidChangeEntryVisibility(() => this.updateCompactEntries()));

		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateStyles()));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (this.getId() === Parts.STATUSBAR_PART && e.affectsConfiguration(LayoutSettings.MODERN_UI)) {
				this._onDidChange.fire(undefined);
				this.updateStyles();
			}
		}));
	}

	overrideEntry(id: string, override: Partial<IStatusbarEntry>): IDisposable {
		this.entryOverrides.set(id, override);
		this.onDidOverrideEntry.fire(id);

		return toDisposable(() => {
			const currentOverride = this.entryOverrides.get(id);
			if (currentOverride === override) {
				this.entryOverrides.delete(id);
				this.onDidOverrideEntry.fire(id);
			}
		});
	}

	private withEntryOverride(entry: IStatusbarEntry, id: string): IStatusbarEntry {
		const override = this.entryOverrides.get(id);
		if (override) {
			entry = { ...entry, ...override };
		}

		return entry;
	}

	addEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priorityOrLocation: number | IStatusbarEntryLocation | IStatusbarEntryPriority = 0): IStatusbarEntryAccessor {
		let priority: IStatusbarEntryPriority;
		if (isStatusbarEntryPriority(priorityOrLocation)) {
			priority = priorityOrLocation;
		} else {
			priority = {
				primary: priorityOrLocation,
				secondary: hash(id)
			};
		}

		if (!this.element) {
			return this.doAddPendingEntry(entry, id, alignment, priority);
		}

		return this.doAddEntry(entry, id, alignment, priority);
	}

	private doAddPendingEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priority: IStatusbarEntryPriority): IStatusbarEntryAccessor {
		const pendingEntry: IPendingStatusbarEntry = { entry, id, alignment, priority };
		this.pendingEntries.push(pendingEntry);

		const accessor: IStatusbarEntryAccessor = {
			update: (entry: IStatusbarEntry) => {
				if (pendingEntry.accessor) {
					pendingEntry.accessor.update(entry);
				} else {
					pendingEntry.entry = entry;
				}
			},

			dispose: () => {
				if (pendingEntry.accessor) {
					pendingEntry.accessor.dispose();
				} else {
					this.pendingEntries = this.pendingEntries.filter(entry => entry !== pendingEntry);
				}
			}
		};

		return accessor;
	}

	private doAddEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priority: IStatusbarEntryPriority): IStatusbarEntryAccessor {
		const disposables = new DisposableStore();

		const itemContainer = this.doCreateStatusItem(id, alignment);
		const item = disposables.add(this.instantiationService.createInstance(StatusbarEntryItem, itemContainer, this.withEntryOverride(entry, id), this.hoverDelegate));

		const viewModelEntry: IStatusbarViewModelEntry = new class implements IStatusbarViewModelEntry {
			readonly id = id;
			readonly extensionId = entry.extensionId;
			readonly alignment = alignment;
			readonly priority = priority;
			readonly container = itemContainer;
			readonly labelContainer = item.labelContainer;

			get name() { return item.name; }
			get hasCommand() { return item.hasCommand; }
		};

		const { needsFullRefresh } = this.doAddOrRemoveModelEntry(viewModelEntry, true);
		if (needsFullRefresh) {
			this.appendStatusbarEntries();
		} else {
			this.appendStatusbarEntry(viewModelEntry);
		}

		let lastEntry = entry;
		const accessor: IStatusbarEntryAccessor = {
			update: entry => {
				lastEntry = entry;
				const hadBackgroundColor = itemContainer.classList.contains('has-background-color');
				item.update(this.withEntryOverride(entry, id));
				if (hadBackgroundColor !== itemContainer.classList.contains('has-background-color')) {
					this.updateVisibleBackgroundColorNeighbors();
				}
			},
			dispose: () => {
				const { needsFullRefresh } = this.doAddOrRemoveModelEntry(viewModelEntry, false);
				if (needsFullRefresh) {
					this.appendStatusbarEntries();
				} else {
					itemContainer.remove();
					this.updateCompactEntries();
				}
				disposables.dispose();
			}
		};

		disposables.add(this.onDidOverrideEntry.event(overrideEntryId => {
			if (overrideEntryId === id) {
				accessor.update(lastEntry);
			}
		}));

		return accessor;
	}

	private doCreateStatusItem(id: string, alignment: StatusbarAlignment, ...extraClasses: string[]): HTMLElement {
		const itemContainer = $('.statusbar-item', { id });

		if (extraClasses) {
			itemContainer.classList.add(...extraClasses);
		}

		if (alignment === StatusbarAlignment.RIGHT) {
			itemContainer.classList.add('right');
		} else {
			itemContainer.classList.add('left');
		}

		return itemContainer;
	}

	private doAddOrRemoveModelEntry(entry: IStatusbarViewModelEntry, add: boolean) {

		const entriesBefore = this.viewModel.entries;
		if (add) {
			this.viewModel.add(entry);
		} else {
			this.viewModel.remove(entry);
		}
		const entriesAfter = this.viewModel.entries;

		if (add) {
			entriesBefore.splice(entriesAfter.indexOf(entry), 0, entry);
		} else {
			entriesBefore.splice(entriesBefore.indexOf(entry), 1);
		}

		const needsFullRefresh = !equals(entriesBefore, entriesAfter);

		return { needsFullRefresh };
	}

	isEntryVisible(id: string): boolean {
		return !this.viewModel.isHidden(id);
	}

	updateEntryVisibility(id: string, visible: boolean): void {
		if (visible) {
			this.viewModel.show(id);
		} else {
			this.viewModel.hide(id);
		}
	}

	focusNextEntry(): void {
		this.viewModel.focusNextEntry();
	}

	focusPreviousEntry(): void {
		this.viewModel.focusPreviousEntry();
	}

	isEntryFocused(): boolean {
		return this.viewModel.isEntryFocused();
	}

	focus(preserveEntryFocus = true): void {
		this.getContainer()?.focus();
		const lastFocusedEntry = this.viewModel.lastFocusedEntry;
		if (preserveEntryFocus && lastFocusedEntry) {
			setTimeout(() => lastFocusedEntry.labelContainer.focus(), 0);
		}
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;

		const scopedContextKeyService = this._register(this.contextKeyService.createScoped(this.element));
		StatusBarFocused.bindTo(scopedContextKeyService).set(true);

		this.leftItemsContainer = $('.left-items.items-container');
		this.element.appendChild(this.leftItemsContainer);
		this.element.tabIndex = 0;

		this.rightItemsContainer = $('.right-items.items-container');
		this.element.appendChild(this.rightItemsContainer);

		this._register(addDisposableListener(parent, EventType.CONTEXT_MENU, e => this.showContextMenu(e)));
		this._register(Gesture.addTarget(parent));
		this._register(addDisposableListener(parent, TouchEventType.Contextmenu, e => this.showContextMenu(e)));

		this.createInitialStatusbarEntries();

		return this.element;
	}

	private createInitialStatusbarEntries(): void {

		this.appendStatusbarEntries();

		while (this.pendingEntries.length) {
			const pending = this.pendingEntries.shift();
			if (pending) {
				pending.accessor = this.addEntry(pending.entry, pending.id, pending.alignment, pending.priority.primary);
			}
		}
	}

	private appendStatusbarEntries(): void {
		const leftItemsContainer = assertReturnsDefined(this.leftItemsContainer);
		const rightItemsContainer = assertReturnsDefined(this.rightItemsContainer);

		clearNode(leftItemsContainer);
		clearNode(rightItemsContainer);

		for (const entry of [
			...this.viewModel.getEntries(StatusbarAlignment.LEFT),
			...this.viewModel.getEntries(StatusbarAlignment.RIGHT).reverse()
		]) {
			const target = entry.alignment === StatusbarAlignment.LEFT ? leftItemsContainer : rightItemsContainer;

			target.appendChild(entry.container);
		}

		this.updateCompactEntries();
	}

	private appendStatusbarEntry(entry: IStatusbarViewModelEntry): void {
		const entries = this.viewModel.getEntries(entry.alignment);

		if (entry.alignment === StatusbarAlignment.RIGHT) {
			entries.reverse();
		}

		const target = assertReturnsDefined(entry.alignment === StatusbarAlignment.LEFT ? this.leftItemsContainer : this.rightItemsContainer);

		const index = entries.indexOf(entry);
		if (index + 1 === entries.length) {
			target.appendChild(entry.container);
		} else {
			target.insertBefore(entry.container, entries[index + 1].container);
		}

		this.updateCompactEntries();
	}

	private updateCompactEntries(): void {
		const entries = this.viewModel.entries;

		const mapIdToVisibleEntry = new Map<string, IStatusbarViewModelEntry>();
		for (const entry of entries) {
			if (!this.viewModel.isHidden(entry.id)) {
				mapIdToVisibleEntry.set(entry.id, entry);
			}

			entry.container.classList.remove('compact-left', 'compact-right');
		}

		const compactEntryGroups = new Map<string, Map<string, IStatusbarViewModelEntry>>();
		for (const entry of mapIdToVisibleEntry.values()) {
			if (
				isStatusbarEntryLocation(entry.priority.primary) &&
				entry.priority.primary.compact
			) {
				const locationId = entry.priority.primary.location.id;
				const location = mapIdToVisibleEntry.get(locationId);
				if (!location) {
					continue;
				}

				let compactEntryGroup = compactEntryGroups.get(locationId);
				if (!compactEntryGroup) {


					for (const group of compactEntryGroups.values()) {
						if (group.has(locationId)) {
							compactEntryGroup = group;
							break;
						}
					}

					if (!compactEntryGroup) {
						compactEntryGroup = new Map<string, IStatusbarViewModelEntry>();
						compactEntryGroups.set(locationId, compactEntryGroup);
					}
				}
				compactEntryGroup.set(entry.id, entry);
				compactEntryGroup.set(location.id, location);

				if (entry.priority.primary.alignment === StatusbarAlignment.LEFT) {
					location.container.classList.add('compact-left');
					entry.container.classList.add('compact-right');
				} else {
					location.container.classList.add('compact-right');
					entry.container.classList.add('compact-left');
				}
			}
		}

		const statusBarItemHoverBackground = this.getColor(STATUS_BAR_ITEM_HOVER_BACKGROUND);
		const statusBarItemCompactHoverBackground = this.getColor(STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND);
		this.compactEntriesDisposable.value = new DisposableStore();
		if (statusBarItemHoverBackground && statusBarItemCompactHoverBackground && !isHighContrast(this.theme.type)) {
			for (const [, compactEntryGroup] of compactEntryGroups) {
				for (const compactEntry of compactEntryGroup.values()) {
					if (!compactEntry.hasCommand) {
						continue;
					}

					this.compactEntriesDisposable.value.add(addDisposableListener(compactEntry.labelContainer, EventType.MOUSE_OVER, () => {
						compactEntryGroup.forEach(compactEntry => compactEntry.labelContainer.style.backgroundColor = statusBarItemHoverBackground);
						compactEntry.labelContainer.style.backgroundColor = statusBarItemCompactHoverBackground;
					}));

					this.compactEntriesDisposable.value.add(addDisposableListener(compactEntry.labelContainer, EventType.MOUSE_OUT, () => {
						compactEntryGroup.forEach(compactEntry => compactEntry.labelContainer.style.backgroundColor = '');
					}));
				}
			}
		}

		this.updateVisibleBackgroundColorNeighbors();
	}

	private updateVisibleBackgroundColorNeighbors(): void {
		this.doUpdateVisibleBackgroundColorNeighbors(this.viewModel.getEntries(StatusbarAlignment.LEFT), StatusbarAlignment.LEFT);
		this.doUpdateVisibleBackgroundColorNeighbors(this.viewModel.getEntries(StatusbarAlignment.RIGHT).reverse(), StatusbarAlignment.RIGHT);
	}

	private doUpdateVisibleBackgroundColorNeighbors(entries: IStatusbarViewModelEntry[], alignment: StatusbarAlignment): void {
		let previousVisibleEntry: IStatusbarViewModelEntry | undefined;

		for (const entry of entries) {
			entry.container.classList.remove('visible-background-color-neighbor');

			if (this.viewModel.isHidden(entry.id)) {
				continue;
			}

			const isCompactNeighbor = alignment === StatusbarAlignment.LEFT
				? previousVisibleEntry?.container.classList.contains('compact-right') && entry.container.classList.contains('compact-left')
				: previousVisibleEntry?.container.classList.contains('compact-left') && entry.container.classList.contains('compact-right');
			if (
				previousVisibleEntry?.container.classList.contains('has-background-color') &&
				entry.container.classList.contains('has-background-color') &&
				!isCompactNeighbor
			) {
				entry.container.classList.add('visible-background-color-neighbor');
			}

			previousVisibleEntry = entry;
		}
	}

	private showContextMenu(e: MouseEvent | GestureEvent): void {
		EventHelper.stop(e, true);

		const event = new StandardMouseEvent(getWindow(this.element), e);

		let actions: IAction[] | undefined = undefined;
		this.contextMenuService.showContextMenu({
			getAnchor: () => event,
			getActions: () => {
				actions = this.getContextMenuActions(event);

				return actions;
			},
			onHide: () => {
				if (actions) {
					disposeIfDisposable(actions);
				}
			}
		});
	}

	private getContextMenuActions(event: StandardMouseEvent): IAction[] {
		const actions: IAction[] = [];

		actions.push(toAction({ id: ToggleStatusbarVisibilityAction.ID, label: localize('hideStatusBar', "Hide Status Bar"), run: () => this.instantiationService.invokeFunction(accessor => new ToggleStatusbarVisibilityAction().run(accessor)) }));
		actions.push(new Separator());

		const handledEntries = new Set<string>();
		for (const entry of this.viewModel.entries) {
			if (!handledEntries.has(entry.id)) {
				actions.push(new ToggleStatusbarEntryVisibilityAction(entry.id, entry.name, this.viewModel));
				handledEntries.add(entry.id);
			}
		}

		let statusEntryUnderMouse: IStatusbarViewModelEntry | undefined = undefined;
		for (let element: HTMLElement | null = event.target; element; element = element.parentElement) {
			const entry = this.viewModel.findEntry(element);
			if (entry) {
				statusEntryUnderMouse = entry;
				break;
			}
		}

		if (statusEntryUnderMouse) {
			actions.push(new Separator());
			if (statusEntryUnderMouse.extensionId) {
				actions.push(this.instantiationService.createInstance(ManageExtensionAction, statusEntryUnderMouse.extensionId));
			}
			actions.push(new HideStatusbarEntryAction(statusEntryUnderMouse.id, statusEntryUnderMouse.name, this.viewModel));
		}

		return actions;
	}

	override updateStyles(): void {
		super.updateStyles();

		const container = assertReturnsDefined(this.getContainer());
		const styleOverride: IStatusbarStyleOverride | undefined = [...this.styleOverrides].sort((a, b) => a.priority - b.priority)[0];

		const backgroundColor = this.getColor(styleOverride?.background ?? (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_BACKGROUND : STATUS_BAR_NO_FOLDER_BACKGROUND)) || '';
		container.style.backgroundColor = backgroundColor;
		container.style.boxShadow = this.getId() === Parts.STATUSBAR_PART && this.layoutService.isFloatingPanelsEnabled() && !isHighContrast(this.theme.type) && backgroundColor
			? `0 1px 0 ${backgroundColor}`
			: '';
		const foregroundColor = this.getColor(styleOverride?.foreground ?? (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_FOREGROUND : STATUS_BAR_NO_FOLDER_FOREGROUND)) || '';
		container.style.color = foregroundColor;
		const itemBorderColor = this.getColor(STATUS_BAR_ITEM_FOCUS_BORDER);

		this.updateCompactEntries();

		const borderColor = this.getColor(styleOverride?.border ?? (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_BORDER : STATUS_BAR_NO_FOLDER_BORDER)) || this.getColor(contrastBorder);
		if (borderColor) {
			container.classList.add('status-border-top');
			container.style.setProperty('--status-border-top-color', borderColor);
		} else {
			container.classList.remove('status-border-top');
			container.style.removeProperty('--status-border-top-color');
		}


		const statusBarFocusColor = this.getColor(STATUS_BAR_FOCUS_BORDER);

		if (!this.styleElement) {
			this.styleElement = createStyleSheet(container, undefined, this._store);
		}

		this.styleElement.textContent = `

				/* Status bar focus outline */
				.monaco-workbench .part.statusbar:focus {
					outline-color: ${statusBarFocusColor};
				}

				/* Status bar item focus outline */
				.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:focus-visible {
					outline: 1px solid ${this.getColor(activeContrastBorder) ?? itemBorderColor};
					outline-offset: ${borderColor ? '-2px' : '-1px'};
				}

				/* Notification Beak */
				.monaco-workbench .part.statusbar > .items-container > .statusbar-item.has-beak > .status-bar-item-beak-container:before {
					border-bottom-color: ${borderColor ?? backgroundColor};
				}
			`;
	}

	override layout(width: number, height: number, top: number, left: number): void {
		super.layout(width, height, top, left);
		super.layoutContents(width, height);
	}

	overrideStyle(style: IStatusbarStyleOverride): IDisposable {
		this.styleOverrides.add(style);
		this.updateStyles();

		return toDisposable(() => {
			this.styleOverrides.delete(style);
			this.updateStyles();
		});
	}

	toJSON(): object {
		return {
			type: Parts.STATUSBAR_PART
		};
	}

	override dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}

export class MainStatusbarPart extends StatusbarPart {

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(Parts.STATUSBAR_PART, instantiationService, themeService, contextService, storageService, layoutService, contextMenuService, contextKeyService, configurationService);
	}
}

export interface IAuxiliaryStatusbarPart extends IStatusbarEntryContainer, IView {
	readonly container: HTMLElement;
	readonly height: number;
}

export class AuxiliaryStatusbarPart extends StatusbarPart implements IAuxiliaryStatusbarPart {

	private static COUNTER = 1;

	readonly height = StatusbarPart.HEIGHT;

	constructor(
		readonly container: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		const id = AuxiliaryStatusbarPart.COUNTER++;
		super(`workbench.parts.auxiliaryStatus.${id}`, instantiationService, themeService, contextService, storageService, layoutService, contextMenuService, contextKeyService, configurationService);
	}
}

export class StatusbarService extends MultiWindowParts<StatusbarPart> implements IStatusbarService {

	declare readonly _serviceBrand: undefined;

	readonly mainPart: MainStatusbarPart;

	private readonly _onDidCreateAuxiliaryStatusbarPart = this._register(new Emitter<AuxiliaryStatusbarPart>());
	private readonly onDidCreateAuxiliaryStatusbarPart = this._onDidCreateAuxiliaryStatusbarPart.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService
	) {
		super('workbench.statusBarService', themeService, storageService);

		this.mainPart = this._register(this.instantiationService.createInstance(MainStatusbarPart));
		this._register(this.registerPart(this.mainPart));

		this.onDidChangeEntryVisibility = this.mainPart.onDidChangeEntryVisibility;
	}


	createAuxiliaryStatusbarPart(container: HTMLElement, instantiationService: IInstantiationService): IAuxiliaryStatusbarPart {

		const statusbarPartContainer = $('footer.part.statusbar', {
			'role': 'status',
			'aria-live': 'off',
			'tabIndex': '0'
		});
		statusbarPartContainer.style.position = 'relative';
		container.appendChild(statusbarPartContainer);

		const statusbarPart = instantiationService.createInstance(AuxiliaryStatusbarPart, statusbarPartContainer);
		const disposable = this.registerPart(statusbarPart);

		statusbarPart.create(statusbarPartContainer);

		Event.once(statusbarPart.onWillDispose)(() => disposable.dispose());

		this._onDidCreateAuxiliaryStatusbarPart.fire(statusbarPart);

		return statusbarPart;
	}

	createScoped(statusbarEntryContainer: IStatusbarEntryContainer, disposables: DisposableStore): IStatusbarService {
		return disposables.add(this.instantiationService.createInstance(ScopedStatusbarService, statusbarEntryContainer));
	}



	readonly onDidChangeEntryVisibility: Event<{ id: string; visible: boolean }>;

	addEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priorityOrLocation: number | IStatusbarEntryLocation | IStatusbarEntryPriority = 0): IStatusbarEntryAccessor {
		if (entry.showInAllWindows) {
			return this.doAddEntryToAllWindows(entry, id, alignment, priorityOrLocation);
		}

		return this.mainPart.addEntry(entry, id, alignment, priorityOrLocation);
	}

	private doAddEntryToAllWindows(originalEntry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priorityOrLocation: number | IStatusbarEntryLocation | IStatusbarEntryPriority = 0): IStatusbarEntryAccessor {
		const entryDisposables = new DisposableStore();

		const accessors = new Set<IStatusbarEntryAccessor>();

		let entry = originalEntry;
		function addEntry(part: StatusbarPart | AuxiliaryStatusbarPart): void {
			const partDisposables = new DisposableStore();
			partDisposables.add(part.onWillDispose(() => partDisposables.dispose()));

			const accessor = partDisposables.add(part.addEntry(entry, id, alignment, priorityOrLocation));
			accessors.add(accessor);
			partDisposables.add(toDisposable(() => accessors.delete(accessor)));

			entryDisposables.add(partDisposables);
			partDisposables.add(toDisposable(() => entryDisposables.delete(partDisposables)));
		}

		for (const part of this.parts) {
			addEntry(part);
		}

		entryDisposables.add(this.onDidCreateAuxiliaryStatusbarPart(part => addEntry(part)));

		return {
			update: (updatedEntry: IStatusbarEntry) => {
				entry = updatedEntry;

				for (const update of accessors) {
					update.update(updatedEntry);
				}
			},
			dispose: () => entryDisposables.dispose()
		};
	}

	isEntryVisible(id: string): boolean {
		return this.mainPart.isEntryVisible(id);
	}

	updateEntryVisibility(id: string, visible: boolean): void {
		for (const part of this.parts) {
			part.updateEntryVisibility(id, visible);
		}
	}

	overrideEntry(id: string, override: Partial<IStatusbarEntry>): IDisposable {
		const disposables = new DisposableStore();

		for (const part of this.parts) {
			disposables.add(part.overrideEntry(id, override));
		}

		return disposables;
	}

	focus(preserveEntryFocus?: boolean): void {
		this.activePart.focus(preserveEntryFocus);
	}

	focusNextEntry(): void {
		this.activePart.focusNextEntry();
	}

	focusPreviousEntry(): void {
		this.activePart.focusPreviousEntry();
	}

	isEntryFocused(): boolean {
		return this.activePart.isEntryFocused();
	}

	overrideStyle(style: IStatusbarStyleOverride): IDisposable {
		const disposables = new DisposableStore();

		for (const part of this.parts) {
			disposables.add(part.overrideStyle(style));
		}

		return disposables;
	}

}

export class ScopedStatusbarService extends Disposable implements IStatusbarService {

	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly statusbarEntryContainer: IStatusbarEntryContainer,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();

		this.onDidChangeEntryVisibility = this.statusbarEntryContainer.onDidChangeEntryVisibility;
	}

	createAuxiliaryStatusbarPart(container: HTMLElement, instantiationService: IInstantiationService): IAuxiliaryStatusbarPart {
		return this.statusbarService.createAuxiliaryStatusbarPart(container, instantiationService);
	}

	createScoped(statusbarEntryContainer: IStatusbarEntryContainer, disposables: DisposableStore): IStatusbarService {
		return this.statusbarService.createScoped(statusbarEntryContainer, disposables);
	}

	getPart(): IStatusbarEntryContainer {
		return this.statusbarEntryContainer;
	}

	readonly onDidChangeEntryVisibility: Event<{ id: string; visible: boolean }>;

	addEntry(entry: IStatusbarEntry, id: string, alignment: StatusbarAlignment, priorityOrLocation: number | IStatusbarEntryLocation | IStatusbarEntryPriority = 0): IStatusbarEntryAccessor {
		return this.statusbarEntryContainer.addEntry(entry, id, alignment, priorityOrLocation);
	}

	isEntryVisible(id: string): boolean {
		return this.statusbarEntryContainer.isEntryVisible(id);
	}

	updateEntryVisibility(id: string, visible: boolean): void {
		this.statusbarEntryContainer.updateEntryVisibility(id, visible);
	}

	overrideEntry(id: string, override: Partial<IStatusbarEntry>): IDisposable {
		return this.statusbarEntryContainer.overrideEntry(id, override);
	}

	focus(preserveEntryFocus?: boolean): void {
		this.statusbarEntryContainer.focus(preserveEntryFocus);
	}

	focusNextEntry(): void {
		this.statusbarEntryContainer.focusNextEntry();
	}

	focusPreviousEntry(): void {
		this.statusbarEntryContainer.focusPreviousEntry();
	}

	isEntryFocused(): boolean {
		return this.statusbarEntryContainer.isEntryFocused();
	}

	overrideStyle(style: IStatusbarStyleOverride): IDisposable {
		return this.statusbarEntryContainer.overrideStyle(style);
	}
}

registerSingleton(IStatusbarService, StatusbarService, InstantiationType.Eager);
