/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { DeferredPromise } from '../../../util/dardcor/base/common/async';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { isEqualOrParent } from '../../../util/dardcor/base/common/resources';
import { URI } from '../../../util/dardcor/base/common/uri';

export class ExternalEditTracker {
	private _ongoingEdits = new Map<string, { complete: () => void; onDidComplete: Thenable<string> }>();

	constructor(
		private readonly ignoreDirectories: URI[] = []
	) { }

	public async trackEdit(
		editKey: string,
		uris: vscode.Uri[],
		stream: vscode.ChatResponseStream,
		token?: CancellationToken
	): Promise<void> {
		const filteredUris = uris.filter(uri => {
			const uriAsURI = URI.isUri(uri) ? uri : URI.from(uri);
			return !this.ignoreDirectories.some(ignoreDir => isEqualOrParent(uriAsURI, ignoreDir));
		});

		if (!filteredUris.length || token?.isCancellationRequested) {
			return;
		}

		return new Promise(proceedWithEdit => {
			const deferred = new DeferredPromise<void>();
			let cancelListen: IDisposable | undefined;

			if (token) {
				cancelListen = token.onCancellationRequested(() => {
					this._ongoingEdits.delete(editKey);
					deferred.complete();
				});
			}

			const onDidComplete = stream.externalEdit(filteredUris, async () => {
				proceedWithEdit();
				await deferred.p;
				cancelListen?.dispose();
			});

			this._ongoingEdits.set(editKey, {
				onDidComplete,
				complete: () => deferred.complete()
			});
		});
	}

	public async completeEdit(editKey: string): Promise<string | undefined> {
		const ongoingEdit = this._ongoingEdits.get(editKey);
		if (ongoingEdit) {
			this._ongoingEdits.delete(editKey);
			ongoingEdit.complete();
			return await ongoingEdit.onDidComplete;
		}
	}
}
