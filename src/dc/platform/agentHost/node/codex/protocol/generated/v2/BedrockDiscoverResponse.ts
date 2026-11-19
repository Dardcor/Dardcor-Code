
import type { BedrockAwsProfile } from "./BedrockAwsProfile.js";
import type { BedrockEnvironmentCredential } from "./BedrockEnvironmentCredential.js";

export type BedrockDiscoverResponse = { profiles: Array<BedrockAwsProfile>, environmentCredentials: Array<BedrockEnvironmentCredential>, };
