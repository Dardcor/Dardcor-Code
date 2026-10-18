
import type { AwsCredentialType } from "./AwsCredentialType.js";

export type BedrockSetupParams = { "type": "profile", profile: string, region: string, } | { "type": "environment", credentialType: AwsCredentialType, region: string, } | { "type": "accessKeys", accessKeyId: string, secretAccessKey: string, sessionToken?: string | null, region: string, };
