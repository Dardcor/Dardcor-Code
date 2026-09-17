import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, cpSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import net from 'node:net';

export function getStartCommand(platform = process.platform) {
	return platform === 'win32'
		? { command: 'scripts\\code.bat', shell: true }
		: { command: './scripts/code.sh', shell: false };
}

function checkPort(port) {
	return new Promise(resolve => {
		const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
			client.end();
			resolve(true);
		});
		client.on('error', () => resolve(false));
		client.setTimeout(400, () => {
			client.destroy();
			resolve(false);
		});
	});
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	(async () => {
		let dardcorRouterChild = null;
		const isPortOpen = await checkPort(25128);
		if (!isPortOpen) {
			const dardcorRouterDir = existsSync(join(root, '.dardcor-router'))
				? join(root, '.dardcor-router')
				: join(root, '.dardcor-provider');
			const customServer = join(dardcorRouterDir, 'custom-server.js');
			const standaloneServer = join(dardcorRouterDir, '.next', 'standalone', 'server.js');
			const serverScript = existsSync(customServer) ? customServer : standaloneServer;
			if (existsSync(serverScript)) {
				console.log('[Dardcor Router] Starting router on port 25128...');
				const dataDir = process.env['DARDCOR_DATA_DIR'] || join(homedir(), '.dardcor', 'provider');
				const legacyDataDir = existsSync(join(homedir(), '.dardcor', 'router'))
					? join(homedir(), '.dardcor', 'router')
					: join(homedir(), '.dardcor-router');
				try {
					const legacyDb = join(legacyDataDir, 'db', 'database.json');
					const targetDb = join(dataDir, 'db', 'database.json');
					if (existsSync(legacyDb)) {
						const legacySize = existsSync(legacyDb) ? statSync(legacyDb).size : 0;
						const targetSize = existsSync(targetDb) ? statSync(targetDb).size : 0;
						if (!existsSync(targetDb) || targetSize < legacySize) {
							cpSync(legacyDataDir, dataDir, { recursive: true, force: true });
							console.log('[Dardcor Router] Migrated database from legacy Dardcor Router to .dardcor/provider');
						}
					}
				} catch (err) {
					console.warn('[Dardcor Router] Legacy migration skipped:', err);
				}
				const env = {
					...process.env,
					PORT: '25128',
					HOSTNAME: '127.0.0.1',
					DATA_DIR: dataDir,
					LOG_LEVEL: 'warn'
				};
				dardcorRouterChild = spawn(process.execPath, [serverScript], {
					cwd: existsSync(customServer) ? dardcorRouterDir : join(dardcorRouterDir, '.next', 'standalone'),
					env,
					stdio: 'inherit'
				});
				dardcorRouterChild.on('error', err => console.error('[Dardcor Router] error:', err));
				for (let i = 0; i < 40; i++) {
					await new Promise(r => setTimeout(r, 100));
					if (await checkPort(25128)) {
						break;
					}
				}
			}
		} else {
			console.log('[Dardcor Router] Router is already listening on port 25128.');
		}

		const cleanup = () => {
			if (dardcorRouterChild) {
				try { dardcorRouterChild.kill(); } catch {}
				dardcorRouterChild = null;
			}
		};

		process.on('exit', cleanup);
		process.on('SIGINT', () => { cleanup(); process.exit(0); });
		process.on('SIGTERM', () => { cleanup(); process.exit(0); });

		const { command, shell } = getStartCommand();
		const child = spawn(command, process.argv.slice(2), { cwd: root, shell, stdio: 'inherit' });
		child.on('exit', (code, signal) => {
			cleanup();
			process.exit(code ?? (signal ? 1 : 0));
		});
	})();
}

