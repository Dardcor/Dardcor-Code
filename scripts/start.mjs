import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export function getStartCommand(platform = process.platform) {
	return platform === 'win32'
		? { command: 'scripts\\code.bat', shell: true }
		: { command: './scripts/code.sh', shell: false };
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { command, shell } = getStartCommand();
	const child = spawn(command, process.argv.slice(2), { cwd: root, shell, stdio: 'inherit' });
	child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
