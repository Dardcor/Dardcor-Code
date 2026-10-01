import './media/browserWelcome.css';
import { $ } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
export function createBrowserWelcome(title: string, subtitle: string): HTMLElement {
    const container = $('.browser-welcome-container');
    const content = $('.browser-welcome-content');
    const iconContainer = $('.browser-welcome-icon');
    iconContainer.appendChild(renderIcon(Codicon.globe));
    content.appendChild(iconContainer);
    const titleElement = $('h2.browser-welcome-title');
    titleElement.textContent = title;
    content.appendChild(titleElement);
    const subtitleElement = $('.browser-welcome-subtitle');
    subtitleElement.textContent = subtitle;
    content.appendChild(subtitleElement);
    container.appendChild(content);
    return container;
}
