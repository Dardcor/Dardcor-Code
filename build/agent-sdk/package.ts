/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { findMissingNativeOptionalDep } from '../azure-pipelines/common/checkNativeOptionalDeps.ts';
import { getAgentDir, getAgentMeta, parseFlags, type Sdk, sha256OfFile } from './common.ts';

const SCRIPT = 'package.ts';

export interface IBuildResult {
	readonly tgzPath: string;
	readonly sha256: string;
	readonly sdkVersion: string;
	readonly sizeBytes: number;
}

export interface IBuildArgs {
	readonly sdk: Sdk;
	readonly sdkTarget: string;
	readonly outDir: string;
}

export async function buildOne(args: IBuildArgs): Promise<IBuildResult> {
	const { name: packageName, version: sdkVersion } = getAgentMeta(args.sdk);
	const agentDir = getAgentDir(args.sdk);

	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-pkg-'));
	try {
		fs.copyFileSync(path.join(agentDir, 'package.json'), path.join(stagingDir, 'package.json'));
		fs.copyFileSync(path.join(agentDir, 'package-lock.json'), path.join(stagingDir, 'package-lock.json'));

		console.log(`[${SCRIPT}] Building ${packageName}@${sdkVersion} for ${args.sdkTarget} in ${stagingDir}`);

		const { os: targetOs, cpu, libc } = parseTargetTriple(args.sdkTarget);
		const npmEnv: NodeJS.ProcessEnv = { npm_config_os: targetOs, npm_config_cpu: cpu };
		if (libc) {
			npmEnv.npm_config_libc = libc;
		}
		npmCi(stagingDir, npmEnv);

		const nodeModulesDir = path.join(stagingDir, 'node_modules');

		const missingNativeDep = findMissingNativeOptionalDep(nodeModulesDir, packageName, args.sdkTarget);
		if (missingNativeDep) {
			throw new Error(`[${SCRIPT}] npm ci left ${packageName}@${sdkVersion} without its native package '${missingNativeDep}' for target ${args.sdkTarget} — the optional dependency was silently skipped. Refusing to build a binary-less tarball; re-run to re-fetch it.`);
		}

		chmodPlatformBinaries(nodeModulesDir, args.sdk);

		fs.mkdirSync(args.outDir, { recursive: true });
		const tgzPath = path.join(args.outDir, `${args.sdk}-${sdkVersion}-${args.sdkTarget}.tgz`);
		await buildTarball(stagingDir, tgzPath);

		const sha256 = await sha256OfFile(tgzPath);
		const sizeBytes = fs.statSync(tgzPath).size;

		console.log(`[${SCRIPT}] Wrote ${tgzPath} (${sizeBytes} bytes, sha256=${sha256})`);
		return { tgzPath, sha256, sdkVersion, sizeBytes };
	} finally {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

function parseTargetTriple(sdkTarget: string): { os: string; cpu: string; libc?: string } {
	const match = /^([a-z0-9]+)-([a-z0-9]+)(?:-([a-z0-9]+))?$/.exec(sdkTarget);
	if (!match) {
		throw new Error(`[${SCRIPT}] Cannot parse target '${sdkTarget}'`);
	}
	const [, osStr, cpu, libc] = match;
	return { os: osStr, cpu, libc };
}


function chmodPlatformBinaries(nodeModulesDir: string, sdk: Sdk): void {
	if (sdk === 'claude') {
		const scopeDir = path.join(nodeModulesDir, '@anthropic-ai');
		if (!fs.existsSync(scopeDir)) {
			return;
		}
		for (const child of fs.readdirSync(scopeDir)) {
			if (!child.startsWith('claude-agent-sdk-')) {
				continue;
			}
			const binary = path.join(scopeDir, child, 'claude');
			if (fs.existsSync(binary)) {
				fs.chmodSync(binary, 0o755);
			}
		}
		return;
	}

	const scopeDir = path.join(nodeModulesDir, '@openai');
	if (!fs.existsSync(scopeDir)) {
		return;
	}
	for (const child of fs.readdirSync(scopeDir)) {
		if (!child.startsWith('codex-')) {
			continue;
		}
		const vendorDir = path.join(scopeDir, child, 'vendor');
		if (!fs.existsSync(vendorDir)) {
			continue;
		}
		for (const triple of fs.readdirSync(vendorDir)) {
			const binDir = path.join(vendorDir, triple, 'bin');
			if (!fs.existsSync(binDir)) {
				continue;
			}
			for (const f of fs.readdirSync(binDir)) {
				fs.chmodSync(path.join(binDir, f), 0o755);
			}
		}
	}
}

function npmCi(workDir: string, env: NodeJS.ProcessEnv): void {
	const isWindows = process.platform === 'win32';
	const npm = isWindows ? 'npm.cmd' : 'npm';
	const result = spawnSync(npm, ['ci', '--ignore-scripts'], {
		cwd: workDir,
		env: { ...process.env, ...env },
		stdio: 'inherit',
		shell: isWindows,
	});
	if (result.error) {
		throw new Error(`[${SCRIPT}] npm ci failed to spawn: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`[${SCRIPT}] npm ci exited ${result.status}`);
	}
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
		['node_modules'],
	);
}


function isCliInvocation(): boolean {
	return import.meta.filename === process.argv[1];
}

function parseCliArgs(): IBuildArgs {
	const flags = parseFlags(process.argv.slice(2));
	const sdk = flags.get('sdk');
	if (sdk !== 'claude' && sdk !== 'codex') {
		throw new Error(`--sdk must be 'claude' or 'codex'; got '${sdk}'`);
	}
	const sdkTarget = flags.get('target');
	if (!sdkTarget) {
		throw new Error('--target=<sdkTarget> is required');
	}
	const outDir = flags.get('out') ?? path.resolve(process.cwd(), 'out');
	return { sdk, sdkTarget, outDir };
}

if (isCliInvocation()) {
	buildOne(parseCliArgs()).catch(err => {
		console.error(err);
		process.exit(1);
	});
}

