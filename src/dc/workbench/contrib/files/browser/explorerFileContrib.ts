/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

export const enum ExplorerExtensions {
	FileContributionRegistry = 'workbench.registry.explorer.fileContributions'
}

export interface IExplorerFileContribution extends IDisposable {
	setResource(resource: URI | undefined): void;
}

export interface IExplorerFileContributionDescriptor {
	create(insta: IInstantiationService, container: HTMLElement): IExplorerFileContribution;
}

export interface IExplorerFileContributionRegistry {
	register(descriptor: IExplorerFileContributionDescriptor): void;
}

class ExplorerFileContributionRegistry extends Disposable implements IExplorerFileContributionRegistry {
	private readonly _onDidRegisterDescriptor = this._register(new Emitter<IExplorerFileContributionDescriptor>());
	public readonly onDidRegisterDescriptor = this._onDidRegisterDescriptor.event;

	private readonly descriptors: IExplorerFileContributionDescriptor[] = [];

	public register(descriptor: IExplorerFileContributionDescriptor): void {
		this.descriptors.push(descriptor);
		this._onDidRegisterDescriptor.fire(descriptor);
	}

	public create(insta: IInstantiationService, container: HTMLElement, store: DisposableStore): IExplorerFileContribution[] {
		return this.descriptors.map(d => {
			const i = d.create(insta, container);
			store.add(i);
			return i;
		});
	}
}

export const explorerFileContribRegistry = new ExplorerFileContributionRegistry();
Registry.add(ExplorerExtensions.FileContributionRegistry, explorerFileContribRegistry);
