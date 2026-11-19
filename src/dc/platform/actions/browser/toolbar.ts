/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow } from '../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../base/browser/mouseEvent.js';
import { IToolBarOptions, ToggleMenuAction, ToolBar } from '../../../base/browser/ui/toolbar/toolbar.js';
import { IAction, Separator, SubmenuAction, toAction, WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '../../../base/common/actions.js';
import { coalesceInPlace } from '../../../base/common/arrays.js';
import { intersection } from '../../../base/common/collections.js';
import { BugIndicatingError } from '../../../base/common/errors.js';
import { Emitter } from '../../../base/common/event.js';
import { Iterable } from '../../../base/common/iterator.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { createActionViewItem, getActionBarActions } from './menuEntryActionViewItem.js';
import { IMenu, IMenuActionOptions, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../common/actions.js';
import { createConfigureKeybindingAction } from '../common/menuService.js';
import { ICommandService } from '../../commands/common/commands.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IContextMenuService } from '../../contextview/browser/contextView.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IActionViewItemService } from './actionViewItemService.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';

export const enum HiddenItemStrategy {
	NoHide = -1,
	Ignore = 0,
	RenderInSecondaryGroup = 1,
}

export type IWorkbenchToolBarOptions = IToolBarOptions & {

	hiddenItemStrategy?: HiddenItemStrategy;

	resetMenu?: MenuId;

	contextMenu?: MenuId;

	menuOptions?: IMenuActionOptions;

	telemetrySource?: string;

	allowContextMenu?: never;

	overflowBehavior?: { maxItems: number; exempted?: string[] };
};

export class WorkbenchToolBar extends ToolBar {

	private readonly _sessionDisposables = this._store.add(new DisposableStore());

	constructor(
		container: HTMLElement,
		private _options: IWorkbenchToolBarOptions | undefined,
		@IMenuService private readonly _menuService: IMenuService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ICommandService private readonly _commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(container, _contextMenuService, {
			getKeyBinding: (action) => _keybindingService.lookupKeybinding(action.id) ?? undefined,
			..._options,
			allowContextMenu: true,
			skipTelemetry: typeof _options?.telemetrySource === 'string',
		});

		const telemetrySource = _options?.telemetrySource;
		if (telemetrySource) {
			this._store.add(this.actionBar.onDidRun(e => telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>(
				'workbenchActionExecuted',
				{ id: e.action.id, from: telemetrySource })
			));
		}
	}

	override setActions(_primary: readonly IAction[], _secondary: readonly IAction[] = [], menuIds?: readonly MenuId[]): void {

		this._sessionDisposables.clear();
		const primary: Array<IAction | undefined> = _primary.slice();
		const secondary = _secondary.slice();
		const toggleActions: IAction[] = [];
		let toggleActionsCheckedCount: number = 0;

		const extraSecondary: Array<IAction | undefined> = [];

		let someAreHidden = false;
		if (this._options?.hiddenItemStrategy !== HiddenItemStrategy.NoHide) {
			for (let i = 0; i < primary.length; i++) {
				const action = primary[i];
				if (action instanceof Separator) {
					extraSecondary[i] = action;
					continue;
				}
				if (!(action instanceof MenuItemAction) && !(action instanceof SubmenuItemAction)) {
					continue;
				}
				if (!action.hideActions) {
					continue;
				}

				toggleActions.push(action.hideActions.toggle);
				if (action.hideActions.toggle.checked) {
					toggleActionsCheckedCount++;
				}

				if (action.hideActions.isHidden) {
					someAreHidden = true;
					primary[i] = undefined;
					if (this._options?.hiddenItemStrategy !== HiddenItemStrategy.Ignore) {
						extraSecondary[i] = action;
					}
				}
			}
		}

		if (this._options?.overflowBehavior !== undefined) {

			const exemptedIds = intersection(new Set(this._options.overflowBehavior.exempted), Iterable.map(primary, a => a?.id));
			const maxItems = this._options.overflowBehavior.maxItems - exemptedIds.size;

			let count = 0;
			for (let i = 0; i < primary.length; i++) {
				const action = primary[i];
				if (!action) {
					continue;
				}
				count++;
				if (exemptedIds.has(action.id)) {
					continue;
				}
				if (count >= maxItems) {
					primary[i] = undefined;
					extraSecondary[i] = action;
				}
			}
		}

		coalesceInPlace(primary);
		coalesceInPlace(extraSecondary);

		super.setActions(Separator.clean(primary), Separator.join(Separator.clean(extraSecondary), secondary));

		if (toggleActions.length > 0 || primary.length > 0) {
			this._sessionDisposables.add(addDisposableListener(this.getElement(), 'contextmenu', e => {
				const event = new StandardMouseEvent(getWindow(this.getElement()), e);

				const action = this.getItemAction(event.target);
				if (!(action)) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();

				const primaryActions = [];

				if (action instanceof MenuItemAction && action.menuKeybinding) {
					primaryActions.push(action.menuKeybinding);
				} else if (!(action instanceof SubmenuItemAction || action instanceof ToggleMenuAction)) {
					const supportsKeybindings = !!this._keybindingService.lookupKeybinding(action.id);
					primaryActions.push(createConfigureKeybindingAction(this._commandService, this._keybindingService, action.id, undefined, supportsKeybindings));
				}

				if (toggleActions.length > 0) {
					let noHide = false;

					if (toggleActionsCheckedCount === 1 && this._options?.hiddenItemStrategy === HiddenItemStrategy.Ignore) {
						noHide = true;
						for (let i = 0; i < toggleActions.length; i++) {
							if (toggleActions[i].checked) {
								toggleActions[i] = toAction({
									id: action.id,
									label: action.label,
									checked: true,
									enabled: false,
									run() { }
								});
								break;
							}
						}
					}

					if (!noHide && (action instanceof MenuItemAction || action instanceof SubmenuItemAction)) {
						if (!action.hideActions) {
							return;
						}
						primaryActions.push(action.hideActions.hide);

					} else {
						primaryActions.push(toAction({
							id: 'label',
							label: localize('hide', "Hide"),
							enabled: false,
							run() { }
						}));
					}
				}

				const actions = Separator.join(primaryActions, toggleActions);

				if (this._options?.resetMenu && !menuIds) {
					menuIds = [this._options.resetMenu];
				}
				if (someAreHidden && menuIds) {
					actions.push(new Separator());
					actions.push(toAction({
						id: 'resetThisMenu',
						label: localize('resetThisMenu', "Reset Menu"),
						run: () => this._menuService.resetHiddenStates(menuIds)
					}));
				}

				if (actions.length === 0) {
					return;
				}

				this._contextMenuService.showContextMenu({
					getAnchor: () => event,
					getActions: () => actions,
					menuId: this._options?.contextMenu,
					menuActionOptions: { renderShortTitle: true, ...this._options?.menuOptions },
					skipTelemetry: typeof this._options?.telemetrySource === 'string',
					contextKeyService: this._contextKeyService,
				});
			}));
		}
	}
}



export interface IToolBarRenderOptions {
	primaryGroup?: string | ((actionGroup: string) => boolean);

	shouldInlineSubmenu?: (action: SubmenuAction, group: string, groupSize: number) => boolean;

	useSeparatorsInPrimaryActions?: boolean;
}

export interface IMenuWorkbenchToolBarOptions extends IWorkbenchToolBarOptions {

	toolbarOptions?: IToolBarRenderOptions;

	resetMenu?: undefined;

	eventDebounceDelay?: number;
}

export class MenuWorkbenchToolBar extends WorkbenchToolBar {

	private readonly _onDidChangeMenuItems = this._store.add(new Emitter<this>());
	get onDidChangeMenuItems() { return this._onDidChangeMenuItems.event; }

	private readonly _menu: IMenu;
	private readonly _menuOptions: IMenuActionOptions | undefined;
	private readonly _toolbarOptions: IToolBarRenderOptions | undefined;
	private readonly _container: HTMLElement;

	constructor(
		container: HTMLElement,
		menuId: MenuId,
		options: IMenuWorkbenchToolBarOptions | undefined,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IActionViewItemService actionViewService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(container, {
			resetMenu: menuId,
			...options,
			actionViewItemProvider: (action, opts) => {
				let provider = actionViewService.lookUp(menuId, action instanceof SubmenuItemAction ? action.item.submenu.id : action.id);
				if (!provider) {
					provider = options?.actionViewItemProvider;
				}
				const viewItem = provider?.(action, opts, instantiationService, getWindow(container).vscodeWindowId);
				if (viewItem) {
					return viewItem;
				}
				return createActionViewItem(instantiationService, action, opts);
			}
		}, menuService, contextKeyService, contextMenuService, keybindingService, commandService, telemetryService);

		this._container = container;
		this._menuOptions = options?.menuOptions;
		this._toolbarOptions = options?.toolbarOptions;

		this._menu = this._store.add(menuService.createMenu(menuId, contextKeyService, { emitEventsForSubmenuChanges: true, eventDebounceDelay: options?.eventDebounceDelay }));

		this._store.add(this._menu.onDidChange(() => {
			this._updateToolbar();
			this._onDidChangeMenuItems.fire(this);
		}));

		this._store.add(actionViewService.onDidChange(e => {
			if (e === menuId) {
				this._updateToolbar();
			}
		}));
		this._updateToolbar();
	}

	private _updateToolbar(): void {
		const { primary, secondary } = getActionBarActions(
			this._menu.getActions(this._menuOptions),
			this._toolbarOptions?.primaryGroup,
			this._toolbarOptions?.shouldInlineSubmenu,
			this._toolbarOptions?.useSeparatorsInPrimaryActions
		);
		this._container.classList.toggle('has-no-actions', primary.length === 0 && secondary.length === 0);
		super.setActions(primary, secondary);
	}

	refresh(): void {
		this._updateToolbar();
	}

	override setActions(): void {
		throw new BugIndicatingError('This toolbar is populated from a menu.');
	}
}
