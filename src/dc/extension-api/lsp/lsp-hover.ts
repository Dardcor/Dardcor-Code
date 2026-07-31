/**
 * Dardcor Code - LSP textDocument/hover Request Handler (Task 630)
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';
import { lspRangeToApiRange, lspMarkupContentToMarkdown, ILspRange } from './lsp-converters';
import { Position, Range, MarkdownString } from '../api/ext-host-api-impl';

export interface ILspHover {
	contents: string | Array<string | { kind: string; value: string }> | { kind: string; value: string };
	range?: ILspRange;
}

export interface IHoverResult {
	contents: Array<{ value: string; isTrusted: boolean }>;
	range?: Range;
}

export interface IHoverRequestParams {
	readonly uri: string;
	readonly position: Position;
}

/**
 * Sends `textDocument/hover` requests and converts the server's markup
 * content into editor hover payloads.
 */
export class LspHoverHandler extends Disposable {
	constructor(private readonly _client: LspClient) {
		super();
	}

	public async provideHover(params: IHoverRequestParams): Promise<IHoverResult | undefined> {
		const result = await this._client.request<ILspHover | undefined | null>('textDocument/hover', {
			textDocument: { uri: params.uri },
			position: { line: params.position.lineNumber - 1, character: params.position.column - 1 }
		});
		if (!result) {
			return undefined;
		}
		const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
		const converted = contents.map(content => {
			const markdown = lspMarkupContentToMarkdown(content as any);
			return markdown ?? new MarkdownString(String(content));
		});
		return {
			contents: converted.map(md => md.toJSON()),
			range: result.range ? lspRangeToApiRange(result.range) : undefined
		};
	}

	public async prepareHover(uri: string, position: Position): Promise<boolean> {
		try {
			const result = await this.provideHover({ uri, position });
			return !!result && result.contents.length > 0;
		} catch {
			return false;
		}
	}
}
