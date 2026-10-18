
export type ReviewTarget = { "type": "uncommittedChanges" } | { "type": "baseBranch", branch: string, } | {
	"type": "commit", sha: string,
	title: string | null,
} | { "type": "custom", instructions: string, };
