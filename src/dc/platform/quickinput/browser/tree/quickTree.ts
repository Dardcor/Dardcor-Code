/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { autorun, IReader, observableValue } from '../../../../base/common/observable.js';
import { setTimeout0 } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IQuickTree, IQuickTreeItem, IQuickTreeItemButtonEvent, QuickInputType, QuickPickFocus } from '../../common/quickInput.js';
import { QuickInput, QuickInputUI, Visibilities } from '../quickInput.js';
import { getParentNodeState } from './quickInputTree.js';


export class QuickTree<T extends IQuickTreeItem> extends QuickInput implements IQuickTree<T> {
	private static readonly DEFAULT_ARIA_LABEL = localize('quickInputBox.ariaLabel', "Type to narrow down results.");

	readonly type = QuickInputType.QuickTree;

	private readonly _value = observableValue('value', '');
	private readonly _ariaLabel = observableValue<string | undefined>('ariaLabel', undefined);
	private readonly _placeholder = observableValue<string | undefined>('placeholder', undefined);
	private readonly _matchOnDescription = observableValue('matchOnDescription', false);
	private readonly _matchOnLabel = observableValue('matchOnLabel', true);
	private readonly _sortByLabel = observableValue('sortByLabel', true);
	private readonly _activeItems = observableValue<readonly T[]>('activeItems', []);
	private readonly _itemTree = observableValue<ReadonlyArray<T>>('itemTree', []);

	readonly onDidChangeValue = Event.fromObservable(this._value, this._store);
	readonly onDidChangeActive = Event.fromObservable(this._activeItems, this._store);

	private readonly _onDidChangeCheckedLeafItems = this._register(new Emitter<T[]>());
	readonly onDidChangeCheckedLeafItems: Event<T[]> = this._onDidChangeCheckedLeafItems.event;

	private readonly _onDidChangeCheckboxState = this._register(new Emitter<T>());
	readonly onDidChangeCheckboxState: Event<T> = this._onDidChangeCheckboxState.event;

	private readonly _onDidAcceptEmitter = this._register(new Emitter<void>());
	readonly onDidAccept: Event<void>;

	constructor(ui: QuickInputUI) {
		super(ui);
		this.onDidAccept = Event.any(ui.onDidAccept, this._onDidAcceptEmitter.event);
		this._registerAutoruns();
		this._register(ui.tree.onDidChangeCheckedLeafItems(e => this._onDidChangeCheckedLeafItems.fire(e as T[])));
		this._register(ui.tree.onDidChangeCheckboxState(e => this._onDidChangeCheckboxState.fire(e.item as T)));
		this._register(ui.tree.tree.onDidChangeFocus(e => {
			this._activeItems.set(ui.tree.getActiveItems() as T[], undefined);
		}));
	}

	get value(): string { return this._value.get(); }
	set value(value: string) { this._value.set(value, undefined); }

	get ariaLabel(): string | undefined { return this._ariaLabel.get(); }
	set ariaLabel(ariaLabel: string | undefined) { this._ariaLabel.set(ariaLabel, undefined); }

	get placeholder(): string | undefined { return this._placeholder.get(); }
	set placeholder(placeholder: string | undefined) { this._placeholder.set(placeholder, undefined); }

	get matchOnDescription(): boolean { return this._matchOnDescription.get(); }
	set matchOnDescription(matchOnDescription: boolean) { this._matchOnDescription.set(matchOnDescription, undefined); }

	get matchOnLabel(): boolean { return this._matchOnLabel.get(); }
	set matchOnLabel(matchOnLabel: boolean) { this._matchOnLabel.set(matchOnLabel, undefined); }

	get sortByLabel(): boolean { return this._sortByLabel.get(); }
	set sortByLabel(sortByLabel: boolean) { this._sortByLabel.set(sortByLabel, undefined); }

	get activeItems(): readonly T[] { return this._activeItems.get(); }
	set activeItems(activeItems: readonly T[]) { this._activeItems.set(activeItems, undefined); }

	get itemTree(): ReadonlyArray<Readonly<T>> { return this._itemTree.get(); }

	get onDidTriggerItemButton(): Event<IQuickTreeItemButtonEvent<T>> {
		return this.ui.tree.onDidTriggerButton as Event<IQuickTreeItemButtonEvent<T>>;
	}

	// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
	get checkedLeafItems(): readonly T[] { return this.ui.tree.getCheckedLeafItems() as any as readonly T[]; }

	setItemTree(itemTree: T[]): void {
		this._itemTree.set(itemTree, undefined);
	}

	getParent(element: T): T | undefined {
		return this.ui.tree.tree.getParentElement(element) as T ?? undefined;
	}

	expand(element: T): void {
		this.ui.tree.tree.expand(element);
	}
	collapse(element: T): void {
		this.ui.tree.tree.collapse(element);
	}
	isCollapsed(element: T): boolean {
		return this.ui.tree.tree.isCollapsed(element);
	}
	focusOnInput(): void {
		this.ui.inputBox.setFocus();
	}

	reveal(element: T): void {
		this.ui.tree.tree.reveal(element);
		this.ui.tree.tree.setFocus([element]);
	}

	override show() {
		if (!this.visible) {
			const visibilities: Visibilities = {
				title: !!this.title || !!this.step || !!this.titleButtons.length,
				description: !!this.description,
				checkAll: true,
				checkBox: true,
				inputBox: true,
				progressBar: true,
				visibleCount: true,
				count: true,
				ok: true,
				list: false,
				tree: true,
				message: !!this.validationMessage,
				customButton: false
			};
			this.ui.setVisibilities(visibilities);
			this.visibleDisposables.add(this.ui.inputBox.onDidChange(value => {
				this._value.set(value, undefined);
			}));
			this.visibleDisposables.add(this.ui.tree.onDidChangeCheckboxState((e) => {
				const checkAllState = getParentNodeState([...this.ui.tree.tree.getNode().children]);
				if (this.ui.checkAll.checked !== checkAllState) {
					this.ui.checkAll.checked = checkAllState;
				}
			}));
			this.visibleDisposables.add(this.ui.checkAll.onChange(_e => {
				const checked = this.ui.checkAll.checked;
				this.ui.tree.checkAll(checked);
			}));
			this.visibleDisposables.add(this.ui.tree.onDidChangeCheckedLeafItems(e => {
				this.ui.count.setCount(e.length);
			}));
		}
		super.show();

		setTimeout0(() => this.ui.count.setCount(this.ui.tree.getCheckedLeafItems().length));
		const checkAllState = getParentNodeState([...this.ui.tree.tree.getNode().children]);
		if (this.ui.checkAll.checked !== checkAllState) {
			this.ui.checkAll.checked = checkAllState;
		}
	}

	protected override update() {
		if (!this.visible) {
			return;
		}

		const visibilities: Visibilities = {
			title: !!this.title || !!this.step || !!this.titleButtons.length,
			description: !!this.description,
			checkAll: true,
			checkBox: true,
			inputBox: true,
			progressBar: true,
			visibleCount: true,
			count: true,
			ok: true,
			tree: true,
			message: !!this.validationMessage
		};
		this.ui.setVisibilities(visibilities);
		super.update();
	}

	_registerListeners(): void {

	}

	_registerAutoruns(): void {
		this.registerVisibleAutorun(reader => {
			const value = this._value.read(reader);
			this.ui.inputBox.value = value;
			this.ui.tree.filter(value);
		});
		this.registerVisibleAutorun(reader => {
			let ariaLabel = this._ariaLabel.read(reader);
			if (!ariaLabel) {
				ariaLabel = this.placeholder || QuickTree.DEFAULT_ARIA_LABEL;
				if (this.title) {
					ariaLabel += ` - ${this.title}`;
				}
			}
			if (this.ui.list.ariaLabel !== ariaLabel) {
				this.ui.list.ariaLabel = ariaLabel ?? null;
			}
			if (this.ui.inputBox.ariaLabel !== ariaLabel) {
				this.ui.inputBox.ariaLabel = ariaLabel ?? 'input';
			}
		});
		this.registerVisibleAutorun(reader => {
			const placeholder = this._placeholder.read(reader);
			if (this.ui.inputBox.placeholder !== placeholder) {
				this.ui.inputBox.placeholder = placeholder ?? '';
			}
		});
		this.registerVisibleAutorun((reader) => {
			const matchOnLabel = this._matchOnLabel.read(reader);
			const matchOnDescription = this._matchOnDescription.read(reader);
			this.ui.tree.updateFilterOptions({ matchOnLabel, matchOnDescription });
		});
		this.registerVisibleAutorun((reader) => {
			const sortByLabel = this._sortByLabel.read(reader);
			this.ui.tree.sortByLabel = sortByLabel;
		});
		this.registerVisibleAutorun((reader) => {
			const itemTree = this._itemTree.read(reader);
			this.ui.tree.setTreeData(itemTree);
		});
	}

	registerVisibleAutorun(fn: (reader: IReader) => void): void {
		this._register(autorun((reader) => {
			if (this._visible.read(reader)) {
				fn(reader);
			}
		}));
	}

	focus(focus: QuickPickFocus): void {
		this.ui.tree.focus(focus);
		this.ui.tree.tree.domFocus();
	}

	accept(_inBackground?: boolean): void {
		this._onDidAcceptEmitter.fire();
	}
}
