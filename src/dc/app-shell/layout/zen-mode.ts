/**
 * Dardcor Code - Distraction-Free Full Screen Zen Mode Controller
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';
import { IStorageService, StorageScope, StorageTarget } from '../../services/storage/storage-service.js';

export interface IZenModeTargets {
	readonly container: HTMLElement;
	readonly titlebar?: HTMLElement;
	readonly menubar?: HTMLElement;
	readonly activitybar?: HTMLElement;
	readonly sidebar?: HTMLElement;
	readonly panel?: HTMLElement;
	readonly statusbar?: HTMLElement;
	readonly editorContainer?: HTMLElement;
}

export interface IZenModeOptions {
	readonly persistState?: boolean;
	readonly exitOnEscape?: boolean;
	readonly hideLineNumbers?: boolean;
	readonly centered?: boolean;
}

const ZEN_STORAGE_KEY = 'dc.zenMode';

interface IElementStyleBackup {
	readonly element: HTMLElement;
	readonly display: string;
	readonly margin: string;
	readonly maxWidth: string;
}

export class ZenMode extends Disposable {
	private readonly _targets: IZenModeTargets;
	private readonly _options: IZenModeOptions;
	private readonly _backups: IElementStyleBackup[] = [];
	private _isActive = false;
	private _escDisposable: { dispose(): void } | null = null;

	private readonly _onDidChangeState = this._register(new Emitter<boolean>());
	readonly onDidChangeState: Event<boolean> = this._onDidChangeState.event;

	constructor(
		targets: IZenModeTargets,
		options: IZenModeOptions = {},
		private readonly _storage: IStorageService | null = null
	) {
		super();
		this._targets = targets;
		this._options = options;

		if (options.persistState && this._storage) {
			const stored = this._storage.getBoolean(ZEN_STORAGE_KEY, StorageScope.WORKSPACE, false);
			if (stored) {
				this.enter();
			}
		}
	}

	get isActive(): boolean {
		return this._isActive;
	}

	enter(): void {
		if (this._isActive) {
			return;
		}
		this._isActive = true;
		this._targets.container.classList.add('dc-zen-mode');
		this._backupAndHide(this._targets.titlebar);
		this._backupAndHide(this._targets.menubar);
		this._backupAndHide(this._targets.activitybar);
		this._backupAndHide(this._targets.sidebar);
		this._backupAndHide(this._targets.panel);
		this._backupAndHide(this._targets.statusbar);

		if (this._options.centered !== false && this._targets.editorContainer) {
			const editor = this._targets.editorContainer;
			const backup: IElementStyleBackup = {
				element: editor,
				display: editor.style.display,
				margin: editor.style.margin,
				maxWidth: editor.style.maxWidth,
			};
			this._backups.push(backup);
			editor.style.margin = '0 auto';
			editor.style.maxWidth = '60%';
		}

		if (this._options.exitOnEscape !== false) {
			const onKeyDown = (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					this.exit();
				}
			};
			document.addEventListener('keydown', onKeyDown);
			this._escDisposable = { dispose: () => document.removeEventListener('keydown', onKeyDown) };
		}

		if (this._options.persistState && this._storage) {
			this._storage.store(ZEN_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		this._onDidChangeState.fire(true);
	}

	exit(): void {
		if (!this._isActive) {
			return;
		}
		this._isActive = false;
		this._targets.container.classList.remove('dc-zen-mode');
		for (const backup of this._backups) {
			backup.element.style.display = backup.display;
			backup.element.style.margin = backup.margin;
			backup.element.style.maxWidth = backup.maxWidth;
		}
		this._backups.length = 0;
		this._escDisposable?.dispose();
		this._escDisposable = null;

		if (this._options.persistState && this._storage) {
			this._storage.store(ZEN_STORAGE_KEY, false, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		this._onDidChangeState.fire(false);
	}

	toggle(): void {
		if (this._isActive) {
			this.exit();
		} else {
			this.enter();
		}
	}

	enterFullScreen(): void {
		const docEl = document.documentElement;
		if (docEl.requestFullscreen) {
			void docEl.requestFullscreen().catch(() => undefined);
		}
	}

	exitFullScreen(): void {
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => undefined);
		}
	}

	isFullScreen(): boolean {
		return document.fullscreenElement !== null;
	}

	private _backupAndHide(element: HTMLElement | undefined): void {
		if (!element) {
			return;
		}
		this._backups.push({ element, display: element.style.display, margin: element.style.margin, maxWidth: element.style.maxWidth });
		element.style.display = 'none';
	}

	dispose(): void {
		if (this._isActive) {
			this.exit();
		}
		super.dispose();
	}
}

export function createZenModeOverlay(targets: IZenModeTargets): HTMLElement {
	const overlay = $<HTMLElement>('div', 'dc-zen-mode-overlay');
	overlay.textContent = 'Zen Mode - Press Esc to exit';
	overlay.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:#cccccc;font-size:11px;padding:4px 12px;border-radius:12px;pointer-events:none;z-index:3000;font-family:Segoe UI, sans-serif;';
	document.body.appendChild(overlay);
	return overlay;
}
