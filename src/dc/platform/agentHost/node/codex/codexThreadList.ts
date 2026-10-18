/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const THREAD_LIST_PAGE_SIZE = 100;

export const THREAD_LIST_MAX_PAGES = 50;

export interface IThreadListPageRequest {
	readonly limit: number;
	readonly modelProviders: string[];
	readonly cursor?: string;
}

export interface IThreadListPage<T> {
	readonly data: readonly T[];
	readonly nextCursor?: string | null;
}

export function buildThreadListPageRequest(cursor: string | undefined): IThreadListPageRequest {
	return {
		limit: THREAD_LIST_PAGE_SIZE,
		modelProviders: [],
		...(cursor !== undefined ? { cursor } : {}),
	};
}

export async function collectThreadListPages<T>(
	fetchPage: (request: IThreadListPageRequest) => Promise<IThreadListPage<T>>,
	onTruncated?: (collected: number) => void,
): Promise<T[]> {
	const items: T[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; page < THREAD_LIST_MAX_PAGES; page++) {
		const response = await fetchPage(buildThreadListPageRequest(cursor));
		items.push(...response.data);
		const nextCursor = response.nextCursor ?? undefined;
		if (nextCursor === undefined || seenCursors.has(nextCursor)) {
			return items;
		}
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}
	onTruncated?.(items.length);
	return items;
}
