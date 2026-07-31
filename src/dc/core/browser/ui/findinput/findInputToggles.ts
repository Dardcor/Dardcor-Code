import { Toggle } from '../checkbox/checkbox';
import { Codicon } from '../../../common/codicons';
import * as nls from '../../../../nls';
import { type IHoverLifecycleOptions } from '../hover/hover';

export interface IFindInputToggleOpts {
	readonly appendTitle: string;
	readonly isChecked: boolean;
	readonly inputActiveOptionBorder?: string;
	readonly inputActiveOptionForeground?: string;
	readonly inputActiveOptionBackground?: string;
	readonly hoverLifecycleOptions?: IHoverLifecycleOptions;
}

const NLS_CASE_SENSITIVE_TOGGLE_LABEL = nls.localize('caseDescription', "Match Case");
const NLS_WHOLE_WORD_TOGGLE_LABEL = nls.localize('wordsDescription', "Match Whole Word");
const NLS_REGEX_TOGGLE_LABEL = nls.localize('regexDescription', "Use Regular Expression");

export class CaseSensitiveToggle extends Toggle {
	constructor(opts: IFindInputToggleOpts) {
		super({
			icon: Codicon.caseSensitive,
			title: NLS_CASE_SENSITIVE_TOGGLE_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			hoverLifecycleOptions: opts.hoverLifecycleOptions,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}

export class WholeWordsToggle extends Toggle {
	constructor(opts: IFindInputToggleOpts) {
		super({
			icon: Codicon.wholeWord,
			title: NLS_WHOLE_WORD_TOGGLE_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			hoverLifecycleOptions: opts.hoverLifecycleOptions,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}

export class RegexToggle extends Toggle {
	constructor(opts: IFindInputToggleOpts) {
		super({
			icon: Codicon.regex,
			title: NLS_REGEX_TOGGLE_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			hoverLifecycleOptions: opts.hoverLifecycleOptions,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}
