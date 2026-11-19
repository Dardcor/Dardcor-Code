/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import cp from 'child_process';
const root = fs.realpathSync(path.dirname(path.dirname(import.meta.dirname)));

function getNpmProductionDependencies(folder: string): string[] {
	let raw = '';

	try {
		raw = cp.execSync('npm ls --all --omit=dev --parseable', { cwd: folder, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' }, stdio: [null, 'pipe', 'pipe'] });
	} catch (err: any) {
		raw = (err.stdout || '').toString();
	}

	return raw.split(/\r?\n/).filter(line => {
		return !!line.trim() && path.relative(root, line) !== path.relative(root, folder);
	});
}

export function getProductionDependencies(folderPath: string): string[] {
	const absoluteFolderPath = path.resolve(root, folderPath);
	if (!fs.existsSync(absoluteFolderPath)) {
		return [];
	}
	const result = getNpmProductionDependencies(absoluteFolderPath);
	const realFolderPath = fs.realpathSync(absoluteFolderPath);
	const relativeFolderPath = path.relative(root, realFolderPath);
	const distroFolderPath = `${root}/.build/distro/npm/${relativeFolderPath}`;

	if (fs.existsSync(distroFolderPath)) {
		result.push(...getNpmProductionDependencies(distroFolderPath));
	}

	return [...new Set(result)];
}

if (import.meta.main) {
	console.log(JSON.stringify(getProductionDependencies(root), null, '  '));
}
