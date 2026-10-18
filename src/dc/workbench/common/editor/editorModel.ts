/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';

export class EditorModel extends Disposable {

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	private resolved = false;

	async resolve(): Promise<void> {
		this.resolved = true;
	}

	isResolved(): boolean {
		return this.resolved;
	}

	isDisposed(): boolean {
		return this._store.isDisposed;
	}

	override dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}
