/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, spawnSync, SpawnSyncReturns } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import { test } from 'mocha';
import fetch, { Response } from 'node-fetch';
import os from 'os';
import path from 'path';
import { Browser, chromium, ElectronApplication, Page, webkit } from 'playwright';
import { Capability, detectCapabilities } from './detectors.js';

interface ITargetMetadata {
	url: string;
	name: string;
	version: string;
	productVersion: string;
	hash: string;
	timestamp: number;
	sha256hash: string;
	supportsFastUpdate: boolean;
}

export class TestContext {
	private static readonly authenticodeInclude = /^.+\.(exe|dll|sys|cab|cat|msi|jar|ocx|ps1|psm1|psd1|ps1xml|pssc1)$/i;
	private static readonly authenticodeExclude = /[\\/]node_modules[\\/]@microsoft[\\/]mxc-sdk[\\/]bin[\\/][^\\/]+[\\/]_manifest[\\/][^\\/]+[\\/]manifest\.cat$/i;
	private static readonly versionInfoInclude = /^.+\.(exe|dll|node|msi)$/i;
	private static readonly versionInfoFileExclude = /^(dxil\.dll|ffmpeg\.dll|msalruntime\.dll)$/i;
	private static readonly versionInfoPathExclude = /(?:^|[\\/])node_modules(?:\.asar\.unpacked)?[\\/]@microsoft[\\/]mxc-sdk[\\/]bin[\\/]/i;
	private static readonly dpkgLockError = /dpkg frontend lock was locked by another process|unable to acquire the dpkg frontend lock|could not get lock \/var\/lib\/dpkg\/lock-frontend/i;

	private readonly tempDirs = new Set<string>();
	private readonly wslTempDirs = new Set<string>();
	private nextPort = 3010;
	private currentTestName: string | undefined;
	private screenshotCounter = 0;
	private wslVersion: number | undefined;

	public constructor(public readonly options: Readonly<{
		quality: 'stable' | 'insider' | 'exploration';
		commit: string;
		verbose: boolean;
		cleanup: boolean;
		checkSigning: boolean;
		headlessBrowser: boolean;
		downloadOnly: boolean;
		screenshotsDir: string | undefined;
		crashDumpsDir: string | undefined;
	}>) {
	}

	public readonly isRootUser = process.getuid?.() === 0;

	public readonly capabilities = detectCapabilities();

	public readonly osTempDir = (() => {
		let tempDir = fs.realpathSync(os.tmpdir());

		if (os.platform() === 'win32') {
			tempDir = fs.realpathSync.native(tempDir);
		}

		return tempDir;
	})();

	public test(name: string, require: Capability[], fn: () => Promise<void>): Mocha.Test | void {
		if (!this.options.downloadOnly && require.some(o => !this.capabilities.has(o))) {
			return;
		}

		const self = this;
		return test(name, async function () {
			self.currentTestName = name;
			self.screenshotCounter = 0;
			self.log(`Starting test: ${name}`);

			const homeDir = os.homedir();
			process.chdir(homeDir);
			self.log(`Changed working directory to: ${homeDir}`);

			try {
				await fn();

			} catch (error) {
				self.log(`Test failed with error: ${error instanceof Error ? error.message : String(error)}`);
				throw error;

			} finally {
				self.currentTestName = undefined;

				process.chdir(homeDir);
				self.log(`Changed working directory to: ${homeDir}`);

				if (self.options.cleanup) {
					self.cleanup();
				}

				self.log(`Finished test: ${name}`);
			}
		});
	}

	public consoleOutputs: string[] = [];

	public log(message: string) {
		const line = `[${new Date().toISOString()}] ${message}`;
		this.consoleOutputs.push(line);
		if (this.options.verbose) {
			console.log(line);
		}
	}

	public error(message: string): never {
		const line = `[${new Date().toISOString()}] ERROR: ${message}`;
		this.consoleOutputs.push(line);
		console.error(`##vso[task.logissue type=error]${line}`);
		throw new Error(message);
	}

	public warn(message: string) {
		const line = `[${new Date().toISOString()}] WARNING: ${message}`;
		this.consoleOutputs.push(line);
		console.warn(`##vso[task.logissue type=warning]${line}`);
	}

	private timeout(delay: number) {
		return new Promise(resolve => setTimeout(resolve, delay));
	}

	public createTempDir(): string {
		const tempDir = fs.mkdtempSync(path.join(this.osTempDir, 'vscode-sanity'));
		this.log(`Created temp directory: ${tempDir}`);
		this.tempDirs.add(tempDir);
		return tempDir;
	}

	public createWslTempDir(): string {
		const tempDir = `/tmp/vscode-sanity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this.log(`Creating WSL temp directory: ${tempDir}`);
		this.runNoErrors('wsl', 'mkdir', '-p', tempDir);
		this.wslTempDirs.add(tempDir);
		return tempDir;
	}

	public deleteWslDir(dir: string): void {
		this.log(`Deleting WSL directory: ${dir}`);
		this.runNoErrors('wsl', 'rm', '-rf', dir);
	}

	public toWslPath(windowsPath: string): string {
		return windowsPath
			.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
			.replaceAll('\\', '/');
	}

	public getDefaultWslDistro(): string {
		const result = this.runNoErrors('wsl', '--list', '--quiet');
		const distro = result.stdout.trim().split('\n')[0].replace(/\0/g, '').trim();
		if (!distro) {
			this.error('No WSL distribution found');
		}
		this.log(`Default WSL distribution: ${distro}`);
		return distro;
	}

	public getUbuntuWslVersion(): number | undefined {
		if (this.wslVersion !== undefined) {
			return this.wslVersion;
		}

		const result = this.runNoErrors('wsl', '--list', '--verbose');
		for (const rawLine of result.stdout.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || /^NAME\s+STATE\s+VERSION$/i.test(line)) {
				continue;
			}

			const normalizedLine = line.replace(/^\*\s*/, '');
			const columns = normalizedLine.split(/\s+/);
			if (columns.length < 3 || columns[0] !== 'Ubuntu') {
				continue;
			}

			const version = Number(columns[columns.length - 1]);
			if (!Number.isNaN(version)) {
				this.wslVersion = version;
				return this.wslVersion;
			}
		}

		return undefined;
	}

	public ensureDirExists(filePath: string) {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	public cleanup() {
		for (const dir of this.tempDirs) {
			this.log(`Deleting temp directory: ${dir}`);
			try {
				fs.rmSync(dir, { recursive: true, force: true });
				this.log(`Deleted temp directory: ${dir}`);
			} catch (error) {
				this.warn(`Failed to delete temp directory: ${dir}: ${error}`);
			}
		}
		this.tempDirs.clear();

		for (const dir of this.wslTempDirs) {
			try {
				this.deleteWslDir(dir);
			} catch (error) {
				this.warn(`Failed to delete WSL temp directory: ${dir}: ${error}`);
			}
		}
		this.wslTempDirs.clear();
	}

	public async fetchNoErrors(url: string): Promise<Response & { body: NodeJS.ReadableStream }> {
		const maxRetries = 5;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			if (attempt > 0) {
				const delay = Math.pow(2, attempt - 1) * 1000;
				this.warn(`Retrying fetch (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms`);
				await this.timeout(delay);
			}

			try {
				const response = await fetch(url);
				if (!response.ok) {
					lastError = new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
					continue;
				}

				if (response.body === null) {
					lastError = new Error(`Response body is null for ${url}`);
					continue;
				}

				return response as Response & { body: NodeJS.ReadableStream };
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				this.warn(`Fetch attempt ${attempt + 1} failed: ${lastError.message}`);
			}
		}

		this.error(`Failed to fetch ${url} after ${maxRetries} attempts: ${lastError?.message}`);
	}

	public async fetchMetadata(target: string): Promise<ITargetMetadata> {
		const url = `https://update.code.visualstudio.com/api/versions/commit:${this.options.commit}/${target}/${this.options.quality}`;

		this.log(`Fetching metadata for ${target} from ${url}`);
		const response = await this.fetchNoErrors(url);

		const result = await response.json() as ITargetMetadata;
		if (result.url === undefined || result.sha256hash === undefined) {
			this.error(`Invalid metadata response for ${target}: ${JSON.stringify(result)}`);
		}

		this.log(`Fetched metadata for ${target}: ${JSON.stringify(result)}`);
		return result;
	}

	public async downloadTarget(target: string): Promise<string> {
		const { url, sha256hash } = await this.fetchMetadata(target);
		const filePath = path.join(this.createTempDir(), path.basename(url));

		this.log(`Downloading ${url} to ${filePath}`);
		this.runNoErrors('curl', '-fSL', '--retry', '5', '--retry-delay', '2', '--retry-all-errors', '-o', filePath, url);
		this.log(`Downloaded ${url} to ${filePath}`);

		this.validateSha256Hash(filePath, sha256hash);
		return filePath;
	}

	public validateSha256Hash(filePath: string, expectedHash: string) {
		this.log(`Validating SHA256 hash for ${filePath}`);

		const buffer = fs.readFileSync(filePath);
		const hash = createHash('sha256').update(buffer).digest('hex');

		if (hash !== expectedHash) {
			this.error(`Hash mismatch for ${filePath}: expected ${expectedHash}, got ${hash}`);
		}
	}

	public validateAuthenticodeSignature(filePath: string) {
		if (!this.options.checkSigning || !this.capabilities.has('windows')) {
			this.log(`Skipping Authenticode signature validation for ${filePath} (signing checks disabled)`);
			return;
		}

		this.log(`Validating Authenticode signature for ${filePath}`);
		this.validateAuthenticodeSignaturesForFiles([filePath]);
	}

	private collectAuthenticodeFiles(dir: string, files: string[]): void {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const filePath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				this.collectAuthenticodeFiles(filePath, files);
			} else if (TestContext.authenticodeInclude.test(entry.name)) {
				if (TestContext.authenticodeExclude.test(filePath)) {
					this.log(`Skipping excluded file from Authenticode validation: ${filePath}`);
				} else {
					files.push(filePath);
				}
			}
		}
	}

	private validateAuthenticodeSignaturesForFiles(files: string[]): void {
		if (files.length === 0) {
			return;
		}

		const fileList = files.map(file => `"${file}"`).join(',');
		const command = `@(${fileList}) | ForEach-Object { $sig = Get-AuthenticodeSignature $_; "$($sig.Path)|$($sig.Status)" }`;
		const result = this.runNoErrors('powershell', '-NoProfile', '-Command', command);

		const invalid: string[] = [];
		for (const line of result.stdout.trim().split('\n')) {
			const [, filePath, status] = /^(.+)\|(\w+)$/.exec(line.trim()) ?? [];
			if (filePath) {
				if (status === 'Valid') {
					this.log(`Authenticode signature is valid for ${filePath}`);
				} else {
					invalid.push(`${filePath}: ${status}`);
				}
			}
		}

		if (invalid.length > 0) {
			this.error(`Authenticode signatures are not valid for:\n${invalid.join('\n')}`);
		}
	}

	public validateAllAuthenticodeSignatures(dir: string) {
		if (!this.options.checkSigning || !this.capabilities.has('windows')) {
			this.log(`Skipping Authenticode signature validation for ${dir} (signing checks disabled)`);
			return;
		}

		const files: string[] = [];
		this.collectAuthenticodeFiles(dir, files);
		this.log(`Found ${files.length} file(s) to validate Authenticode signatures`);
		this.validateAuthenticodeSignaturesForFiles(files);
	}

	private collectVersionInfoFiles(dir: string, files: string[]): void {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const filePath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				this.collectVersionInfoFiles(filePath, files);
			} else if (TestContext.versionInfoInclude.test(entry.name)) {
				if (TestContext.versionInfoFileExclude.test(entry.name) || TestContext.versionInfoPathExclude.test(filePath)) {
					this.log(`Skipping excluded file from VersionInfo validation: ${filePath}`);
				} else {
					files.push(filePath);
				}
			}
		}
	}

	public validateVersionInfo(filePath: string) {
		if (!this.options.checkSigning || !this.capabilities.has('windows')) {
			this.log(`Skipping VersionInfo validation for ${filePath} (signing checks disabled)`);
			return;
		}

		this.log(`Validating VersionInfo for ${filePath}`);
		this.validateVersionInfoForFiles([filePath]);
	}

	private validateVersionInfoForFiles(files: string[]): void {
		if (files.length === 0) {
			return;
		}

		const fileList = files.map(file => `"${file}"`).join(',');
		const command = `@(${fileList}) | ForEach-Object { $vi = (Get-Item $_).VersionInfo; "$($_.ToString())|$($vi.ProductName)" }`;
		const result = this.runNoErrors('powershell', '-NoProfile', '-Command', command);

		const invalid: string[] = [];
		for (const line of result.stdout.trim().split('\n')) {
			const [, filePath, productName] = /^(.+)\|(.*)$/.exec(line.trim()) ?? [];
			if (filePath) {
				if (productName && productName.trim().length > 0) {
					this.log(`VersionInfo ProductName is set for ${filePath}: ${productName.trim()}`);
				} else {
					invalid.push(filePath);
				}
			}
		}

		if (invalid.length > 0) {
			this.error(`VersionInfo ProductName is missing or empty for:\n${invalid.join('\n')}`);
		}
	}

	public validateAllVersionInfo(dir: string) {
		if (!this.options.checkSigning || !this.capabilities.has('windows')) {
			this.log(`Skipping VersionInfo validation for ${dir} (signing checks disabled)`);
			return;
		}

		const files: string[] = [];
		this.collectVersionInfoFiles(dir, files);
		this.log(`Found ${files.length} file(s) to validate VersionInfo`);
		this.validateVersionInfoForFiles(files);
	}

	public validateCodesignSignature(filePath: string) {
		if (!this.options.checkSigning || !this.capabilities.has('darwin')) {
			this.log(`Skipping codesign signature validation for ${filePath} (signing checks disabled)`);
			return;
		}

		this.log(`Validating codesign signature for ${filePath}`);

		const result = this.run('codesign', '--verify', '--deep', '--strict', '--verbose=2', filePath);
		if (result.error !== undefined) {
			this.error(`Failed to run codesign: ${result.error.message}`);
		}

		if (result.status !== 0) {
			this.error(`Codesign signature is not valid for ${filePath}: ${result.stderr}`);
		}

		this.log(`Validating notarization for ${filePath}`);

		const notaryResult = this.run('spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', filePath);
		if (notaryResult.error !== undefined) {
			this.error(`Failed to run spctl: ${notaryResult.error.message}`);
		}

		if (notaryResult.status !== 0) {
			this.error(`Notarization is not valid for ${filePath}: ${notaryResult.stderr}`);
		}
	}

	public validateAllCodesignSignatures(dir: string) {
		if (!this.options.checkSigning || !this.capabilities.has('darwin')) {
			this.log(`Skipping codesign signature validation for ${dir} (signing checks disabled)`);
			return;
		}

		const files = fs.readdirSync(dir, { withFileTypes: true });
		for (const file of files) {
			const filePath = path.join(dir, file.name);
			if (file.isDirectory()) {
				if (file.name.endsWith('.app') || file.name.endsWith('.framework')) {
					this.validateCodesignSignature(filePath);
				} else {
					this.validateAllCodesignSignatures(filePath);
				}
			} else if (this.isMachOBinary(filePath)) {
				this.validateCodesignSignature(filePath);
			}
		}
	}

	private isMachOBinary(filePath: string): boolean {
		try {
			const file = fs.openSync(filePath, 'r');
			const buffer = Buffer.alloc(4);
			fs.readSync(file, buffer, 0, 4, 0);
			fs.closeSync(file);
			const magic = buffer.readUInt32BE(0);
			return magic === 0xFEEDFACE || magic === 0xCEFAEDFE || magic === 0xFEEDFACF ||
				magic === 0xCFFAEDFE || magic === 0xCAFEBABE || magic === 0xBEBAFECA;
		} catch {
			return false;
		}
	}

	public async downloadAndUnpack(target: string): Promise<string> {
		const filePath = await this.downloadTarget(target);
		return this.unpackArchive(filePath);
	}

	public unpackArchive(archivePath: string): string {
		const dir = this.createTempDir();

		this.log(`Unpacking ${archivePath} to ${dir}`);
		this.runNoErrors('tar', '-xzf', archivePath, '-C', dir, '--no-same-permissions');
		this.log(`Unpacked ${archivePath} to ${dir}`);

		return dir;
	}

	public mountDmg(dmgPath: string): string {
		this.log(`Mounting DMG ${dmgPath}`);
		const result = this.runNoErrors('hdiutil', 'attach', dmgPath, '-nobrowse', '-readonly');

		const lines = result.stdout.trim().split('\n');
		const lastLine = lines[lines.length - 1];
		const mountPoint = lastLine.split('\t').pop()?.trim();

		if (!mountPoint || !fs.existsSync(mountPoint)) {
			this.error(`Failed to find mount point for DMG ${dmgPath}`);
		}

		this.log(`Mounted DMG at ${mountPoint}`);
		return mountPoint;
	}

	public unmountDmg(mountPoint: string): void {
		this.log(`Unmounting DMG ${mountPoint}`);
		this.runNoErrors('hdiutil', 'detach', mountPoint);
		this.log(`Unmounted DMG ${mountPoint}`);
	}

	public run(command: string, ...args: string[]): SpawnSyncReturns<string> {
		this.log(`Running command: ${command} ${args.join(' ')}`);
		return spawnSync(command, args, { encoding: 'utf-8' }) as SpawnSyncReturns<string>;
	}

	public runNoErrors(command: string, ...args: string[]): SpawnSyncReturns<string> {
		const result = this.run(command, ...args);
		if (result.error !== undefined) {
			this.error(`Failed to run command: ${result.error.message}`);
		}

		if (result.status !== 0) {
			this.error(`Command exited with code ${result.status}: ${result.stderr}`);
		}

		return result;
	}

	private runSudoNoErrors(command: string, ...args: string[]): SpawnSyncReturns<string> {
		if (this.isRootUser) {
			return this.runNoErrors(command, ...args);
		} else {
			return this.runNoErrors('sudo', command, ...args);
		}
	}

	private async runDpkgNoErrors(...args: string[]) {
		const command = this.isRootUser ? 'dpkg' : 'sudo';
		const commandArgs = this.isRootUser ? args : ['dpkg', ...args];
		const maxRetries = 5;
		let lastError: string | undefined;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			if (attempt > 0) {
				const delay = Math.pow(2, attempt - 1) * 1000;
				this.log(`Retrying dpkg command (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms`);
				await this.timeout(delay);
			}

			const result = this.run(command, ...commandArgs);
			if (result.error !== undefined) {
				lastError = `Failed to run command: ${result.error.message}`;
				break;
			}

			if (result.status === 0) {
				return;
			}

			lastError = `Command exited with code ${result.status}: ${result.stderr}`;
			const output = `${result.stdout}${result.stderr}`;
			if (!TestContext.dpkgLockError.test(output)) {
				break;
			}

			this.log(`dpkg lock is busy, waiting for the other package manager process to finish`);
		}

		this.error(lastError ?? `Command failed after ${maxRetries} attempts because the dpkg frontend lock remained busy`);
	}

	public killProcessTree(pid: number): void {
		this.log(`Killing process tree for PID: ${pid}`);
		if (os.platform() === 'win32') {
			spawnSync('taskkill', ['/T', '/F', '/PID', pid.toString()]);
		} else {
			process.kill(-pid, 'SIGKILL');
		}
		this.log(`Killed process tree for PID: ${pid}`);
	}

	private getWindowsInstallDir(type: 'user' | 'system'): string {
		let parentDir: string;
		if (type === 'system') {
			parentDir = process.env['ProgramW6432'] || process.env['PROGRAMFILES'] || '';
		} else {
			parentDir = path.join(process.env['LOCALAPPDATA'] || '', 'Programs');
		}

		switch (this.options.quality) {
			case 'stable':
				return path.join(parentDir, 'Microsoft VS Code');
			case 'insider':
				return path.join(parentDir, 'Microsoft VS Code Insiders');
			case 'exploration':
				return path.join(parentDir, 'Microsoft VS Code Exploration');
		}
	}

	public installWindowsApp(type: 'user' | 'system', installerPath: string): string {
		this.log(`Installing ${installerPath} in silent mode`);
		this.runNoErrors(installerPath, '/silent', '/mergetasks=!runcode');
		this.log(`Installed ${installerPath} successfully`);

		const appDir = this.getWindowsInstallDir(type);
		let entryPoint: string;
		switch (this.options.quality) {
			case 'stable':
				entryPoint = path.join(appDir, 'Code.exe');
				break;
			case 'insider':
				entryPoint = path.join(appDir, 'Code - Insiders.exe');
				break;
			case 'exploration':
				entryPoint = path.join(appDir, 'Code - Exploration.exe');
				break;
		}

		if (!fs.existsSync(entryPoint)) {
			this.error(`Desktop entry point does not exist: ${entryPoint}`);
		}

		this.log(`Installed VS Code executable at: ${entryPoint}`);
		return entryPoint;
	}

	public async uninstallWindowsApp(type: 'user' | 'system') {
		const appDir = this.getWindowsInstallDir(type);
		const uninstallerPath = path.join(appDir, 'unins000.exe');
		if (!fs.existsSync(uninstallerPath)) {
			this.error(`Uninstaller does not exist: ${uninstallerPath}`);
		}

		this.log(`Uninstalling VS Code from ${appDir} in silent mode`);
		this.runNoErrors(uninstallerPath, '/silent');
		this.log(`Uninstalled VS Code from ${appDir} successfully`);

		await this.timeout(2000);
		if (fs.existsSync(appDir)) {
			this.error(`Installation directory still exists after uninstall: ${appDir}`);
		}
	}

	public async installDeb(packagePath: string): Promise<string> {
		const name = this.getLinuxBinaryName();
		const entryPoint = path.join('/usr/share', name, name);
		if (fs.existsSync(entryPoint)) {
			this.error(`Cannot install ${packagePath}: ${name} is already installed at ${entryPoint}. This usually means a previous test run was terminated before cleanup completed; investigate the prior failure rather than silencing this error.`);
		}

		this.log(`Installing ${packagePath} using DEB package manager`);
		await this.runDpkgNoErrors('-i', packagePath);
		this.log(`Installed ${packagePath} successfully`);

		this.log(`Installed VS Code executable at: ${entryPoint}`);
		return entryPoint;
	}

	public async uninstallDeb() {
		const name = this.getLinuxBinaryName();
		const packagePath = path.join('/usr/share', name, name);

		if (!fs.existsSync(packagePath)) {
			this.log(`DEB package ${name} not installed, skipping uninstall`);
			return;
		}

		this.log(`Uninstalling DEB package ${packagePath}`);
		await this.runDpkgNoErrors('-r', name);
		this.log(`Uninstalled DEB package ${packagePath} successfully`);

		await this.timeout(1000);
		if (fs.existsSync(packagePath)) {
			this.error(`Package still exists after uninstall: ${packagePath}`);
		}
	}

	public installRpm(packagePath: string): string {
		const name = this.getLinuxBinaryName();
		const installedBinary = path.join('/usr/bin', name);
		if (fs.existsSync(installedBinary)) {
			this.error(`Cannot install ${packagePath}: ${name} is already installed at ${installedBinary}. This usually means a previous test run was terminated before cleanup completed; investigate the prior failure rather than silencing this error.`);
		}

		this.log(`Installing ${packagePath} using RPM package manager`);
		this.runSudoNoErrors('rpm', '-i', packagePath);
		this.log(`Installed ${packagePath} successfully`);

		const entryPoint = path.join('/usr/share', name, name);
		this.log(`Installed VS Code executable at: ${entryPoint}`);
		return entryPoint;
	}

	public async uninstallRpm() {
		const name = this.getLinuxBinaryName();
		const packagePath = path.join('/usr/bin', name);

		if (!fs.existsSync(packagePath)) {
			this.log(`RPM package ${name} not installed, skipping uninstall`);
			return;
		}

		this.log(`Uninstalling RPM package ${packagePath}`);
		this.runSudoNoErrors('rpm', '-e', name);
		this.log(`Uninstalled RPM package ${packagePath} successfully`);

		await this.timeout(1000);
		if (fs.existsSync(packagePath)) {
			this.error(`Package still exists after uninstall: ${packagePath}`);
		}
	}

	public installSnap(packagePath: string): string {
		const name = this.getLinuxBinaryName();
		const snapWrapper = path.join('/snap/bin', name);
		if (fs.existsSync(snapWrapper)) {
			this.error(`Cannot install ${packagePath}: ${name} is already installed at ${snapWrapper}. This usually means a previous test run was terminated before cleanup completed; investigate the prior failure rather than silencing this error.`);
		}

		this.log(`Installing ${packagePath} using Snap package manager`);
		this.runSudoNoErrors('snap', 'install', packagePath, '--classic', '--dangerous');
		this.log(`Installed ${packagePath} successfully`);

		const entryPoint = `/snap/${name}/current/usr/share/${name}/${name}`;
		this.log(`Installed VS Code executable at: ${entryPoint}`);
		return entryPoint;
	}

	public async uninstallSnap() {
		const name = this.getLinuxBinaryName();
		const packagePath = path.join('/snap/bin', name);

		if (!fs.existsSync(packagePath)) {
			this.log(`Snap package ${name} not installed, skipping uninstall`);
			return;
		}

		this.log(`Uninstalling Snap package ${packagePath}`);
		this.runSudoNoErrors('snap', 'remove', name);
		this.log(`Uninstalled Snap package ${packagePath} successfully`);

		await this.timeout(1000);
		if (fs.existsSync(packagePath)) {
			this.error(`Package still exists after uninstall: ${packagePath}`);
		}
	}

	private getLinuxBinaryName(): string {
		switch (this.options.quality) {
			case 'stable':
				return 'code';
			case 'insider':
				return 'code-insiders';
			case 'exploration':
				return 'code-exploration';
		}
	}

	public getDesktopEntryPoint(dir: string): string {
		let filePath: string = '';

		switch (os.platform()) {
			case 'darwin': {
				let appName: string;
				let binaryName: string;
				switch (this.options.quality) {
					case 'stable':
						appName = 'Visual Studio Code.app';
						binaryName = 'Code';
						break;
					case 'insider':
						appName = 'Visual Studio Code - Insiders.app';
						binaryName = 'Code - Insiders';
						break;
					case 'exploration':
						appName = 'Visual Studio Code - Exploration.app';
						binaryName = 'Code - Exploration';
						break;
				}
				filePath = path.join(dir, appName, 'Contents/MacOS', binaryName);
				break;
			}
			case 'linux': {
				let binaryName: string;
				switch (this.options.quality) {
					case 'stable':
						binaryName = `code`;
						break;
					case 'insider':
						binaryName = `code-insiders`;
						break;
					case 'exploration':
						binaryName = `code-exploration`;
						break;
				}
				filePath = path.join(dir, binaryName);
				break;
			}
			case 'win32': {
				let exeName: string;
				switch (this.options.quality) {
					case 'stable':
						exeName = 'Code.exe';
						break;
					case 'insider':
						exeName = 'Code - Insiders.exe';
						break;
					case 'exploration':
						exeName = 'Code - Exploration.exe';
						break;
				}
				filePath = path.join(dir, exeName);
				break;
			}
		}

		if (!filePath || !fs.existsSync(filePath)) {
			this.error(`Desktop entry point does not exist: ${filePath}`);
		}

		return filePath;
	}

	public getCliEntryPoint(dir: string): string {
		let filename: string;
		switch (this.options.quality) {
			case 'stable':
				filename = 'code';
				break;
			case 'insider':
				filename = 'code-insiders';
				break;
			case 'exploration':
				filename = 'code-exploration';
				break;
		}

		if (os.platform() === 'win32') {
			filename += '.exe';
		}

		const entryPoint = path.join(dir, filename);
		if (!fs.existsSync(entryPoint)) {
			this.error(`CLI entry point does not exist: ${entryPoint}`);
		}

		return entryPoint;
	}

	public getServerEntryPoint(dir: string, forWsl = false): string {
		let filename: string;
		switch (this.options.quality) {
			case 'stable':
				filename = 'code-server';
				break;
			case 'insider':
				filename = 'code-server-insiders';
				break;
			case 'exploration':
				filename = 'code-server-exploration';
				break;
		}

		if (os.platform() === 'win32' && !forWsl) {
			filename += '.cmd';
		}

		const entryPoint = path.join(this.getFirstSubdirectory(dir), 'bin', filename);
		if (!fs.existsSync(entryPoint)) {
			this.error(`Server entry point does not exist: ${entryPoint}`);
		}

		return entryPoint;
	}

	public getFirstSubdirectory(dir: string): string {
		const subDir = fs.readdirSync(dir, { withFileTypes: true }).filter(o => o.isDirectory()).at(0)?.name;
		if (!subDir) {
			this.error(`No subdirectories found in directory: ${dir}`);
		}
		return path.join(dir, subDir);
	}

	public createPortableDataDir(dir: string): string {
		const dataDir = path.join(dir, os.platform() === 'darwin' ? 'code-portable-data' : 'data');

		this.log(`Creating portable data directory: ${dataDir}`);
		fs.mkdirSync(dataDir, { recursive: true });
		this.log(`Created portable data directory: ${dataDir}`);

		return dataDir;
	}

	public async launchBrowser(): Promise<Browser> {
		this.log(`Launching web browser`);
		const headless = this.options.headlessBrowser;
		switch (os.platform()) {
			case 'darwin': {
				return await webkit.launch({ headless });
			}
			case 'win32': {
				const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
				this.log(`Using Chromium executable at: ${executablePath}`);
				return await chromium.launch({ headless, executablePath });
			}
			case 'linux':
			default: {
				const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ?? '/usr/bin/chromium-browser';
				this.log(`Using Chromium executable at: ${executablePath}`);
				return await chromium.launch({
					headless,
					executablePath,
					args: [
						'--disable-gpu',
						'--disable-gpu-compositing',
						'--disable-software-rasterizer',
						'--no-zygote',
					]
				});
			}
		}
	}

	public async getPage(pagePromise: Promise<Page>): Promise<Page> {
		const page = await pagePromise;
		page.setDefaultTimeout(3 * 60 * 1000);
		return page;
	}

	public async closeElectronApp(app: ElectronApplication, timeoutMs = 60_000): Promise<void> {
		this.log('Closing the application');
		const pid = app.process().pid;
		let timeoutHandle: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				app.close(),
				new Promise<never>((_, reject) => {
					timeoutHandle = setTimeout(
						() => reject(new Error(`app.close() did not complete within ${timeoutMs}ms`)),
						timeoutMs,
					);
				}),
			]);
		} catch (error) {
			this.warn(`Failed to close application gracefully: ${error instanceof Error ? error.message : String(error)}`);
			if (pid) {
				try {
					this.killProcessTree(pid);
				} catch (killError) {
					this.warn(`Failed to force-kill application process tree: ${killError instanceof Error ? killError.message : String(killError)}`);
				}
			}
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	public getCrashDumpsDir(): string | undefined {
		if (!this.options.crashDumpsDir || !this.currentTestName) {
			return undefined;
		}
		const sanitizedName = this.currentTestName.replace(/[^a-zA-Z0-9_-]/g, '_');
		return path.join(this.options.crashDumpsDir, sanitizedName);
	}

	public async captureScreenshot(page: Page) {
		if (!this.currentTestName) {
			return;
		}

		try {
			const screenshotDir = this.options.screenshotsDir ?? path.join(this.osTempDir, 'vscode-sanity-screenshots');
			fs.mkdirSync(screenshotDir, { recursive: true });
			const sanitizedName = this.currentTestName.replace(/[^a-zA-Z0-9_-]/g, '_');
			const screenshotPath = path.join(screenshotDir, `${sanitizedName}-${++this.screenshotCounter}.png`);
			await page.screenshot({ path: screenshotPath, fullPage: true });
			this.log(`Screenshot saved to: ${screenshotPath}`);
		} catch (e) {
			this.warn(`Failed to capture screenshot: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	public getWebServerUrl(port: string, token?: string, folder?: string): URL {
		const url = new URL(`http://localhost:${port}`);
		if (token) {
			url.searchParams.set('tkn', token);
		}
		if (folder) {
			folder = folder.replaceAll('\\', '/');
			if (!folder.startsWith('/')) {
				folder = `/${folder}`;
			}
			url.searchParams.set('folder', folder);
		}
		return url;
	}

	public getTunnelUrl(baseUrl: string, workspaceDir?: string): string {
		const url = new URL(baseUrl);
		url.searchParams.set('vscode-version', this.options.commit);
		if (workspaceDir) {
			let folder = workspaceDir.replaceAll('\\', '/');
			if (!folder.startsWith('/')) {
				folder = `/${folder}`;
			}
			url.pathname = url.pathname.replace(/\/+$/, '') + folder;
		}
		return url.toString();
	}

	public getRandomToken(): string {
		return Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
	}

	public getUniquePort(): string {
		return String(this.nextPort++);
	}

	public getWslServerExtensionsDir(): string {
		let serverDir: string;
		switch (this.options.quality) {
			case 'stable':
				serverDir = '.vscode-server';
				break;
			case 'insider':
				serverDir = '.vscode-server-insiders';
				break;
			case 'exploration':
				serverDir = '.vscode-server-exploration';
				break;
		}
		return `~/${serverDir}/extensions`;
	}

	public async runCliApp(name: string, command: string, args: string[], onLine: (text: string) => Promise<boolean | void | undefined>) {
		this.log(`Starting ${name} with command line: ${command} ${args.join(' ')}`);

		const app = spawn(command, args, {
			shell: /\.(sh|cmd)$/.test(command),
			detached: !this.capabilities.has('windows'),
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		try {
			await new Promise<void>((resolve, reject) => {
				app.stderr.on('data', (data) => {
					const text = `[${name}] ${data.toString().trim()}`;
					if (this.isNonFatalCliStderr(text)) {
						this.log(text);
					} else {
						reject(new Error(text));
					}
				});

				let terminated = false;
				app.stdout.on('data', (data) => {
					const text = data.toString().trim();
					if (/\berror\b/.test(text)) {
						reject(new Error(`[${name}] ${text}`));
					}

					for (const line of text.split('\n')) {
						this.log(`[${name}] ${line}`);
						onLine(line).then((result) => {
							if (terminated = !!result) {
								this.log(`Terminating ${name} process`);
								resolve();
							}
						}).catch(reject);
					}
				});

				app.on('error', reject);
				app.on('exit', (code) => {
					if (code === 0) {
						resolve();
					} else if (!terminated) {
						reject(new Error(`[${name}] Exited with code ${code}`));
					}
				});
			});
		} finally {
			this.killProcessTree(app.pid!);
		}
	}

	private isNonFatalCliStderr(text: string): boolean {
		return /ECONNRESET|ECONNABORTED|ECANCELED|EPIPE|SIGPIPE/.test(text)
			|| /(^|\n)(?:\[[^\]]+\]\s*)?(?:\(node:\d+\)\s*)?(?:\[[A-Z0-9]+\]\s*)?(?:[A-Za-z]+Warning|Warning):/.test(text);
	}
}
