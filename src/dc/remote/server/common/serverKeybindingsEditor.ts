import { Emitter, Event } from 'dc/core/common/event';

export interface IServerKeybinding {
	readonly key: string;
	readonly command: string;
	readonly when?: string;
	readonly source: 'default' | 'user' | 'extension';
}

export interface IServerKeybindingsEditorService {
	readonly onDidChangeKeybinding: Event<IServerKeybinding>;
	getKeybindings(): IServerKeybinding[];
	getKeybinding(command: string): IServerKeybinding | undefined;
	setKeybinding(command: string, key: string, when?: string): void;
	removeKeybinding(command: string): void;
	resetKeybinding(command: string): void;
	searchKeybindings(query: string): IServerKeybinding[];
	getDefaultKeybindings(): IServerKeybinding[];
	getUserKeybindings(): IServerKeybinding[];
	resolveKeybinding(key: string): string;
}

export class ServerKeybindingsEditorCommon implements IServerKeybindingsEditorService {
	private readonly _defaultKeybindings: IServerKeybinding[] = [];
	private readonly _userKeybindings = new Map<string, IServerKeybinding>();

	private readonly _onDidChangeKeybinding = new Emitter<IServerKeybinding>();
	readonly onDidChangeKeybinding: Event<IServerKeybinding> = this._onDidChangeKeybinding.event;

	getKeybindings(): IServerKeybinding[] {
		const result = new Map<string, IServerKeybinding>();
		for (const kb of this._defaultKeybindings) {
			result.set(kb.command, kb);
		}
		for (const [cmd, kb] of this._userKeybindings) {
			result.set(cmd, kb);
		}
		return Array.from(result.values());
	}

	getKeybinding(command: string): IServerKeybinding | undefined {
		return this._userKeybindings.get(command) || this._defaultKeybindings.find(k => k.command === command);
	}

	setKeybinding(command: string, key: string, when?: string): void {
		const kb: IServerKeybinding = { key, command, when, source: 'user' };
		this._userKeybindings.set(command, kb);
		this._onDidChangeKeybinding.fire(kb);
	}

	removeKeybinding(command: string): void {
		const kb = this._userKeybindings.get(command);
		this._userKeybindings.delete(command);
		if (kb) {
			this._onDidChangeKeybinding.fire(kb);
		}
	}

	resetKeybinding(command: string): void {
		this.removeKeybinding(command);
	}

	searchKeybindings(query: string): IServerKeybinding[] {
		const lower = query.toLowerCase();
		return this.getKeybindings().filter(kb =>
			kb.command.toLowerCase().includes(lower) || kb.key.toLowerCase().includes(lower)
		);
	}

	getDefaultKeybindings(): IServerKeybinding[] {
		return [...this._defaultKeybindings];
	}

	getUserKeybindings(): IServerKeybinding[] {
		return Array.from(this._userKeybindings.values());
	}

	resolveKeybinding(key: string): string {
		return key;
	}
}
