/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.dirname(path.dirname(path.dirname(import.meta.dirname)));

const distroPath = path.join(root, '.build', 'distro');

function getEnv(name: string): string {
	const result = process.env[name];

	if (typeof result === 'undefined') {
		throw new Error('Missing env: ' + name);
	}

	return result;
}

function assertDistroCheckout(): void {
	if (!fs.existsSync(path.join(distroPath, '.git'))) {
		throw new Error(`Expected a vscode-distro checkout at ${distroPath} but found none. Ensure download-distro.yml ran before this check.`);
	}
}

function getDistroBranchHead(branch: string): string {
	return execSync(`git -C "${distroPath}" rev-parse "refs/remotes/origin/${branch}"`, { encoding: 'utf8' }).trim();
}

async function checkDistroCommit(): Promise<void> {
	const packageJsonPath = path.join(root, 'package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
	const distroCommit: string = packageJson.distro;

	if (!distroCommit) {
		console.log('No distro commit found in package.json, skipping check');
		return;
	}

	console.log(`Distro commit in package.json: ${distroCommit}`);

	const sourceBranch = getEnv('BUILD_SOURCEBRANCH');
	const branchMatch = sourceBranch.match(/^refs\/heads\/(.+)$/);

	if (!branchMatch) {
		console.log(`Cannot determine branch from BUILD_SOURCEBRANCH: ${sourceBranch}, skipping check`);
		return;
	}

	const branch = branchMatch[1];
	console.log(`Current branch: ${branch}`);

	assertDistroCheckout();

	let distroBranchHead: string;
	try {
		distroBranchHead = getDistroBranchHead(branch);
	} catch (error) {
		console.log(`Could not resolve branch '${branch}' from local vscode-distro checkout: ${error}`);
		console.log('This is expected for feature branches that have not been merged to distro');
		return;
	}

	console.log(`Distro branch '${branch}' HEAD: ${distroBranchHead}`);

	if (distroCommit === distroBranchHead) {
		console.log(`✓ Distro commit matches branch HEAD`);
	} else {
		console.log(`##vso[task.logissue type=warning]Distro commit mismatch: package.json has ${distroCommit.substring(0, 8)} but ${branch} HEAD is ${distroBranchHead.substring(0, 8)}`);
		console.log(`##vso[task.complete result=SucceededWithIssues;]Distro commit does not match branch HEAD`);
		console.log('');
		console.log(`⚠️  WARNING: Distro commit in package.json does not match the HEAD of branch '${branch}' in vscode-distro`);
		console.log(`   package.json distro: ${distroCommit}`);
		console.log(`   ${branch} HEAD:      ${distroBranchHead}`);
		console.log('');
		console.log('   To update, run: npm run update-distro');
	}
}

checkDistroCommit().then(() => {
	console.log('Distro commit check completed');
	process.exit(0);
}, err => {
	console.error(err);
	process.exit(1);
});
