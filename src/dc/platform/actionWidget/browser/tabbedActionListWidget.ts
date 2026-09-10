import * as dom from '../../../base/browser/dom.js';
import { IListAccessibilityProvider } from '../../../base/browser/ui/list/listWidget.js';
import { Radio } from '../../../base/browser/ui/radio/radio.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IAccessibilityService } from '../../accessibility/common/accessibility.js';
import { IContextViewService } from '../../contextview/browser/contextView.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ActionList, IActionListDelegate, IActionListItem, IActionListOptions } from './actionList.js';
import './tabbedActionListWidget.css';
const TAB_RESIZE_ANIMATION: KeyframeAnimationOptions = { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
interface ITabBox {
    readonly width: number;
    readonly paddingLeft: string;
    readonly paddingRight: string;
    readonly columnGap: string;
}
function readTabBox(element: HTMLElement): ITabBox {
    const style = dom.getComputedStyle(element);
    return {
        width: element.getBoundingClientRect().width,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        columnGap: style.columnGap === 'normal' ? '0px' : style.columnGap,
    };
}
export interface ITabbedActionListBuildResult<T> {
    readonly items: readonly IActionListItem<T>[];
    readonly listOptions?: IActionListOptions;
}
export interface ITabDescriptor {
    readonly id: string;
    readonly label?: string;
    readonly tooltip?: string;
    readonly icon?: ThemeIcon;
}
export interface ITabBarAction {
    readonly id: string;
    readonly icon: ThemeIcon;
    readonly tooltip: string;
    readonly alignEnd?: boolean;
    readonly checked?: boolean;
    run(): void;
}
export interface ITabbedActionListShowOptions<T> {
    readonly user: string;
    readonly anchor: HTMLElement;
    readonly tabs: readonly ITabDescriptor[];
    readonly initialTab: string;
    createActionList(activeTab: string): ITabbedActionListBuildResult<T>;
    readonly delegate: IActionListDelegate<T>;
    readonly accessibilityProvider?: Partial<IListAccessibilityProvider<IActionListItem<T>>>;
    readonly width?: number;
    readonly tabBarClassName?: string;
    readonly widgetClassNames?: (activeTab: string) => readonly string[];
    readonly sizingTab?: string;
    readonly showCheckedItemHover?: boolean;
    readonly tabBarActions?: readonly ITabBarAction[];
    readonly tabLabels?: 'always' | 'active' | 'never';
    readonly filterInTabBar?: boolean;
    renderFooter?(container: HTMLElement, activeTab: string): IDisposable;
    renderEmpty?(container: HTMLElement, activeTab: string): IDisposable | undefined;
}
export class TabbedActionListWidget extends Disposable {
    private readonly _onDidChangeTab = this._register(new Emitter<string>());
    readonly onDidChangeTab = this._onDidChangeTab.event;
    private readonly _onDidHide = this._register(new Emitter<void>());
    readonly onDidHide = this._onDidHide.event;
    private readonly _activePopup = this._register(new MutableDisposable());
    private _swappingTab = false;
    private _refreshActiveList: (() => void) | undefined;
    private _previousTabBoxes: Map<string, ITabBox> | undefined;
    private _previousTabTexts: ReadonlyMap<string, string> | undefined;
    private _fixedListHeight: number | undefined;
    private _fixedPopupHeight: number | undefined;
    private _hasMeasuredSizingTab = false;
    get isVisible(): boolean {
        return !!this._activePopup.value;
    }
    constructor(
    @IContextViewService
    private readonly _contextViewService: IContextViewService, 
    @IInstantiationService
    private readonly _instantiationService: IInstantiationService, 
    @IAccessibilityService
    private readonly _accessibilityService: IAccessibilityService) {
        super();
    }
    show<T>(options: ITabbedActionListShowOptions<T>): void {
        const isSwap = this.isVisible;
        if (isSwap) {
            this._swappingTab = true;
            this._activePopup.value = undefined;
        }
        else {
            this._previousTabBoxes = undefined;
            this._previousTabTexts = undefined;
            this._fixedListHeight = undefined;
            this._fixedPopupHeight = undefined;
            this._hasMeasuredSizingTab = false;
        }
        let activeTab = options.initialTab;
        const popupDisposables = new DisposableStore();
        const hide = () => {
            if (this._activePopup.value === popupDisposables) {
                this._activePopup.value = undefined;
            }
        };
        this._activePopup.value = popupDisposables;
        popupDisposables.add(toDisposable(() => {
            this._contextViewService.hideContextView();
        }));
        let listRef: ActionList<T> | undefined;
        this._contextViewService.showContextView({
            getAnchor: () => options.anchor,
            render: (container: HTMLElement) => {
                const renderDisposables = new DisposableStore();
                const widget = dom.append(container, dom.$('.action-widget'));
                if (options.width !== undefined) {
                    widget.style.width = `${options.width}px`;
                }
                let widgetClassNames: readonly string[] = [];
                const applyWidgetClassNames = () => {
                    const next = options.widgetClassNames?.(activeTab) ?? [];
                    const removed = widgetClassNames.filter(name => !next.includes(name));
                    const added = next.filter(name => !widgetClassNames.includes(name));
                    if (removed.length) {
                        widget.classList.remove(...removed);
                    }
                    if (added.length) {
                        widget.classList.add(...added);
                    }
                    widgetClassNames = next;
                };
                applyWidgetClassNames();
                const block = dom.append(container, dom.$('.context-view-block'));
                renderDisposables.add(dom.addDisposableGenericMouseDownListener(block, e => e.stopPropagation()));
                const tabBar = dom.append(widget, dom.$('.tabbed-action-list-tabbar'));
                if (options.tabBarClassName) {
                    tabBar.classList.add(options.tabBarClassName);
                }
                const tabStrip = dom.append(tabBar, dom.$('.tabbed-action-list-tabstrip'));
                const filterSlot = dom.append(tabBar, dom.$('.tabbed-action-list-filter-slot'));
                const activateTab = (next: string) => {
                    if (next === activeTab) {
                        return;
                    }
                    activeTab = next;
                    this._onDidChangeTab.fire(next);
                    this.show({ ...options, initialTab: next });
                };
                const tabTexts = new Map(options.tabs.map(tab => {
                    const label = tab.label ?? tab.id;
                    const iconPrefix = tab.icon ? `$(${tab.icon.id})` : '';
                    const labelMode = options.tabLabels ?? 'always';
                    const showsLabel = !iconPrefix || labelMode === 'always' || (labelMode === 'active' && tab.id === activeTab);
                    return [tab.id, showsLabel ? (iconPrefix ? `${iconPrefix} ${label}` : label) : iconPrefix] as const;
                }));
                const radio = renderDisposables.add(new Radio({
                    items: options.tabs.map(tab => {
                        const label = tab.label ?? tab.id;
                        return { text: tabTexts.get(tab.id)!, tooltip: tab.tooltip ?? label, ariaLabel: label, isActive: tab.id === activeTab };
                    }),
                }));
                tabStrip.appendChild(radio.domNode);
                renderDisposables.add(radio.onDidSelect(index => {
                    const next = options.tabs[index];
                    if (next) {
                        activateTab(next.id);
                    }
                }));
                for (const tabAction of options.tabBarActions ?? []) {
                    const container = tabAction.alignEnd ? tabBar : tabStrip;
                    const button = dom.append(container, dom.$('button.tabbed-action-list-tabbar-action'));
                    button.classList.toggle('align-end', !!tabAction.alignEnd);
                    button.classList.toggle('checked', !!tabAction.checked);
                    button.dataset.id = tabAction.id;
                    button.title = tabAction.tooltip;
                    button.ariaLabel = tabAction.tooltip;
                    if (tabAction.checked !== undefined) {
                        button.setAttribute('aria-pressed', String(tabAction.checked));
                    }
                    dom.append(button, dom.$(`span${ThemeIcon.asCSSSelector(tabAction.icon)}`));
                    renderDisposables.add(dom.addDisposableListener(button, dom.EventType.CLICK, e => {
                        dom.EventHelper.stop(e, true);
                        tabAction.run();
                    }));
                }
                const needsSizing = !this._hasMeasuredSizingTab
                    && options.sizingTab !== undefined
                    && options.tabs.some(tab => tab.id === options.sizingTab);
                const sizingBuild = needsSizing && options.sizingTab !== activeTab
                    ? options.createActionList(options.sizingTab!)
                    : undefined;
                const { items, listOptions } = options.createActionList(activeTab);
                const emptyBody = items.length === 0 ? this._renderEmptyBody(widget, options, activeTab, renderDisposables) : undefined;
                const list = renderDisposables.add(this._instantiationService.createInstance(ActionList<T>, options.user, false, items, options.delegate, options.accessibilityProvider, listOptions, options.anchor));
                listRef = list;
                this._refreshActiveList = () => {
                    const hadFocus = dom.isAncestorOfActiveElement(widget);
                    applyWidgetClassNames();
                    list.updateItems(options.createActionList(activeTab).items);
                    if (hadFocus && !dom.isAncestorOfActiveElement(widget)) {
                        if (emptyBody) {
                            radio.focusActiveItem();
                        }
                        else {
                            list.focus();
                        }
                    }
                };
                renderDisposables.add(toDisposable(() => {
                    this._refreshActiveList = undefined;
                }));
                if (!emptyBody) {
                    if (list.headerContainer) {
                        widget.appendChild(list.headerContainer);
                    }
                    if (list.filterContainer) {
                        (options.filterInTabBar ? filterSlot : widget).appendChild(list.filterContainer);
                    }
                    widget.appendChild(list.domNode);
                    if (list.footerContainer) {
                        widget.appendChild(list.footerContainer);
                    }
                }
                let footer: HTMLElement | undefined;
                if (options.renderFooter) {
                    footer = dom.append(widget, dom.$('.tabbed-action-list-footer'));
                    renderDisposables.add(options.renderFooter(footer, activeTab));
                }
                if (needsSizing) {
                    const sizing = sizingBuild ?? { items, listOptions };
                    this._fixedListHeight = list.computeHeightForItems(sizing.items, sizing.listOptions?.collapsedByDefault, sizing.listOptions) || undefined;
                    this._hasMeasuredSizingTab = true;
                }
                const layout = () => {
                    const body = emptyBody ?? list.domNode;
                    const chromeHeight = widget.offsetHeight - body.offsetHeight;
                    const contentHeight = this._fixedPopupHeight === undefined
                        ? this._fixedListHeight
                        : Math.max(0, this._fixedPopupHeight - chromeHeight);
                    const width = list.layout(0, contentHeight);
                    widget.style.width = `${options.width ?? width}px`;
                    if (emptyBody && this._fixedListHeight !== undefined) {
                        emptyBody.style.minHeight = list.domNode.style.height;
                    }
                    if (this._fixedListHeight !== undefined && this._fixedPopupHeight === undefined) {
                        this._fixedPopupHeight = widget.offsetHeight;
                    }
                };
                layout();
                if (footer) {
                    const observer = renderDisposables.add(new dom.DisposableResizeObserver('TabbedActionListWidget.footer', () => {
                        layout();
                        this._contextViewService.layout();
                    }, dom.getWindow(footer)));
                    renderDisposables.add(observer.observe(footer, { box: 'border-box' }));
                }
                const tabBoxes = this._measureTabBoxes(radio, options.tabs);
                renderDisposables.add(this._animateTabResize(radio, options.tabs, tabBoxes, tabTexts));
                this._previousTabBoxes = tabBoxes;
                this._previousTabTexts = tabTexts;
                if (emptyBody) {
                    radio.focusActiveItem();
                }
                else {
                    list.focus();
                }
                renderDisposables.add(dom.addStandardDisposableListener(widget, 'keydown', e => {
                    const target = e.target as HTMLElement | null;
                    const onTabBar = !!target?.closest('.tabbed-action-list-tabbar');
                    const onFooter = !!target?.closest('.tabbed-action-list-footer');
                    const onEditable = !!target?.closest('input, textarea, [contenteditable="true"]');
                    const onOwnControls = !!target?.closest('.tabbed-action-list-empty, .action-list-submenu-panel');
                    const listNavigation = !onTabBar && !onFooter && !onOwnControls;
                    if (e.keyCode === KeyCode.Escape) {
                        dom.EventHelper.stop(e, true);
                        hide();
                        return;
                    }
                    if (e.keyCode === KeyCode.Enter && listNavigation) {
                        dom.EventHelper.stop(e, true);
                        list.acceptSelected();
                        return;
                    }
                    if (e.keyCode === KeyCode.UpArrow && listNavigation) {
                        dom.EventHelper.stop(e, true);
                        list.focusPrevious();
                        return;
                    }
                    if (e.keyCode === KeyCode.DownArrow && listNavigation) {
                        dom.EventHelper.stop(e, true);
                        list.focusNext();
                        return;
                    }
                    if (e.keyCode !== KeyCode.LeftArrow && e.keyCode !== KeyCode.RightArrow) {
                        return;
                    }
                    if (onFooter || onOwnControls || (onEditable && !onTabBar)) {
                        return;
                    }
                    const currentIndex = options.tabs.findIndex(t => t.id === activeTab);
                    if (currentIndex < 0) {
                        return;
                    }
                    const delta = e.keyCode === KeyCode.RightArrow ? 1 : -1;
                    const nextIndex = (currentIndex + delta + options.tabs.length) % options.tabs.length;
                    e.preventDefault();
                    e.stopPropagation();
                    activateTab(options.tabs[nextIndex].id);
                }));
                const focusTracker = renderDisposables.add(dom.trackFocus(container));
                renderDisposables.add(focusTracker.onDidBlur(() => {
                    if (this._swappingTab) {
                        return;
                    }
                    const activeElement = dom.getActiveElement();
                    if (activeElement && (activeElement.closest('.action-widget-hover') || activeElement.closest('.action-list-submenu-panel'))) {
                        return;
                    }
                    hide();
                }));
                return renderDisposables;
            },
            onHide: () => {
                listRef = undefined;
                if (this._swappingTab) {
                    return;
                }
                if (this._activePopup.value === popupDisposables) {
                    this._activePopup.value = undefined;
                }
                options.delegate.onHide?.();
                this._onDidHide.fire();
            },
            get anchorPosition() { return listRef?.anchorPosition; },
        }, undefined, false);
        if (options.showCheckedItemHover) {
            listRef?.showHoverForCheckedItem();
        }
        if (isSwap) {
            this._swappingTab = false;
        }
    }
    private _measureTabBoxes(radio: Radio, tabs: readonly ITabDescriptor[]): Map<string, ITabBox> {
        const boxes = new Map<string, ITabBox>();
        const elements = radio.optionElements;
        for (let index = 0; index < tabs.length; index++) {
            const element = elements[index];
            if (element) {
                boxes.set(tabs[index].id, readTabBox(element));
            }
        }
        return boxes;
    }
    private _animateTabResize(radio: Radio, tabs: readonly ITabDescriptor[], boxes: ReadonlyMap<string, ITabBox>, texts: ReadonlyMap<string, string>): IDisposable {
        const store = new DisposableStore();
        const previousBoxes = this._previousTabBoxes;
        const previousTexts = this._previousTabTexts;
        if (!previousBoxes || this._accessibilityService.isMotionReduced()) {
            return store;
        }
        const elements = radio.optionElements;
        for (let index = 0; index < tabs.length; index++) {
            const element = elements[index];
            const from = previousBoxes.get(tabs[index].id);
            const to = boxes.get(tabs[index].id);
            if (!element || !from || !to || to.width <= 0 || Math.abs(from.width - to.width) < 1) {
                continue;
            }
            const animation = element.animate([
                { width: `${from.width}px`, paddingLeft: from.paddingLeft, paddingRight: from.paddingRight, columnGap: from.columnGap },
                { width: `${to.width}px`, paddingLeft: to.paddingLeft, paddingRight: to.paddingRight, columnGap: to.columnGap },
            ], TAB_RESIZE_ANIMATION);
            store.add(toDisposable(() => animation.cancel()));
            const previousText = previousTexts?.get(tabs[index].id);
            const currentText = texts.get(tabs[index].id);
            if (to.width < from.width && previousText !== undefined && previousText !== currentText) {
                store.add(this._holdLabelWhileShrinking(radio, index, element, animation, previousText));
            }
        }
        return store;
    }
    private _holdLabelWhileShrinking(radio: Radio, index: number, element: HTMLElement, animation: Animation, previousText: string): IDisposable {
        const store = new DisposableStore();
        store.add(radio.overrideOptionLabel(index, previousText));
        element.classList.add('label-collapsing');
        store.add(toDisposable(() => element.classList.remove('label-collapsing')));
        const labelSpan = [...element.children].find((child): child is HTMLElement => dom.isHTMLElement(child) && !child.classList.contains('codicon'));
        labelSpan?.animate([{ maxWidth: `${labelSpan.scrollWidth}px` }, { maxWidth: '0px' }], TAB_RESIZE_ANIMATION);
        animation.finished.then(() => store.dispose(), () => { });
        return store;
    }
    hide(): void {
        this._activePopup.value = undefined;
    }
    refreshActiveList(): void {
        this._refreshActiveList?.();
    }
    private _renderEmptyBody<T>(widget: HTMLElement, options: ITabbedActionListShowOptions<T>, activeTab: string, disposables: DisposableStore): HTMLElement | undefined {
        if (!options.renderEmpty) {
            return undefined;
        }
        const body = dom.append(widget, dom.$('.tabbed-action-list-empty'));
        const rendered = options.renderEmpty(body, activeTab);
        if (!rendered) {
            body.remove();
            return undefined;
        }
        disposables.add(rendered);
        return body;
    }
    override dispose(): void {
        this._activePopup.value = undefined;
        super.dispose();
    }
}
