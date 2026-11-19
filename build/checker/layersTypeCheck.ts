/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { createRequire } from 'module';
import { availableParallelism, freemem } from 'os';
import { dirname, join } from 'path';


const PROJECTS = [
	'browser',
	'worker',
	'node',
	'electron-browser',
	'electron-main',
	'electron-utility',
];

const MEMORY_PER_CHECK = 4 * 1024 * 1024 * 1024;

const MEMORY_HEADROOM = 0.25;

const tscPath = join(dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin', 'tsc');

function getConcurrency(): number {
	const affordableChecks = Math.floor(freemem() * (1 - MEMORY_HEADROOM) / MEMORY_PER_CHECK);

	return Math.max(1, Math.min(PROJECTS.length, availableParallelism(), affordableChecks));
}

function typeCheck(project: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = cp.spawn(process.execPath, [tscPath, '--project', join(import.meta.dirname, `tsconfig.${project}.json`), '--pretty', 'false'], { stdio: ['ignore', 'pipe', 'pipe'] });

		let output = '';
		child.stdout.on('data', data => output += data.toString());
		child.stderr.on('data', data => output += data.toString());

		child.on('error', reject);
		child.on('close', code => resolve(code === 0 ? '' : output.trim() || `tsc exited with code ${code ?? 'unknown'}.`));
	});
}

async function typeCheckAll(projects: readonly string[], concurrency: number): Promise<string[]> {
	const results: string[] = [];
	let next = 0;

	async function runNext(): Promise<void> {
		while (next < projects.length) {
			const index = next++;
			results[index] = await typeCheck(projects[index]);
		}
	}

	await Promise.all(Array.from({ length: concurrency }, runNext));

	return results;
}

const results = await typeCheckAll(PROJECTS, getConcurrency());

for (const result of results) {
	if (result) {
		console.log(result);
	}
}

process.exitCode = results.some(result => result) ? 1 : 0;
