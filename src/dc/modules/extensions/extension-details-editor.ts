/**
 * Dardcor Code - Full Extension README & Details Tab Editor Pane
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode } from '../../core/dom/element';
import { ExtensionRegistry, IExtensionInfo } from './extensions-viewlet';
import { getExtensionIconColor, getExtensionInitial } from './extension-card-renderer';
import { escape } from '../../core/types/strings';

export class ExtensionDetailsEditor extends Disposable {
	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	private readonly _container: HTMLElement;
	private _extension: IExtensionInfo | undefined;
	private _onBack: (() => void) | undefined;

	constructor(parentDom: HTMLElement, private readonly _registry: ExtensionRegistry) {
		super();
		this._container = $<HTMLElement>('div', 'dc-extension-details');
		this._container.style.cssText = 'position:absolute;inset:0;background:#1e1e1e;overflow-y:auto;z-index:10;';
		parentDom.appendChild(this._container);
	}

	public open(extension: IExtensionInfo, onBack?: () => void): void {
		this._extension = extension;
		this._onBack = onBack;
		this._container.style.display = 'block';
		this._render();
	}

	public hide(): void {
		this._container.style.display = 'none';
	}

	public close(): void {
		this.hide();
		this._onBack?.();
		this._onDidClose.fire();
	}

	private _render(): void {
		const extension = this._extension;
		if (!extension) {
			return;
		}
		clearNode(this._container);

		const toolbar = $<HTMLElement>('div', 'dc-extension-details-toolbar');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2d2e;position:sticky;top:0;background:#252526;z-index:1;';

		const backButton = $<HTMLButtonElement>('button');
		backButton.textContent = '\u2190 Kembali';
		backButton.style.cssText = 'background:transparent;border:none;color:#3794ff;font-size:12px;cursor:pointer;padding:4px 8px;';
		backButton.addEventListener('click', () => this.close());

		const title = $<HTMLElement>('span');
		title.textContent = 'DETAIL EKSTENSI';
		title.style.cssText = 'color:#bbbbbb;font-size:11px;letter-spacing:1px;font-weight:600;text-transform:uppercase;flex:1;';

		toolbar.appendChild(backButton);
		toolbar.appendChild(title);
		this._container.appendChild(toolbar);

		const header = $<HTMLElement>('div', 'dc-extension-details-header');
		header.style.cssText = 'display:flex;gap:12px;padding:16px 20px;align-items:center;';

		const icon = $<HTMLElement>('div');
		icon.style.cssText = 'width:64px;height:64px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:bold;color:white;flex-shrink:0;';
		icon.style.background = getExtensionIconColor(extension);
		icon.textContent = getExtensionInitial(extension);

		const info = $<HTMLElement>('div');
		info.style.cssText = 'flex:1;min-width:0;';

		const name = $<HTMLElement>('div');
		name.textContent = extension.name;
		name.style.cssText = 'font-size:18px;font-weight:bold;color:#ffffff;';

		const publisher = $<HTMLElement>('div');
		publisher.textContent = `${extension.publisher} \u2022 v${extension.version}`;
		publisher.style.cssText = 'font-size:12px;color:#8a8a8a;margin-top:2px;';

		const description = $<HTMLElement>('div');
		description.textContent = extension.description;
		description.style.cssText = 'font-size:13px;color:#cccccc;margin-top:6px;';

		info.appendChild(name);
		info.appendChild(publisher);
		info.appendChild(description);

		const installButton = $<HTMLButtonElement>('button');
		installButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:6px 16px;font-size:12px;cursor:pointer;flex-shrink:0;';
		installButton.textContent = extension.installed ? 'Uninstall' : 'Pasang';
		installButton.addEventListener('click', () => {
			if (extension.installed) {
				this._registry.uninstall(extension.id);
				installButton.textContent = 'Pasang';
			} else {
				this._registry.install(extension.id);
				installButton.textContent = 'Uninstall';
			}
		});

		header.appendChild(icon);
		header.appendChild(info);
		header.appendChild(installButton);
		this._container.appendChild(header);

		const meta = $<HTMLElement>('div', 'dc-extension-details-meta');
		meta.style.cssText = 'display:flex;gap:16px;padding:0 20px 12px;flex-wrap:wrap;';
		const metaItem = (label: string, value: string): HTMLElement => {
			const item = $<HTMLElement>('div');
			const lbl = $<HTMLElement>('span');
			lbl.textContent = `${label}: `;
			lbl.style.cssText = 'color:#8a8a8a;font-size:12px;';
			const val = $<HTMLElement>('span');
			val.textContent = value;
			val.style.cssText = 'color:#cccccc;font-size:12px;';
			item.appendChild(lbl);
			item.appendChild(val);
			return item;
		};
		meta.appendChild(metaItem('Kategori', extension.category ?? '-'));
		meta.appendChild(metaItem('Lisensi', extension.license ?? '-'));
		this._container.appendChild(meta);

		const readmeTitle = $<HTMLElement>('div');
		readmeTitle.textContent = 'README';
		readmeTitle.style.cssText = 'text-transform:uppercase;letter-spacing:1px;font-size:11px;font-weight:600;color:#bbbbbb;padding:8px 20px;border-top:1px solid #2a2d2e;';
		this._container.appendChild(readmeTitle);

		const readmeContent = $<HTMLElement>('div', 'dc-extension-readme');
		readmeContent.style.cssText = 'padding:0 20px 24px;font-size:13px;color:#cccccc;line-height:1.6;';
		readmeContent.innerHTML = ExtensionDetailsEditor.renderMarkdown(extension.readme ?? '*(Tidak ada README untuk ekstensi ini.)*');
		this._container.appendChild(readmeContent);
	}

	public static renderMarkdown(text: string): string {
		const lines = text.split(/\r?\n/);
		const html: string[] = [];
		let inCodeBlock = false;
		let codeBuffer: string[] = [];
		let inList = false;

		const flushList = (): void => {
			if (inList) {
				html.push('</ul>');
				inList = false;
			}
		};

		for (const line of lines) {
			if (line.trimStart().startsWith('```')) {
				if (inCodeBlock) {
					html.push(`<pre style="background:#252526;padding:10px;border-radius:4px;overflow-x:auto;"><code>${escape(codeBuffer.join('\n'))}</code></pre>`);
					codeBuffer = [];
					inCodeBlock = false;
				} else {
					flushList();
					inCodeBlock = true;
				}
				continue;
			}
			if (inCodeBlock) {
				codeBuffer.push(line);
				continue;
			}
			const trimmed = line.trim();
			if (!trimmed) {
				flushList();
				continue;
			}
			if (/^#{1,6}\s/.test(trimmed)) {
				flushList();
				const level = trimmed.match(/^(#+)/)![1].length;
				const content = escape(trimmed.replace(/^#{1,6}\s*/, ''));
				html.push(`<h${Math.min(level + 1, 4)} style="color:#ffffff;margin:12px 0 6px;">${content}</h${Math.min(level + 1, 4)}>`);
				continue;
			}
			if (/^[-*]\s/.test(trimmed)) {
				if (!inList) {
					html.push('<ul style="padding-left:20px;margin:6px 0;">');
					inList = true;
				}
				html.push(`<li>${escape(trimmed.replace(/^[-*]\s*/, ''))}</li>`);
				continue;
			}
			if (/^\d+\.\s/.test(trimmed)) {
				if (!inList) {
					html.push('<ol style="padding-left:20px;margin:6px 0;">');
					inList = true;
				}
				html.push(`<li>${escape(trimmed.replace(/^\d+\.\s*/, ''))}</li>`);
				continue;
			}
			flushList();
			let content = escape(trimmed);
			content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
			content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
			content = content.replace(/`([^`]+)`/g, '<code style="background:#252526;padding:1px 4px;border-radius:3px;">$1</code>');
			content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#3794ff;">$1</a>');
			html.push(`<p style="margin:4px 0;">${content}</p>`);
		}
		flushList();
		if (inCodeBlock) {
			html.push(`<pre style="background:#252526;padding:10px;border-radius:4px;"><code>${escape(codeBuffer.join('\n'))}</code></pre>`);
		}
		return html.join('\n');
	}
}
