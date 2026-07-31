/**
 * Dardcor Code - Extension Item Card View Renderer
 */

import { $ } from '../../core/dom/element.js';
import type { IExtensionInfo } from './extensions-viewlet.js';

export interface IExtensionCardCallbacks {
	onInstall: (extension: IExtensionInfo) => void;
	onUninstall: (extension: IExtensionInfo) => void;
	onOpen: (extension: IExtensionInfo) => void;
}

const PUBLISHER_COLORS = [
	'#2472c8', '#0dbc79', '#bc3fbc', '#e5e510', '#cd3131', '#11a8cd', '#d670d6', '#3b8eea'
];

function hashString(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

export function getExtensionIconColor(extension: IExtensionInfo): string {
	return PUBLISHER_COLORS[hashString(extension.id) % PUBLISHER_COLORS.length];
}

export function getExtensionInitial(extension: IExtensionInfo): string {
	return (extension.name.trim()[0] ?? '?').toUpperCase();
}

export namespace ExtensionCardRenderer {
	export function render(container: HTMLElement, extension: IExtensionInfo, callbacks: IExtensionCardCallbacks): void {
		container.textContent = '';

		const icon = $<HTMLElement>('div', 'dc-extension-icon');
		icon.style.cssText = 'width:36px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;color:#ffffff;flex-shrink:0;';
		icon.style.background = getExtensionIconColor(extension);
		if (extension.icon) {
			icon.style.background = `url(${extension.icon}) center/cover no-repeat`;
			icon.textContent = '';
		} else {
			icon.textContent = getExtensionInitial(extension);
		}

		const body = $<HTMLElement>('div', 'dc-extension-body');
		body.style.cssText = 'flex:1;min-width:0;';

		const nameRow = $<HTMLElement>('div');
		nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const name = $<HTMLElement>('span', 'dc-extension-name');
		name.textContent = extension.name;
		name.style.cssText = 'font-size:13px;font-weight:600;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		const publisher = $<HTMLElement>('span', 'dc-extension-publisher');
		publisher.textContent = extension.publisher;
		publisher.style.cssText = 'font-size:11px;color:#8a8a8a;flex-shrink:0;';

		nameRow.appendChild(name);
		nameRow.appendChild(publisher);
		body.appendChild(nameRow);

		const description = $<HTMLElement>('div', 'dc-extension-description');
		description.textContent = extension.description;
		description.style.cssText = 'font-size:12px;color:#8a8a8a;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		body.appendChild(description);

		const metaRow = $<HTMLElement>('div');
		metaRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:2px;';

		const version = $<HTMLElement>('span', 'dc-extension-version');
		version.textContent = `v${extension.version}`;
		version.style.cssText = 'font-size:11px;color:#6a6a6a;';

		const category = $<HTMLElement>('span', 'dc-extension-category');
		if (extension.category) {
			category.textContent = extension.category;
			category.style.cssText = 'font-size:11px;color:#0e639c;background:#04222e;border-radius:8px;padding:0 6px;';
			metaRow.appendChild(category);
		}
		metaRow.appendChild(version);
		body.appendChild(metaRow);

		const actions = $<HTMLElement>('div', 'dc-extension-actions');
		actions.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;';

		const actionButton = $<HTMLButtonElement>('button', 'dc-extension-action');
		actionButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:10px;padding:2px 12px;font-size:11px;cursor:pointer;';
		if (extension.installed) {
			actionButton.textContent = extension.enabled ? 'Nonaktifkan' : 'Aktifkan';
			actionButton.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				callbacks.onUninstall(extension);
			});
		} else {
			actionButton.textContent = 'Pasang';
			actionButton.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				callbacks.onInstall(extension);
			});
		}
		actions.appendChild(actionButton);

		const detailsLink = $<HTMLElement>('span', 'dc-extension-details-link');
		detailsLink.textContent = 'Detail';
		detailsLink.style.cssText = 'font-size:11px;color:#3794ff;cursor:pointer;';
		detailsLink.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			callbacks.onOpen(extension);
		});
		actions.appendChild(detailsLink);

		container.appendChild(icon);
		container.appendChild(body);
		container.appendChild(actions);
	}
}
