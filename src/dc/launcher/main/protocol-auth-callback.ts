import { app } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter } from '../../core/events/emitter';

export interface AuthCodePayload {
	code: string;
	state?: string;
	raw: string;
}

export class AuthCallbackServer extends Disposable {
	private _started = false;
	private readonly _scheme: string;
	private readonly _onDidReceiveCode = new Emitter<AuthCodePayload>();
	public readonly onDidReceiveCode = this._onDidReceiveCode.event;

	constructor(scheme: string = 'dardcor') {
		super();
		this._scheme = scheme;
		this._register(this._onDidReceiveCode);
		this._register(toDisposable(() => this.stop()));
	}

	public start(): boolean {
		if (this._started) {
			return true;
		}
		try {
			const registered = app.setAsDefaultProtocolClient(this._scheme);
			this._started = registered;
			if (registered) {
				app.on('open-url', this._handleOpenUrl);
				app.on('second-instance', this._handleSecondInstance);
			}
			return registered;
		} catch (err) {
			console.warn('[protocol-auth-callback] failed to start:', err);
			return false;
		}
	}

	public stop(): void {
		if (!this._started) {
			return;
		}
		app.removeListener('open-url', this._handleOpenUrl);
		app.removeListener('second-instance', this._handleSecondInstance);
		this._started = false;
	}

	public isStarted(): boolean {
		return this._started;
	}

	public validateState(state: string | undefined, expected: string | undefined): boolean {
		if (!expected) {
			return true;
		}
		if (!state) {
			return false;
		}
		if (typeof Buffer !== 'undefined') {
			const a = Buffer.from(state);
			const b = Buffer.from(expected);
			if (a.length !== b.length) {
				return false;
			}
			let diff = 0;
			for (let i = 0; i < a.length; i++) {
				diff |= a[i] ^ b[i];
			}
			return diff === 0;
		}
		return state === expected;
	}

	public parseAuthUrl(url: string): AuthCodePayload | null {
		try {
			const parsed = new URL(url);
			if (parsed.hostname !== 'auth') {
				return null;
			}
			const code = parsed.searchParams.get('code');
			if (!code) {
				return null;
			}
			return {
				code,
				state: parsed.searchParams.get('state') ?? undefined,
				raw: url
			};
		} catch {
			return null;
		}
	}

	public handleAuthUrl(url: string): boolean {
		const payload = this.parseAuthUrl(url);
		if (!payload) {
			return false;
		}
		this._onDidReceiveCode.fire(payload);
		return true;
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private readonly _handleOpenUrl = (event: Electron.Event, url: string): void => {
		event.preventDefault();
		this.handleAuthUrl(url);
	};

	private readonly _handleSecondInstance = (_event: Electron.Event, argv: string[]): void => {
		for (const arg of argv) {
			if (arg.startsWith(`${this._scheme}://`)) {
				this.handleAuthUrl(arg);
			}
		}
	};
}

export function createAuthCallbackServer(scheme?: string): AuthCallbackServer {
	return new AuthCallbackServer(scheme);
}

export function registerProtocolAuthHandler(scheme: string): AuthCallbackServer {
	const server = new AuthCallbackServer(scheme);
	server.start();
	return server;
}
