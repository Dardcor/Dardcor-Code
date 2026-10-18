
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type PluginInterface = {
	displayName: string | null, shortDescription: string | null, longDescription: string | null, developerName: string | null, category: string | null, capabilities: Array<string>, websiteUrl: string | null, privacyPolicyUrl: string | null, termsOfServiceUrl: string | null,
	defaultPrompt: Array<string> | null, brandColor: string | null,
	composerIcon: AbsolutePathBuf | null,
	composerIconUrl: string | null,
	logo: AbsolutePathBuf | null,
	logoDark: AbsolutePathBuf | null,
	logoUrl: string | null,
	logoUrlDark: string | null,
	screenshots: Array<AbsolutePathBuf>,
	screenshotUrls: Array<string>,
};
