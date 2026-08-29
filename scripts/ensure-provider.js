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

	if (await checkPort(PORT)) {
		return;
	}

	const nextBin = path.join(PROVIDER_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
	const isWin = process.platform === 'win32';
	const env = { ...process.env, PORT: PORT.toString(), HOSTNAME: '127.0.0.1', DATA_DIR };
	const child = fs.existsSync(nextBin)
		? spawn('node', ['--max-old-space-size=4096', nextBin, 'dev', '--webpack', '--port', PORT.toString()], { cwd: PROVIDER_DIR, env, stdio: 'ignore', detached: true, windowsHide: true })
		: spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev:webpack'], { cwd: PROVIDER_DIR, env, stdio: 'ignore', detached: true, windowsHide: true });

	child.unref();
}

main().catch(() => {});
