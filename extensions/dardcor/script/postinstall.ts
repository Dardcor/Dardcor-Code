/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { compressTikToken } from './build/compressTikToken';
import { copyStaticAssets } from './build/copyStaticAssets';

export interface ITreeSitterGrammar {
	name: string;
	filename?: string;
	projectPath?: string;
}

const treeSitterGrammars: ITreeSitterGrammar[] = [
	{
		name: 'tree-sitter-c-sharp',
		filename: 'tree-sitter-c_sharp.wasm'
	},
	{
		name: 'tree-sitter-cpp',
	},
	{
		name: 'tree-sitter-go',
	},
	{
		name: 'tree-sitter-javascript',
	},
	{
		name: 'tree-sitter-python',
	},
	{
		name: 'tree-sitter-ruby',
	},
	{
		name: 'tree-sitter-typescript',
		projectPath: 'tree-sitter-typescript/typescript',
	},
	{
		name: 'tree-sitter-tsx',
		projectPath: 'tree-sitter-typescript/tsx',
	},
	{
		name: 'tree-sitter-java',
	},
	{
		name: 'tree-sitter-rust',
	},
	{
		name: 'tree-sitter-php'
	}
];

const REPO_ROOT = path.join(__dirname, '..');

async function createClaudeSymlinks() {
	if (process.platform === 'win32' || process.env.CI) {
		return;
	}

	console.log('Creating symlinks for Claude session storage and instructions...');
	const claudeDir = path.join(REPO_ROOT, '.claude');
	await fs.promises.mkdir(claudeDir, { recursive: true });

	const symlinks: { link: string; target: string }[] = [
		{ link: path.join(claudeDir, 'CLAUDE.md'), target: path.join('..', '.github', 'dardcor-instructions.md') },
		{ link: path.join(claudeDir, 'skills'), target: path.join('..', '.agents', 'skills') },
	];

	for (const { link, target } of symlinks) {
		if (!fs.existsSync(link)) {
			await fs.promises.symlink(target, link);
		}
	}
}

async function main() {
	await fs.promises.mkdir(path.join(REPO_ROOT, '.build'), { recursive: true });

	await createClaudeSymlinks();

	const vendoredTiktokenFiles = ['src/platform/tokenizer/node/cl100k_base.tiktoken', 'src/platform/tokenizer/node/o200k_base.tiktoken'];

	for (const tokens of vendoredTiktokenFiles) {
		await compressTikToken(tokens, `dist/${path.basename(tokens)}`);
	}

	await copyStaticAssets([
		...treeSitterGrammars.map(grammar => `node_modules/@vscode/tree-sitter-wasm/wasm/${grammar.name}.wasm`),
		'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm',
		'node_modules/@github/blackbird-external-ingest-utils/pkg/nodejs/external_ingest_utils_bg.wasm',
	], 'dist');

	const baseCachePath = path.join('test', 'simulation', 'cache', 'base.sqlite');
	if (!fs.existsSync(baseCachePath)) {
		console.warn(`Warning: Base cache file does not exist at ${baseCachePath}. Please ensure that you have git lfs installed and initialized before the repository is cloned.`);
	}

	await copyStaticAssets([
		`node_modules/@anthropic-ai/claude-agent-sdk/cli.js`,
	], 'dist');
}

main();
