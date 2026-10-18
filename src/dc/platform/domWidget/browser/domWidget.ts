/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHotReloadEnabled } from '../../../base/common/hotReload.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { ISettableObservable, IObservable, autorun, constObservable, derived, observableValue } from '../../../base/common/observable.js';
import { IInstantiationService, GetLeadingNonServiceArgs } from '../../instantiation/common/instantiation.js';

export abstract class DomWidget extends Disposable {
	public static createAppend<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, dom: HTMLElement, store: DisposableStore, ...params: TArgs): void {
		if (!isHotReloadEnabled()) {
			const widget = new this(...params);
			dom.appendChild(widget.element);
			store.add(widget);
			return;
		}

		const observable = this.createObservable(store, ...params);
		store.add(autorun((reader) => {
			const widget = observable.read(reader);
			dom.appendChild(widget.element);
			reader.store.add(toDisposable(() => widget.element.remove()));
			reader.store.add(widget);
		}));
	}

	public static createInContents<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, store: DisposableStore, ...params: TArgs): HTMLDivElement {
		const div = document.createElement('div');
		div.style.display = 'contents';
		this.createAppend(div, store, ...params);
		return div;
	}

	public static createObservable<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, store: DisposableStore, ...params: TArgs): IObservable<T> {
		if (!isHotReloadEnabled()) {
			return constObservable(new this(...params));
		}

		const id = (this as unknown as HotReloadable)[_hotReloadId];
		const observable = id ? hotReloadedWidgets.get(id) : undefined;

		if (!observable) {
			return constObservable(new this(...params));
		}

		return derived(reader => {
			const Ctor = observable.read(reader);
			return new Ctor(...params) as T;
		});
	}

	public static instantiateAppend<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, instantiationService: IInstantiationService, dom: HTMLElement, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): void {
		if (!isHotReloadEnabled()) {
			const widget = instantiationService.createInstance(this as unknown as new (...args: unknown[]) => T, ...params);
			dom.appendChild(widget.element);
			store.add(widget);
			return;
		}

		const observable = this.instantiateObservable(instantiationService, store, ...params);
		let lastWidget: DomWidget | undefined = undefined;
		store.add(autorun((reader) => {
			const widget = observable.read(reader);
			if (lastWidget) {
				lastWidget.element.replaceWith(widget.element);
			} else {
				dom.appendChild(widget.element);
			}
			lastWidget = widget;

			reader.delayedStore.add(widget);
		}));
	}

	public static instantiateInContents<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, instantiationService: IInstantiationService, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): HTMLDivElement {
		const div = document.createElement('div');
		div.style.display = 'contents';
		this.instantiateAppend(instantiationService, div, store, ...params);
		return div;
	}

	public static instantiateObservable<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, instantiationService: IInstantiationService, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): IObservable<T> {
		if (!isHotReloadEnabled()) {
			return constObservable(instantiationService.createInstance(this as unknown as new (...args: unknown[]) => T, ...params));
		}

		const id = (this as unknown as HotReloadable)[_hotReloadId];
		const observable = id ? hotReloadedWidgets.get(id) : undefined;

		if (!observable) {
			return constObservable(instantiationService.createInstance(this as unknown as new (...args: unknown[]) => T, ...params));
		}

		return derived(reader => {
			const Ctor = observable.read(reader);
			return instantiationService.createInstance(Ctor, ...params) as T;
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public static registerWidgetHotReplacement(this: new (...args: any[]) => DomWidget, id: string): void {
		if (!isHotReloadEnabled()) {
			return;
		}
		let observable = hotReloadedWidgets.get(id);
		if (!observable) {
			observable = observableValue(id, this);
			hotReloadedWidgets.set(id, observable);
		} else {
			observable.set(this, undefined);
		}
		(this as unknown as HotReloadable)[_hotReloadId] = id;
	}

	abstract get element(): HTMLElement;
}

const _hotReloadId = Symbol('DomWidgetHotReloadId');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotReloadedWidgets = new Map<string, ISettableObservable<new (...args: any[]) => DomWidget>>();

interface HotReloadable {
	[_hotReloadId]?: string;
}

type DomWidgetCtor<TArgs extends unknown[], T extends DomWidget> = {
	new(...args: TArgs): T;

	createObservable(store: DisposableStore, ...params: TArgs): IObservable<T>;
	instantiateObservable(instantiationService: IInstantiationService, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): IObservable<T>;
	createAppend(dom: HTMLElement, store: DisposableStore, ...params: TArgs): void;
	instantiateAppend(instantiationService: IInstantiationService, dom: HTMLElement, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): void;
};
