import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface ITerminalProfile {
	name: string;
	shellPath?: string;
	args?: string[];
	env?: Record<string, string | undefined>;
	overrideName?: boolean;
}

export interface ITerminalProfileProvider {
	provideTerminalProfile(): ITerminalProfile | Promise<ITerminalProfile | undefined>;
}

export interface IShellIntegration {
	readonly shell: string;
	readonly cwd: string | undefined;
	readonly env: Record<string, string | undefined>;
	readonly onDidChange: Event<IShellIntegration>;
}

export interface IShellIntegrationOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
}

export class ExtHostTerminalShell extends Disposable {
	private readonly _profileProviders = new Map<string, ITerminalProfileProvider>();
	private readonly _shellIntegrations = new Map<string, IShellIntegration>();
	private readonly _shells = new Set<string>();

	private readonly _onDidRegisterProfileProvider = this._register(new Emitter<string>());
	readonly onDidRegisterProfileProvider: Event<string> = this._onDidRegisterProfileProvider.event;

	public registerTerminalProfileProvider(id: string, provider: ITerminalProfileProvider): IDisposable {
		if (this._profileProviders.has(id)) {
			throw new Error(`Terminal profile provider '${id}' sudah terdaftar`);
		}
		this._profileProviders.set(id, provider);
		this._onDidRegisterProfileProvider.fire(id);
		return toDisposable(() => {
			this._profileProviders.delete(id);
		});
	}

	public async getTerminalProfile(id: string): Promise<ITerminalProfile | undefined> {
		const provider = this._profileProviders.get(id);
		if (!provider) {
			return undefined;
		}
		return provider.provideTerminalProfile();
	}

	public getTerminalProfileProviders(): string[] {
		return [...this._profileProviders.keys()];
	}

	public getShellIntegration(shell: string, options: IShellIntegrationOptions = {}): IShellIntegration {
		const existing = this._shellIntegrations.get(shell);
		if (existing) {
			return existing;
		}
		const integration: IShellIntegration = {
			shell,
			cwd: options.cwd ?? this._currentCwd(),
			env: options.env ?? this._currentEnv(),
			onDidChange: Event.None
		};
		this._shellIntegrations.set(shell, integration);
		this._shells.add(shell);
		return integration;
	}

	public hasShellIntegration(shell: string): boolean {
		return this._shellIntegrations.has(shell);
	}

	public getShells(): string[] {
		return [...this._shells];
	}

	public getShellIntegrations(): IShellIntegration[] {
		return [...this._shellIntegrations.values()];
	}

	public registerShell(shell: string): void {
		this._shells.add(shell);
	}

	public override dispose(): void {
		this._profileProviders.clear();
		this._shellIntegrations.clear();
		this._shells.clear();
		super.dispose();
	}

	private _currentCwd(): string | undefined {
		if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
			return process.cwd();
		}
		return undefined;
	}

	private _currentEnv(): Record<string, string | undefined> {
		if (typeof process !== 'undefined' && process.env) {
			return { ...process.env };
		}
		return {};
	}
}
