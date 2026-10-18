/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './bootstrap-server.js'; // this MUST come before other imports as it changes global state
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import minimist from 'minimist';
import { devInjectNodeModuleLookupPath, removeGlobalNodeJsModuleLookupPaths } from './bootstrap-node.js';
import { bootstrapESM } from './bootstrap-esm.js';
import { resolveNLSConfiguration } from './dc/base/node/nls.js';
import { product } from './bootstrap-meta.js';
import * as perf from './dc/base/common/performance.js';
import { INLSConfiguration } from './dc/nls.js';
import { IServerAPI } from './dc/server/node/remoteExtensionHostAgentServer.js';

perf.mark('code/server/start');
(globalThis as { vscodeServerStartTime?: number }).vscodeServerStartTime = performance.now();

const parsedArgs = minimist(process.argv.slice(2), {
	boolean: ['start-server', 'list-extensions', 'print-ip-address', 'help', 'version', 'accept-server-license-terms', 'update-extensions'],
	string: ['install-extension', 'install-builtin-extension', 'uninstall-extension', 'locate-extension', 'socket-path', 'host', 'port', 'compatibility', 'agent-host-port', 'agent-host-path'],
	alias: { help: 'h', version: 'v' }
});
['host', 'port', 'accept-server-license-terms'].forEach(e => {
	if (!parsedArgs[e]) {
		const envValue = process.env[`VSCODE_SERVER_${e.toUpperCase().replace('-', '_')}`];
		if (envValue) {
			parsedArgs[e] = envValue;
		}
	}
});

const extensionLookupArgs = ['list-extensions', 'locate-extension'];
const extensionInstallArgs = ['install-extension', 'install-builtin-extension', 'uninstall-extension', 'update-extensions'];

const shouldSpawnCli = parsedArgs.help || parsedArgs.version || extensionLookupArgs.some(a => !!parsedArgs[a]) || (extensionInstallArgs.some(a => !!parsedArgs[a]) && !parsedArgs['start-server']);

const nlsConfiguration = await resolveNLSConfiguration({ userLocale: 'en', osLocale: 'en', commit: product.commit, userDataPath: '', nlsMetadataPath: import.meta.dirname });

if (shouldSpawnCli) {
	loadCode(nlsConfiguration).then((mod) => {
		mod.spawnCli();
	});
} else {
	installServerProcessExitDiagnostics();

	let _remoteExtensionHostAgentServer: IServerAPI | null = null;
	let _remoteExtensionHostAgentServerPromise: Promise<IServerAPI> | null = null;
	const getRemoteExtensionHostAgentServer = () => {
		if (!_remoteExtensionHostAgentServerPromise) {
			_remoteExtensionHostAgentServerPromise = loadCode(nlsConfiguration).then(async (mod) => {
				const server = await mod.createServer(address);
				_remoteExtensionHostAgentServer = server;
				return server;
			});
		}
		return _remoteExtensionHostAgentServerPromise;
	};

	if (Array.isArray(product.serverLicense) && product.serverLicense.length) {
		console.log(product.serverLicense.join('\n'));
		if (product.serverLicensePrompt && parsedArgs['accept-server-license-terms'] !== true) {
			if (hasStdinWithoutTty()) {
				console.log('To accept the license terms, start the server with --accept-server-license-terms');
				process.exit(1);
			}
			try {
				const accept = await prompt(product.serverLicensePrompt);
				if (!accept) {
					process.exit(1);
				}
			} catch (e) {
				console.log(e);
				process.exit(1);
			}
		}
	}

	let firstRequest = true;
	let firstWebSocket = true;

	let address: string | AddressInfo | null = null;
	const server = http.createServer(async (req, res) => {
		if (firstRequest) {
			firstRequest = false;
			perf.mark('code/server/firstRequest');
		}
		const remoteExtensionHostAgentServer = await getRemoteExtensionHostAgentServer();
		return remoteExtensionHostAgentServer.handleRequest(req, res);
	});
	server.on('upgrade', async (req, socket) => {
		if (firstWebSocket) {
			firstWebSocket = false;
			perf.mark('code/server/firstWebSocket');
		}
		const remoteExtensionHostAgentServer = await getRemoteExtensionHostAgentServer();
		// @ts-expect-error
		return remoteExtensionHostAgentServer.handleUpgrade(req, socket);
	});
	server.on('error', async (err) => {
		const remoteExtensionHostAgentServer = await getRemoteExtensionHostAgentServer();
		return remoteExtensionHostAgentServer.handleServerError(err);
	});

	const host = sanitizeStringArg(parsedArgs['host']) || (parsedArgs['compatibility'] !== '1.63' ? 'localhost' : undefined);
	const nodeListenOptions = (
		parsedArgs['socket-path']
			? { path: sanitizeStringArg(parsedArgs['socket-path']) }
			: { host, port: await parsePort(host, sanitizeStringArg(parsedArgs['port'])) }
	);
	server.listen(nodeListenOptions, async () => {
		let output = Array.isArray(product.serverGreeting) && product.serverGreeting.length ? `\n\n${product.serverGreeting.join('\n')}\n\n` : ``;

		if (typeof nodeListenOptions.port === 'number' && parsedArgs['print-ip-address']) {
			const ifaces = os.networkInterfaces();
			Object.keys(ifaces).forEach(function (ifname) {
				ifaces[ifname]?.forEach(function (iface) {
					if (!iface.internal && iface.family === 'IPv4') {
						output += `IP Address: ${iface.address}\n`;
					}
				});
			});
		}

		address = server.address();
		if (address === null) {
			throw new Error('Unexpected server address');
		}

		output += `Server bound to ${typeof address === 'string' ? address : `${address.address}:${address.port} (${address.family})`}\n`;
		output += `Extension host agent listening on ${typeof address === 'string' ? address : address.port}\n`;
		console.log(output);

		perf.mark('code/server/started');
		(globalThis as { vscodeServerListenTime?: number }).vscodeServerListenTime = performance.now();

		await getRemoteExtensionHostAgentServer();
	});

	process.on('exit', () => {
		server.close();
		if (_remoteExtensionHostAgentServer) {
			_remoteExtensionHostAgentServer.dispose();
		}
	});
}

function sanitizeStringArg(val: unknown): string | undefined {
	if (Array.isArray(val)) {
		val = val.pop();
	}
	return typeof val === 'string' ? val : undefined;
}

function installServerProcessExitDiagnostics(): void {
	if (!process.env['VSCODE_SERVER_EXIT_DIAGNOSTICS']) {
		return;
	}

	const startTime = Date.now();

	const logsPath = sanitizeStringArg(parsedArgs['logsPath']) || os.tmpdir();
	const diagnosticsFile = path.join(logsPath, 'server-exit-diagnostics.log');
	try {
		fs.mkdirSync(logsPath, { recursive: true });
	} catch {
	}

	let mirrorToStderr = true;
	try {
		process.stderr.on('error', () => { mirrorToStderr = false; });
	} catch {
		mirrorToStderr = false;
	}

	const log = (message: string) => {
		const line = `[server-exit-diagnostics][${new Date().toISOString()}][pid:${process.pid}][+${Date.now() - startTime}ms] ${message}`;
		try {
			fs.appendFileSync(diagnosticsFile, `${line}\n`);
		} catch {
		}
		if (mirrorToStderr) {
			try {
				process.stderr.write(`${line}\n`);
			} catch {
				mirrorToStderr = false;
			}
		}
	};

	const describeState = (): string => {
		try {
			const processWithResources = process as NodeJS.Process & { getActiveResourcesInfo?(): string[] };
			const activeResources = processWithResources.getActiveResourcesInfo?.() ?? [];
			const memory = process.memoryUsage();
			return `uptime=${process.uptime().toFixed(3)}s rss=${Math.round(memory.rss / 1024 / 1024)}MB activeResources=[${activeResources.join(', ')}]`;
		} catch (err) {
			return `(failed to collect process state: ${err})`;
		}
	};

	log(`installed. ppid=${process.ppid} platform=${process.platform} node=${process.version} argv=${JSON.stringify(process.argv.slice(2))}`);

	process.on('beforeExit', code => log(`'beforeExit' (code: ${code}) — event loop drained, process will exit on its own. ${describeState()}`));
	process.on('exit', code => log(`'exit' (code: ${code}). ${describeState()}`));

	let handlingUncaughtException = false;
	process.on('uncaughtExceptionMonitor', (err, origin) => {
		if (handlingUncaughtException) {
			return;
		}
		handlingUncaughtException = true;
		try {
			log(`'uncaughtExceptionMonitor' (origin: ${origin}): ${err?.stack || err}`);
		} finally {
			handlingUncaughtException = false;
		}
	});

	const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK', 'SIGQUIT'];
	for (const signal of signals) {
		try {
			process.on(signal, () => {
				log(`received signal '${signal}' — terminating. ${describeState()}`);
				const signalNumber = (os.constants.signals as Record<string, number>)[signal];
				process.exit(typeof signalNumber === 'number' ? 128 + signalNumber : 1);
			});
		} catch {
		}
	}
}

async function parsePort(host: string | undefined, strPort: string | undefined): Promise<number> {
	if (strPort) {
		let range: { start: number; end: number } | undefined;
		if (strPort.match(/^\d+$/)) {
			return parseInt(strPort, 10);
		} else if (range = parseRange(strPort)) {
			const port = await findFreePort(host, range.start, range.end);
			if (port !== undefined) {
				return port;
			}
			console.warn(`--port: Could not find free port in range: ${range.start} - ${range.end} (inclusive).`);
			process.exit(1);

		} else {
			console.warn(`--port "${strPort}" is not a valid number or range. Ranges must be in the form 'from-to' with 'from' an integer larger than 0 and not larger than 'end'.`);
			process.exit(1);
		}
	}
	return 8000;
}

function parseRange(strRange: string): { start: number; end: number } | undefined {
	const match = strRange.match(/^(\d+)-(\d+)$/);
	if (match) {
		const start = parseInt(match[1], 10), end = parseInt(match[2], 10);
		if (start > 0 && start <= end && end <= 65535) {
			return { start, end };
		}
	}
	return undefined;
}

async function findFreePort(host: string | undefined, start: number, end: number): Promise<number | undefined> {
	const testPort = (port: number) => {
		return new Promise((resolve) => {
			const server = http.createServer();
			server.listen(port, host, () => {
				server.close();
				resolve(true);
			}).on('error', () => {
				resolve(false);
			});
		});
	};
	for (let port = start; port <= end; port++) {
		if (await testPort(port)) {
			return port;
		}
	}
	return undefined;
}

async function loadCode(nlsConfiguration: INLSConfiguration) {

	process.env['VSCODE_NLS_CONFIG'] = JSON.stringify(nlsConfiguration);

	process.env['VSCODE_HANDLES_SIGPIPE'] = 'true';

	if (process.env['VSCODE_DEV']) {
		process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'] = process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'] || path.join(import.meta.dirname, '..', 'remote', 'node_modules');
		devInjectNodeModuleLookupPath(process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH']);
	} else {
		delete process.env['VSCODE_DEV_INJECT_NODE_MODULE_LOOKUP_PATH'];
	}

	// Remove global paths from the node module lookup (node.js only)
	removeGlobalNodeJsModuleLookupPaths();

	await bootstrapESM();

	return import('./dc/server/node/server.main.js');
}

function hasStdinWithoutTty(): boolean {
	try {
		return !process.stdin.isTTY;
	} catch (error) {
	}
	return false;
}

function prompt(question: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise((resolve, reject) => {
		rl.question(question + ' ', async function (data) {
			rl.close();
			const str = data.toString().trim().toLowerCase();
			if (str === '' || str === 'y' || str === 'yes') {
				resolve(true);
			} else if (str === 'n' || str === 'no') {
				resolve(false);
			} else {
				process.stdout.write('\nInvalid Response. Answer either yes (y, yes) or no (n, no)\n');
				resolve(await prompt(question));
			}
		});
	});
}
