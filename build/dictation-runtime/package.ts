/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { getRuntimeVersion, parseFlags, SDK_PACKAGE_NAME, sha256OfFile, SUPPORTED_TARGETS } from './common.ts';
import { fetchCoreLibraries } from './nuget.ts';

const SCRIPT = 'package.ts';

const sdkRequire = createRequire(import.meta.url);

export interface IBuildResult {
	readonly tgzPath: string;
	readonly sha256: string;
	readonly version: string;
	readonly sizeBytes: number;
}

export interface IBuildArgs {
	readonly target: string;
	readonly outDir: string;
}

export async function buildOne(args: IBuildArgs): Promise<IBuildResult> {
	if (!SUPPORTED_TARGETS.has(args.target)) {
		throw new Error(`[${SCRIPT}] Unknown target '${args.target}'. Supported: ${[...SUPPORTED_TARGETS].join(', ')}.`);
	}

	const version = getRuntimeVersion();
	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-runtime-pkg-'));
	try {
		console.log(`[${SCRIPT}] Building ${SDK_PACKAGE_NAME}@${version} native runtime for ${args.target} in ${stagingDir}`);

		await stageAddon(stagingDir, args.target);
		await stageCoreLibraries(stagingDir, args.target);

		fs.mkdirSync(args.outDir, { recursive: true });
		const tgzPath = path.join(args.outDir, `${args.target}.tgz`);
		await buildTarball(stagingDir, tgzPath);

		const sha256 = await sha256OfFile(tgzPath);
		const sizeBytes = fs.statSync(tgzPath).size;

		console.log(`[${SCRIPT}] Wrote ${tgzPath} (${sizeBytes} bytes, sha256=${sha256})`);
		return { tgzPath, sha256, version, sizeBytes };
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

async function stageAddon(stagingDir: string, target: string): Promise<void> {
	const sdkRoot = path.dirname(sdkRequire.resolve(`${SDK_PACKAGE_NAME}/package.json`));
	const addonSrc = path.join(sdkRoot, 'prebuilds', target, 'foundry_local_napi.node');
	if (!fs.existsSync(addonSrc)) {
		throw new Error(`[${SCRIPT}] Prebuilt addon not found for ${target} at ${addonSrc}. Is ${SDK_PACKAGE_NAME} installed?`);
	}
	const addonDest = path.join(stagingDir, 'prebuilds', target, 'foundry_local_napi.node');
	fs.mkdirSync(path.dirname(addonDest), { recursive: true });
	fs.copyFileSync(addonSrc, addonDest);
}

async function stageCoreLibraries(stagingDir: string, target: string): Promise<void> {
	const deps = sdkRequire(`${SDK_PACKAGE_NAME}/deps_versions.json`) as {
		'foundry-local-core': { nuget: string };
		onnxruntime: { version: string };
		'onnxruntime-genai': { version: string };
	};

	const ortPackageName = target === 'linux-x64' ? 'Microsoft.ML.OnnxRuntime.Gpu.Linux' : 'Microsoft.ML.OnnxRuntime.Foundry';

	const artifacts = [
		{ name: 'Microsoft.AI.Foundry.Local.Core', version: deps['foundry-local-core'].nuget },
		{ name: ortPackageName, version: deps.onnxruntime.version },
		{ name: 'Microsoft.ML.OnnxRuntimeGenAI.Foundry', version: deps['onnxruntime-genai'].version },
	];

	const coreDir = path.join(stagingDir, 'foundry-local-core', target);
	await fetchCoreLibraries(target, artifacts, coreDir);

	for (const name of requiredCoreLibraryNames(target)) {
		if (!fs.existsSync(path.join(coreDir, name))) {
			throw new Error(`[${SCRIPT}] Core library '${name}' missing after install for ${target} — refusing to build an incomplete tarball.`);
		}
	}
}

function requiredCoreLibraryNames(target: string): string[] {
	const isWin = target.startsWith('win32-');
	const isMac = target.startsWith('darwin-');
	const ext = isWin ? '.dll' : isMac ? '.dylib' : '.so';
	const prefix = isWin ? '' : 'lib';
	return [
		`Microsoft.AI.Foundry.Local.Core${ext}`,
		`${prefix}onnxruntime${ext}`,
		`${prefix}onnxruntime-genai${ext}`,
	];
}

async function buildTarball(stagingDir: string, outTgz: string): Promise<void> {
	await tar.c(
		{
			file: outTgz,
			cwd: stagingDir,
			gzip: { level: 9 },
			portable: true,
			mtime: new Date(0),
		},
		['prebuilds', 'foundry-local-core'],
	);
}


function isCliInvocation(): boolean {
	return import.meta.filename === process.argv[1];
}

function parseCliArgs(): IBuildArgs {
	const flags = parseFlags(process.argv.slice(2));
	const target = flags.get('target');
	if (!target) {
		throw new Error('--target=<platform-arch> is required (e.g. --target=darwin-arm64)');
	}
	const outDir = flags.get('out') ?? path.resolve(process.cwd(), 'out');
	return { target, outDir };
}

if (isCliInvocation()) {
	buildOne(parseCliArgs()).catch(err => {
		console.error(err);
		process.exit(1);
	});
}

