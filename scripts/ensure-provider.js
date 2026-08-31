const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROVIDER_DIR = fs.existsSync(path.join(ROOT, '.dardcor-router'))
	? path.join(ROOT, '.dardcor-router')
	: path.join(ROOT, '.dardcor-provider');
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

function getProviderLaunch(isWin, hasNextBin) {
	return hasNextBin
		? { command: 'node', args: ['--max-old-space-size=4096', path.join(PROVIDER_DIR, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '--port', PORT.toString()] }
		: { command: isWin ? 'npm.cmd' : 'npm', args: ['run', 'dev:webpack', '--', '--port', PORT.toString()] };
}

async function main() {
	if (!fs.existsSync(PROVIDER_DIR)) {
		return;
	}

	if (await checkPort(PORT)) {
		return;
	}

	const isWin = process.platform === 'win32';
	const nextBin = path.join(PROVIDER_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
	const env = { ...process.env, PORT: PORT.toString(), HOSTNAME: '127.0.0.1', DATA_DIR };
	const launch = getProviderLaunch(isWin, fs.existsSync(nextBin));
	const child = spawn(launch.command, launch.args, { cwd: PROVIDER_DIR, env, stdio: 'ignore', detached: true, windowsHide: true });

	child.unref();
	for (let attempt = 0; attempt < 15 && !(await checkPort(PORT)); attempt++) {
		await new Promise(resolve => setTimeout(resolve, 300));
	}
}

module.exports = { getProviderLaunch };

if (require.main === module) {
	main().catch(() => {});
}
