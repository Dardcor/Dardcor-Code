/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Transform } from 'stream';

export class StreamSplitter extends Transform {
	private prefix: Buffer[] = [];
	private readonly splitter: number;

	protected splitSuffix = Buffer.alloc(0);

	constructor(splitter: string | number | Buffer) {
		super();
		if (typeof splitter === 'string' && splitter.length === 1) {
			this.splitter = splitter.charCodeAt(0);
		} else if (typeof splitter === 'number') {
			this.splitter = splitter;
		} else {
			throw new Error('not implemented here');
		}
	}

	override _transform(
		chunk: Buffer,
		_encoding: string,
		callback: (error?: Error | null, data?: unknown) => void,
	): void {
		let offset = 0;
		while (offset < chunk.length) {
			const index = chunk.indexOf(this.splitter, offset);
			if (index === -1) {
				break;
			}

			const thisChunk = chunk.subarray(offset, index);
			const toEmit =
				this.prefix.length || this.splitSuffix.length
					? Buffer.concat([...this.prefix, thisChunk, this.splitSuffix])
					: thisChunk;

			this.push(toEmit);
			this.prefix.length = 0;
			offset = index + 1;
		}

		if (offset < chunk.length) {
			this.prefix.push(chunk.subarray(offset));
		}

		callback();
	}

	override _flush(callback: (error?: Error | null, data?: unknown) => void): void {
		if (this.prefix.length) {
			this.push(Buffer.concat([...this.prefix, this.splitSuffix]));
		}

		callback();
	}
}
