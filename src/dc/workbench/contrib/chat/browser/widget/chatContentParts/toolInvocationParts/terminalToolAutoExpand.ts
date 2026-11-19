/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { disposableTimeout } from '../../../../../../../base/common/async.js';

export interface ITerminalToolAutoExpandOptions {
	readonly onCommandExecuted: Event<unknown>;

	readonly onCommandFinished: Event<unknown>;

	readonly onWillData: Event<unknown>;

	shouldAutoExpand(): boolean;

	hasRealOutput(): boolean;
}

export const enum TerminalToolAutoExpandTimeout {
	NoData = 500,
	DataEvent = 50,
}

export class TerminalToolAutoExpand extends Disposable {
	private _commandFinished = false;
	private _receivedData = false;
	private readonly _dataEventTimeout = this._register(new MutableDisposable());
	private readonly _noDataTimeout = this._register(new MutableDisposable());

	private readonly _onDidRequestExpand = this._register(new Emitter<void>());
	readonly onDidRequestExpand: Event<void> = this._onDidRequestExpand.event;

	constructor(
		private readonly _options: ITerminalToolAutoExpandOptions,
	) {
		super();
		this._setupListeners();
	}

	private _setupListeners(): void {
		const store = this._register(new DisposableStore());

		store.add(this._options.onCommandExecuted(() => {
			if (this._options.shouldAutoExpand() && !this._noDataTimeout.value) {
				this._noDataTimeout.value = disposableTimeout(() => {
					this._noDataTimeout.clear();
					const shouldExpand = this._options.shouldAutoExpand();
					const hasOutput = this._options.hasRealOutput();
					if (shouldExpand && hasOutput) {
						this._dataEventTimeout.clear();
						this._onDidRequestExpand.fire();
					}
				}, TerminalToolAutoExpandTimeout.NoData, store);
			}
		}));

		store.add(this._options.onWillData(() => {
			if (this._receivedData) {
				return;
			}
			this._receivedData = true;
			if (this._options.shouldAutoExpand() && !this._dataEventTimeout.value) {
				this._dataEventTimeout.value = disposableTimeout(() => {
					this._dataEventTimeout.clear();
					const shouldExpand = this._options.shouldAutoExpand();
					const hasOutput = this._options.hasRealOutput();
					if (!this._commandFinished && shouldExpand && hasOutput) {
						this._noDataTimeout.clear();
						this._onDidRequestExpand.fire();
					}
				}, TerminalToolAutoExpandTimeout.DataEvent, store);
			}
		}));

		store.add(this._options.onCommandFinished(() => {
			this._commandFinished = true;
			this._clearAutoExpandTimeouts();
		}));
	}

	private _clearAutoExpandTimeouts(): void {
		this._dataEventTimeout.clear();
		this._noDataTimeout.clear();
	}
}
