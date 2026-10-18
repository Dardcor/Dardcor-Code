/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../platform/log/common/log.js';

export const IServerLifetimeService = createDecorator<IServerLifetimeService>('serverLifetimeService');

export const SHUTDOWN_TIMEOUT = 5 * 60 * 1000;

export interface IServerLifetimeOptions {
	readonly enableAutoShutdown?: boolean;
	readonly shutdownWithoutDelay?: boolean;
}

export interface IServerLifetimeService {
	readonly _serviceBrand: undefined;

	active(consumer: string): IDisposable;

	delay(): void;

	readonly hasActiveConsumers: boolean;
}

export class ServerLifetimeService extends Disposable implements IServerLifetimeService {
	declare readonly _serviceBrand: undefined;

	private readonly _consumers = new Map<string, number>();
	private _totalCount = 0;
	private _shutdownTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _options: IServerLifetimeOptions,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		if (this._options.enableAutoShutdown) {
			this._scheduleShutdown(true);
		}
	}

	get hasActiveConsumers(): boolean {
		return this._totalCount > 0;
	}

	active(consumer: string): IDisposable {
		const wasEmpty = this._totalCount === 0;
		const current = this._consumers.get(consumer) ?? 0;
		this._consumers.set(consumer, current + 1);
		this._totalCount++;

		this._logService.debug(`ServerLifetime: consumer '${consumer}' active (total: ${this._totalCount})`);

		if (wasEmpty) {
			this._cancelShutdown();
		}

		let disposed = false;
		return toDisposable(() => {
			if (disposed) {
				return;
			}
			disposed = true;

			const count = this._consumers.get(consumer);
			if (count !== undefined) {
				if (count <= 1) {
					this._consumers.delete(consumer);
				} else {
					this._consumers.set(consumer, count - 1);
				}
			}
			this._totalCount--;

			this._logService.debug(`ServerLifetime: consumer '${consumer}' inactive (total: ${this._totalCount})`);

			if (this._totalCount === 0 && this._options.enableAutoShutdown) {
				this._scheduleShutdown(false);
			}
		});
	}

	delay(): void {
		if (this._shutdownTimer) {
			this._logService.debug('ServerLifetime: delay requested, resetting shutdown timer');
			this._cancelShutdown();
			this._scheduleShutdown(false);
		}
	}

	private _scheduleShutdown(initial: boolean): void {
		if (this._options.shutdownWithoutDelay && !initial) {
			this._tryShutdown();
		} else {
			this._logService.debug('ServerLifetime: scheduling shutdown timer');
			this._shutdownTimer = setTimeout(() => {
				this._shutdownTimer = undefined;
				this._tryShutdown();
			}, SHUTDOWN_TIMEOUT);
		}
	}

	private _tryShutdown(): void {
		if (this._totalCount > 0) {
			this._logService.debug('ServerLifetime: consumer became active, aborting shutdown');
			return;
		}
		console.log('All consumers inactive, shutting down');
		this._logService.info('ServerLifetime: all consumers inactive, shutting down');
		this.dispose();
		process.exit(0);
	}

	private _cancelShutdown(): void {
		if (this._shutdownTimer) {
			this._logService.debug('ServerLifetime: cancelling shutdown timer');
			clearTimeout(this._shutdownTimer);
			this._shutdownTimer = undefined;
		}
	}
}
