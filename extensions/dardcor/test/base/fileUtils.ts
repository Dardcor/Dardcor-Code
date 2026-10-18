/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';

export async function readFileIfExists(filePath: string): Promise<string | undefined> {
	try {
		const fileContents = await fs.promises.readFile(filePath, 'utf8');
		return fileContents;
	} catch (err) {
		if (err.code === 'ENOENT') {
			return undefined;
		}
		throw err;
	}
}
