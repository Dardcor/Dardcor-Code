/**
 * Dardcor Code - Editor Line Number Error Background Highlight Markers
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { CssInjector } from '../../core/dom/css-injector';
import { URI } from '../../core/types/uri';
import { DiagnosticsModel, DiagnosticSeverity } from './diagnostics-model';

const DECORATIONS_STYLE_ID = 'dc-diagnostics-decorations-styles';

export interface IDecorationsChangeEvent {
	readonly resource: URI | undefined;
	readonly decoratedLineCount: number;
}

export class DiagnosticsDecorations extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<IDecorationsChangeEvent>());
	readonly onDidChange: Event<IDecorationsChangeEvent> = this._onDidChange.event;

	private readonly _model: DiagnosticsModel;

	constructor(model?: DiagnosticsModel) {
		super();
		this._model = model ?? new DiagnosticsModel();

		CssInjector.inject(DECORATIONS_STYLE_ID, `
			.dc-deco-error .dc-line-num { background-color: rgba(241, 76, 76, 0.35) !important; }
			.dc-deco-warning .dc-line-num { background-color: rgba(229, 229, 16, 0.25) !important; }
			.dc-deco-info .dc-line-num { background-color: rgba(55, 148, 255, 0.25) !important; }
			.dc-deco-error.dc-line { background-color: rgba(241, 76, 76, 0.08); }
			.dc-deco-warning.dc-line { background-color: rgba(229, 229, 16, 0.05); }
		`);

		this._register(this._model.onDidChange(() => {
			if (this._lastResource) {
				this.apply(this._lastResource);
			}
		}));
	}

	private _lastResource: URI | undefined;
	private _lastEditorDom: HTMLElement | undefined;

	get model(): DiagnosticsModel {
		return this._model;
	}

	public apply(resource: URI, editorDom?: HTMLElement): void {
		this._lastResource = resource;
		if (editorDom) {
			this._lastEditorDom = editorDom;
		}
		const dom = this._lastEditorDom;
		if (!dom) {
			return;
		}

		const diagnostics = this._model.getDiagnostics(resource);
		const severityByLine = new Map<number, DiagnosticSeverity>();
		for (const diagnostic of diagnostics) {
			const current = severityByLine.get(diagnostic.line);
			if (current === undefined || diagnostic.severity < current) {
				severityByLine.set(diagnostic.line, diagnostic.severity);
			}
		}

		let decorated = 0;
		const lineElements = dom.querySelectorAll('.dc-line');
		for (const element of Array.from(lineElements) as HTMLElement[]) {
			const numEl = element.querySelector('.dc-line-num');
			if (!numEl) {
				continue;
			}
			const lineNumber = parseInt(numEl.textContent ?? '', 10);
			const severity = severityByLine.get(lineNumber);

			element.classList.remove('dc-deco-error', 'dc-deco-warning', 'dc-deco-info');
			if (numEl instanceof HTMLElement) {
				numEl.style.backgroundColor = '';
			}
			if (severity === undefined) {
				continue;
			}
			decorated++;
			if (severity === DiagnosticSeverity.Error) {
				element.classList.add('dc-deco-error');
			} else if (severity === DiagnosticSeverity.Warning) {
				element.classList.add('dc-deco-warning');
			} else {
				element.classList.add('dc-deco-info');
			}
		}

		this._onDidChange.fire({ resource, decoratedLineCount: decorated });
	}

	public clear(): void {
		const dom = this._lastEditorDom;
		if (dom) {
			for (const element of Array.from(dom.querySelectorAll('.dc-line')) as HTMLElement[]) {
				element.classList.remove('dc-deco-error', 'dc-deco-warning', 'dc-deco-info');
			}
		}
		this._lastResource = undefined;
		this._onDidChange.fire({ resource: undefined, decoratedLineCount: 0 });
	}

	public static getSeverityClassName(severity: DiagnosticSeverity): string {
		if (severity === DiagnosticSeverity.Error) {
			return 'dc-deco-error';
		}
		if (severity === DiagnosticSeverity.Warning) {
			return 'dc-deco-warning';
		}
		return 'dc-deco-info';
	}
}
