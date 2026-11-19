/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout, RunOnceScheduler, runWhenGlobalIdle } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { userActivityRegistry } from './userActivityRegistry.js';

export interface IMarkActiveOptions {
	whenHeldFor?: number;
	extendOnly?: boolean;
}

export interface IUserActivityService {
	_serviceBrand: undefined;

	readonly isActive: boolean;

	readonly onDidChangeIsActive: Event<boolean>;

	markActive(opts?: IMarkActiveOptions): IDisposable;
}

const MARK_INACTIVE_DEBOUNCE = 10_000;

export const IUserActivityService = createDecorator<IUserActivityService>('IUserActivityService');

export class UserActivityService extends Disposable implements IUserActivityService {
	declare readonly _serviceBrand: undefined;
	private readonly markInactive = this._register(new RunOnceScheduler(() => {
		this.isActive = false;
		this.changeEmitter.fire(false);
	}, MARK_INACTIVE_DEBOUNCE));

	private readonly changeEmitter = this._register(new Emitter<boolean>);
	private active = 0;

	public isActive = true;

	readonly onDidChangeIsActive: Event<boolean> = this.changeEmitter.event;

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super();
		this._register(runWhenGlobalIdle(() => userActivityRegistry.take(this, instantiationService)));
	}

	markActive(opts?: IMarkActiveOptions): IDisposable {
		if (opts?.extendOnly && !this.isActive) {
			return Disposable.None;
		}

		if (opts?.whenHeldFor) {
			const store = new DisposableStore();
			store.add(disposableTimeout(() => store.add(this.markActive()), opts.whenHeldFor));
			return store;
		}

		if (++this.active === 1) {
			this.isActive = true;
			this.changeEmitter.fire(true);
			this.markInactive.cancel();
		}

		return toDisposable(() => {
			if (--this.active === 0) {
				this.markInactive.schedule();
			}
		});
	}
}

registerSingleton(IUserActivityService, UserActivityService, InstantiationType.Delayed);
