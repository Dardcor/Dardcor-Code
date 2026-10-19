import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function getCurrentUserSid(): Promise<string> {
	const { stdout } = await execFileAsync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, encoding: 'utf8' });
	const sid = /S-1-\d+(?:-\d+)+/i.exec(stdout)?.[0];
	if (!sid) {
		throw new Error('Unable to resolve the current Windows user SID.');
	}
	return sid;
}

export async function ensureWindowsElectronPermissions(runtimePath: string): Promise<void> {
	if (process.platform !== 'win32') {
		return;
	}

	const userSid = await getCurrentUserSid();
	const permissions = [
		'*S-1-5-18:(OI)(CI)F',
		'*S-1-5-32-544:(OI)(CI)F',
		'*S-1-5-11:(OI)(CI)RX',
		'*S-1-5-32-545:(OI)(CI)RX',
		'*S-1-15-2-2:(OI)(CI)RX',
		`*${userSid}:(OI)(CI)F`
	];

	try {
		await execFileAsync('icacls.exe', [path.resolve(runtimePath), '/inheritance:r', '/grant:r', ...permissions], { windowsHide: true, encoding: 'utf8' });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to normalize Electron runtime permissions at ${runtimePath}: ${detail}`, { cause: error });
	}
}
