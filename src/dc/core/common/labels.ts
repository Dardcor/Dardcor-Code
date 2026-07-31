export function getBaseLabel() {}
export function getPathLabel() {}
export function getCompactRoute() {}
export function getFolderName() {}
export function getLongestLabel() {}
export function isPathLabel() {}

export interface IMnemonicResult {
	readonly label: string;
	readonly mnemonic?: string;
}

export function mnemonicButtonLabel(text: string, forceMnemonic?: boolean): IMnemonicResult {
	return { label: text.replace(/&/g, '') };
}
