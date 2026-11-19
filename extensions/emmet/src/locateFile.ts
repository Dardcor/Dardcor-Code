/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/




import * as path from 'path';
import * as fs from 'fs';

const reAbsolutePosix = /^\/+/;
const reAbsoluteWin32 = /^\\+/;
const reAbsolute = path.sep === '/' ? reAbsolutePosix : reAbsoluteWin32;

export function locateFile(base: string, filePath: string): Promise<string> {
	if (/^\w+:/.test(filePath)) {
		return Promise.resolve(filePath);
	}

	filePath = path.normalize(filePath);

	return reAbsolute.test(filePath)
		? resolveAbsolute(base, filePath)
		: resolveRelative(base, filePath);
}

function resolveRelative(basePath: string, filePath: string): Promise<string> {
	return tryFile(path.resolve(basePath, filePath));
}

function resolveAbsolute(basePath: string, filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		filePath = filePath.replace(reAbsolute, '');

		const next = (ctx: string) => {
			tryFile(path.resolve(ctx, filePath))
				.then(resolve, () => {
					const dir = path.dirname(ctx);
					if (!dir || dir === ctx) {
						return reject(`Unable to locate absolute file ${filePath}`);
					}

					next(dir);
				});
		};

		next(basePath);
	});
}

function tryFile(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.stat(file, (err, stat) => {
			if (err) {
				return reject(err);
			}

			if (!stat.isFile()) {
				return reject(new Error(`${file} is not a file`));
			}

			resolve(file);
		});
	});
}
