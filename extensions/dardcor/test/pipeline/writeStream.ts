/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

export function openWriteStream(filePath: string): {
	write: (data: string) => Promise<void>;
	close: () => Promise<void>;
} {
	const stream = fs.createWriteStream(filePath);
	let fatalError: Error | undefined;
	let closed = false;
	stream.on('error', err => {
		fatalError = err;
	});

	return {
		write(data: string): Promise<void> {
			if (fatalError) {
				return Promise.reject(fatalError);
			}
			return new Promise<void>((resolve, reject) => {
				stream.write(data, err => {
					if (err) {
						reject(err);
					} else if (fatalError) {
						reject(fatalError);
					} else {
						resolve();
					}
				});
			});
		},
		close(): Promise<void> {
			if (closed) {
				return Promise.resolve();
			}
			closed = true;
			return new Promise<void>((resolve, reject) => {
				stream.end(() => {
					if (fatalError) {
						reject(fatalError);
					} else {
						resolve();
					}
				});
			});
		},
	};
}
