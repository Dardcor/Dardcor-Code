/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from '../common/path.js';
import * as pfs from './pfs.js';

const IntRegex: RegExp = /^\d+$/;

const PwshMsixRegex: RegExp = /^Microsoft.PowerShell_.*/;
const PwshPreviewMsixRegex: RegExp = /^Microsoft.PowerShellPreview_.*/;

const enum Arch {
	x64,
	x86,
	ARM
}

let processArch: Arch;
switch (process.arch) {
	case 'ia32':
		processArch = Arch.x86;
		break;
	case 'arm':
	case 'arm64':
		processArch = Arch.ARM;
		break;
	default:
		processArch = Arch.x64;
		break;
}

let osArch: Arch;
if (process.env['PROCESSOR_ARCHITEW6432']) {
	osArch = process.env['PROCESSOR_ARCHITEW6432'] === 'ARM64'
		? Arch.ARM
		: Arch.x64;
} else if (process.env['PROCESSOR_ARCHITECTURE'] === 'ARM64') {
	osArch = Arch.ARM;
} else if (process.env['PROCESSOR_ARCHITECTURE'] === 'X86') {
	osArch = Arch.x86;
} else {
	osArch = Arch.x64;
}

export interface IPowerShellExeDetails {
	readonly displayName: string;
	readonly exePath: string;
}

interface IPossiblePowerShellExe extends IPowerShellExeDetails {
	exists(): Promise<boolean>;
}

class PossiblePowerShellExe implements IPossiblePowerShellExe {
	constructor(
		public readonly exePath: string,
		public readonly displayName: string,
		private knownToExist?: boolean) { }

	public async exists(): Promise<boolean> {
		if (this.knownToExist === undefined) {
			this.knownToExist = await pfs.SymlinkSupport.existsFile(this.exePath);
		}
		return this.knownToExist;
	}
}

function getProgramFilesPath(
	{ useAlternateBitness = false }: { useAlternateBitness?: boolean } = {}): string | null {

	if (!useAlternateBitness) {
		return process.env.ProgramFiles || null;
	}

	if (processArch === Arch.x64) {
		return process.env['ProgramFiles(x86)'] || null;
	}

	if (osArch === Arch.x64) {
		return process.env.ProgramW6432 || null;
	}

	return null;
}

async function findPSCoreWindowsInstallation(
	{ useAlternateBitness = false, findPreview = false }:
		{ useAlternateBitness?: boolean; findPreview?: boolean } = {}): Promise<IPossiblePowerShellExe | null> {

	const programFilesPath = getProgramFilesPath({ useAlternateBitness });
	if (!programFilesPath) {
		return null;
	}

	const powerShellInstallBaseDir = path.join(programFilesPath, 'PowerShell');

	if (!await pfs.SymlinkSupport.existsDirectory(powerShellInstallBaseDir)) {
		return null;
	}

	let highestSeenVersion: number = -1;
	let pwshExePath: string | null = null;
	for (const item of await pfs.Promises.readdir(powerShellInstallBaseDir)) {

		let currentVersion: number = -1;
		if (findPreview) {

			const dashIndex = item.indexOf('-');
			if (dashIndex < 0) {
				continue;
			}

			const intPart: string = item.substring(0, dashIndex);
			if (!IntRegex.test(intPart) || item.substring(dashIndex + 1) !== 'preview') {
				continue;
			}

			currentVersion = parseInt(intPart, 10);
		} else {
			if (!IntRegex.test(item)) {
				continue;
			}

			currentVersion = parseInt(item, 10);
		}

		if (currentVersion <= highestSeenVersion) {
			continue;
		}

		const exePath = path.join(powerShellInstallBaseDir, item, 'pwsh.exe');
		if (!await pfs.SymlinkSupport.existsFile(exePath)) {
			continue;
		}

		pwshExePath = exePath;
		highestSeenVersion = currentVersion;
	}

	if (!pwshExePath) {
		return null;
	}

	const bitness: string = programFilesPath.includes('x86') ? ' (x86)' : '';
	const preview: string = findPreview ? ' Preview' : '';

	return new PossiblePowerShellExe(pwshExePath, `PowerShell${preview}${bitness}`, true);
}

async function findPSCoreMsix({ findPreview }: { findPreview?: boolean } = {}): Promise<IPossiblePowerShellExe | null> {
	if (!process.env.LOCALAPPDATA) {
		return null;
	}

	const msixAppDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');

	if (!await pfs.SymlinkSupport.existsDirectory(msixAppDir)) {
		return null;
	}

	const { pwshMsixDirRegex, pwshMsixName } = findPreview
		? { pwshMsixDirRegex: PwshPreviewMsixRegex, pwshMsixName: 'PowerShell Preview (Store)' }
		: { pwshMsixDirRegex: PwshMsixRegex, pwshMsixName: 'PowerShell (Store)' };

	for (const subdir of await pfs.Promises.readdir(msixAppDir)) {
		if (pwshMsixDirRegex.test(subdir)) {
			const pwshMsixPath = path.join(msixAppDir, subdir, 'pwsh.exe');
			return new PossiblePowerShellExe(pwshMsixPath, pwshMsixName);
		}
	}

	return null;
}

function findPSCoreDotnetGlobalTool(): IPossiblePowerShellExe {
	const dotnetGlobalToolExePath: string = path.join(os.homedir(), '.dotnet', 'tools', 'pwsh.exe');

	return new PossiblePowerShellExe(dotnetGlobalToolExePath, '.NET Core PowerShell Global Tool');
}

function findPSCoreScoopInstallation(): IPossiblePowerShellExe {
	const scoopAppsDir = path.join(os.homedir(), 'scoop', 'apps');
	const scoopPwsh = path.join(scoopAppsDir, 'pwsh', 'current', 'pwsh.exe');

	return new PossiblePowerShellExe(scoopPwsh, 'PowerShell (Scoop)');
}

function findWinPS(): IPossiblePowerShellExe | null {
	const winPSPath = path.join(
		process.env.windir!,
		processArch === Arch.x86 && osArch !== Arch.x86 ? 'SysNative' : 'System32',
		'WindowsPowerShell', 'v1.0', 'powershell.exe');

	return new PossiblePowerShellExe(winPSPath, 'Windows PowerShell', true);
}

async function* enumerateDefaultPowerShellInstallations(): AsyncIterable<IPossiblePowerShellExe> {
	let pwshExe = await findPSCoreWindowsInstallation();
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = await findPSCoreWindowsInstallation({ useAlternateBitness: true });
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = await findPSCoreMsix();
	if (pwshExe) {
		yield pwshExe;
	}

	// Look for the .NET global tool
	pwshExe = findPSCoreDotnetGlobalTool();
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = await findPSCoreWindowsInstallation({ findPreview: true });
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = await findPSCoreMsix({ findPreview: true });
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = await findPSCoreWindowsInstallation({ useAlternateBitness: true, findPreview: true });
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = await findPSCoreScoopInstallation();
	if (pwshExe) {
		yield pwshExe;
	}

	pwshExe = findWinPS();
	if (pwshExe) {
		yield pwshExe;
	}
}

export async function* enumeratePowerShellInstallations(): AsyncIterable<IPowerShellExeDetails> {
	for await (const defaultPwsh of enumerateDefaultPowerShellInstallations()) {
		if (await defaultPwsh.exists()) {
			yield defaultPwsh;
		}
	}
}

export async function getFirstAvailablePowerShellInstallation(): Promise<IPowerShellExeDetails | null> {
	for await (const pwsh of enumeratePowerShellInstallations()) {
		return pwsh;
	}
	return null;
}
