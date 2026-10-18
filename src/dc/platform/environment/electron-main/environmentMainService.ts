/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memoize } from '../../../base/common/decorators.js';
import { join } from '../../../base/common/path.js';
import { isLinux } from '../../../base/common/platform.js';
import { createStaticIPCHandle } from '../../../base/parts/ipc/node/ipc.net.js';
import { IEnvironmentService, INativeEnvironmentService } from '../common/environment.js';
import { NativeEnvironmentService } from '../node/environmentService.js';
import { refineServiceDecorator } from '../../instantiation/common/instantiation.js';

export const IEnvironmentMainService = refineServiceDecorator<IEnvironmentService, IEnvironmentMainService>(IEnvironmentService);

export interface IEnvironmentMainService extends INativeEnvironmentService {

	readonly backupHome: string;

	readonly codeCachePath: string | undefined;
	readonly useCodeCache: boolean;

	readonly mainIPCHandle: string;
	readonly mainLockfile: string;

	readonly disableUpdates: boolean;
	readonly isPortable: boolean;

	readonly enableRDPDisplayTracking: boolean;

	unsetSnapExportedVariables(): void;
	restoreSnapExportedVariables(): void;
}

export class EnvironmentMainService extends NativeEnvironmentService implements IEnvironmentMainService {

	private _snapEnv: Record<string, string> = {};

	@memoize
	get backupHome(): string { return join(this.userDataPath, 'Backups'); }

	@memoize
	get mainIPCHandle(): string { return createStaticIPCHandle(this.userDataPath, 'main', this.productService.version); }

	@memoize
	get mainLockfile(): string { return join(this.userDataPath, 'code.lock'); }

	@memoize
	get disableUpdates(): boolean { return !!this.args['disable-updates']; }

	@memoize
	get isPortable(): boolean { return !!process.env['VSCODE_PORTABLE']; }

	@memoize
	get crossOriginIsolated(): boolean { return !!this.args['enable-coi']; }

	@memoize
	get enableRDPDisplayTracking(): boolean { return !!this.args['enable-rdp-display-tracking']; }

	@memoize
	get codeCachePath(): string | undefined { return process.env['VSCODE_CODE_CACHE_PATH'] || undefined; }

	@memoize
	get useCodeCache(): boolean { return !!this.codeCachePath; }

	unsetSnapExportedVariables() {
		if (!isLinux) {
			return;
		}
		for (const key in process.env) {
			if (key.endsWith('_VSCODE_SNAP_ORIG')) {
				const originalKey = key.slice(0, -17);
				if (this._snapEnv[originalKey]) {
					continue;
				}
				if (process.env[originalKey]) {
					this._snapEnv[originalKey] = process.env[originalKey]!;
				}
				if (process.env[key]) {
					process.env[originalKey] = process.env[key];
				} else {
					delete process.env[originalKey];
				}
			}
		}
	}

	restoreSnapExportedVariables() {
		if (!isLinux) {
			return;
		}
		for (const key in this._snapEnv) {
			process.env[key] = this._snapEnv[key];
			delete this._snapEnv[key];
		}
	}
}
