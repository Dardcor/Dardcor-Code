
import type { ExecPolicyAmendment } from "./ExecPolicyAmendment.js";
import type { NetworkPolicyAmendment } from "./NetworkPolicyAmendment.js";

export type ReviewDecision = "approved" | { "approved_execpolicy_amendment": { proposed_execpolicy_amendment: ExecPolicyAmendment, } } | "approved_for_session" | "approved_mcp_policy_amendment" | { "network_policy_amendment": { network_policy_amendment: NetworkPolicyAmendment, } } | { "denied": { rejection: string, } } | "timed_out" | "abort";
