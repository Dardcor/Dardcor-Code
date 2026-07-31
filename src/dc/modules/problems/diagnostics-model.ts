/**
 * Dardcor Code - Document Error & Warning Marker Aggregator Model
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Info = 2,
	Hint = 3
}

export interface IDiagnostic {
	readonly id?: string;
	readonly message: string;
	readonly severity: DiagnosticSeverity;
	readonly source?: string;
	readonly line: number;
	readonly column: number;
	readonly endLine?: number;
	readonly endColumn?: number;
	readonly code?: string;
}

export interface IFileDiagnostics {
	readonly resource: URI;
	readonly diagnostics: readonly IDiagnostic[];
}

export class DiagnosticsModel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _diagnostics = new Map<string, IFileDiagnostics>();

	public get files(): IFileDiagnostics[] {
		return [...this._diagnostics.values()].sort((a, b) => a.resource.path.localeCompare(b.resource.path));
	}

	public get size(): number {
		return this._diagnostics.size;
	}

	public getDiagnostics(resource: URI): IDiagnostic[] {
		return [...(this._diagnostics.get(resource.toString())?.diagnostics ?? [])];
	}

	public getDiagnosticsAt(resource: URI, line: number): IDiagnostic[] {
		return this.getDiagnostics(resource).filter(d => d.line === line);
	}

	public setDiagnostics(resource: URI, diagnostics: IDiagnostic[]): void {
		if (diagnostics.length === 0) {
			this._diagnostics.delete(resource.toString());
		} else {
			const sorted = [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column);
			this._diagnostics.set(resource.toString(), { resource, diagnostics: sorted });
		}
		this._onDidChange.fire();
	}

	public addDiagnostic(resource: URI, diagnostic: IDiagnostic): void {
		const key = resource.toString();
		const existing = this._diagnostics.get(key);
		this.setDiagnostics(resource, [...(existing?.diagnostics ?? []), diagnostic]);
	}

	public clearResource(resource: URI): void {
		this.setDiagnostics(resource, []);
	}

	public clearAll(): void {
		this._diagnostics.clear();
		this._onDidChange.fire();
	}

	public get hasProblems(): boolean {
		return this._diagnostics.size > 0;
	}

	public get errorCount(): number {
		return this._countSeverity(DiagnosticSeverity.Error);
	}

	public get warningCount(): number {
		return this._countSeverity(DiagnosticSeverity.Warning);
	}

	public get infoCount(): number {
		return this._countSeverity(DiagnosticSeverity.Info) + this._countSeverity(DiagnosticSeverity.Hint);
	}

	public get totalCount(): number {
		let count = 0;
		for (const entry of this._diagnostics.values()) {
			count += entry.diagnostics.length;
		}
		return count;
	}

	public static getSeverityLabel(severity: DiagnosticSeverity): string {
		switch (severity) {
			case DiagnosticSeverity.Error: return 'Error';
			case DiagnosticSeverity.Warning: return 'Warning';
			case DiagnosticSeverity.Info: return 'Info';
			default: return 'Hint';
		}
	}

	public static getSeverityColor(severity: DiagnosticSeverity): string {
		switch (severity) {
			case DiagnosticSeverity.Error: return '#f14c4c';
			case DiagnosticSeverity.Warning: return '#e5e510';
			case DiagnosticSeverity.Info: return '#3794ff';
			default: return '#8a8a8a';
		}
	}

	public static getSeverityIcon(severity: DiagnosticSeverity): string {
		switch (severity) {
			case DiagnosticSeverity.Error: return '\u2715';
			case DiagnosticSeverity.Warning: return '\u26A0';
			case DiagnosticSeverity.Info: return '\u2139';
			default: return '\u1F6C8';
		}
	}

	private _countSeverity(severity: DiagnosticSeverity): number {
		let count = 0;
		for (const entry of this._diagnostics.values()) {
			for (const diagnostic of entry.diagnostics) {
				if (diagnostic.severity === severity) {
					count++;
				}
			}
		}
		return count;
	}
}
