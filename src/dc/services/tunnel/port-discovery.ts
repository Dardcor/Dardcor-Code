/**
 * Dardcor Code - Port Discovery Scanner (Task 180)
 * Mirrors: vs/platform/tunnel/node/portDiscovery.ts
 */

declare const require: any;

export interface IDiscoveredPort {
	port: number;
	processId: number;
	command?: string;
}

export async function scanOpenLocalPorts(): Promise<IDiscoveredPort[]> {
	const ports: IDiscoveredPort[] = [];
	try {
		const net = require('net');
		// Example check for standard dev server ports
		const candidates = [3000, 3001, 4200, 5000, 5173, 8000, 8080];
		for (const p of candidates) {
			const isOpen = await checkPort(p);
			if (isOpen) {
				ports.push({ port: p, processId: 0, command: 'node/dev-server' });
			}
		}
	} catch {
		// Not in Node environment
	}
	return ports;
}

function checkPort(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const net = require('net');
			const client = new net.Socket();
			client.setTimeout(200);
			client.on('connect', () => {
				client.destroy();
				resolve(true);
			});
			client.on('error', () => resolve(false));
			client.on('timeout', () => {
				client.destroy();
				resolve(false);
			});
			client.connect(port, '127.0.0.1');
		} catch {
			resolve(false);
		}
	});
}
