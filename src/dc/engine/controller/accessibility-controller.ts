import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';

export class AccessibilityController extends Disposable {
	private _liveRegion: HTMLElement | null = null;
	private _screenReaderMode = false;
	private readonly _announcements: string[] = [];
	private _announceSequence = 0;

	private readonly _onDidChangeScreenReaderMode = this._register(new Emitter<boolean>());
	readonly onDidChangeScreenReaderMode: Event<boolean> = this._onDidChangeScreenReaderMode.event;

	public announce(text: string): void {
		if (!text) {
			return;
		}
		this._ensureLiveRegion();
		if (this._liveRegion) {
			this._announceSequence++;
			const key = `dc-live-${this._announceSequence}`;
			this._liveRegion.textContent = '';
			const container = document.createElement('span');
			container.id = key;
			container.textContent = text;
			this._liveRegion.appendChild(container);
			const cleanup = (): void => {
				const existing = document.getElementById(key);
				if (existing) {
					existing.remove();
				}
			};
			window.setTimeout(cleanup, 3000);
		}
		this._announcements.push(text);
		if (this._announcements.length > 200) {
			this._announcements.splice(0, this._announcements.length - 200);
		}
	}

	public getAnnouncements(): string[] {
		return this._announcements.slice();
	}

	public getLastAnnouncement(): string | undefined {
		return this._announcements.length > 0 ? this._announcements[this._announcements.length - 1] : undefined;
	}

	public setScreenReaderMode(mode: boolean): void {
		if (this._screenReaderMode === mode) {
			return;
		}
		this._screenReaderMode = mode;
		this._ensureLiveRegion();
		if (this._liveRegion) {
			this._liveRegion.setAttribute('aria-live', mode ? 'assertive' : 'polite');
		}
		this._onDidChangeScreenReaderMode.fire(mode);
	}

	public getScreenReaderMode(): boolean {
		return this._screenReaderMode;
	}

	public toggleScreenReaderMode(): boolean {
		this.setScreenReaderMode(!this._screenReaderMode);
		return this._screenReaderMode;
	}

	public alert(message: string): void {
		this._ensureAlertRegion();
		if (this._alertRegion) {
			this._alertRegion.textContent = message;
		}
	}

	public getLiveRegion(): HTMLElement | null {
		return this._liveRegion;
	}

	override dispose(): void {
		this._liveRegion?.remove();
		this._liveRegion = null;
		this._alertRegion?.remove();
		this._alertRegion = null;
		super.dispose();
	}

	private _alertRegion: HTMLElement | null = null;

	private _ensureLiveRegion(): void {
		if (this._liveRegion) {
			return;
		}
		const el = $<HTMLElement>('div', 'dc-screen-reader-live');
		el.setAttribute('role', 'status');
		el.setAttribute('aria-live', 'polite');
		el.setAttribute('aria-atomic', 'true');
		el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap;user-select:none;pointer-events:none;';
		document.body.appendChild(el);
		this._liveRegion = el;
	}

	private _ensureAlertRegion(): void {
		if (this._alertRegion) {
			return;
		}
		const el = $<HTMLElement>('div', 'dc-screen-reader-alert');
		el.setAttribute('role', 'alert');
		el.setAttribute('aria-live', 'assertive');
		el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap;';
		document.body.appendChild(el);
		this._alertRegion = el;
	}
}
