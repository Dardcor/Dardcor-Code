/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs/promises';
import path from 'node:path';

export async function readFile(filename: string): Promise<Uint8Array> {
	return await fs.readFile(locateFile(filename));
}

export function locateFile(filename: string): string {
	return path.resolve(
		path.extname(__filename) === '.ts' ? path.join(locationInPath(path.dirname(__dirname), 'src'), '..', 'dist') : locationInPath(__dirname, 'dist'),
		filename
	);
}

function locationInPath(filePath: string, directoryName: string): string {
	let p = filePath;
	while (path.basename(p) !== directoryName) {
		if (path.dirname(p) === p) {
			return filePath;
		}
		p = path.dirname(p);
	}
	return p;
}

