export interface IWebviewTheme {
	background: string;
	foreground: string;
	accent: string;
	colors: Record<string, string>;
}

const THEME_STYLE_ID = 'dc-webview-theme';

export class WebviewThemeSync {
	public injectThemeStyles(webviewIframe: HTMLIFrameElement, theme: IWebviewTheme): void {
		this._removeExisting(webviewIframe);
		const style = document.createElement('style');
		style.id = THEME_STYLE_ID;
		style.textContent = this._buildThemeCss(theme);
		webviewIframe.contentDocument?.head?.appendChild(style);
	}

	public updateTheme(webviewIframe: HTMLIFrameElement, theme: IWebviewTheme): void {
		this.injectThemeStyles(webviewIframe, theme);
	}

	private _buildThemeCss(theme: IWebviewTheme): string {
		const variables: string[] = [
			`--dc-webview-bg: ${theme.background};`,
			`--dc-webview-fg: ${theme.foreground};`,
			`--dc-webview-accent: ${theme.accent};`
		];
		for (const [key, value] of Object.entries(theme.colors)) {
			const safeKey = key.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
			variables.push(`--dc-webview-color-${safeKey}: ${value};`);
		}
		return `:root {\n\t${variables.join('\n\t')}\n}`;
	}

	private _removeExisting(webviewIframe: HTMLIFrameElement): void {
		const existing = webviewIframe.contentDocument?.getElementById(THEME_STYLE_ID);
		if (existing) {
			existing.remove();
		}
	}
}
