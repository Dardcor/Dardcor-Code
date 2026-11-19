
import type { AwsCredentialType } from "./AwsCredentialType.js";

export type BedrockEnvironmentCredential = { type: AwsCredentialType, region: string | null, };
