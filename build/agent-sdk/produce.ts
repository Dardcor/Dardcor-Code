/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as fs from 'fs';
import * as path from 'path';
import {
	buildCdnUrlTemplate,
	getSdks,
	getSdkTargetForBuild,
	type IAgentSdkResults,
	KNOWN_VSCODE_PLATFORMS,
	parseFlags,
	type Sdk,
	type VscodeBuildPlatform,
} from './common.ts';
import { type IBuildResult, buildOne } from './package.ts';
import { uploadOne } from './upload.ts';

const SCRIPT = 'produce.ts';

interface ICliArgs {
	readonly vscodePlatform: VscodeBuildPlatform;
	readonly arch: string;
	readonly resultsFile: string;
	readonly tarballsDir: string;
	readonly upload: boolean;
}

function parseCliArgs(): ICliArgs {
	const flags = parseFlags(process.argv.slice(2));
	const vscodePlatform = flags.get('vscode-platform');
	if (!vscodePlatform || !KNOWN_VSCODE_PLATFORMS.has(vscodePlatform as VscodeBuildPlatform)) {
		const known = [...KNOWN_VSCODE_PLATFORMS].join('|');
		throw new Error(`--vscode-platform=<${known}> is required (got '${vscodePlatform ?? ''}')`);
	}
	const arch = flags.get('arch');
	if (!arch) {
		throw new Error('--arch=<x64|arm64|armhf|...> is required');
	}
	const upload = (process.env.VSCODE_PUBLISH ?? '').toLowerCase() === 'true';
	const tarballsDir = path.resolve(process.cwd(), '.build/agent-sdk/tarballs');
	const resultsFile = process.env.AGENT_SDK_RESULTS_FILE
		?? path.resolve(process.cwd(), `.build/agent-sdk/${vscodePlatform}-${arch}.json`);
	return { vscodePlatform: vscodePlatform as VscodeBuildPlatform, arch, resultsFile, tarballsDir, upload };
}

async function main(): Promise<void> {
	const args = parseCliArgs();
	console.log(`[${SCRIPT}] VSCODE_PUBLISH=${process.env.VSCODE_PUBLISH ?? '<unset>'} → upload=${args.upload}`);

	fs.mkdirSync(args.tarballsDir, { recursive: true });

	const results: IAgentSdkResults = {};
	const sdks = getSdks();
	const produced = await Promise.all(
		sdks.map(sdk => produceOne(sdk, args.vscodePlatform, args.arch, args.tarballsDir, args.upload)),
	);
	for (let i = 0; i < sdks.length; i++) {
		const entry = produced[i];
		if (entry) {
			results[sdks[i]] = entry;
		}
	}

	const tarballCount = fs.readdirSync(args.tarballsDir).filter(f => f.endsWith('.tgz')).length;
	if (tarballCount > 0) {
		console.log(`##vso[task.setvariable variable=AGENT_SDK_TARBALLS_PRODUCED]true`);
	}

	if (!args.upload) {
		console.log(`[${SCRIPT}] upload=false — ${tarballCount} tarball(s) left in ${args.tarballsDir}; skipping results file and AGENT_SDK_RESULTS_FILE setvariable.`);
		return;
	}

	fs.mkdirSync(path.dirname(args.resultsFile), { recursive: true });
	fs.writeFileSync(args.resultsFile, JSON.stringify(results, null, 2) + '\n');
	const sdkCount = Object.keys(results).length;
	console.log(`[${SCRIPT}] Wrote ${sdkCount} SDK entr${sdkCount === 1 ? 'y' : 'ies'} to ${args.resultsFile}`);

	console.log(`##vso[task.setvariable variable=AGENT_SDK_RESULTS_FILE]${args.resultsFile}`);
}

async function produceOne(
	sdk: Sdk,
	vscodePlatform: VscodeBuildPlatform,
	arch: string,
	tarballsDir: string,
	upload: boolean,
): Promise<IAgentSdkResults[string] | undefined> {
	const sdkTarget = getSdkTargetForBuild(vscodePlatform, arch, sdk);
	if (!sdkTarget) {
		console.log(`[${SCRIPT}] ${sdk}: no target for ${vscodePlatform}/${arch} — skipping`);
		return undefined;
	}
	console.log(`[${SCRIPT}] ${sdk}: producing for ${vscodePlatform}/${arch} → ${sdkTarget}`);
	const built: IBuildResult = await buildOne({ sdk, sdkTarget, outDir: tarballsDir });
	if (!upload) {
		return undefined;
	}
	await uploadOne({
		sdk,
		sdkVersion: built.sdkVersion,
		sdkTarget,
		tgzPath: built.tgzPath,
		sha256: built.sha256,
	});
	return { version: built.sdkVersion, urlTemplate: buildCdnUrlTemplate(sdk, built.sdkVersion) };
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
