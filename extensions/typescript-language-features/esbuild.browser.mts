/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist', 'browser');

const languages = [
	'zh-tw',
	'cs',
	'de',
	'es',
	'fr',
	'it',
	'ja',
	'ko',
	'pl',
	'pt-br',
	'ru',
	'tr',
	'zh-cn',
];

async function copyTypescriptLibFiles(outDir: string): Promise<void> {
	try {
		const typescriptLibDir = path.join(import.meta.dirname, '..', 'node_modules', 'typescript', 'lib');
		const destDir = path.join(outDir, 'typescript');

		await fs.promises.mkdir(destDir, { recursive: true });

		const libFiles = await fs.promises.readdir(typescriptLibDir);
		for (const file of libFiles) {
			if (file.endsWith('.d.ts')) {
				await fs.promises.copyFile(path.join(typescriptLibDir, file), path.join(destDir, file));
			}
		}

		await fs.promises.copyFile(path.join(typescriptLibDir, 'typesMap.json'), path.join(destDir, 'typesMap.json'));

		for (const lang of languages) {
			const langSrcDir = path.join(typescriptLibDir, lang);
			const langDestDir = path.join(destDir, lang);
			try {
				await fs.promises.mkdir(langDestDir, { recursive: true });
				const langFiles = await fs.promises.readdir(langSrcDir);
				for (const file of langFiles) {
					const srcPath = path.join(langSrcDir, file);
					const destPath = path.join(langDestDir, file);
					const stat = await fs.promises.stat(srcPath);
					if (stat.isFile()) {
						await fs.promises.copyFile(srcPath, destPath);
					}
				}
			} catch {
			}
		}
	} catch (error) {
		console.error('Error copying TypeScript lib files:', error);
		throw error;
	}
}


await Promise.all([
	run({
		platform: 'browser',
		entryPoints: {
			'extension': path.join(srcDir, 'extension.browser.ts'),
		},
		srcDir,
		outdir: outDir,
		additionalOptions: {
			loader: { '.wasm': 'dataurl' },
			tsconfig: path.join(import.meta.dirname, 'tsconfig.browser.json'),
		},
	}, process.argv, copyTypescriptLibFiles),

	run({
		platform: 'browser',
		entryPoints: {
			'typescript/tsserver.web': path.join(import.meta.dirname, 'web', 'src', 'webServer.ts'),
		},
		srcDir: path.join(import.meta.dirname, 'web', 'src'),
		outdir: outDir,
		additionalOptions: {
			tsconfig: path.join(import.meta.dirname, 'web', 'tsconfig.json'),
			external: ['perf_hooks'],
			loader: { '.wasm': 'dataurl' },
		},
	}, process.argv),
]);
