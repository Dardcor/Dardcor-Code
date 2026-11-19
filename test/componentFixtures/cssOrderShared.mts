/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const cliEntry = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/@vscode/component-explorer-cli/dist/index.js');

export interface FixtureEntry {
	readonly fixtureId: string;
	readonly imageHash?: string;
	readonly imagePath?: string;
	readonly background?: 'light' | 'dark';
	readonly labels?: readonly string[];
	readonly hasError?: boolean;
	readonly output?: { readonly stylesheetFiles?: readonly string[] };
}

export interface RenderResult {
	readonly entries: readonly FixtureEntry[];
	readonly targetDir: string;
}

export interface ReverseWindow {
	readonly fromIndex: number;
	readonly toIndex: number;
}

export async function readServeUrl(configPath: string): Promise<string | undefined> {
	const config = JSON.parse(await readFile(configPath, 'utf8'));
	const url = config.server?.url ?? config.sessions?.[0]?.server?.url;
	return typeof url === 'string' ? url.replace(/\/$/, '') : undefined;
}

export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function exactFixtureRegex(fixtureId: string): string {
	return `^${escapeRegex(fixtureId)}$`;
}

export class Renderer {
	private count = 0;
	private readonly configPath: string;
	private readonly configDir: string;
	private readonly probeRoot: string;

	constructor(configPath: string, probeRoot: string) {
		this.configPath = configPath;
		this.configDir = dirname(configPath);
		this.probeRoot = probeRoot;
	}

	async render(fixtureRegex: string, input: object, options?: { readonly useHashPaths?: boolean }): Promise<RenderResult> {
		const useHashPaths = options?.useHashPaths ?? true;
		const target = join(this.probeRoot, `r${this.count++}`);
		const args = [
			cliEntry, 'render',
			'-p', this.configPath,
			'--fixture-id-regex', fixtureRegex,
			'--target', target,
			'--input', JSON.stringify(input),
		];
		if (useHashPaths) {
			args.push('--useHashPaths');
		}
		await execFileAsync(process.execPath, args, { cwd: this.configDir, maxBuffer: 64 * 1024 * 1024 });

		const targetDir = isAbsolute(target) ? target : join(this.configDir, target);
		const manifest = JSON.parse(await readFile(join(targetDir, 'manifest.json'), 'utf8'));
		const entries: FixtureEntry[] = manifest.fixtures ?? [];
		return { entries, targetDir };
	}

	async hash(fixtureRegex: string, window: ReverseWindow): Promise<string> {
		const { entries } = await this.render(fixtureRegex, { reverseStylesheets: window });
		const hash = entries[0]?.imageHash;
		if (!hash) {
			throw new Error(`Render produced no image hash for ${fixtureRegex}`);
		}
		return hash;
	}
}

export type HashFn = (fromIndex: number, toIndex: number) => Promise<string>;

export async function findLastConflictStart(hash: HashFn, n: number, baseline: string): Promise<number> {
	let lo = 0;
	let hi = n;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (await hash(mid, n) !== baseline) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return lo;
}

export async function findFirstConflictEnd(hash: HashFn, n: number, baseline: string): Promise<number> {
	let lo = 0;
	let hi = n;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (await hash(0, mid) !== baseline) {
			hi = mid;
		} else {
			lo = mid;
		}
	}
	return hi;
}

export interface ConflictPair {
	readonly later: number;
	readonly earlier: number;
}

export async function bisectConflict(
	renderer: Renderer,
	fixtureId: string,
	n: number,
	baseline: string,
	onProbe?: (info: { fromIndex: number; toIndex: number; differs: boolean; ms: number }) => void,
): Promise<ConflictPair> {
	const rx = exactFixtureRegex(fixtureId);
	const hash: HashFn = async (fromIndex, toIndex) => {
		const started = Date.now();
		const h = await renderer.hash(rx, { fromIndex, toIndex });
		onProbe?.({ fromIndex, toIndex, differs: h !== baseline, ms: Date.now() - started });
		return h;
	};
	const later = await findLastConflictStart(hash, n, baseline);
	const earlier = (await findFirstConflictEnd(hash, n, baseline)) - 1;
	return { later, earlier };
}
