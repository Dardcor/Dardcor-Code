/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { isWindows } from '../common/platform.js';

let versionInfo: { release: string; buildNumber: number } | undefined;

export async function initWindowsVersionInfo() {
	if (versionInfo) {
		return;
	}

	if (!isWindows) {
		versionInfo = { release: os.release(), buildNumber: 0 };
		return;
	}

	let buildNumber: number | undefined;
	let release: string | undefined;
	try {
		const Registry = await import('@vscode/windows-registry');
		const versionKey = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';

		const build = Registry.GetStringRegKey('HKEY_LOCAL_MACHINE', versionKey, 'CurrentBuild');
		if (build !== undefined) {
			buildNumber = parseInt(build, 10);
			if (isNaN(buildNumber)) {
				buildNumber = undefined;
			}
		}

		const major = Registry.GetDWORDRegKey('HKEY_LOCAL_MACHINE', versionKey, 'CurrentMajorVersionNumber');
		const minor = Registry.GetDWORDRegKey('HKEY_LOCAL_MACHINE', versionKey, 'CurrentMinorVersionNumber');
		if (major !== undefined && minor !== undefined && build !== undefined) {
			release = `${major}.${minor}.${build}`;
		}
	} catch {
	} finally {
		versionInfo = {
			release: release || os.release(),
			buildNumber: buildNumber || getWindowsBuildNumberFromOsRelease()
		};
	}
}

export async function getWindowsRelease(): Promise<string> {
	if (!versionInfo) {
		await initWindowsVersionInfo();
	}
	return versionInfo!.release;
}

export async function getWindowsBuildNumberAsync(): Promise<number> {
	if (!versionInfo) {
		await initWindowsVersionInfo();
	}
	return versionInfo!.buildNumber;
}

export function getWindowsBuildNumberSync(): number {
	if (versionInfo) {
		return versionInfo.buildNumber;
	} else {
		return isWindows ? getWindowsBuildNumberFromOsRelease() : 0;
	}
}

export function getWindowsReleaseSync(): string {
	return versionInfo?.release ?? os.release();
}

function getWindowsBuildNumberFromOsRelease(): number {
	const osVersion = (/(\d+)\.(\d+)\.(\d+)/g).exec(os.release());
	if (osVersion && osVersion.length === 4) {
		return parseInt(osVersion[3], 10);
	}
	return 0;
}
