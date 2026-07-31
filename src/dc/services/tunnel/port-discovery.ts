/**
 * Dardcor Code - Open Port Listener Scanner (Task 180)
 * Mirrors: vs/platform/tunnel/node/portDiscovery.ts
 */

export interface IDiscoveredPort {
	port: number;
	processId: number;
	command?: string;
}

const DEFAULT_CANDIDATES = [3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888, 9229, 5432, 3306];

export async function scanOpenLocalPorts(candidates: number[] = DEFAULT_CANDIDATES): Promise<IDiscoveredPort[]> {
	const ports: IDiscoveredPort[] = [];
	const isNode = typeof process !== 'undefined' && typeof process.platform === 'string';
	if (!isNode) {
		return ports;
	}
	let net: typeof import('node:net') | null = null;
	try {
		net = await import('node:net');
	} catch {
		return ports;
	}
	for (const port of candidates) {
		if (await isPortOpen(net, port)) {
			const processId = await findListeningPid(port);
			ports.push({ port, processId, command: processId > 0 ? undefined : 'listener' });
		}
	}
	return ports;
}

function isPortOpen(net: typeof import('node:net'), port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		let settled = false;
		const finish = (open: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(200);
		socket.once('connect', () => finish(true));
		socket.once('timeout', () => finish(false));
		socket.once('error', () => finish(false));
		socket.connect(port, '127.0.0.1');
	});
}

async function findListeningPid(port: number): Promise<number> {
	try {
		if (typeof process !== 'undefined' && process.platform === 'win32') {
			const { execFile } = await import('node:child_process');
			const out = await new Promise<string>((resolve) => {
				execFile('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
					resolve(err ? '' : stdout);
				});
			});
			const wanted = `:${port}`;
			for (const line of out.split(/\r?\n/)) {
				const parts = line.trim().split(/\s+/);
				if (parts.length >= 5 && parts[0] === 'TCP' && parts[1].endsWith(wanted) && parts[3] === 'LISTENING') {
					const pid = Number(parts[4]);
					if (Number.isInteger(pid) && pid > 0) {
						return pid;
					}
				}
			}
		}
	} catch {
		// PID discovery is best-effort.
	}
	return 0;
}
