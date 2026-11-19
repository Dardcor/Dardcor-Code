
export type FeedbackUploadParams = { classification: string, reason?: string | null, threadId?: string | null, includeLogs?: boolean, extraLogFiles?: Array<string> | null, tags?: { [key in string]?: string } | null, };
