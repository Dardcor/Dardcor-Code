/**
 * Dardcor Code - Native Secondary Window Shell Frame
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface IAuxiliaryWindowOptions {
	readonly title: string;
	readonly width: number;
	readonly height: number;
	readonly left?: number;
	readonly top?: number;
	readonly icon?: string;
}

export class AuxiliaryWindowElement extends Disposable {
	private _windowRef: Window | null = null;
	private _document: Document | null = null;
	private _container: HTMLElement | null = null;
	private readonly _id: string;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(private readonly _options: IAuxiliaryWindowOptions) {
		super();
		this._id = `dc-aux-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	get id(): string {
		return this._id;
	}

	get windowRef(): Window | null {
		return this._windowRef;
	}

	get documentRef(): Document | null {
		return this._document;
	}

	get container(): HTMLElement | null {
		return this._container;
	}

	open(): void {
		if (this._windowRef) {
			this._windowRef.focus();
			return;
		}
		const features = [
			`width=${this._options.width}`,
			`height=${this._options.height}`,
			`left=${this._options.left ?? 100}`,
			`top=${this._options.top ?? 100}`,
			'menubar=no',
			'toolbar=no',
			'location=no',
			'status=no',
			'resizable=yes',
			'nodeIntegration=no',
		].join(',');
		const win = window.open('', this._id, features);
		if (!win || !win.document) {
			return;
		}
		this._windowRef = win;
		this._document = win.document;
		this._writeShell();
		this._windowRef.addEventListener('beforeunload', () => {
			this._onDidClose.fire();
		});
	}

	close(): void {
		if (this._windowRef && !this._windowRef.closed) {
			this._windowRef.close();
		}
		this._windowRef = null;
		this._document = null;
		this._container = null;
		this._onDidClose.fire();
	}

	focus(): void {
		this._windowRef?.focus();
	}

	postMessage(message: unknown): void {
		this._windowRef?.postMessage(message, '*');
	}

	private _writeShell(): void {
		const doc = this._document!;
		doc.open();
		doc.write(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${this._escapeHtml(this._options.title)}</title>
<style>
	html, body { margin:0; padding:0; height:100%; overflow:hidden; background:#1e1e1e; color:#cccccc; font-family:'Segoe UI', sans-serif; font-size:13px; }
	#dc-aux-shell { display:flex; flex-direction:column; height:100vh; }
	#dc-aux-titlebar { height:30px; background:#323233; display:flex; align-items:center; padding:0 10px; font-size:12px; color:#cccccc; user-select:none; border-bottom:1px solid #2b2b2b; -webkit-app-region: drag; }
	#dc-aux-title { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	#dc-aux-controls { display:flex; gap:6px; -webkit-app-region: no-drag; }
	#dc-aux-controls span { cursor:pointer; padding:2px 6px; border-radius:3px; font-size:10px; }
	#dc-aux-controls span:hover { background:#4a4a4a; }
	#dc-aux-close:hover { background:#e81123 !important; color:#ffffff; }
	#dc-aux-body { flex:1; position:relative; background:#1e1e1e; overflow:hidden; }
	#dc-aux-statusbar { height:22px; background:#007acc; color:#ffffff; display:flex; align-items:center; padding:0 10px; font-size:12px; user-select:none; }
</style>
</head>
<body>
<div id="dc-aux-shell">
	<div id="dc-aux-titlebar">
		<span id="dc-aux-title">${this._escapeHtml(this._options.title)}</span>
		<div id="dc-aux-controls">
			<span id="dc-aux-minimize" title="Minimize">\u2013</span>
			<span id="dc-aux-maximize" title="Maximize">\u25a1</span>
			<span id="dc-aux-close" title="Close">\u2715</span>
		</div>
	</div>
	<div id="dc-aux-body"></div>
	<div id="dc-aux-statusbar">Dardcor Code</div>
</div>
</body>
</html>`);
		doc.close();

		this._container = doc.getElementById('dc-aux-body');
		doc.getElementById('dc-aux-close')?.addEventListener('click', () => this.close());
		doc.getElementById('dc-aux-minimize')?.addEventListener('click', () => {
			const win = this._windowRef as unknown as { minimize?: () => void };
			win.minimize?.();
		});
		doc.getElementById('dc-aux-maximize')?.addEventListener('click', () => {
			if (this._windowRef) {
				if (this._windowRef.innerWidth >= window.screen.width - 20) {
					this._windowRef.resizeTo(this._options.width, this._options.height);
				} else {
					this._windowRef.resizeTo(window.screen.width, window.screen.height);
				}
			}
		});
	}

	setTitle(title: string): void {
		if (!this._document) {
			return;
		}
		this._document.title = title;
		const el = this._document.getElementById('dc-aux-title');
		if (el) {
			el.textContent = title;
		}
	}

	private _escapeHtml(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	dispose(): void {
		this.close();
		super.dispose();
	}
}
