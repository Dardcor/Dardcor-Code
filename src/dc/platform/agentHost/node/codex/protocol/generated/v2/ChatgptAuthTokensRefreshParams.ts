
import type { ChatgptAuthTokensRefreshReason } from "./ChatgptAuthTokensRefreshReason.js";

export type ChatgptAuthTokensRefreshParams = {
	reason: ChatgptAuthTokensRefreshReason,
	previousAccountId?: string | null,
};
