
export type FileChange = { "type": "add", content: string, } | { "type": "delete", content: string, } | { "type": "update", unified_diff: string, move_path: string | null, };
