import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface AuthenticationSession {
	readonly id: string;
	readonly accessToken: string;
	readonly scopes: readonly string[];
	readonly account: { id: string; label: string };
}

export interface IAuthenticationGetSessionOptions {
	createIfNone?: boolean;
	forceNewSession?: boolean | { detail: string };
	clearSessionPreference?: boolean;
}

export interface IAuthenticationProvider {
	getSession?(scopes: string[]): AuthenticationSession | Promise<AuthenticationSession | undefined>;
	getAccounts?(): Array<{ id: string; label: string }> | Promise<Array<{ id: string; label: string }>>;
}

export interface IAuthenticationProviderRegistration {
	readonly id: string;
	readonly label: string;
	readonly provider: IAuthenticationProvider;
}

export interface IAuthenticationSessionsChangeEvent {
	readonly providerId: string;
	readonly added: string[];
	readonly removed: string[];
	readonly changed: string[];
}

export class ExtHostAuthentication extends Disposable {
	private readonly _providers = new Map<string, IAuthenticationProviderRegistration>();
	private readonly _sessions = new Map<string, Map<string, AuthenticationSession>>();
	private readonly _sessionPreferences = new Map<string, string>();

	private readonly _onDidChangeSessions = this._register(new Emitter<IAuthenticationSessionsChangeEvent>());
	readonly onDidChangeSessions: Event<IAuthenticationSessionsChangeEvent> = this._onDidChangeSessions.event;

	public registerAuthenticationProvider(id: string, label: string, provider: IAuthenticationProvider): IDisposable {
		if (this._providers.has(id)) {
			throw new Error(`Provider autentikasi '${id}' sudah terdaftar`);
		}
		this._providers.set(id, { id, label, provider });
		this._sessions.set(id, new Map());
		return toDisposable(() => {
			this._providers.delete(id);
			this._sessions.delete(id);
		});
	}

	public async getSession(providerId: string, scopes: string[], options: IAuthenticationGetSessionOptions = {}): Promise<AuthenticationSession | undefined> {
		const registration = this._providers.get(providerId);
		if (!registration) {
			return undefined;
		}
		const sessions = this._sessions.get(providerId)!;
		const preferenceKey = scopes.slice().sort().join(' ');
		const preferredId = this._sessionPreferences.get(`${providerId}:${preferenceKey}`);
		const preferred = preferredId ? sessions.get(preferredId) : undefined;
		if (preferred && !options.forceNewSession) {
			return preferred;
		}
		const existing = [...sessions.values()].find(session => scopes.every(scope => session.scopes.includes(scope)));
		if (existing && !options.forceNewSession) {
			return existing;
		}
		if (!registration.provider.getSession) {
			return undefined;
		}
		const session = await registration.provider.getSession(scopes);
		if (session) {
			this._addSession(providerId, session);
			this._sessionPreferences.set(`${providerId}:${preferenceKey}`, session.id);
		}
		return session;
	}

	public getProviderIds(): string[] {
		return [...this._providers.keys()];
	}

	public getProvider(id: string): IAuthenticationProviderRegistration | undefined {
		return this._providers.get(id);
	}

	public getSessions(providerId: string): AuthenticationSession[] {
		return [...(this._sessions.get(providerId)?.values() ?? [])];
	}

	public async getAccounts(providerId: string): Promise<Array<{ id: string; label: string }>> {
		const registration = this._providers.get(providerId);
		if (!registration?.provider.getAccounts) {
			return [];
		}
		return registration.provider.getAccounts();
	}

	public addSession(providerId: string, session: AuthenticationSession): void {
		this._addSession(providerId, session);
	}

	public removeSession(providerId: string, sessionId: string): void {
		const sessions = this._sessions.get(providerId);
		if (!sessions?.delete(sessionId)) {
			return;
		}
		this._onDidChangeSessions.fire({ providerId, added: [], removed: [sessionId], changed: [] });
	}

	public override dispose(): void {
		this._providers.clear();
		this._sessions.clear();
		this._sessionPreferences.clear();
		super.dispose();
	}

	private _addSession(providerId: string, session: AuthenticationSession): void {
		const sessions = this._sessions.get(providerId);
		if (!sessions) {
			return;
		}
		const changed: string[] = [];
		const added: string[] = [];
		if (sessions.has(session.id)) {
			changed.push(session.id);
		} else {
			added.push(session.id);
		}
		sessions.set(session.id, session);
		if (added.length > 0 || changed.length > 0) {
			this._onDidChangeSessions.fire({ providerId, added, removed: [], changed });
		}
	}
}
