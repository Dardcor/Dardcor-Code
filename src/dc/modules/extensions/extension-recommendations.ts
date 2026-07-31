/**
 * Dardcor Code - Extension Recommendation Engine & Suggestions View
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { IExtensionInfo } from './extensions-viewlet.js';

export type RecommendationReason = 'workspace' | 'filetype' | 'popular' | 'config';

export interface IExtensionRecommendation {
	readonly extensionId: string;
	readonly displayName: string;
	readonly reason: RecommendationReason;
	readonly reasonText: string;
	readonly weight: number;
	readonly installed: boolean;
}

export class ExtensionRecommendations extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _recommendations = new Map<string, IExtensionRecommendation>();

	constructor() {
		super();
		this._registerPopular();
	}

	get recommendations(): IExtensionRecommendation[] {
		return [...this._recommendations.values()].sort((a, b) => b.weight - a.weight);
	}

	get pending(): IExtensionRecommendation[] {
		return this.recommendations.filter(r => !r.installed);
	}

	public addRecommendation(rec: IExtensionRecommendation): void {
		this._recommendations.set(rec.extensionId, rec);
		this._onDidChange.fire();
	}

	public removeRecommendation(extensionId: string): void {
		if (this._recommendations.delete(extensionId)) {
			this._onDidChange.fire();
		}
	}

	public dismiss(extensionId: string): void {
		this.removeRecommendation(extensionId);
	}

	public markInstalled(extensionId: string, installed: boolean): void {
		const rec = this._recommendations.get(extensionId);
		if (rec && rec.installed !== installed) {
			this._recommendations.set(extensionId, { ...rec, installed });
			this._onDidChange.fire();
		}
	}

	public recommendForWorkspace(extensions: string[], reasonText: string): void {
		for (const id of extensions) {
			const existing = this._recommendations.get(id);
			this._recommendations.set(id, {
				extensionId: id,
				displayName: existing?.displayName ?? id,
				reason: 'workspace',
				reasonText,
				weight: Math.max(existing?.weight ?? 0, 100),
				installed: existing?.installed ?? false
			});
		}
		this._onDidChange.fire();
	}

	public recommendForFileTypes(extensionIds: string[], fileExtensions: string[]): void {
		if (fileExtensions.length === 0) {
			return;
		}
		const extensions = fileExtensions.join(', ');
		for (const id of extensionIds) {
			this.addRecommendation({
				extensionId: id,
				displayName: id,
				reason: 'filetype',
				reasonText: `Untuk file ${extensions}`,
				weight: 60,
				installed: false
			});
		}
	}

	public render(parentDom: HTMLElement, installedIds: ReadonlySet<string>): HTMLElement {
		const container = $<HTMLElement>('div', 'dc-extension-recommendations');
		container.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px;';
		const title = $<HTMLElement>('div');
		title.textContent = 'REKOMENDASI';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;padding:2px 4px;';
		container.appendChild(title);

		const list = $<HTMLElement>('div');
		list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
		container.appendChild(list);

		const render = (): void => {
			clearNode(list);
			const items = this.pending.filter(r => !installedIds.has(r.extensionId));
			for (const rec of items) {
				list.appendChild(this._renderRecommendation(rec));
			}
			if (items.length === 0) {
				const empty = $<HTMLElement>('div');
				empty.textContent = 'Tidak ada rekomendasi saat ini.';
				empty.style.cssText = 'padding:4px 8px;color:#8a8a8a;font-size:12px;';
				list.appendChild(empty);
			}
		};
		render();
		this._register(this.onDidChange(render));
		parentDom.appendChild(container);
		return container;
	}

	private _renderRecommendation(rec: IExtensionRecommendation): HTMLElement {
		const row = $<HTMLElement>('div');
		row.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:6px 8px;background:#2a2d2e;border-radius:2px;cursor:pointer;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#333333';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '#2a2d2e';
		});

		const line1 = $<HTMLElement>('div');
		line1.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const icon = $<HTMLElement>('span');
		icon.textContent = '\u2726';
		icon.style.cssText = 'color:#d7ba7d;font-size:11px;';

		const name = $<HTMLElement>('span');
		name.textContent = rec.displayName;
		name.style.cssText = 'font-size:13px;color:#cccccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		name.title = rec.extensionId;

		line1.appendChild(icon);
		line1.appendChild(name);
		row.appendChild(line1);

		const reason = $<HTMLElement>('div');
		reason.textContent = rec.reasonText;
		reason.style.cssText = 'font-size:11px;color:#8a8a8a;padding-left:17px;';

		row.appendChild(reason);
		this._register(addDisposableListener(row, 'click', () => {
			this.dismiss(rec.extensionId);
		}));
		return row;
	}

	private _registerPopular(): void {
		const popular: Array<[string, string, string, number]> = [
			['esbenp.prettier-vscode', 'Prettier', 'Formatter kode yang paling banyak digunakan', 40],
			['dbaeumer.vscode-eslint', 'ESLint', 'Linting JavaScript & TypeScript', 38],
			['ms-python.python', 'Python', 'Dukungan bahasa Python', 30],
			['github.copilot', 'GitHub Copilot', 'AI pair programmer', 25],
			['eamodio.gitlens', 'GitLens', 'Visualisasi git berdaya tinggi', 22],
			['ms-vscode.cpptools', 'C/C++', 'Dukungan bahasa C/C++', 18],
			['ritwickdey.liveserver', 'Live Server', 'Server pengembangan statis', 15]
		];
		for (const [id, name, text, weight] of popular) {
			this.addRecommendation({
				extensionId: id,
				displayName: name,
				reason: 'popular',
				reasonText: text,
				weight,
				installed: false
			});
		}
	}

	public static mergeExtensionPacks(packs: IExtensionRecommendation[]): IExtensionRecommendation[] {
		const merged = new Map<string, IExtensionRecommendation>();
		for (const pack of packs) {
			if (!merged.has(pack.extensionId) || merged.get(pack.extensionId)!.weight < pack.weight) {
				merged.set(pack.extensionId, pack);
			}
		}
		return [...merged.values()];
	}

	public static extensionIdToDisplayName(extensionId: string): string {
		return extensionId.split('.').pop() ?? extensionId;
	}
}
