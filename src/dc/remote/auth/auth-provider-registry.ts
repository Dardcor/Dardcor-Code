import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface AuthResult {
	readonly valid: boolean;
	readonly userId?: string;
	readonly scopes?: string[];
	readonly displayName?: string;
	readonly reason?: string;
}

export interface IAuthProvider {
	readonly id: string;
	readonly displayName?: string;
	authenticate(token?: string): Promise<AuthResult> | AuthResult;
	validate(token: string): Promise<AuthResult> | AuthResult;
	refresh?(token: string): Promise<string>;
	revoke?(token: string): Promise<void> | void;
}

export interface IAuthProviderRegistration {
	readonly provider: IAuthProvider;
	readonly priority: number;
}

export class AuthProviderRegistry extends Disposable {
	private readonly _providers = new Map<string, IAuthProviderRegistration>();
	private readonly _priorityOrder: string[] = [];

	private readonly _onDidRegister = this._register(new Emitter<IAuthProvider>());
	readonly onDidRegister: Event<IAuthProvider> = this._onDidRegister.event;

	private readonly _onDidUnregister = this._register(new Emitter<string>());
	readonly onDidUnregister: Event<string> = this._onDidUnregister.event;

	private readonly _onDidAuthenticate = this._register(new Emitter<{ provider: string; result: AuthResult }>());
	readonly onDidAuthenticate: Event<{ provider: string; result: AuthResult }> = this._onDidAuthenticate.event;

	register(provider: IAuthProvider, priority = 0): Disposable {
		if (!provider || typeof provider.id !== 'string' || !provider.id) {
			throw new Error('Auth provider must have a non-empty id');
		}
		if (this._providers.has(provider.id)) {
			throw new Error(`Auth provider '${provider.id}' is already registered`);
		}
		this._providers.set(provider.id, { provider, priority });
		this._priorityOrder.push(provider.id);
		this._priorityOrder.sort((a, b) => {
			const pa = this._providers.get(a)?.priority ?? 0;
			const pb = this._providers.get(b)?.priority ?? 0;
			return pb - pa;
		});
		this._onDidRegister.fire(provider);
		return toDisposable(() => this.unregister(provider.id)) as any;
	}

	unregister(id: string): boolean {
		if (!this._providers.delete(id)) {
			return false;
		}
		const index = this._priorityOrder.indexOf(id);
		if (index !== -1) {
			this._priorityOrder.splice(index, 1);
		}
		this._onDidUnregister.fire(id);
		return true;
	}

	get(id: string): IAuthProvider | undefined {
		return this._providers.get(id)?.provider;
	}

	has(id: string): boolean {
		return this._providers.has(id);
	}

	list(): IAuthProvider[] {
		return this._priorityOrder.map(id => this._providers.get(id)!.provider);
	}

	get count(): number {
		return this._providers.size;
	}

	async authenticate(token?: string): Promise<AuthResult> {
		const providers = this.list();
		if (providers.length === 0) {
			return { valid: false, reason: 'no authentication providers registered' };
		}
		for (const provider of providers) {
			try {
				const result = await Promise.resolve(provider.authenticate(token));
				this._onDidAuthenticate.fire({ provider: provider.id, result });
				if (result.valid) {
					return result;
				}
				if (result.valid === false && result.reason === 'credentials-required') {
					return result;
				}
			} catch (error) {
				this._onDidAuthenticate.fire({
					provider: provider.id,
					result: { valid: false, reason: error instanceof Error ? error.message : String(error) }
				});
			}
		}
		return { valid: false, reason: 'authentication failed for all providers' };
	}

	async validate(token: string): Promise<AuthResult> {
		const providers = this.list();
		if (providers.length === 0) {
			return { valid: false, reason: 'no authentication providers registered' };
		}
		let lastReason = 'no provider accepted the token';
		for (const provider of providers) {
			try {
				const result = await Promise.resolve(provider.validate(token));
				if (result.valid) {
					return result;
				}
				if (result.reason) {
					lastReason = result.reason;
				}
			} catch (error) {
				lastReason = error instanceof Error ? error.message : String(error);
			}
		}
		return { valid: false, reason: lastReason };
	}

	async refresh(token: string): Promise<string> {
		const providers = this.list();
		for (const provider of providers) {
			if (!provider.refresh) {
				continue;
			}
			try {
				return await Promise.resolve(provider.refresh(token));
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				if (reason !== 'invalid-token') {
					throw error;
				}
			}
		}
		throw new Error('No provider could refresh the token');
	}

	async revoke(token: string): Promise<void> {
		const providers = this.list();
		for (const provider of providers) {
			if (!provider.revoke) {
				continue;
			}
			try {
				await Promise.resolve(provider.revoke(token));
			} catch {
				continue;
			}
		}
	}

	override dispose(): void {
		this._providers.clear();
		this._priorityOrder.length = 0;
		super.dispose();
	}
}
