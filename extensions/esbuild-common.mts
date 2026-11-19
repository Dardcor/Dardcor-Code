/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'node:path';
import esbuild from 'esbuild';

export interface RunConfig {
	readonly srcDir: string;
	readonly outdir: string;
	readonly entryPoints: esbuild.BuildOptions['entryPoints'];
	readonly additionalOptions?: Partial<esbuild.BuildOptions>;
}

let pendingBuilds = 0;

async function buildOnce(options: esbuild.BuildOptions): Promise<esbuild.BuildResult> {
	pendingBuilds++;
	try {
		return await esbuild.build(options);
	} finally {
		if (--pendingBuilds === 0) {
			esbuild.stop();
		}
	}
}

export async function runBuild(
	config: RunConfig,
	baseOptions: esbuild.BuildOptions,
	args: string[],
	didBuild?: (outDir: string) => unknown,
): Promise<void> {
	let outdir = config.outdir;
	const outputRootIndex = args.indexOf('--outputRoot');
	if (outputRootIndex >= 0) {
		const outputRoot = args[outputRootIndex + 1];
		const outputDirName = path.basename(outdir);
		outdir = path.join(outputRoot, outputDirName);
	}

	const resolvedOptions: esbuild.BuildOptions = {
		...baseOptions,
		entryPoints: config.entryPoints,
		outdir,
		...(config.additionalOptions || {}),
	};

	const isWatch = args.indexOf('--watch') >= 0;
	if (isWatch) {
		await watchWithParcel(resolvedOptions, config.srcDir, () => didBuild?.(outdir));
	} else {
		try {
			await buildOnce(resolvedOptions);
			await didBuild?.(outdir);
		} catch {
			process.exit(1);
		}
	}
}

async function watchWithParcel(options: esbuild.BuildOptions, srcDir: string, didBuild?: () => Promise<unknown> | unknown): Promise<void> {
	let debounce: ReturnType<typeof setTimeout> | undefined;
	const rebuild = () => {
		if (debounce) {
			clearTimeout(debounce);
		}
		debounce = setTimeout(async () => {
			try {
				const result = await buildOnce(options);
				if (result.errors.length === 0) {
					await didBuild?.();
				}
			} catch (error) {
				console.error('[watch] build error:', error);
			}
		}, 100);
	};

	const watcher = await import('@parcel/watcher');
	const ignore = ['**/node_modules/**', '**/dist/**', '**/out/**'];
	if (options.outdir) {
		const outdirGlob = options.outdir.replace(/\\/g, '/').replace(/\/$/, '');
		ignore.push(outdirGlob, `${outdirGlob}/**`);
	}
	await watcher.subscribe(srcDir, (_err, _events) => {
		rebuild();
	}, {
		ignore
	});
	rebuild();
}
