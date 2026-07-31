import { spawn } from 'child_process';

export interface ProtocolRegistrationResult {
	success: boolean;
	error?: string;
}

export function isWindows(): boolean {
	return process.platform === 'win32';
}

export function buildProtocolRegistryArgs(scheme: string, executablePath: string): string[][] {
	const quotedExe = `"${executablePath}"`;
	return [
		['add', `HKCU\\Software\\Classes\\${scheme}`, '/ve', '/d', `URL:${scheme} Protocol`, '/f'],
		['add', `HKCU\\Software\\Classes\\${scheme}`, '/v', 'URL Protocol', '/d', '', '/f'],
		['add', `HKCU\\Software\\Classes\\${scheme}\\DefaultIcon`, '/ve', '/d', `${quotedExe},0`, '/f'],
		['add', `HKCU\\Software\\Classes\\${scheme}\\shell`, '/ve', '/d', 'open', '/f'],
		['add', `HKCU\\Software\\Classes\\${scheme}\\shell\\open`, '/ve', '/d', 'Open with Dardcor Code', '/f'],
		['add', `HKCU\\Software\\Classes\\${scheme}\\shell\\open\\command`, '/ve', '/d', `${quotedExe} "%1"`, '/f']
	];
}

export function registerWindowsProtocol(scheme: string, executablePath: string): Promise<ProtocolRegistrationResult> {
	if (!isWindows()) {
		return Promise.resolve({ success: false, error: 'Not Windows' });
	}
	const steps = buildProtocolRegistryArgs(scheme, executablePath);
	return runRegistrySteps(steps);
}

export function unregisterWindowsProtocol(scheme: string): Promise<ProtocolRegistrationResult> {
	if (!isWindows()) {
		return Promise.resolve({ success: false, error: 'Not Windows' });
	}
	return runRegistrySteps([
		['delete', `HKCU\\Software\\Classes\\${scheme}`, '/f']
	]);
}

export function isWindowsProtocolRegistered(scheme: string): Promise<boolean> {
	if (!isWindows()) {
		return Promise.resolve(false);
	}
	return new Promise((resolve) => {
		const child = spawn('reg', ['query', `HKCU\\Software\\Classes\\${scheme}\\shell\\open\\command`], {
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
		child.stdout?.on('data', () => {
			// Read to let the process finish.
		});
		child.on('error', () => resolve(false));
		child.on('close', (code) => resolve(code === 0));
	});
}

function runRegistrySteps(steps: string[][]): Promise<ProtocolRegistrationResult> {
	return steps.reduce<Promise<ProtocolRegistrationResult>>(
		(chain, args) =>
			chain.then((previous) => {
				if (!previous.success) {
					return previous;
				}
				return runRegCommand(args);
			}),
		Promise.resolve({ success: true })
	);
}

function runRegCommand(args: string[]): Promise<ProtocolRegistrationResult> {
	return new Promise((resolve) => {
		try {
			const child = spawn('reg', args, {
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			});
			let stderr = '';
			child.stderr?.on('data', (data: Buffer) => {
				stderr += data.toString();
			});
			child.on('error', (err) => resolve({ success: false, error: String(err) }));
			child.on('close', (code) => {
				if (code === 0) {
					resolve({ success: true });
				} else {
					resolve({ success: false, error: stderr || `reg.exe exited with code ${code}` });
				}
			});
		} catch (err) {
			resolve({ success: false, error: String(err) });
		}
	});
}

export function getSchemeValidation(scheme: string): string | null {
	if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
		return 'Invalid scheme format';
	}
	if (scheme.length > 64) {
		return 'Scheme too long';
	}
	return null;
}
