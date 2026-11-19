
export type LoginAccountResponse = { "type": "apiKey", } | {
	"type": "chatgpt", loginId: string,
	authUrl: string,
} | {
	"type": "chatgptDeviceCode", loginId: string,
	verificationUrl: string,
	userCode: string,
} | { "type": "chatgptAuthTokens", } | { "type": "amazonBedrock", };
