/**
 * Dardcor Code - File Size & Modification Date Details Sidebar Tooltip
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { $ } from '../../core/dom/element';
import { Path } from '../../core/types/path';
import { DateFormatter } from '../../core/formatting/date-formatter';

declare const require: any;

export interface IFileStats {
	readonly path: string;
	readonly size: number;
	readonly mtime: number;
	readonly isDirectory: boolean;
}

export class FileStatsView extends Disposable {
	private readonly _tooltip: HTMLElement;
	private _visible = false;

	constructor() {
		super();
		this._tooltip = $<HTMLElement>('div', 'dc-file-stats-tooltip');
		this._tooltip.style.cssText = 'position:fixed;z-index:2000;background:#252526;border:1px solid #3c3c3c;border-radius:4px;padding:8px 12px;font-size:12px;color:#cccccc;box-shadow:0 4px 16px rgba(0,0,0,0.4);display:none;min-width:220px;pointer-events:none;';
		document.body.appendChild(this._tooltip);
	}

	get isVisible(): boolean {
		return this._visible;
	}

	public async showForPath(path: string, anchor: HTMLElement): Promise<void> {
		const stats = await FileStatsView.readStats(path);
		if (!stats) {
			return;
		}
		this.render(stats, anchor);
	}

	public async showForEntry(entry: IFileStats, anchor: HTMLElement): Promise<void> {
		this.render(entry, anchor);
	}

	public render(stats: IFileStats, anchor?: HTMLElement): void {
		this._tooltip.textContent = '';
		this._tooltip.style.display = 'block';
		this._visible = true;

		const addRow = (label: string, value: string): void => {
			const row = $<HTMLElement>('div');
			row.style.cssText = 'display:flex;gap:10px;justify-content:space-between;padding:2px 0;';
			const l = $<HTMLElement>('span');
			l.textContent = label;
			l.style.cssText = 'color:#8a8a8a;';
			const v = $<HTMLElement>('span');
			v.textContent = value;
			v.style.cssText = 'font-family:Consolas,monospace;color:#d4d4d4;';
			row.appendChild(l);
			row.appendChild(v);
			this._tooltip.appendChild(row);
		};

		addRow('Nama', Path.basename(stats.path));
		addRow('Ukuran', FileStatsView.formatSize(stats.size));
		addRow('Tipe', stats.isDirectory ? 'Folder' : FileStatsView.getFileType(stats.path));
		addRow('Diubah', FileStatsView.formatDate(stats.mtime));

		if (anchor) {
			this._positionNear(anchor);
		}
	}

	public hide(): void {
		this._tooltip.style.display = 'none';
		this._visible = false;
	}

	public static async readStats(path: string): Promise<IFileStats | undefined> {
		try {
			const fs = require('node:fs/promises');
			const stat = await fs.stat(path);
			return {
				path,
				size: stat.size,
				mtime: stat.mtimeMs,
				isDirectory: stat.isDirectory()
			};
		} catch {
			return undefined;
		}
	}

	public static formatSize(bytes: number): string {
		if (bytes < 1024) {
			return `${bytes} B`;
		}
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = bytes / 1024;
		let unit = units[0];
		for (let i = 1; i < units.length && value >= 1024; i++) {
			value /= 1024;
			unit = units[i];
		}
		return `${value.toFixed(1)} ${unit}`;
	}

	public static formatDate(timestamp: number): string {
		return DateFormatter.formatRelative(timestamp);
	}

	public static getFileType(path: string): string {
		const ext = Path.extname(path).toLowerCase();
		const map: Record<string, string> = {
			'.ts': 'TypeScript', '': 'JavaScript', '.tsx': 'TypeScript React',
			'.jsx': 'JavaScript React', '.json': 'JSON', '.css': 'CSS', '.html': 'HTML',
			'.md': 'Markdown', '.py': 'Python', '.txt': 'Text', '.png': 'PNG Image',
			'.jpg': 'JPEG Image', '.svg': 'SVG Image', '.log': 'Log File'
		};
		return map[ext] ?? `${ext || 'File'} File`;
	}

	private _positionNear(anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const tooltipRect = this._tooltip.getBoundingClientRect();
		let left = rect.right + 8;
		let top = rect.top;
		if (left + tooltipRect.width > window.innerWidth - 8) {
			left = Math.max(8, rect.left - tooltipRect.width - 8);
		}
		if (top + tooltipRect.height > window.innerHeight - 8) {
			top = Math.max(8, window.innerHeight - tooltipRect.height - 8);
		}
		this._tooltip.style.left = `${left}px`;
		this._tooltip.style.top = `${top}px`;
	}

	public dispose(): void {
		this._tooltip.remove();
		super.dispose();
	}
}
