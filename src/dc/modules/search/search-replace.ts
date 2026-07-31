/**
 * Dardcor Code - Global Find & Replace Across Workspace Files Engine
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IFileService } from '../../services/files/file-service.js';
import { URI } from '../../core/types/uri.js';
import { DataBuffer } from '../../core/binary/buffer.js';
import { createRegExp, regExpLeadsToEndlessLoop } from '../../core/types/strings.js';
import { ISearchMatch, ISearchOptions } from './ripgrep-service.js';

export interface IReplaceResult {
	readonly resource: URI;
	readonly replacements: number;
}

export interface IReplacePreview {
	readonly resource: URI;
	readonly occurrences: number;
}

export class SearchReplaceEngine extends Disposable {
	private readonly _onDidReplaceFile = this._register(new Emitter<IReplaceResult>());
	readonly onDidReplaceFile: Event<IReplaceResult> = this._onDidReplaceFile.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	constructor(private readonly _fileService: IFileService) {
		super();
	}

	public static groupByFile(matches: ISearchMatch[]): Map<string, ISearchMatch[]> {
		const groups = new Map<string, ISearchMatch[]>();
		for (const match of matches) {
			const key = match.resource.toString();
			let list = groups.get(key);
			if (!list) {
				list = [];
				groups.set(key, list);
			}
			list.push(match);
		}
		return groups;
	}

	public countPreview(matches: ISearchMatch[]): IReplacePreview[] {
		const groups = SearchReplaceEngine.groupByFile(matches);
		const previews: IReplacePreview[] = [];
		for (const [key, list] of groups) {
			previews.push({ resource: URI.parse(key), occurrences: list.length });
		}
		return previews.sort((a, b) => a.resource.path.localeCompare(b.resource.path));
	}

	public async replaceAll(query: string, replaceText: string, options: ISearchOptions, matches: ISearchMatch[]): Promise<IReplaceResult[]> {
		const groups = SearchReplaceEngine.groupByFile(matches);
		const results: IReplaceResult[] = [];
		for (const [key, list] of groups) {
			const resource = URI.parse(key);
			try {
				const count = await this.replaceInResource(resource, query, replaceText, options, list);
				results.push({ resource, replacements: count });
				this._onDidReplaceFile.fire({ resource, replacements: count });
			} catch (err) {
				this._onDidError.fire(`Gagal mengganti di ${resource.path}: ${String(err)}`);
			}
		}
		return results;
	}

	public async replaceInResource(resource: URI, query: string, replaceText: string, options: ISearchOptions, matches: ISearchMatch[]): Promise<number> {
		const { content } = await this._fileService.readFile(resource);
		let text = content.toString();

		let result: string;
		let count: number;
		if (options.isRegex) {
			const flags = options.matchCase ? 'g' : 'gi';
			const regex = new RegExp(query, flags);
			if (regExpLeadsToEndlessLoop(regex)) {
				throw new Error('Pattern dapat menyebabkan loop tak berujung');
			}
			let current = text;
			const parts: string[] = [];
			let lastIndex = 0;
			let replaced = 0;
			const globalRegex = new RegExp(regex.source, flags);
			let m = globalRegex.exec(current);
			while (m !== null) {
				if (m.index === globalRegex.lastIndex) {
					globalRegex.lastIndex++;
					m = globalRegex.exec(current);
					continue;
				}
				parts.push(current.substring(lastIndex, m.index));
				parts.push(m[0].replace(regex, replaceText));
				lastIndex = m.index + m[0].length;
				replaced++;
				m = globalRegex.exec(current);
			}
			parts.push(current.substring(lastIndex));
			result = parts.join('');
			count = replaced;
		} else {
			if (!query) {
				return 0;
			}
			const regex = createRegExp(query, false, { matchCase: options.matchCase, global: true });
			count = (text.match(regex) ?? []).length;
			result = text.split(regex).join(replaceText);
		}

		if (count > 0 && result !== text) {
			await this._fileService.writeFile(resource, DataBuffer.fromString(result));
		}
		return count;
	}
}
