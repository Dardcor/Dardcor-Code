/**
 * Dardcor Code - Webview CSP Builder (Task 182)
 * Mirrors: vs/workbench/contrib/webview/common/webview.ts CSP generator
 */

export interface IWebviewCSPOptions {
	enableScripts?: boolean;
	enableForms?: boolean;
	allowResourceRoots?: string[];
}

export function buildWebviewCSPHeader(options: IWebviewCSPOptions = {}): string {
	const scriptSrc = options.enableScripts ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'none'";
	const formAction = options.enableForms ? "'self'" : "'none'";
	return [
		"default-src 'none'",
		`script-src ${scriptSrc}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"font-src 'self' data: https:",
		"connect-src 'self' https: wss:",
		`form-action ${formAction}`,
	].join('; ');
}
