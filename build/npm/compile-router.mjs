/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import net from 'node:net';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const routerDir = path.join(root, '.dardcor-router');

function isPortListening(port) {
	return new Promise(resolve => {
		const socket = net.createConnection({ host: '127.0.0.1', port });
		const finish = listening => {
			socket.destroy();
			resolve(listening);
		};
		socket.setTimeout(750, () => finish(false));
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});
}

if (fs.existsSync(path.join(routerDir, 'package.json'))) {
	const isWindows = process.platform === 'win32';
	const nextBin = path.join(routerDir, 'node_modules', '.bin', isWindows ? 'next.cmd' : 'next');
	const npmCmd = isWindows ? 'npm.cmd' : 'npm';
	const routerPackagePath = path.join(routerDir, 'package.json');
	const routerPackage = JSON.parse(fs.readFileSync(routerPackagePath, 'utf8'));
	const routerRequire = createRequire(routerPackagePath);
	const declaredDependencies = {
		...routerPackage.dependencies,
		...routerPackage.devDependencies,
	};
	const missingDependencies = Object.keys(declaredDependencies).filter(dependency => {
		try {
			routerRequire.resolve(dependency);
			return false;
		} catch (err) {
			if (err && err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
				return false;
			}
			return true;
		}
	});

	if (!fs.existsSync(nextBin) || missingDependencies.length > 0) {
		console.log(`[compile-router] Installing dependencies in .dardcor-router${missingDependencies.length > 0 ? ` (missing: ${missingDependencies.join(', ')})` : ''}...`);
		cp.execSync(`${npmCmd} install`, { cwd: routerDir, stdio: 'inherit' });
	}

	const activeRouterPorts = (await Promise.all([25000, 25128].map(async port => await isPortListening(port) ? port : undefined))).filter(port => port !== undefined);
	if (activeRouterPorts.length > 0) {
		throw new Error(`[compile-router] Router build cannot safely replace its Next.js output while a Router server is active on port(s) ${activeRouterPorts.join(', ')}. Stop the Dardcor Router/dev server, then rerun npm run compile.`);
	}

	console.log('[compile-router] Building .dardcor-router standalone bundle...');
	cp.execSync(`${npmCmd} run build`, { cwd: routerDir, stdio: 'inherit' });
	console.log('[compile-router] Build completed successfully.');
} else {
	console.warn('[compile-router] .dardcor-router directory not found, skipping.');
}
