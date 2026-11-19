/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as fs from 'fs';
import * as path from 'path';
import {
	buildCdnUrlTemplate,
	getRuntimeTargetForBuild,
	getRuntimeVersion,
	type IDictationRuntimeResult,
	KNOWN_VSCODE_PLATFORMS,
	parseFlags,
	shouldStampRuntime,
} from './common.ts';
import { buildOne } from './package.ts';
import { uploadOne } from './upload.ts';

const SCRIPT = 'produce.ts';

interface IProduceArgs {
	readonly vscodePlatform: string;
	readonly arch: string;
	readonly tarballsDir: string;
	readonly resultsFile: string;
	readonly upload: boolean;
}

async function main(): Promise<void> {
	const args = parseArgs();
	fs.mkdirSync(args.tarballsDir, { recursive: true });

	const version = getRuntimeVersion();
	const target = getRuntimeTargetForBuild(args.vscodePlatform, args.arch);

	if (args.upload && target) {
		console.log(`[${SCRIPT}] producing payload for ${args.vscodePlatform}/${args.arch} → ${target}`);
		const built = await buildOne({ target, outDir: args.tarballsDir });
		await uploadOne({ version: built.version, target, tgzPath: built.tgzPath, sha256: built.sha256 });
		console.log(`##vso[task.setvariable variable=DICTATION_RUNTIME_TARBALLS_PRODUCED]true`);
	} else if (target) {
		console.log(`[${SCRIPT}] upload=false — skipping payload build/upload for ${target} (publish-only).`);
	} else {
		console.log(`[${SCRIPT}] no CDN payload for ${args.vscodePlatform}/${args.arch} (not a supported target).`);
	}

	if (!shouldStampRuntime(args.vscodePlatform, args.arch)) {
		console.log(`[${SCRIPT}] ${args.vscodePlatform}/${args.arch} cannot host dictation; product.json ships without dictationRuntime.`);
		return;
	}

	const result: IDictationRuntimeResult = { version, urlTemplate: buildCdnUrlTemplate(version) };
	fs.mkdirSync(path.dirname(args.resultsFile), { recursive: true });
	fs.writeFileSync(args.resultsFile, JSON.stringify(result, null, 2) + '\n');
	console.log(`[${SCRIPT}] Wrote dictationRuntime entry to ${args.resultsFile}`);

	console.log(`##vso[task.setvariable variable=DICTATION_RUNTIME_RESULTS_FILE]${args.resultsFile}`);
}

function parseArgs(): IProduceArgs {
	const flags = parseFlags(process.argv.slice(2));
	const vscodePlatform = flags.get('vscode-platform');
	if (!vscodePlatform || !KNOWN_VSCODE_PLATFORMS.has(vscodePlatform)) {
		throw new Error(`--vscode-platform must be one of ${[...KNOWN_VSCODE_PLATFORMS].join(', ')}; got '${vscodePlatform}'`);
	}
	const arch = flags.get('arch');
	if (!arch) {
		throw new Error('--arch=<arch> is required');
	}
	getRuntimeVersion();

	const tarballsDir = path.resolve(process.cwd(), '.build', 'dictation-runtime', 'tarballs');
	const resultsFile = process.env.DICTATION_RUNTIME_RESULTS_FILE
		?? path.resolve(process.cwd(), '.build', 'dictation-runtime', `${vscodePlatform}-${arch}.json`);
	const upload = (process.env.VSCODE_PUBLISH ?? '').toLowerCase() === 'true';
	return { vscodePlatform, arch, tarballsDir, resultsFile, upload };
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
