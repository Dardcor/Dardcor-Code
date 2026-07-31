/**
 * Dardcor Code - Environment Service Paths Provider (Task 121)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { URI } from '../../core/types/uri.js';
import { createDecorator } from '../instantiation/annotations.js';
import { isWindows, isMacintosh, isLinux } from '../../core/environment/platform.js';

export interface IEnvironmentService {
	readonly _serviceBrand: undefined;
	readonly appName: string;
	readonly userHome: string;
	readonly userDataPath: string;
	readonly userDataUri: URI;
	readonly settingsFile: string;
	readonly settingsUri: URI;
	readonly keybindingsFile: string;
	readonly extensionsPath: string;
	readonly cachePath: string;
	readonly logsPath: string;
	readonly workspaceStoragePath: string;
	readonly crashReportsPath: string;
	readonly tmpPath: string;
	readonly cliArgs: readonly string[];
	getArgValue(argName: string): string | undefined;
	hasArg(argName: string): boolean;
}

export const IEnvironmentService = createDecorator<IEnvironmentService>('environmentService');

const DEFAULT_APP_NAME = 'Dardcor Code';

export class EnvironmentService implements IEnvironmentService {
	declare readonly _serviceBrand: undefined;

	readonly appName: string;
	readonly userHome: string;
	readonly userDataPath: string;
	readonly userDataUri: URI;
	readonly settingsFile: string;
	readonly settingsUri: URI;
	readonly keybindingsFile: string;
	readonly extensionsPath: string;
	readonly cachePath: string;
	readonly logsPath: string;
	readonly workspaceStoragePath: string;
	readonly crashReportsPath: string;
	readonly tmpPath: string;
	readonly cliArgs: readonly string[];

	constructor(cliArgs?: readonly string[]) {
		this.cliArgs = cliArgs && cliArgs.length > 0 ? cliArgs : this._defaultArgs();
		this.appName = DEFAULT_APP_NAME;
		this.userHome = homedir();
		this.userDataPath = this._resolveUserDataPath();
		this.userDataUri = URI.file(this.userDataPath);
		this.settingsFile = join(this.userDataPath, 'settings.json');
		this.settingsUri = URI.file(this.settingsFile);
		this.keybindingsFile = join(this.userDataPath, 'keybindings.json');
		this.extensionsPath = this._resolveArgValue('--extensions-dir') ?? join(this.userDataPath, 'extensions');
		this.cachePath = join(this.userDataPath, 'cache');
		this.logsPath = join(this.userDataPath, 'logs');
		this.workspaceStoragePath = join(this.userDataPath, 'workspaceStorage');
		this.crashReportsPath = join(this.userDataPath, 'crash-reports');
		this.tmpPath = join(this.userHome, this._defaultDataDirName(), 'tmp');
	}

	public getArgValue(argName: string): string | undefined {
		return this._resolveArgValue(argName);
	}

	public hasArg(argName: string): boolean {
		return this.cliArgs.some((a) => a === argName || a.startsWith(`${argName}=`) || a.startsWith(`${argName}:`));
	}

	private _resolveArgValue(argName: string): string | undefined {
		for (const arg of this.cliArgs) {
			if (arg.startsWith(`${argName}=`)) {
				return arg.substring(argName.length + 1);
			}
			if (arg.startsWith(`${argName}:`)) {
				return arg.substring(argName.length + 1);
			}
		}
		return undefined;
	}

	private _resolveUserDataPath(): string {
		const fromArg = this._resolveArgValue('--user-data-dir');
		if (fromArg) {
			return fromArg;
		}
		const env = this._env();
		if (isWindows) {
			return env['APPDATA'] ? join(env['APPDATA'], this._defaultDataDirName()) : join(this.userHome, this._defaultDataDirName());
		}
		if (isMacintosh) {
			return join(this.userHome, 'Library', 'Application Support', this._defaultDataDirName());
		}
		if (isLinux) {
			const xdg = env['XDG_CONFIG_HOME'] || join(this.userHome, '.config');
			return join(xdg, this._defaultDataDirName());
		}
		return join(this.userHome, this._defaultDataDirName());
	}

	private _defaultDataDirName(): string {
		return 'DardcorCode';
	}

	private _defaultArgs(): string[] {
		return typeof process !== 'undefined' ? process.argv.slice(2) : [];
	}

	private _env(): NodeJS.ProcessEnv {
		return typeof process !== 'undefined' && process.env ? process.env : {};
	}
}
