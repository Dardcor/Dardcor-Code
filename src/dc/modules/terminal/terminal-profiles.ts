/**
 * Dardcor Code - Terminal Shell Profile Detection & Launcher
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { isWindows } from '../../core/environment/platform';
import { Path } from '../../core/types/path';
import * as fs from 'node:fs';
import * as os from 'node:os';

export interface ITerminalProfile {
	readonly id: string;
	readonly name: string;
	readonly command: string;
	readonly args: string[];
	readonly isDefault?: boolean;
	readonly color?: string;
}

export class TerminalProfiles extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _profiles: ITerminalProfile[] = [];
	private _defaultId: string | undefined;

	constructor() {
		super();
		this._profiles = TerminalProfiles.detectProfiles();
		this._defaultId = this._profiles.find(p => p.isDefault)?.id ?? this._profiles[0]?.id;
	}

	get profiles(): ITerminalProfile[] {
		return [...this._profiles];
	}

	get defaultProfile(): ITerminalProfile | undefined {
		return this._profiles.find(p => p.id === this._defaultId) ?? this._profiles[0];
	}

	public setDefault(id: string): void {
		this._defaultId = id;
		this._onDidChange.fire();
	}

	public getProfile(id: string): ITerminalProfile | undefined {
		return this._profiles.find(p => p.id === id);
	}

	public static detectProfiles(): ITerminalProfile[] {
		const profiles: ITerminalProfile[] = [];
		if (isWindows) {
			const windir = process.env.WINDIR ?? 'C:\\Windows';
			const powershell = Path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
			const pwsh = Path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
			const cmd = Path.join(windir, 'System32', 'cmd.exe');
			const wsl = Path.join(windir, 'System32', 'wsl.exe');
			profiles.push({ id: 'pwsh', name: 'PowerShell 7', command: pwsh, args: [], isDefault: fs.existsSync(pwsh) });
			profiles.push({ id: 'powershell', name: 'Windows PowerShell', command: powershell, args: [], isDefault: !fs.existsSync(pwsh), color: '#4ec9b0' });
			profiles.push({ id: 'cmd', name: 'Command Prompt', command: cmd, args: [], color: '#dcdcaa' });
			if (fs.existsSync(wsl)) {
				profiles.push({ id: 'wsl', name: 'WSL', command: wsl, args: ['~'], color: '#9cdcfe' });
			}
		} else {
			const shell = process.env.SHELL ?? '/bin/bash';
			profiles.push({ id: 'shell', name: 'Default Shell', command: shell, args: [], isDefault: true });
			if (shell.endsWith('zsh')) {
				profiles.push({ id: 'bash', name: 'Bash', command: '/bin/bash', args: [], color: '#dcdcaa' });
			} else if (shell.endsWith('fish')) {
				profiles.push({ id: 'bash', name: 'Bash', command: '/bin/bash', args: [], color: '#dcdcaa' });
			}
		}
		if (profiles.length === 0) {
			profiles.push({ id: 'default', name: 'Default', command: isWindows ? 'cmd' : '/bin/sh', args: [], isDefault: true });
		}
		const hasDefault = profiles.some(p => p.isDefault);
		if (!hasDefault && profiles[0]) {
			profiles[0] = { ...profiles[0], isDefault: true };
		}
		return profiles;
	}

	public static getHomeDirectory(): string {
		return os.homedir();
	}
}
