/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from './dom.js';
import { Disposable } from '../common/lifecycle.js';
import { Mimes } from '../common/mime.js';

export class DelayedDragHandler extends Disposable {
	private timeout: Timeout | undefined = undefined;

	constructor(container: HTMLElement, callback: () => void) {
		super();

		this._register(addDisposableListener(container, 'dragover', e => {
			e.preventDefault();

			if (!this.timeout) {
				this.timeout = setTimeout(() => {
					callback();

					this.timeout = undefined;
				}, 800);
			}
		}));

		['dragleave', 'drop', 'dragend'].forEach(type => {
			this._register(addDisposableListener(container, type, () => {
				this.clearDragTimeout();
			}));
		});
	}

	private clearDragTimeout(): void {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = undefined;
		}
	}

	override dispose(): void {
		super.dispose();

		this.clearDragTimeout();
	}
}

export const DataTransfers = {

	RESOURCES: 'ResourceURLs',

	DOWNLOAD_URL: 'DownloadURL',

	FILES: 'Files',

	TEXT: Mimes.text,

	INTERNAL_URI_LIST: 'application/vnd.code.uri-list',
};

export interface IDragAndDropData {
	update(dataTransfer: DataTransfer): void;
	getData(): unknown;
}
