/**
 * Dardcor Code - File Explorer Filter Input (files.exclude)
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';
import { match } from '../../core/formatting/glob';
import { Path } from '../../core/types/path';
import { FileTreeNode } from './file-tree-model';
import { IConfigurationService, ConfigurationService } from '../../services/configuration/configuration-service';

export interface IFileFilterPatterns {
	readonly excludes: string[];
	readonly includes: string[];
}

export class FileFilter extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _excludes: string[] = [];
	private _includes: string[] = [];
	private _filterHidden = true;

	constructor(private readonly _configurationService?: IConfigurationService) {
		super();
		this._loadFromConfig();
		if (this._configurationService) {
			this._register(this._configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('files.exclude')) {
					this._loadFromConfig();
					this._onDidChange.fire();
				}
			}));
		}
	}

	get excludes(): string[] {
		return [...this._excludes];
	}

	get includes(): string[] {
		return [...this._includes];
	}

	public setPatterns(patterns: IFileFilterPatterns): void {
		this._excludes = [...patterns.excludes];
		this._includes = [...patterns.includes];
		this._onDidChange.fire();
	}

	public setExcludes(patterns: string[]): void {
		this._excludes = [...patterns];
		this._onDidChange.fire();
	}

	public setIncludes(patterns: string[]): void {
		this._includes = [...patterns];
		this._onDidChange.fire();
	}

	public setFilterHidden(value: boolean): void {
		this._filterHidden = value;
		this._onDidChange.fire();
	}

	public isExcluded(path: string): boolean {
		const normalized = Path.normalize(path).replace(/^\.\//, '');
		const base = Path.basename(normalized);
		if (this._filterHidden && base.startsWith('.') && !this._isTrackedDotFile(base)) {
			return true;
		}
		if (this._includes.length > 0 && this._includes.some(p => match(p, normalized) || match(p, base))) {
			return false;
		}
		return this._excludes.some(p => match(p, normalized) || match(p, base) || p === base);
	}

	public applyToModel(model: { getVisibleNodes(): FileTreeNode[] }): void {
		for (const node of model.getVisibleNodes()) {
			node.visible = !this.isExcluded(node.element.resource.path);
		}
	}

	public static parsePatternList(text: string): string[] {
		return text
			.split(/[\r\n,]/)
			.map(p => p.trim())
			.filter(p => !!p && !p.startsWith('#'));
	}

	public static fromConfigValue(value: any): string[] {
		if (typeof value === 'string') {
			return FileFilter.parsePatternList(value);
		}
		if (value && typeof value === 'object') {
			return Object.keys(value).filter(k => !!value[k]);
		}
		return [];
	}

	public createInput(parentDom: HTMLElement, placeholder = 'Filter (mis. *.log, node_modules)'): HTMLInputElement {
		const wrapper = $<HTMLElement>('div');
		wrapper.style.cssText = 'padding:6px 10px;border-bottom:1px solid #2a2d2e;';
		const input = $<HTMLInputElement>('input');
		input.placeholder = placeholder;
		input.value = this._excludes.join(', ');
		input.style.cssText = 'width:100%;box-sizing:border-box;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:12px;padding:3px 8px;outline:none;';
		this._register(addDisposableListener(input, 'input', () => {
			this.setExcludes(FileFilter.parsePatternList(input.value));
		}));
		wrapper.appendChild(input);
		parentDom.appendChild(wrapper);
		return input;
	}

	private _isTrackedDotFile(base: string): boolean {
		return base === '.gitignore' || base === '.gitattributes' || base === '.editorconfig'
			|| base === '.env' || base === '.npmrc' || base === '.prettierrc';
	}

	private _loadFromConfig(): void {
		if (!this._configurationService) {
			return;
		}
		const value = this._configurationService.getValue<any>('files.exclude');
		this._excludes = FileFilter.fromConfigValue(value);
	}
}
