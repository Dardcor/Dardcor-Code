/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { env, LogOutputChannel } from 'vscode';


function isWindowsUserOrSystemSetup(): boolean {
	if (process.platform !== 'win32') {
		return false;
	}

	try {
		const productJsonPath = path.join(env.appRoot, 'product.json');
		const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
		const target = productJson.target as string | undefined;

		return target === 'user' || target === 'system';
	} catch {
		return false;
	}
}

interface SourceAskpassPaths {
	askpass: string;
	askpassMain: string;
	sshAskpass: string;
	askpassEmpty: string;
	sshAskpassEmpty: string;
}

function computeContentHash(sourcePaths: SourceAskpassPaths): string {
	const hash = crypto.createHash('sha256');

	const files = [
		sourcePaths.askpass,
		sourcePaths.askpassMain,
		sourcePaths.sshAskpass,
		sourcePaths.askpassEmpty,
		sourcePaths.sshAskpassEmpty,
	];

	for (const file of files) {
		const content = fs.readFileSync(file);
		hash.update(content);
		hash.update(path.basename(file));
	}

	return hash.digest('hex').substring(0, 16);
}

async function setWindowsPermissions(filePath: string, logger: LogOutputChannel): Promise<void> {
	const username = process.env['USERNAME'];
	if (!username) {
		logger.warn(`[askpassManager] Cannot set Windows permissions: USERNAME not set`);
		return;
	}

	return new Promise<void>((resolve) => {
		const args = [filePath, '/inheritance:r', '/grant:r', `${username}:F`];

		cp.execFile('icacls', args, (error, _stdout, stderr) => {
			if (error) {
				logger.warn(`[askpassManager] Failed to set permissions on ${filePath}: ${error.message}`);
				if (stderr) {
					logger.warn(`[askpassManager] icacls stderr: ${stderr}`);
				}
			} else {
				logger.trace(`[askpassManager] Set permissions on ${filePath}`);
			}
			resolve();
		});
	});
}

async function copyFileSecure(
	source: string,
	dest: string,
	logger: LogOutputChannel
): Promise<void> {
	const content = await fs.promises.readFile(source);
	await fs.promises.writeFile(dest, content);
	await setWindowsPermissions(dest, logger);
}

async function updateDirectoryMtime(dirPath: string, logger: LogOutputChannel): Promise<void> {
	try {
		const now = new Date();
		await fs.promises.utimes(dirPath, now, now);
		logger.trace(`[askpassManager] Updated mtime for ${dirPath}`);
	} catch (err) {
		logger.warn(`[askpassManager] Failed to update mtime for ${dirPath}: ${err}`);
	}
}

async function garbageCollectOldDirectories(
	askpassBaseDir: string,
	currentHash: string,
	logger: LogOutputChannel
): Promise<void> {
	try {
		try {
			await fs.promises.access(askpassBaseDir);
		} catch {
			return;
		}

		const entries = await fs.promises.readdir(askpassBaseDir);
		const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

		for (const entry of entries) {
			if (entry === currentHash) {
				continue;
			}

			const entryPath = path.join(askpassBaseDir, entry);

			try {
				const stat = await fs.promises.stat(entryPath);

				if (!stat.isDirectory()) {
					continue;
				}

				if (stat.mtime.getTime() < sevenDaysAgo) {
					logger.info(`[askpassManager] Removing old askpass directory: ${entryPath} (last used: ${stat.mtime.toISOString()})`);

					await fs.promises.rm(entryPath, { recursive: true, force: true });
				} else {
					logger.trace(`[askpassManager] Keeping askpass directory: ${entryPath} (last used: ${stat.mtime.toISOString()})`);
				}
			} catch (err) {
				logger.warn(`[askpassManager] Failed to process/remove directory ${entryPath}: ${err}`);
			}
		}
	} catch (err) {
		logger.warn(`[askpassManager] Failed to garbage collect old directories: ${err}`);
	}
}

export interface AskpassPaths {
	readonly askpass: string;
	readonly askpassMain: string;
	readonly sshAskpass: string;
	readonly askpassEmpty: string;
	readonly sshAskpassEmpty: string;
}

export async function ensureAskpassScripts(
	sourceDir: string,
	storageDir: string,
	logger: LogOutputChannel
): Promise<AskpassPaths> {
	const sourcePaths: SourceAskpassPaths = {
		askpass: path.join(sourceDir, 'askpass.sh'),
		askpassMain: path.join(sourceDir, 'askpass-main.js'),
		sshAskpass: path.join(sourceDir, 'ssh-askpass.sh'),
		askpassEmpty: path.join(sourceDir, 'askpass-empty.sh'),
		sshAskpassEmpty: path.join(sourceDir, 'ssh-askpass-empty.sh'),
	};

	const contentHash = computeContentHash(sourcePaths);
	logger.trace(`[askpassManager] Content hash: ${contentHash}`);

	const askpassBaseDir = path.join(storageDir, 'askpass');
	const askpassDir = path.join(askpassBaseDir, contentHash);

	const destPaths: AskpassPaths = {
		askpass: path.join(askpassDir, 'askpass.sh'),
		askpassMain: path.join(askpassDir, 'askpass-main.js'),
		sshAskpass: path.join(askpassDir, 'ssh-askpass.sh'),
		askpassEmpty: path.join(askpassDir, 'askpass-empty.sh'),
		sshAskpassEmpty: path.join(askpassDir, 'ssh-askpass-empty.sh'),
	};

	try {
		const stat = await fs.promises.stat(destPaths.askpass);
		if (stat.isFile()) {
			logger.trace(`[askpassManager] Using existing content-addressed askpass at ${askpassDir}`);

			await updateDirectoryMtime(askpassDir, logger);

			return destPaths;
		}
	} catch {
	}

	logger.info(`[askpassManager] Creating content-addressed askpass scripts at ${askpassDir}`);

	await fs.promises.mkdir(askpassDir, { recursive: true });
	await setWindowsPermissions(askpassDir, logger);

	await Promise.all([
		copyFileSecure(sourcePaths.askpass, destPaths.askpass, logger),
		copyFileSecure(sourcePaths.askpassMain, destPaths.askpassMain, logger),
		copyFileSecure(sourcePaths.sshAskpass, destPaths.sshAskpass, logger),
		copyFileSecure(sourcePaths.askpassEmpty, destPaths.askpassEmpty, logger),
		copyFileSecure(sourcePaths.sshAskpassEmpty, destPaths.sshAskpassEmpty, logger),
	]);

	logger.info(`[askpassManager] Successfully created content-addressed askpass scripts`);

	await updateDirectoryMtime(askpassDir, logger);

	await garbageCollectOldDirectories(askpassBaseDir, contentHash, logger);

	return destPaths;
}

export async function getAskpassPaths(
	sourceDir: string,
	storagePath: string | undefined,
	logger: LogOutputChannel
): Promise<AskpassPaths> {
	if (storagePath && isWindowsUserOrSystemSetup()) {
		try {
			return await ensureAskpassScripts(sourceDir, storagePath, logger);
		} catch (err) {
			logger.error(`[askpassManager] Failed to create content-addressed askpass scripts: ${err}`);
		}
	}

	return {
		askpass: path.join(sourceDir, 'askpass.sh'),
		askpassMain: path.join(sourceDir, 'askpass-main.js'),
		sshAskpass: path.join(sourceDir, 'ssh-askpass.sh'),
		askpassEmpty: path.join(sourceDir, 'askpass-empty.sh'),
		sshAskpassEmpty: path.join(sourceDir, 'ssh-askpass-empty.sh'),
	};
}
