/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from '../../../base/common/arrays.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import * as objects from '../../../base/common/objects.js';
import * as platform from '../../../base/common/platform.js';
import { ScrollbarVisibility } from '../../../base/common/scrollable.js';
import { Constants } from '../../../base/common/uint.js';
import { EDITOR_FONT_DEFAULTS, FONT_VARIATION_OFF, FONT_VARIATION_TRANSLATE, FontInfo } from './fontInfo.js';
import { EDITOR_MODEL_DEFAULTS } from '../core/misc/textModelDefaults.js';
import { USUAL_WORD_SEPARATORS } from '../core/wordHelper.js';
import * as nls from '../../../nls.js';
import { AccessibilitySupport } from '../../../platform/accessibility/common/accessibility.js';
import { IConfigurationPropertySchema } from '../../../platform/configuration/common/configurationRegistry.js';


export type EditorAutoClosingStrategy = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';

export type EditorAutoSurroundStrategy = 'languageDefined' | 'quotes' | 'brackets' | 'never';

export type EditorAutoClosingEditStrategy = 'always' | 'auto' | 'never';

type Unknown<T> = { [K in keyof T]: unknown };

export const enum EditorAutoIndentStrategy {
	None = 0,
	Keep = 1,
	Brackets = 2,
	Advanced = 3,
	Full = 4
}

export interface IEditorOptions {
	inDiffEditor?: boolean;
	allowVariableLineHeights?: boolean;
	allowVariableFonts?: boolean;
	allowVariableFontsInAccessibilityMode?: boolean;
	ariaLabel?: string;

	ariaRequired?: boolean;
	screenReaderAnnounceInlineSuggestion?: boolean;
	tabIndex?: number;
	rulers?: (number | IRulerOption)[];
	wordSegmenterLocales?: string | string[];
	wordSeparators?: string;
	selectionClipboard?: boolean;
	lineNumbers?: LineNumbersType;
	cursorSurroundingLines?: number;
	cursorSurroundingLinesStyle?: 'default' | 'all';
	renderFinalNewline?: 'on' | 'off' | 'dimmed';
	unusualLineTerminators?: 'auto' | 'off' | 'prompt';
	selectOnLineNumbers?: boolean;
	lineNumbersMinChars?: number;
	glyphMargin?: boolean;
	lineDecorationsWidth?: number | string;
	revealHorizontalRightPadding?: number;
	roundedSelection?: boolean;
	extraEditorClassName?: string;
	readOnly?: boolean;
	readOnlyMessage?: IMarkdownString;
	domReadOnly?: boolean;
	linkedEditing?: boolean;
	renameOnType?: boolean;
	renderValidationDecorations?: 'editable' | 'on' | 'off';
	scrollbar?: IEditorScrollbarOptions;
	stickyScroll?: IEditorStickyScrollOptions;
	minimap?: IEditorMinimapOptions;
	find?: IEditorFindOptions;
	fixedOverflowWidgets?: boolean;
	allowOverflow?: boolean;
	overviewRulerLanes?: number;
	overviewRulerBorder?: boolean;
	cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
	mouseWheelZoom?: boolean;
	mouseStyle?: 'text' | 'default' | 'copy';
	cursorSmoothCaretAnimation?: 'off' | 'explicit' | 'on';
	cursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
	overtypeCursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
	overtypeOnPaste?: boolean;
	cursorWidth?: number;
	cursorHeight?: number;
	fontLigatures?: boolean | string;
	fontVariations?: boolean | string;
	defaultColorDecorators?: 'auto' | 'always' | 'never';
	disableLayerHinting?: boolean;
	disableMonospaceOptimizations?: boolean;
	hideCursorInOverviewRuler?: boolean;
	scrollBeyondLastLine?: boolean;
	scrollOnMiddleClick?: boolean;
	scrollBeyondLastColumn?: number;
	smoothScrolling?: boolean;
	automaticLayout?: boolean;
	wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
	wordWrapIndicator?: boolean;
	wordWrapOverride1?: 'off' | 'on' | 'inherit';
	wordWrapOverride2?: 'off' | 'on' | 'inherit';
	wordWrapColumn?: number;
	wrappingIndent?: 'none' | 'same' | 'indent' | 'deepIndent';
	wrappingStrategy?: 'simple' | 'advanced';
	wrapOnEscapedLineFeeds?: boolean;
	wordWrapBreakBeforeCharacters?: string;
	wordWrapBreakAfterCharacters?: string;
	wordBreak?: 'normal' | 'keepAll';
	stopRenderingLineAfter?: number;
	hover?: IEditorHoverOptions;
	links?: boolean;
	colorDecorators?: boolean;
	colorDecoratorsActivatedOn?: 'clickAndHover' | 'click' | 'hover';
	colorDecoratorsLimit?: number;
	comments?: IEditorCommentsOptions;
	contextmenu?: boolean;
	mouseWheelScrollSensitivity?: number;
	fastScrollSensitivity?: number;
	scrollPredominantAxis?: boolean;
	inertialScroll?: boolean;
	columnSelection?: boolean;
	multiCursorModifier?: 'ctrlCmd' | 'alt';
	multiCursorMergeOverlapping?: boolean;
	multiCursorPaste?: 'spread' | 'full';
	multiCursorLimit?: number;
	mouseMiddleClickAction?: MouseMiddleClickAction;
	accessibilitySupport?: 'auto' | 'off' | 'on';
	accessibilityPageSize?: number;
	suggest?: ISuggestOptions;
	inlineSuggest?: IInlineSuggestOptions;
	smartSelect?: ISmartSelectOptions;
	gotoLocation?: IGotoLocationOptions;
	quickSuggestions?: boolean | QuickSuggestionsValue | IQuickSuggestionsOptions;
	quickSuggestionsDelay?: number;
	padding?: IEditorPaddingOptions;
	parameterHints?: IEditorParameterHintOptions;
	autoClosingBrackets?: EditorAutoClosingStrategy;
	autoClosingComments?: EditorAutoClosingStrategy;
	autoClosingQuotes?: EditorAutoClosingStrategy;
	autoClosingDelete?: EditorAutoClosingEditStrategy;
	autoClosingOvertype?: EditorAutoClosingEditStrategy;
	autoSurround?: EditorAutoSurroundStrategy;
	autoIndent?: 'none' | 'keep' | 'brackets' | 'advanced' | 'full';
	autoIndentOnPaste?: boolean;
	autoIndentOnPasteWithinString?: boolean;
	stickyTabStops?: boolean;
	formatOnType?: boolean;
	formatOnPaste?: boolean;
	doubleClickSelectsBlock?: boolean;
	dragAndDrop?: boolean;
	suggestOnTriggerCharacters?: boolean;
	acceptSuggestionOnEnter?: 'on' | 'smart' | 'off';
	acceptSuggestionOnCommitCharacter?: boolean;
	snippetSuggestions?: 'top' | 'bottom' | 'inline' | 'none';
	emptySelectionClipboard?: boolean;
	copyWithSyntaxHighlighting?: boolean;
	suggestSelection?: 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix';
	suggestFontSize?: number;
	suggestLineHeight?: number;
	tabCompletion?: 'on' | 'off' | 'onlySnippets';
	selectionHighlight?: boolean;
	selectionHighlightMultiline?: boolean;
	selectionHighlightMaxLength?: number;
	occurrencesHighlight?: 'off' | 'singleFile' | 'multiFile';
	occurrencesHighlightDelay?: number;
	codeLens?: boolean;
	codeLensFontFamily?: string;
	codeLensFontSize?: number;
	lightbulb?: IEditorLightbulbOptions;
	codeActionsOnSaveTimeout?: number;
	folding?: boolean;
	foldingStrategy?: 'auto' | 'indentation';
	foldingHighlight?: boolean;
	foldingImportsByDefault?: boolean;
	foldingMaximumRegions?: number;
	showFoldingControls?: 'always' | 'never' | 'mouseover';
	unfoldOnClickAfterEndOfLine?: boolean;
	matchBrackets?: 'never' | 'near' | 'always';
	experimentalGpuAcceleration?: 'on' | 'off';
	experimentalWhitespaceRendering?: 'svg' | 'font' | 'off';
	renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
	renderControlCharacters?: boolean;
	renderLineHighlight?: 'none' | 'gutter' | 'line' | 'all';
	renderLineHighlightOnlyWhenFocus?: boolean;
	useTabStops?: boolean;
	trimWhitespaceOnDelete?: boolean;
	fontFamily?: string;
	fontWeight?: string;
	fontSize?: number;
	lineHeight?: number;
	letterSpacing?: number;
	showUnused?: boolean;
	peekWidgetDefaultFocus?: 'tree' | 'editor';

	placeholder?: string | undefined;

	definitionLinkOpensInPeek?: boolean;
	showDeprecated?: boolean;
	matchOnWordStartOnly?: boolean;
	inlayHints?: IEditorInlayHintsOptions;
	useShadowDOM?: boolean;
	guides?: IGuidesOptions;

	unicodeHighlight?: IUnicodeHighlightOptions;

	bracketPairColorization?: IBracketPairColorizationOptions;

	dropIntoEditor?: IDropIntoEditorOptions;

	editContext?: boolean;

	renderRichScreenReaderContent?: boolean;

	pasteAs?: IPasteAsOptions;

	tabFocusMode?: boolean;

	inlineCompletionsAccessibilityVerbose?: boolean;
}

/**
 * @internal
 * The width of the minimap gutter, in pixels.
 */
export const MINIMAP_GUTTER_WIDTH = 8;

export type DiffEditorViewMode = 'inline' | 'sideBySide' | 'automatic';

export interface IDiffEditorBaseOptions {
	enableSplitViewResizing?: boolean;

	splitViewDefaultRatio?: number;

	renderSideBySide?: boolean;

	renderSideBySideInlineBreakpoint?: number | undefined;

	useInlineViewWhenSpaceIsLimited?: boolean;

	compactMode?: boolean;

	/**
	 * If set, the original editor's line numbers are hidden in the inline view.
	 * Defaults to `false`.
	 * @internal
	*/
	hideOriginalLineNumbers?: boolean;

	maxComputationTime?: number;

	maxFileSize?: number;

	ignoreTrimWhitespace?: boolean;

	renderIndicators?: boolean;

	renderMarginRevertIcon?: boolean;

	renderGutterMenu?: boolean;

	originalEditable?: boolean;

	diffCodeLens?: boolean;

	renderOverviewRuler?: boolean;

	diffWordWrap?: 'off' | 'on' | 'inherit';

	diffAlgorithm?: 'legacy' | 'advanced' | 'advanced-external' | 'advanced-wasm';

	accessibilityVerbose?: boolean;

	experimental?: {
		showMoves?: boolean;

		showEmptyDecorations?: boolean;

		useTrueInlineView?: boolean;
	};

	isInEmbeddedEditor?: boolean;

	onlyShowAccessibleDiffViewer?: boolean;

	hideUnchangedRegions?: {
		enabled?: boolean;
		revealLineCount?: number;
		minimumLineCount?: number;
		contextLineCount?: number;
	};
}

export interface IDiffEditorOptions extends IEditorOptions, IDiffEditorBaseOptions {
}

/**
 * @internal
 */
export type ValidDiffEditorBaseOptions = Readonly<Required<IDiffEditorBaseOptions>>;


export class ConfigurationChangedEvent {
	private readonly _values: boolean[];
	/**
	 * @internal
	 */
	constructor(values: boolean[]) {
		this._values = values;
	}
	public hasChanged(id: EditorOption): boolean {
		return this._values[id];
	}
}

export interface IComputedEditorOptions {
	get<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;
}


/**
 * @internal
 */
export interface IEnvironmentalOptions {
	readonly memory: ComputeOptionsMemory | null;
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly fontInfo: FontInfo;
	readonly extraEditorClassName: string;
	readonly isDominatedByLongLines: boolean;
	readonly viewLineCount: number;
	readonly lineNumbersDigitCount: number;
	readonly emptySelectionClipboard: boolean;
	readonly pixelRatio: number;
	readonly tabFocusMode: boolean;
	readonly inputMode: 'insert' | 'overtype';
	readonly accessibilitySupport: AccessibilitySupport;
	readonly glyphMarginDecorationLaneCount: number;
	readonly editContextSupported: boolean;
}

/**
 * @internal
 */
export class ComputeOptionsMemory {

	public stableMinimapLayoutInput: IMinimapLayoutInput | null;
	public stableFitMaxMinimapScale: number;
	public stableFitRemainingWidth: number;

	constructor() {
		this.stableMinimapLayoutInput = null;
		this.stableFitMaxMinimapScale = 0;
		this.stableFitRemainingWidth = 0;
	}
}

export interface IEditorOption<K extends EditorOption, V> {
	readonly id: K;
	readonly name: string;
	defaultValue: V;
	/**
	 * @internal
	 */
	readonly schema: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema } | undefined;
	/**
	 * @internal
	 */
	validate(input: unknown): V;
	/**
	 * @internal
	 */
	compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V;

	applyUpdate(value: V | undefined, update: V): ApplyUpdateResult<V>;
}

/**
 * @internal
 */
type PossibleKeyName0<V> = { [K in keyof IEditorOptions]: IEditorOptions[K] extends V | undefined ? K : never }[keyof IEditorOptions];
/**
 * @internal
 */
type PossibleKeyName<V> = NonNullable<PossibleKeyName0<V>>;

/**
 * @internal
 */
abstract class BaseEditorOption<K extends EditorOption, T, V> implements IEditorOption<K, V> {

	public readonly id: K;
	public readonly name: string;
	public readonly defaultValue: V;
	public readonly schema: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema } | undefined;

	constructor(id: K, name: PossibleKeyName<T>, defaultValue: V, schema?: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema }) {
		this.id = id;
		this.name = name;
		this.defaultValue = defaultValue;
		this.schema = schema;
	}

	public applyUpdate(value: V | undefined, update: V): ApplyUpdateResult<V> {
		return applyUpdate(value, update);
	}

	public abstract validate(input: unknown): V;

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V {
		return value;
	}
}

export class ApplyUpdateResult<T> {
	constructor(
		public readonly newValue: T,
		public readonly didChange: boolean
	) { }
}

function applyUpdate<T>(value: T | undefined, update: T): ApplyUpdateResult<T> {
	if (typeof value !== 'object' || typeof update !== 'object' || !value || !update) {
		return new ApplyUpdateResult(update, value !== update);
	}
	if (Array.isArray(value) || Array.isArray(update)) {
		const arrayEquals = Array.isArray(value) && Array.isArray(update) && arrays.equals(value, update);
		return new ApplyUpdateResult(update, !arrayEquals);
	}
	let didChange = false;
	for (const key in update) {
		if (update.hasOwnProperty(key)) {
			const result = applyUpdate(value[key], update[key]);
			if (result.didChange) {
				value[key] = result.newValue;
				didChange = true;
			}
		}
	}
	return new ApplyUpdateResult(value, didChange);
}

/**
 * @internal
 */
abstract class ComputedEditorOption<K extends EditorOption, V> implements IEditorOption<K, V> {

	public readonly id: K;
	public readonly name: '_never_';
	public readonly defaultValue: V;
	public readonly schema: IConfigurationPropertySchema | undefined = undefined;

	constructor(id: K, defaultValue: V) {
		this.id = id;
		this.name = '_never_';
		this.defaultValue = defaultValue;
	}

	public applyUpdate(value: V | undefined, update: V): ApplyUpdateResult<V> {
		return applyUpdate(value, update);
	}

	public validate(input: unknown): V {
		return this.defaultValue;
	}

	public abstract compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V;
}

abstract class SimpleEditorOption<K extends EditorOption, V> implements IEditorOption<K, V> {

	public readonly id: K;
	public readonly name: PossibleKeyName<V>;
	public readonly defaultValue: V;
	public readonly schema: IConfigurationPropertySchema | undefined;

	constructor(id: K, name: PossibleKeyName<V>, defaultValue: V, schema?: IConfigurationPropertySchema) {
		this.id = id;
		this.name = name;
		this.defaultValue = defaultValue;
		this.schema = schema;
	}

	public applyUpdate(value: V | undefined, update: V): ApplyUpdateResult<V> {
		return applyUpdate(value, update);
	}

	public abstract validate(input: unknown): V;

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V {
		return value;
	}
}

/**
 * @internal
 */
export function boolean(value: unknown, defaultValue: boolean): boolean {
	if (typeof value === 'undefined') {
		return defaultValue;
	}
	if (value === 'false') {
		return false;
	}
	return Boolean(value);
}

class EditorBooleanOption<K extends EditorOption> extends SimpleEditorOption<K, boolean> {

	constructor(id: K, name: PossibleKeyName<boolean>, defaultValue: boolean, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'boolean';
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
	}

	public override validate(input: unknown): boolean {
		return boolean(input, this.defaultValue);
	}
}

/**
 * @internal
 */
export function clampedInt<T = number>(value: unknown, defaultValue: T, minimum: number, maximum: number): number | T {
	if (typeof value === 'string') {
		value = parseInt(value, 10);
	}
	if (typeof value !== 'number' || isNaN(value)) {
		return defaultValue;
	}
	let r = value;
	r = Math.max(minimum, r);
	r = Math.min(maximum, r);
	return r | 0;
}

class EditorIntOption<K extends EditorOption> extends SimpleEditorOption<K, number> {

	public static clampedInt<T>(value: unknown, defaultValue: T, minimum: number, maximum: number): number | T {
		return clampedInt(value, defaultValue, minimum, maximum);
	}

	public readonly minimum: number;
	public readonly maximum: number;

	constructor(id: K, name: PossibleKeyName<number>, defaultValue: number, minimum: number, maximum: number, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'integer';
			schema.default = defaultValue;
			schema.minimum = minimum;
			schema.maximum = maximum;
		}
		super(id, name, defaultValue, schema);
		this.minimum = minimum;
		this.maximum = maximum;
	}

	public override validate(input: unknown): number {
		return EditorIntOption.clampedInt(input, this.defaultValue, this.minimum, this.maximum);
	}
}
/**
 * @internal
 */
export function clampedFloat<T extends number>(value: unknown, defaultValue: T, minimum: number, maximum: number): number | T {
	if (typeof value === 'undefined') {
		return defaultValue;
	}
	const r = EditorFloatOption.float(value, defaultValue);
	return EditorFloatOption.clamp(r, minimum, maximum);
}

class EditorFloatOption<K extends EditorOption> extends SimpleEditorOption<K, number> {

	public readonly minimum: number | undefined;
	public readonly maximum: number | undefined;

	public static clamp(n: number, min: number, max: number): number {
		if (n < min) {
			return min;
		}
		if (n > max) {
			return max;
		}
		return n;
	}

	public static float(value: unknown, defaultValue: number): number {
		if (typeof value === 'string') {
			value = parseFloat(value);
		}
		if (typeof value !== 'number' || isNaN(value)) {
			return defaultValue;
		}
		return value;
	}

	public readonly validationFn: (value: number) => number;

	constructor(id: K, name: PossibleKeyName<number>, defaultValue: number, validationFn: (value: number) => number, schema?: IConfigurationPropertySchema, minimum?: number, maximum?: number) {
		if (typeof schema !== 'undefined') {
			schema.type = 'number';
			schema.default = defaultValue;
			schema.minimum = minimum;
			schema.maximum = maximum;
		}
		super(id, name, defaultValue, schema);
		this.validationFn = validationFn;
		this.minimum = minimum;
		this.maximum = maximum;
	}

	public override validate(input: unknown): number {
		return this.validationFn(EditorFloatOption.float(input, this.defaultValue));
	}
}

class EditorStringOption<K extends EditorOption> extends SimpleEditorOption<K, string> {

	public static string(value: unknown, defaultValue: string): string {
		if (typeof value !== 'string') {
			return defaultValue;
		}
		return value;
	}

	constructor(id: K, name: PossibleKeyName<string>, defaultValue: string, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'string';
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
	}

	public override validate(input: unknown): string {
		return EditorStringOption.string(input, this.defaultValue);
	}
}

/**
 * @internal
 */
export function stringSet<T extends string>(value: unknown, defaultValue: T, allowedValues: ReadonlyArray<T>, renamedValues?: Record<string, T>): T {
	if (typeof value !== 'string') {
		return defaultValue;
	}
	if (renamedValues && value in renamedValues) {
		return renamedValues[value];
	}
	if (allowedValues.indexOf(value as T) === -1) {
		return defaultValue;
	}
	return value as T;
}

class EditorStringEnumOption<K extends EditorOption, V extends string> extends SimpleEditorOption<K, V> {

	private readonly _allowedValues: ReadonlyArray<V>;

	constructor(id: K, name: PossibleKeyName<V>, defaultValue: V, allowedValues: ReadonlyArray<V>, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'string';
			schema.enum = allowedValues.slice(0);
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
		this._allowedValues = allowedValues;
	}

	public override validate(input: unknown): V {
		return stringSet<V>(input, this.defaultValue, this._allowedValues);
	}
}

class EditorEnumOption<K extends EditorOption, T extends string, V> extends BaseEditorOption<K, T, V> {

	private readonly _allowedValues: T[];
	private readonly _convert: (value: T) => V;

	constructor(id: K, name: PossibleKeyName<T>, defaultValue: V, defaultStringValue: string, allowedValues: T[], convert: (value: T) => V, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'string';
			schema.enum = allowedValues;
			schema.default = defaultStringValue;
		}
		super(id, name, defaultValue, schema);
		this._allowedValues = allowedValues;
		this._convert = convert;
	}

	public validate(input: unknown): V {
		if (typeof input !== 'string') {
			return this.defaultValue;
		}
		if (this._allowedValues.indexOf(<T>input) === -1) {
			return this.defaultValue;
		}
		return this._convert(<T>input);
	}
}



function _autoIndentFromString(autoIndent: 'none' | 'keep' | 'brackets' | 'advanced' | 'full'): EditorAutoIndentStrategy {
	switch (autoIndent) {
		case 'none': return EditorAutoIndentStrategy.None;
		case 'keep': return EditorAutoIndentStrategy.Keep;
		case 'brackets': return EditorAutoIndentStrategy.Brackets;
		case 'advanced': return EditorAutoIndentStrategy.Advanced;
		case 'full': return EditorAutoIndentStrategy.Full;
	}
}



class EditorAccessibilitySupport extends BaseEditorOption<EditorOption.accessibilitySupport, 'auto' | 'off' | 'on', AccessibilitySupport> {

	constructor() {
		super(
			EditorOption.accessibilitySupport, 'accessibilitySupport', AccessibilitySupport.Unknown,
			{
				type: 'string',
				enum: ['auto', 'on', 'off'],
				enumDescriptions: [
					nls.localize('accessibilitySupport.auto', "Use platform APIs to detect when a Screen Reader is attached."),
					nls.localize('accessibilitySupport.on', "Optimize for usage with a Screen Reader."),
					nls.localize('accessibilitySupport.off', "Assume a screen reader is not attached."),
				],
				default: 'auto',
				tags: ['accessibility'],
				description: nls.localize('accessibilitySupport', "Controls if the UI should run in a mode where it is optimized for screen readers.")
			}
		);
	}

	public validate(input: unknown): AccessibilitySupport {
		switch (input) {
			case 'auto': return AccessibilitySupport.Unknown;
			case 'off': return AccessibilitySupport.Disabled;
			case 'on': return AccessibilitySupport.Enabled;
		}
		return this.defaultValue;
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: AccessibilitySupport): AccessibilitySupport {
		if (value === AccessibilitySupport.Unknown) {
			return env.accessibilitySupport;
		}
		return value;
	}
}



export interface IEditorCommentsOptions {
	insertSpace?: boolean;
	ignoreEmptyLines?: boolean;
}

/**
 * @internal
 */
export type EditorCommentsOptions = Readonly<Required<IEditorCommentsOptions>>;

class EditorComments extends BaseEditorOption<EditorOption.comments, IEditorCommentsOptions, EditorCommentsOptions> {

	constructor() {
		const defaults: EditorCommentsOptions = {
			insertSpace: true,
			ignoreEmptyLines: true,
		};
		super(
			EditorOption.comments, 'comments', defaults,
			{
				'editor.comments.insertSpace': {
					type: 'boolean',
					default: defaults.insertSpace,
					description: nls.localize('comments.insertSpace', "Controls whether a space character is inserted when commenting.")
				},
				'editor.comments.ignoreEmptyLines': {
					type: 'boolean',
					default: defaults.ignoreEmptyLines,
					description: nls.localize('comments.ignoreEmptyLines', 'Controls if empty lines should be ignored with toggle, add or remove actions for line comments.')
				},
			}
		);
	}

	public validate(_input: unknown): EditorCommentsOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorCommentsOptions>;
		return {
			insertSpace: boolean(input.insertSpace, this.defaultValue.insertSpace),
			ignoreEmptyLines: boolean(input.ignoreEmptyLines, this.defaultValue.ignoreEmptyLines),
		};
	}
}



export const enum TextEditorCursorBlinkingStyle {
	Hidden = 0,
	Blink = 1,
	Smooth = 2,
	Phase = 3,
	Expand = 4,
	Solid = 5
}

/**
 * @internal
 */
export function cursorBlinkingStyleFromString(cursorBlinkingStyle: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'): TextEditorCursorBlinkingStyle {
	switch (cursorBlinkingStyle) {
		case 'blink': return TextEditorCursorBlinkingStyle.Blink;
		case 'smooth': return TextEditorCursorBlinkingStyle.Smooth;
		case 'phase': return TextEditorCursorBlinkingStyle.Phase;
		case 'expand': return TextEditorCursorBlinkingStyle.Expand;
		case 'solid': return TextEditorCursorBlinkingStyle.Solid;
	}
}



export enum TextEditorCursorStyle {
	Line = 1,
	Block = 2,
	Underline = 3,
	LineThin = 4,
	BlockOutline = 5,
	UnderlineThin = 6
}

/**
 * @internal
 */
export function cursorStyleToString(cursorStyle: TextEditorCursorStyle): 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin' {
	switch (cursorStyle) {
		case TextEditorCursorStyle.Line: return 'line';
		case TextEditorCursorStyle.Block: return 'block';
		case TextEditorCursorStyle.Underline: return 'underline';
		case TextEditorCursorStyle.LineThin: return 'line-thin';
		case TextEditorCursorStyle.BlockOutline: return 'block-outline';
		case TextEditorCursorStyle.UnderlineThin: return 'underline-thin';
	}
}

/**
 * @internal
 */
export function cursorStyleFromString(cursorStyle: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'): TextEditorCursorStyle {
	switch (cursorStyle) {
		case 'line': return TextEditorCursorStyle.Line;
		case 'block': return TextEditorCursorStyle.Block;
		case 'underline': return TextEditorCursorStyle.Underline;
		case 'line-thin': return TextEditorCursorStyle.LineThin;
		case 'block-outline': return TextEditorCursorStyle.BlockOutline;
		case 'underline-thin': return TextEditorCursorStyle.UnderlineThin;
	}
}



class EditorClassName extends ComputedEditorOption<EditorOption.editorClassName, string> {

	constructor() {
		super(EditorOption.editorClassName, '');
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: string): string {
		const classNames = ['monaco-editor'];
		if (options.get(EditorOption.extraEditorClassName)) {
			classNames.push(options.get(EditorOption.extraEditorClassName));
		}
		if (env.extraEditorClassName) {
			classNames.push(env.extraEditorClassName);
		}
		if (options.get(EditorOption.mouseStyle) === 'default') {
			classNames.push('mouse-default');
		} else if (options.get(EditorOption.mouseStyle) === 'copy') {
			classNames.push('mouse-copy');
		}

		if (options.get(EditorOption.showUnused)) {
			classNames.push('showUnused');
		}

		if (options.get(EditorOption.showDeprecated)) {
			classNames.push('showDeprecated');
		}

		return classNames.join(' ');
	}
}



class EditorEmptySelectionClipboard extends EditorBooleanOption<EditorOption.emptySelectionClipboard> {

	constructor() {
		super(
			EditorOption.emptySelectionClipboard, 'emptySelectionClipboard', true,
			{ description: nls.localize('emptySelectionClipboard', "Controls whether copying without a selection copies the current line.") }
		);
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: boolean): boolean {
		return value && env.emptySelectionClipboard;
	}
}



export interface IEditorFindOptions {
	cursorMoveOnType?: boolean;
	findOnType?: boolean;
	seedSearchStringFromSelection?: 'never' | 'always' | 'selection';
	autoFindInSelection?: 'never' | 'always' | 'multiline';
	addExtraSpaceOnTop?: boolean;
	/**
	 * @internal
	 * Controls if the Find Widget should read or modify the shared find clipboard on macOS
	 */
	globalFindClipboard?: boolean;
	loop?: boolean;
	closeOnResult?: boolean;
	/**
	 * @internal
	 * Controls how the find widget search history should be stored
	 */
	history?: 'never' | 'workspace';
	/**
	 * @internal
	 * Controls how the replace widget search history should be stored
	 */
	replaceHistory?: 'never' | 'workspace';
}

/**
 * @internal
 */
export type EditorFindOptions = Readonly<Required<IEditorFindOptions>>;

class EditorFind extends BaseEditorOption<EditorOption.find, IEditorFindOptions, EditorFindOptions> {

	constructor() {
		const defaults: EditorFindOptions = {
			cursorMoveOnType: true,
			findOnType: true,
			seedSearchStringFromSelection: 'always',
			autoFindInSelection: 'never',
			globalFindClipboard: false,
			addExtraSpaceOnTop: true,
			loop: true,
			closeOnResult: false,
			history: 'workspace',
			replaceHistory: 'workspace',
		};
		super(
			EditorOption.find, 'find', defaults,
			{
				'editor.find.cursorMoveOnType': {
					type: 'boolean',
					default: defaults.cursorMoveOnType,
					description: nls.localize('find.cursorMoveOnType', "Controls whether the cursor should jump to find matches while typing.")
				},
				'editor.find.seedSearchStringFromSelection': {
					type: 'string',
					enum: ['never', 'always', 'selection'],
					default: defaults.seedSearchStringFromSelection,
					enumDescriptions: [
						nls.localize('editor.find.seedSearchStringFromSelection.never', 'Never seed search string from the editor selection.'),
						nls.localize('editor.find.seedSearchStringFromSelection.always', 'Always seed search string from the editor selection, including word at cursor position.'),
						nls.localize('editor.find.seedSearchStringFromSelection.selection', 'Only seed search string from the editor selection.')
					],
					description: nls.localize('find.seedSearchStringFromSelection', "Controls whether the search string in the Find Widget is seeded from the editor selection.")
				},
				'editor.find.autoFindInSelection': {
					type: 'string',
					enum: ['never', 'always', 'multiline'],
					default: defaults.autoFindInSelection,
					enumDescriptions: [
						nls.localize('editor.find.autoFindInSelection.never', 'Never turn on Find in Selection automatically (default).'),
						nls.localize('editor.find.autoFindInSelection.always', 'Always turn on Find in Selection automatically.'),
						nls.localize('editor.find.autoFindInSelection.multiline', 'Turn on Find in Selection automatically when multiple lines of content are selected.')
					],
					description: nls.localize('find.autoFindInSelection', "Controls the condition for turning on Find in Selection automatically.")
				},
				'editor.find.globalFindClipboard': {
					type: 'boolean',
					default: defaults.globalFindClipboard,
					description: nls.localize('find.globalFindClipboard', "Controls whether the Find Widget should read or modify the shared find clipboard on macOS."),
					included: platform.isMacintosh
				},
				'editor.find.addExtraSpaceOnTop': {
					type: 'boolean',
					default: defaults.addExtraSpaceOnTop,
					description: nls.localize('find.addExtraSpaceOnTop', "Controls whether the Find Widget should add extra lines on top of the editor. When true, you can scroll beyond the first line when the Find Widget is visible.")
				},
				'editor.find.loop': {
					type: 'boolean',
					default: defaults.loop,
					description: nls.localize('find.loop', "Controls whether the search automatically restarts from the beginning (or the end) when no further matches can be found.")
				},
				'editor.find.closeOnResult': {
					type: 'boolean',
					default: defaults.closeOnResult,
					description: nls.localize('find.closeOnResult', "Controls whether the Find Widget closes after an explicit find navigation command lands on a result.")
				},
				'editor.find.history': {
					type: 'string',
					enum: ['never', 'workspace'],
					default: 'workspace',
					enumDescriptions: [
						nls.localize('editor.find.history.never', 'Do not store search history from the find widget.'),
						nls.localize('editor.find.history.workspace', 'Store search history across the active workspace'),
					],
					description: nls.localize('find.history', "Controls how the find widget history should be stored")
				},
				'editor.find.replaceHistory': {
					type: 'string',
					enum: ['never', 'workspace'],
					default: 'workspace',
					enumDescriptions: [
						nls.localize('editor.find.replaceHistory.never', 'Do not store history from the replace widget.'),
						nls.localize('editor.find.replaceHistory.workspace', 'Store replace history across the active workspace'),
					],
					description: nls.localize('find.replaceHistory', "Controls how the replace widget history should be stored")
				},
				'editor.find.findOnType': {
					type: 'boolean',
					default: defaults.findOnType,
					description: nls.localize('find.findOnType', "Controls whether the Find Widget should search as you type.")
				},
			}
		);
	}

	public validate(_input: unknown): EditorFindOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorFindOptions>;
		return {
			cursorMoveOnType: boolean(input.cursorMoveOnType, this.defaultValue.cursorMoveOnType),
			findOnType: boolean(input.findOnType, this.defaultValue.findOnType),
			seedSearchStringFromSelection: typeof input.seedSearchStringFromSelection === 'boolean'
				? (input.seedSearchStringFromSelection ? 'always' : 'never')
				: stringSet<'never' | 'always' | 'selection'>(input.seedSearchStringFromSelection, this.defaultValue.seedSearchStringFromSelection, ['never', 'always', 'selection']),
			autoFindInSelection: typeof input.autoFindInSelection === 'boolean'
				? (input.autoFindInSelection ? 'always' : 'never')
				: stringSet<'never' | 'always' | 'multiline'>(input.autoFindInSelection, this.defaultValue.autoFindInSelection, ['never', 'always', 'multiline']),
			globalFindClipboard: boolean(input.globalFindClipboard, this.defaultValue.globalFindClipboard),
			addExtraSpaceOnTop: boolean(input.addExtraSpaceOnTop, this.defaultValue.addExtraSpaceOnTop),
			loop: boolean(input.loop, this.defaultValue.loop),
			closeOnResult: boolean(input.closeOnResult, this.defaultValue.closeOnResult),
			history: stringSet<'never' | 'workspace'>(input.history, this.defaultValue.history, ['never', 'workspace']),
			replaceHistory: stringSet<'never' | 'workspace'>(input.replaceHistory, this.defaultValue.replaceHistory, ['never', 'workspace']),
		};
	}
}



/**
 * @internal
 */
export class EditorFontLigatures extends BaseEditorOption<EditorOption.fontLigatures, boolean | string, string> {

	public static OFF = '"liga" off, "calt" off';
	public static ON = '"liga" on, "calt" on';

	constructor() {
		super(
			EditorOption.fontLigatures, 'fontLigatures', EditorFontLigatures.OFF,
			{
				anyOf: [
					{
						type: 'boolean',
						description: nls.localize('fontLigatures', "Enables/Disables font ligatures ('calt' and 'liga' font features). Change this to a string for fine-grained control of the 'font-feature-settings' CSS property."),
					},
					{
						type: 'string',
						description: nls.localize('fontFeatureSettings', "Explicit 'font-feature-settings' CSS property. A boolean can be passed instead if one only needs to turn on/off ligatures.")
					}
				],
				description: nls.localize('fontLigaturesGeneral', "Configures font ligatures or font features. Can be either a boolean to enable/disable ligatures or a string for the value of the CSS 'font-feature-settings' property."),
				default: false
			}
		);
	}

	public validate(input: unknown): string {
		if (typeof input === 'undefined') {
			return this.defaultValue;
		}
		if (typeof input === 'string') {
			if (input === 'false' || input.length === 0) {
				return EditorFontLigatures.OFF;
			}
			if (input === 'true') {
				return EditorFontLigatures.ON;
			}
			return input;
		}
		if (Boolean(input)) {
			return EditorFontLigatures.ON;
		}
		return EditorFontLigatures.OFF;
	}
}



/**
 * @internal
 */
export class EditorFontVariations extends BaseEditorOption<EditorOption.fontVariations, boolean | string, string> {
	public static OFF = FONT_VARIATION_OFF;

	public static TRANSLATE = FONT_VARIATION_TRANSLATE;

	constructor() {
		super(
			EditorOption.fontVariations, 'fontVariations', EditorFontVariations.OFF,
			{
				anyOf: [
					{
						type: 'boolean',
						description: nls.localize('fontVariations', "Enables/Disables the translation from font-weight to font-variation-settings. Change this to a string for fine-grained control of the 'font-variation-settings' CSS property."),
					},
					{
						type: 'string',
						description: nls.localize('fontVariationSettings', "Explicit 'font-variation-settings' CSS property. A boolean can be passed instead if one only needs to translate font-weight to font-variation-settings.")
					}
				],
				description: nls.localize('fontVariationsGeneral', "Configures font variations. Can be either a boolean to enable/disable the translation from font-weight to font-variation-settings or a string for the value of the CSS 'font-variation-settings' property."),
				default: false
			}
		);
	}

	public validate(input: unknown): string {
		if (typeof input === 'undefined') {
			return this.defaultValue;
		}
		if (typeof input === 'string') {
			if (input === 'false') {
				return EditorFontVariations.OFF;
			}
			if (input === 'true') {
				return EditorFontVariations.TRANSLATE;
			}
			return input;
		}
		if (Boolean(input)) {
			return EditorFontVariations.TRANSLATE;
		}
		return EditorFontVariations.OFF;
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: string): string {
		return env.fontInfo.fontVariationSettings;
	}
}



class EditorFontInfo extends ComputedEditorOption<EditorOption.fontInfo, FontInfo> {

	constructor() {
		super(EditorOption.fontInfo, new FontInfo({
			pixelRatio: 0,
			fontFamily: '',
			fontWeight: '',
			fontSize: 0,
			fontFeatureSettings: '',
			fontVariationSettings: '',
			lineHeight: 0,
			letterSpacing: 0,
			isMonospace: false,
			typicalHalfwidthCharacterWidth: 0,
			typicalFullwidthCharacterWidth: 0,
			canUseHalfwidthRightwardsArrow: false,
			spaceWidth: 0,
			middotWidth: 0,
			wsmiddotWidth: 0,
			maxDigitWidth: 0,
		}, false));
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: FontInfo): FontInfo {
		return env.fontInfo;
	}
}



class EffectiveCursorStyle extends ComputedEditorOption<EditorOption.effectiveCursorStyle, TextEditorCursorStyle> {

	constructor() {
		super(EditorOption.effectiveCursorStyle, TextEditorCursorStyle.Line);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: TextEditorCursorStyle): TextEditorCursorStyle {
		return env.inputMode === 'overtype' ?
			options.get(EditorOption.overtypeCursorStyle) :
			options.get(EditorOption.cursorStyle);
	}
}



class EffectiveEditContextEnabled extends ComputedEditorOption<EditorOption.effectiveEditContext, boolean> {

	constructor() {
		super(EditorOption.effectiveEditContext, false);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions): boolean {
		return env.editContextSupported && options.get(EditorOption.editContext);
	}
}



class EffectiveAllowVariableFonts extends ComputedEditorOption<EditorOption.effectiveAllowVariableFonts, boolean> {

	constructor() {
		super(EditorOption.effectiveAllowVariableFonts, false);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions): boolean {
		const accessibilitySupport = env.accessibilitySupport;
		if (accessibilitySupport === AccessibilitySupport.Enabled) {
			return options.get(EditorOption.allowVariableFontsInAccessibilityMode);
		} else {
			return options.get(EditorOption.allowVariableFonts);
		}
	}
}



class EditorFontSize extends SimpleEditorOption<EditorOption.fontSize, number> {

	constructor() {
		super(
			EditorOption.fontSize, 'fontSize', EDITOR_FONT_DEFAULTS.fontSize,
			{
				type: 'number',
				minimum: 6,
				maximum: 100,
				default: EDITOR_FONT_DEFAULTS.fontSize,
				description: nls.localize('fontSize', "Controls the font size in pixels.")
			}
		);
	}

	public override validate(input: unknown): number {
		const r = EditorFloatOption.float(input, this.defaultValue);
		if (r === 0) {
			return EDITOR_FONT_DEFAULTS.fontSize;
		}
		return EditorFloatOption.clamp(r, 6, 100);
	}
	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: number): number {
		return env.fontInfo.fontSize;
	}
}



class EditorFontWeight extends BaseEditorOption<EditorOption.fontWeight, string, string> {
	private static SUGGESTION_VALUES = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
	private static MINIMUM_VALUE = 1;
	private static MAXIMUM_VALUE = 1000;

	constructor() {
		super(
			EditorOption.fontWeight, 'fontWeight', EDITOR_FONT_DEFAULTS.fontWeight,
			{
				anyOf: [
					{
						type: 'number',
						minimum: EditorFontWeight.MINIMUM_VALUE,
						maximum: EditorFontWeight.MAXIMUM_VALUE,
						errorMessage: nls.localize('fontWeightErrorMessage', "Only \"normal\" and \"bold\" keywords or numbers between 1 and 1000 are allowed.")
					},
					{
						type: 'string',
						pattern: '^(normal|bold|1000|[1-9][0-9]{0,2})$'
					},
					{
						enum: EditorFontWeight.SUGGESTION_VALUES
					}
				],
				default: EDITOR_FONT_DEFAULTS.fontWeight,
				description: nls.localize('fontWeight', "Controls the font weight. Accepts \"normal\" and \"bold\" keywords or numbers between 1 and 1000.")
			}
		);
	}

	public validate(input: unknown): string {
		if (input === 'normal' || input === 'bold') {
			return input;
		}
		return String(EditorIntOption.clampedInt(input, EDITOR_FONT_DEFAULTS.fontWeight, EditorFontWeight.MINIMUM_VALUE, EditorFontWeight.MAXIMUM_VALUE));
	}
}



export type GoToLocationValues = 'peek' | 'gotoAndPeek' | 'goto';

export interface IGotoLocationOptions {

	multiple?: GoToLocationValues;

	multipleDefinitions?: GoToLocationValues;
	multipleTypeDefinitions?: GoToLocationValues;
	multipleDeclarations?: GoToLocationValues;
	multipleImplementations?: GoToLocationValues;
	multipleReferences?: GoToLocationValues;
	multipleTests?: GoToLocationValues;

	alternativeDefinitionCommand?: string;
	alternativeTypeDefinitionCommand?: string;
	alternativeDeclarationCommand?: string;
	alternativeImplementationCommand?: string;
	alternativeReferenceCommand?: string;
	alternativeTestsCommand?: string;
}

/**
 * @internal
 */
export type GoToLocationOptions = Readonly<Required<IGotoLocationOptions>>;

class EditorGoToLocation extends BaseEditorOption<EditorOption.gotoLocation, IGotoLocationOptions, GoToLocationOptions> {

	constructor() {
		const defaults: GoToLocationOptions = {
			multiple: 'peek',
			multipleDefinitions: 'peek',
			multipleTypeDefinitions: 'peek',
			multipleDeclarations: 'peek',
			multipleImplementations: 'peek',
			multipleReferences: 'peek',
			multipleTests: 'peek',
			alternativeDefinitionCommand: 'editor.action.goToReferences',
			alternativeTypeDefinitionCommand: 'editor.action.goToReferences',
			alternativeDeclarationCommand: 'editor.action.goToReferences',
			alternativeImplementationCommand: '',
			alternativeReferenceCommand: '',
			alternativeTestsCommand: '',
		};
		const jsonSubset: IJSONSchema = {
			type: 'string',
			enum: ['peek', 'gotoAndPeek', 'goto'],
			default: defaults.multiple,
			enumDescriptions: [
				nls.localize('editor.gotoLocation.multiple.peek', 'Show Peek view of the results (default)'),
				nls.localize('editor.gotoLocation.multiple.gotoAndPeek', 'Go to the primary result and show a Peek view'),
				nls.localize('editor.gotoLocation.multiple.goto', 'Go to the primary result and enable Peek-less navigation to others')
			]
		};
		const alternativeCommandOptions = ['', 'editor.action.referenceSearch.trigger', 'editor.action.goToReferences', 'editor.action.peekImplementation', 'editor.action.goToImplementation', 'editor.action.peekTypeDefinition', 'editor.action.goToTypeDefinition', 'editor.action.peekDeclaration', 'editor.action.revealDeclaration', 'editor.action.peekDefinition', 'editor.action.revealDefinitionAside', 'editor.action.revealDefinition'];
		super(
			EditorOption.gotoLocation, 'gotoLocation', defaults,
			{
				'editor.gotoLocation.multiple': {
					deprecationMessage: nls.localize('editor.gotoLocation.multiple.deprecated', "This setting is deprecated, please use separate settings like 'editor.editor.gotoLocation.multipleDefinitions' or 'editor.editor.gotoLocation.multipleImplementations' instead."),
				},
				'editor.gotoLocation.multipleDefinitions': {
					description: nls.localize('editor.editor.gotoLocation.multipleDefinitions', "Controls the behavior the 'Go to Definition'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleTypeDefinitions': {
					description: nls.localize('editor.editor.gotoLocation.multipleTypeDefinitions', "Controls the behavior the 'Go to Type Definition'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleDeclarations': {
					description: nls.localize('editor.editor.gotoLocation.multipleDeclarations', "Controls the behavior the 'Go to Declaration'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleImplementations': {
					description: nls.localize('editor.editor.gotoLocation.multipleImplemenattions', "Controls the behavior the 'Go to Implementations'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleReferences': {
					description: nls.localize('editor.editor.gotoLocation.multipleReferences', "Controls the behavior the 'Go to References'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.alternativeDefinitionCommand': {
					type: 'string',
					default: defaults.alternativeDefinitionCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeDefinitionCommand', "Alternative command id that is being executed when the result of 'Go to Definition' is the current location.")
				},
				'editor.gotoLocation.alternativeTypeDefinitionCommand': {
					type: 'string',
					default: defaults.alternativeTypeDefinitionCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeTypeDefinitionCommand', "Alternative command id that is being executed when the result of 'Go to Type Definition' is the current location.")
				},
				'editor.gotoLocation.alternativeDeclarationCommand': {
					type: 'string',
					default: defaults.alternativeDeclarationCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeDeclarationCommand', "Alternative command id that is being executed when the result of 'Go to Declaration' is the current location.")
				},
				'editor.gotoLocation.alternativeImplementationCommand': {
					type: 'string',
					default: defaults.alternativeImplementationCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeImplementationCommand', "Alternative command id that is being executed when the result of 'Go to Implementation' is the current location.")
				},
				'editor.gotoLocation.alternativeReferenceCommand': {
					type: 'string',
					default: defaults.alternativeReferenceCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeReferenceCommand', "Alternative command id that is being executed when the result of 'Go to Reference' is the current location.")
				},
			}
		);
	}

	public validate(_input: unknown): GoToLocationOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IGotoLocationOptions>;
		return {
			multiple: stringSet<GoToLocationValues>(input.multiple, this.defaultValue.multiple, ['peek', 'gotoAndPeek', 'goto']),
			multipleDefinitions: stringSet<GoToLocationValues>(input.multipleDefinitions, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleTypeDefinitions: stringSet<GoToLocationValues>(input.multipleTypeDefinitions, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleDeclarations: stringSet<GoToLocationValues>(input.multipleDeclarations, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleImplementations: stringSet<GoToLocationValues>(input.multipleImplementations, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleReferences: stringSet<GoToLocationValues>(input.multipleReferences, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleTests: stringSet<GoToLocationValues>(input.multipleTests, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			alternativeDefinitionCommand: EditorStringOption.string(input.alternativeDefinitionCommand, this.defaultValue.alternativeDefinitionCommand),
			alternativeTypeDefinitionCommand: EditorStringOption.string(input.alternativeTypeDefinitionCommand, this.defaultValue.alternativeTypeDefinitionCommand),
			alternativeDeclarationCommand: EditorStringOption.string(input.alternativeDeclarationCommand, this.defaultValue.alternativeDeclarationCommand),
			alternativeImplementationCommand: EditorStringOption.string(input.alternativeImplementationCommand, this.defaultValue.alternativeImplementationCommand),
			alternativeReferenceCommand: EditorStringOption.string(input.alternativeReferenceCommand, this.defaultValue.alternativeReferenceCommand),
			alternativeTestsCommand: EditorStringOption.string(input.alternativeTestsCommand, this.defaultValue.alternativeTestsCommand),
		};
	}
}



export interface IEditorHoverOptions {
	enabled?: 'on' | 'off' | 'onKeyboardModifier';
	delay?: number;
	sticky?: boolean;
	hidingDelay?: number;
	above?: boolean;
	showLongLineWarning?: boolean;
}

/**
 * @internal
 */
export type EditorHoverOptions = Readonly<Required<IEditorHoverOptions>>;

class EditorHover extends BaseEditorOption<EditorOption.hover, IEditorHoverOptions, EditorHoverOptions> {

	constructor() {
		const defaults: EditorHoverOptions = {
			enabled: 'on',
			delay: 300,
			hidingDelay: 300,
			sticky: true,
			above: true,
			showLongLineWarning: true,
		};
		super(
			EditorOption.hover, 'hover', defaults,
			{
				'editor.hover.enabled': {
					type: 'string',
					enum: ['on', 'off', 'onKeyboardModifier'],
					default: defaults.enabled,
					markdownEnumDescriptions: [
						nls.localize('hover.enabled.on', "Hover is enabled."),
						nls.localize('hover.enabled.off', "Hover is disabled."),
						nls.localize('hover.enabled.onKeyboardModifier', "Hover is shown when holding `{0}` or `Alt` (the opposite modifier of `#editor.multiCursorModifier#`)", platform.isMacintosh ? `Command` : `Control`)
					],
					description: nls.localize('hover.enabled', "Controls whether the hover is shown."),
					keywords: ['hint', 'info', 'tooltip']
				},
				'editor.hover.delay': {
					type: 'number',
					default: defaults.delay,
					minimum: 0,
					maximum: 10000,
					description: nls.localize('hover.delay', "Controls the delay in milliseconds after which the hover is shown.")
				},
				'editor.hover.sticky': {
					type: 'boolean',
					default: defaults.sticky,
					description: nls.localize('hover.sticky', "Controls whether the hover should remain visible when mouse is moved over it.")
				},
				'editor.hover.hidingDelay': {
					type: 'integer',
					minimum: 0,
					default: defaults.hidingDelay,
					markdownDescription: nls.localize('hover.hidingDelay', "Controls the delay in milliseconds after which the hover is hidden. Requires `#editor.hover.sticky#` to be enabled.")
				},
				'editor.hover.above': {
					type: 'boolean',
					default: defaults.above,
					description: nls.localize('hover.above', "Prefer showing hovers above the line, if there's space.")
				},
				'editor.hover.showLongLineWarning': {
					type: 'boolean',
					default: defaults.showLongLineWarning,
					description: nls.localize('hover.showLongLineWarning', "Controls whether long line warning hovers are shown, such as when tokenization is skipped or rendering is paused.")
				},
			}
		);
	}

	public validate(_input: unknown): EditorHoverOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorHoverOptions>;
		return {
			enabled: stringSet<'on' | 'off' | 'onKeyboardModifier'>(input.enabled, this.defaultValue.enabled, ['on', 'off', 'onKeyboardModifier']),
			delay: EditorIntOption.clampedInt(input.delay, this.defaultValue.delay, 0, 10000),
			sticky: boolean(input.sticky, this.defaultValue.sticky),
			hidingDelay: EditorIntOption.clampedInt(input.hidingDelay, this.defaultValue.hidingDelay, 0, 600000),
			above: boolean(input.above, this.defaultValue.above),
			showLongLineWarning: boolean(input.showLongLineWarning, this.defaultValue.showLongLineWarning),
		};
	}
}



export interface OverviewRulerPosition {
	readonly width: number;
	readonly height: number;
	readonly top: number;
	readonly right: number;
}

export const enum RenderMinimap {
	None = 0,
	Text = 1,
	Blocks = 2,
}

export interface EditorLayoutInfo {

	readonly width: number;
	readonly height: number;

	readonly glyphMarginLeft: number;
	readonly glyphMarginWidth: number;

	readonly glyphMarginDecorationLaneCount: number;

	readonly lineNumbersLeft: number;
	readonly lineNumbersWidth: number;

	readonly decorationsLeft: number;
	readonly decorationsWidth: number;

	readonly contentLeft: number;
	readonly contentWidth: number;

	readonly minimap: EditorMinimapLayoutInfo;

	readonly viewportColumn: number;

	readonly isWordWrapMinified: boolean;
	readonly isViewportWrapping: boolean;
	readonly wrappingColumn: number;

	readonly verticalScrollbarWidth: number;
	readonly horizontalScrollbarHeight: number;

	readonly overviewRuler: OverviewRulerPosition;
}

export interface EditorMinimapLayoutInfo {
	readonly renderMinimap: RenderMinimap;
	readonly minimapLeft: number;
	readonly minimapWidth: number;
	readonly minimapHeightIsEditorHeight: boolean;
	readonly minimapIsSampling: boolean;
	readonly minimapScale: number;
	readonly minimapLineHeight: number;
	readonly minimapCanvasInnerWidth: number;
	readonly minimapCanvasInnerHeight: number;
	readonly minimapCanvasOuterWidth: number;
	readonly minimapCanvasOuterHeight: number;
}

/**
 * @internal
 */
export interface EditorLayoutInfoComputerEnv {
	readonly memory: ComputeOptionsMemory | null;
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly isDominatedByLongLines: boolean;
	readonly lineHeight: number;
	readonly viewLineCount: number;
	readonly lineNumbersDigitCount: number;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly maxDigitWidth: number;
	readonly pixelRatio: number;
	readonly glyphMarginDecorationLaneCount: number;
}

/**
 * @internal
 */
export interface IEditorLayoutComputerInput {
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly isDominatedByLongLines: boolean;
	readonly lineHeight: number;
	readonly lineNumbersDigitCount: number;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly maxDigitWidth: number;
	readonly pixelRatio: number;
	readonly glyphMargin: boolean;
	readonly lineDecorationsWidth: string | number;
	readonly folding: boolean;
	readonly minimap: Readonly<Required<IEditorMinimapOptions>>;
	readonly scrollbar: InternalEditorScrollbarOptions;
	readonly lineNumbers: InternalEditorRenderLineNumbersOptions;
	readonly lineNumbersMinChars: number;
	readonly scrollBeyondLastLine: boolean;
	readonly wordWrap: 'wordWrapColumn' | 'on' | 'off' | 'bounded';
	readonly wordWrapColumn: number;
	readonly wordWrapMinified: boolean;
	readonly accessibilitySupport: AccessibilitySupport;
}

/**
 * @internal
 */
export interface IMinimapLayoutInput {
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly lineHeight: number;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly pixelRatio: number;
	readonly scrollBeyondLastLine: boolean;
	readonly paddingTop: number;
	readonly paddingBottom: number;
	readonly minimap: Readonly<Required<IEditorMinimapOptions>>;
	readonly verticalScrollbarWidth: number;
	readonly viewLineCount: number;
	readonly remainingWidth: number;
	readonly isViewportWrapping: boolean;
}

/**
 * @internal
 */
export class EditorLayoutInfoComputer extends ComputedEditorOption<EditorOption.layoutInfo, EditorLayoutInfo> {

	constructor() {
		super(EditorOption.layoutInfo, {
			width: 0,
			height: 0,
			glyphMarginLeft: 0,
			glyphMarginWidth: 0,
			glyphMarginDecorationLaneCount: 0,
			lineNumbersLeft: 0,
			lineNumbersWidth: 0,
			decorationsLeft: 0,
			decorationsWidth: 0,
			contentLeft: 0,
			contentWidth: 0,
			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 0,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 0,
			},
			viewportColumn: 0,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			overviewRuler: {
				top: 0,
				width: 0,
				height: 0,
				right: 0
			}
		});
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: EditorLayoutInfo): EditorLayoutInfo {
		return EditorLayoutInfoComputer.computeLayout(options, {
			memory: env.memory,
			outerWidth: env.outerWidth,
			outerHeight: env.outerHeight,
			isDominatedByLongLines: env.isDominatedByLongLines,
			lineHeight: env.fontInfo.lineHeight,
			viewLineCount: env.viewLineCount,
			lineNumbersDigitCount: env.lineNumbersDigitCount,
			typicalHalfwidthCharacterWidth: env.fontInfo.typicalHalfwidthCharacterWidth,
			maxDigitWidth: env.fontInfo.maxDigitWidth,
			pixelRatio: env.pixelRatio,
			glyphMarginDecorationLaneCount: env.glyphMarginDecorationLaneCount
		});
	}

	public static computeContainedMinimapLineCount(input: {
		viewLineCount: number;
		scrollBeyondLastLine: boolean;
		paddingTop: number;
		paddingBottom: number;
		height: number;
		lineHeight: number;
		pixelRatio: number;
	}): { typicalViewportLineCount: number; extraLinesBeforeFirstLine: number; extraLinesBeyondLastLine: number; desiredRatio: number; minimapLineCount: number } {
		const typicalViewportLineCount = input.height / input.lineHeight;
		const extraLinesBeforeFirstLine = Math.floor(input.paddingTop / input.lineHeight);
		let extraLinesBeyondLastLine = Math.floor(input.paddingBottom / input.lineHeight);
		if (input.scrollBeyondLastLine) {
			extraLinesBeyondLastLine = Math.max(extraLinesBeyondLastLine, typicalViewportLineCount - 1);
		}
		const desiredRatio = (extraLinesBeforeFirstLine + input.viewLineCount + extraLinesBeyondLastLine) / (input.pixelRatio * input.height);
		const minimapLineCount = Math.floor(input.viewLineCount / desiredRatio);
		return { typicalViewportLineCount, extraLinesBeforeFirstLine, extraLinesBeyondLastLine, desiredRatio, minimapLineCount };
	}

	private static _computeMinimapLayout(input: IMinimapLayoutInput, memory: ComputeOptionsMemory): EditorMinimapLayoutInfo {
		const outerWidth = input.outerWidth;
		const outerHeight = input.outerHeight;
		const pixelRatio = input.pixelRatio;

		if (!input.minimap.enabled) {
			return {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: Math.floor(pixelRatio * outerHeight),
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: outerHeight,
			};
		}

		const stableMinimapLayoutInput = memory.stableMinimapLayoutInput;
		const couldUseMemory = (
			stableMinimapLayoutInput
			&& input.outerHeight === stableMinimapLayoutInput.outerHeight
			&& input.lineHeight === stableMinimapLayoutInput.lineHeight
			&& input.typicalHalfwidthCharacterWidth === stableMinimapLayoutInput.typicalHalfwidthCharacterWidth
			&& input.pixelRatio === stableMinimapLayoutInput.pixelRatio
			&& input.scrollBeyondLastLine === stableMinimapLayoutInput.scrollBeyondLastLine
			&& input.paddingTop === stableMinimapLayoutInput.paddingTop
			&& input.paddingBottom === stableMinimapLayoutInput.paddingBottom
			&& input.minimap.enabled === stableMinimapLayoutInput.minimap.enabled
			&& input.minimap.side === stableMinimapLayoutInput.minimap.side
			&& input.minimap.size === stableMinimapLayoutInput.minimap.size
			&& input.minimap.showSlider === stableMinimapLayoutInput.minimap.showSlider
			&& input.minimap.renderCharacters === stableMinimapLayoutInput.minimap.renderCharacters
			&& input.minimap.maxColumn === stableMinimapLayoutInput.minimap.maxColumn
			&& input.minimap.scale === stableMinimapLayoutInput.minimap.scale
			&& input.verticalScrollbarWidth === stableMinimapLayoutInput.verticalScrollbarWidth
			&& input.isViewportWrapping === stableMinimapLayoutInput.isViewportWrapping
		);

		const lineHeight = input.lineHeight;
		const typicalHalfwidthCharacterWidth = input.typicalHalfwidthCharacterWidth;
		const scrollBeyondLastLine = input.scrollBeyondLastLine;
		const minimapRenderCharacters = input.minimap.renderCharacters;
		let minimapScale = (pixelRatio >= 2 ? Math.round(input.minimap.scale * 2) : input.minimap.scale);
		const minimapMaxColumn = input.minimap.maxColumn;
		const minimapSize = input.minimap.size;
		const minimapSide = input.minimap.side;
		const verticalScrollbarWidth = input.verticalScrollbarWidth;
		const viewLineCount = input.viewLineCount;
		const remainingWidth = input.remainingWidth;
		const isViewportWrapping = input.isViewportWrapping;

		const baseCharHeight = minimapRenderCharacters ? 2 : 3;
		let minimapCanvasInnerHeight = Math.floor(pixelRatio * outerHeight);
		const minimapCanvasOuterHeight = minimapCanvasInnerHeight / pixelRatio;
		let minimapHeightIsEditorHeight = false;
		let minimapIsSampling = false;
		let minimapLineHeight = baseCharHeight * minimapScale;
		let minimapCharWidth = minimapScale / pixelRatio;
		let minimapWidthMultiplier: number = 1;

		if (minimapSize === 'fill' || minimapSize === 'fit') {
			const { typicalViewportLineCount, extraLinesBeforeFirstLine, extraLinesBeyondLastLine, desiredRatio, minimapLineCount } = EditorLayoutInfoComputer.computeContainedMinimapLineCount({
				viewLineCount: viewLineCount,
				scrollBeyondLastLine: scrollBeyondLastLine,
				paddingTop: input.paddingTop,
				paddingBottom: input.paddingBottom,
				height: outerHeight,
				lineHeight: lineHeight,
				pixelRatio: pixelRatio
			});
			const ratio = viewLineCount / minimapLineCount;

			if (ratio > 1) {
				minimapHeightIsEditorHeight = true;
				minimapIsSampling = true;
				minimapScale = 1;
				minimapLineHeight = 1;
				minimapCharWidth = minimapScale / pixelRatio;
			} else {
				let fitBecomesFill = false;
				let maxMinimapScale = minimapScale + 1;

				if (minimapSize === 'fit') {
					const effectiveMinimapHeight = Math.ceil((extraLinesBeforeFirstLine + viewLineCount + extraLinesBeyondLastLine) * minimapLineHeight);
					if (isViewportWrapping && couldUseMemory && remainingWidth <= memory.stableFitRemainingWidth) {
						fitBecomesFill = true;
						maxMinimapScale = memory.stableFitMaxMinimapScale;
					} else {
						fitBecomesFill = (effectiveMinimapHeight > minimapCanvasInnerHeight);
					}
				}

				if (minimapSize === 'fill' || fitBecomesFill) {
					minimapHeightIsEditorHeight = true;
					const configuredMinimapScale = minimapScale;
					minimapLineHeight = Math.min(lineHeight * pixelRatio, Math.max(1, Math.floor(1 / desiredRatio)));
					if (isViewportWrapping && couldUseMemory && remainingWidth <= memory.stableFitRemainingWidth) {
						maxMinimapScale = memory.stableFitMaxMinimapScale;
					}
					minimapScale = Math.min(maxMinimapScale, Math.max(1, Math.floor(minimapLineHeight / baseCharHeight)));
					if (minimapScale > configuredMinimapScale) {
						minimapWidthMultiplier = Math.min(2, minimapScale / configuredMinimapScale);
					}
					minimapCharWidth = minimapScale / pixelRatio / minimapWidthMultiplier;
					minimapCanvasInnerHeight = Math.ceil((Math.max(typicalViewportLineCount, extraLinesBeforeFirstLine + viewLineCount + extraLinesBeyondLastLine)) * minimapLineHeight);
					if (isViewportWrapping) {
						memory.stableMinimapLayoutInput = input;
						memory.stableFitRemainingWidth = remainingWidth;
						memory.stableFitMaxMinimapScale = minimapScale;
					} else {
						memory.stableMinimapLayoutInput = null;
						memory.stableFitRemainingWidth = 0;
					}
				}
			}
		}



		const minimapMaxWidth = Math.floor(minimapMaxColumn * minimapCharWidth);
		const minimapWidth = Math.min(minimapMaxWidth, Math.max(0, Math.floor(((remainingWidth - verticalScrollbarWidth - 2) * minimapCharWidth) / (typicalHalfwidthCharacterWidth + minimapCharWidth))) + MINIMAP_GUTTER_WIDTH);

		let minimapCanvasInnerWidth = Math.floor(pixelRatio * minimapWidth);
		const minimapCanvasOuterWidth = minimapCanvasInnerWidth / pixelRatio;
		minimapCanvasInnerWidth = Math.floor(minimapCanvasInnerWidth * minimapWidthMultiplier);

		const renderMinimap = (minimapRenderCharacters ? RenderMinimap.Text : RenderMinimap.Blocks);
		const minimapLeft = (minimapSide === 'left' ? 0 : (outerWidth - minimapWidth - verticalScrollbarWidth));

		return {
			renderMinimap,
			minimapLeft,
			minimapWidth,
			minimapHeightIsEditorHeight,
			minimapIsSampling,
			minimapScale,
			minimapLineHeight,
			minimapCanvasInnerWidth,
			minimapCanvasInnerHeight,
			minimapCanvasOuterWidth,
			minimapCanvasOuterHeight,
		};
	}

	public static computeLayout(options: IComputedEditorOptions, env: EditorLayoutInfoComputerEnv): EditorLayoutInfo {
		const outerWidth = env.outerWidth | 0;
		const outerHeight = env.outerHeight | 0;
		const lineHeight = env.lineHeight | 0;
		const lineNumbersDigitCount = env.lineNumbersDigitCount | 0;
		const typicalHalfwidthCharacterWidth = env.typicalHalfwidthCharacterWidth;
		const maxDigitWidth = env.maxDigitWidth;
		const pixelRatio = env.pixelRatio;
		const viewLineCount = env.viewLineCount;

		const wordWrapOverride2 = options.get(EditorOption.wordWrapOverride2);
		const wordWrapOverride1 = (wordWrapOverride2 === 'inherit' ? options.get(EditorOption.wordWrapOverride1) : wordWrapOverride2);
		const wordWrap = (wordWrapOverride1 === 'inherit' ? options.get(EditorOption.wordWrap) : wordWrapOverride1);

		const wordWrapColumn = options.get(EditorOption.wordWrapColumn);
		const wordWrapIndicator = options.get(EditorOption.wordWrapIndicator);
		const isDominatedByLongLines = env.isDominatedByLongLines;

		const showGlyphMargin = options.get(EditorOption.glyphMargin);
		const showLineNumbers = (options.get(EditorOption.lineNumbers).renderType !== RenderLineNumbersType.Off);
		const lineNumbersMinChars = options.get(EditorOption.lineNumbersMinChars);
		const scrollBeyondLastLine = options.get(EditorOption.scrollBeyondLastLine);
		const padding = options.get(EditorOption.padding);
		const minimap = options.get(EditorOption.minimap);

		const scrollbar = options.get(EditorOption.scrollbar);
		const verticalScrollbarWidth = scrollbar.verticalScrollbarSize;
		const verticalScrollbarHasArrows = scrollbar.verticalHasArrows;
		const scrollbarArrowSize = scrollbar.arrowSize;
		const horizontalScrollbarHeight = scrollbar.horizontalScrollbarSize;

		const folding = options.get(EditorOption.folding);
		const showFoldingDecoration = options.get(EditorOption.showFoldingControls) !== 'never';

		let lineDecorationsWidth = options.get(EditorOption.lineDecorationsWidth);
		if (folding && showFoldingDecoration) {
			lineDecorationsWidth += 16;
		}

		let lineNumbersWidth = 0;
		if (showLineNumbers) {
			const digitCount = Math.max(lineNumbersDigitCount, lineNumbersMinChars);
			lineNumbersWidth = Math.round(digitCount * maxDigitWidth);
		}

		let glyphMarginWidth = 0;
		if (showGlyphMargin) {
			glyphMarginWidth = lineHeight * env.glyphMarginDecorationLaneCount;
		}

		let glyphMarginLeft = 0;
		let lineNumbersLeft = glyphMarginLeft + glyphMarginWidth;
		let decorationsLeft = lineNumbersLeft + lineNumbersWidth;
		let contentLeft = decorationsLeft + lineDecorationsWidth;

		const remainingWidth = outerWidth - glyphMarginWidth - lineNumbersWidth - lineDecorationsWidth;

		let isWordWrapMinified = false;
		let isViewportWrapping = false;
		let wrappingColumn = -1;

		if (options.get(EditorOption.accessibilitySupport) === AccessibilitySupport.Enabled && wordWrapOverride1 === 'inherit' && isDominatedByLongLines) {
			isWordWrapMinified = true;
			isViewportWrapping = true;
		} else if (wordWrap === 'on' || wordWrap === 'bounded') {
			isViewportWrapping = true;
		} else if (wordWrap === 'wordWrapColumn') {
			wrappingColumn = wordWrapColumn;
		}

		const minimapLayout = EditorLayoutInfoComputer._computeMinimapLayout({
			outerWidth: outerWidth,
			outerHeight: outerHeight,
			lineHeight: lineHeight,
			typicalHalfwidthCharacterWidth: typicalHalfwidthCharacterWidth,
			pixelRatio: pixelRatio,
			scrollBeyondLastLine: scrollBeyondLastLine,
			paddingTop: padding.top,
			paddingBottom: padding.bottom,
			minimap: minimap,
			verticalScrollbarWidth: verticalScrollbarWidth,
			viewLineCount: viewLineCount,
			remainingWidth: remainingWidth,
			isViewportWrapping: isViewportWrapping,
		}, env.memory || new ComputeOptionsMemory());

		if (minimapLayout.renderMinimap !== RenderMinimap.None && minimapLayout.minimapLeft === 0) {
			glyphMarginLeft += minimapLayout.minimapWidth;
			lineNumbersLeft += minimapLayout.minimapWidth;
			decorationsLeft += minimapLayout.minimapWidth;
			contentLeft += minimapLayout.minimapWidth;
		}
		const contentWidth = remainingWidth - minimapLayout.minimapWidth;

		const viewportColumn = Math.max(1, Math.floor((contentWidth - verticalScrollbarWidth - 2) / typicalHalfwidthCharacterWidth));

		const verticalArrowSize = (verticalScrollbarHasArrows ? scrollbarArrowSize : 0);

		if (isViewportWrapping) {
			wrappingColumn = Math.max(1, viewportColumn - (wordWrapIndicator ? 1 : 0));
			if (wordWrap === 'bounded') {
				wrappingColumn = Math.min(wrappingColumn, wordWrapColumn);
			}
		}

		return {
			width: outerWidth,
			height: outerHeight,

			glyphMarginLeft: glyphMarginLeft,
			glyphMarginWidth: glyphMarginWidth,
			glyphMarginDecorationLaneCount: env.glyphMarginDecorationLaneCount,

			lineNumbersLeft: lineNumbersLeft,
			lineNumbersWidth: lineNumbersWidth,

			decorationsLeft: decorationsLeft,
			decorationsWidth: lineDecorationsWidth,

			contentLeft: contentLeft,
			contentWidth: contentWidth,

			minimap: minimapLayout,

			viewportColumn: viewportColumn,

			isWordWrapMinified: isWordWrapMinified,
			isViewportWrapping: isViewportWrapping,
			wrappingColumn: wrappingColumn,

			verticalScrollbarWidth: verticalScrollbarWidth,
			horizontalScrollbarHeight: horizontalScrollbarHeight,

			overviewRuler: {
				top: verticalArrowSize,
				width: verticalScrollbarWidth,
				height: (outerHeight - 2 * verticalArrowSize),
				right: 0
			}
		};
	}
}


class WrappingStrategy extends BaseEditorOption<EditorOption.wrappingStrategy, 'simple' | 'advanced', 'simple' | 'advanced'> {

	constructor() {
		super(EditorOption.wrappingStrategy, 'wrappingStrategy', 'simple',
			{
				'editor.wrappingStrategy': {
					enumDescriptions: [
						nls.localize('wrappingStrategy.simple', "Assumes that all characters are of the same width. This is a fast algorithm that works correctly for monospace fonts and certain scripts (like Latin characters) where glyphs are of equal width."),
						nls.localize('wrappingStrategy.advanced', "Delegates wrapping points computation to the browser. This is a slow algorithm, that might cause freezes for large files, but it works correctly in all cases.")
					],
					type: 'string',
					enum: ['simple', 'advanced'],
					default: 'simple',
					description: nls.localize('wrappingStrategy', "Controls the algorithm that computes wrapping points. Note that when in accessibility mode, advanced will be used for the best experience.")
				}
			}
		);
	}

	public validate(input: unknown): 'simple' | 'advanced' {
		return stringSet<'simple' | 'advanced'>(input, 'simple', ['simple', 'advanced']);
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: 'simple' | 'advanced'): 'simple' | 'advanced' {
		const accessibilitySupport = options.get(EditorOption.accessibilitySupport);
		if (accessibilitySupport === AccessibilitySupport.Enabled) {
			return 'advanced';
		}
		return value;
	}
}


export enum ShowLightbulbIconMode {
	Off = 'off',
	OnCode = 'onCode',
	On = 'on'
}

export interface IEditorLightbulbOptions {
	enabled?: ShowLightbulbIconMode;
}

/**
 * @internal
 */
export type EditorLightbulbOptions = Readonly<Required<IEditorLightbulbOptions>>;

class EditorLightbulb extends BaseEditorOption<EditorOption.lightbulb, IEditorLightbulbOptions, EditorLightbulbOptions> {

	constructor() {
		const defaults: EditorLightbulbOptions = { enabled: ShowLightbulbIconMode.OnCode };
		super(
			EditorOption.lightbulb, 'lightbulb', defaults,
			{
				'editor.lightbulb.enabled': {
					type: 'string',
					enum: [ShowLightbulbIconMode.Off, ShowLightbulbIconMode.OnCode, ShowLightbulbIconMode.On],
					default: defaults.enabled,
					enumDescriptions: [
						nls.localize('editor.lightbulb.enabled.off', 'Disable the code action menu.'),
						nls.localize('editor.lightbulb.enabled.onCode', 'Show the code action menu when the cursor is on lines with code.'),
						nls.localize('editor.lightbulb.enabled.on', 'Show the code action menu when the cursor is on lines with code or on empty lines.'),
					],
					description: nls.localize('enabled', "Enables the Code Action lightbulb in the editor.")
				}
			}
		);
	}

	public validate(_input: unknown): EditorLightbulbOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorLightbulbOptions>;
		return {
			enabled: stringSet(input.enabled, this.defaultValue.enabled, [ShowLightbulbIconMode.Off, ShowLightbulbIconMode.OnCode, ShowLightbulbIconMode.On])
		};
	}
}



export interface IEditorStickyScrollOptions {
	enabled?: boolean;
	maxLineCount?: number;
	defaultModel?: 'outlineModel' | 'foldingProviderModel' | 'indentationModel';
	scrollWithEditor?: boolean;
}

/**
 * @internal
 */
export type EditorStickyScrollOptions = Readonly<Required<IEditorStickyScrollOptions>>;

class EditorStickyScroll extends BaseEditorOption<EditorOption.stickyScroll, IEditorStickyScrollOptions, EditorStickyScrollOptions> {

	constructor() {
		const defaults: EditorStickyScrollOptions = { enabled: true, maxLineCount: 5, defaultModel: 'outlineModel', scrollWithEditor: true };
		super(
			EditorOption.stickyScroll, 'stickyScroll', defaults,
			{
				'editor.stickyScroll.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('editor.stickyScroll.enabled', "Shows the nested current scopes during the scroll at the top of the editor.")
				},
				'editor.stickyScroll.maxLineCount': {
					type: 'number',
					default: defaults.maxLineCount,
					minimum: 1,
					maximum: 20,
					description: nls.localize('editor.stickyScroll.maxLineCount', "Defines the maximum number of sticky lines to show.")
				},
				'editor.stickyScroll.defaultModel': {
					type: 'string',
					enum: ['outlineModel', 'foldingProviderModel', 'indentationModel'],
					default: defaults.defaultModel,
					description: nls.localize('editor.stickyScroll.defaultModel', "Defines the model to use for determining which lines to stick. If the outline model does not exist, it will fall back on the folding provider model which falls back on the indentation model. This order is respected in all three cases.")
				},
				'editor.stickyScroll.scrollWithEditor': {
					type: 'boolean',
					default: defaults.scrollWithEditor,
					description: nls.localize('editor.stickyScroll.scrollWithEditor', "Enable scrolling of Sticky Scroll with the editor's horizontal scrollbar.")
				},
			}
		);
	}

	public validate(_input: unknown): EditorStickyScrollOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorStickyScrollOptions>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			maxLineCount: EditorIntOption.clampedInt(input.maxLineCount, this.defaultValue.maxLineCount, 1, 20),
			defaultModel: stringSet<'outlineModel' | 'foldingProviderModel' | 'indentationModel'>(input.defaultModel, this.defaultValue.defaultModel, ['outlineModel', 'foldingProviderModel', 'indentationModel']),
			scrollWithEditor: boolean(input.scrollWithEditor, this.defaultValue.scrollWithEditor)
		};
	}
}



export interface IEditorInlayHintsOptions {
	enabled?: 'on' | 'off' | 'offUnlessPressed' | 'onUnlessPressed';

	fontSize?: number;

	fontFamily?: string;

	padding?: boolean;

	maximumLength?: number;
}

/**
 * @internal
 */
export type EditorInlayHintsOptions = Readonly<Required<IEditorInlayHintsOptions>>;

class EditorInlayHints extends BaseEditorOption<EditorOption.inlayHints, IEditorInlayHintsOptions, EditorInlayHintsOptions> {

	constructor() {
		const defaults: EditorInlayHintsOptions = { enabled: 'on', fontSize: 0, fontFamily: '', padding: false, maximumLength: 43 };
		super(
			EditorOption.inlayHints, 'inlayHints', defaults,
			{
				'editor.inlayHints.enabled': {
					type: 'string',
					default: defaults.enabled,
					description: nls.localize('inlayHints.enable', "Enables the inlay hints in the editor."),
					enum: ['on', 'onUnlessPressed', 'offUnlessPressed', 'off'],
					markdownEnumDescriptions: [
						nls.localize('editor.inlayHints.on', "Inlay hints are enabled"),
						nls.localize('editor.inlayHints.onUnlessPressed', "Inlay hints are showing by default and hide when holding {0}", platform.isMacintosh ? `Ctrl+Option` : `Ctrl+Alt`),
						nls.localize('editor.inlayHints.offUnlessPressed', "Inlay hints are hidden by default and show when holding {0}", platform.isMacintosh ? `Ctrl+Option` : `Ctrl+Alt`),
						nls.localize('editor.inlayHints.off', "Inlay hints are disabled"),
					],
				},
				'editor.inlayHints.fontSize': {
					type: 'number',
					default: defaults.fontSize,
					markdownDescription: nls.localize('inlayHints.fontSize', "Controls font size of inlay hints in the editor. As default the {0} is used when the configured value is less than {1} or greater than the editor font size.", '`#editor.fontSize#`', '`5`')
				},
				'editor.inlayHints.fontFamily': {
					type: 'string',
					default: defaults.fontFamily,
					markdownDescription: nls.localize('inlayHints.fontFamily', "Controls font family of inlay hints in the editor. When set to empty, the {0} is used.", '`#editor.fontFamily#`')
				},
				'editor.inlayHints.padding': {
					type: 'boolean',
					default: defaults.padding,
					description: nls.localize('inlayHints.padding', "Enables the padding around the inlay hints in the editor.")
				},
				'editor.inlayHints.maximumLength': {
					type: 'number',
					default: defaults.maximumLength,
					markdownDescription: nls.localize('inlayHints.maximumLength', "Maximum overall length of inlay hints, for a single line, before they get truncated by the editor. Set to `0` to never truncate")
				}
			}
		);
	}

	public validate(_input: unknown): EditorInlayHintsOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorInlayHintsOptions>;
		if (typeof input.enabled === 'boolean') {
			input.enabled = input.enabled ? 'on' : 'off';
		}
		return {
			enabled: stringSet<'on' | 'off' | 'offUnlessPressed' | 'onUnlessPressed'>(input.enabled, this.defaultValue.enabled, ['on', 'off', 'offUnlessPressed', 'onUnlessPressed']),
			fontSize: EditorIntOption.clampedInt(input.fontSize, this.defaultValue.fontSize, 0, 100),
			fontFamily: EditorStringOption.string(input.fontFamily, this.defaultValue.fontFamily),
			padding: boolean(input.padding, this.defaultValue.padding),
			maximumLength: EditorIntOption.clampedInt(input.maximumLength, this.defaultValue.maximumLength, 0, Number.MAX_SAFE_INTEGER),
		};
	}
}



class EditorLineDecorationsWidth extends BaseEditorOption<EditorOption.lineDecorationsWidth, number | string, number> {

	constructor() {
		super(EditorOption.lineDecorationsWidth, 'lineDecorationsWidth', 10);
	}

	public validate(input: unknown): number {
		if (typeof input === 'string' && /^\d+(\.\d+)?ch$/.test(input)) {
			const multiple = parseFloat(input.substring(0, input.length - 2));
			return -multiple;
		} else {
			return EditorIntOption.clampedInt(input, this.defaultValue, 0, 1000);
		}
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: number): number {
		if (value < 0) {
			return EditorIntOption.clampedInt(-value * env.fontInfo.typicalHalfwidthCharacterWidth, this.defaultValue, 0, 1000);
		} else {
			return value;
		}
	}
}



class EditorLineHeight extends EditorFloatOption<EditorOption.lineHeight> {

	constructor() {
		super(
			EditorOption.lineHeight, 'lineHeight',
			EDITOR_FONT_DEFAULTS.lineHeight,
			x => EditorFloatOption.clamp(x, 0, 150),
			{ markdownDescription: nls.localize('lineHeight', "Controls the line height. \n - Use 0 to automatically compute the line height from the font size.\n - Values between 0 and 8 will be used as a multiplier with the font size.\n - Values greater than or equal to 8 will be used as effective values.") },
			0,
			150
		);
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: number): number {
		return env.fontInfo.lineHeight;
	}
}



export interface IEditorMinimapOptions {
	enabled?: boolean;
	autohide?: 'none' | 'mouseover' | 'scroll';
	side?: 'right' | 'left';
	size?: 'proportional' | 'fill' | 'fit';
	showSlider?: 'always' | 'mouseover';
	renderCharacters?: boolean;
	maxColumn?: number;
	scale?: number;
	showRegionSectionHeaders?: boolean;
	showMarkSectionHeaders?: boolean;
	markSectionHeaderRegex?: string;
	sectionHeaderFontSize?: number;
	sectionHeaderLetterSpacing?: number;
}

/**
 * @internal
 */
export type EditorMinimapOptions = Readonly<Required<IEditorMinimapOptions>>;

class EditorMinimap extends BaseEditorOption<EditorOption.minimap, IEditorMinimapOptions, EditorMinimapOptions> {

	constructor() {
		const defaults: EditorMinimapOptions = {
			enabled: true,
			size: 'proportional',
			side: 'right',
			showSlider: 'mouseover',
			autohide: 'none',
			renderCharacters: true,
			maxColumn: 120,
			scale: 1,
			showRegionSectionHeaders: true,
			showMarkSectionHeaders: true,
			markSectionHeaderRegex: '\\bMARK:\\s*(?<separator>\-?)\\s*(?<label>.*)$',
			sectionHeaderFontSize: 9,
			sectionHeaderLetterSpacing: 1,
		};
		super(
			EditorOption.minimap, 'minimap', defaults,
			{
				'editor.minimap.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('minimap.enabled', "Controls whether the minimap is shown.")
				},
				'editor.minimap.autohide': {
					type: 'string',
					enum: ['none', 'mouseover', 'scroll'],
					enumDescriptions: [
						nls.localize('minimap.autohide.none', "The minimap is always shown."),
						nls.localize('minimap.autohide.mouseover', "The minimap is hidden when mouse is not over the minimap and shown when mouse is over the minimap."),
						nls.localize('minimap.autohide.scroll', "The minimap is only shown when the editor is scrolled"),
					],
					default: defaults.autohide,
					description: nls.localize('minimap.autohide', "Controls whether the minimap is hidden automatically.")
				},
				'editor.minimap.size': {
					type: 'string',
					enum: ['proportional', 'fill', 'fit'],
					enumDescriptions: [
						nls.localize('minimap.size.proportional', "The minimap has the same size as the editor contents (and might scroll)."),
						nls.localize('minimap.size.fill', "The minimap will stretch or shrink as necessary to fill the height of the editor (no scrolling)."),
						nls.localize('minimap.size.fit', "The minimap will shrink as necessary to never be larger than the editor (no scrolling)."),
					],
					default: defaults.size,
					description: nls.localize('minimap.size', "Controls the size of the minimap.")
				},
				'editor.minimap.side': {
					type: 'string',
					enum: ['left', 'right'],
					default: defaults.side,
					description: nls.localize('minimap.side', "Controls the side where to render the minimap.")
				},
				'editor.minimap.showSlider': {
					type: 'string',
					enum: ['always', 'mouseover'],
					default: defaults.showSlider,
					description: nls.localize('minimap.showSlider', "Controls when the minimap slider is shown.")
				},
				'editor.minimap.scale': {
					type: 'number',
					default: defaults.scale,
					minimum: 1,
					maximum: 3,
					enum: [1, 2, 3],
					description: nls.localize('minimap.scale', "Scale of content drawn in the minimap: 1, 2 or 3.")
				},
				'editor.minimap.renderCharacters': {
					type: 'boolean',
					default: defaults.renderCharacters,
					description: nls.localize('minimap.renderCharacters', "Render the actual characters on a line as opposed to color blocks.")
				},
				'editor.minimap.maxColumn': {
					type: 'number',
					default: defaults.maxColumn,
					description: nls.localize('minimap.maxColumn', "Limit the width of the minimap to render at most a certain number of columns.")
				},
				'editor.minimap.showRegionSectionHeaders': {
					type: 'boolean',
					default: defaults.showRegionSectionHeaders,
					description: nls.localize('minimap.showRegionSectionHeaders', "Controls whether named regions are shown as section headers in the minimap.")
				},
				'editor.minimap.showMarkSectionHeaders': {
					type: 'boolean',
					default: defaults.showMarkSectionHeaders,
					description: nls.localize('minimap.showMarkSectionHeaders', "Controls whether MARK: comments are shown as section headers in the minimap.")
				},
				'editor.minimap.markSectionHeaderRegex': {
					type: 'string',
					default: defaults.markSectionHeaderRegex,
					description: nls.localize('minimap.markSectionHeaderRegex', "Defines the regular expression used to find section headers in comments. The regex must contain a named match group `label` (written as `(?<label>.+)`) that encapsulates the section header, otherwise it will not work. Optionally you can include another match group named `separator`. Use \\n in the pattern to match multi-line headers."),
				},
				'editor.minimap.sectionHeaderFontSize': {
					type: 'number',
					default: defaults.sectionHeaderFontSize,
					description: nls.localize('minimap.sectionHeaderFontSize', "Controls the font size of section headers in the minimap.")
				},
				'editor.minimap.sectionHeaderLetterSpacing': {
					type: 'number',
					default: defaults.sectionHeaderLetterSpacing,
					description: nls.localize('minimap.sectionHeaderLetterSpacing', "Controls the amount of space (in pixels) between characters of section header. This helps the readability of the header in small font sizes.")
				}
			}
		);
	}

	public validate(_input: unknown): EditorMinimapOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorMinimapOptions>;

		let markSectionHeaderRegex = this.defaultValue.markSectionHeaderRegex;
		const inputRegex = input.markSectionHeaderRegex;
		if (typeof inputRegex === 'string') {
			try {
				new RegExp(inputRegex, 'd');
				markSectionHeaderRegex = inputRegex;
			} catch { }
		}

		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			autohide: stringSet<'none' | 'mouseover' | 'scroll'>(input.autohide, this.defaultValue.autohide, ['none', 'mouseover', 'scroll']),
			size: stringSet<'proportional' | 'fill' | 'fit'>(input.size, this.defaultValue.size, ['proportional', 'fill', 'fit']),
			side: stringSet<'right' | 'left'>(input.side, this.defaultValue.side, ['right', 'left']),
			showSlider: stringSet<'always' | 'mouseover'>(input.showSlider, this.defaultValue.showSlider, ['always', 'mouseover']),
			renderCharacters: boolean(input.renderCharacters, this.defaultValue.renderCharacters),
			scale: EditorIntOption.clampedInt(input.scale, 1, 1, 3),
			maxColumn: EditorIntOption.clampedInt(input.maxColumn, this.defaultValue.maxColumn, 1, 10000),
			showRegionSectionHeaders: boolean(input.showRegionSectionHeaders, this.defaultValue.showRegionSectionHeaders),
			showMarkSectionHeaders: boolean(input.showMarkSectionHeaders, this.defaultValue.showMarkSectionHeaders),
			markSectionHeaderRegex: markSectionHeaderRegex,
			sectionHeaderFontSize: EditorFloatOption.clamp(EditorFloatOption.float(input.sectionHeaderFontSize, this.defaultValue.sectionHeaderFontSize), 4, 32),
			sectionHeaderLetterSpacing: EditorFloatOption.clamp(EditorFloatOption.float(input.sectionHeaderLetterSpacing, this.defaultValue.sectionHeaderLetterSpacing), 0, 5),
		};
	}
}



function _multiCursorModifierFromString(multiCursorModifier: 'ctrlCmd' | 'alt'): 'altKey' | 'metaKey' | 'ctrlKey' {
	if (multiCursorModifier === 'ctrlCmd') {
		return (platform.isMacintosh ? 'metaKey' : 'ctrlKey');
	}
	return 'altKey';
}



export interface IEditorPaddingOptions {
	top?: number;
	bottom?: number;
}

/**
 * @internal
 */
export type InternalEditorPaddingOptions = Readonly<Required<IEditorPaddingOptions>>;

class EditorPadding extends BaseEditorOption<EditorOption.padding, IEditorPaddingOptions, InternalEditorPaddingOptions> {

	constructor() {
		super(
			EditorOption.padding, 'padding', { top: 0, bottom: 0 },
			{
				'editor.padding.top': {
					type: 'number',
					default: 0,
					minimum: 0,
					maximum: 1000,
					description: nls.localize('padding.top', "Controls the amount of space between the top edge of the editor and the first line.")
				},
				'editor.padding.bottom': {
					type: 'number',
					default: 0,
					minimum: 0,
					maximum: 1000,
					description: nls.localize('padding.bottom', "Controls the amount of space between the bottom edge of the editor and the last line.")
				}
			}
		);
	}

	public validate(_input: unknown): InternalEditorPaddingOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorPaddingOptions>;

		return {
			top: EditorIntOption.clampedInt(input.top, 0, 0, 1000),
			bottom: EditorIntOption.clampedInt(input.bottom, 0, 0, 1000)
		};
	}
}


export interface IEditorParameterHintOptions {
	enabled?: boolean;
	cycle?: boolean;
}

/**
 * @internal
 */
export type InternalParameterHintOptions = Readonly<Required<IEditorParameterHintOptions>>;

class EditorParameterHints extends BaseEditorOption<EditorOption.parameterHints, IEditorParameterHintOptions, InternalParameterHintOptions> {

	constructor() {
		const defaults: InternalParameterHintOptions = {
			enabled: true,
			cycle: true
		};
		super(
			EditorOption.parameterHints, 'parameterHints', defaults,
			{
				'editor.parameterHints.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('parameterHints.enabled', "Enables a pop-up that shows parameter documentation and type information as you type.")
				},
				'editor.parameterHints.cycle': {
					type: 'boolean',
					default: defaults.cycle,
					description: nls.localize('parameterHints.cycle', "Controls whether the parameter hints menu cycles or closes when reaching the end of the list.")
				},
			}
		);
	}

	public validate(_input: unknown): InternalParameterHintOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorParameterHintOptions>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			cycle: boolean(input.cycle, this.defaultValue.cycle)
		};
	}
}



class EditorPixelRatio extends ComputedEditorOption<EditorOption.pixelRatio, number> {

	constructor() {
		super(EditorOption.pixelRatio, 1);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: number): number {
		return env.pixelRatio;
	}
}



class PlaceholderOption extends BaseEditorOption<EditorOption.placeholder, string | undefined, string | undefined> {
	constructor() {
		super(EditorOption.placeholder, 'placeholder', undefined);
	}

	public validate(input: unknown): string | undefined {
		if (typeof input === 'undefined') {
			return this.defaultValue;
		}
		if (typeof input === 'string') {
			return input;
		}
		return this.defaultValue;
	}
}


export type QuickSuggestionsValue = 'on' | 'inline' | 'off' | 'offWhenInlineCompletions';

export interface IQuickSuggestionsOptions {
	other?: boolean | QuickSuggestionsValue;
	comments?: boolean | QuickSuggestionsValue;
	strings?: boolean | QuickSuggestionsValue;
}

export interface InternalQuickSuggestionsOptions {
	readonly other: QuickSuggestionsValue;
	readonly comments: QuickSuggestionsValue;
	readonly strings: QuickSuggestionsValue;
}

class EditorQuickSuggestions extends BaseEditorOption<EditorOption.quickSuggestions, boolean | QuickSuggestionsValue | IQuickSuggestionsOptions, InternalQuickSuggestionsOptions> {

	public override readonly defaultValue: InternalQuickSuggestionsOptions;

	constructor() {
		const defaults: InternalQuickSuggestionsOptions = {
			other: 'offWhenInlineCompletions',
			comments: 'off',
			strings: 'off'
		};
		const types: IJSONSchema[] = [
			{ type: 'boolean' },
			{
				type: 'string',
				enum: ['on', 'inline', 'off', 'offWhenInlineCompletions'],
				enumDescriptions: [nls.localize('on', "Quick suggestions show inside the suggest widget"), nls.localize('inline', "Quick suggestions show as ghost text"), nls.localize('off', "Quick suggestions are disabled"), nls.localize('offWhenInlineCompletions', "Quick suggestions are disabled when inline completions are showing")]
			}
		];
		super(EditorOption.quickSuggestions, 'quickSuggestions', defaults, {
			anyOf: [
				{ type: 'boolean' },
				{
					type: 'string',
					enum: ['on', 'inline', 'off', 'offWhenInlineCompletions'],
					enumDescriptions: [nls.localize('quickSuggestions.topLevel.on', "Quick suggestions are enabled for all token types"), nls.localize('quickSuggestions.topLevel.inline', "Quick suggestions show as ghost text for all token types"), nls.localize('quickSuggestions.topLevel.off', "Quick suggestions are disabled for all token types"), nls.localize('quickSuggestions.topLevel.offWhenInlineCompletions', "Quick suggestions are disabled for all token types when inline completions are showing")]
				},
				{
					type: 'object',
					additionalProperties: false,
					properties: {
						strings: {
							anyOf: types,
							default: defaults.strings,
							description: nls.localize('quickSuggestions.strings', "Enable quick suggestions inside strings.")
						},
						comments: {
							anyOf: types,
							default: defaults.comments,
							description: nls.localize('quickSuggestions.comments', "Enable quick suggestions inside comments.")
						},
						other: {
							anyOf: types,
							default: defaults.other,
							description: nls.localize('quickSuggestions.other', "Enable quick suggestions outside of strings and comments.")
						},
					},
				}
			],
			default: defaults,
			markdownDescription: nls.localize('quickSuggestions', "Controls whether suggestions should automatically show up while typing. This can be controlled for typing in comments, strings, and other code. Quick suggestion can be configured to show as ghost text or with the suggest widget. Also be aware of the {0}-setting which controls if suggestions are triggered by special characters.", '`#editor.suggestOnTriggerCharacters#`'),
			experiment: {
				mode: 'auto'
			}
		});
		this.defaultValue = defaults;
	}

	public validate(input: unknown): InternalQuickSuggestionsOptions {
		if (typeof input === 'boolean') {
			const value = input ? 'on' : 'off';
			return { comments: value, strings: value, other: value };
		}
		if (typeof input === 'string') {
			const allowedValues: QuickSuggestionsValue[] = ['on', 'inline', 'off', 'offWhenInlineCompletions'];
			const validated = stringSet<QuickSuggestionsValue>(input as QuickSuggestionsValue, this.defaultValue.other, allowedValues);
			return { comments: validated, strings: validated, other: validated };
		}
		if (!input || typeof input !== 'object') {
			return this.defaultValue;
		}

		const { other, comments, strings } = (<IQuickSuggestionsOptions>input);
		const allowedValues: QuickSuggestionsValue[] = ['on', 'inline', 'off', 'offWhenInlineCompletions'];
		let validatedOther: QuickSuggestionsValue;
		let validatedComments: QuickSuggestionsValue;
		let validatedStrings: QuickSuggestionsValue;

		if (typeof other === 'boolean') {
			validatedOther = other ? 'on' : 'off';
		} else {
			validatedOther = stringSet(other, this.defaultValue.other, allowedValues);
		}
		if (typeof comments === 'boolean') {
			validatedComments = comments ? 'on' : 'off';
		} else {
			validatedComments = stringSet(comments, this.defaultValue.comments, allowedValues);
		}
		if (typeof strings === 'boolean') {
			validatedStrings = strings ? 'on' : 'off';
		} else {
			validatedStrings = stringSet(strings, this.defaultValue.strings, allowedValues);
		}
		return {
			other: validatedOther,
			comments: validatedComments,
			strings: validatedStrings
		};
	}
}



export type LineNumbersType = 'on' | 'off' | 'relative' | 'interval' | ((lineNumber: number) => string);

export const enum RenderLineNumbersType {
	Off = 0,
	On = 1,
	Relative = 2,
	Interval = 3,
	Custom = 4
}

export interface InternalEditorRenderLineNumbersOptions {
	readonly renderType: RenderLineNumbersType;
	readonly renderFn: ((lineNumber: number) => string) | null;
}

class EditorRenderLineNumbersOption extends BaseEditorOption<EditorOption.lineNumbers, LineNumbersType, InternalEditorRenderLineNumbersOptions> {

	constructor() {
		super(
			EditorOption.lineNumbers, 'lineNumbers', { renderType: RenderLineNumbersType.On, renderFn: null },
			{
				type: 'string',
				enum: ['off', 'on', 'relative', 'interval'],
				enumDescriptions: [
					nls.localize('lineNumbers.off', "Line numbers are not rendered."),
					nls.localize('lineNumbers.on', "Line numbers are rendered as absolute number."),
					nls.localize('lineNumbers.relative', "Line numbers are rendered as distance in lines to cursor position."),
					nls.localize('lineNumbers.interval', "Line numbers are rendered every 10 lines.")
				],
				default: 'on',
				description: nls.localize('lineNumbers', "Controls the display of line numbers.")
			}
		);
	}

	public validate(lineNumbers: unknown): InternalEditorRenderLineNumbersOptions {
		let renderType: RenderLineNumbersType = this.defaultValue.renderType;
		let renderFn: ((lineNumber: number) => string) | null = this.defaultValue.renderFn;

		if (typeof lineNumbers !== 'undefined') {
			if (typeof lineNumbers === 'function') {
				renderType = RenderLineNumbersType.Custom;
				renderFn = lineNumbers as ((lineNumber: number) => string);
			} else if (lineNumbers === 'interval') {
				renderType = RenderLineNumbersType.Interval;
			} else if (lineNumbers === 'relative') {
				renderType = RenderLineNumbersType.Relative;
			} else if (lineNumbers === 'on') {
				renderType = RenderLineNumbersType.On;
			} else {
				renderType = RenderLineNumbersType.Off;
			}
		}

		return {
			renderType,
			renderFn
		};
	}
}



/**
 * @internal
 */
export function filterValidationDecorations(options: IComputedEditorOptions): boolean {
	const renderValidationDecorations = options.get(EditorOption.renderValidationDecorations);
	if (renderValidationDecorations === 'editable') {
		return options.get(EditorOption.readOnly);
	}
	return renderValidationDecorations === 'on' ? false : true;
}



/**
 * @internal
 */
export function filterFontDecorations(options: IComputedEditorOptions): boolean {
	return !options.get(EditorOption.effectiveAllowVariableFonts);
}



export interface IRulerOption {
	readonly column: number;
	readonly color: string | null;
}

class EditorRulers extends BaseEditorOption<EditorOption.rulers, (number | IRulerOption)[], IRulerOption[]> {

	constructor() {
		const defaults: IRulerOption[] = [];
		const columnSchema: IJSONSchema = { type: 'number', description: nls.localize('rulers.size', "Number of monospace characters at which this editor ruler will render.") };
		super(
			EditorOption.rulers, 'rulers', defaults,
			{
				type: 'array',
				items: {
					anyOf: [
						columnSchema,
						{
							type: [
								'object'
							],
							properties: {
								column: columnSchema,
								color: {
									type: 'string',
									description: nls.localize('rulers.color', "Color of this editor ruler."),
									format: 'color-hex'
								}
							}
						}
					]
				},
				default: defaults,
				description: nls.localize('rulers', "Render vertical rulers after a certain number of monospace characters. Use multiple values for multiple rulers. No rulers are drawn if array is empty.")
			}
		);
	}

	public validate(input: unknown): IRulerOption[] {
		if (Array.isArray(input)) {
			const rulers: IRulerOption[] = [];
			for (const _element of input) {
				if (typeof _element === 'number') {
					rulers.push({
						column: EditorIntOption.clampedInt(_element, 0, 0, 10000),
						color: null
					});
				} else if (_element && typeof _element === 'object') {
					const element = _element as IRulerOption;
					rulers.push({
						column: EditorIntOption.clampedInt(element.column, 0, 0, 10000),
						color: element.color
					});
				}
			}
			rulers.sort((a, b) => a.column - b.column);
			return rulers;
		}
		return this.defaultValue;
	}
}



class ReadonlyMessage extends BaseEditorOption<EditorOption.readOnlyMessage, IMarkdownString | undefined, IMarkdownString | undefined> {
	constructor() {
		const defaults = undefined;

		super(
			EditorOption.readOnlyMessage, 'readOnlyMessage', defaults
		);
	}

	public validate(_input: unknown): IMarkdownString | undefined {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		return _input as IMarkdownString;
	}
}



export interface IEditorScrollbarOptions {
	arrowSize?: number;
	vertical?: 'auto' | 'visible' | 'hidden';
	horizontal?: 'auto' | 'visible' | 'hidden';
	useShadows?: boolean;
	verticalHasArrows?: boolean;
	horizontalHasArrows?: boolean;
	handleMouseWheel?: boolean;
	alwaysConsumeMouseWheel?: boolean;
	horizontalScrollbarSize?: number;
	verticalScrollbarSize?: number;
	verticalSliderSize?: number;
	horizontalSliderSize?: number;
	scrollByPage?: boolean;

	ignoreHorizontalScrollbarInContentHeight?: boolean;
}

export interface InternalEditorScrollbarOptions {
	readonly arrowSize: number;
	readonly vertical: ScrollbarVisibility;
	readonly horizontal: ScrollbarVisibility;
	readonly useShadows: boolean;
	readonly verticalHasArrows: boolean;
	readonly horizontalHasArrows: boolean;
	readonly handleMouseWheel: boolean;
	readonly alwaysConsumeMouseWheel: boolean;
	readonly horizontalScrollbarSize: number;
	readonly horizontalSliderSize: number;
	readonly verticalScrollbarSize: number;
	readonly verticalSliderSize: number;
	readonly scrollByPage: boolean;
	readonly ignoreHorizontalScrollbarInContentHeight: boolean;
}

function _scrollbarVisibilityFromString(visibility: unknown, defaultValue: ScrollbarVisibility): ScrollbarVisibility {
	if (typeof visibility !== 'string') {
		return defaultValue;
	}
	switch (visibility) {
		case 'hidden': return ScrollbarVisibility.Hidden;
		case 'visible': return ScrollbarVisibility.Visible;
		default: return ScrollbarVisibility.Auto;
	}
}

class EditorScrollbar extends BaseEditorOption<EditorOption.scrollbar, IEditorScrollbarOptions, InternalEditorScrollbarOptions> {

	constructor() {
		const defaults: InternalEditorScrollbarOptions = {
			vertical: ScrollbarVisibility.Auto,
			horizontal: ScrollbarVisibility.Auto,
			arrowSize: 11,
			useShadows: true,
			verticalHasArrows: false,
			horizontalHasArrows: false,
			horizontalScrollbarSize: 12,
			horizontalSliderSize: 12,
			verticalScrollbarSize: 14,
			verticalSliderSize: 14,
			handleMouseWheel: true,
			alwaysConsumeMouseWheel: true,
			scrollByPage: false,
			ignoreHorizontalScrollbarInContentHeight: false,
		};
		super(
			EditorOption.scrollbar, 'scrollbar', defaults,
			{
				'editor.scrollbar.vertical': {
					type: 'string',
					enum: ['auto', 'visible', 'hidden'],
					enumDescriptions: [
						nls.localize('scrollbar.vertical.auto', "The vertical scrollbar will be visible only when necessary."),
						nls.localize('scrollbar.vertical.visible', "The vertical scrollbar will always be visible."),
						nls.localize('scrollbar.vertical.fit', "The vertical scrollbar will always be hidden."),
					],
					default: 'auto',
					description: nls.localize('scrollbar.vertical', "Controls the visibility of the vertical scrollbar.")
				},
				'editor.scrollbar.horizontal': {
					type: 'string',
					enum: ['auto', 'visible', 'hidden'],
					enumDescriptions: [
						nls.localize('scrollbar.horizontal.auto', "The horizontal scrollbar will be visible only when necessary."),
						nls.localize('scrollbar.horizontal.visible', "The horizontal scrollbar will always be visible."),
						nls.localize('scrollbar.horizontal.fit', "The horizontal scrollbar will always be hidden."),
					],
					default: 'auto',
					description: nls.localize('scrollbar.horizontal', "Controls the visibility of the horizontal scrollbar.")
				},
				'editor.scrollbar.verticalScrollbarSize': {
					type: 'number',
					default: defaults.verticalScrollbarSize,
					description: nls.localize('scrollbar.verticalScrollbarSize', "The width of the vertical scrollbar.")
				},
				'editor.scrollbar.horizontalScrollbarSize': {
					type: 'number',
					default: defaults.horizontalScrollbarSize,
					description: nls.localize('scrollbar.horizontalScrollbarSize', "The height of the horizontal scrollbar.")
				},
				'editor.scrollbar.scrollByPage': {
					type: 'boolean',
					default: defaults.scrollByPage,
					description: nls.localize('scrollbar.scrollByPage', "Controls whether clicks scroll by page or jump to click position.")
				},
				'editor.scrollbar.ignoreHorizontalScrollbarInContentHeight': {
					type: 'boolean',
					default: defaults.ignoreHorizontalScrollbarInContentHeight,
					description: nls.localize('scrollbar.ignoreHorizontalScrollbarInContentHeight', "When set, the horizontal scrollbar will not increase the size of the editor's content.")
				}
			}
		);
	}

	public validate(_input: unknown): InternalEditorScrollbarOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IEditorScrollbarOptions>;
		const horizontalScrollbarSize = EditorIntOption.clampedInt(input.horizontalScrollbarSize, this.defaultValue.horizontalScrollbarSize, 0, 1000);
		const verticalScrollbarSize = EditorIntOption.clampedInt(input.verticalScrollbarSize, this.defaultValue.verticalScrollbarSize, 0, 1000);
		return {
			arrowSize: EditorIntOption.clampedInt(input.arrowSize, this.defaultValue.arrowSize, 0, 1000),
			vertical: _scrollbarVisibilityFromString(input.vertical, this.defaultValue.vertical),
			horizontal: _scrollbarVisibilityFromString(input.horizontal, this.defaultValue.horizontal),
			useShadows: boolean(input.useShadows, this.defaultValue.useShadows),
			verticalHasArrows: boolean(input.verticalHasArrows, this.defaultValue.verticalHasArrows),
			horizontalHasArrows: boolean(input.horizontalHasArrows, this.defaultValue.horizontalHasArrows),
			handleMouseWheel: boolean(input.handleMouseWheel, this.defaultValue.handleMouseWheel),
			alwaysConsumeMouseWheel: boolean(input.alwaysConsumeMouseWheel, this.defaultValue.alwaysConsumeMouseWheel),
			horizontalScrollbarSize: horizontalScrollbarSize,
			horizontalSliderSize: EditorIntOption.clampedInt(input.horizontalSliderSize, horizontalScrollbarSize, 0, 1000),
			verticalScrollbarSize: verticalScrollbarSize,
			verticalSliderSize: EditorIntOption.clampedInt(input.verticalSliderSize, verticalScrollbarSize, 0, 1000),
			scrollByPage: boolean(input.scrollByPage, this.defaultValue.scrollByPage),
			ignoreHorizontalScrollbarInContentHeight: boolean(input.ignoreHorizontalScrollbarInContentHeight, this.defaultValue.ignoreHorizontalScrollbarInContentHeight),
		};
	}
}



export type InUntrustedWorkspace = 'inUntrustedWorkspace';

/**
 * @internal
*/
export const inUntrustedWorkspace: InUntrustedWorkspace = 'inUntrustedWorkspace';

export interface IUnicodeHighlightOptions {

	nonBasicASCII?: boolean | InUntrustedWorkspace;

	invisibleCharacters?: boolean;

	ambiguousCharacters?: boolean;

	includeComments?: boolean | InUntrustedWorkspace;

	includeStrings?: boolean | InUntrustedWorkspace;

	allowedCharacters?: Record<string, true>;

	allowedLocales?: Record<string | '_os' | '_vscode', true>;
}

/**
 * @internal
 */
export type InternalUnicodeHighlightOptions = Required<Readonly<IUnicodeHighlightOptions>>;

/**
 * @internal
 */
export const unicodeHighlightConfigKeys = {
	allowedCharacters: 'editor.unicodeHighlight.allowedCharacters',
	invisibleCharacters: 'editor.unicodeHighlight.invisibleCharacters',
	nonBasicASCII: 'editor.unicodeHighlight.nonBasicASCII',
	ambiguousCharacters: 'editor.unicodeHighlight.ambiguousCharacters',
	includeComments: 'editor.unicodeHighlight.includeComments',
	includeStrings: 'editor.unicodeHighlight.includeStrings',
	allowedLocales: 'editor.unicodeHighlight.allowedLocales',
};

class UnicodeHighlight extends BaseEditorOption<EditorOption.unicodeHighlighting, IUnicodeHighlightOptions, InternalUnicodeHighlightOptions> {
	constructor() {
		const defaults: InternalUnicodeHighlightOptions = {
			nonBasicASCII: inUntrustedWorkspace,
			invisibleCharacters: true,
			ambiguousCharacters: true,
			includeComments: inUntrustedWorkspace,
			includeStrings: true,
			allowedCharacters: {},
			allowedLocales: { _os: true, _vscode: true },
		};

		super(
			EditorOption.unicodeHighlighting, 'unicodeHighlight', defaults,
			{
				[unicodeHighlightConfigKeys.nonBasicASCII]: {
					restricted: true,
					type: ['boolean', 'string'],
					enum: [true, false, inUntrustedWorkspace],
					default: defaults.nonBasicASCII,
					description: nls.localize('unicodeHighlight.nonBasicASCII', "Controls whether all non-basic ASCII characters are highlighted. Only characters between U+0020 and U+007E, tab, line-feed and carriage-return are considered basic ASCII.")
				},
				[unicodeHighlightConfigKeys.invisibleCharacters]: {
					restricted: true,
					type: 'boolean',
					default: defaults.invisibleCharacters,
					description: nls.localize('unicodeHighlight.invisibleCharacters', "Controls whether characters that just reserve space or have no width at all are highlighted.")
				},
				[unicodeHighlightConfigKeys.ambiguousCharacters]: {
					restricted: true,
					type: 'boolean',
					default: defaults.ambiguousCharacters,
					description: nls.localize('unicodeHighlight.ambiguousCharacters', "Controls whether characters are highlighted that can be confused with basic ASCII characters, except those that are common in the current user locale.")
				},
				[unicodeHighlightConfigKeys.includeComments]: {
					restricted: true,
					type: ['boolean', 'string'],
					enum: [true, false, inUntrustedWorkspace],
					default: defaults.includeComments,
					description: nls.localize('unicodeHighlight.includeComments', "Controls whether characters in comments should also be subject to Unicode highlighting.")
				},
				[unicodeHighlightConfigKeys.includeStrings]: {
					restricted: true,
					type: ['boolean', 'string'],
					enum: [true, false, inUntrustedWorkspace],
					default: defaults.includeStrings,
					description: nls.localize('unicodeHighlight.includeStrings', "Controls whether characters in strings should also be subject to Unicode highlighting.")
				},
				[unicodeHighlightConfigKeys.allowedCharacters]: {
					restricted: true,
					type: 'object',
					default: defaults.allowedCharacters,
					description: nls.localize('unicodeHighlight.allowedCharacters', "Defines allowed characters that are not being highlighted."),
					additionalProperties: {
						type: 'boolean'
					}
				},
				[unicodeHighlightConfigKeys.allowedLocales]: {
					restricted: true,
					type: 'object',
					additionalProperties: {
						type: 'boolean'
					},
					default: defaults.allowedLocales,
					description: nls.localize('unicodeHighlight.allowedLocales', "Unicode characters that are common in allowed locales are not being highlighted.")
				},
			}
		);
	}

	public override applyUpdate(value: Required<Readonly<IUnicodeHighlightOptions>> | undefined, update: Required<Readonly<IUnicodeHighlightOptions>>): ApplyUpdateResult<Required<Readonly<IUnicodeHighlightOptions>>> {
		let didChange = false;
		if (update.allowedCharacters && value) {
			if (!objects.equals(value.allowedCharacters, update.allowedCharacters)) {
				value = { ...value, allowedCharacters: update.allowedCharacters };
				didChange = true;
			}
		}
		if (update.allowedLocales && value) {
			if (!objects.equals(value.allowedLocales, update.allowedLocales)) {
				value = { ...value, allowedLocales: update.allowedLocales };
				didChange = true;
			}
		}

		const result = super.applyUpdate(value, update);
		if (didChange) {
			return new ApplyUpdateResult(result.newValue, true);
		}
		return result;
	}

	public validate(_input: unknown): InternalUnicodeHighlightOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IUnicodeHighlightOptions>;
		return {
			nonBasicASCII: primitiveSet<boolean | InUntrustedWorkspace>(input.nonBasicASCII, inUntrustedWorkspace, [true, false, inUntrustedWorkspace]),
			invisibleCharacters: boolean(input.invisibleCharacters, this.defaultValue.invisibleCharacters),
			ambiguousCharacters: boolean(input.ambiguousCharacters, this.defaultValue.ambiguousCharacters),
			includeComments: primitiveSet<boolean | InUntrustedWorkspace>(input.includeComments, inUntrustedWorkspace, [true, false, inUntrustedWorkspace]),
			includeStrings: primitiveSet<boolean | InUntrustedWorkspace>(input.includeStrings, inUntrustedWorkspace, [true, false, inUntrustedWorkspace]),
			allowedCharacters: this.validateBooleanMap(input.allowedCharacters, this.defaultValue.allowedCharacters),
			allowedLocales: this.validateBooleanMap(input.allowedLocales, this.defaultValue.allowedLocales),
		};
	}

	private validateBooleanMap(map: unknown, defaultValue: Record<string, true>): Record<string, true> {
		if ((typeof map !== 'object') || !map) {
			return defaultValue;
		}
		const result: Record<string, true> = {};
		for (const [key, value] of Object.entries(map)) {
			if (value === true) {
				result[key] = true;
			}
		}
		return result;
	}
}



export interface IInlineSuggestOptions {
	enabled?: boolean;

	mode?: 'prefix' | 'subword' | 'subwordSmart';

	showToolbar?: 'always' | 'onHover' | 'never';

	syntaxHighlightingEnabled?: boolean;

	suppressSuggestions?: boolean;

	minShowDelay?: number;
	suppressInSnippetMode?: boolean;
	keepOnBlur?: boolean;

	fontFamily?: string | 'default';

	edits?: {
		allowCodeShifting?: 'always' | 'horizontal' | 'never';

		renderSideBySide?: 'never' | 'auto';

		showCollapsed?: boolean;

		showLongDistanceHint?: boolean;

		longDistanceHintContextLineCount?: number;

		/**
		* @internal
		*/
		enabled?: boolean;
	};

	/**
	* @internal
	*/
	triggerCommandOnProviderChange?: boolean;

	/**
	* @internal
	*/
	experimental?: {
		/**
		* @internal
		*/
		suppressInlineSuggestions?: string;

		/**
		* @internal
		*/
		emptyResponseInformation?: boolean;

		showOnSuggestConflict?: 'always' | 'never' | 'whenSuggestListIsIncomplete';
	};
}

type RequiredRecursive<T> = {
	[P in keyof T]-?: T[P] extends object | undefined ? RequiredRecursive<T[P]> : T[P];
};

/**
 * @internal
 */
export type InternalInlineSuggestOptions = Readonly<RequiredRecursive<IInlineSuggestOptions>>;

class InlineEditorSuggest extends BaseEditorOption<EditorOption.inlineSuggest, IInlineSuggestOptions, InternalInlineSuggestOptions> {
	constructor() {
		const defaults: InternalInlineSuggestOptions = {
			enabled: true,
			mode: 'subwordSmart',
			showToolbar: 'onHover',
			suppressSuggestions: false,
			keepOnBlur: false,
			fontFamily: 'default',
			syntaxHighlightingEnabled: true,
			minShowDelay: 0,
			suppressInSnippetMode: true,
			edits: {
				enabled: true,
				showCollapsed: false,
				renderSideBySide: 'auto',
				allowCodeShifting: 'always',
				showLongDistanceHint: true,
				longDistanceHintContextLineCount: 0,
			},
			triggerCommandOnProviderChange: false,
			experimental: {
				suppressInlineSuggestions: '',
				showOnSuggestConflict: 'never',
				emptyResponseInformation: true,
			},
		};

		super(
			EditorOption.inlineSuggest, 'inlineSuggest', defaults,
			{
				'editor.inlineSuggest.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('inlineSuggest.enabled', "Controls whether to automatically show inline suggestions in the editor.")
				},
				'editor.inlineSuggest.showToolbar': {
					type: 'string',
					default: defaults.showToolbar,
					enum: ['always', 'onHover', 'never'],
					enumDescriptions: [
						nls.localize('inlineSuggest.showToolbar.always', "Show the inline suggestion toolbar whenever an inline suggestion is shown."),
						nls.localize('inlineSuggest.showToolbar.onHover', "Show the inline suggestion toolbar when hovering over an inline suggestion."),
						nls.localize('inlineSuggest.showToolbar.never', "Never show the inline suggestion toolbar."),
					],
					description: nls.localize('inlineSuggest.showToolbar', "Controls when to show the inline suggestion toolbar."),
				},
				'editor.inlineSuggest.syntaxHighlightingEnabled': {
					type: 'boolean',
					default: defaults.syntaxHighlightingEnabled,
					description: nls.localize('inlineSuggest.syntaxHighlightingEnabled', "Controls whether to show syntax highlighting for inline suggestions in the editor."),
				},
				'editor.inlineSuggest.suppressSuggestions': {
					type: 'boolean',
					default: defaults.suppressSuggestions,
					description: nls.localize('inlineSuggest.suppressSuggestions', "Controls how inline suggestions interact with the suggest widget. If enabled, the suggest widget is not shown automatically when inline suggestions are available.")
				},
				'editor.inlineSuggest.suppressInSnippetMode': {
					type: 'boolean',
					default: defaults.suppressInSnippetMode,
					description: nls.localize('inlineSuggest.suppressInSnippetMode', "Controls whether inline suggestions are suppressed when in snippet mode."),
				},
				'editor.inlineSuggest.minShowDelay': {
					type: 'number',
					default: 0,
					minimum: 0,
					maximum: 10000,
					description: nls.localize('inlineSuggest.minShowDelay', "Controls the minimal delay in milliseconds after which inline suggestions are shown after typing."),
				},
				'editor.inlineSuggest.experimental.suppressInlineSuggestions': {
					type: 'string',
					default: defaults.experimental.suppressInlineSuggestions,
					tags: ['experimental'],
					description: nls.localize('inlineSuggest.suppressInlineSuggestions', "Suppresses inline completions for specified extension IDs -- comma separated."),
					experiment: {
						mode: 'auto'
					}
				},
				'editor.inlineSuggest.experimental.emptyResponseInformation': {
					type: 'boolean',
					default: defaults.experimental.emptyResponseInformation,
					tags: ['experimental'],
					description: nls.localize('inlineSuggest.emptyResponseInformation', "Controls whether to send request information from the inline suggestion provider."),
					experiment: {
						mode: 'auto'
					}
				},
				'editor.inlineSuggest.triggerCommandOnProviderChange': {
					type: 'boolean',
					default: defaults.triggerCommandOnProviderChange,
					tags: ['experimental'],
					description: nls.localize('inlineSuggest.triggerCommandOnProviderChange', "Controls whether to trigger a command when the inline suggestion provider changes."),
					experiment: {
						mode: 'auto'
					}
				},
				'editor.inlineSuggest.experimental.showOnSuggestConflict': {
					type: 'string',
					default: defaults.experimental.showOnSuggestConflict,
					tags: ['experimental'],
					enum: ['always', 'never', 'whenSuggestListIsIncomplete'],
					description: nls.localize('inlineSuggest.showOnSuggestConflict', "Controls whether to show inline suggestions when there is a suggest conflict."),
					experiment: {
						mode: 'auto'
					}
				},
				'editor.inlineSuggest.fontFamily': {
					type: 'string',
					default: defaults.fontFamily,
					description: nls.localize('inlineSuggest.fontFamily', "Controls the font family of the inline suggestions.")
				},
				'editor.inlineSuggest.edits.allowCodeShifting': {
					type: 'string',
					default: defaults.edits.allowCodeShifting,
					description: nls.localize('inlineSuggest.edits.allowCodeShifting', "Controls whether showing a suggestion will shift the code to make space for the suggestion inline."),
					enum: ['always', 'horizontal', 'never'],
					tags: ['nextEditSuggestions']
				},
				'editor.inlineSuggest.edits.showLongDistanceHint': {
					type: 'boolean',
					default: defaults.edits.showLongDistanceHint,
					description: nls.localize('inlineSuggest.edits.showLongDistanceHint', "Controls whether long distance inline suggestions are shown."),
					tags: ['nextEditSuggestions', 'experimental']
				},
				'editor.inlineSuggest.edits.longDistanceHintContextLineCount': {
					type: 'number',
					default: defaults.edits.longDistanceHintContextLineCount,
					minimum: 0,
					maximum: 10,
					description: nls.localize('inlineSuggest.edits.longDistanceHintContextLineCount', "Controls how many lines of surrounding context are shown above and below the target line in the long distance inline suggestion preview. Set to 0 to only show the target line."),
					tags: ['nextEditSuggestions', 'experimental'],
					experiment: {
						mode: 'auto'
					}
				},
				'editor.inlineSuggest.edits.renderSideBySide': {
					type: 'string',
					default: defaults.edits.renderSideBySide,
					description: nls.localize('inlineSuggest.edits.renderSideBySide', "Controls whether larger suggestions can be shown side by side."),
					enum: ['auto', 'never'],
					enumDescriptions: [
						nls.localize('editor.inlineSuggest.edits.renderSideBySide.auto', "Larger suggestions will show side by side if there is enough space, otherwise they will be shown below."),
						nls.localize('editor.inlineSuggest.edits.renderSideBySide.never', "Larger suggestions are never shown side by side and will always be shown below."),
					],
					tags: ['nextEditSuggestions']
				},
				'editor.inlineSuggest.edits.showCollapsed': {
					type: 'boolean',
					default: defaults.edits.showCollapsed,
					description: nls.localize('inlineSuggest.edits.showCollapsed', "Controls whether the suggestion will show as collapsed until jumping to it."),
					tags: ['nextEditSuggestions']
				},
			}
		);
	}

	public validate(_input: unknown): InternalInlineSuggestOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IInlineSuggestOptions>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			mode: stringSet(input.mode, this.defaultValue.mode, ['prefix', 'subword', 'subwordSmart']),
			showToolbar: stringSet(input.showToolbar, this.defaultValue.showToolbar, ['always', 'onHover', 'never']),
			suppressSuggestions: boolean(input.suppressSuggestions, this.defaultValue.suppressSuggestions),
			keepOnBlur: boolean(input.keepOnBlur, this.defaultValue.keepOnBlur),
			fontFamily: EditorStringOption.string(input.fontFamily, this.defaultValue.fontFamily),
			syntaxHighlightingEnabled: boolean(input.syntaxHighlightingEnabled, this.defaultValue.syntaxHighlightingEnabled),
			minShowDelay: EditorIntOption.clampedInt(input.minShowDelay, 0, 0, 10000),
			suppressInSnippetMode: boolean(input.suppressInSnippetMode, this.defaultValue.suppressInSnippetMode),
			edits: this._validateEdits(input.edits),
			triggerCommandOnProviderChange: boolean(input.triggerCommandOnProviderChange, this.defaultValue.triggerCommandOnProviderChange),
			experimental: this._validateExperimental(input.experimental),
		};
	}

	private _validateEdits(_input: unknown): InternalInlineSuggestOptions['edits'] {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue.edits;
		}
		const input = _input as Unknown<InternalInlineSuggestOptions['edits']>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.edits.enabled),
			showCollapsed: boolean(input.showCollapsed, this.defaultValue.edits.showCollapsed),
			allowCodeShifting: stringSet(input.allowCodeShifting, this.defaultValue.edits.allowCodeShifting, ['always', 'horizontal', 'never']),
			showLongDistanceHint: boolean(input.showLongDistanceHint, this.defaultValue.edits.showLongDistanceHint),
			longDistanceHintContextLineCount: EditorIntOption.clampedInt(input.longDistanceHintContextLineCount, this.defaultValue.edits.longDistanceHintContextLineCount, 0, 10),
			renderSideBySide: stringSet(input.renderSideBySide, this.defaultValue.edits.renderSideBySide, ['never', 'auto']),
		};
	}

	private _validateExperimental(_input: unknown): InternalInlineSuggestOptions['experimental'] {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue.experimental;
		}
		const input = _input as Unknown<InternalInlineSuggestOptions['experimental']>;
		return {
			suppressInlineSuggestions: EditorStringOption.string(input.suppressInlineSuggestions, this.defaultValue.experimental.suppressInlineSuggestions),
			showOnSuggestConflict: stringSet(input.showOnSuggestConflict, this.defaultValue.experimental.showOnSuggestConflict, ['always', 'never', 'whenSuggestListIsIncomplete']),
			emptyResponseInformation: boolean(input.emptyResponseInformation, this.defaultValue.experimental.emptyResponseInformation),
		};
	}
}



export interface IBracketPairColorizationOptions {
	enabled?: boolean;

	independentColorPoolPerBracketType?: boolean;
}

/**
 * @internal
 */
export type InternalBracketPairColorizationOptions = Readonly<Required<IBracketPairColorizationOptions>>;

class BracketPairColorization extends BaseEditorOption<EditorOption.bracketPairColorization, IBracketPairColorizationOptions, InternalBracketPairColorizationOptions> {
	constructor() {
		const defaults: InternalBracketPairColorizationOptions = {
			enabled: EDITOR_MODEL_DEFAULTS.bracketPairColorizationOptions.enabled,
			independentColorPoolPerBracketType: EDITOR_MODEL_DEFAULTS.bracketPairColorizationOptions.independentColorPoolPerBracketType,
		};

		super(
			EditorOption.bracketPairColorization, 'bracketPairColorization', defaults,
			{
				'editor.bracketPairColorization.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					markdownDescription: nls.localize('bracketPairColorization.enabled', "Controls whether bracket pair colorization is enabled or not. Use {0} to override the bracket highlight colors.", '`#workbench.colorCustomizations#`')
				},
				'editor.bracketPairColorization.independentColorPoolPerBracketType': {
					type: 'boolean',
					default: defaults.independentColorPoolPerBracketType,
					description: nls.localize('bracketPairColorization.independentColorPoolPerBracketType', "Controls whether each bracket type has its own independent color pool.")
				},
			}
		);
	}

	public validate(_input: unknown): InternalBracketPairColorizationOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IBracketPairColorizationOptions>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			independentColorPoolPerBracketType: boolean(input.independentColorPoolPerBracketType, this.defaultValue.independentColorPoolPerBracketType),
		};
	}
}



export interface IGuidesOptions {
	bracketPairs?: boolean | 'active';

	bracketPairsHorizontal?: boolean | 'active';

	highlightActiveBracketPair?: boolean;

	indentation?: boolean;

	highlightActiveIndentation?: boolean | 'always';
}

/**
 * @internal
 */
export type InternalGuidesOptions = Readonly<Required<IGuidesOptions>>;

class GuideOptions extends BaseEditorOption<EditorOption.guides, IGuidesOptions, InternalGuidesOptions> {
	constructor() {
		const defaults: InternalGuidesOptions = {
			bracketPairs: false,
			bracketPairsHorizontal: 'active',
			highlightActiveBracketPair: true,

			indentation: true,
			highlightActiveIndentation: true
		};

		super(
			EditorOption.guides, 'guides', defaults,
			{
				'editor.guides.bracketPairs': {
					type: ['boolean', 'string'],
					enum: [true, 'active', false],
					enumDescriptions: [
						nls.localize('editor.guides.bracketPairs.true', "Enables bracket pair guides."),
						nls.localize('editor.guides.bracketPairs.active', "Enables bracket pair guides only for the active bracket pair."),
						nls.localize('editor.guides.bracketPairs.false', "Disables bracket pair guides."),
					],
					default: defaults.bracketPairs,
					description: nls.localize('editor.guides.bracketPairs', "Controls whether bracket pair guides are enabled or not.")
				},
				'editor.guides.bracketPairsHorizontal': {
					type: ['boolean', 'string'],
					enum: [true, 'active', false],
					enumDescriptions: [
						nls.localize('editor.guides.bracketPairsHorizontal.true', "Enables horizontal guides as addition to vertical bracket pair guides."),
						nls.localize('editor.guides.bracketPairsHorizontal.active', "Enables horizontal guides only for the active bracket pair."),
						nls.localize('editor.guides.bracketPairsHorizontal.false', "Disables horizontal bracket pair guides."),
					],
					default: defaults.bracketPairsHorizontal,
					description: nls.localize('editor.guides.bracketPairsHorizontal', "Controls whether horizontal bracket pair guides are enabled or not.")
				},
				'editor.guides.highlightActiveBracketPair': {
					type: 'boolean',
					default: defaults.highlightActiveBracketPair,
					description: nls.localize('editor.guides.highlightActiveBracketPair', "Controls whether the editor should highlight the active bracket pair.")
				},
				'editor.guides.indentation': {
					type: 'boolean',
					default: defaults.indentation,
					description: nls.localize('editor.guides.indentation', "Controls whether the editor should render indent guides.")
				},
				'editor.guides.highlightActiveIndentation': {
					type: ['boolean', 'string'],
					enum: [true, 'always', false],
					enumDescriptions: [
						nls.localize('editor.guides.highlightActiveIndentation.true', "Highlights the active indent guide."),
						nls.localize('editor.guides.highlightActiveIndentation.always', "Highlights the active indent guide even if bracket guides are highlighted."),
						nls.localize('editor.guides.highlightActiveIndentation.false', "Do not highlight the active indent guide."),
					],
					default: defaults.highlightActiveIndentation,

					description: nls.localize('editor.guides.highlightActiveIndentation', "Controls whether the editor should highlight the active indent guide.")
				}
			}
		);
	}

	public validate(_input: unknown): InternalGuidesOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IGuidesOptions>;
		return {
			bracketPairs: primitiveSet(input.bracketPairs, this.defaultValue.bracketPairs, [true, false, 'active']),
			bracketPairsHorizontal: primitiveSet(input.bracketPairsHorizontal, this.defaultValue.bracketPairsHorizontal, [true, false, 'active']),
			highlightActiveBracketPair: boolean(input.highlightActiveBracketPair, this.defaultValue.highlightActiveBracketPair),

			indentation: boolean(input.indentation, this.defaultValue.indentation),
			highlightActiveIndentation: primitiveSet(input.highlightActiveIndentation, this.defaultValue.highlightActiveIndentation, [true, false, 'always']),
		};
	}
}

function primitiveSet<T extends string | boolean>(value: unknown, defaultValue: T, allowedValues: T[]): T {
	const idx = allowedValues.indexOf(value as T);
	if (idx === -1) {
		return defaultValue;
	}
	return allowedValues[idx];
}



export interface ISuggestOptions {
	insertMode?: 'insert' | 'replace';
	filterGraceful?: boolean;
	snippetsPreventQuickSuggestions?: boolean;
	localityBonus?: boolean;
	/**
	 * Enable using global storage for remembering suggestions.
	 */
	shareSuggestSelections?: boolean;
	selectionMode?: 'always' | 'never' | 'whenTriggerCharacter' | 'whenQuickSuggestion';
	showIcons?: boolean;
	showStatusBar?: boolean;
	preview?: boolean;
	previewMode?: 'prefix' | 'subword' | 'subwordSmart';
	showInlineDetails?: boolean;
	/**
	 * Grow the suggest widget's preferred width to fit the inline detail text so it
	 * is not truncated. Defaults to false.
	 * @internal
	 */
	fitWidthToDetails?: boolean;
	showMethods?: boolean;
	showFunctions?: boolean;
	showConstructors?: boolean;
	showDeprecated?: boolean;
	matchOnWordStartOnly?: boolean;
	showFields?: boolean;
	showVariables?: boolean;
	showClasses?: boolean;
	showStructs?: boolean;
	showInterfaces?: boolean;
	showModules?: boolean;
	showProperties?: boolean;
	showEvents?: boolean;
	showOperators?: boolean;
	showUnits?: boolean;
	showValues?: boolean;
	showConstants?: boolean;
	showEnums?: boolean;
	showEnumMembers?: boolean;
	showKeywords?: boolean;
	showWords?: boolean;
	showColors?: boolean;
	showFiles?: boolean;
	showReferences?: boolean;
	showFolders?: boolean;
	showTypeParameters?: boolean;
	showIssues?: boolean;
	showUsers?: boolean;
	showSnippets?: boolean;
}

/**
 * @internal
 */
export type InternalSuggestOptions = Readonly<Required<ISuggestOptions>>;

class EditorSuggest extends BaseEditorOption<EditorOption.suggest, ISuggestOptions, InternalSuggestOptions> {

	constructor() {
		const defaults: InternalSuggestOptions = {
			insertMode: 'insert',
			filterGraceful: true,
			snippetsPreventQuickSuggestions: false,
			localityBonus: false,
			shareSuggestSelections: false,
			selectionMode: 'always',
			showIcons: true,
			showStatusBar: false,
			preview: false,
			previewMode: 'subwordSmart',
			showInlineDetails: true,
			fitWidthToDetails: false,
			showMethods: true,
			showFunctions: true,
			showConstructors: true,
			showDeprecated: true,
			matchOnWordStartOnly: true,
			showFields: true,
			showVariables: true,
			showClasses: true,
			showStructs: true,
			showInterfaces: true,
			showModules: true,
			showProperties: true,
			showEvents: true,
			showOperators: true,
			showUnits: true,
			showValues: true,
			showConstants: true,
			showEnums: true,
			showEnumMembers: true,
			showKeywords: true,
			showWords: true,
			showColors: true,
			showFiles: true,
			showReferences: true,
			showFolders: true,
			showTypeParameters: true,
			showSnippets: true,
			showUsers: true,
			showIssues: true,
		};
		super(
			EditorOption.suggest, 'suggest', defaults,
			{
				'editor.suggest.insertMode': {
					type: 'string',
					enum: ['insert', 'replace'],
					enumDescriptions: [
						nls.localize('suggest.insertMode.insert', "Insert suggestion without overwriting text right of the cursor."),
						nls.localize('suggest.insertMode.replace', "Insert suggestion and overwrite text right of the cursor."),
					],
					default: defaults.insertMode,
					description: nls.localize('suggest.insertMode', "Controls whether words are overwritten when accepting completions. Note that this depends on extensions opting into this feature.")
				},
				'editor.suggest.filterGraceful': {
					type: 'boolean',
					default: defaults.filterGraceful,
					description: nls.localize('suggest.filterGraceful', "Controls whether filtering and sorting suggestions accounts for small typos.")
				},
				'editor.suggest.localityBonus': {
					type: 'boolean',
					default: defaults.localityBonus,
					description: nls.localize('suggest.localityBonus', "Controls whether sorting favors words that appear close to the cursor.")
				},
				'editor.suggest.shareSuggestSelections': {
					type: 'boolean',
					default: defaults.shareSuggestSelections,
					markdownDescription: nls.localize('suggest.shareSuggestSelections', "Controls whether remembered suggestion selections are shared between multiple workspaces and windows (needs `#editor.suggestSelection#`).")
				},
				'editor.suggest.selectionMode': {
					type: 'string',
					enum: ['always', 'never', 'whenTriggerCharacter', 'whenQuickSuggestion'],
					enumDescriptions: [
						nls.localize('suggest.insertMode.always', "Always select a suggestion when automatically triggering IntelliSense."),
						nls.localize('suggest.insertMode.never', "Never select a suggestion when automatically triggering IntelliSense."),
						nls.localize('suggest.insertMode.whenTriggerCharacter', "Select a suggestion only when triggering IntelliSense from a trigger character."),
						nls.localize('suggest.insertMode.whenQuickSuggestion', "Select a suggestion only when triggering IntelliSense as you type."),
					],
					default: defaults.selectionMode,
					markdownDescription: nls.localize('suggest.selectionMode', "Controls whether a suggestion is selected when the widget shows. Note that this only applies to automatically triggered suggestions ({0} and {1}) and that a suggestion is always selected when explicitly invoked, e.g via `Ctrl+Space`.", '`#editor.quickSuggestions#`', '`#editor.suggestOnTriggerCharacters#`')
				},
				'editor.suggest.snippetsPreventQuickSuggestions': {
					type: 'boolean',
					default: defaults.snippetsPreventQuickSuggestions,
					description: nls.localize('suggest.snippetsPreventQuickSuggestions', "Controls whether an active snippet prevents quick suggestions.")
				},
				'editor.suggest.showIcons': {
					type: 'boolean',
					default: defaults.showIcons,
					description: nls.localize('suggest.showIcons', "Controls whether to show or hide icons in suggestions.")
				},
				'editor.suggest.showStatusBar': {
					type: 'boolean',
					default: defaults.showStatusBar,
					description: nls.localize('suggest.showStatusBar', "Controls the visibility of the status bar at the bottom of the suggest widget.")
				},
				'editor.suggest.preview': {
					type: 'boolean',
					default: defaults.preview,
					description: nls.localize('suggest.preview', "Controls whether to preview the suggestion outcome in the editor.")
				},
				'editor.suggest.showInlineDetails': {
					type: 'boolean',
					default: defaults.showInlineDetails,
					description: nls.localize('suggest.showInlineDetails', "Controls whether suggest details show inline with the label or only in the details widget.")
				},
				'editor.suggest.filteredTypes': {
					type: 'object',
					deprecationMessage: nls.localize('deprecated', "This setting is deprecated, please use separate settings like 'editor.suggest.showKeywords' or 'editor.suggest.showSnippets' instead.")
				},
				'editor.suggest.showMethods': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showMethods', "When enabled IntelliSense shows `method`-suggestions.")
				},
				'editor.suggest.showFunctions': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFunctions', "When enabled IntelliSense shows `function`-suggestions.")
				},
				'editor.suggest.showConstructors': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showConstructors', "When enabled IntelliSense shows `constructor`-suggestions.")
				},
				'editor.suggest.showDeprecated': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showDeprecated', "When enabled IntelliSense shows `deprecated`-suggestions.")
				},
				'editor.suggest.matchOnWordStartOnly': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.matchOnWordStartOnly', "When enabled IntelliSense filtering requires that the first character matches on a word start. For example, `c` on `Console` or `WebContext` but _not_ on `description`. When disabled IntelliSense will show more results but still sorts them by match quality.")
				},
				'editor.suggest.showFields': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFields', "When enabled IntelliSense shows `field`-suggestions.")
				},
				'editor.suggest.showVariables': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showVariables', "When enabled IntelliSense shows `variable`-suggestions.")
				},
				'editor.suggest.showClasses': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showClasss', "When enabled IntelliSense shows `class`-suggestions.")
				},
				'editor.suggest.showStructs': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showStructs', "When enabled IntelliSense shows `struct`-suggestions.")
				},
				'editor.suggest.showInterfaces': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showInterfaces', "When enabled IntelliSense shows `interface`-suggestions.")
				},
				'editor.suggest.showModules': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showModules', "When enabled IntelliSense shows `module`-suggestions.")
				},
				'editor.suggest.showProperties': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showPropertys', "When enabled IntelliSense shows `property`-suggestions.")
				},
				'editor.suggest.showEvents': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showEvents', "When enabled IntelliSense shows `event`-suggestions.")
				},
				'editor.suggest.showOperators': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showOperators', "When enabled IntelliSense shows `operator`-suggestions.")
				},
				'editor.suggest.showUnits': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showUnits', "When enabled IntelliSense shows `unit`-suggestions.")
				},
				'editor.suggest.showValues': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showValues', "When enabled IntelliSense shows `value`-suggestions.")
				},
				'editor.suggest.showConstants': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showConstants', "When enabled IntelliSense shows `constant`-suggestions.")
				},
				'editor.suggest.showEnums': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showEnums', "When enabled IntelliSense shows `enum`-suggestions.")
				},
				'editor.suggest.showEnumMembers': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showEnumMembers', "When enabled IntelliSense shows `enumMember`-suggestions.")
				},
				'editor.suggest.showKeywords': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showKeywords', "When enabled IntelliSense shows `keyword`-suggestions.")
				},
				'editor.suggest.showWords': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showTexts', "When enabled IntelliSense shows `text`-suggestions.")
				},
				'editor.suggest.showColors': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showColors', "When enabled IntelliSense shows `color`-suggestions.")
				},
				'editor.suggest.showFiles': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFiles', "When enabled IntelliSense shows `file`-suggestions.")
				},
				'editor.suggest.showReferences': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showReferences', "When enabled IntelliSense shows `reference`-suggestions.")
				},
				'editor.suggest.showCustomcolors': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showCustomcolors', "When enabled IntelliSense shows `customcolor`-suggestions.")
				},
				'editor.suggest.showFolders': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFolders', "When enabled IntelliSense shows `folder`-suggestions.")
				},
				'editor.suggest.showTypeParameters': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showTypeParameters', "When enabled IntelliSense shows `typeParameter`-suggestions.")
				},
				'editor.suggest.showSnippets': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showSnippets', "When enabled IntelliSense shows `snippet`-suggestions.")
				},
				'editor.suggest.showUsers': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showUsers', "When enabled IntelliSense shows `user`-suggestions.")
				},
				'editor.suggest.showIssues': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showIssues', "When enabled IntelliSense shows `issues`-suggestions.")
				}
			}
		);
	}

	public validate(_input: unknown): InternalSuggestOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<ISuggestOptions>;
		return {
			insertMode: stringSet(input.insertMode, this.defaultValue.insertMode, ['insert', 'replace']),
			filterGraceful: boolean(input.filterGraceful, this.defaultValue.filterGraceful),
			snippetsPreventQuickSuggestions: boolean(input.snippetsPreventQuickSuggestions, this.defaultValue.filterGraceful),
			localityBonus: boolean(input.localityBonus, this.defaultValue.localityBonus),
			shareSuggestSelections: boolean(input.shareSuggestSelections, this.defaultValue.shareSuggestSelections),
			selectionMode: stringSet(input.selectionMode, this.defaultValue.selectionMode, ['always', 'never', 'whenQuickSuggestion', 'whenTriggerCharacter']),
			showIcons: boolean(input.showIcons, this.defaultValue.showIcons),
			showStatusBar: boolean(input.showStatusBar, this.defaultValue.showStatusBar),
			preview: boolean(input.preview, this.defaultValue.preview),
			previewMode: stringSet(input.previewMode, this.defaultValue.previewMode, ['prefix', 'subword', 'subwordSmart']),
			showInlineDetails: boolean(input.showInlineDetails, this.defaultValue.showInlineDetails),
			fitWidthToDetails: boolean(input.fitWidthToDetails, this.defaultValue.fitWidthToDetails),
			showMethods: boolean(input.showMethods, this.defaultValue.showMethods),
			showFunctions: boolean(input.showFunctions, this.defaultValue.showFunctions),
			showConstructors: boolean(input.showConstructors, this.defaultValue.showConstructors),
			showDeprecated: boolean(input.showDeprecated, this.defaultValue.showDeprecated),
			matchOnWordStartOnly: boolean(input.matchOnWordStartOnly, this.defaultValue.matchOnWordStartOnly),
			showFields: boolean(input.showFields, this.defaultValue.showFields),
			showVariables: boolean(input.showVariables, this.defaultValue.showVariables),
			showClasses: boolean(input.showClasses, this.defaultValue.showClasses),
			showStructs: boolean(input.showStructs, this.defaultValue.showStructs),
			showInterfaces: boolean(input.showInterfaces, this.defaultValue.showInterfaces),
			showModules: boolean(input.showModules, this.defaultValue.showModules),
			showProperties: boolean(input.showProperties, this.defaultValue.showProperties),
			showEvents: boolean(input.showEvents, this.defaultValue.showEvents),
			showOperators: boolean(input.showOperators, this.defaultValue.showOperators),
			showUnits: boolean(input.showUnits, this.defaultValue.showUnits),
			showValues: boolean(input.showValues, this.defaultValue.showValues),
			showConstants: boolean(input.showConstants, this.defaultValue.showConstants),
			showEnums: boolean(input.showEnums, this.defaultValue.showEnums),
			showEnumMembers: boolean(input.showEnumMembers, this.defaultValue.showEnumMembers),
			showKeywords: boolean(input.showKeywords, this.defaultValue.showKeywords),
			showWords: boolean(input.showWords, this.defaultValue.showWords),
			showColors: boolean(input.showColors, this.defaultValue.showColors),
			showFiles: boolean(input.showFiles, this.defaultValue.showFiles),
			showReferences: boolean(input.showReferences, this.defaultValue.showReferences),
			showFolders: boolean(input.showFolders, this.defaultValue.showFolders),
			showTypeParameters: boolean(input.showTypeParameters, this.defaultValue.showTypeParameters),
			showSnippets: boolean(input.showSnippets, this.defaultValue.showSnippets),
			showUsers: boolean(input.showUsers, this.defaultValue.showUsers),
			showIssues: boolean(input.showIssues, this.defaultValue.showIssues),
		};
	}
}



export interface ISmartSelectOptions {
	selectLeadingAndTrailingWhitespace?: boolean;
	selectSubwords?: boolean;
}

/**
 * @internal
 */
export type SmartSelectOptions = Readonly<Required<ISmartSelectOptions>>;

class SmartSelect extends BaseEditorOption<EditorOption.smartSelect, ISmartSelectOptions, SmartSelectOptions> {

	constructor() {
		super(
			EditorOption.smartSelect, 'smartSelect',
			{
				selectLeadingAndTrailingWhitespace: true,
				selectSubwords: true,
			},
			{
				'editor.smartSelect.selectLeadingAndTrailingWhitespace': {
					description: nls.localize('selectLeadingAndTrailingWhitespace', "Whether leading and trailing whitespace should always be selected."),
					default: true,
					type: 'boolean'
				},
				'editor.smartSelect.selectSubwords': {
					description: nls.localize('selectSubwords', "Whether subwords (like 'foo' in 'fooBar' or 'foo_bar') should be selected."),
					default: true,
					type: 'boolean'
				}
			}
		);
	}

	public validate(input: unknown): Readonly<Required<ISmartSelectOptions>> {
		if (!input || typeof input !== 'object') {
			return this.defaultValue;
		}
		return {
			selectLeadingAndTrailingWhitespace: boolean((input as ISmartSelectOptions).selectLeadingAndTrailingWhitespace, this.defaultValue.selectLeadingAndTrailingWhitespace),
			selectSubwords: boolean((input as ISmartSelectOptions).selectSubwords, this.defaultValue.selectSubwords),
		};
	}
}



class WordSegmenterLocales extends BaseEditorOption<EditorOption.wordSegmenterLocales, string | string[], string[]> {
	constructor() {
		const defaults: string[] = [];

		super(
			EditorOption.wordSegmenterLocales, 'wordSegmenterLocales', defaults,
			{
				anyOf: [
					{
						type: 'string',
					}, {
						type: 'array',
						items: {
							type: 'string'
						}
					}
				],
				description: nls.localize('wordSegmenterLocales', "Locales to be used for word segmentation when doing word related navigations or operations. Specify the BCP 47 language tag of the word you wish to recognize (e.g., ja, zh-CN, zh-Hant-TW, etc.)."),
				type: 'array',
				items: {
					type: 'string',
				},
				default: defaults,
			},
		);
	}

	public validate(input: unknown): string[] {
		if (typeof input === 'string') {
			input = [input];
		}
		if (Array.isArray(input)) {
			const validLocales: string[] = [];
			for (const locale of input) {
				if (typeof locale === 'string') {
					try {
						if (Intl.Segmenter.supportedLocalesOf(locale).length > 0) {
							validLocales.push(locale);
						}
					} catch {
					}
				}
			}
			return validLocales;
		}

		return this.defaultValue;
	}
}




export const enum WrappingIndent {
	None = 0,
	Same = 1,
	Indent = 2,
	DeepIndent = 3
}

class WrappingIndentOption extends BaseEditorOption<EditorOption.wrappingIndent, 'none' | 'same' | 'indent' | 'deepIndent', WrappingIndent> {

	constructor() {
		super(EditorOption.wrappingIndent, 'wrappingIndent', WrappingIndent.Same,
			{
				'editor.wrappingIndent': {
					type: 'string',
					enum: ['none', 'same', 'indent', 'deepIndent'],
					enumDescriptions: [
						nls.localize('wrappingIndent.none', "No indentation. Wrapped lines begin at column 1."),
						nls.localize('wrappingIndent.same', "Wrapped lines get the same indentation as the parent."),
						nls.localize('wrappingIndent.indent', "Wrapped lines get +1 indentation toward the parent."),
						nls.localize('wrappingIndent.deepIndent', "Wrapped lines get +2 indentation toward the parent."),
					],
					description: nls.localize('wrappingIndent', "Controls the indentation of wrapped lines."),
					default: 'same'
				}
			}
		);
	}

	public validate(input: unknown): WrappingIndent {
		switch (input) {
			case 'none': return WrappingIndent.None;
			case 'same': return WrappingIndent.Same;
			case 'indent': return WrappingIndent.Indent;
			case 'deepIndent': return WrappingIndent.DeepIndent;
		}
		return WrappingIndent.Same;
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: WrappingIndent): WrappingIndent {
		const accessibilitySupport = options.get(EditorOption.accessibilitySupport);
		if (accessibilitySupport === AccessibilitySupport.Enabled) {
			return WrappingIndent.None;
		}
		return value;
	}
}



export interface EditorWrappingInfo {
	readonly isDominatedByLongLines: boolean;
	readonly isWordWrapMinified: boolean;
	readonly isViewportWrapping: boolean;
	readonly wrappingColumn: number;
}

class EditorWrappingInfoComputer extends ComputedEditorOption<EditorOption.wrappingInfo, EditorWrappingInfo> {

	constructor() {
		super(EditorOption.wrappingInfo, {
			isDominatedByLongLines: false,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1
		});
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: EditorWrappingInfo): EditorWrappingInfo {
		const layoutInfo = options.get(EditorOption.layoutInfo);

		return {
			isDominatedByLongLines: env.isDominatedByLongLines,
			isWordWrapMinified: layoutInfo.isWordWrapMinified,
			isViewportWrapping: layoutInfo.isViewportWrapping,
			wrappingColumn: layoutInfo.wrappingColumn,
		};
	}
}



export interface IDropIntoEditorOptions {
	enabled?: boolean;

	showDropSelector?: 'afterDrop' | 'never';
}

/**
 * @internal
 */
export type EditorDropIntoEditorOptions = Readonly<Required<IDropIntoEditorOptions>>;

class EditorDropIntoEditor extends BaseEditorOption<EditorOption.dropIntoEditor, IDropIntoEditorOptions, EditorDropIntoEditorOptions> {

	constructor() {
		const defaults: EditorDropIntoEditorOptions = { enabled: true, showDropSelector: 'afterDrop' };
		super(
			EditorOption.dropIntoEditor, 'dropIntoEditor', defaults,
			{
				'editor.dropIntoEditor.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					markdownDescription: nls.localize('dropIntoEditor.enabled', "Controls whether you can drag and drop a file into a text editor by holding down the `Shift` key (instead of opening the file in an editor)."),
				},
				'editor.dropIntoEditor.showDropSelector': {
					type: 'string',
					markdownDescription: nls.localize('dropIntoEditor.showDropSelector', "Controls if a widget is shown when dropping files into the editor. This widget lets you control how the file is dropped."),
					enum: [
						'afterDrop',
						'never'
					],
					enumDescriptions: [
						nls.localize('dropIntoEditor.showDropSelector.afterDrop', "Show the drop selector widget after a file is dropped into the editor."),
						nls.localize('dropIntoEditor.showDropSelector.never', "Never show the drop selector widget. Instead the default drop provider is always used."),
					],
					default: 'afterDrop',
				},
			}
		);
	}

	public validate(_input: unknown): EditorDropIntoEditorOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IDropIntoEditorOptions>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			showDropSelector: stringSet(input.showDropSelector, this.defaultValue.showDropSelector, ['afterDrop', 'never']),
		};
	}
}



export interface IPasteAsOptions {
	enabled?: boolean;

	showPasteSelector?: 'afterPaste' | 'never';
}

/**
 * @internal
 */
export type EditorPasteAsOptions = Readonly<Required<IPasteAsOptions>>;

class EditorPasteAs extends BaseEditorOption<EditorOption.pasteAs, IPasteAsOptions, EditorPasteAsOptions> {

	constructor() {
		const defaults: EditorPasteAsOptions = { enabled: true, showPasteSelector: 'afterPaste' };
		super(
			EditorOption.pasteAs, 'pasteAs', defaults,
			{
				'editor.pasteAs.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					markdownDescription: nls.localize('pasteAs.enabled', "Controls whether you can paste content in different ways."),
				},
				'editor.pasteAs.showPasteSelector': {
					type: 'string',
					markdownDescription: nls.localize('pasteAs.showPasteSelector', "Controls if a widget is shown when pasting content in to the editor. This widget lets you control how the file is pasted."),
					enum: [
						'afterPaste',
						'never'
					],
					enumDescriptions: [
						nls.localize('pasteAs.showPasteSelector.afterPaste', "Show the paste selector widget after content is pasted into the editor."),
						nls.localize('pasteAs.showPasteSelector.never', "Never show the paste selector widget. Instead the default pasting behavior is always used."),
					],
					default: 'afterPaste',
				},
			}
		);
	}

	public validate(_input: unknown): EditorPasteAsOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as Unknown<IPasteAsOptions>;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			showPasteSelector: stringSet(input.showPasteSelector, this.defaultValue.showPasteSelector, ['afterPaste', 'never']),
		};
	}
}


/**
 * @internal
 */
export const editorOptionsRegistry: IEditorOption<EditorOption, unknown>[] = [];

function register<K extends EditorOption, V>(option: IEditorOption<K, V>): IEditorOption<K, V> {
	editorOptionsRegistry[option.id] = option;
	return option;
}

export const enum EditorOption {
	acceptSuggestionOnCommitCharacter,
	acceptSuggestionOnEnter,
	accessibilitySupport,
	accessibilityPageSize,
	allowOverflow,
	allowVariableLineHeights,
	allowVariableFonts,
	allowVariableFontsInAccessibilityMode,
	ariaLabel,
	ariaRequired,
	autoClosingBrackets,
	autoClosingComments,
	screenReaderAnnounceInlineSuggestion,
	autoClosingDelete,
	autoClosingOvertype,
	autoClosingQuotes,
	autoIndent,
	autoIndentOnPaste,
	autoIndentOnPasteWithinString,
	automaticLayout,
	autoSurround,
	bracketPairColorization,
	guides,
	codeLens,
	codeLensFontFamily,
	codeLensFontSize,
	colorDecorators,
	colorDecoratorsLimit,
	columnSelection,
	comments,
	contextmenu,
	copyWithSyntaxHighlighting,
	cursorBlinking,
	cursorSmoothCaretAnimation,
	cursorStyle,
	cursorSurroundingLines,
	cursorSurroundingLinesStyle,
	cursorWidth,
	cursorHeight,
	disableLayerHinting,
	disableMonospaceOptimizations,
	domReadOnly,
	dragAndDrop,
	dropIntoEditor,
	editContext,
	emptySelectionClipboard,
	experimentalGpuAcceleration,
	experimentalWhitespaceRendering,
	extraEditorClassName,
	fastScrollSensitivity,
	find,
	fixedOverflowWidgets,
	folding,
	foldingStrategy,
	foldingHighlight,
	foldingImportsByDefault,
	foldingMaximumRegions,
	unfoldOnClickAfterEndOfLine,
	fontFamily,
	fontInfo,
	fontLigatures,
	fontSize,
	fontWeight,
	fontVariations,
	formatOnPaste,
	formatOnType,
	glyphMargin,
	gotoLocation,
	hideCursorInOverviewRuler,
	hover,
	inDiffEditor,
	inlineSuggest,
	letterSpacing,
	lightbulb,
	lineDecorationsWidth,
	lineHeight,
	lineNumbers,
	lineNumbersMinChars,
	linkedEditing,
	links,
	matchBrackets,
	minimap,
	mouseStyle,
	mouseWheelScrollSensitivity,
	mouseWheelZoom,
	multiCursorMergeOverlapping,
	multiCursorModifier,
	mouseMiddleClickAction,
	multiCursorPaste,
	multiCursorLimit,
	occurrencesHighlight,
	occurrencesHighlightDelay,
	overtypeCursorStyle,
	overtypeOnPaste,
	overviewRulerBorder,
	overviewRulerLanes,
	padding,
	pasteAs,
	parameterHints,
	peekWidgetDefaultFocus,
	placeholder,
	definitionLinkOpensInPeek,
	quickSuggestions,
	quickSuggestionsDelay,
	readOnly,
	readOnlyMessage,
	renameOnType,
	renderRichScreenReaderContent,
	renderControlCharacters,
	renderFinalNewline,
	renderLineHighlight,
	renderLineHighlightOnlyWhenFocus,
	renderValidationDecorations,
	renderWhitespace,
	revealHorizontalRightPadding,
	roundedSelection,
	rulers,
	scrollbar,
	scrollBeyondLastColumn,
	scrollBeyondLastLine,
	scrollPredominantAxis,
	selectionClipboard,
	selectionHighlight,
	selectionHighlightMaxLength,
	selectionHighlightMultiline,
	selectOnLineNumbers,
	showFoldingControls,
	showUnused,
	snippetSuggestions,
	smartSelect,
	smoothScrolling,
	stickyScroll,
	stickyTabStops,
	stopRenderingLineAfter,
	suggest,
	suggestFontSize,
	suggestLineHeight,
	suggestOnTriggerCharacters,
	suggestSelection,
	tabCompletion,
	tabIndex,
	trimWhitespaceOnDelete,
	unicodeHighlighting,
	unusualLineTerminators,
	useShadowDOM,
	useTabStops,
	wordBreak,
	wordSegmenterLocales,
	wordSeparators,
	wordWrap,
	wordWrapBreakAfterCharacters,
	wordWrapBreakBeforeCharacters,
	wordWrapColumn,
	wordWrapOverride1,
	wordWrapOverride2,
	wordWrapIndicator,
	wrappingIndent,
	wrappingStrategy,
	showDeprecated,
	inertialScroll,
	inlayHints,
	wrapOnEscapedLineFeeds,
	effectiveCursorStyle,
	editorClassName,
	pixelRatio,
	tabFocusMode,
	layoutInfo,
	wrappingInfo,
	defaultColorDecorators,
	colorDecoratorsActivatedOn,
	inlineCompletionsAccessibilityVerbose,
	effectiveEditContext,
	scrollOnMiddleClick,
	effectiveAllowVariableFonts,
	doubleClickSelectsBlock
}

export const EditorOptions = {
	acceptSuggestionOnCommitCharacter: register(new EditorBooleanOption(
		EditorOption.acceptSuggestionOnCommitCharacter, 'acceptSuggestionOnCommitCharacter', true,
		{ markdownDescription: nls.localize('acceptSuggestionOnCommitCharacter', "Controls whether suggestions should be accepted on commit characters. For example, in JavaScript, the semi-colon (`;`) can be a commit character that accepts a suggestion and types that character.") }
	)),
	acceptSuggestionOnEnter: register(new EditorStringEnumOption(
		EditorOption.acceptSuggestionOnEnter, 'acceptSuggestionOnEnter',
		'on' as 'on' | 'smart' | 'off',
		['on', 'smart', 'off'] as const,
		{
			markdownEnumDescriptions: [
				'',
				nls.localize('acceptSuggestionOnEnterSmart', "Only accept a suggestion with `Enter` when it makes a textual change."),
				''
			],
			markdownDescription: nls.localize('acceptSuggestionOnEnter', "Controls whether suggestions should be accepted on `Enter`, in addition to `Tab`. Helps to avoid ambiguity between inserting new lines or accepting suggestions.")
		}
	)),
	accessibilitySupport: register(new EditorAccessibilitySupport()),
	accessibilityPageSize: register(new EditorIntOption(EditorOption.accessibilityPageSize, 'accessibilityPageSize', 500, 1, Constants.MAX_SAFE_SMALL_INTEGER,
		{
			description: nls.localize('accessibilityPageSize', "Controls the number of lines in the editor that can be read out by a screen reader at once. When we detect a screen reader we automatically set the default to be 500. Warning: this has a performance implication for numbers larger than the default."),
			tags: ['accessibility']
		}
	)),
	allowOverflow: register(new EditorBooleanOption(
		EditorOption.allowOverflow, 'allowOverflow', true,
	)),
	allowVariableLineHeights: register(new EditorBooleanOption(
		EditorOption.allowVariableLineHeights, 'allowVariableLineHeights', true,
		{
			description: nls.localize('allowVariableLineHeights', "Controls whether to allow using variable line heights in the editor.")
		}
	)),
	allowVariableFonts: register(new EditorBooleanOption(
		EditorOption.allowVariableFonts, 'allowVariableFonts', true,
		{
			description: nls.localize('allowVariableFonts', "Controls whether to allow using variable fonts in the editor.")
		}
	)),
	allowVariableFontsInAccessibilityMode: register(new EditorBooleanOption(
		EditorOption.allowVariableFontsInAccessibilityMode, 'allowVariableFontsInAccessibilityMode', false,
		{
			description: nls.localize('allowVariableFontsInAccessibilityMode', "Controls whether to allow using variable fonts in the editor in the accessibility mode."),
			tags: ['accessibility']
		}
	)),
	ariaLabel: register(new EditorStringOption(
		EditorOption.ariaLabel, 'ariaLabel', nls.localize('editorViewAccessibleLabel', "Editor content")
	)),
	ariaRequired: register(new EditorBooleanOption(
		EditorOption.ariaRequired, 'ariaRequired', false, undefined
	)),
	screenReaderAnnounceInlineSuggestion: register(new EditorBooleanOption(
		EditorOption.screenReaderAnnounceInlineSuggestion, 'screenReaderAnnounceInlineSuggestion', true,
		{
			description: nls.localize('screenReaderAnnounceInlineSuggestion', "Control whether inline suggestions are announced by a screen reader."),
			tags: ['accessibility']
		}
	)),
	autoClosingBrackets: register(new EditorStringEnumOption(
		EditorOption.autoClosingBrackets, 'autoClosingBrackets',
		'languageDefined' as 'always' | 'languageDefined' | 'beforeWhitespace' | 'never',
		['always', 'languageDefined', 'beforeWhitespace', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingBrackets.languageDefined', "Use language configurations to determine when to autoclose brackets."),
				nls.localize('editor.autoClosingBrackets.beforeWhitespace', "Autoclose brackets only when the cursor is to the left of whitespace."),
				'',
			],
			description: nls.localize('autoClosingBrackets', "Controls whether the editor should automatically close brackets after the user adds an opening bracket.")
		}
	)),
	autoClosingComments: register(new EditorStringEnumOption(
		EditorOption.autoClosingComments, 'autoClosingComments',
		'languageDefined' as 'always' | 'languageDefined' | 'beforeWhitespace' | 'never',
		['always', 'languageDefined', 'beforeWhitespace', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingComments.languageDefined', "Use language configurations to determine when to autoclose comments."),
				nls.localize('editor.autoClosingComments.beforeWhitespace', "Autoclose comments only when the cursor is to the left of whitespace."),
				'',
			],
			description: nls.localize('autoClosingComments', "Controls whether the editor should automatically close comments after the user adds an opening comment.")
		}
	)),
	autoClosingDelete: register(new EditorStringEnumOption(
		EditorOption.autoClosingDelete, 'autoClosingDelete',
		'auto' as 'always' | 'auto' | 'never',
		['always', 'auto', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingDelete.auto', "Remove adjacent closing quotes or brackets only if they were automatically inserted."),
				'',
			],
			description: nls.localize('autoClosingDelete', "Controls whether the editor should remove adjacent closing quotes or brackets when deleting.")
		}
	)),
	autoClosingOvertype: register(new EditorStringEnumOption(
		EditorOption.autoClosingOvertype, 'autoClosingOvertype',
		'auto' as 'always' | 'auto' | 'never',
		['always', 'auto', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingOvertype.auto', "Type over closing quotes or brackets only if they were automatically inserted."),
				'',
			],
			description: nls.localize('autoClosingOvertype', "Controls whether the editor should type over closing quotes or brackets.")
		}
	)),
	autoClosingQuotes: register(new EditorStringEnumOption(
		EditorOption.autoClosingQuotes, 'autoClosingQuotes',
		'languageDefined' as 'always' | 'languageDefined' | 'beforeWhitespace' | 'never',
		['always', 'languageDefined', 'beforeWhitespace', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingQuotes.languageDefined', "Use language configurations to determine when to autoclose quotes."),
				nls.localize('editor.autoClosingQuotes.beforeWhitespace', "Autoclose quotes only when the cursor is to the left of whitespace."),
				'',
			],
			description: nls.localize('autoClosingQuotes', "Controls whether the editor should automatically close quotes after the user adds an opening quote.")
		}
	)),
	autoIndent: register(new EditorEnumOption(
		EditorOption.autoIndent, 'autoIndent',
		EditorAutoIndentStrategy.Full, 'full',
		['none', 'keep', 'brackets', 'advanced', 'full'],
		_autoIndentFromString,
		{
			enumDescriptions: [
				nls.localize('editor.autoIndent.none', "The editor will not insert indentation automatically."),
				nls.localize('editor.autoIndent.keep', "The editor will keep the current line's indentation."),
				nls.localize('editor.autoIndent.brackets', "The editor will keep the current line's indentation and honor language defined brackets."),
				nls.localize('editor.autoIndent.advanced', "The editor will keep the current line's indentation, honor language defined brackets and invoke special onEnterRules defined by languages."),
				nls.localize('editor.autoIndent.full', "The editor will keep the current line's indentation, honor language defined brackets, invoke special onEnterRules defined by languages, and honor indentationRules defined by languages."),
			],
			description: nls.localize('autoIndent', "Controls whether the editor should automatically adjust the indentation when users type, paste, move or indent lines.")
		}
	)),
	autoIndentOnPaste: register(new EditorBooleanOption(
		EditorOption.autoIndentOnPaste, 'autoIndentOnPaste', false,
		{ description: nls.localize('autoIndentOnPaste', "Controls whether the editor should automatically auto-indent the pasted content.") }
	)),
	autoIndentOnPasteWithinString: register(new EditorBooleanOption(
		EditorOption.autoIndentOnPasteWithinString, 'autoIndentOnPasteWithinString', true,
		{ description: nls.localize('autoIndentOnPasteWithinString', "Controls whether the editor should automatically auto-indent the pasted content when pasted within a string. This takes effect when autoIndentOnPaste is true.") }
	)),
	automaticLayout: register(new EditorBooleanOption(
		EditorOption.automaticLayout, 'automaticLayout', false,
	)),
	autoSurround: register(new EditorStringEnumOption(
		EditorOption.autoSurround, 'autoSurround',
		'languageDefined' as 'languageDefined' | 'quotes' | 'brackets' | 'never',
		['languageDefined', 'quotes', 'brackets', 'never'] as const,
		{
			enumDescriptions: [
				nls.localize('editor.autoSurround.languageDefined', "Use language configurations to determine when to automatically surround selections."),
				nls.localize('editor.autoSurround.quotes', "Surround with quotes but not brackets."),
				nls.localize('editor.autoSurround.brackets', "Surround with brackets but not quotes."),
				''
			],
			description: nls.localize('autoSurround', "Controls whether the editor should automatically surround selections when typing quotes or brackets.")
		}
	)),
	bracketPairColorization: register(new BracketPairColorization()),
	bracketPairGuides: register(new GuideOptions()),
	stickyTabStops: register(new EditorBooleanOption(
		EditorOption.stickyTabStops, 'stickyTabStops', false,
		{ description: nls.localize('stickyTabStops', "Emulate selection behavior of tab characters when using spaces for indentation. Selection will stick to tab stops.") }
	)),
	codeLens: register(new EditorBooleanOption(
		EditorOption.codeLens, 'codeLens', true,
		{ description: nls.localize('codeLens', "Controls whether the editor shows CodeLens.") }
	)),
	codeLensFontFamily: register(new EditorStringOption(
		EditorOption.codeLensFontFamily, 'codeLensFontFamily', '',
		{ description: nls.localize('codeLensFontFamily', "Controls the font family for CodeLens.") }
	)),
	codeLensFontSize: register(new EditorIntOption(EditorOption.codeLensFontSize, 'codeLensFontSize', 0, 0, 100, {
		type: 'number',
		default: 0,
		minimum: 0,
		maximum: 100,
		markdownDescription: nls.localize('codeLensFontSize', "Controls the font size in pixels for CodeLens. When set to 0, 90% of `#editor.fontSize#` is used.")
	})),
	colorDecorators: register(new EditorBooleanOption(
		EditorOption.colorDecorators, 'colorDecorators', true,
		{ description: nls.localize('colorDecorators', "Controls whether the editor should render the inline color decorators and color picker.") }
	)),
	colorDecoratorActivatedOn: register(new EditorStringEnumOption(EditorOption.colorDecoratorsActivatedOn, 'colorDecoratorsActivatedOn', 'clickAndHover' as 'clickAndHover' | 'hover' | 'click', ['clickAndHover', 'hover', 'click'] as const, {
		enumDescriptions: [
			nls.localize('editor.colorDecoratorActivatedOn.clickAndHover', "Make the color picker appear both on click and hover of the color decorator"),
			nls.localize('editor.colorDecoratorActivatedOn.hover', "Make the color picker appear on hover of the color decorator"),
			nls.localize('editor.colorDecoratorActivatedOn.click', "Make the color picker appear on click of the color decorator")
		],
		description: nls.localize('colorDecoratorActivatedOn', "Controls the condition to make a color picker appear from a color decorator.")
	})),
	colorDecoratorsLimit: register(new EditorIntOption(
		EditorOption.colorDecoratorsLimit, 'colorDecoratorsLimit', 500, 1, 1000000,
		{
			markdownDescription: nls.localize('colorDecoratorsLimit', "Controls the max number of color decorators that can be rendered in an editor at once.")
		}
	)),
	columnSelection: register(new EditorBooleanOption(
		EditorOption.columnSelection, 'columnSelection', false,
		{ description: nls.localize('columnSelection', "Enable that the selection with the mouse and keys is doing column selection.") }
	)),
	comments: register(new EditorComments()),
	contextmenu: register(new EditorBooleanOption(
		EditorOption.contextmenu, 'contextmenu', true,
	)),
	copyWithSyntaxHighlighting: register(new EditorBooleanOption(
		EditorOption.copyWithSyntaxHighlighting, 'copyWithSyntaxHighlighting', true,
		{ description: nls.localize('copyWithSyntaxHighlighting', "Controls whether syntax highlighting should be copied into the clipboard.") }
	)),
	cursorBlinking: register(new EditorEnumOption(
		EditorOption.cursorBlinking, 'cursorBlinking',
		TextEditorCursorBlinkingStyle.Blink, 'blink',
		['blink', 'smooth', 'phase', 'expand', 'solid'],
		cursorBlinkingStyleFromString,
		{ description: nls.localize('cursorBlinking', "Control the cursor animation style.") }
	)),
	cursorSmoothCaretAnimation: register(new EditorStringEnumOption(
		EditorOption.cursorSmoothCaretAnimation, 'cursorSmoothCaretAnimation',
		'off' as 'off' | 'explicit' | 'on',
		['off', 'explicit', 'on'] as const,
		{
			enumDescriptions: [
				nls.localize('cursorSmoothCaretAnimation.off', "Smooth caret animation is disabled."),
				nls.localize('cursorSmoothCaretAnimation.explicit', "Smooth caret animation is enabled only when the user moves the cursor with an explicit gesture."),
				nls.localize('cursorSmoothCaretAnimation.on', "Smooth caret animation is always enabled.")
			],
			description: nls.localize('cursorSmoothCaretAnimation', "Controls whether the smooth caret animation should be enabled.")
		}
	)),
	cursorStyle: register(new EditorEnumOption(
		EditorOption.cursorStyle, 'cursorStyle',
		TextEditorCursorStyle.Line, 'line',
		['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'],
		cursorStyleFromString,
		{ description: nls.localize('cursorStyle', "Controls the cursor style in insert input mode.") }
	)),
	overtypeCursorStyle: register(new EditorEnumOption(
		EditorOption.overtypeCursorStyle, 'overtypeCursorStyle',
		TextEditorCursorStyle.Block, 'block',
		['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'],
		cursorStyleFromString,
		{ description: nls.localize('overtypeCursorStyle', "Controls the cursor style in overtype input mode.") }
	)),
	cursorSurroundingLines: register(new EditorIntOption(
		EditorOption.cursorSurroundingLines, 'cursorSurroundingLines',
		0, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ description: nls.localize('cursorSurroundingLines', "Controls the minimal number of visible leading lines (minimum 0) and trailing lines (minimum 1) surrounding the cursor. Known as 'scrollOff' or 'scrollOffset' in some other editors.") }
	)),
	cursorSurroundingLinesStyle: register(new EditorStringEnumOption(
		EditorOption.cursorSurroundingLinesStyle, 'cursorSurroundingLinesStyle',
		'default' as 'default' | 'all',
		['default', 'all'] as const,
		{
			enumDescriptions: [
				nls.localize('cursorSurroundingLinesStyle.default', "`cursorSurroundingLines` is enforced only when triggered via the keyboard or API."),
				nls.localize('cursorSurroundingLinesStyle.all', "`cursorSurroundingLines` is enforced always.")
			],
			markdownDescription: nls.localize('cursorSurroundingLinesStyle', "Controls when `#editor.cursorSurroundingLines#` should be enforced.")
		}
	)),
	cursorWidth: register(new EditorIntOption(
		EditorOption.cursorWidth, 'cursorWidth',
		0, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ markdownDescription: nls.localize('cursorWidth', "Controls the width of the cursor when `#editor.cursorStyle#` is set to `line`.") }
	)),
	cursorHeight: register(new EditorIntOption(
		EditorOption.cursorHeight, 'cursorHeight',
		0, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ markdownDescription: nls.localize('cursorHeight', "Controls the height of the cursor when `#editor.cursorStyle#` is set to `line`. Cursor's max height depends on line height.") }
	)),
	disableLayerHinting: register(new EditorBooleanOption(
		EditorOption.disableLayerHinting, 'disableLayerHinting', false,
	)),
	disableMonospaceOptimizations: register(new EditorBooleanOption(
		EditorOption.disableMonospaceOptimizations, 'disableMonospaceOptimizations', false
	)),
	domReadOnly: register(new EditorBooleanOption(
		EditorOption.domReadOnly, 'domReadOnly', false,
	)),
	doubleClickSelectsBlock: register(new EditorBooleanOption(
		EditorOption.doubleClickSelectsBlock, 'doubleClickSelectsBlock', true,
		{ description: nls.localize('doubleClickSelectsBlock', "Controls whether double-clicking next to a bracket or quote selects the content inside.") }
	)),
	dragAndDrop: register(new EditorBooleanOption(
		EditorOption.dragAndDrop, 'dragAndDrop', true,
		{ description: nls.localize('dragAndDrop', "Controls whether the editor should allow moving selections via drag and drop.") }
	)),
	emptySelectionClipboard: register(new EditorEmptySelectionClipboard()),
	dropIntoEditor: register(new EditorDropIntoEditor()),
	editContext: register(new EditorBooleanOption(
		EditorOption.editContext, 'editContext', true,
		{
			description: nls.localize('editContext', "Sets whether the EditContext API should be used instead of the text area to power input in the editor."),
			included: platform.isChrome || platform.isEdge || platform.isNative
		}
	)),
	renderRichScreenReaderContent: register(new EditorBooleanOption(
		EditorOption.renderRichScreenReaderContent, 'renderRichScreenReaderContent', false,
		{
			markdownDescription: nls.localize('renderRichScreenReaderContent', "Whether to render rich screen reader content when the `#editor.editContext#` setting is enabled."),
		}
	)),
	stickyScroll: register(new EditorStickyScroll()),
	experimentalGpuAcceleration: register(new EditorStringEnumOption(
		EditorOption.experimentalGpuAcceleration, 'experimentalGpuAcceleration',
		'off' as 'off' | 'on',
		['off', 'on'] as const,
		{
			tags: ['experimental'],
			enumDescriptions: [
				nls.localize('experimentalGpuAcceleration.off', "Use regular DOM-based rendering."),
				nls.localize('experimentalGpuAcceleration.on', "Use GPU acceleration."),
			],
			description: nls.localize('experimentalGpuAcceleration', "Controls whether to use the experimental GPU acceleration to render the editor.")
		}
	)),
	experimentalWhitespaceRendering: register(new EditorStringEnumOption(
		EditorOption.experimentalWhitespaceRendering, 'experimentalWhitespaceRendering',
		'svg' as 'svg' | 'font' | 'off',
		['svg', 'font', 'off'] as const,
		{
			enumDescriptions: [
				nls.localize('experimentalWhitespaceRendering.svg', "Use a new rendering method with svgs."),
				nls.localize('experimentalWhitespaceRendering.font', "Use a new rendering method with font characters."),
				nls.localize('experimentalWhitespaceRendering.off', "Use the stable rendering method."),
			],
			description: nls.localize('experimentalWhitespaceRendering', "Controls whether whitespace is rendered with a new, experimental method.")
		}
	)),
	extraEditorClassName: register(new EditorStringOption(
		EditorOption.extraEditorClassName, 'extraEditorClassName', '',
	)),
	fastScrollSensitivity: register(new EditorFloatOption(
		EditorOption.fastScrollSensitivity, 'fastScrollSensitivity',
		5, x => (x <= 0 ? 5 : x),
		{ markdownDescription: nls.localize('fastScrollSensitivity', "Scrolling speed multiplier when pressing `Alt`.") }
	)),
	find: register(new EditorFind()),
	fixedOverflowWidgets: register(new EditorBooleanOption(
		EditorOption.fixedOverflowWidgets, 'fixedOverflowWidgets', false,
	)),
	folding: register(new EditorBooleanOption(
		EditorOption.folding, 'folding', true,
		{ description: nls.localize('folding', "Controls whether the editor has code folding enabled.") }
	)),
	foldingStrategy: register(new EditorStringEnumOption(
		EditorOption.foldingStrategy, 'foldingStrategy',
		'auto' as 'auto' | 'indentation',
		['auto', 'indentation'] as const,
		{
			enumDescriptions: [
				nls.localize('foldingStrategy.auto', "Use a language-specific folding strategy if available, else the indentation-based one."),
				nls.localize('foldingStrategy.indentation', "Use the indentation-based folding strategy."),
			],
			description: nls.localize('foldingStrategy', "Controls the strategy for computing folding ranges.")
		}
	)),
	foldingHighlight: register(new EditorBooleanOption(
		EditorOption.foldingHighlight, 'foldingHighlight', true,
		{ description: nls.localize('foldingHighlight', "Controls whether the editor should highlight folded ranges.") }
	)),
	foldingImportsByDefault: register(new EditorBooleanOption(
		EditorOption.foldingImportsByDefault, 'foldingImportsByDefault', false,
		{ description: nls.localize('foldingImportsByDefault', "Controls whether the editor automatically collapses import ranges.") }
	)),
	foldingMaximumRegions: register(new EditorIntOption(
		EditorOption.foldingMaximumRegions, 'foldingMaximumRegions',
		5000, 10, 65000,
		{ description: nls.localize('foldingMaximumRegions', "The maximum number of foldable regions. Increasing this value may result in the editor becoming less responsive when the current source has a large number of foldable regions.") }
	)),
	unfoldOnClickAfterEndOfLine: register(new EditorBooleanOption(
		EditorOption.unfoldOnClickAfterEndOfLine, 'unfoldOnClickAfterEndOfLine', false,
		{ description: nls.localize('unfoldOnClickAfterEndOfLine', "Controls whether clicking on the empty content after a folded line will unfold the line.") }
	)),
	fontFamily: register(new EditorStringOption(
		EditorOption.fontFamily, 'fontFamily', EDITOR_FONT_DEFAULTS.fontFamily,
		{ description: nls.localize('fontFamily', "Controls the font family.") }
	)),
	fontInfo: register(new EditorFontInfo()),
	fontLigatures2: register(new EditorFontLigatures()),
	fontSize: register(new EditorFontSize()),
	fontWeight: register(new EditorFontWeight()),
	fontVariations: register(new EditorFontVariations()),
	formatOnPaste: register(new EditorBooleanOption(
		EditorOption.formatOnPaste, 'formatOnPaste', false,
		{ description: nls.localize('formatOnPaste', "Controls whether the editor should automatically format the pasted content. A formatter must be available and the formatter should be able to format a range in a document.") }
	)),
	formatOnType: register(new EditorBooleanOption(
		EditorOption.formatOnType, 'formatOnType', false,
		{ description: nls.localize('formatOnType', "Controls whether the editor should automatically format the line after typing.") }
	)),
	glyphMargin: register(new EditorBooleanOption(
		EditorOption.glyphMargin, 'glyphMargin', true,
		{ description: nls.localize('glyphMargin', "Controls whether the editor should render the vertical glyph margin. Glyph margin is mostly used for debugging.") }
	)),
	gotoLocation: register(new EditorGoToLocation()),
	hideCursorInOverviewRuler: register(new EditorBooleanOption(
		EditorOption.hideCursorInOverviewRuler, 'hideCursorInOverviewRuler', false,
		{ description: nls.localize('hideCursorInOverviewRuler', "Controls whether the cursor should be hidden in the overview ruler.") }
	)),
	hover: register(new EditorHover()),
	inDiffEditor: register(new EditorBooleanOption(
		EditorOption.inDiffEditor, 'inDiffEditor', false
	)),
	inertialScroll: register(new EditorBooleanOption(
		EditorOption.inertialScroll, 'inertialScroll', false,
		{ description: nls.localize('inertialScroll', "Make scrolling inertial - mostly useful with touchpad on linux.") }
	)),
	letterSpacing: register(new EditorFloatOption(
		EditorOption.letterSpacing, 'letterSpacing',
		EDITOR_FONT_DEFAULTS.letterSpacing, x => EditorFloatOption.clamp(x, -5, 20),
		{ description: nls.localize('letterSpacing', "Controls the letter spacing in pixels.") }
	)),
	lightbulb: register(new EditorLightbulb()),
	lineDecorationsWidth: register(new EditorLineDecorationsWidth()),
	lineHeight: register(new EditorLineHeight()),
	lineNumbers: register(new EditorRenderLineNumbersOption()),
	lineNumbersMinChars: register(new EditorIntOption(
		EditorOption.lineNumbersMinChars, 'lineNumbersMinChars',
		5, 1, 300
	)),
	linkedEditing: register(new EditorBooleanOption(
		EditorOption.linkedEditing, 'linkedEditing', false,
		{ description: nls.localize('linkedEditing', "Controls whether the editor has linked editing enabled. Depending on the language, related symbols such as HTML tags, are updated while editing.") }
	)),
	links: register(new EditorBooleanOption(
		EditorOption.links, 'links', true,
		{ description: nls.localize('links', "Controls whether the editor should detect links and make them clickable.") }
	)),
	matchBrackets: register(new EditorStringEnumOption(
		EditorOption.matchBrackets, 'matchBrackets',
		'always' as 'never' | 'near' | 'always',
		['always', 'near', 'never'] as const,
		{ description: nls.localize('matchBrackets', "Highlight matching brackets.") }
	)),
	minimap: register(new EditorMinimap()),
	mouseStyle: register(new EditorStringEnumOption(
		EditorOption.mouseStyle, 'mouseStyle',
		'text' as 'text' | 'default' | 'copy',
		['text', 'default', 'copy'] as const,
	)),
	mouseWheelScrollSensitivity: register(new EditorFloatOption(
		EditorOption.mouseWheelScrollSensitivity, 'mouseWheelScrollSensitivity',
		1, x => (x === 0 ? 1 : x),
		{ markdownDescription: nls.localize('mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events.") }
	)),
	mouseWheelZoom: register(new EditorBooleanOption(
		EditorOption.mouseWheelZoom, 'mouseWheelZoom', false,
		{
			markdownDescription: platform.isMacintosh
				? nls.localize('mouseWheelZoom.mac', "Zoom the font of the editor when using mouse wheel and holding `Cmd`.")
				: nls.localize('mouseWheelZoom', "Zoom the font of the editor when using mouse wheel and holding `Ctrl`.")
		}
	)),
	multiCursorMergeOverlapping: register(new EditorBooleanOption(
		EditorOption.multiCursorMergeOverlapping, 'multiCursorMergeOverlapping', true,
		{ description: nls.localize('multiCursorMergeOverlapping', "Merge multiple cursors when they are overlapping.") }
	)),
	multiCursorModifier: register(new EditorEnumOption(
		EditorOption.multiCursorModifier, 'multiCursorModifier',
		'altKey', 'alt',
		['ctrlCmd', 'alt'],
		_multiCursorModifierFromString,
		{
			markdownEnumDescriptions: [
				nls.localize('multiCursorModifier.ctrlCmd', "Maps to `Control` on Windows and Linux and to `Command` on macOS."),
				nls.localize('multiCursorModifier.alt', "Maps to `Alt` on Windows and Linux and to `Option` on macOS.")
			],
			markdownDescription: nls.localize({
				key: 'multiCursorModifier',
				comment: [
					'- `ctrlCmd` refers to a value the setting can take and should not be localized.',
					'- `Control` and `Command` refer to the modifier keys Ctrl or Cmd on the keyboard and can be localized.'
				]
			}, "The modifier to be used to add multiple cursors with the mouse. The Go to Definition and Open Link mouse gestures will adapt such that they do not conflict with the [multicursor modifier](https://www.dardcor-code.web.id/docs/editor/codebasics#_multicursor-modifier).")
		}
	)),
	mouseMiddleClickAction: register(new EditorStringEnumOption(
		EditorOption.mouseMiddleClickAction, 'mouseMiddleClickAction', 'default' as MouseMiddleClickAction,
		['default', 'openLink', 'ctrlLeftClick'] as MouseMiddleClickAction[],
		{ description: nls.localize('mouseMiddleClickAction', "Controls what happens when middle mouse button is clicked in the editor.") }
	)),
	multiCursorPaste: register(new EditorStringEnumOption(
		EditorOption.multiCursorPaste, 'multiCursorPaste',
		'spread' as 'spread' | 'full',
		['spread', 'full'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('multiCursorPaste.spread', "Each cursor pastes a single line of the text."),
				nls.localize('multiCursorPaste.full', "Each cursor pastes the full text.")
			],
			markdownDescription: nls.localize('multiCursorPaste', "Controls pasting when the line count of the pasted text matches the cursor count.")
		}
	)),
	multiCursorLimit: register(new EditorIntOption(
		EditorOption.multiCursorLimit, 'multiCursorLimit', 10000, 1, 100000,
		{
			markdownDescription: nls.localize('multiCursorLimit', "Controls the max number of cursors that can be in an active editor at once.")
		}
	)),
	occurrencesHighlight: register(new EditorStringEnumOption(
		EditorOption.occurrencesHighlight, 'occurrencesHighlight',
		'singleFile' as 'off' | 'singleFile' | 'multiFile',
		['off', 'singleFile', 'multiFile'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('occurrencesHighlight.off', "Does not highlight occurrences."),
				nls.localize('occurrencesHighlight.singleFile', "Highlights occurrences only in the current file."),
				nls.localize('occurrencesHighlight.multiFile', "Experimental: Highlights occurrences across all valid open files.")
			],
			markdownDescription: nls.localize('occurrencesHighlight', "Controls whether occurrences should be highlighted across open files.")
		}
	)),
	occurrencesHighlightDelay: register(new EditorIntOption(
		EditorOption.occurrencesHighlightDelay, 'occurrencesHighlightDelay',
		0, 0, 2000,
		{
			description: nls.localize('occurrencesHighlightDelay', "Controls the delay in milliseconds after which occurrences are highlighted."),
			tags: ['preview']
		}
	)),
	overtypeOnPaste: register(new EditorBooleanOption(
		EditorOption.overtypeOnPaste, 'overtypeOnPaste', true,
		{ description: nls.localize('overtypeOnPaste', "Controls whether pasting should overtype.") }
	)),
	overviewRulerBorder: register(new EditorBooleanOption(
		EditorOption.overviewRulerBorder, 'overviewRulerBorder', true,
		{ description: nls.localize('overviewRulerBorder', "Controls whether a border should be drawn around the overview ruler.") }
	)),
	overviewRulerLanes: register(new EditorIntOption(
		EditorOption.overviewRulerLanes, 'overviewRulerLanes',
		3, 0, 3
	)),
	padding: register(new EditorPadding()),
	pasteAs: register(new EditorPasteAs()),
	parameterHints: register(new EditorParameterHints()),
	peekWidgetDefaultFocus: register(new EditorStringEnumOption(
		EditorOption.peekWidgetDefaultFocus, 'peekWidgetDefaultFocus',
		'tree' as 'tree' | 'editor',
		['tree', 'editor'] as const,
		{
			enumDescriptions: [
				nls.localize('peekWidgetDefaultFocus.tree', "Focus the tree when opening peek"),
				nls.localize('peekWidgetDefaultFocus.editor', "Focus the editor when opening peek")
			],
			description: nls.localize('peekWidgetDefaultFocus', "Controls whether to focus the inline editor or the tree in the peek widget.")
		}
	)),
	placeholder: register(new PlaceholderOption()),
	definitionLinkOpensInPeek: register(new EditorBooleanOption(
		EditorOption.definitionLinkOpensInPeek, 'definitionLinkOpensInPeek', false,
		{ description: nls.localize('definitionLinkOpensInPeek', "Controls whether the Go to Definition mouse gesture always opens the peek widget.") }
	)),
	quickSuggestions: register(new EditorQuickSuggestions()),
	quickSuggestionsDelay: register(new EditorIntOption(
		EditorOption.quickSuggestionsDelay, 'quickSuggestionsDelay',
		10, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{
			description: nls.localize('quickSuggestionsDelay', "Controls the delay in milliseconds after which quick suggestions will show up."),
			experiment: {
				mode: 'auto'
			}
		}
	)),
	readOnly: register(new EditorBooleanOption(
		EditorOption.readOnly, 'readOnly', false,
	)),
	readOnlyMessage: register(new ReadonlyMessage()),
	renameOnType: register(new EditorBooleanOption(
		EditorOption.renameOnType, 'renameOnType', false,
		{ description: nls.localize('renameOnType', "Controls whether the editor auto renames on type."), markdownDeprecationMessage: nls.localize('renameOnTypeDeprecate', "Deprecated, use `#editor.linkedEditing#` instead.") }
	)),
	renderControlCharacters: register(new EditorBooleanOption(
		EditorOption.renderControlCharacters, 'renderControlCharacters', true,
		{ description: nls.localize('renderControlCharacters', "Controls whether the editor should render control characters."), restricted: true }
	)),
	renderFinalNewline: register(new EditorStringEnumOption(
		EditorOption.renderFinalNewline, 'renderFinalNewline',
		(platform.isLinux ? 'dimmed' : 'on') as 'off' | 'on' | 'dimmed',
		['off', 'on', 'dimmed'] as const,
		{ description: nls.localize('renderFinalNewline', "Render last line number when the file ends with a newline.") }
	)),
	renderLineHighlight: register(new EditorStringEnumOption(
		EditorOption.renderLineHighlight, 'renderLineHighlight',
		'line' as 'none' | 'gutter' | 'line' | 'all',
		['none', 'gutter', 'line', 'all'] as const,
		{
			enumDescriptions: [
				'',
				'',
				'',
				nls.localize('renderLineHighlight.all', "Highlights both the gutter and the current line."),
			],
			description: nls.localize('renderLineHighlight', "Controls how the editor should render the current line highlight.")
		}
	)),
	renderLineHighlightOnlyWhenFocus: register(new EditorBooleanOption(
		EditorOption.renderLineHighlightOnlyWhenFocus, 'renderLineHighlightOnlyWhenFocus', false,
		{ description: nls.localize('renderLineHighlightOnlyWhenFocus', "Controls if the editor should render the current line highlight only when the editor is focused.") }
	)),
	renderValidationDecorations: register(new EditorStringEnumOption(
		EditorOption.renderValidationDecorations, 'renderValidationDecorations',
		'editable' as 'editable' | 'on' | 'off',
		['editable', 'on', 'off'] as const
	)),
	renderWhitespace: register(new EditorStringEnumOption(
		EditorOption.renderWhitespace, 'renderWhitespace',
		'selection' as 'selection' | 'none' | 'boundary' | 'trailing' | 'all',
		['none', 'boundary', 'selection', 'trailing', 'all'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('renderWhitespace.boundary', "Render whitespace characters except for single spaces between words."),
				nls.localize('renderWhitespace.selection', "Render whitespace characters only on selected text."),
				nls.localize('renderWhitespace.trailing', "Render only trailing whitespace characters."),
				''
			],
			description: nls.localize('renderWhitespace', "Controls how the editor should render whitespace characters.")
		}
	)),
	revealHorizontalRightPadding: register(new EditorIntOption(
		EditorOption.revealHorizontalRightPadding, 'revealHorizontalRightPadding',
		15, 0, 1000,
	)),
	roundedSelection: register(new EditorBooleanOption(
		EditorOption.roundedSelection, 'roundedSelection', true,
		{ description: nls.localize('roundedSelection', "Controls whether selections should have rounded corners.") }
	)),
	rulers: register(new EditorRulers()),
	scrollbar: register(new EditorScrollbar()),
	scrollBeyondLastColumn: register(new EditorIntOption(
		EditorOption.scrollBeyondLastColumn, 'scrollBeyondLastColumn',
		4, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ description: nls.localize('scrollBeyondLastColumn', "Controls the number of extra characters beyond which the editor will scroll horizontally.") }
	)),
	scrollBeyondLastLine: register(new EditorBooleanOption(
		EditorOption.scrollBeyondLastLine, 'scrollBeyondLastLine', true,
		{ description: nls.localize('scrollBeyondLastLine', "Controls whether the editor will scroll beyond the last line.") }
	)),
	scrollOnMiddleClick: register(new EditorBooleanOption(
		EditorOption.scrollOnMiddleClick, 'scrollOnMiddleClick', false,
		{ description: nls.localize('scrollOnMiddleClick', "Controls whether the editor will scroll when the middle button is pressed.") }
	)),
	scrollPredominantAxis: register(new EditorBooleanOption(
		EditorOption.scrollPredominantAxis, 'scrollPredominantAxis', true,
		{ description: nls.localize('scrollPredominantAxis', "Scroll only along the predominant axis when scrolling both vertically and horizontally at the same time. Prevents horizontal drift when scrolling vertically on a trackpad.") }
	)),
	selectionClipboard: register(new EditorBooleanOption(
		EditorOption.selectionClipboard, 'selectionClipboard', true,
		{
			description: nls.localize('selectionClipboard', "Controls whether the Linux primary clipboard should be supported."),
			included: platform.isLinux
		}
	)),
	selectionHighlight: register(new EditorBooleanOption(
		EditorOption.selectionHighlight, 'selectionHighlight', true,
		{ description: nls.localize('selectionHighlight', "Controls whether the editor should highlight matches similar to the selection.") }
	)),
	selectionHighlightMaxLength: register(new EditorIntOption(
		EditorOption.selectionHighlightMaxLength, 'selectionHighlightMaxLength',
		200, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ description: nls.localize('selectionHighlightMaxLength', "Controls how many characters can be in the selection before similiar matches are not highlighted. Set to zero for unlimited.") }
	)),
	selectionHighlightMultiline: register(new EditorBooleanOption(
		EditorOption.selectionHighlightMultiline, 'selectionHighlightMultiline', false,
		{ description: nls.localize('selectionHighlightMultiline', "Controls whether the editor should highlight selection matches that span multiple lines.") }
	)),
	selectOnLineNumbers: register(new EditorBooleanOption(
		EditorOption.selectOnLineNumbers, 'selectOnLineNumbers', true,
	)),
	showFoldingControls: register(new EditorStringEnumOption(
		EditorOption.showFoldingControls, 'showFoldingControls',
		'mouseover' as 'always' | 'never' | 'mouseover',
		['always', 'never', 'mouseover'] as const,
		{
			enumDescriptions: [
				nls.localize('showFoldingControls.always', "Always show the folding controls."),
				nls.localize('showFoldingControls.never', "Never show the folding controls and reduce the gutter size."),
				nls.localize('showFoldingControls.mouseover', "Only show the folding controls when the mouse is over the gutter."),
			],
			description: nls.localize('showFoldingControls', "Controls when the folding controls on the gutter are shown.")
		}
	)),
	showUnused: register(new EditorBooleanOption(
		EditorOption.showUnused, 'showUnused', true,
		{ description: nls.localize('showUnused', "Controls fading out of unused code.") }
	)),
	showDeprecated: register(new EditorBooleanOption(
		EditorOption.showDeprecated, 'showDeprecated', true,
		{ description: nls.localize('showDeprecated', "Controls strikethrough deprecated variables.") }
	)),
	inlayHints: register(new EditorInlayHints()),
	snippetSuggestions: register(new EditorStringEnumOption(
		EditorOption.snippetSuggestions, 'snippetSuggestions',
		'inline' as 'top' | 'bottom' | 'inline' | 'none',
		['top', 'bottom', 'inline', 'none'] as const,
		{
			enumDescriptions: [
				nls.localize('snippetSuggestions.top', "Show snippet suggestions on top of other suggestions."),
				nls.localize('snippetSuggestions.bottom', "Show snippet suggestions below other suggestions."),
				nls.localize('snippetSuggestions.inline', "Show snippets suggestions with other suggestions."),
				nls.localize('snippetSuggestions.none', "Do not show snippet suggestions."),
			],
			description: nls.localize('snippetSuggestions', "Controls whether snippets are shown with other suggestions and how they are sorted.")
		}
	)),
	smartSelect: register(new SmartSelect()),
	smoothScrolling: register(new EditorBooleanOption(
		EditorOption.smoothScrolling, 'smoothScrolling', false,
		{ description: nls.localize('smoothScrolling', "Controls whether the editor will scroll using an animation.") }
	)),
	stopRenderingLineAfter: register(new EditorIntOption(
		EditorOption.stopRenderingLineAfter, 'stopRenderingLineAfter',
		10000, -1, Constants.MAX_SAFE_SMALL_INTEGER,
	)),
	suggest: register(new EditorSuggest()),
	inlineSuggest: register(new InlineEditorSuggest()),
	inlineCompletionsAccessibilityVerbose: register(new EditorBooleanOption(EditorOption.inlineCompletionsAccessibilityVerbose, 'inlineCompletionsAccessibilityVerbose', false,
		{ description: nls.localize('inlineCompletionsAccessibilityVerbose', "Controls whether the accessibility hint should be provided to screen reader users when an inline completion is shown.") })),
	suggestFontSize: register(new EditorIntOption(
		EditorOption.suggestFontSize, 'suggestFontSize',
		0, 0, 1000,
		{ markdownDescription: nls.localize('suggestFontSize', "Font size for the suggest widget. When set to {0}, the value of {1} is used.", '`0`', '`#editor.fontSize#`') }
	)),
	suggestLineHeight: register(new EditorIntOption(
		EditorOption.suggestLineHeight, 'suggestLineHeight',
		0, 0, 1000,
		{ markdownDescription: nls.localize('suggestLineHeight', "Line height for the suggest widget. When set to {0}, the value of {1} is used. The minimum value is 8.", '`0`', '`#editor.lineHeight#`') }
	)),
	suggestOnTriggerCharacters: register(new EditorBooleanOption(
		EditorOption.suggestOnTriggerCharacters, 'suggestOnTriggerCharacters', true,
		{ description: nls.localize('suggestOnTriggerCharacters', "Controls whether suggestions should automatically show up when typing trigger characters.") }
	)),
	suggestSelection: register(new EditorStringEnumOption(
		EditorOption.suggestSelection, 'suggestSelection',
		'first' as 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix',
		['first', 'recentlyUsed', 'recentlyUsedByPrefix'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('suggestSelection.first', "Always select the first suggestion."),
				nls.localize('suggestSelection.recentlyUsed', "Select recent suggestions unless further typing selects one, e.g. `console.| -> console.log` because `log` has been completed recently."),
				nls.localize('suggestSelection.recentlyUsedByPrefix', "Select suggestions based on previous prefixes that have completed those suggestions, e.g. `co -> console` and `con -> const`."),
			],
			description: nls.localize('suggestSelection', "Controls how suggestions are pre-selected when showing the suggest list.")
		}
	)),
	tabCompletion: register(new EditorStringEnumOption(
		EditorOption.tabCompletion, 'tabCompletion',
		'off' as 'on' | 'off' | 'onlySnippets',
		['on', 'off', 'onlySnippets'] as const,
		{
			enumDescriptions: [
				nls.localize('tabCompletion.on', "Tab complete will insert the best matching suggestion when pressing tab."),
				nls.localize('tabCompletion.off', "Disable tab completions."),
				nls.localize('tabCompletion.onlySnippets', "Tab complete snippets when their prefix match. Works best when 'quickSuggestions' aren't enabled."),
			],
			description: nls.localize('tabCompletion', "Enables tab completions.")
		}
	)),
	tabIndex: register(new EditorIntOption(
		EditorOption.tabIndex, 'tabIndex',
		0, -1, Constants.MAX_SAFE_SMALL_INTEGER
	)),
	trimWhitespaceOnDelete: register(new EditorBooleanOption(
		EditorOption.trimWhitespaceOnDelete, 'trimWhitespaceOnDelete', false,
		{ description: nls.localize('trimWhitespaceOnDelete', "Controls whether the editor will also delete the next line's indentation whitespace when deleting a newline.") }
	)),
	unicodeHighlight: register(new UnicodeHighlight()),
	unusualLineTerminators: register(new EditorStringEnumOption(
		EditorOption.unusualLineTerminators, 'unusualLineTerminators',
		'prompt' as 'auto' | 'off' | 'prompt',
		['auto', 'off', 'prompt'] as const,
		{
			enumDescriptions: [
				nls.localize('unusualLineTerminators.auto', "Unusual line terminators are automatically removed."),
				nls.localize('unusualLineTerminators.off', "Unusual line terminators are ignored."),
				nls.localize('unusualLineTerminators.prompt', "Unusual line terminators prompt to be removed."),
			],
			description: nls.localize('unusualLineTerminators', "Remove unusual line terminators that might cause problems.")
		}
	)),
	useShadowDOM: register(new EditorBooleanOption(
		EditorOption.useShadowDOM, 'useShadowDOM', true
	)),
	useTabStops: register(new EditorBooleanOption(
		EditorOption.useTabStops, 'useTabStops', true,
		{ description: nls.localize('useTabStops', "Spaces and tabs are inserted and deleted in alignment with tab stops.") }
	)),
	wordBreak: register(new EditorStringEnumOption(
		EditorOption.wordBreak, 'wordBreak',
		'normal' as 'normal' | 'keepAll',
		['normal', 'keepAll'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('wordBreak.normal', "Use the default line break rule."),
				nls.localize('wordBreak.keepAll', "Word breaks should not be used for Chinese/Japanese/Korean (CJK) text. Non-CJK text behavior is the same as for normal."),
			],
			description: nls.localize('wordBreak', "Controls the word break rules used for Chinese/Japanese/Korean (CJK) text.")
		}
	)),
	wordSegmenterLocales: register(new WordSegmenterLocales()),
	wordSeparators: register(new EditorStringOption(
		EditorOption.wordSeparators, 'wordSeparators', USUAL_WORD_SEPARATORS,
		{ description: nls.localize('wordSeparators', "Characters that will be used as word separators when doing word related navigations or operations.") }
	)),
	wordWrap: register(new EditorStringEnumOption(
		EditorOption.wordWrap, 'wordWrap',
		'off' as 'off' | 'on' | 'wordWrapColumn' | 'bounded',
		['off', 'on', 'wordWrapColumn', 'bounded'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('wordWrap.off', "Lines will never wrap."),
				nls.localize('wordWrap.on', "Lines will wrap at the viewport width."),
				nls.localize({
					key: 'wordWrap.wordWrapColumn',
					comment: [
						'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
					]
				}, "Lines will wrap at `#editor.wordWrapColumn#`."),
				nls.localize({
					key: 'wordWrap.bounded',
					comment: [
						'- viewport means the edge of the visible window size.',
						'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
					]
				}, "Lines will wrap at the minimum of viewport and `#editor.wordWrapColumn#`."),
			],
			description: nls.localize({
				key: 'wordWrap',
				comment: [
					'- \'off\', \'on\', \'wordWrapColumn\' and \'bounded\' refer to values the setting can take and should not be localized.',
					'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
				]
			}, "Controls how lines should wrap.")
		}
	)),
	wordWrapBreakAfterCharacters: register(new EditorStringOption(
		EditorOption.wordWrapBreakAfterCharacters, 'wordWrapBreakAfterCharacters',
		' \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ｧｨｩｪｫｬｭｮｯｰ”〉》」』】〕）］｝｣',
	)),
	wordWrapBreakBeforeCharacters: register(new EditorStringOption(
		EditorOption.wordWrapBreakBeforeCharacters, 'wordWrapBreakBeforeCharacters',
		'([{‘“〈《「『【〔（［｛｢£¥＄￡￥+＋'
	)),
	wordWrapColumn: register(new EditorIntOption(
		EditorOption.wordWrapColumn, 'wordWrapColumn',
		80, 1, Constants.MAX_SAFE_SMALL_INTEGER,
		{
			markdownDescription: nls.localize({
				key: 'wordWrapColumn',
				comment: [
					'- `editor.wordWrap` refers to a different setting and should not be localized.',
					'- \'wordWrapColumn\' and \'bounded\' refer to values the different setting can take and should not be localized.'
				]
			}, "Controls the wrapping column of the editor when `#editor.wordWrap#` is `wordWrapColumn` or `bounded`.")
		}
	)),
	wordWrapOverride1: register(new EditorStringEnumOption(
		EditorOption.wordWrapOverride1, 'wordWrapOverride1',
		'inherit' as 'off' | 'on' | 'inherit',
		['off', 'on', 'inherit'] as const
	)),
	wordWrapOverride2: register(new EditorStringEnumOption(
		EditorOption.wordWrapOverride2, 'wordWrapOverride2',
		'inherit' as 'off' | 'on' | 'inherit',
		['off', 'on', 'inherit'] as const
	)),
	wordWrapIndicator: register(new EditorBooleanOption(
		EditorOption.wordWrapIndicator, 'wordWrapIndicator', false,
		{
			markdownDescription: nls.localize({
				key: 'wordWrapIndicator',
				comment: []
			}, "Controls whether an indicator is rendered at the wrapping column of lines that wrap. Only has an effect when `#editor.wordWrap#` is enabled.")
		}
	)),
	wrapOnEscapedLineFeeds: register(new EditorBooleanOption(
		EditorOption.wrapOnEscapedLineFeeds, 'wrapOnEscapedLineFeeds', false,
		{ markdownDescription: nls.localize('wrapOnEscapedLineFeeds', "Controls whether literal `\\n` shall trigger a wordWrap when `#editor.wordWrap#` is enabled.\n\nFor example:\n```c\nchar* str=\"hello\\nworld\"\n```\nwill be displayed as\n```c\nchar* str=\"hello\\n\n           world\"\n```") }
	)),

	effectiveCursorStyle: register(new EffectiveCursorStyle()),
	editorClassName: register(new EditorClassName()),
	defaultColorDecorators: register(new EditorStringEnumOption(
		EditorOption.defaultColorDecorators, 'defaultColorDecorators', 'auto' as 'auto' | 'always' | 'never',
		['auto', 'always', 'never'] as const,
		{
			enumDescriptions: [
				nls.localize('editor.defaultColorDecorators.auto', "Show default color decorators only when no extension provides colors decorators."),
				nls.localize('editor.defaultColorDecorators.always', "Always show default color decorators."),
				nls.localize('editor.defaultColorDecorators.never', "Never show default color decorators."),
			],
			description: nls.localize('defaultColorDecorators', "Controls whether inline color decorations should be shown using the default document color provider.")
		}
	)),
	pixelRatio: register(new EditorPixelRatio()),
	tabFocusMode: register(new EditorBooleanOption(EditorOption.tabFocusMode, 'tabFocusMode', false,
		{ markdownDescription: nls.localize('tabFocusMode', "Controls whether the editor receives tabs or defers them to the workbench for navigation.") }
	)),
	layoutInfo: register(new EditorLayoutInfoComputer()),
	wrappingInfo: register(new EditorWrappingInfoComputer()),
	wrappingIndent: register(new WrappingIndentOption()),
	wrappingStrategy: register(new WrappingStrategy()),
	effectiveEditContextEnabled: register(new EffectiveEditContextEnabled()),
	effectiveAllowVariableFonts: register(new EffectiveAllowVariableFonts())
};

type EditorOptionsType = typeof EditorOptions;
type FindEditorOptionsKeyById<T extends EditorOption> = { [K in keyof EditorOptionsType]: EditorOptionsType[K]['id'] extends T ? K : never }[keyof EditorOptionsType];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComputedEditorOptionValue<T extends IEditorOption<any, any>> = T extends IEditorOption<any, infer R> ? R : never;
export type FindComputedEditorOptionValueById<T extends EditorOption> = NonNullable<ComputedEditorOptionValue<EditorOptionsType[FindEditorOptionsKeyById<T>]>>;

export type MouseMiddleClickAction = 'default' | 'openLink' | 'ctrlLeftClick';
