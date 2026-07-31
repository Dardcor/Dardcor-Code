/**
 * Dardcor Code - Locale Detector (Task 70)
 * Mirrors: vs/base/common/platform.ts locale & nls
 */

export interface ILocaleInfo {
	locale: string;
	language: string;
	region: string | undefined;
	isRTL: boolean;
}

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ku', 'ug']);

export function detectLocale(): ILocaleInfo {
	const rawLocale = typeof navigator !== 'undefined'
		? (navigator.language || (navigator as any).userLanguage || 'en')
		: 'en';

	const parts = rawLocale.split('-');
	const language = parts[0].toLowerCase();
	const region = parts[1]?.toUpperCase();

	return {
		locale: rawLocale,
		language,
		region,
		isRTL: RTL_LANGUAGES.has(language),
	};
}

export function getLanguageDisplayName(langCode: string): string {
	try {
		const names = new Intl.DisplayNames([langCode], { type: 'language' });
		return names.of(langCode) || langCode;
	} catch {
		return langCode;
	}
}

export function formatNumber(value: number, locale?: string): string {
	return new Intl.NumberFormat(locale || detectLocale().locale).format(value);
}

export function formatDate(date: Date, locale?: string, options?: Intl.DateTimeFormatOptions): string {
	return new Intl.DateTimeFormat(locale || detectLocale().locale, options).format(date);
}

export function formatCurrency(value: number, currency: string = 'USD', locale?: string): string {
	return new Intl.NumberFormat(locale || detectLocale().locale, {
		style: 'currency',
		currency
	}).format(value);
}

export function getTextDirection(language?: string): 'ltr' | 'rtl' {
	const lang = language || detectLocale().language;
	return RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
}
