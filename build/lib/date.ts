/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.join(import.meta.dirname, '..', '..');

export function getGitCommitDate(): string {
	try {
		return execSync('git log -1 --format=%cI HEAD', { cwd: root, encoding: 'utf8' }).trim();
	} catch {
		return new Date().toISOString();
	}
}

export function writeISODate(outDir: string) {
	const result = () => new Promise<void>((resolve, _) => {
		const outDirectory = path.join(root, outDir);
		fs.mkdirSync(outDirectory, { recursive: true });

		const date = getGitCommitDate();
		fs.writeFileSync(path.join(outDirectory, 'date'), date, 'utf8');

		resolve();
	});
	result.taskName = 'build-date-file';
	return result;
}

export function readISODate(outDir: string): string {
	const outDirectory = path.join(root, outDir);
	try {
		return fs.readFileSync(path.join(outDirectory, 'date'), 'utf8');
	} catch {
		if (outDir !== 'out-build') {
			return fs.readFileSync(path.join(root, 'out-build', 'date'), 'utf8');
		}
		throw new Error(`Could not find date file in ${outDir}`);
	}
}
