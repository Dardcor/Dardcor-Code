/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { tmpdir } from 'os';
import { Queue } from '../../../base/common/async.js';
import { randomPath } from '../../../base/common/extpath.js';
import { resolveTerminalEncoding } from '../../../base/node/terminalEncoding.js';

export function hasStdinWithoutTty() {
	try {
		return !process.stdin.isTTY;
	} catch {
	}
	return false;
}

export function stdinDataListener(durationinMs: number): Promise<boolean> {
	return new Promise(resolve => {
		const dataListener = () => resolve(true);

		setTimeout(() => {
			process.stdin.removeListener('data', dataListener);

			resolve(false);
		}, durationinMs);

		process.stdin.once('data', dataListener);
	});
}

export function getStdinFilePath(): string {
	return randomPath(tmpdir(), 'code-stdin', 3);
}

async function createStdInFile(targetPath: string) {
	await fs.promises.appendFile(targetPath, '');
	await fs.promises.chmod(targetPath, 0o600);
}

export async function readFromStdin(targetPath: string, verbose: boolean, onEnd?: Function): Promise<void> {

	let [encoding, iconv] = await Promise.all([
		resolveTerminalEncoding(verbose),
		import('@vscode/iconv-lite-umd'),
		createStdInFile(targetPath)
	]);

	if (!iconv.default.encodingExists(encoding)) {
		console.log(`Unsupported terminal encoding: ${encoding}, falling back to UTF-8.`);
		encoding = 'utf8';
	}


	const appendFileQueue = new Queue();

	const decoder = iconv.default.getDecoder(encoding);

	process.stdin.on('data', chunk => {
		const chunkStr = decoder.write(chunk);
		appendFileQueue.queue(() => fs.promises.appendFile(targetPath, chunkStr));
	});

	process.stdin.on('end', () => {
		const end = decoder.end();

		appendFileQueue.queue(async () => {
			try {
				if (typeof end === 'string') {
					await fs.promises.appendFile(targetPath, end);
				}
			} finally {
				onEnd?.();
			}
		});
	});
}
