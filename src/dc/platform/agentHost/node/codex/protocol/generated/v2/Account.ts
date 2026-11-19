
import type { PlanType } from "../PlanType.js";

export type Account = { "type": "apiKey", } | { "type": "chatgpt", email: string | null, planType: PlanType, } | { "type": "amazonBedrock", usesCodexManagedCredentials: boolean, };
