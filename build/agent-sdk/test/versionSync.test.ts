/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { suite, test } from 'node:test';
import { fileURLToPath } from 'url';
import { getAgentDir, getAgentMeta, getSdks } from '../common.ts';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const ROOT_PACKAGE_JSON = path.join(THIS_DIR, '..', '..', '..', 'package.json');

interface IRootPackageJson {
	readonly devDependencies?: Readonly<Record<string, string>>;
}

function getRootDevDependencies(): Readonly<Record<string, string>> {
	const json = JSON.parse(fs.readFileSync(ROOT_PACKAGE_JSON, 'utf8')) as IRootPackageJson;
	return json.devDependencies ?? {};
}

function getLockedVersion(sdk: string, name: string): string | undefined {
	const lockPath = path.join(getAgentDir(sdk), 'package-lock.json');
	const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
		readonly packages?: Readonly<Record<string, { readonly version?: string }>>;
	};
	return lock.packages?.[`node_modules/${name}`]?.version;
}

suite('agent SDK version pins stay in lockstep', () => {
	test('build pin, runtime pin, and lockfile all match for every SDK', () => {
		const rootDevDeps = getRootDevDependencies();

		const actual: Record<string, { name: string; buildPin: string; runtimePin: string | undefined; lockPin: string | undefined }> = {};
		const expected: typeof actual = {};

		for (const sdk of getSdks()) {
			const { name, version } = getAgentMeta(sdk);
			actual[sdk] = {
				name,
				buildPin: version,
				runtimePin: rootDevDeps[name],
				lockPin: getLockedVersion(sdk, name),
			};
			expected[sdk] = {
				name,
				buildPin: version,
				runtimePin: version,
				lockPin: version,
			};
		}

		assert.deepStrictEqual(
			actual,
			expected,
			`An agent SDK version pin drifted. The build pin in build/agent-sdk/agents/<sdk>/package.json must match the runtime pin in repo-root package.json devDependencies and the resolved version in agents/<sdk>/package-lock.json. See "Bumping an SDK version" in build/agent-sdk/README.md.`,
		);
	});
});
