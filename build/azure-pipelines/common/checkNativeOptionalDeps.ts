/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';


export function findMissingNativeOptionalDep(nodeModulesDir: string, basePackage: string, target: string): string | undefined {
	if (!fs.existsSync(path.join(nodeModulesDir, basePackage))) {
		return undefined;
	}
	const platformPackage = `${basePackage}-${target}`;
	if (!fs.existsSync(path.join(nodeModulesDir, platformPackage))) {
		return platformPackage;
	}
	return undefined;
}


const NATIVE_OPTIONAL_DEP_BASE_PACKAGES = [
	'@openai/codex',
	'@anthropic-ai/claude-agent-sdk',
];

const SUPPORTED_PLATFORMS = new Set(['linux', 'darwin', 'win32']);
const SUPPORTED_ARCHS = new Set(['x64', 'arm64']);

function isCliInvocation(): boolean {
	return import.meta.filename === process.argv[1];
}

function main(): void {
	const { platform, arch } = process;
	if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHS.has(arch)) {
		console.log(`Skipping native optional-dependency check on unsupported ${platform}-${arch}.`);
		return;
	}

	const nodeModulesDir = path.join(import.meta.dirname, '../../../', 'node_modules');
	const target = `${platform}-${arch}`;
	const errors: string[] = [];
	for (const basePackage of NATIVE_OPTIONAL_DEP_BASE_PACKAGES) {
		const missing = findMissingNativeOptionalDep(nodeModulesDir, basePackage, target);
		if (missing) {
			errors.push(`${basePackage}: required per-platform package '${missing}' is missing from node_modules — the optional dependency was silently skipped during install`);
		}
	}

	if (errors.length > 0) {
		console.error('\x1b[1;31m*** Missing native optional-dependency packages — refusing to save a poisoned node_modules cache ***\x1b[0m');
		for (const err of errors) {
			console.error(`  - ${err}`);
		}
		console.error('\nnpm does not fail when an optional dependency cannot be installed, so this tree would poison the shared node_modules cache. Re-run a fresh `npm ci` (e.g. after bumping build/.cachesalt) to restore the package before the cache is saved.');
		process.exit(1);
	}

	console.log(`Verified native optional-dependency packages for ${platform}-${arch}.`);
}

if (isCliInvocation()) {
	main();
}

