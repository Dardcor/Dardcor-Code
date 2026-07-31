import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export interface KillSignalHandlers {
	onSigTerm?: () => void;
	onSigInt?: () => void;
	onSigBreak?: () => void;
	onExit?: () => void;
	onBeforeExit?: () => void;
	onUncaughtException?: (error: unknown) => void;
	onUnhandledRejection?: (reason: unknown) => void;
}

const SIGNALS: Array<NodeJS.Signals> = ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP'];

export class KillSignalHandler extends Disposable {
	private _cleanup: (() => void) | null = null;
	private _handled = false;
	private _signalHandlers = new Map<NodeJS.Signals, () => void>();

	constructor() {
		super();
	}

	public setCleanup(cleanup: () => void): void {
		this._cleanup = cleanup;
	}

	public register(): void {
		this._registerHandler('SIGTERM');
		this._registerHandler('SIGINT');
		this._registerHandler('SIGBREAK');
		this._registerHandler('SIGHUP');

		this._register(toDisposable(() => {
			for (const [signal, handler] of this._signalHandlers) {
				try {
					process.removeListener(signal, handler);
				} catch {
					// Ignore.
				}
			}
			this._signalHandlers.clear();
		}));
	}

	public gracefulKill(): void {
		if (this._handled) {
			return;
		}
		this._handled = true;
		this._cleanup?.();
		process.exit(0);
	}

	public isHandled(): boolean {
		return this._handled;
	}

	public override dispose(): void {
		this._signalHandlers.clear();
		super.dispose();
	}

	private _registerHandler(signal: NodeJS.Signals): void {
		const handler = (): void => {
			console.log(`[process-kill-signal] received ${signal}, shutting down gracefully`);
			this.gracefulKill();
		};
		this._signalHandlers.set(signal, handler);
		try {
			process.on(signal, handler);
		} catch {
			// Signal not supported.
		}
	}
}

export function registerKillSignalHandler(cleanup: () => void): () => void {
	const handler = new KillSignalHandler();
	handler.setCleanup(cleanup);
	handler.register();
	return () => handler.dispose();
}

export function gracefulKill(cleanup?: () => void): void {
	try {
		cleanup?.();
	} catch (err) {
		console.error('[process-kill-signal] cleanup failed:', err);
	}
	process.exit(0);
}

export function isSignalSupported(signal: string): boolean {
	return SIGNALS.includes(signal as NodeJS.Signals);
}

export function getSupportedSignals(): string[] {
	return [...SIGNALS];
}
