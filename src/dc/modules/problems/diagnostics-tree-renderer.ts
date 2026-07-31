/**
 * Dardcor Code - File Problem Group Node DOM Element Renderer
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { Path } from '../../core/types/path';
import { IFileDiagnostics, IDiagnostic, DiagnosticsModel, DiagnosticSeverity } from './diagnostics-model';

export interface IDiagnosticsTreeNodeEvent {
	readonly file: IFileDiagnostics;
	readonly diagnostic?: IDiagnostic;
}

export class DiagnosticsTreeRenderer extends Disposable {
	private readonly _onDidSelectDiagnostic = this._register(new Emitter<IDiagnosticsTreeNodeEvent>());
	readonly onDidSelectDiagnostic: Event<IDiagnosticsTreeNodeEvent> = this._onDidSelectDiagnostic.event;

	private readonly _onDidToggleFile = this._register(new Emitter<IFileDiagnostics>());
	readonly onDidToggleFile: Event<IFileDiagnostics> = this._onDidToggleFile.event;

	public renderFileRow(container: HTMLElement, file: IFileDiagnostics, expanded: boolean): HTMLElement {
		const row = $<HTMLElement>('div', 'dc-diagnostics-file');
		row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;user-select:none;font-size:13px;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});
		row.addEventListener('click', () => {
			this._onDidToggleFile.fire(file);
		});

		const chevron = $<HTMLElement>('span');
		chevron.textContent = expanded ? '\u25BE' : '\u25B8';
		chevron.style.cssText = 'font-size:9px;width:12px;color:#cccccc;';

		const name = $<HTMLElement>('span');
		name.textContent = Path.basename(file.resource.path);
		name.style.cssText = 'font-weight:600;color:#cccccc;';
		name.title = file.resource.path;

		const counts = $<HTMLElement>('span');
		counts.style.cssText = 'font-size:11px;margin-left:auto;display:flex;gap:6px;';
		counts.appendChild(DiagnosticsTreeRenderer.createCountBadge(file.diagnostics, DiagnosticSeverity.Error));
		counts.appendChild(DiagnosticsTreeRenderer.createCountBadge(file.diagnostics, DiagnosticSeverity.Warning));
		counts.appendChild(DiagnosticsTreeRenderer.createCountBadge(file.diagnostics, DiagnosticSeverity.Info));

		row.appendChild(chevron);
		row.appendChild(name);
		row.appendChild(counts);
		container.appendChild(row);
		return row;
	}

	public renderDiagnosticRow(container: HTMLElement, file: IFileDiagnostics, diagnostic: IDiagnostic): HTMLElement {
		const row = $<HTMLElement>('div', 'dc-diagnostics-item');
		row.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:1px 8px 1px 28px;cursor:pointer;font-size:12px;user-select:none;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});
		row.addEventListener('click', () => {
			this._onDidSelectDiagnostic.fire({ file, diagnostic });
		});

		const icon = $<HTMLElement>('span');
		icon.textContent = DiagnosticsModel.getSeverityIcon(diagnostic.severity);
		icon.style.cssText = `color:${DiagnosticsModel.getSeverityColor(diagnostic.severity)};font-size:11px;width:14px;text-align:center;flex-shrink:0;`;

		const message = $<HTMLElement>('span');
		message.textContent = diagnostic.message;
		message.style.cssText = 'color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
		message.title = diagnostic.message;

		const source = $<HTMLElement>('span');
		source.textContent = `${diagnostic.line}:${diagnostic.column}`;
		source.style.cssText = 'color:#8a8a8a;font-size:11px;flex-shrink:0;';
		source.title = diagnostic.source ?? '';

		row.appendChild(icon);
		row.appendChild(message);
		row.appendChild(source);
		container.appendChild(row);
		return row;
	}

	public renderTree(container: HTMLElement, files: readonly IFileDiagnostics[], expandedKeys: ReadonlySet<string>): void {
		container.textContent = '';
		for (const file of files) {
			const key = file.resource.toString();
			const expanded = expandedKeys.has(key);
			this.renderFileRow(container, file, expanded);
			if (expanded) {
				for (const diagnostic of file.diagnostics) {
					this.renderDiagnosticRow(container, file, diagnostic);
				}
			}
		}
	}

	public static createCountBadge(diagnostics: readonly IDiagnostic[], severity: DiagnosticSeverity): HTMLElement {
		const count = diagnostics.filter(d => d.severity === severity).length;
		const badge = $<HTMLElement>('span');
		badge.textContent = `${DiagnosticsModel.getSeverityIcon(severity)}${count}`;
		badge.style.cssText = `color:${DiagnosticsModel.getSeverityColor(severity)};`;
		if (count === 0) {
			badge.style.visibility = 'hidden';
		}
		return badge;
	}
}
