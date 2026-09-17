/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const routerDir = path.join(root, '.dardcor-router');

if (fs.existsSync(path.join(routerDir, 'package.json'))) {
	const isWindows = process.platform === 'win32';
	const nextBin = path.join(routerDir, 'node_modules', '.bin', isWindows ? 'next.cmd' : 'next');
	const npmCmd = isWindows ? 'npm.cmd' : 'npm';

	if (!fs.existsSync(nextBin)) {
		console.log('[compile-router] Installing dependencies in .dardcor-router...');
		cp.execSync(`${npmCmd} install`, { cwd: routerDir, stdio: 'inherit' });
	}

	if (isWindows) {
		try {
			cp.execSync('powershell -NoProfile -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 25128 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
		} catch {}
	}

	console.log('[compile-router] Building .dardcor-router standalone bundle...');
	cp.execSync(`${npmCmd} run build`, { cwd: routerDir, stdio: 'inherit' });
	console.log('[compile-router] Build completed successfully.');
} else {
	console.warn('[compile-router] .dardcor-router directory not found, skipping.');
}
