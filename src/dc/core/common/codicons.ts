export interface ICodicon {
	readonly id: string;
}

export const Codicon = {
	add: { id: 'add' },
	error: { id: 'error' },
	caseSensitive: { id: 'case-sensitive' },
	wholeWord: { id: 'whole-word' },
	regex: { id: 'regex' },
	preserveCase: { id: 'preserve-case' },
	replace: { id: 'replace' },
	replaceAll: { id: 'replace-all' },
	dialogError: { id: 'error' },
	dialogWarning: { id: 'warning' },
	dialogInfo: { id: 'info' },
	dialogClose: { id: 'close' },
	loading: { id: 'loading' }
} as const;

export const codicons = Codicon;
