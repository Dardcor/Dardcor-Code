
import type { Account } from "./Account.js";

export type GetAccountResponse = { account: Account | null, requiresOpenaiAuth: boolean, };
