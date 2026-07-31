/**
 * Dardcor Code - Debug Execution Call Stack Tree View Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { DebugSession, IStackFrame, DebugState } from './debug-session';
import { Path } from '../../core/types/path';
import { escape } from '../../core/types/strings';

export class CallStackView extends Disposable {
	private readonly _onDidSelectFrame = this._register(new Emitter<IStackFrame>());
	readonly onDidSelectFrame: Event<IStackFrame> = this._onDidSelectFrame.event;

	private readonly _container: HTMLElement;
	private _selectedFrameId = -1;

	constructor(parentDom: HTMLElement, private readonly _session: DebugSession) {
		super();
		this._container = $<HTMLElement>('div', 'dc-call-stack-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
		parentDom.appendChild(this._container);

		this._register(this._session.onDidChangeState(() => this.render()));
		this._register(this._session.onDidUpdateThreads(() => this.render()));
		this._register(this._session.onDidStop(() => this.render()));
	}

	public render(): void {
		clearNode(this._container);

		const title = $<HTMLElement>('div', 'dc-call-stack-title');
		title.textContent = 'CALL STACK';
		title.style.cssText = 'text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:600;color:#bbbbbb;padding:8px 12px 4px;user-select:none;';
		this._container.appendChild(title);

		if (this._session.state !== DebugState.Stopped && this._session.state !== DebugState.Paused) {
			const empty = $('div', 'dc-call-stack-empty');
			empty.textContent = 'Session tidak ter-pause';
			empty.style.cssText = 'padding:4px 12px;color:#8a8a8a;font-size:12px;';
			this._container.appendChild(empty);
			return;
		}

		for (const thread of this._session.threads) {
			const threadRow = $<HTMLElement>('div', 'dc-call-stack-thread');
			threadRow.textContent = thread.id === this._session.stoppedThreadId ? `\u25A3 ${thread.name}` : thread.name;
			threadRow.style.cssText = 'padding:3px 12px;font-size:12px;color:#e5e5e5;font-weight:600;';
			this._container.appendChild(threadRow);
		}

		const frames = this._session.frames;
		if (frames.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada frame';
			empty.style.cssText = 'padding:4px 12px;color:#8a8a8a;font-size:12px;';
			this._container.appendChild(empty);
			return;
		}

		for (const frame of frames) {
			const row = $<HTMLElement>('div', 'dc-call-stack-frame');
			row.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:2px 12px;cursor:pointer;font-size:12px;user-select:none;color:#cccccc;';
			row.style.background = frame.id === this._selectedFrameId ? '#37373d' : 'transparent';
			row.addEventListener('mouseenter', () => {
				if (frame.id !== this._selectedFrameId) {
					row.style.background = '#2a2d2e';
				}
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = frame.id === this._selectedFrameId ? '#37373d' : 'transparent';
			});
			row.addEventListener('click', () => {
				this._selectedFrameId = frame.id;
				this._onDidSelectFrame.fire(frame);
				this.render();
			});

			const icon = $<HTMLElement>('span');
			icon.textContent = '\u229A';
			icon.style.cssText = 'color:#bbbbbb;font-size:11px;width:12px;';

			const name = $<HTMLElement>('span');
			name.textContent = frame.name;
			name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			const location = $<HTMLElement>('span');
			const sourceName = frame.sourceName ?? Path.basename(frame.sourcePath ?? '');
			location.textContent = `${escape(sourceName)}:${frame.line}`;
			location.style.cssText = 'color:#8a8a8a;font-size:11px;flex-shrink:0;';

			row.appendChild(icon);
			row.appendChild(name);
			row.appendChild(location);
			this._container.appendChild(row);
		}
	}

	public clearSelection(): void {
		this._selectedFrameId = -1;
	}
}
