/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../base/common/arrays.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ContextKeyExpression, IContextKeyService } from '../../contextkey/common/contextkey.js';
import { ItemActivation, IQuickNavigateConfiguration, IQuickPick, IQuickPickItem, QuickPickItem, IQuickPickSeparator } from './quickInput.js';
import { Registry } from '../../registry/common/platform.js';

export interface IQuickAccessProviderRunOptions {
	readonly from?: string;
	readonly placeholder?: string;
	readonly handleAccept?: (item: IQuickPickItem, isBackgroundAccept: boolean) => void;
}

export interface AnythingQuickAccessProviderRunOptions extends IQuickAccessProviderRunOptions {
	readonly includeHelp?: boolean;
	readonly filter?: (item: IQuickPickItem | IQuickPickSeparator) => boolean;
	readonly additionPicks?: QuickPickItem[];
}

export interface IQuickAccessOptions {

	readonly quickNavigateConfiguration?: IQuickNavigateConfiguration;

	readonly itemActivation?: ItemActivation;

	readonly preserveValue?: boolean;

	readonly providerOptions?: IQuickAccessProviderRunOptions;

	readonly enabledProviderPrefixes?: string[];

	readonly placeholder?: string;
}

export interface IQuickAccessController {

	show(value?: string, options?: IQuickAccessOptions): void;

	pick(value?: string, options?: IQuickAccessOptions): Promise<IQuickPickItem[] | undefined>;
}

export enum DefaultQuickAccessFilterValue {

	PRESERVE = 0,

	LAST = 1
}

export interface IQuickAccessProvider {

	readonly defaultFilterValue?: string | DefaultQuickAccessFilterValue;

	provide(picker: IQuickPick<IQuickPickItem, { useSeparators: true }>, token: CancellationToken, options?: IQuickAccessProviderRunOptions): IDisposable;
}

export interface IQuickAccessProviderHelp {

	readonly prefix?: string;

	readonly description: string;

	readonly commandId?: string;

	readonly commandCenterOrder?: number;

	readonly commandCenterLabel?: string;
}

export interface IQuickAccessProviderDescriptor {

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly ctor: { new(...services: any []): IQuickAccessProvider };

	readonly prefix: string;

	readonly placeholder?: string;

	readonly helpEntries: IQuickAccessProviderHelp[];

	readonly contextKey?: string;

	readonly when?: ContextKeyExpression;
}

export const Extensions = {
	Quickaccess: 'workbench.contributions.quickaccess'
};

export interface IQuickAccessRegistry {

	registerQuickAccessProvider(provider: IQuickAccessProviderDescriptor): IDisposable;

	getQuickAccessProviders(contextKeyService: IContextKeyService): IQuickAccessProviderDescriptor[];

	getQuickAccessProvider(prefix: string, contextKeyService: IContextKeyService): IQuickAccessProviderDescriptor | undefined;
}

export class QuickAccessRegistry implements IQuickAccessRegistry {

	private providers: IQuickAccessProviderDescriptor[] = [];
	private defaultProvider: IQuickAccessProviderDescriptor | undefined = undefined;

	registerQuickAccessProvider(provider: IQuickAccessProviderDescriptor): IDisposable {

		if (provider.prefix.length === 0) {
			this.defaultProvider = provider;
		} else {
			this.providers.push(provider);
		}

		this.providers.sort((providerA, providerB) => providerB.prefix.length - providerA.prefix.length);

		return toDisposable(() => {
			this.providers.splice(this.providers.indexOf(provider), 1);

			if (this.defaultProvider === provider) {
				this.defaultProvider = undefined;
			}
		});
	}

	getQuickAccessProviders(contextKeyService: IContextKeyService): IQuickAccessProviderDescriptor[] {
		return coalesce([this.defaultProvider, ...this.providers])
			.filter(provider => !provider.when || contextKeyService.contextMatchesRules(provider.when));
	}

	getQuickAccessProvider(prefix: string, contextKeyService: IContextKeyService): IQuickAccessProviderDescriptor | undefined {
		const result = prefix
			? this.providers.find(provider => prefix.startsWith(provider.prefix) && (!provider.when || contextKeyService.contextMatchesRules(provider.when)))
			: undefined;

		return result || this.defaultProvider;
	}

	clear(): Function {
		const providers = [...this.providers];
		const defaultProvider = this.defaultProvider;

		this.providers = [];
		this.defaultProvider = undefined;

		return () => {
			this.providers = providers;
			this.defaultProvider = defaultProvider;
		};
	}
}

Registry.add(Extensions.Quickaccess, new QuickAccessRegistry());
