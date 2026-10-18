/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { ResourceQueue, timeout } from '../common/async.js';
import { isEqualOrParent, isRootOrDriveLetter, randomPath } from '../common/extpath.js';
import { normalizeNFC } from '../common/normalization.js';
import { basename, dirname, join, normalize, sep } from '../common/path.js';
import { isLinux, isMacintosh, isWindows } from '../common/platform.js';
import { extUriBiasedIgnorePathCase } from '../common/resources.js';
import { URI } from '../common/uri.js';
import { CancellationToken } from '../common/cancellation.js';
import { rtrim } from '../common/strings.js';


export enum RimRafMode {

	UNLINK,

	MOVE
}

async function rimraf(path: string, mode: RimRafMode.UNLINK): Promise<void>;
async function rimraf(path: string, mode: RimRafMode.MOVE, moveToPath?: string): Promise<void>;
async function rimraf(path: string, mode?: RimRafMode, moveToPath?: string): Promise<void>;
async function rimraf(path: string, mode = RimRafMode.UNLINK, moveToPath?: string): Promise<void> {
	if (isRootOrDriveLetter(path)) {
		throw new Error('rimraf - will refuse to recursively delete root');
	}

	if (mode === RimRafMode.UNLINK) {
		return rimrafUnlink(path);
	}

	return rimrafMove(path, moveToPath);
}

async function rimrafMove(path: string, moveToPath = randomPath(tmpdir())): Promise<void> {
	try {
		try {
			await fs.promises.rename(path, moveToPath);
		} catch (error) {
			if (error.code === 'ENOENT') {
				return;
			}

			return rimrafUnlink(path);
		}

		rimrafUnlink(moveToPath).catch(() => { });
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
}

async function rimrafUnlink(path: string): Promise<void> {
	return fs.promises.rm(path, { recursive: true, force: true, maxRetries: 3 });
}



export interface IDirent {
	name: string;

	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

async function readdir(path: string): Promise<string[]>;
async function readdir(path: string, options: { withFileTypes: true }): Promise<IDirent[]>;
async function readdir(path: string, options?: { withFileTypes: true }): Promise<(string | IDirent)[]> {
	try {
		return await doReaddir(path, options);
	} catch (error) {
		if (error.code === 'ENOENT' && isWindows && isRootOrDriveLetter(path)) {
			try {
				return await doReaddir(`${path}.`, options);
			} catch {
			}
		}
		throw error;
	}
}

async function doReaddir(path: string, options?: { withFileTypes: true }): Promise<(string | IDirent)[]> {
	return handleDirectoryChildren(await (options ? safeReaddirWithFileTypes(path) : fs.promises.readdir(path)));
}

async function safeReaddirWithFileTypes(path: string): Promise<IDirent[]> {
	try {
		return await fs.promises.readdir(path, { withFileTypes: true });
	} catch (error) {
		if (error.code !== 'ENOENT') {
			console.warn('[node.js fs] readdir with filetypes failed with error: ', error);
		}
	}

	const result: IDirent[] = [];
	const children = await readdir(path);
	for (const child of children) {
		let isFile = false;
		let isDirectory = false;
		let isSymbolicLink = false;

		try {
			const lstat = await fs.promises.lstat(join(path, child));

			isFile = lstat.isFile();
			isDirectory = lstat.isDirectory();
			isSymbolicLink = lstat.isSymbolicLink();
		} catch (error) {
			if (error.code !== 'ENOENT') {
				console.warn('[node.js fs] unexpected error from lstat after readdir: ', error);
			}
		}

		result.push({
			name: child,
			isFile: () => isFile,
			isDirectory: () => isDirectory,
			isSymbolicLink: () => isSymbolicLink
		});
	}

	return result;
}

function handleDirectoryChildren(children: string[]): string[];
function handleDirectoryChildren(children: IDirent[]): IDirent[];
function handleDirectoryChildren(children: (string | IDirent)[]): (string | IDirent)[];
function handleDirectoryChildren(children: (string | IDirent)[]): (string | IDirent)[] {
	return children.map(child => {


		if (typeof child === 'string') {
			return isMacintosh ? normalizeNFC(child) : child;
		}

		child.name = isMacintosh ? normalizeNFC(child.name) : child.name;

		return child;
	});
}

async function readDirsInDir(dirPath: string): Promise<string[]> {
	const children = await readdir(dirPath);
	const directories: string[] = [];

	for (const child of children) {
		if (await SymlinkSupport.existsDirectory(join(dirPath, child))) {
			directories.push(child);
		}
	}

	return directories;
}



export function whenDeleted(path: string, intervalMs = 1000): Promise<void> {
	return new Promise<void>(resolve => {
		let running = false;
		const interval = setInterval(() => {
			if (!running) {
				running = true;
				fs.access(path, err => {
					running = false;

					if (err) {
						clearInterval(interval);
						resolve(undefined);
					}
				});
			}
		}, intervalMs);
	});
}



export namespace SymlinkSupport {

	export interface IStats {

		stat: fs.Stats;

		symbolicLink?: { dangling: boolean };
	}

	export async function stat(path: string): Promise<IStats> {

		let lstats: fs.Stats | undefined;
		try {
			lstats = await fs.promises.lstat(path);

			if (!lstats.isSymbolicLink()) {
				return { stat: lstats };
			}
		} catch {
		}

		try {
			const stats = await fs.promises.stat(path);

			return { stat: stats, symbolicLink: lstats?.isSymbolicLink() ? { dangling: false } : undefined };
		} catch (error) {

			if (error.code === 'ENOENT' && lstats) {
				return { stat: lstats, symbolicLink: { dangling: true } };
			}

			if (isWindows && error.code === 'EACCES') {
				try {
					const stats = await fs.promises.stat(await fs.promises.readlink(path));

					return { stat: stats, symbolicLink: { dangling: false } };
				} catch (error) {

					if (error.code === 'ENOENT' && lstats) {
						return { stat: lstats, symbolicLink: { dangling: true } };
					}

					throw error;
				}
			}

			throw error;
		}
	}

	export async function existsFile(path: string): Promise<boolean> {
		try {
			const { stat, symbolicLink } = await SymlinkSupport.stat(path);

			return stat.isFile() && symbolicLink?.dangling !== true;
		} catch {
		}

		return false;
	}

	export async function existsDirectory(path: string): Promise<boolean> {
		try {
			const { stat, symbolicLink } = await SymlinkSupport.stat(path);

			return stat.isDirectory() && symbolicLink?.dangling !== true;
		} catch {
		}

		return false;
	}
}



const writeQueues = new ResourceQueue();

function writeFile(path: string, data: string, options?: IWriteFileOptions): Promise<void>;
function writeFile(path: string, data: Buffer, options?: IWriteFileOptions): Promise<void>;
function writeFile(path: string, data: Uint8Array, options?: IWriteFileOptions): Promise<void>;
function writeFile(path: string, data: string | Buffer | Uint8Array, options?: IWriteFileOptions): Promise<void>;
function writeFile(path: string, data: string | Buffer | Uint8Array, options?: IWriteFileOptions): Promise<void> {
	return writeQueues.queueFor(URI.file(path), () => {
		const ensuredOptions = ensureWriteOptions(options);

		return new Promise((resolve, reject) => doWriteFileAndFlush(path, data, ensuredOptions, error => error ? reject(error) : resolve()));
	}, extUriBiasedIgnorePathCase);
}

interface IWriteFileOptions {
	mode?: number;
	flag?: string;
}

interface IEnsuredWriteFileOptions extends IWriteFileOptions {
	mode: number;
	flag: string;
}

let canFlush = true;
export function configureFlushOnWrite(enabled: boolean): void {
	canFlush = enabled;
}

function doWriteFileAndFlush(path: string, data: string | Buffer | Uint8Array, options: IEnsuredWriteFileOptions, callback: (error: Error | null) => void): void {
	if (!canFlush) {
		return fs.writeFile(path, data, { mode: options.mode, flag: options.flag }, callback);
	}

	fs.open(path, options.flag, options.mode, (openError, fd) => {
		if (openError) {
			return callback(openError);
		}

		fs.writeFile(fd, data, writeError => {
			if (writeError) {
				return fs.close(fd, () => callback(writeError));
			}

			fs.fdatasync(fd, (syncError: Error | null) => {

				if (syncError) {
					console.warn('[node.js fs] fdatasync is now disabled for this session because it failed: ', syncError);
					configureFlushOnWrite(false);
				}

				return fs.close(fd, closeError => callback(closeError));
			});
		});
	});
}

export function writeFileSync(path: string, data: string | Buffer, options?: IWriteFileOptions): void {
	const ensuredOptions = ensureWriteOptions(options);

	if (!canFlush) {
		return fs.writeFileSync(path, data, { mode: ensuredOptions.mode, flag: ensuredOptions.flag });
	}

	const fd = fs.openSync(path, ensuredOptions.flag, ensuredOptions.mode);

	try {

		fs.writeFileSync(fd, data);

		try {
			fs.fdatasyncSync(fd);
		} catch (syncError) {
			console.warn('[node.js fs] fdatasyncSync is now disabled for this session because it failed: ', syncError);
			configureFlushOnWrite(false);
		}
	} finally {
		fs.closeSync(fd);
	}
}

function ensureWriteOptions(options?: IWriteFileOptions): IEnsuredWriteFileOptions {
	if (!options) {
		return { mode: 0o666 , flag: 'w' };
	}

	return {
		mode: typeof options.mode === 'number' ? options.mode : 0o666 ,
		flag: typeof options.flag === 'string' ? options.flag : 'w'
	};
}



async function rename(source: string, target: string, windowsRetryTimeout: number | false = 60000): Promise<void> {
	if (source === target) {
		return;
	}

	try {
		if (isWindows && typeof windowsRetryTimeout === 'number') {
			await renameWithRetry(source, target, Date.now(), windowsRetryTimeout);
		} else {
			await fs.promises.rename(source, target);
		}
	} catch (error) {
		if (source.toLowerCase() !== target.toLowerCase() && error.code === 'EXDEV' || source.endsWith('.')) {
			await copy(source, target, { preserveSymlinks: false });
			await rimraf(source, RimRafMode.MOVE);
		} else {
			throw error;
		}
	}
}

async function renameWithRetry(source: string, target: string, startTime: number, retryTimeout: number, attempt = 0): Promise<void> {
	try {
		return await fs.promises.rename(source, target);
	} catch (error) {
		if (error.code !== 'EACCES' && error.code !== 'EPERM' && error.code !== 'EBUSY') {
			throw error;
		}

		if (Date.now() - startTime >= retryTimeout) {
			console.error(`[node.js fs] rename failed after ${attempt} retries with error: ${error}`);

			throw error;
		}

		if (attempt === 0) {
			let abortRetry = false;
			try {
				const { stat } = await SymlinkSupport.stat(target);
				if (!stat.isFile()) {
					abortRetry = true;
				}
			} catch {
			}

			if (abortRetry) {
				throw error;
			}
		}

		await timeout(Math.min(100, attempt * 10));

		return renameWithRetry(source, target, startTime, retryTimeout, attempt + 1);
	}
}

interface ICopyPayload {
	readonly root: { source: string; target: string };
	readonly options: { preserveSymlinks: boolean };
	readonly handledSourcePaths: Set<string>;
}

async function copy(source: string, target: string, options: { preserveSymlinks: boolean }): Promise<void> {
	return doCopy(source, target, { root: { source, target }, options, handledSourcePaths: new Set<string>() });
}

const COPY_MODE_MASK = 0o777;

async function doCopy(source: string, target: string, payload: ICopyPayload): Promise<void> {

	if (payload.handledSourcePaths.has(source)) {
		return;
	} else {
		payload.handledSourcePaths.add(source);
	}

	const { stat, symbolicLink } = await SymlinkSupport.stat(source);

	if (symbolicLink) {

		if (payload.options.preserveSymlinks) {
			try {
				return await doCopySymlink(source, target, payload);
			} catch {
			}
		}

		if (symbolicLink.dangling) {
			return;
		}
	}

	if (stat.isDirectory()) {
		return doCopyDirectory(source, target, stat.mode & COPY_MODE_MASK, payload);
	}

	else {
		return doCopyFile(source, target, stat.mode & COPY_MODE_MASK);
	}
}

async function doCopyDirectory(source: string, target: string, mode: number, payload: ICopyPayload): Promise<void> {

	await fs.promises.mkdir(target, { recursive: true, mode });

	const files = await readdir(source);
	for (const file of files) {
		await doCopy(join(source, file), join(target, file), payload);
	}
}

async function doCopyFile(source: string, target: string, mode: number): Promise<void> {

	await fs.promises.copyFile(source, target);

	await fs.promises.chmod(target, mode);
}

async function doCopySymlink(source: string, target: string, payload: ICopyPayload): Promise<void> {

	let linkTarget = await fs.promises.readlink(source);

	if (isEqualOrParent(linkTarget, payload.root.source, !isLinux)) {
		linkTarget = join(payload.root.target, linkTarget.substr(payload.root.source.length + 1));
	}

	await fs.promises.symlink(linkTarget, target);
}



export async function realcase(path: string, token?: CancellationToken): Promise<string | null> {
	if (isLinux) {
		return path;
	}

	const dir = dirname(path);
	if (path === dir) {
		return path;
	}

	const name = (basename(path) || path).toLowerCase();
	try {
		if (token?.isCancellationRequested) {
			return null;
		}

		const entries = await Promises.readdir(dir);
		const found = entries.filter(e => e.toLowerCase() === name);
		if (found.length === 1) {
			const prefix = await realcase(dir, token);
			if (prefix) {
				return join(prefix, found[0]);
			}
		} else if (found.length > 1) {
			const ix = found.indexOf(name);
			if (ix >= 0) {
				const prefix = await realcase(dir, token);
				if (prefix) {
					return join(prefix, found[ix]);
				}
			}
		}
	} catch {
	}

	return null;
}

async function realpath(path: string): Promise<string> {
	try {
		return await promisify(fs.realpath)(path);
	} catch {

		const normalizedPath = normalizePath(path);

		await fs.promises.access(normalizedPath, fs.constants.R_OK);

		return normalizedPath;
	}
}

export function realpathSync(path: string): string {
	try {
		return fs.realpathSync(path);
	} catch {

		const normalizedPath = normalizePath(path);

		fs.accessSync(normalizedPath, fs.constants.R_OK);

		return normalizedPath;
	}
}

function normalizePath(path: string): string {
	return rtrim(normalize(path), sep);
}



export const Promises = new class {


	get read() {


		return (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => {
			return new Promise<{ bytesRead: number; buffer: Uint8Array }>((resolve, reject) => {
				fs.read(fd, buffer, offset, length, position, (err, bytesRead, buffer) => {
					if (err) {
						return reject(err);
					}

					return resolve({ bytesRead, buffer });
				});
			});
		};
	}

	get write() {


		return (fd: number, buffer: Uint8Array, offset: number | undefined | null, length: number | undefined | null, position: number | undefined | null) => {
			return new Promise<{ bytesWritten: number; buffer: Uint8Array }>((resolve, reject) => {
				fs.write(fd, buffer, offset, length, position, (err, bytesWritten, buffer) => {
					if (err) {
						return reject(err);
					}

					return resolve({ bytesWritten, buffer });
				});
			});
		};
	}

	get fdatasync() { return promisify(fs.fdatasync); }

	get open() { return promisify(fs.open); }
	get close() { return promisify(fs.close); }

	get ftruncate() { return promisify(fs.ftruncate); }



	async exists(path: string): Promise<boolean> {
		try {
			await fs.promises.access(path);

			return true;
		} catch {
			return false;
		}
	}

	get readdir() { return readdir; }
	get readDirsInDir() { return readDirsInDir; }

	get writeFile() { return writeFile; }

	get rm() { return rimraf; }

	get rename() { return rename; }
	get copy() { return copy; }

	get realpath() { return realpath; }

};

