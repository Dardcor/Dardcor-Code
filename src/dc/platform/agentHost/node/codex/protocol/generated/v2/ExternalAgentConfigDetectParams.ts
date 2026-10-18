
export type ExternalAgentConfigDetectParams = {
	includeHome?: boolean,
	cwds?: Array<string> | null,
	maxSessionAgeDays?: number | null,
	maxSessions?: number | null,
	source?: string | null,
	migrationSource?: string | null,
};
