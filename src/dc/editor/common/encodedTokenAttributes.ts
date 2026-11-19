/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum LanguageId {
	Null = 0,
	PlainText = 1
}

export const enum FontStyle {
	NotSet = -1,
	None = 0,
	Italic = 1,
	Bold = 2,
	Underline = 4,
	Strikethrough = 8,
}

export const enum ColorId {
	None = 0,
	DefaultForeground = 1,
	DefaultBackground = 2
}

export const enum StandardTokenType {
	Other = 0,
	Comment = 1,
	String = 2,
	RegEx = 3
}

export const enum MetadataConsts {
	LANGUAGEID_MASK = 0b00000000_00000000_00000000_11111111,
	TOKEN_TYPE_MASK = 0b00000000_00000000_00000011_00000000,
	BALANCED_BRACKETS_MASK = 0b00000000_00000000_00000100_00000000,
	FONT_STYLE_MASK = 0b00000000_00000000_01111000_00000000,
	FOREGROUND_MASK = 0b00000000_11111111_10000000_00000000,
	BACKGROUND_MASK = 0b11111111_00000000_00000000_00000000,

	ITALIC_MASK = 0b00000000_00000000_00001000_00000000,
	BOLD_MASK = 0b00000000_00000000_00010000_00000000,
	UNDERLINE_MASK = 0b00000000_00000000_00100000_00000000,
	STRIKETHROUGH_MASK = 0b00000000_00000000_01000000_00000000,

	SEMANTIC_USE_ITALIC = 0b00000000_00000000_00000000_00000001,
	SEMANTIC_USE_BOLD = 0b00000000_00000000_00000000_00000010,
	SEMANTIC_USE_UNDERLINE = 0b00000000_00000000_00000000_00000100,
	SEMANTIC_USE_STRIKETHROUGH = 0b00000000_00000000_00000000_00001000,
	SEMANTIC_USE_FOREGROUND = 0b00000000_00000000_00000000_00010000,
	SEMANTIC_USE_BACKGROUND = 0b00000000_00000000_00000000_00100000,

	LANGUAGEID_OFFSET = 0,
	TOKEN_TYPE_OFFSET = 8,
	BALANCED_BRACKETS_OFFSET = 10,
	FONT_STYLE_OFFSET = 11,
	FOREGROUND_OFFSET = 15,
	BACKGROUND_OFFSET = 24
}

export class TokenMetadata {

	public static getLanguageId(metadata: number): LanguageId {
		return (metadata & MetadataConsts.LANGUAGEID_MASK) >>> MetadataConsts.LANGUAGEID_OFFSET;
	}

	public static getTokenType(metadata: number): StandardTokenType {
		return (metadata & MetadataConsts.TOKEN_TYPE_MASK) >>> MetadataConsts.TOKEN_TYPE_OFFSET;
	}

	public static containsBalancedBrackets(metadata: number): boolean {
		return (metadata & MetadataConsts.BALANCED_BRACKETS_MASK) !== 0;
	}

	public static getFontStyle(metadata: number): FontStyle {
		return (metadata & MetadataConsts.FONT_STYLE_MASK) >>> MetadataConsts.FONT_STYLE_OFFSET;
	}

	public static getForeground(metadata: number): ColorId {
		return (metadata & MetadataConsts.FOREGROUND_MASK) >>> MetadataConsts.FOREGROUND_OFFSET;
	}

	public static getBackground(metadata: number): ColorId {
		return (metadata & MetadataConsts.BACKGROUND_MASK) >>> MetadataConsts.BACKGROUND_OFFSET;
	}

	public static getClassNameFromMetadata(metadata: number): string {
		const foreground = this.getForeground(metadata);
		let className = 'mtk' + foreground;

		const fontStyle = this.getFontStyle(metadata);
		if (fontStyle & FontStyle.Italic) {
			className += ' mtki';
		}
		if (fontStyle & FontStyle.Bold) {
			className += ' mtkb';
		}
		if (fontStyle & FontStyle.Underline) {
			className += ' mtku';
		}
		if (fontStyle & FontStyle.Strikethrough) {
			className += ' mtks';
		}

		return className;
	}

	public static getInlineStyleFromMetadata(metadata: number, colorMap: string[]): string {
		const foreground = this.getForeground(metadata);
		const fontStyle = this.getFontStyle(metadata);

		let result = `color: ${colorMap[foreground]};`;
		if (fontStyle & FontStyle.Italic) {
			result += 'font-style: italic;';
		}
		if (fontStyle & FontStyle.Bold) {
			result += 'font-weight: bold;';
		}
		let textDecoration = '';
		if (fontStyle & FontStyle.Underline) {
			textDecoration += ' underline';
		}
		if (fontStyle & FontStyle.Strikethrough) {
			textDecoration += ' line-through';
		}
		if (textDecoration) {
			result += `text-decoration:${textDecoration};`;

		}
		return result;
	}

	public static getPresentationFromMetadata(metadata: number): ITokenPresentation {
		const foreground = this.getForeground(metadata);
		const fontStyle = this.getFontStyle(metadata);

		return {
			foreground: foreground,
			italic: Boolean(fontStyle & FontStyle.Italic),
			bold: Boolean(fontStyle & FontStyle.Bold),
			underline: Boolean(fontStyle & FontStyle.Underline),
			strikethrough: Boolean(fontStyle & FontStyle.Strikethrough),
		};
	}
}

export interface ITokenPresentation {
	foreground: ColorId;
	italic: boolean;
	bold: boolean;
	underline: boolean;
	strikethrough: boolean;
}
