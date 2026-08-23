/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Must be the first import to ensure it evaluates before other imports.
import './disableProcessReport';

import { ExtensionContext } from 'vscode';
import { resolve } from '../../../util/dardcor/base/common/path';
import { baseActivate } from '../dardcor/extension';
import { vscodeNodeContributions } from './contributions';
import { registerServices } from './services';

// ###############################################################################################
// ###                                                                                         ###
// ###                 Node extension that runs ONLY in node.js extension host.                ###
// ###                                                                                         ###
// ### !!! Prefer to add code in ../vscode/extension.ts to support all extension runtimes !!!  ###
// ###                                                                                         ###
// ###############################################################################################

//#region TODO@bpasero this needs cleanup
import '../../intents/node/allIntents';

function configureDevPackages() {
	try {
		const sourceMapSupport = require('source-map-support');
		sourceMapSupport.install();
		const dotenv = require('dotenv');
		dotenv.config({ path: [resolve(__dirname, '../.env')] });
	} catch (err) {
		console.error(err);
	}
}
//#endregion

function ensureDardcorProviderRunning() {
	try {
		const http = require('http');
		const fs = require('fs');
		const path = require('path');
		const child_process = require('child_process');
		const os = require('os');

		const port = process.env.DARDCOR_PORT ? parseInt(process.env.DARDCOR_PORT) : 25000;
		const req = http.get(`http://127.0.0.1:${port}/v1/models`, { timeout: 1500 }, (res: any) => {
			res.resume();
		});

		req.on('error', () => {
			const candidates = [
				path.resolve(__dirname, '../../../../../../.dardcor-provider'),
				path.resolve(process.cwd(), '.dardcor-provider'),
				'/mnt/Data/Dardcor-Code/.dardcor-provider'
			];
			const providerDir = candidates.find(c => fs.existsSync(c));
			if (!providerDir) return;

			const pidFile = path.join(os.homedir(), '.dardcor', 'provider.pid');
			const logDir = path.join(os.homedir(), '.dardcor', 'logs');
			try { fs.mkdirSync(logDir, { recursive: true }); } catch { }

			if (fs.existsSync(pidFile)) {
				try {
					const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
					if (oldPid && !isNaN(oldPid)) {
						process.kill(oldPid, 0);
						return;
					}
				} catch {
					// Stale PID
				}
			}

			const logStream = fs.openSync(path.join(logDir, 'provider.log'), 'a');
			let child;
			const standaloneServer = path.join(providerDir, '.next/standalone/server.js');
			if (fs.existsSync(standaloneServer)) {
				child = child_process.spawn(process.execPath, [standaloneServer], {
					cwd: path.join(providerDir, '.next/standalone'),
					env: { ...process.env, PORT: String(port) },
					detached: true,
					stdio: ['ignore', logStream, logStream]
				});
			} else {
				child = child_process.spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
					cwd: providerDir,
					env: { ...process.env, PORT: String(port) },
					detached: true,
					stdio: ['ignore', logStream, logStream]
				});
			}
			child.unref();
			if (child.pid) {
				try { fs.writeFileSync(pidFile, String(child.pid)); } catch { }
			}
		});
	} catch {
		// Non-fatal
	}
}

export function activate(context: ExtensionContext, forceActivation?: boolean) {
	ensureDardcorProviderRunning();

	return baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});
}

