/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname, join } from '../../../../base/common/path.js';
import { Promises } from '../../../../base/node/pfs.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

export class CodeCacheCleaner extends Disposable {

	private readonly dataMaxAge: number;

	constructor(
		currentCodeCachePath: string | undefined,
		@IProductService productService: IProductService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.dataMaxAge = productService.quality !== 'stable'
			? 1000 * 60 * 60 * 24 * 7
			: 1000 * 60 * 60 * 24 * 30 * 3;

		if (currentCodeCachePath) {
			const scheduler = this._register(new RunOnceScheduler(() => {
				this.cleanUpCodeCaches(currentCodeCachePath);
			}, 30 * 1000 ));
			scheduler.schedule();
		}
	}

	private async cleanUpCodeCaches(currentCodeCachePath: string): Promise<void> {
		this.logService.trace('[code cache cleanup]: Starting to clean up old code cache folders.');

		try {
			const now = Date.now();

			const codeCacheRootPath = dirname(currentCodeCachePath);
			const currentCodeCache = basename(currentCodeCachePath);

			const codeCaches = await Promises.readdir(codeCacheRootPath);
			await Promise.all(codeCaches.map(async codeCache => {
				if (codeCache === currentCodeCache) {
					return;
				}

				const codeCacheEntryPath = join(codeCacheRootPath, codeCache);
				const codeCacheEntryStat = await promises.stat(codeCacheEntryPath);
				if (codeCacheEntryStat.isDirectory() && (now - codeCacheEntryStat.mtime.getTime()) > this.dataMaxAge) {
					this.logService.trace(`[code cache cleanup]: Removing code cache folder ${codeCache}.`);

					return Promises.rm(codeCacheEntryPath);
				}
			}));
		} catch (error) {
			onUnexpectedError(error);
		}
	}
}
