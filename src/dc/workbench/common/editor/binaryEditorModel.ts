/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorModel } from './editorModel.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { Mimes } from '../../../base/common/mime.js';

export class BinaryEditorModel extends EditorModel {

	private readonly mime = Mimes.binary;

	private size: number | undefined;
	private etag: string | undefined;

	constructor(
		readonly resource: URI,
		private readonly name: string,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	getName(): string {
		return this.name;
	}

	getSize(): number | undefined {
		return this.size;
	}

	getMime(): string {
		return this.mime;
	}

	getETag(): string | undefined {
		return this.etag;
	}

	override async resolve(): Promise<void> {

		if (this.fileService.hasProvider(this.resource)) {
			const stat = await this.fileService.stat(this.resource);
			this.etag = stat.etag;
			if (typeof stat.size === 'number') {
				this.size = stat.size;
			}
		}

		return super.resolve();
	}
}
