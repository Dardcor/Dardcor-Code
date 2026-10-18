
export type ParsedCommand = {
	"type": "read", cmd: string, name: string,
	path: string,
} | { "type": "list_files", cmd: string, path: string | null, } | { "type": "search", cmd: string, query: string | null, path: string | null, } | { "type": "unknown", cmd: string, };
