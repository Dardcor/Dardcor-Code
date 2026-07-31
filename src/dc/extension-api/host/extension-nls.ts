import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface IExtensionNlsOptions {
	readonly catalogsRoot?: string;
	readonly defaultLocale?: string;
}

export class ExtensionNls extends Disposable {
	private readonly _catalogs = new Map<string, Record<string, string>>();
	private readonly _defaultLocale: string;

	private readonly _onDidLoadCatalog = this._register(new Emitter<{ locale: string; entries: number }>());
	readonly onDidLoadCatalog: Event<{ locale: string; entries: number }> = this._onDidLoadCatalog.event;

	constructor(private readonly _options: IExtensionNlsOptions = {}) {
		super();
		this._defaultLocale = this._options.defaultLocale ?? 'en';
	}

	public async loadCatalog(locale: string): Promise<Record<string, string>> {
		const normalized = this._normalize(locale);
		const cached = this._catalogs.get(normalized);
		if (cached) {
			return cached;
		}
		let catalog: Record<string, string> = {};
		const globalCatalogs = (globalThis as { __dardcorNlsCatalogs?: Record<string, Record<string, string>> }).__dardcorNlsCatalogs;
		if (globalCatalogs && typeof globalCatalogs[normalized] === 'object') {
			catalog = globalCatalogs[normalized];
			this._catalogs.set(normalized, catalog);
			this._onDidLoadCatalog.fire({ locale: normalized, entries: Object.keys(catalog).length });
			return catalog;
		}
		const loaded = await this._loadFromDisk(normalized);
		if (loaded) {
			catalog = loaded;
			this._catalogs.set(normalized, catalog);
			this._onDidLoadCatalog.fire({ locale: normalized, entries: Object.keys(catalog).length });
			return catalog;
		}
		this._catalogs.set(normalized, catalog);
		return catalog;
	}

	public registerCatalog(locale: string, catalog: Record<string, string>): void {
		this._catalogs.set(this._normalize(locale), catalog);
	}

	public translate(key: string, defaultText: string): string {
		for (const catalog of this._catalogs.values()) {
			const value = catalog[key];
			if (value !== undefined) {
				return value;
			}
		}
		return defaultText;
	}

	public getLoadedLocales(): string[] {
		return [...this._catalogs.keys()];
	}

	public clear(): void {
		this._catalogs.clear();
	}

	public override dispose(): void {
		this._catalogs.clear();
		super.dispose();
	}

	private async _loadFromDisk(locale: string): Promise<Record<string, string> | undefined> {
		if (!this._options.catalogsRoot || typeof process === 'undefined') {
			return undefined;
		}
		try {
			const fsp = await import('node:fs/promises');
			const path = await import('node:path');
			const filePath = path.join(this._options.catalogsRoot, `${locale}.json`);
			const raw = await fsp.readFile(filePath, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return undefined;
			}
			return parsed as Record<string, string>;
		} catch {
			return undefined;
		}
	}

	private _normalize(locale: string): string {
		const normalized = locale.replace(/_/g, '-').toLowerCase();
		if (!this._catalogs.has(normalized) && normalized.includes('-')) {
			return normalized.split('-')[0];
		}
		return normalized;
	}
}
