const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROVIDER_DIR = path.join(ROOT, '.dardcor-provider');
const PORT = 25128;
const DATA_DIR = path.join(require('os').homedir(), '.miawagent', 'router');

function checkPort(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ host: '127.0.0.1', port }, () => {
			socket.destroy();
			resolve(true);
		});
		socket.on('error', () => {
			socket.destroy();
			resolve(false);
		});
	});
}

async function main() {
	if (!fs.existsSync(PROVIDER_DIR)) {
		return;
	}

	const isRunning = await checkPort(PORT);
	if (isRunning) {
		return;
	}

	const nextBin = path.join(PROVIDER_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
	const isWin = process.platform === 'win32';
	let child;

	if (fs.existsSync(nextBin)) {
		child = spawn('node', ['--max-old-space-size=4096', nextBin, 'dev', '--webpack', '--port', PORT.toString()], {
			cwd: PROVIDER_DIR,
				env: {
					...process.env,
					PORT: PORT.toString(),
					HOSTNAME: '127.0.0.1',
					DATA_DIR
			},
			stdio: 'ignore',
			detached: true,
			windowsHide: true
		});
	} else {
		const npmCmd = isWin ? 'npm.cmd' : 'npm';
		child = spawn(npmCmd, ['run', 'dev:webpack'], {
			cwd: PROVIDER_DIR,
				env: {
					...process.env,
					PORT: PORT.toString(),
					HOSTNAME: '127.0.0.1',
					DATA_DIR
			},
			stdio: 'ignore',
			detached: true,
			windowsHide: true
		});
	}

	if (child) {
		child.unref();
	}
}

main().catch(() => {});
