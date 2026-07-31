/**
 * Dardcor Code - Commit Message Text Area & Commit Button Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';
import { ScmRepository } from './scm-repository';

export class ScmCommitBox extends Disposable {
	private readonly _onDidCommit = this._register(new Emitter<string>());
	readonly onDidCommit: Event<string> = this._onDidCommit.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	private readonly _container: HTMLElement;
	private readonly _textarea: HTMLTextAreaElement;
	private readonly _commitButton: HTMLButtonElement;
	private readonly _stageAllCheckbox: HTMLInputElement;
	private readonly _statusLabel: HTMLElement;

	constructor(parentDom: HTMLElement, private readonly _repository: ScmRepository) {
		super();
		this._container = $<HTMLElement>('div', 'dc-scm-commit-box');
		this._container.style.cssText = 'padding:8px;border-bottom:1px solid #2a2d2e;display:flex;flex-direction:column;gap:6px;';

		this._textarea = $<HTMLTextAreaElement>('textarea', 'dc-scm-commit-input');
		this._textarea.rows = 3;
		this._textarea.placeholder = 'Pesan commit (Ctrl+Enter untuk commit)';
		this._textarea.style.cssText = 'background:#3c3c3c;border:1px solid #3c3c3c;border-radius:2px;color:#cccccc;font-size:13px;padding:6px;resize:none;outline:none;width:100%;box-sizing:border-box;font-family:inherit;';
		this._textarea.addEventListener('focus', () => {
			this._textarea.style.borderColor = '#007fd4';
		});
		this._textarea.addEventListener('blur', () => {
			this._textarea.style.borderColor = '#3c3c3c';
		});

		const actionsRow = $<HTMLElement>('div');
		actionsRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

		this._commitButton = $<HTMLButtonElement>('button', 'dc-scm-commit-button');
		this._commitButton.textContent = 'Commit';
		this._commitButton.style.cssText = 'background:#0e639c;border:none;color:#ffffff;border-radius:2px;padding:4px 12px;font-size:12px;cursor:pointer;';
		this._commitButton.disabled = true;
		this._commitButton.style.opacity = '0.5';

		this._stageAllCheckbox = $<HTMLInputElement>('input', 'dc-scm-stage-all');
		this._stageAllCheckbox.type = 'checkbox';
		this._stageAllCheckbox.checked = true;
		const stageAllLabel = $<HTMLLabelElement>('label');
		stageAllLabel.style.cssText = 'display:flex;align-items:center;gap:4px;color:#cccccc;font-size:12px;cursor:pointer;user-select:none;';
		stageAllLabel.appendChild(this._stageAllCheckbox);
		stageAllLabel.appendChild(document.createTextNode('Commit All'));

		this._statusLabel = $<HTMLElement>('div', 'dc-scm-commit-status');
		this._statusLabel.style.cssText = 'color:#8a8a8a;font-size:11px;min-height:14px;';

		actionsRow.appendChild(this._commitButton);
		actionsRow.appendChild(stageAllLabel);
		this._container.appendChild(this._textarea);
		this._container.appendChild(actionsRow);
		this._container.appendChild(this._statusLabel);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._commitButton, 'click', () => {
			this.commit();
		}));
		this._register(addDisposableListener(this._textarea, 'keydown', (e) => {
			const kd = e as KeyboardEvent;
			if (kd.key === 'Enter' && (kd.ctrlKey || kd.metaKey)) {
				e.preventDefault();
				this.commit();
			}
		}));
		this._register(this._repository.onDidChange(() => this._updateState()));
		this._updateState();
	}

	public get value(): string {
		return this._textarea.value;
	}

	public focus(): void {
		this._textarea.focus();
	}

	public async commit(): Promise<void> {
		const message = this._textarea.value.trim();
		if (!message) {
			this._statusLabel.textContent = 'Pesan commit tidak boleh kosong';
			this._statusLabel.style.color = '#f14c4c';
			return;
		}
		this._commitButton.disabled = true;
		this._statusLabel.textContent = 'Meng-commit\u2026';
		this._statusLabel.style.color = '#8a8a8a';
		try {
			const success = await this._repository.commit(message, this._stageAllCheckbox.checked);
			if (success) {
				this._textarea.value = '';
				this._statusLabel.textContent = 'Commit berhasil';
				this._statusLabel.style.color = '#23d18b';
				this._onDidCommit.fire(message);
			} else {
				this._statusLabel.textContent = 'Commit gagal (periksa konfigurasi user git)';
				this._statusLabel.style.color = '#f14c4c';
			}
		} catch (err) {
			this._statusLabel.textContent = String(err);
			this._statusLabel.style.color = '#f14c4c';
			this._onDidError.fire(String(err));
		} finally {
			this._updateState();
		}
	}

	private _updateState(): void {
		const canCommit = this._repository.hasChanges || this._stageAllCheckbox.checked;
		this._commitButton.disabled = !canCommit;
		this._commitButton.style.opacity = canCommit ? '1' : '0.5';
		if (this._statusLabel.textContent?.startsWith('Commit')) {
			return;
		}
		this._statusLabel.textContent = this._repository.hasChanges
			? `${this._repository.staged.length + this._repository.unstaged.length + this._repository.untracked.length} perubahan`
			: 'Tidak ada perubahan';
		this._statusLabel.style.color = '#8a8a8a';
	}
}
