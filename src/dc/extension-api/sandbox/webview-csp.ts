export interface IWebviewCspOptions {
	allowScripts: boolean;
	allowInlineScripts?: boolean;
	allowEval?: boolean;
}

export function buildWebviewCsp(source: string, options: IWebviewCspOptions): string {
	const directives: string[] = ["default-src 'none'"];
	if (options.allowScripts) {
		let scriptSrc = `script-src ${source}`;
		if (options.allowInlineScripts) {
			scriptSrc += " 'unsafe-inline'";
		}
		if (options.allowEval) {
			scriptSrc += " 'unsafe-eval'";
		}
		directives.push(scriptSrc);
	} else {
		directives.push("script-src 'none'");
	}
	directives.push("style-src 'unsafe-inline'");
	directives.push(`font-src ${source}`);
	directives.push('img-src data: https:');
	directives.push('connect-src ws: https:');
	directives.push(options.allowScripts ? `child-src ${source}` : "child-src 'none'");
	directives.push(options.allowScripts ? `frame-src ${source}` : "frame-src 'none'");
	return directives.join('; ');
}
