/**
 * Dardcor Code - Diagnostics / Problems Panel Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';
import { DiagnosticsModel, IDiagnostic, IFileDiagnostics, DiagnosticSeverity } from './diagnostics-model';
import { DiagnosticsFilter } from './diagnostics-filter';

const PROBLEMS_STYLE_ID = 'dc-problems-view-styles';

export interface IProblemSelection {
	readonly resource: URI;
	readonly diagnostic: IDiagnostic;
}

export class ProblemsView extends Disposable {
	private readonly _onDidSelectDiagnostic = this._register(new Emitter<IProblemSelection>());
	readonly onDidSelectDiagnostic: Event<IProblemSelection> = this._onDidSelectDiagnostic.event;

	private readonly _onDidFocusResource = this._register(new Emitter<URI>());
	readonly onDidFocusResource: Event<URI> = this._onDidFocusResource.event;

	private readonly _container: HTMLElement;
	private readonly _summaryLabel: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _model: DiagnosticsModel;
	private readonly _filter: DiagnosticsFilter;
	private _expanded = new Set<string>();

	constructor(parentDom: HTMLElement, model?: DiagnosticsModel, filter?: DiagnosticsFilter) {
		super();
		this._model = model ?? new DiagnosticsModel();
		this._filter = filter ?? new DiagnosticsFilter();

		CssInjector.inject(PROBLEMS_STYLE_ID, `
			.dc-problems-file-row { display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer; user-select: none; font-size: 13px; }
			.dc-problems-file-row:hover { background: #2a2d2e; }
			.dc-problems-diagnostic-row { display: flex; align-items: baseline; gap: 6px; padding: 1px 8px 1px 28px; cursor: pointer; font-size: 12px; user-select: none; }
			.dc-problems-diagnostic-row:hover { background: #2a2d2e; }
			.dc-problems-filter-row { display: flex; gap: 12px; padding: 4px 8px; border-bottom: 1px solid #2a2d2e; }
		`);

		this._container = $<HTMLElement>('div', 'dc-problems-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		const summaryRow = $<HTMLElement>('div');
		summaryRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid #2a2d2e;';
		this._summaryLabel = $<HTMLElement>('span');
		this._summaryLabel.style.cssText = 'font-size:11px;color:#8a8a8a;';
		const filterRow = $<HTMLElement>('div', 'dc-problems-filter-row');
		this._filter.render(filterRow);
		summaryRow.appendChild(this._summaryLabel);
		this._container.appendChild(summaryRow);
		this._container.appendChild(filterRow);

		this._listContainer = $<HTMLElement>('div', 'dc-problems-list');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);

		this._register(this._model.onDidChange(() => this.render()));
		this._register(this._filter.onDidChange(() => this.render()));
	}

	get model(): DiagnosticsModel {
		return this._model;
	}

	get filter(): DiagnosticsFilter {
		return this._filter;
	}

	public refresh(): void {
		this.render();
	}

	public revealResource(resource: URI): void {
		this._expanded.add(resource.toString());
		this.render();
	}

	public render(): void {
		clearNode(this._listContainer);
		this._summaryLabel.textContent = `Masalah: ${this._model.errorCount} error, ${this._model.warningCount} warning, ${this._model.infoCount} info`;

		const files = this._model.files
			.map(file => ({ ...file, diagnostics: file.diagnostics.filter(d => this._filter.accepts(d.severity)) }))
			.filter(file => file.diagnostics.length > 0);

		if (files.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada masalah yang terdeteksi.';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._listContainer.appendChild(empty);
			return;
		}

		for (const file of files) {
			this._renderFile(file);
		}
	}

	private _renderFile(file: IFileDiagnostics): void {
		const key = file.resource.toString();
		const expanded = this._expanded.has(key);

		const row = $<HTMLElement>('div', 'dc-problems-file-row');
		row.title = file.resource.path;

		const chevron = $<HTMLElement>('span');
		chevron.textContent = expanded ? '\u25BE' : '\u25B8';
		chevron.style.cssText = 'font-size:9px;width:12px;color:#cccccc;';

		const name = $<HTMLElement>('span');
		name.textContent = Path.basename(file.resource.path);
		name.style.cssText = 'font-weight:600;color:#cccccc;';

		const counts = $<HTMLElement>('span');
		counts.style.cssText = 'font-size:11px;margin-left:auto;';
		counts.appendChild(this._countBadge(file.diagnostics, DiagnosticSeverity.Error));
		counts.appendChild(this._countBadge(file.diagnostics, DiagnosticSeverity.Warning));
		counts.appendChild(this._countBadge(file.diagnostics, DiagnosticSeverity.Info));

		row.appendChild(chevron);
		row.appendChild(name);
		row.appendChild(counts);
		row.addEventListener('click', () => {
			if (this._expanded.has(key)) {
				this._expanded.delete(key);
			} else {
				this._expanded.add(key);
			}
			this.render();
		});
		this._listContainer.appendChild(row);

		if (expanded) {
			for (const diagnostic of file.diagnostics) {
				this._renderDiagnostic(file, diagnostic);
			}
		}
	}

	private _countBadge(diagnostics: readonly IDiagnostic[], severity: DiagnosticSeverity): HTMLElement {
		const count = diagnostics.filter(d => d.severity === severity).length;
		const badge = $<HTMLElement>('span');
		badge.textContent = `${DiagnosticsModel.getSeverityIcon(severity)}${count}`;
		badge.style.cssText = `color:${DiagnosticsModel.getSeverityColor(severity)};margin-left:6px;`;
		if (count === 0) {
			badge.style.visibility = 'hidden';
		}
		return badge;
	}

	private _renderDiagnostic(file: IFileDiagnostics, diagnostic: IDiagnostic): void {
		const row = $<HTMLElement>('div', 'dc-problems-diagnostic-row');
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});
		row.addEventListener('click', () => {
			this._onDidSelectDiagnostic.fire({ resource: file.resource, diagnostic });
		});

		const icon = $<HTMLElement>('span');
		icon.textContent = DiagnosticsModel.getSeverityIcon(diagnostic.severity);
		icon.style.cssText = `color:${DiagnosticsModel.getSeverityColor(diagnostic.severity)};font-size:11px;width:14px;text-align:center;`;

		const message = $<HTMLElement>('span');
		message.textContent = diagnostic.message;
		message.style.cssText = 'color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
		message.title = diagnostic.message;

		const source = $<HTMLElement>('span');
		const sourceLabel = diagnostic.source ? `${diagnostic.source} (${diagnostic.code ?? ''})` : '';
		source.textContent = `${diagnostic.line}:${diagnostic.column}`;
		source.style.cssText = 'color:#8a8a8a;font-size:11px;flex-shrink:0;';
		source.title = sourceLabel;

		row.appendChild(icon);
		row.appendChild(message);
		row.appendChild(source);
		this._listContainer.appendChild(row);
	}
}
