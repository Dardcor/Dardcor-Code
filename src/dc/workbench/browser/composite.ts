/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, IActionRunner, ActionRunner } from '../../base/common/actions.js';
import { Component } from '../common/component.js';
import { ITelemetryService } from '../../platform/telemetry/common/telemetry.js';
import { IComposite, ICompositeControl } from '../common/composite.js';
import { Event, Emitter } from '../../base/common/event.js';
import { IThemeService } from '../../platform/theme/common/themeService.js';
import { IConstructorSignature, IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { trackFocus, Dimension, IDomPosition } from '../../base/browser/dom.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { assertReturnsDefined } from '../../base/common/types.js';
import { IActionViewItem } from '../../base/browser/ui/actionbar/actionbar.js';
import { MenuId } from '../../platform/actions/common/actions.js';
import { IBoundarySashes } from '../../base/browser/ui/sash/sash.js';
import { IBaseActionViewItemOptions } from '../../base/browser/ui/actionbar/actionViewItems.js';

export abstract class Composite<MementoType extends object = object> extends Component<MementoType> implements IComposite {

	private readonly _onTitleAreaUpdate = this._register(new Emitter<void>());
	readonly onTitleAreaUpdate = this._onTitleAreaUpdate.event;

	protected _onDidFocus: Emitter<void> | undefined;
	get onDidFocus(): Event<void> {
		if (!this._onDidFocus) {
			this._onDidFocus = this.registerFocusTrackEvents().onDidFocus;
		}

		return this._onDidFocus.event;
	}

	private _onDidBlur: Emitter<void> | undefined;
	get onDidBlur(): Event<void> {
		if (!this._onDidBlur) {
			this._onDidBlur = this.registerFocusTrackEvents().onDidBlur;
		}

		return this._onDidBlur.event;
	}

	private _hasFocus = false;
	hasFocus(): boolean {
		return this._hasFocus;
	}

	private registerFocusTrackEvents(): { onDidFocus: Emitter<void>; onDidBlur: Emitter<void> } {
		const container = assertReturnsDefined(this.getContainer());
		const focusTracker = this._register(trackFocus(container));

		const onDidFocus = this._onDidFocus = this._register(new Emitter<void>());
		this._register(focusTracker.onDidFocus(() => {
			this._hasFocus = true;

			onDidFocus.fire();
		}));

		const onDidBlur = this._onDidBlur = this._register(new Emitter<void>());
		this._register(focusTracker.onDidBlur(() => {
			this._hasFocus = false;

			onDidBlur.fire();
		}));

		return { onDidFocus, onDidBlur };
	}

	protected actionRunner: IActionRunner | undefined;

	private visible = false;
	private parent: HTMLElement | undefined;

	constructor(
		id: string,
		protected readonly telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService
	) {
		super(id, themeService, storageService);
	}

	getTitle(): string | undefined {
		return undefined;
	}

	create(parent: HTMLElement): void {
		this.parent = parent;
	}

	getContainer(): HTMLElement | undefined {
		return this.parent;
	}

	setVisible(visible: boolean): void {
		if (this.visible !== !!visible) {
			this.visible = visible;
		}
	}

	focus(): void {
	}

	abstract layout(dimension: Dimension, position?: IDomPosition): void;

	abstract setBoundarySashes(sashes: IBoundarySashes): void;

	getMenuIds(): readonly MenuId[] {
		return [];
	}

	getActions(): readonly IAction[] {
		return [];
	}

	getSecondaryActions(): readonly IAction[] {
		return [];
	}

	getContextMenuActions(): readonly IAction[] {
		return [];
	}

	getActionViewItem(action: IAction, options: IBaseActionViewItemOptions): IActionViewItem | undefined {
		return undefined;
	}

	getActionsContext(): unknown {
		return null;
	}

	getActionRunner(): IActionRunner {
		if (!this.actionRunner) {
			this.actionRunner = this._register(new ActionRunner());
		}

		return this.actionRunner;
	}

	protected updateTitleArea(): void {
		this._onTitleAreaUpdate.fire();
	}

	isVisible(): boolean {
		return this.visible;
	}

	getControl(): ICompositeControl | undefined {
		return undefined;
	}
}

export abstract class CompositeDescriptor<T extends Composite> {

	constructor(
		private readonly ctor: IConstructorSignature<T>,
		readonly id: string,
		readonly name: string,
		readonly cssClass?: string,
		readonly order?: number,
		readonly requestedIndex?: number,
	) { }

	instantiate(instantiationService: IInstantiationService): T {
		return instantiationService.createInstance(this.ctor);
	}
}

export abstract class CompositeRegistry<T extends Composite> extends Disposable {

	private readonly _onDidRegister = this._register(new Emitter<CompositeDescriptor<T>>());
	readonly onDidRegister = this._onDidRegister.event;

	private readonly _onDidDeregister = this._register(new Emitter<CompositeDescriptor<T>>());
	readonly onDidDeregister = this._onDidDeregister.event;

	private readonly composites: CompositeDescriptor<T>[] = [];

	protected registerComposite(descriptor: CompositeDescriptor<T>): void {
		if (this.compositeById(descriptor.id)) {
			return;
		}

		this.composites.push(descriptor);
		this._onDidRegister.fire(descriptor);
	}

	protected deregisterComposite(id: string): void {
		const descriptor = this.compositeById(id);
		if (!descriptor) {
			return;
		}

		this.composites.splice(this.composites.indexOf(descriptor), 1);
		this._onDidDeregister.fire(descriptor);
	}

	getComposite(id: string): CompositeDescriptor<T> | undefined {
		return this.compositeById(id);
	}

	protected getComposites(): CompositeDescriptor<T>[] {
		return this.composites.slice(0);
	}

	private compositeById(id: string): CompositeDescriptor<T> | undefined {
		return this.composites.find(composite => composite.id === id);
	}
}
