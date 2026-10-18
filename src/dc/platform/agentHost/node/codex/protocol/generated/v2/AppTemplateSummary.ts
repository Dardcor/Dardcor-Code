
import type { AppTemplateUnavailableReason } from "./AppTemplateUnavailableReason.js";

export type AppTemplateSummary = { templateId: string, name: string, description: string | null, category: string | null, canonicalConnectorId: string | null, logoUrl: string | null, logoUrlDark: string | null, materializedAppIds: Array<string>, reason: AppTemplateUnavailableReason | null, };
