
import type { LoginAppBrand } from "./LoginAppBrand.js";

export type LoginAccountParams = { "type": "apiKey", apiKey: string, } | { "type": "chatgpt", codexStreamlinedLogin?: boolean, useHostedLoginSuccessPage?: boolean, appBrand?: LoginAppBrand | null, } | { "type": "chatgptDeviceCode" } | {
	"type": "chatgptAuthTokens",
	accessToken: string,
	chatgptAccountId: string,
	chatgptPlanType?: string | null,
} | { "type": "amazonBedrock", apiKey: string, region: string, };
