/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse } from '../../../base/common/path.js';
import { debounce, throttle } from '../../../base/common/decorators.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ProcessItem } from '../../../base/common/processes.js';
import { listProcesses } from '../../../base/node/ps.js';
import { ILogService } from '../../log/common/log.js';

const enum Constants {
	InactiveThrottleDuration = 5000,
	ActiveDebounceDuration = 1000,
}

export const ignoreProcessNames: string[] = [];

export class ChildProcessMonitor extends Disposable {
	private _hasChildProcesses: boolean = false;
	private set hasChildProcesses(value: boolean) {
		if (this._hasChildProcesses !== value) {
			this._hasChildProcesses = value;
			this._logService.debug('ChildProcessMonitor: Has child processes changed', value);
			this._onDidChangeHasChildProcesses.fire(value);
		}
	}
	get hasChildProcesses(): boolean { return this._hasChildProcesses; }

	private readonly _onDidChangeHasChildProcesses = this._register(new Emitter<boolean>());
	readonly onDidChangeHasChildProcesses = this._onDidChangeHasChildProcesses.event;

	constructor(
		private _pid: number,
		@ILogService private readonly _logService: ILogService
	) {
		super();
	}

	setPid(pid: number): void {
		this._pid = pid;
	}

	handleInput() {
		this._refreshActive();
	}

	handleOutput() {
		this._refreshInactive();
	}

	@debounce(Constants.ActiveDebounceDuration)
	private async _refreshActive(): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}
		try {
			const processItem = await listProcesses(this._pid);
			this.hasChildProcesses = this._processContainsChildren(processItem);
		} catch (e) {
			this._logService.debug('ChildProcessMonitor: Fetching process tree failed', e);
		}
	}

	@throttle(Constants.InactiveThrottleDuration)
	private _refreshInactive(): void {
		this._refreshActive();
	}

	private _processContainsChildren(processItem: ProcessItem): boolean {
		if (!processItem.children) {
			return false;
		}

		if (processItem.children.length === 1) {
			const item = processItem.children[0];
			let cmd: string;
			if (item.cmd.startsWith(`"`)) {
				cmd = item.cmd.substring(1, item.cmd.indexOf(`"`, 1));
			} else {
				const spaceIndex = item.cmd.indexOf(` `);
				if (spaceIndex === -1) {
					cmd = item.cmd;
				} else {
					cmd = item.cmd.substring(0, spaceIndex);
				}
			}
			return ignoreProcessNames.indexOf(parse(cmd).name) === -1;
		}

		return processItem.children.length > 0;
	}
}
