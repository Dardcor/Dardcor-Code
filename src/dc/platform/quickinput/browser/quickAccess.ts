/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../base/common/async.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, isDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { DefaultQuickAccessFilterValue, Extensions, IQuickAccessController, IQuickAccessOptions, IQuickAccessProvider, IQuickAccessProviderDescriptor, IQuickAccessRegistry } from '../common/quickAccess.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, ItemActivation } from '../common/quickInput.js';
import { Registry } from '../../registry/common/platform.js';

export class QuickAccessController extends Disposable implements IQuickAccessController {

	private readonly registry = Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess);
	private readonly mapProviderToDescriptor = new Map<IQuickAccessProviderDescriptor, IQuickAccessProvider>();

	private readonly lastAcceptedPickerValues = new Map<IQuickAccessProviderDescriptor, string>();

	private visibleQuickAccess: {
		readonly picker: IQuickPick<IQuickPickItem, { useSeparators: true }>;
		readonly descriptor: IQuickAccessProviderDescriptor | undefined;
		readonly value: string;
	} | undefined = undefined;

	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();
		this._register(toDisposable(() => {
			for (const provider of this.mapProviderToDescriptor.values()) {
				if (isDisposable(provider)) {
					provider.dispose();
				}
			}

			this.visibleQuickAccess?.picker.dispose();
		}));
	}

	pick(value = '', options?: IQuickAccessOptions): Promise<IQuickPickItem[] | undefined> {
		return this.doShowOrPick(value, true, options);
	}

	show(value = '', options?: IQuickAccessOptions): void {
		this.doShowOrPick(value, false, options);
	}

	private doShowOrPick(value: string, pick: true, options?: IQuickAccessOptions): Promise<IQuickPickItem[] | undefined>;
	private doShowOrPick(value: string, pick: false, options?: IQuickAccessOptions): void;
	private doShowOrPick(value: string, pick: boolean, options?: IQuickAccessOptions): Promise<IQuickPickItem[] | undefined> | void {

		const [provider, descriptor] = this.getOrInstantiateProvider(value, options?.enabledProviderPrefixes);

		const visibleQuickAccess = this.visibleQuickAccess;
		const visibleDescriptor = visibleQuickAccess?.descriptor;
		if (visibleQuickAccess && descriptor && visibleDescriptor === descriptor) {

			if (value !== descriptor.prefix && !options?.preserveValue) {
				visibleQuickAccess.picker.value = value;
			}

			this.adjustValueSelection(visibleQuickAccess.picker, descriptor, options);

			return;
		}

		if (descriptor && !options?.preserveValue) {
			let newValue: string | undefined = undefined;

			if (visibleQuickAccess && visibleDescriptor && visibleDescriptor !== descriptor) {
				const newValueCandidateWithoutPrefix = visibleQuickAccess.value.substr(visibleDescriptor.prefix.length);
				if (newValueCandidateWithoutPrefix) {
					newValue = `${descriptor.prefix}${newValueCandidateWithoutPrefix}`;
				}
			}

			if (!newValue) {
				const defaultFilterValue = provider?.defaultFilterValue;
				if (defaultFilterValue === DefaultQuickAccessFilterValue.LAST) {
					newValue = this.lastAcceptedPickerValues.get(descriptor);
				} else if (typeof defaultFilterValue === 'string') {
					newValue = `${descriptor.prefix}${defaultFilterValue}`;
				}
			}

			if (typeof newValue === 'string') {
				value = newValue;
			}
		}

		const visibleSelection = visibleQuickAccess?.picker?.valueSelection;
		const visibleValue = visibleQuickAccess?.picker?.value;

		const disposables = new DisposableStore();
		const picker = disposables.add(this.quickInputService.createQuickPick({ useSeparators: true }));
		picker.value = value;
		this.adjustValueSelection(picker, descriptor, options);
		picker.placeholder = options?.placeholder ?? descriptor?.placeholder;
		picker.quickNavigate = options?.quickNavigateConfiguration;
		picker.hideInput = !!picker.quickNavigate && !visibleQuickAccess;
		if (typeof options?.itemActivation === 'number' || options?.quickNavigateConfiguration) {
			picker.itemActivation = options?.itemActivation ?? ItemActivation.SECOND ;
		}
		picker.contextKey = descriptor?.contextKey;
		picker.filterValue = (value: string) => value.substring(descriptor ? descriptor.prefix.length : 0);

		let pickPromise: DeferredPromise<IQuickPickItem[]> | undefined = undefined;
		if (pick) {
			pickPromise = new DeferredPromise<IQuickPickItem[]>();
			disposables.add(Event.once(picker.onWillAccept)(e => {
				e.veto();
				picker.hide();
			}));
		}

		disposables.add(this.registerPickerListeners(picker, provider, descriptor, value, options));

		const cts = disposables.add(new CancellationTokenSource());
		if (provider) {
			disposables.add(provider.provide(picker, cts.token, options?.providerOptions));
		}

		Event.once(picker.onDidHide)(() => {
			if (picker.selectedItems.length === 0) {
				cts.cancel();
			}

			disposables.dispose();

			pickPromise?.complete(picker.selectedItems.slice(0));
		});

		picker.show();

		if (visibleSelection && visibleValue === value) {
			picker.valueSelection = visibleSelection;
		}

		if (pick) {
			return pickPromise?.p;
		}
	}

	private adjustValueSelection(picker: IQuickPick<IQuickPickItem, { useSeparators: true }>, descriptor?: IQuickAccessProviderDescriptor, options?: IQuickAccessOptions): void {
		let valueSelection: [number, number];

		if (options?.preserveValue) {
			valueSelection = [picker.value.length, picker.value.length];
		}

		else {
			valueSelection = [descriptor?.prefix.length ?? 0, picker.value.length];
		}

		picker.valueSelection = valueSelection;
	}

	private registerPickerListeners(
		picker: IQuickPick<IQuickPickItem, { useSeparators: true }>,
		provider: IQuickAccessProvider | undefined,
		descriptor: IQuickAccessProviderDescriptor | undefined,
		value: string,
		options?: IQuickAccessOptions
	): IDisposable {
		const disposables = new DisposableStore();

		const visibleQuickAccess = this.visibleQuickAccess = { picker, descriptor, value };
		disposables.add(toDisposable(() => {
			if (visibleQuickAccess === this.visibleQuickAccess) {
				this.visibleQuickAccess = undefined;
			}
		}));

		disposables.add(picker.onDidChangeValue(value => {
			const [providerForValue] = this.getOrInstantiateProvider(value, options?.enabledProviderPrefixes);
			if (providerForValue !== provider) {
				this.show(value, {
					enabledProviderPrefixes: options?.enabledProviderPrefixes,
					preserveValue: true,
					providerOptions: options?.providerOptions
				});
			} else {
				visibleQuickAccess.value = value;
			}
		}));

		if (descriptor) {
			disposables.add(picker.onDidAccept(() => {
				this.lastAcceptedPickerValues.set(descriptor, picker.value);
			}));
		}

		return disposables;
	}

	private getOrInstantiateProvider(value: string, enabledProviderPrefixes?: string[]): [IQuickAccessProvider | undefined, IQuickAccessProviderDescriptor | undefined] {
		const providerDescriptor = this.registry.getQuickAccessProvider(value, this.contextKeyService);
		if (!providerDescriptor || enabledProviderPrefixes && !enabledProviderPrefixes?.includes(providerDescriptor.prefix)) {
			return [undefined, undefined];
		}

		let provider = this.mapProviderToDescriptor.get(providerDescriptor);
		if (!provider) {
			provider = this.instantiationService.createInstance(providerDescriptor.ctor);
			this.mapProviderToDescriptor.set(providerDescriptor, provider);
		}

		return [provider, providerDescriptor];
	}
}
