/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line no-var
declare var MonacoEnvironment: monaco.Environment | undefined;

declare namespace monaco {

	export type Thenable<T> = PromiseLike<T>;

	export interface Environment {
		/**
		 * Define a global `monaco` symbol.
		 * This is true by default in AMD and false by default in ESM.
		 */
		globalAPI?: boolean;
		/**
		 * The base url where the editor sources are found (which contains the vs folder)
		 */
		baseUrl?: string;
		/**
		 * A web worker factory.
		 * NOTE: If `getWorker` is defined, `getWorkerUrl` is not invoked.
		 */
		getWorker?(workerId: string, label: string): Promise<Worker> | Worker;
		/**
		 * Return the location for web worker scripts.
		 * NOTE: If `getWorker` is defined, `getWorkerUrl` is not invoked.
		 */
		getWorkerUrl?(workerId: string, label: string): string;
		/**
		 * Create a trusted types policy (same API as window.trustedTypes.createPolicy)
		 */
		createTrustedTypesPolicy?(
			policyName: string,
			policyOptions?: ITrustedTypePolicyOptions,
		): undefined | ITrustedTypePolicy;
	}

	export interface ITrustedTypePolicyOptions {
		createHTML?: (input: string, ...arguments: any[]) => string;
		createScript?: (input: string, ...arguments: any[]) => string;
		createScriptURL?: (input: string, ...arguments: any[]) => string;
	}

	export interface ITrustedTypePolicy {
		readonly name: string;
		createHTML?(input: string): any;
		createScript?(input: string): any;
		createScriptURL?(input: string): any;
	}

	export interface IDisposable {
		dispose(): void;
	}

	export interface IEvent<T> {
		(listener: (e: T) => any, thisArg?: any): IDisposable;
	}

	/**
	 * A helper that allows to emit and listen to typed events
	 */
	export class Emitter<T> {
		constructor();
		readonly event: IEvent<T>;
		fire(event: T): void;
		dispose(): void;
	}


	export enum MarkerTag {
		Unnecessary = 1,
		Deprecated = 2
	}

	export enum MarkerSeverity {
		Hint = 1,
		Info = 2,
		Warning = 4,
		Error = 8
	}

	export class CancellationTokenSource {
		constructor(parent?: CancellationToken);
		get token(): CancellationToken;
		cancel(): void;
		dispose(cancel?: boolean): void;
	}

	export interface CancellationToken {
		readonly isCancellationRequested: boolean;
		readonly onCancellationRequested: (listener: (e: void) => unknown, thisArgs?: unknown, disposables?: IDisposable[]) => IDisposable;
	}
	export class Uri implements UriComponents {
		static isUri(thing: unknown): thing is Uri;
		readonly scheme: string;
		readonly authority: string;
		readonly path: string;
		readonly query: string;
		readonly fragment: string;
		get fsPath(): string;
		with(change: {
			scheme?: string;
			authority?: string | null;
			path?: string | null;
			query?: string | null;
			fragment?: string | null;
		}): Uri;
		static parse(value: string, _strict?: boolean): Uri;
		static file(path: string): Uri;
		static from(components: UriComponents, strict?: boolean): Uri;
		static joinPath(uri: Uri, ...pathFragment: string[]): Uri;
		toString(skipEncoding?: boolean): string;
		toJSON(): UriComponents;
		static revive(data: UriComponents | Uri): Uri;
		static revive(data: UriComponents | Uri | undefined): Uri | undefined;
		static revive(data: UriComponents | Uri | null): Uri | null;
		static revive(data: UriComponents | Uri | undefined | null): Uri | undefined | null;
	}

	export interface UriComponents {
		scheme: string;
		authority?: string;
		path?: string;
		query?: string;
		fragment?: string;
	}
	export enum KeyCode {
		DependsOnKbLayout = -1,
		Unknown = 0,
		Backspace = 1,
		Tab = 2,
		Enter = 3,
		Shift = 4,
		Ctrl = 5,
		Alt = 6,
		PauseBreak = 7,
		CapsLock = 8,
		Escape = 9,
		Space = 10,
		PageUp = 11,
		PageDown = 12,
		End = 13,
		Home = 14,
		LeftArrow = 15,
		UpArrow = 16,
		RightArrow = 17,
		DownArrow = 18,
		Insert = 19,
		Delete = 20,
		Digit0 = 21,
		Digit1 = 22,
		Digit2 = 23,
		Digit3 = 24,
		Digit4 = 25,
		Digit5 = 26,
		Digit6 = 27,
		Digit7 = 28,
		Digit8 = 29,
		Digit9 = 30,
		KeyA = 31,
		KeyB = 32,
		KeyC = 33,
		KeyD = 34,
		KeyE = 35,
		KeyF = 36,
		KeyG = 37,
		KeyH = 38,
		KeyI = 39,
		KeyJ = 40,
		KeyK = 41,
		KeyL = 42,
		KeyM = 43,
		KeyN = 44,
		KeyO = 45,
		KeyP = 46,
		KeyQ = 47,
		KeyR = 48,
		KeyS = 49,
		KeyT = 50,
		KeyU = 51,
		KeyV = 52,
		KeyW = 53,
		KeyX = 54,
		KeyY = 55,
		KeyZ = 56,
		Meta = 57,
		ContextMenu = 58,
		F1 = 59,
		F2 = 60,
		F3 = 61,
		F4 = 62,
		F5 = 63,
		F6 = 64,
		F7 = 65,
		F8 = 66,
		F9 = 67,
		F10 = 68,
		F11 = 69,
		F12 = 70,
		F13 = 71,
		F14 = 72,
		F15 = 73,
		F16 = 74,
		F17 = 75,
		F18 = 76,
		F19 = 77,
		F20 = 78,
		F21 = 79,
		F22 = 80,
		F23 = 81,
		F24 = 82,
		NumLock = 83,
		ScrollLock = 84,
		Semicolon = 85,
		Equal = 86,
		Comma = 87,
		Minus = 88,
		Period = 89,
		Slash = 90,
		Backquote = 91,
		BracketLeft = 92,
		Backslash = 93,
		BracketRight = 94,
		Quote = 95,
		OEM_8 = 96,
		IntlBackslash = 97,
		Numpad0 = 98,
		Numpad1 = 99,
		Numpad2 = 100,
		Numpad3 = 101,
		Numpad4 = 102,
		Numpad5 = 103,
		Numpad6 = 104,
		Numpad7 = 105,
		Numpad8 = 106,
		Numpad9 = 107,
		NumpadMultiply = 108,
		NumpadAdd = 109,
		NUMPAD_SEPARATOR = 110,
		NumpadSubtract = 111,
		NumpadDecimal = 112,
		NumpadDivide = 113,
		KEY_IN_COMPOSITION = 114,
		ABNT_C1 = 115,
		ABNT_C2 = 116,
		AudioVolumeMute = 117,
		AudioVolumeUp = 118,
		AudioVolumeDown = 119,
		BrowserSearch = 120,
		BrowserHome = 121,
		BrowserBack = 122,
		BrowserForward = 123,
		MediaTrackNext = 124,
		MediaTrackPrevious = 125,
		MediaStop = 126,
		MediaPlayPause = 127,
		LaunchMediaPlayer = 128,
		LaunchMail = 129,
		LaunchApp2 = 130,
		Clear = 131,
		MAX_VALUE = 132
	}
	export class KeyMod {
		static readonly CtrlCmd: number;
		static readonly Shift: number;
		static readonly Alt: number;
		static readonly WinCtrl: number;
		static chord(firstPart: number, secondPart: number): number;
	}

	export interface IMarkdownString {
		readonly value: string;
		readonly isTrusted?: boolean | MarkdownStringTrustedOptions;
		readonly supportThemeIcons?: boolean;
		readonly supportHtml?: boolean;
		readonly baseUri?: UriComponents;
		uris?: {
			[href: string]: UriComponents;
		};
	}

	export interface MarkdownStringTrustedOptions {
		readonly enabledCommands: readonly string[];
	}

	export interface IKeyboardEvent {
		readonly _standardKeyboardEventBrand: true;
		readonly browserEvent: KeyboardEvent;
		readonly target: HTMLElement;
		readonly ctrlKey: boolean;
		readonly shiftKey: boolean;
		readonly altKey: boolean;
		readonly metaKey: boolean;
		readonly altGraphKey: boolean;
		readonly keyCode: KeyCode;
		readonly code: string;
		equals(keybinding: number): boolean;
		preventDefault(): void;
		stopPropagation(): void;
	}
	export interface IMouseEvent {
		readonly browserEvent: MouseEvent;
		readonly leftButton: boolean;
		readonly middleButton: boolean;
		readonly rightButton: boolean;
		readonly buttons: number;
		readonly target: HTMLElement;
		readonly detail: number;
		readonly posx: number;
		readonly posy: number;
		readonly ctrlKey: boolean;
		readonly shiftKey: boolean;
		readonly altKey: boolean;
		readonly metaKey: boolean;
		readonly timestamp: number;
		readonly defaultPrevented: boolean;
		preventDefault(): void;
		stopPropagation(): void;
	}

	export interface IScrollEvent {
		readonly scrollTop: number;
		readonly scrollLeft: number;
		readonly scrollWidth: number;
		readonly scrollHeight: number;
		readonly scrollTopChanged: boolean;
		readonly scrollLeftChanged: boolean;
		readonly scrollWidthChanged: boolean;
		readonly scrollHeightChanged: boolean;
	}
	export interface IPosition {
		readonly lineNumber: number;
		readonly column: number;
	}

	export class Position {
		readonly lineNumber: number;
		readonly column: number;
		constructor(lineNumber: number, column: number);
		with(newLineNumber?: number, newColumn?: number): Position;
		delta(deltaLineNumber?: number, deltaColumn?: number): Position;
		equals(other: IPosition): boolean;
		static equals(a: IPosition | null, b: IPosition | null): boolean;
		isBefore(other: IPosition): boolean;
		static isBefore(a: IPosition, b: IPosition): boolean;
		isBeforeOrEqual(other: IPosition): boolean;
		static isBeforeOrEqual(a: IPosition, b: IPosition): boolean;
		static compare(a: IPosition, b: IPosition): number;
		clone(): Position;
		toString(): string;
		static lift(pos: IPosition): Position;
		static isIPosition(obj: unknown): obj is IPosition;
		toJSON(): IPosition;
	}

	export interface IRange {
		readonly startLineNumber: number;
		readonly startColumn: number;
		readonly endLineNumber: number;
		readonly endColumn: number;
	}

	export class Range {
		readonly startLineNumber: number;
		readonly startColumn: number;
		readonly endLineNumber: number;
		readonly endColumn: number;
		constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number);
		isEmpty(): boolean;
		static isEmpty(range: IRange): boolean;
		containsPosition(position: IPosition): boolean;
		static containsPosition(range: IRange, position: IPosition): boolean;
		containsRange(range: IRange): boolean;
		static containsRange(range: IRange, otherRange: IRange): boolean;
		strictContainsRange(range: IRange): boolean;
		static strictContainsRange(range: IRange, otherRange: IRange): boolean;
		plusRange(range: IRange): Range;
		static plusRange(a: IRange, b: IRange): Range;
		intersectRanges(range: IRange): Range | null;
		static intersectRanges(a: IRange, b: IRange): Range | null;
		equalsRange(other: IRange | null | undefined): boolean;
		static equalsRange(a: IRange | null | undefined, b: IRange | null | undefined): boolean;
		getEndPosition(): Position;
		static getEndPosition(range: IRange): Position;
		getStartPosition(): Position;
		static getStartPosition(range: IRange): Position;
		toString(): string;
		setEndPosition(endLineNumber: number, endColumn: number): Range;
		setStartPosition(startLineNumber: number, startColumn: number): Range;
		collapseToStart(): Range;
		static collapseToStart(range: IRange): Range;
		collapseToEnd(): Range;
		static collapseToEnd(range: IRange): Range;
		delta(lineCount: number): Range;
		isSingleLine(): boolean;
		static fromPositions(start: IPosition, end?: IPosition): Range;
		static lift(range: undefined | null): null;
		static lift(range: IRange): Range;
		static lift(range: IRange | undefined | null): Range | null;
		static isIRange(obj: unknown): obj is IRange;
		static areIntersectingOrTouching(a: IRange, b: IRange): boolean;
		static areIntersecting(a: IRange, b: IRange): boolean;
		static areOnlyIntersecting(a: IRange, b: IRange): boolean;
		static compareRangesUsingStarts(a: IRange | null | undefined, b: IRange | null | undefined): number;
		static compareRangesUsingEnds(a: IRange, b: IRange): number;
		static spansMultipleLines(range: IRange): boolean;
		toJSON(): IRange;
	}

	export interface ISelection {
		readonly selectionStartLineNumber: number;
		readonly selectionStartColumn: number;
		readonly positionLineNumber: number;
		readonly positionColumn: number;
	}

	export class Selection extends Range {
		readonly selectionStartLineNumber: number;
		readonly selectionStartColumn: number;
		readonly positionLineNumber: number;
		readonly positionColumn: number;
		constructor(selectionStartLineNumber: number, selectionStartColumn: number, positionLineNumber: number, positionColumn: number);
		toString(): string;
		equalsSelection(other: ISelection): boolean;
		static selectionsEqual(a: ISelection, b: ISelection): boolean;
		getDirection(): SelectionDirection;
		setEndPosition(endLineNumber: number, endColumn: number): Selection;
		getPosition(): Position;
		getSelectionStart(): Position;
		setStartPosition(startLineNumber: number, startColumn: number): Selection;
		static fromPositions(start: IPosition, end?: IPosition): Selection;
		static fromRange(range: Range, direction: SelectionDirection): Selection;
		static liftSelection(sel: ISelection): Selection;
		static selectionsArrEqual(a: ISelection[], b: ISelection[]): boolean;
		static isISelection(obj: unknown): obj is ISelection;
		static createWithDirection(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, direction: SelectionDirection): Selection;
	}

	export enum SelectionDirection {
		LTR = 0,
		RTL = 1
	}

	export class Token {
		readonly offset: number;
		readonly type: string;
		readonly language: string;
		_tokenBrand: void;
		constructor(offset: number, type: string, language: string);
		toString(): string;
	}
}

declare namespace monaco.editor {

	export function create(domElement: HTMLElement, options?: IStandaloneEditorConstructionOptions, override?: IEditorOverrideServices): IStandaloneCodeEditor;

	export function onDidCreateEditor(listener: (codeEditor: ICodeEditor) => void): IDisposable;

	export function onDidCreateDiffEditor(listener: (diffEditor: IDiffEditor) => void): IDisposable;

	export function getEditors(): readonly ICodeEditor[];

	export function getDiffEditors(): readonly IDiffEditor[];

	export function createDiffEditor(domElement: HTMLElement, options?: IStandaloneDiffEditorConstructionOptions, override?: IEditorOverrideServices): IStandaloneDiffEditor;

	export function createMultiFileDiffEditor(domElement: HTMLElement, override?: IEditorOverrideServices): any;

	export interface ICommandDescriptor {
		id: string;
		run: ICommandHandler;
	}

	export function addCommand(descriptor: ICommandDescriptor): IDisposable;

	export function addEditorAction(descriptor: IActionDescriptor): IDisposable;

	export interface IKeybindingRule {
		keybinding: number;
		command?: string | null;
		commandArgs?: any;
		when?: string | null;
	}

	export function addKeybindingRule(rule: IKeybindingRule): IDisposable;

	export function addKeybindingRules(rules: IKeybindingRule[]): IDisposable;

	export function createModel(value: string, language?: string, uri?: Uri): ITextModel;

	export function setModelLanguage(model: ITextModel, mimeTypeOrLanguageId: string): void;

	export function setModelMarkers(model: ITextModel, owner: string, markers: IMarkerData[]): void;

	export function removeAllMarkers(owner: string): void;

	export function getModelMarkers(filter: {
		owner?: string;
		resource?: Uri;
		take?: number;
	}): IMarker[];

	export function onDidChangeMarkers(listener: (e: readonly Uri[]) => void): IDisposable;

	export function getModel(uri: Uri): ITextModel | null;

	export function getModels(): ITextModel[];

	export function onDidCreateModel(listener: (model: ITextModel) => void): IDisposable;

	export function onWillDisposeModel(listener: (model: ITextModel) => void): IDisposable;

	export function onDidChangeModelLanguage(listener: (e: {
		readonly model: ITextModel;
		readonly oldLanguage: string;
	}) => void): IDisposable;

	export function createWebWorker<T extends object>(opts: IInternalWebWorkerOptions): MonacoWebWorker<T>;

	export function colorizeElement(domNode: HTMLElement, options: IColorizerElementOptions): Promise<void>;

	export function colorize(text: string, languageId: string, options: IColorizerOptions): Promise<string>;

	export function colorizeModelLine(model: ITextModel, lineNumber: number, tabSize?: number): string;

	export function tokenize(text: string, languageId: string): Token[][];

	export function defineTheme(themeName: string, themeData: IStandaloneThemeData): void;

	export function setTheme(themeName: string): void;

	export function remeasureFonts(): void;

	export function registerCommand(id: string, handler: (accessor: any, ...args: any[]) => void): IDisposable;

	export interface ILinkOpener {
		open(resource: Uri): boolean | Promise<boolean>;
	}

	export function registerLinkOpener(opener: ILinkOpener): IDisposable;

	export interface ICodeEditorOpener {
		openCodeEditor(source: ICodeEditor, resource: Uri, selectionOrPosition?: IRange | IPosition): boolean | Promise<boolean>;
	}

	export function registerEditorOpener(opener: ICodeEditorOpener): IDisposable;

	export type BuiltinTheme = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

	export interface IStandaloneThemeData {
		base: BuiltinTheme;
		inherit: boolean;
		rules: ITokenThemeRule[];
		encodedTokensColors?: string[];
		colors: IColors;
	}

	export type IColors = {
		[colorId: string]: string;
	};

	export interface ITokenThemeRule {
		token: string;
		foreground?: string;
		background?: string;
		fontStyle?: string;
	}

	export interface MonacoWebWorker<T> {
		dispose(): void;
		getProxy(): Promise<T>;
		withSyncedResources(resources: Uri[]): Promise<T>;
	}

	export interface IInternalWebWorkerOptions {
		worker: Worker | Promise<Worker>;
		host?: Record<string, Function>;
		keepIdleModels?: boolean;
	}

	export interface IActionDescriptor {
		id: string;
		label: string;
		precondition?: string;
		keybindings?: number[];
		keybindingContext?: string;
		contextMenuGroupId?: string;
		contextMenuOrder?: number;
		run(editor: ICodeEditor, ...args: unknown[]): void | Promise<void>;
	}

	export interface IGlobalEditorOptions {
		tabSize?: number;
		insertSpaces?: boolean;
		detectIndentation?: boolean;
		trimAutoWhitespace?: boolean;
		largeFileOptimizations?: boolean;
		wordBasedSuggestions?: 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments';
		wordBasedSuggestionsOnlySameLanguage?: boolean;
		'semanticHighlighting.enabled'?: true | false | 'configuredByTheme';
		stablePeek?: boolean;
		maxTokenizationLineLength?: number;
		theme?: string;
		autoDetectHighContrast?: boolean;
	}

	export interface IStandaloneEditorConstructionOptions extends IEditorConstructionOptions, IGlobalEditorOptions {
		model?: ITextModel | null;
		value?: string;
		language?: string;
		theme?: string;
		autoDetectHighContrast?: boolean;
		accessibilityHelpUrl?: string;
		ariaContainerElement?: HTMLElement;
	}

	export interface IStandaloneDiffEditorConstructionOptions extends IDiffEditorConstructionOptions {
		theme?: string;
		autoDetectHighContrast?: boolean;
	}

	export interface IStandaloneCodeEditor extends ICodeEditor {
		updateOptions(newOptions: IEditorOptions & IGlobalEditorOptions): void;
		addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
		createContextKey<T extends ContextKeyValue = ContextKeyValue>(key: string, defaultValue: T): IContextKey<T>;
		addAction(descriptor: IActionDescriptor): IDisposable;
	}

	export interface IStandaloneDiffEditor extends IDiffEditor {
		addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
		createContextKey<T extends ContextKeyValue = ContextKeyValue>(key: string, defaultValue: T): IContextKey<T>;
		addAction(descriptor: IActionDescriptor): IDisposable;
		getOriginalEditor(): IStandaloneCodeEditor;
		getModifiedEditor(): IStandaloneCodeEditor;
	}
	export interface ICommandHandler {
		(...args: any[]): void;
	}
	export interface ILocalizedString {
		original: string;
		value: string;
	}
	export interface ICommandMetadata {
		readonly description: ILocalizedString | string;
	}

	export interface IContextKey<T extends ContextKeyValue = ContextKeyValue> {
		set(value: T): void;
		reset(): void;
		get(): T | undefined;
	}

	export type ContextKeyValue = null | undefined | boolean | number | string | Array<null | undefined | boolean | number | string> | Record<string, null | undefined | boolean | number | string>;

	export interface IEditorOverrideServices {
		[index: string]: unknown;
	}

	export interface IMarker {
		owner: string;
		resource: Uri;
		severity: MarkerSeverity;
		code?: string | {
			value: string;
			target: Uri;
		};
		message: string;
		source?: string;
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
		modelVersionId?: number;
		relatedInformation?: IRelatedInformation[];
		tags?: MarkerTag[];
		origin?: string | undefined;
	}

	export interface IMarkerData {
		code?: string | {
			value: string;
			target: Uri;
		};
		severity: MarkerSeverity;
		message: string;
		source?: string;
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
		modelVersionId?: number;
		relatedInformation?: IRelatedInformation[];
		tags?: MarkerTag[];
		origin?: string | undefined;
	}

	export interface IRelatedInformation {
		resource: Uri;
		message: string;
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	}

	export interface IColorizerOptions {
		tabSize?: number;
	}

	export interface IColorizerElementOptions extends IColorizerOptions {
		theme?: string;
		mimeType?: string;
	}

	export enum ScrollbarVisibility {
		Auto = 1,
		Hidden = 2,
		Visible = 3
	}

	export interface ThemeColor {
		id: string;
	}

	export interface ThemeIcon {
		readonly id: string;
		readonly color?: ThemeColor;
	}

	export interface ISingleEditOperation {
		range: IRange;
		text: string | null;
		forceMoveMarkers?: boolean;
	}

	export interface IWordAtPosition {
		readonly word: string;
		readonly startColumn: number;
		readonly endColumn: number;
	}

	export enum OverviewRulerLane {
		Left = 1,
		Center = 2,
		Right = 4,
		Full = 7
	}

	export enum GlyphMarginLane {
		Left = 1,
		Center = 2,
		Right = 3
	}

	export interface IGlyphMarginLanesModel {
		readonly requiredLanes: number;
		getLanesAtLine(lineNumber: number): GlyphMarginLane[];
		reset(maxLine: number): void;
		push(lane: GlyphMarginLane, range: Range, persist?: boolean): void;
	}

	export enum MinimapPosition {
		Inline = 1,
		Gutter = 2
	}

	export enum MinimapSectionHeaderStyle {
		Normal = 1,
		Underlined = 2
	}

	export interface IDecorationOptions {
		color: string | ThemeColor | undefined;
		darkColor?: string | ThemeColor;
	}

	export interface IModelDecorationGlyphMarginOptions {
		position: GlyphMarginLane;
		persistLane?: boolean;
	}

	export interface IModelDecorationOverviewRulerOptions extends IDecorationOptions {
		position: OverviewRulerLane;
	}

	export interface IModelDecorationMinimapOptions extends IDecorationOptions {
		position: MinimapPosition;
		sectionHeaderStyle?: MinimapSectionHeaderStyle | null;
		sectionHeaderText?: string | null;
	}

	export interface IModelDecorationOptions {
		stickiness?: TrackedRangeStickiness;
		className?: string | null;
		shouldFillLineOnLineBreak?: boolean | null;
		blockClassName?: string | null;
		blockIsAfterEnd?: boolean | null;
		blockDoesNotCollapse?: boolean | null;
		blockPadding?: [top: number, right: number, bottom: number, left: number] | null;
		glyphMarginHoverMessage?: IMarkdownString | IMarkdownString[] | null;
		hoverMessage?: IMarkdownString | IMarkdownString[] | null;
		lineNumberHoverMessage?: IMarkdownString | IMarkdownString[] | null;
		isWholeLine?: boolean;
		showIfCollapsed?: boolean;
		zIndex?: number;
		overviewRuler?: IModelDecorationOverviewRulerOptions | null;
		minimap?: IModelDecorationMinimapOptions | null;
		glyphMarginClassName?: string | null;
		glyphMargin?: IModelDecorationGlyphMarginOptions | null;
		lineHeight?: number | null;
		fontFamily?: string | null;
		fontSize?: string | null;
		fontWeight?: string | null;
		fontStyle?: string | null;
		linesDecorationsClassName?: string | null;
		linesDecorationsTooltip?: string | null;
		lineNumberClassName?: string | null;
		firstLineDecorationClassName?: string | null;
		marginClassName?: string | null;
		inlineClassName?: string | null;
		inlineClassNameAffectsLetterSpacing?: boolean;
		beforeContentClassName?: string | null;
		afterContentClassName?: string | null;
		after?: InjectedTextOptions | null;
		before?: InjectedTextOptions | null;
		textDirection?: TextDirection | null;
	}

	export enum TextDirection {
		LTR = 0,
		RTL = 1
	}

	export interface InjectedTextOptions {
		readonly content: string;
		readonly inlineClassName?: string | null;
		readonly inlineClassNameAffectsLetterSpacing?: boolean;
		readonly attachedData?: unknown;
		readonly cursorStops?: InjectedTextCursorStops | null;
	}

	export enum InjectedTextCursorStops {
		Both = 0,
		Right = 1,
		Left = 2,
		None = 3
	}

	export interface IModelDeltaDecoration {
		range: IRange;
		options: IModelDecorationOptions;
	}

	export interface IModelDecoration {
		readonly id: string;
		readonly ownerId: number;
		readonly range: Range;
		readonly options: IModelDecorationOptions;
	}

	export enum EndOfLinePreference {
		TextDefined = 0,
		LF = 1,
		CRLF = 2
	}

	export enum DefaultEndOfLine {
		LF = 1,
		CRLF = 2
	}

	export enum EndOfLineSequence {
		LF = 0,
		CRLF = 1
	}

	export interface IIdentifiedSingleEditOperation extends ISingleEditOperation {
	}

	export interface IValidEditOperation {
		range: Range;
		text: string;
	}

	export interface ICursorStateComputer {
		(inverseEditOperations: IValidEditOperation[]): Selection[] | null;
	}

	export class TextModelResolvedOptions {
		_textModelResolvedOptionsBrand: void;
		readonly tabSize: number;
		readonly indentSize: number;
		readonly insertSpaces: boolean;
		readonly defaultEOL: DefaultEndOfLine;
		readonly trimAutoWhitespace: boolean;
		readonly bracketPairColorizationOptions: BracketPairColorizationOptions;
		get originalIndentSize(): number | 'tabSize';
	}

	export interface BracketPairColorizationOptions {
		enabled: boolean;
		independentColorPoolPerBracketType: boolean;
	}

	export interface ITextModelUpdateOptions {
		tabSize?: number;
		indentSize?: number | 'tabSize';
		insertSpaces?: boolean;
		trimAutoWhitespace?: boolean;
		bracketColorizationOptions?: BracketPairColorizationOptions;
	}

	export class FindMatch {
		_findMatchBrand: void;
		readonly range: Range;
		readonly matches: string[] | null;
	}

	export enum TrackedRangeStickiness {
		AlwaysGrowsWhenTypingAtEdges = 0,
		NeverGrowsWhenTypingAtEdges = 1,
		GrowsOnlyWhenTypingBefore = 2,
		GrowsOnlyWhenTypingAfter = 3
	}

	export interface ITextSnapshot {
		read(): string | null;
	}

	export interface ITextModel {
		readonly uri: Uri;
		readonly id: string;
		getOptions(): TextModelResolvedOptions;
		getVersionId(): number;
		getAlternativeVersionId(): number;
		setValue(newValue: string | ITextSnapshot): void;
		getValue(eol?: EndOfLinePreference, preserveBOM?: boolean): string;
		createSnapshot(preserveBOM?: boolean): ITextSnapshot;
		getValueLength(eol?: EndOfLinePreference, preserveBOM?: boolean): number;
		getValueInRange(range: IRange, eol?: EndOfLinePreference): string;
		getValueLengthInRange(range: IRange, eol?: EndOfLinePreference): number;
		getCharacterCountInRange(range: IRange, eol?: EndOfLinePreference): number;
		getLineCount(): number;
		getLineContent(lineNumber: number): string;
		getLineLength(lineNumber: number): number;
		getLinesContent(): string[];
		getEOL(): string;
		getEndOfLineSequence(): EndOfLineSequence;
		getLineMinColumn(lineNumber: number): number;
		getLineMaxColumn(lineNumber: number): number;
		getLineFirstNonWhitespaceColumn(lineNumber: number): number;
		getLineLastNonWhitespaceColumn(lineNumber: number): number;
		validatePosition(position: IPosition): Position;
		modifyPosition(position: IPosition, offset: number): Position;
		validateRange(range: IRange): Range;
		isValidRange(range: IRange): boolean;
		getOffsetAt(position: IPosition): number;
		getPositionAt(offset: number): Position;
		getFullModelRange(): Range;
		isDisposed(): boolean;
		findMatches(searchString: string, searchOnlyEditableRange: boolean, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean, limitResultCount?: number): FindMatch[];
		findMatches(searchString: string, searchScope: IRange | IRange[], isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean, limitResultCount?: number): FindMatch[];
		findNextMatch(searchString: string, searchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean): FindMatch | null;
		findPreviousMatch(searchString: string, searchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean): FindMatch | null;
		getLanguageId(): string;
		getWordAtPosition(position: IPosition): IWordAtPosition | null;
		getWordUntilPosition(position: IPosition): IWordAtPosition;
		deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[], ownerId?: number): string[];
		getDecorationOptions(id: string): IModelDecorationOptions | null;
		getDecorationRange(id: string): Range | null;
		getLineDecorations(lineNumber: number, ownerId?: number, filterOutValidation?: boolean, filterFontDecorations?: boolean): IModelDecoration[];
		getLinesDecorations(startLineNumber: number, endLineNumber: number, ownerId?: number, filterOutValidation?: boolean, filterFontDecorations?: boolean): IModelDecoration[];
		getDecorationsInRange(range: IRange, ownerId?: number, filterOutValidation?: boolean, filterFontDecorations?: boolean, onlyMinimapDecorations?: boolean, onlyMarginDecorations?: boolean): IModelDecoration[];
		getAllDecorations(ownerId?: number, filterOutValidation?: boolean, filterFontDecorations?: boolean): IModelDecoration[];
		getAllMarginDecorations(ownerId?: number): IModelDecoration[];
		getOverviewRulerDecorations(ownerId?: number, filterOutValidation?: boolean, filterFontDecorations?: boolean): IModelDecoration[];
		getInjectedTextDecorations(ownerId?: number): IModelDecoration[];
		getCustomLineHeightsDecorations(ownerId?: number): IModelDecoration[];
		getCustomLineHeightsDecorationsInRange(range: Range, ownerId?: number): IModelDecoration[];
		normalizeIndentation(str: string): string;
		updateOptions(newOpts: ITextModelUpdateOptions): void;
		detectIndentation(defaultInsertSpaces: boolean, defaultTabSize: number): void;
		pushStackElement(): void;
		popStackElement(): void;
		pushEditOperations(beforeCursorState: Selection[] | null, editOperations: IIdentifiedSingleEditOperation[], cursorStateComputer: ICursorStateComputer): Selection[] | null;
		pushEOL(eol: EndOfLineSequence): void;
		applyEdits(operations: readonly IIdentifiedSingleEditOperation[]): void;
		applyEdits(operations: readonly IIdentifiedSingleEditOperation[], computeUndoEdits: false): void;
		applyEdits(operations: readonly IIdentifiedSingleEditOperation[], computeUndoEdits: true): IValidEditOperation[];
		setEOL(eol: EndOfLineSequence): void;
		undo(): void | Promise<void>;
		canUndo(): boolean;
		redo(): void | Promise<void>;
		canRedo(): boolean;
		onDidChangeContent(listener: (e: IModelContentChangedEvent) => void): IDisposable;
		readonly onDidChangeDecorations: IEvent<IModelDecorationsChangedEvent>;
		readonly onDidChangeOptions: IEvent<IModelOptionsChangedEvent>;
		readonly onDidChangeLanguage: IEvent<IModelLanguageChangedEvent>;
		readonly onDidChangeLanguageConfiguration: IEvent<IModelLanguageConfigurationChangedEvent>;
		readonly onDidChangeAttached: IEvent<void>;
		readonly onWillDispose: IEvent<void>;
		dispose(): void;
		isAttachedToEditor(): boolean;
	}

	export enum PositionAffinity {
		Left = 0,
		Right = 1,
		None = 2,
		LeftOfInjectedText = 3,
		RightOfInjectedText = 4
	}

	export interface IChange {
		readonly originalStartLineNumber: number;
		readonly originalEndLineNumber: number;
		readonly modifiedStartLineNumber: number;
		readonly modifiedEndLineNumber: number;
	}

	export interface ICharChange extends IChange {
		readonly originalStartColumn: number;
		readonly originalEndColumn: number;
		readonly modifiedStartColumn: number;
		readonly modifiedEndColumn: number;
	}

	export interface ILineChange extends IChange {
		readonly charChanges: ICharChange[] | undefined;
	}
	export interface IDimension {
		width: number;
		height: number;
	}

	export interface IEditOperationBuilder {
		addEditOperation(range: IRange, text: string | null, forceMoveMarkers?: boolean): void;
		addTrackedEditOperation(range: IRange, text: string | null, forceMoveMarkers?: boolean): void;
		trackSelection(selection: Selection, trackPreviousOnEmpty?: boolean): string;
	}

	export interface ICursorStateComputerData {
		getInverseEditOperations(): IValidEditOperation[];
		getTrackedSelection(id: string): Selection;
	}

	export interface ICommand {
		getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void;
		computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection;
	}

	export interface IDiffEditorModel {
		original: ITextModel;
		modified: ITextModel;
	}

	export interface IDiffEditorViewModel extends IDisposable {
		readonly model: IDiffEditorModel;
		waitForDiff(): Promise<void>;
	}

	export interface IModelChangedEvent {
		readonly oldModelUrl: Uri | null;
		readonly newModelUrl: Uri | null;
	}

	export interface IContentSizeChangedEvent {
		readonly contentWidth: number;
		readonly contentHeight: number;
		readonly contentWidthChanged: boolean;
		readonly contentHeightChanged: boolean;
	}

	export interface INewScrollPosition {
		scrollLeft?: number;
		scrollTop?: number;
	}

	export interface IEditorAction {
		readonly id: string;
		readonly label: string;
		readonly alias: string;
		readonly metadata: ICommandMetadata | undefined;
		isSupported(): boolean;
		run(args?: unknown): Promise<void>;
	}

	export type IEditorModel = ITextModel | IDiffEditorModel | IDiffEditorViewModel;

	export interface ICursorState {
		inSelectionMode: boolean;
		selectionStart: IPosition;
		position: IPosition;
	}

	export interface IViewState {
		scrollTop?: number;
		scrollTopWithoutViewZones?: number;
		scrollLeft: number;
		firstPosition: IPosition;
		firstPositionDeltaTop: number;
	}

	export interface ICodeEditorViewState {
		cursorState: ICursorState[];
		viewState: IViewState;
		contributionsState: {
			[id: string]: unknown;
		};
	}

	export interface IDiffEditorViewState {
		original: ICodeEditorViewState | null;
		modified: ICodeEditorViewState | null;
		modelState?: unknown;
	}

	export type IEditorViewState = ICodeEditorViewState | IDiffEditorViewState;

	export enum ScrollType {
		Smooth = 0,
		Immediate = 1
	}

	export interface IEditor {
		onDidDispose(listener: () => void): IDisposable;
		dispose(): void;
		getId(): string;
		getEditorType(): string;
		updateOptions(newOptions: IEditorOptions): void;
		layout(dimension?: IDimension, postponeRendering?: boolean): void;
		focus(): void;
		hasTextFocus(): boolean;
		getSupportedActions(): IEditorAction[];
		saveViewState(): IEditorViewState | null;
		restoreViewState(state: IEditorViewState | null): void;
		getVisibleColumnFromPosition(position: IPosition): number;
		getPosition(): Position | null;
		setPosition(position: IPosition, source?: string): void;
		revealLine(lineNumber: number, scrollType?: ScrollType): void;
		revealLineInCenter(lineNumber: number, scrollType?: ScrollType): void;
		revealLineInCenterIfOutsideViewport(lineNumber: number, scrollType?: ScrollType): void;
		revealLineNearTop(lineNumber: number, scrollType?: ScrollType): void;
		revealPosition(position: IPosition, scrollType?: ScrollType): void;
		revealPositionInCenter(position: IPosition, scrollType?: ScrollType): void;
		revealPositionInCenterIfOutsideViewport(position: IPosition, scrollType?: ScrollType): void;
		revealPositionNearTop(position: IPosition, scrollType?: ScrollType): void;
		getSelection(): Selection | null;
		getSelections(): Selection[] | null;
		setSelection(selection: IRange, source?: string): void;
		setSelection(selection: Range, source?: string): void;
		setSelection(selection: ISelection, source?: string): void;
		setSelection(selection: Selection, source?: string): void;
		setSelections(selections: readonly ISelection[], source?: string): void;
		revealLines(startLineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		revealLinesInCenter(lineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		revealLinesInCenterIfOutsideViewport(lineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		revealLinesNearTop(lineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		revealRange(range: IRange, scrollType?: ScrollType): void;
		revealRangeInCenter(range: IRange, scrollType?: ScrollType): void;
		revealRangeAtTop(range: IRange, scrollType?: ScrollType): void;
		revealRangeInCenterIfOutsideViewport(range: IRange, scrollType?: ScrollType): void;
		revealRangeNearTop(range: IRange, scrollType?: ScrollType): void;
		revealRangeNearTopIfOutsideViewport(range: IRange, scrollType?: ScrollType): void;
		trigger(source: string | null | undefined, handlerId: string, payload: unknown): void;
		getModel(): IEditorModel | null;
		setModel(model: IEditorModel | null): void;
		createDecorationsCollection(decorations?: IModelDeltaDecoration[]): IEditorDecorationsCollection;
	}

	export interface IEditorDecorationsCollection {
		readonly onDidChange: IEvent<IModelDecorationsChangedEvent>;
		length: number;
		getRange(index: number): Range | null;
		getRanges(): Range[];
		has(decoration: IModelDecoration): boolean;
		set(newDecorations: readonly IModelDeltaDecoration[]): string[];
		append(newDecorations: readonly IModelDeltaDecoration[]): string[];
		clear(): void;
	}

	export interface IEditorContribution {
		dispose(): void;
		saveViewState?(): unknown;
		restoreViewState?(state: unknown): void;
	}

	export const EditorType: {
		ICodeEditor: string;
		IDiffEditor: string;
	};

	export interface IModelLanguageChangedEvent {
		readonly oldLanguage: string;
		readonly newLanguage: string;
		readonly source: string;
	}

	export interface IModelLanguageConfigurationChangedEvent {
	}

	export interface IModelContentChangedEvent {
		readonly changes: IModelContentChange[];
		readonly eol: string;
		readonly versionId: number;
		readonly isUndoing: boolean;
		readonly isRedoing: boolean;
		readonly isFlush: boolean;
		readonly isEolChange: boolean;
		readonly detailedReasonsChangeLengths: number[];
	}

	export interface ISerializedModelContentChangedEvent {
		readonly changes: IModelContentChange[];
		readonly eol: string;
		readonly versionId: number;
		readonly isUndoing: boolean;
		readonly isRedoing: boolean;
		readonly isFlush: boolean;
		readonly isEolChange: boolean;
	}

	export interface IModelDecorationsChangedEvent {
		readonly affectsMinimap: boolean;
		readonly affectsOverviewRuler: boolean;
		readonly affectsGlyphMargin: boolean;
		readonly affectsLineNumber: boolean;
	}

	export interface IModelOptionsChangedEvent {
		readonly tabSize: boolean;
		readonly indentSize: boolean;
		readonly insertSpaces: boolean;
		readonly trimAutoWhitespace: boolean;
	}

	export interface IModelContentChange {
		readonly range: IRange;
		readonly rangeOffset: number;
		readonly rangeLength: number;
		readonly text: string;
	}

	export enum CursorChangeReason {
		NotSet = 0,
		ContentFlush = 1,
		RecoverFromMarkers = 2,
		Explicit = 3,
		Paste = 4,
		Undo = 5,
		Redo = 6
	}

	export interface ICursorPositionChangedEvent {
		readonly position: Position;
		readonly secondaryPositions: Position[];
		readonly reason: CursorChangeReason;
		readonly source: string;
	}

	export interface ICursorSelectionChangedEvent {
		readonly selection: Selection;
		readonly secondarySelections: Selection[];
		readonly modelVersionId: number;
		readonly oldSelections: Selection[] | null;
		readonly oldModelVersionId: number;
		readonly source: string;
		readonly reason: CursorChangeReason;
	}

	export enum AccessibilitySupport {
		Unknown = 0,
		Disabled = 1,
		Enabled = 2
	}

	export type EditorAutoClosingStrategy = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';

	export type EditorAutoSurroundStrategy = 'languageDefined' | 'quotes' | 'brackets' | 'never';

	export type EditorAutoClosingEditStrategy = 'always' | 'auto' | 'never';

	export enum EditorAutoIndentStrategy {
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

	export type DiffEditorViewMode = 'inline' | 'sideBySide' | 'automatic';

	export interface IDiffEditorBaseOptions {
		enableSplitViewResizing?: boolean;
		splitViewDefaultRatio?: number;
		renderSideBySide?: boolean;
		renderSideBySideInlineBreakpoint?: number | undefined;
		useInlineViewWhenSpaceIsLimited?: boolean;
		compactMode?: boolean;
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

	export class ConfigurationChangedEvent {
		hasChanged(id: EditorOption): boolean;
	}

	export interface IComputedEditorOptions {
		get<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;
	}

	export interface IEditorOption<K extends EditorOption, V> {
		readonly id: K;
		readonly name: string;
		defaultValue: V;
		applyUpdate(value: V | undefined, update: V): ApplyUpdateResult<V>;
	}

	export class ApplyUpdateResult<T> {
		readonly newValue: T;
		readonly didChange: boolean;
		constructor(newValue: T, didChange: boolean);
	}

	export interface IEditorCommentsOptions {
		insertSpace?: boolean;
		ignoreEmptyLines?: boolean;
	}

	export enum TextEditorCursorBlinkingStyle {
		Hidden = 0,
		Blink = 1,
		Smooth = 2,
		Phase = 3,
		Expand = 4,
		Solid = 5
	}

	export enum TextEditorCursorStyle {
		Line = 1,
		Block = 2,
		Underline = 3,
		LineThin = 4,
		BlockOutline = 5,
		UnderlineThin = 6
	}

	export interface IEditorFindOptions {
		cursorMoveOnType?: boolean;
		findOnType?: boolean;
		seedSearchStringFromSelection?: 'never' | 'always' | 'selection';
		autoFindInSelection?: 'never' | 'always' | 'multiline';
		addExtraSpaceOnTop?: boolean;
		loop?: boolean;
		closeOnResult?: boolean;
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

	export interface IEditorHoverOptions {
		enabled?: 'on' | 'off' | 'onKeyboardModifier';
		delay?: number;
		sticky?: boolean;
		hidingDelay?: number;
		above?: boolean;
		showLongLineWarning?: boolean;
	}

	export interface OverviewRulerPosition {
		readonly width: number;
		readonly height: number;
		readonly top: number;
		readonly right: number;
	}

	export enum RenderMinimap {
		None = 0,
		Text = 1,
		Blocks = 2
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

	export enum ShowLightbulbIconMode {
		Off = 'off',
		OnCode = 'onCode',
		On = 'on'
	}

	export interface IEditorLightbulbOptions {
		enabled?: ShowLightbulbIconMode;
	}

	export interface IEditorStickyScrollOptions {
		enabled?: boolean;
		maxLineCount?: number;
		defaultModel?: 'outlineModel' | 'foldingProviderModel' | 'indentationModel';
		scrollWithEditor?: boolean;
	}

	export interface IEditorInlayHintsOptions {
		enabled?: 'on' | 'off' | 'offUnlessPressed' | 'onUnlessPressed';
		fontSize?: number;
		fontFamily?: string;
		padding?: boolean;
		maximumLength?: number;
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

	export interface IEditorPaddingOptions {
		top?: number;
		bottom?: number;
	}

	export interface IEditorParameterHintOptions {
		enabled?: boolean;
		cycle?: boolean;
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

	export type LineNumbersType = 'on' | 'off' | 'relative' | 'interval' | ((lineNumber: number) => string);

	export enum RenderLineNumbersType {
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

	export interface IRulerOption {
		readonly column: number;
		readonly color: string | null;
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

	export type InUntrustedWorkspace = 'inUntrustedWorkspace';

	export interface IUnicodeHighlightOptions {
		nonBasicASCII?: boolean | InUntrustedWorkspace;
		invisibleCharacters?: boolean;
		ambiguousCharacters?: boolean;
		includeComments?: boolean | InUntrustedWorkspace;
		includeStrings?: boolean | InUntrustedWorkspace;
		allowedCharacters?: Record<string, true>;
		allowedLocales?: Record<string | '_os' | '_vscode', true>;
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
	}

	type RequiredRecursive<T> = {
		[P in keyof T]-?: T[P] extends object | undefined ? RequiredRecursive<T[P]> : T[P];
	};

	export interface IBracketPairColorizationOptions {
		enabled?: boolean;
		independentColorPoolPerBracketType?: boolean;
	}

	export interface IGuidesOptions {
		bracketPairs?: boolean | 'active';
		bracketPairsHorizontal?: boolean | 'active';
		highlightActiveBracketPair?: boolean;
		indentation?: boolean;
		highlightActiveIndentation?: boolean | 'always';
	}

	export interface ISuggestOptions {
		insertMode?: 'insert' | 'replace';
		filterGraceful?: boolean;
		snippetsPreventQuickSuggestions?: boolean;
		localityBonus?: boolean;
		shareSuggestSelections?: boolean;
		selectionMode?: 'always' | 'never' | 'whenTriggerCharacter' | 'whenQuickSuggestion';
		showIcons?: boolean;
		showStatusBar?: boolean;
		preview?: boolean;
		previewMode?: 'prefix' | 'subword' | 'subwordSmart';
		showInlineDetails?: boolean;
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

	export interface ISmartSelectOptions {
		selectLeadingAndTrailingWhitespace?: boolean;
		selectSubwords?: boolean;
	}

	export enum WrappingIndent {
		None = 0,
		Same = 1,
		Indent = 2,
		DeepIndent = 3
	}

	export interface EditorWrappingInfo {
		readonly isDominatedByLongLines: boolean;
		readonly isWordWrapMinified: boolean;
		readonly isViewportWrapping: boolean;
		readonly wrappingColumn: number;
	}

	export interface IDropIntoEditorOptions {
		enabled?: boolean;
		showDropSelector?: 'afterDrop' | 'never';
	}

	export interface IPasteAsOptions {
		enabled?: boolean;
		showPasteSelector?: 'afterPaste' | 'never';
	}

	export enum EditorOption {
		acceptSuggestionOnCommitCharacter = 0,
		acceptSuggestionOnEnter = 1,
		accessibilitySupport = 2,
		accessibilityPageSize = 3,
		allowOverflow = 4,
		allowVariableLineHeights = 5,
		allowVariableFonts = 6,
		allowVariableFontsInAccessibilityMode = 7,
		ariaLabel = 8,
		ariaRequired = 9,
		autoClosingBrackets = 10,
		autoClosingComments = 11,
		screenReaderAnnounceInlineSuggestion = 12,
		autoClosingDelete = 13,
		autoClosingOvertype = 14,
		autoClosingQuotes = 15,
		autoIndent = 16,
		autoIndentOnPaste = 17,
		autoIndentOnPasteWithinString = 18,
		automaticLayout = 19,
		autoSurround = 20,
		bracketPairColorization = 21,
		guides = 22,
		codeLens = 23,
		codeLensFontFamily = 24,
		codeLensFontSize = 25,
		colorDecorators = 26,
		colorDecoratorsLimit = 27,
		columnSelection = 28,
		comments = 29,
		contextmenu = 30,
		copyWithSyntaxHighlighting = 31,
		cursorBlinking = 32,
		cursorSmoothCaretAnimation = 33,
		cursorStyle = 34,
		cursorSurroundingLines = 35,
		cursorSurroundingLinesStyle = 36,
		cursorWidth = 37,
		cursorHeight = 38,
		disableLayerHinting = 39,
		disableMonospaceOptimizations = 40,
		domReadOnly = 41,
		dragAndDrop = 42,
		dropIntoEditor = 43,
		editContext = 44,
		emptySelectionClipboard = 45,
		experimentalGpuAcceleration = 46,
		experimentalWhitespaceRendering = 47,
		extraEditorClassName = 48,
		fastScrollSensitivity = 49,
		find = 50,
		fixedOverflowWidgets = 51,
		folding = 52,
		foldingStrategy = 53,
		foldingHighlight = 54,
		foldingImportsByDefault = 55,
		foldingMaximumRegions = 56,
		unfoldOnClickAfterEndOfLine = 57,
		fontFamily = 58,
		fontInfo = 59,
		fontLigatures = 60,
		fontSize = 61,
		fontWeight = 62,
		fontVariations = 63,
		formatOnPaste = 64,
		formatOnType = 65,
		glyphMargin = 66,
		gotoLocation = 67,
		hideCursorInOverviewRuler = 68,
		hover = 69,
		inDiffEditor = 70,
		inlineSuggest = 71,
		letterSpacing = 72,
		lightbulb = 73,
		lineDecorationsWidth = 74,
		lineHeight = 75,
		lineNumbers = 76,
		lineNumbersMinChars = 77,
		linkedEditing = 78,
		links = 79,
		matchBrackets = 80,
		minimap = 81,
		mouseStyle = 82,
		mouseWheelScrollSensitivity = 83,
		mouseWheelZoom = 84,
		multiCursorMergeOverlapping = 85,
		multiCursorModifier = 86,
		mouseMiddleClickAction = 87,
		multiCursorPaste = 88,
		multiCursorLimit = 89,
		occurrencesHighlight = 90,
		occurrencesHighlightDelay = 91,
		overtypeCursorStyle = 92,
		overtypeOnPaste = 93,
		overviewRulerBorder = 94,
		overviewRulerLanes = 95,
		padding = 96,
		pasteAs = 97,
		parameterHints = 98,
		peekWidgetDefaultFocus = 99,
		placeholder = 100,
		definitionLinkOpensInPeek = 101,
		quickSuggestions = 102,
		quickSuggestionsDelay = 103,
		readOnly = 104,
		readOnlyMessage = 105,
		renameOnType = 106,
		renderRichScreenReaderContent = 107,
		renderControlCharacters = 108,
		renderFinalNewline = 109,
		renderLineHighlight = 110,
		renderLineHighlightOnlyWhenFocus = 111,
		renderValidationDecorations = 112,
		renderWhitespace = 113,
		revealHorizontalRightPadding = 114,
		roundedSelection = 115,
		rulers = 116,
		scrollbar = 117,
		scrollBeyondLastColumn = 118,
		scrollBeyondLastLine = 119,
		scrollPredominantAxis = 120,
		selectionClipboard = 121,
		selectionHighlight = 122,
		selectionHighlightMaxLength = 123,
		selectionHighlightMultiline = 124,
		selectOnLineNumbers = 125,
		showFoldingControls = 126,
		showUnused = 127,
		snippetSuggestions = 128,
		smartSelect = 129,
		smoothScrolling = 130,
		stickyScroll = 131,
		stickyTabStops = 132,
		stopRenderingLineAfter = 133,
		suggest = 134,
		suggestFontSize = 135,
		suggestLineHeight = 136,
		suggestOnTriggerCharacters = 137,
		suggestSelection = 138,
		tabCompletion = 139,
		tabIndex = 140,
		trimWhitespaceOnDelete = 141,
		unicodeHighlighting = 142,
		unusualLineTerminators = 143,
		useShadowDOM = 144,
		useTabStops = 145,
		wordBreak = 146,
		wordSegmenterLocales = 147,
		wordSeparators = 148,
		wordWrap = 149,
		wordWrapBreakAfterCharacters = 150,
		wordWrapBreakBeforeCharacters = 151,
		wordWrapColumn = 152,
		wordWrapOverride1 = 153,
		wordWrapOverride2 = 154,
		wordWrapIndicator = 155,
		wrappingIndent = 156,
		wrappingStrategy = 157,
		showDeprecated = 158,
		inertialScroll = 159,
		inlayHints = 160,
		wrapOnEscapedLineFeeds = 161,
		effectiveCursorStyle = 162,
		editorClassName = 163,
		pixelRatio = 164,
		tabFocusMode = 165,
		layoutInfo = 166,
		wrappingInfo = 167,
		defaultColorDecorators = 168,
		colorDecoratorsActivatedOn = 169,
		inlineCompletionsAccessibilityVerbose = 170,
		effectiveEditContext = 171,
		scrollOnMiddleClick = 172,
		effectiveAllowVariableFonts = 173,
		doubleClickSelectsBlock = 174
	}

	export const EditorOptions: {
		acceptSuggestionOnCommitCharacter: IEditorOption<EditorOption.acceptSuggestionOnCommitCharacter, boolean>;
		acceptSuggestionOnEnter: IEditorOption<EditorOption.acceptSuggestionOnEnter, 'on' | 'off' | 'smart'>;
		accessibilitySupport: IEditorOption<EditorOption.accessibilitySupport, any>;
		accessibilityPageSize: IEditorOption<EditorOption.accessibilityPageSize, number>;
		allowOverflow: IEditorOption<EditorOption.allowOverflow, boolean>;
		allowVariableLineHeights: IEditorOption<EditorOption.allowVariableLineHeights, boolean>;
		allowVariableFonts: IEditorOption<EditorOption.allowVariableFonts, boolean>;
		allowVariableFontsInAccessibilityMode: IEditorOption<EditorOption.allowVariableFontsInAccessibilityMode, boolean>;
		ariaLabel: IEditorOption<EditorOption.ariaLabel, string>;
		ariaRequired: IEditorOption<EditorOption.ariaRequired, boolean>;
		screenReaderAnnounceInlineSuggestion: IEditorOption<EditorOption.screenReaderAnnounceInlineSuggestion, boolean>;
		autoClosingBrackets: IEditorOption<EditorOption.autoClosingBrackets, 'always' | 'never' | 'languageDefined' | 'beforeWhitespace'>;
		autoClosingComments: IEditorOption<EditorOption.autoClosingComments, 'always' | 'never' | 'languageDefined' | 'beforeWhitespace'>;
		autoClosingDelete: IEditorOption<EditorOption.autoClosingDelete, 'auto' | 'always' | 'never'>;
		autoClosingOvertype: IEditorOption<EditorOption.autoClosingOvertype, 'auto' | 'always' | 'never'>;
		autoClosingQuotes: IEditorOption<EditorOption.autoClosingQuotes, 'always' | 'never' | 'languageDefined' | 'beforeWhitespace'>;
		autoIndent: IEditorOption<EditorOption.autoIndent, EditorAutoIndentStrategy>;
		autoIndentOnPaste: IEditorOption<EditorOption.autoIndentOnPaste, boolean>;
		autoIndentOnPasteWithinString: IEditorOption<EditorOption.autoIndentOnPasteWithinString, boolean>;
		automaticLayout: IEditorOption<EditorOption.automaticLayout, boolean>;
		autoSurround: IEditorOption<EditorOption.autoSurround, 'never' | 'languageDefined' | 'quotes' | 'brackets'>;
		bracketPairColorization: IEditorOption<EditorOption.bracketPairColorization, Readonly<Required<IBracketPairColorizationOptions>>>;
		bracketPairGuides: IEditorOption<EditorOption.guides, Readonly<Required<IGuidesOptions>>>;
		stickyTabStops: IEditorOption<EditorOption.stickyTabStops, boolean>;
		codeLens: IEditorOption<EditorOption.codeLens, boolean>;
		codeLensFontFamily: IEditorOption<EditorOption.codeLensFontFamily, string>;
		codeLensFontSize: IEditorOption<EditorOption.codeLensFontSize, number>;
		colorDecorators: IEditorOption<EditorOption.colorDecorators, boolean>;
		colorDecoratorActivatedOn: IEditorOption<EditorOption.colorDecoratorsActivatedOn, 'hover' | 'clickAndHover' | 'click'>;
		colorDecoratorsLimit: IEditorOption<EditorOption.colorDecoratorsLimit, number>;
		columnSelection: IEditorOption<EditorOption.columnSelection, boolean>;
		comments: IEditorOption<EditorOption.comments, Readonly<Required<IEditorCommentsOptions>>>;
		contextmenu: IEditorOption<EditorOption.contextmenu, boolean>;
		copyWithSyntaxHighlighting: IEditorOption<EditorOption.copyWithSyntaxHighlighting, boolean>;
		cursorBlinking: IEditorOption<EditorOption.cursorBlinking, TextEditorCursorBlinkingStyle>;
		cursorSmoothCaretAnimation: IEditorOption<EditorOption.cursorSmoothCaretAnimation, 'on' | 'off' | 'explicit'>;
		cursorStyle: IEditorOption<EditorOption.cursorStyle, TextEditorCursorStyle>;
		overtypeCursorStyle: IEditorOption<EditorOption.overtypeCursorStyle, TextEditorCursorStyle>;
		cursorSurroundingLines: IEditorOption<EditorOption.cursorSurroundingLines, number>;
		cursorSurroundingLinesStyle: IEditorOption<EditorOption.cursorSurroundingLinesStyle, 'default' | 'all'>;
		cursorWidth: IEditorOption<EditorOption.cursorWidth, number>;
		cursorHeight: IEditorOption<EditorOption.cursorHeight, number>;
		disableLayerHinting: IEditorOption<EditorOption.disableLayerHinting, boolean>;
		disableMonospaceOptimizations: IEditorOption<EditorOption.disableMonospaceOptimizations, boolean>;
		domReadOnly: IEditorOption<EditorOption.domReadOnly, boolean>;
		doubleClickSelectsBlock: IEditorOption<EditorOption.doubleClickSelectsBlock, boolean>;
		dragAndDrop: IEditorOption<EditorOption.dragAndDrop, boolean>;
		emptySelectionClipboard: IEditorOption<EditorOption.emptySelectionClipboard, boolean>;
		dropIntoEditor: IEditorOption<EditorOption.dropIntoEditor, Readonly<Required<IDropIntoEditorOptions>>>;
		editContext: IEditorOption<EditorOption.editContext, boolean>;
		renderRichScreenReaderContent: IEditorOption<EditorOption.renderRichScreenReaderContent, boolean>;
		stickyScroll: IEditorOption<EditorOption.stickyScroll, Readonly<Required<IEditorStickyScrollOptions>>>;
		experimentalGpuAcceleration: IEditorOption<EditorOption.experimentalGpuAcceleration, 'on' | 'off'>;
		experimentalWhitespaceRendering: IEditorOption<EditorOption.experimentalWhitespaceRendering, 'off' | 'svg' | 'font'>;
		extraEditorClassName: IEditorOption<EditorOption.extraEditorClassName, string>;
		fastScrollSensitivity: IEditorOption<EditorOption.fastScrollSensitivity, number>;
		find: IEditorOption<EditorOption.find, Readonly<Required<IEditorFindOptions>>>;
		fixedOverflowWidgets: IEditorOption<EditorOption.fixedOverflowWidgets, boolean>;
		folding: IEditorOption<EditorOption.folding, boolean>;
		foldingStrategy: IEditorOption<EditorOption.foldingStrategy, 'auto' | 'indentation'>;
		foldingHighlight: IEditorOption<EditorOption.foldingHighlight, boolean>;
		foldingImportsByDefault: IEditorOption<EditorOption.foldingImportsByDefault, boolean>;
		foldingMaximumRegions: IEditorOption<EditorOption.foldingMaximumRegions, number>;
		unfoldOnClickAfterEndOfLine: IEditorOption<EditorOption.unfoldOnClickAfterEndOfLine, boolean>;
		fontFamily: IEditorOption<EditorOption.fontFamily, string>;
		fontInfo: IEditorOption<EditorOption.fontInfo, any>;
		fontLigatures2: IEditorOption<EditorOption.fontLigatures, string>;
		fontSize: IEditorOption<EditorOption.fontSize, number>;
		fontWeight: IEditorOption<EditorOption.fontWeight, string>;
		fontVariations: IEditorOption<EditorOption.fontVariations, string>;
		formatOnPaste: IEditorOption<EditorOption.formatOnPaste, boolean>;
		formatOnType: IEditorOption<EditorOption.formatOnType, boolean>;
		glyphMargin: IEditorOption<EditorOption.glyphMargin, boolean>;
		gotoLocation: IEditorOption<EditorOption.gotoLocation, Readonly<Required<IGotoLocationOptions>>>;
		hideCursorInOverviewRuler: IEditorOption<EditorOption.hideCursorInOverviewRuler, boolean>;
		hover: IEditorOption<EditorOption.hover, Readonly<Required<IEditorHoverOptions>>>;
		inDiffEditor: IEditorOption<EditorOption.inDiffEditor, boolean>;
		inertialScroll: IEditorOption<EditorOption.inertialScroll, boolean>;
		letterSpacing: IEditorOption<EditorOption.letterSpacing, number>;
		lightbulb: IEditorOption<EditorOption.lightbulb, Readonly<Required<IEditorLightbulbOptions>>>;
		lineDecorationsWidth: IEditorOption<EditorOption.lineDecorationsWidth, number>;
		lineHeight: IEditorOption<EditorOption.lineHeight, number>;
		lineNumbers: IEditorOption<EditorOption.lineNumbers, InternalEditorRenderLineNumbersOptions>;
		lineNumbersMinChars: IEditorOption<EditorOption.lineNumbersMinChars, number>;
		linkedEditing: IEditorOption<EditorOption.linkedEditing, boolean>;
		links: IEditorOption<EditorOption.links, boolean>;
		matchBrackets: IEditorOption<EditorOption.matchBrackets, 'always' | 'never' | 'near'>;
		minimap: IEditorOption<EditorOption.minimap, Readonly<Required<IEditorMinimapOptions>>>;
		mouseStyle: IEditorOption<EditorOption.mouseStyle, 'default' | 'text' | 'copy'>;
		mouseWheelScrollSensitivity: IEditorOption<EditorOption.mouseWheelScrollSensitivity, number>;
		mouseWheelZoom: IEditorOption<EditorOption.mouseWheelZoom, boolean>;
		multiCursorMergeOverlapping: IEditorOption<EditorOption.multiCursorMergeOverlapping, boolean>;
		multiCursorModifier: IEditorOption<EditorOption.multiCursorModifier, 'altKey' | 'metaKey' | 'ctrlKey'>;
		mouseMiddleClickAction: IEditorOption<EditorOption.mouseMiddleClickAction, MouseMiddleClickAction>;
		multiCursorPaste: IEditorOption<EditorOption.multiCursorPaste, 'spread' | 'full'>;
		multiCursorLimit: IEditorOption<EditorOption.multiCursorLimit, number>;
		occurrencesHighlight: IEditorOption<EditorOption.occurrencesHighlight, 'off' | 'singleFile' | 'multiFile'>;
		occurrencesHighlightDelay: IEditorOption<EditorOption.occurrencesHighlightDelay, number>;
		overtypeOnPaste: IEditorOption<EditorOption.overtypeOnPaste, boolean>;
		overviewRulerBorder: IEditorOption<EditorOption.overviewRulerBorder, boolean>;
		overviewRulerLanes: IEditorOption<EditorOption.overviewRulerLanes, number>;
		padding: IEditorOption<EditorOption.padding, Readonly<Required<IEditorPaddingOptions>>>;
		pasteAs: IEditorOption<EditorOption.pasteAs, Readonly<Required<IPasteAsOptions>>>;
		parameterHints: IEditorOption<EditorOption.parameterHints, Readonly<Required<IEditorParameterHintOptions>>>;
		peekWidgetDefaultFocus: IEditorOption<EditorOption.peekWidgetDefaultFocus, 'tree' | 'editor'>;
		placeholder: IEditorOption<EditorOption.placeholder, string | undefined>;
		definitionLinkOpensInPeek: IEditorOption<EditorOption.definitionLinkOpensInPeek, boolean>;
		quickSuggestions: IEditorOption<EditorOption.quickSuggestions, InternalQuickSuggestionsOptions>;
		quickSuggestionsDelay: IEditorOption<EditorOption.quickSuggestionsDelay, number>;
		readOnly: IEditorOption<EditorOption.readOnly, boolean>;
		readOnlyMessage: IEditorOption<EditorOption.readOnlyMessage, any>;
		renameOnType: IEditorOption<EditorOption.renameOnType, boolean>;
		renderControlCharacters: IEditorOption<EditorOption.renderControlCharacters, boolean>;
		renderFinalNewline: IEditorOption<EditorOption.renderFinalNewline, 'on' | 'off' | 'dimmed'>;
		renderLineHighlight: IEditorOption<EditorOption.renderLineHighlight, 'all' | 'line' | 'none' | 'gutter'>;
		renderLineHighlightOnlyWhenFocus: IEditorOption<EditorOption.renderLineHighlightOnlyWhenFocus, boolean>;
		renderValidationDecorations: IEditorOption<EditorOption.renderValidationDecorations, 'on' | 'off' | 'editable'>;
		renderWhitespace: IEditorOption<EditorOption.renderWhitespace, 'all' | 'none' | 'boundary' | 'selection' | 'trailing'>;
		revealHorizontalRightPadding: IEditorOption<EditorOption.revealHorizontalRightPadding, number>;
		roundedSelection: IEditorOption<EditorOption.roundedSelection, boolean>;
		rulers: IEditorOption<EditorOption.rulers, IRulerOption[]>;
		scrollbar: IEditorOption<EditorOption.scrollbar, InternalEditorScrollbarOptions>;
		scrollBeyondLastColumn: IEditorOption<EditorOption.scrollBeyondLastColumn, number>;
		scrollBeyondLastLine: IEditorOption<EditorOption.scrollBeyondLastLine, boolean>;
		scrollOnMiddleClick: IEditorOption<EditorOption.scrollOnMiddleClick, boolean>;
		scrollPredominantAxis: IEditorOption<EditorOption.scrollPredominantAxis, boolean>;
		selectionClipboard: IEditorOption<EditorOption.selectionClipboard, boolean>;
		selectionHighlight: IEditorOption<EditorOption.selectionHighlight, boolean>;
		selectionHighlightMaxLength: IEditorOption<EditorOption.selectionHighlightMaxLength, number>;
		selectionHighlightMultiline: IEditorOption<EditorOption.selectionHighlightMultiline, boolean>;
		selectOnLineNumbers: IEditorOption<EditorOption.selectOnLineNumbers, boolean>;
		showFoldingControls: IEditorOption<EditorOption.showFoldingControls, 'always' | 'never' | 'mouseover'>;
		showUnused: IEditorOption<EditorOption.showUnused, boolean>;
		showDeprecated: IEditorOption<EditorOption.showDeprecated, boolean>;
		inlayHints: IEditorOption<EditorOption.inlayHints, Readonly<Required<IEditorInlayHintsOptions>>>;
		snippetSuggestions: IEditorOption<EditorOption.snippetSuggestions, 'none' | 'inline' | 'top' | 'bottom'>;
		smartSelect: IEditorOption<EditorOption.smartSelect, Readonly<Required<ISmartSelectOptions>>>;
		smoothScrolling: IEditorOption<EditorOption.smoothScrolling, boolean>;
		stopRenderingLineAfter: IEditorOption<EditorOption.stopRenderingLineAfter, number>;
		suggest: IEditorOption<EditorOption.suggest, Readonly<Required<ISuggestOptions>>>;
		inlineSuggest: IEditorOption<EditorOption.inlineSuggest, Readonly<RequiredRecursive<IInlineSuggestOptions>>>;
		inlineCompletionsAccessibilityVerbose: IEditorOption<EditorOption.inlineCompletionsAccessibilityVerbose, boolean>;
		suggestFontSize: IEditorOption<EditorOption.suggestFontSize, number>;
		suggestLineHeight: IEditorOption<EditorOption.suggestLineHeight, number>;
		suggestOnTriggerCharacters: IEditorOption<EditorOption.suggestOnTriggerCharacters, boolean>;
		suggestSelection: IEditorOption<EditorOption.suggestSelection, 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix'>;
		tabCompletion: IEditorOption<EditorOption.tabCompletion, 'on' | 'off' | 'onlySnippets'>;
		tabIndex: IEditorOption<EditorOption.tabIndex, number>;
		trimWhitespaceOnDelete: IEditorOption<EditorOption.trimWhitespaceOnDelete, boolean>;
		unicodeHighlight: IEditorOption<EditorOption.unicodeHighlighting, Required<Readonly<IUnicodeHighlightOptions>>>;
		unusualLineTerminators: IEditorOption<EditorOption.unusualLineTerminators, 'off' | 'auto' | 'prompt'>;
		useShadowDOM: IEditorOption<EditorOption.useShadowDOM, boolean>;
		useTabStops: IEditorOption<EditorOption.useTabStops, boolean>;
		wordBreak: IEditorOption<EditorOption.wordBreak, 'normal' | 'keepAll'>;
		wordSegmenterLocales: IEditorOption<EditorOption.wordSegmenterLocales, string[]>;
		wordSeparators: IEditorOption<EditorOption.wordSeparators, string>;
		wordWrap: IEditorOption<EditorOption.wordWrap, 'wordWrapColumn' | 'on' | 'off' | 'bounded'>;
		wordWrapBreakAfterCharacters: IEditorOption<EditorOption.wordWrapBreakAfterCharacters, string>;
		wordWrapBreakBeforeCharacters: IEditorOption<EditorOption.wordWrapBreakBeforeCharacters, string>;
		wordWrapColumn: IEditorOption<EditorOption.wordWrapColumn, number>;
		wordWrapOverride1: IEditorOption<EditorOption.wordWrapOverride1, 'on' | 'off' | 'inherit'>;
		wordWrapOverride2: IEditorOption<EditorOption.wordWrapOverride2, 'on' | 'off' | 'inherit'>;
		wordWrapIndicator: IEditorOption<EditorOption.wordWrapIndicator, boolean>;
		wrapOnEscapedLineFeeds: IEditorOption<EditorOption.wrapOnEscapedLineFeeds, boolean>;
		effectiveCursorStyle: IEditorOption<EditorOption.effectiveCursorStyle, TextEditorCursorStyle>;
		editorClassName: IEditorOption<EditorOption.editorClassName, string>;
		defaultColorDecorators: IEditorOption<EditorOption.defaultColorDecorators, 'auto' | 'always' | 'never'>;
		pixelRatio: IEditorOption<EditorOption.pixelRatio, number>;
		tabFocusMode: IEditorOption<EditorOption.tabFocusMode, boolean>;
		layoutInfo: IEditorOption<EditorOption.layoutInfo, EditorLayoutInfo>;
		wrappingInfo: IEditorOption<EditorOption.wrappingInfo, EditorWrappingInfo>;
		wrappingIndent: IEditorOption<EditorOption.wrappingIndent, WrappingIndent>;
		wrappingStrategy: IEditorOption<EditorOption.wrappingStrategy, 'simple' | 'advanced'>;
		effectiveEditContextEnabled: IEditorOption<EditorOption.effectiveEditContext, boolean>;
		effectiveAllowVariableFonts: IEditorOption<EditorOption.effectiveAllowVariableFonts, boolean>;
	};

	type EditorOptionsType = typeof EditorOptions;

	type FindEditorOptionsKeyById<T extends EditorOption> = {
		[K in keyof EditorOptionsType]: EditorOptionsType[K]['id'] extends T ? K : never;
	}[keyof EditorOptionsType];

	type ComputedEditorOptionValue<T extends IEditorOption<any, any>> = T extends IEditorOption<any, infer R> ? R : never;

	export type FindComputedEditorOptionValueById<T extends EditorOption> = NonNullable<ComputedEditorOptionValue<EditorOptionsType[FindEditorOptionsKeyById<T>]>>;

	export type MouseMiddleClickAction = 'default' | 'openLink' | 'ctrlLeftClick';

	export interface IEditorConstructionOptions extends IEditorOptions {
		dimension?: IDimension;
		overflowWidgetsDomNode?: HTMLElement;
	}

	export interface IViewZone {
		afterLineNumber: number;
		afterColumn?: number;
		afterColumnAffinity?: PositionAffinity;
		showInHiddenAreas?: boolean;
		ordinal?: number;
		suppressMouseDown?: boolean;
		heightInLines?: number;
		heightInPx?: number;
		minWidthInPx?: number;
		domNode: HTMLElement;
		marginDomNode?: HTMLElement | null;
		onDomNodeTop?: (top: number) => void;
		onComputedHeight?: (height: number) => void;
	}

	export interface IViewZoneChangeAccessor {
		addZone(zone: IViewZone): string;
		removeZone(id: string): void;
		layoutZone(id: string): void;
	}

	export enum ContentWidgetPositionPreference {
		EXACT = 0,
		ABOVE = 1,
		BELOW = 2
	}

	export interface IContentWidgetPosition {
		position: IPosition | null;
		secondaryPosition?: IPosition | null;
		preference: ContentWidgetPositionPreference[];
		positionAffinity?: PositionAffinity;
	}

	export interface IContentWidget {
		allowEditorOverflow?: boolean;
		useDisplayNone?: boolean;
		suppressMouseDown?: boolean;
		getId(): string;
		getDomNode(): HTMLElement;
		getPosition(): IContentWidgetPosition | null;
		beforeRender?(): IDimension | null;
		afterRender?(position: ContentWidgetPositionPreference | null, coordinate: IContentWidgetRenderedCoordinate | null): void;
	}

	export interface IContentWidgetRenderedCoordinate {
		readonly top: number;
		readonly left: number;
	}

	export enum OverlayWidgetPositionPreference {
		TOP_RIGHT_CORNER = 0,
		BOTTOM_RIGHT_CORNER = 1,
		TOP_CENTER = 2
	}

	export interface IOverlayWidgetPositionCoordinates {
		top: number;
		left: number;
	}

	export interface IOverlayWidgetPosition {
		preference: OverlayWidgetPositionPreference | IOverlayWidgetPositionCoordinates | null;
		stackOrdinal?: number;
	}

	export interface IOverlayWidget {
		readonly onDidLayout?: IEvent<void>;
		allowEditorOverflow?: boolean;
		getId(): string;
		getDomNode(): HTMLElement;
		getPosition(): IOverlayWidgetPosition | null;
		getMinContentWidthInPx?(): number;
	}

	export interface IGlyphMarginWidget {
		getId(): string;
		getDomNode(): HTMLElement;
		getPosition(): IGlyphMarginWidgetPosition;
	}

	export interface IGlyphMarginWidgetPosition {
		lane: GlyphMarginLane;
		zIndex: number;
		range: IRange;
	}

	export enum MouseTargetType {
		UNKNOWN = 0,
		TEXTAREA = 1,
		GUTTER_GLYPH_MARGIN = 2,
		GUTTER_LINE_NUMBERS = 3,
		GUTTER_LINE_DECORATIONS = 4,
		GUTTER_VIEW_ZONE = 5,
		CONTENT_TEXT = 6,
		CONTENT_EMPTY = 7,
		CONTENT_VIEW_ZONE = 8,
		CONTENT_WIDGET = 9,
		OVERVIEW_RULER = 10,
		SCROLLBAR = 11,
		OVERLAY_WIDGET = 12,
		OUTSIDE_EDITOR = 13
	}

	export interface IBaseMouseTarget {
		readonly element: HTMLElement | null;
		readonly position: Position | null;
		readonly mouseColumn: number;
		readonly range: Range | null;
	}

	export interface IMouseTargetUnknown extends IBaseMouseTarget {
		readonly type: MouseTargetType.UNKNOWN;
	}

	export interface IMouseTargetTextarea extends IBaseMouseTarget {
		readonly type: MouseTargetType.TEXTAREA;
		readonly position: null;
		readonly range: null;
	}

	export interface IMouseTargetMarginData {
		readonly isAfterLines: boolean;
		readonly glyphMarginLeft: number;
		readonly glyphMarginWidth: number;
		readonly glyphMarginLane?: GlyphMarginLane;
		readonly lineNumbersWidth: number;
		readonly offsetX: number;
	}

	export interface IMouseTargetMargin extends IBaseMouseTarget {
		readonly type: MouseTargetType.GUTTER_GLYPH_MARGIN | MouseTargetType.GUTTER_LINE_NUMBERS | MouseTargetType.GUTTER_LINE_DECORATIONS;
		readonly position: Position;
		readonly range: Range;
		readonly detail: IMouseTargetMarginData;
	}

	export interface IMouseTargetViewZoneData {
		readonly viewZoneId: string;
		readonly positionBefore: Position | null;
		readonly positionAfter: Position | null;
		readonly position: Position;
		readonly afterLineNumber: number;
	}

	export interface IMouseTargetViewZone extends IBaseMouseTarget {
		readonly type: MouseTargetType.GUTTER_VIEW_ZONE | MouseTargetType.CONTENT_VIEW_ZONE;
		readonly position: Position;
		readonly range: Range;
		readonly detail: IMouseTargetViewZoneData;
	}

	export interface IMouseTargetContentTextData {
		readonly mightBeForeignElement: boolean;
	}

	export interface IMouseTargetContentText extends IBaseMouseTarget {
		readonly type: MouseTargetType.CONTENT_TEXT;
		readonly position: Position;
		readonly range: Range;
		readonly detail: IMouseTargetContentTextData;
	}

	export interface IMouseTargetContentEmptyData {
		readonly isAfterLines: boolean;
		readonly horizontalDistanceToText?: number;
	}

	export interface IMouseTargetContentEmpty extends IBaseMouseTarget {
		readonly type: MouseTargetType.CONTENT_EMPTY;
		readonly position: Position;
		readonly range: Range;
		readonly detail: IMouseTargetContentEmptyData;
	}

	export interface IMouseTargetContentWidget extends IBaseMouseTarget {
		readonly type: MouseTargetType.CONTENT_WIDGET;
		readonly position: null;
		readonly range: null;
		readonly detail: string;
	}

	export interface IMouseTargetOverlayWidget extends IBaseMouseTarget {
		readonly type: MouseTargetType.OVERLAY_WIDGET;
		readonly position: null;
		readonly range: null;
		readonly detail: string;
	}

	export interface IMouseTargetScrollbar extends IBaseMouseTarget {
		readonly type: MouseTargetType.SCROLLBAR;
		readonly position: Position;
		readonly range: Range;
	}

	export interface IMouseTargetOverviewRuler extends IBaseMouseTarget {
		readonly type: MouseTargetType.OVERVIEW_RULER;
	}

	export interface IMouseTargetOutsideEditor extends IBaseMouseTarget {
		readonly type: MouseTargetType.OUTSIDE_EDITOR;
		readonly outsidePosition: 'above' | 'below' | 'left' | 'right';
		readonly outsideDistance: number;
	}

	export type IMouseTarget = (IMouseTargetUnknown | IMouseTargetTextarea | IMouseTargetMargin | IMouseTargetViewZone | IMouseTargetContentText | IMouseTargetContentEmpty | IMouseTargetContentWidget | IMouseTargetOverlayWidget | IMouseTargetScrollbar | IMouseTargetOverviewRuler | IMouseTargetOutsideEditor);

	export interface IEditorMouseEvent {
		readonly event: IMouseEvent;
		readonly target: IMouseTarget;
	}

	export interface IPartialEditorMouseEvent {
		readonly event: IMouseEvent;
		readonly target: IMouseTarget | null;
	}

	export interface IPasteEvent {
		readonly range: Range;
		readonly languageId: string | null;
		readonly clipboardEvent?: ClipboardEvent;
	}

	export interface IDiffEditorConstructionOptions extends IDiffEditorOptions, IEditorConstructionOptions {
		overflowWidgetsDomNode?: HTMLElement;
		originalAriaLabel?: string;
		modifiedAriaLabel?: string;
	}

	export interface ICodeEditor extends IEditor {
		readonly onDidChangeModelContent: IEvent<IModelContentChangedEvent>;
		readonly onDidChangeModelLanguage: IEvent<IModelLanguageChangedEvent>;
		readonly onDidChangeModelLanguageConfiguration: IEvent<IModelLanguageConfigurationChangedEvent>;
		readonly onDidChangeModelOptions: IEvent<IModelOptionsChangedEvent>;
		readonly onDidChangeConfiguration: IEvent<ConfigurationChangedEvent>;
		readonly onDidChangeCursorPosition: IEvent<ICursorPositionChangedEvent>;
		readonly onDidChangeCursorSelection: IEvent<ICursorSelectionChangedEvent>;
		readonly onWillChangeModel: IEvent<IModelChangedEvent>;
		readonly onDidChangeModel: IEvent<IModelChangedEvent>;
		readonly onDidChangeModelDecorations: IEvent<IModelDecorationsChangedEvent>;
		readonly onDidFocusEditorText: IEvent<void>;
		readonly onDidBlurEditorText: IEvent<void>;
		readonly onDidFocusEditorWidget: IEvent<void>;
		readonly onDidBlurEditorWidget: IEvent<void>;
		readonly inComposition: boolean;
		readonly onDidCompositionStart: IEvent<void>;
		readonly onDidCompositionEnd: IEvent<void>;
		readonly onDidAttemptReadOnlyEdit: IEvent<void>;
		readonly onDidPaste: IEvent<IPasteEvent>;
		readonly onMouseUp: IEvent<IEditorMouseEvent>;
		readonly onMouseDown: IEvent<IEditorMouseEvent>;
		readonly onContextMenu: IEvent<IEditorMouseEvent>;
		readonly onMouseMove: IEvent<IEditorMouseEvent>;
		readonly onMouseLeave: IEvent<IPartialEditorMouseEvent>;
		readonly onKeyUp: IEvent<IKeyboardEvent>;
		readonly onKeyDown: IEvent<IKeyboardEvent>;
		readonly onDidLayoutChange: IEvent<EditorLayoutInfo>;
		readonly onDidContentSizeChange: IEvent<IContentSizeChangedEvent>;
		readonly onDidScrollChange: IEvent<IScrollEvent>;
		readonly onDidChangeHiddenAreas: IEvent<void>;
		readonly onBeginUpdate: IEvent<void>;
		readonly onEndUpdate: IEvent<void>;
		readonly onDidChangeViewZones: IEvent<void>;
		saveViewState(): ICodeEditorViewState | null;
		restoreViewState(state: ICodeEditorViewState | null): void;
		hasWidgetFocus(): boolean;
		getContribution<T extends IEditorContribution>(id: string): T | null;
		getModel(): ITextModel | null;
		setModel(model: ITextModel | null): void;
		getOptions(): IComputedEditorOptions;
		getOption<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;
		getRawOptions(): IEditorOptions;
		getValue(options?: {
			preserveBOM: boolean;
			lineEnding: string;
		}): string;
		setValue(newValue: string): void;
		getContentWidth(): number;
		getScrollWidth(): number;
		getScrollLeft(): number;
		getContentHeight(): number;
		getScrollHeight(): number;
		getScrollTop(): number;
		setScrollLeft(newScrollLeft: number, scrollType?: ScrollType): void;
		setScrollTop(newScrollTop: number, scrollType?: ScrollType): void;
		setScrollPosition(position: INewScrollPosition, scrollType?: ScrollType): void;
		hasPendingScrollAnimation(): boolean;
		getAction(id: string): IEditorAction | null;
		executeCommand(source: string | null | undefined, command: ICommand): void;
		pushUndoStop(): boolean;
		popUndoStop(): boolean;
		executeEdits(source: string | null | undefined, edits: IIdentifiedSingleEditOperation[], endCursorState?: ICursorStateComputer | Selection[]): boolean;
		executeCommands(source: string | null | undefined, commands: (ICommand | null)[]): void;
		revealAllCursors(revealHorizontal: boolean, minimalReveal?: boolean): void;
		getLineDecorations(lineNumber: number): IModelDecoration[] | null;
		getDecorationsInRange(range: Range): IModelDecoration[] | null;
		getFontSizeAtPosition(position: IPosition): string | null;
		deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
		removeDecorations(decorationIds: string[]): void;
		getLayoutInfo(): EditorLayoutInfo;
		getVisibleRanges(): Range[];
		getTopForLineNumber(lineNumber: number, includeViewZones?: boolean): number;
		getBottomForLineNumber(lineNumber: number): number;
		getTopForPosition(lineNumber: number, column: number): number;
		getLineHeightForPosition(position: IPosition): number;
		writeScreenReaderContent(reason: string): void;
		getContainerDomNode(): HTMLElement;
		getDomNode(): HTMLElement | null;
		addContentWidget(widget: IContentWidget): void;
		layoutContentWidget(widget: IContentWidget): void;
		removeContentWidget(widget: IContentWidget): void;
		addOverlayWidget(widget: IOverlayWidget): void;
		layoutOverlayWidget(widget: IOverlayWidget): void;
		removeOverlayWidget(widget: IOverlayWidget): void;
		addGlyphMarginWidget(widget: IGlyphMarginWidget): void;
		layoutGlyphMarginWidget(widget: IGlyphMarginWidget): void;
		removeGlyphMarginWidget(widget: IGlyphMarginWidget): void;
		changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void;
		getOffsetForColumn(lineNumber: number, column: number): number;
		getWidthOfLine(lineNumber: number): number;
		render(forceRedraw?: boolean): void;
		renderAsync(forceRedraw?: boolean): void;
		getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null;
		getScrolledVisiblePosition(position: IPosition): {
			top: number;
			left: number;
			height: number;
		} | null;
		applyFontInfo(target: HTMLElement): void;
		setBanner(bannerDomNode: HTMLElement | null, height: number): void;
		handleInitialized?(): void;
	}

	export interface IDiffEditor extends IEditor {
		getContainerDomNode(): HTMLElement;
		readonly onDidUpdateDiff: IEvent<void>;
		readonly onDidChangeModel: IEvent<void>;
		saveViewState(): IDiffEditorViewState | null;
		restoreViewState(state: IDiffEditorViewState | null): void;
		getModel(): IDiffEditorModel | null;
		createViewModel(model: IDiffEditorModel): IDiffEditorViewModel;
		setModel(model: IDiffEditorModel | IDiffEditorViewModel | null): void;
		getOriginalEditor(): ICodeEditor;
		getModifiedEditor(): ICodeEditor;
		getLineChanges(): ILineChange[] | null;
		updateOptions(newOptions: IDiffEditorOptions): void;
		goToDiff(target: 'next' | 'previous'): void;
		revealFirstDiff(): unknown;
		accessibleDiffViewerNext(): void;
		accessibleDiffViewerPrev(): void;
		handleInitialized(): void;
	}

	export class FontInfo extends BareFontInfo {
		readonly _editorStylingBrand: void;
		readonly version: number;
		readonly isTrusted: boolean;
		readonly isMonospace: boolean;
		readonly typicalHalfwidthCharacterWidth: number;
		readonly typicalFullwidthCharacterWidth: number;
		readonly canUseHalfwidthRightwardsArrow: boolean;
		readonly spaceWidth: number;
		readonly middotWidth: number;
		readonly wsmiddotWidth: number;
		readonly maxDigitWidth: number;
	}

	export class BareFontInfo {
		readonly _bareFontInfoBrand: void;
		readonly pixelRatio: number;
		readonly fontFamily: string;
		readonly fontWeight: string;
		readonly fontSize: number;
		readonly fontFeatureSettings: string;
		readonly fontVariationSettings: string;
		readonly lineHeight: number;
		readonly letterSpacing: number;
	}

	export const EditorZoom: IEditorZoom;

	export interface IEditorZoom {
		readonly onDidChangeZoomLevel: IEvent<number>;
		getZoomLevel(): number;
		setZoomLevel(zoomLevel: number): void;
	}

	//compatibility:
	export type IReadOnlyModel = ITextModel;
	export type IModel = ITextModel;
}

declare namespace monaco.languages {


	export class EditDeltaInfo {
		readonly linesAdded: number;
		readonly linesRemoved: number;
		readonly charsAdded: number;
		readonly charsRemoved: number;
		static fromText(text: string): EditDeltaInfo;
		static tryCreate(linesAdded: number | undefined, linesRemoved: number | undefined, charsAdded: number | undefined, charsRemoved: number | undefined): EditDeltaInfo | undefined;
		constructor(linesAdded: number, linesRemoved: number, charsAdded: number, charsRemoved: number);
	}
	export interface IRelativePattern {
		readonly base: string;
		readonly pattern: string;
	}

	export type LanguageSelector = string | LanguageFilter | ReadonlyArray<string | LanguageFilter>;

	export interface LanguageFilter {
		readonly language?: string;
		readonly scheme?: string;
		readonly pattern?: string | IRelativePattern;
		readonly notebookType?: string;
		readonly hasAccessToAllModels?: boolean;
		readonly exclusive?: boolean;
		readonly isBuiltin?: boolean;
	}

	export function register(language: ILanguageExtensionPoint): void;

	export function getLanguages(): ILanguageExtensionPoint[];

	export function getEncodedLanguageId(languageId: string): number;

	export function onLanguage(languageId: string, callback: () => void): IDisposable;

	export function onLanguageEncountered(languageId: string, callback: () => void): IDisposable;

	export function setLanguageConfiguration(languageId: string, configuration: LanguageConfiguration): IDisposable;

	export interface IToken {
		startIndex: number;
		scopes: string;
	}

	export interface ILineTokens {
		tokens: IToken[];
		endState: IState;
	}

	export interface IEncodedLineTokens {
		tokens: Uint32Array;
		endState: IState;
	}

	export interface TokensProviderFactory {
		create(): ProviderResult<TokensProvider | EncodedTokensProvider | IMonarchLanguage>;
	}

	export interface TokensProvider {
		getInitialState(): IState;
		tokenize(line: string, state: IState): ILineTokens;
	}

	export interface EncodedTokensProvider {
		getInitialState(): IState;
		tokenizeEncoded(line: string, state: IState): IEncodedLineTokens;
		tokenize?(line: string, state: IState): ILineTokens;
	}

	export function setColorMap(colorMap: string[] | null): void;

	export function registerTokensProviderFactory(languageId: string, factory: TokensProviderFactory): IDisposable;

	export function setTokensProvider(languageId: string, provider: TokensProvider | EncodedTokensProvider | Thenable<TokensProvider | EncodedTokensProvider>): IDisposable;

	export function setMonarchTokensProvider(languageId: string, languageDef: IMonarchLanguage | Thenable<IMonarchLanguage>): IDisposable;

	export function registerReferenceProvider(languageSelector: LanguageSelector, provider: ReferenceProvider): IDisposable;

	export function registerRenameProvider(languageSelector: LanguageSelector, provider: RenameProvider): IDisposable;

	export function registerNewSymbolNameProvider(languageSelector: LanguageSelector, provider: NewSymbolNamesProvider): IDisposable;

	export function registerSignatureHelpProvider(languageSelector: LanguageSelector, provider: SignatureHelpProvider): IDisposable;

	export function registerHoverProvider(languageSelector: LanguageSelector, provider: HoverProvider): IDisposable;

	export function registerDocumentSymbolProvider(languageSelector: LanguageSelector, provider: DocumentSymbolProvider): IDisposable;

	export function registerDocumentHighlightProvider(languageSelector: LanguageSelector, provider: DocumentHighlightProvider): IDisposable;

	export function registerLinkedEditingRangeProvider(languageSelector: LanguageSelector, provider: LinkedEditingRangeProvider): IDisposable;

	export function registerDefinitionProvider(languageSelector: LanguageSelector, provider: DefinitionProvider): IDisposable;

	export function registerImplementationProvider(languageSelector: LanguageSelector, provider: ImplementationProvider): IDisposable;

	export function registerTypeDefinitionProvider(languageSelector: LanguageSelector, provider: TypeDefinitionProvider): IDisposable;

	export function registerCodeLensProvider(languageSelector: LanguageSelector, provider: CodeLensProvider): IDisposable;

	export function registerCodeActionProvider(languageSelector: LanguageSelector, provider: CodeActionProvider, metadata?: CodeActionProviderMetadata): IDisposable;

	export function registerDocumentFormattingEditProvider(languageSelector: LanguageSelector, provider: DocumentFormattingEditProvider): IDisposable;

	export function registerDocumentRangeFormattingEditProvider(languageSelector: LanguageSelector, provider: DocumentRangeFormattingEditProvider): IDisposable;

	export function registerOnTypeFormattingEditProvider(languageSelector: LanguageSelector, provider: OnTypeFormattingEditProvider): IDisposable;

	export function registerLinkProvider(languageSelector: LanguageSelector, provider: LinkProvider): IDisposable;

	export function registerCompletionItemProvider(languageSelector: LanguageSelector, provider: CompletionItemProvider): IDisposable;

	export function registerColorProvider(languageSelector: LanguageSelector, provider: DocumentColorProvider): IDisposable;

	export function registerFoldingRangeProvider(languageSelector: LanguageSelector, provider: FoldingRangeProvider): IDisposable;

	export function registerDeclarationProvider(languageSelector: LanguageSelector, provider: DeclarationProvider): IDisposable;

	export function registerSelectionRangeProvider(languageSelector: LanguageSelector, provider: SelectionRangeProvider): IDisposable;

	export function registerDocumentSemanticTokensProvider(languageSelector: LanguageSelector, provider: DocumentSemanticTokensProvider): IDisposable;

	export function registerDocumentRangeSemanticTokensProvider(languageSelector: LanguageSelector, provider: DocumentRangeSemanticTokensProvider): IDisposable;

	export function registerInlineCompletionsProvider(languageSelector: LanguageSelector, provider: InlineCompletionsProvider): IDisposable;

	export function registerInlayHintsProvider(languageSelector: LanguageSelector, provider: InlayHintsProvider): IDisposable;

	export interface CodeActionContext {
		readonly markers: editor.IMarkerData[];
		readonly only?: string;
		readonly trigger: CodeActionTriggerType;
	}

	export interface CodeActionProvider {
		provideCodeActions(model: editor.ITextModel, range: Range, context: CodeActionContext, token: CancellationToken): ProviderResult<CodeActionList>;
		resolveCodeAction?(codeAction: CodeAction, token: CancellationToken): ProviderResult<CodeAction>;
	}

	export interface CodeActionProviderMetadata {
		readonly providedCodeActionKinds?: readonly string[];
		readonly documentation?: ReadonlyArray<{
			readonly kind: string;
			readonly command: Command;
		}>;
	}

	export interface LineCommentConfig {
		comment: string;
		noIndent?: boolean;
	}

	export interface CommentRule {
		lineComment?: string | LineCommentConfig | null;
		blockComment?: CharacterPair | null;
	}

	export interface LanguageConfiguration {
		comments?: CommentRule;
		brackets?: CharacterPair[];
		wordPattern?: RegExp;
		indentationRules?: IndentationRule;
		onEnterRules?: OnEnterRule[];
		autoClosingPairs?: IAutoClosingPairConditional[];
		surroundingPairs?: IAutoClosingPair[];
		colorizedBracketPairs?: CharacterPair[];
		autoCloseBefore?: string;
		folding?: FoldingRules;
		__electricCharacterSupport?: {
			docComment?: IDocComment;
		};
	}

	export interface IndentationRule {
		decreaseIndentPattern: RegExp;
		increaseIndentPattern: RegExp;
		indentNextLinePattern?: RegExp | null;
		unIndentedLinePattern?: RegExp | null;
	}

	export interface FoldingMarkers {
		start: RegExp;
		end: RegExp;
	}

	export interface FoldingRules {
		offSide?: boolean;
		markers?: FoldingMarkers;
	}

	export interface OnEnterRule {
		beforeText: RegExp;
		afterText?: RegExp;
		previousLineText?: RegExp;
		action: EnterAction;
	}

	export interface IDocComment {
		open: string;
		close?: string;
	}

	export type CharacterPair = [string, string];

	export interface IAutoClosingPair {
		open: string;
		close: string;
	}

	export interface IAutoClosingPairConditional extends IAutoClosingPair {
		notIn?: string[];
	}

	export enum IndentAction {
		None = 0,
		Indent = 1,
		IndentOutdent = 2,
		Outdent = 3
	}

	export interface EnterAction {
		indentAction: IndentAction;
		appendText?: string;
		removeText?: number;
	}

	export interface SyntaxNode {
		startIndex: number;
		endIndex: number;
		startPosition: IPosition;
		endPosition: IPosition;
	}

	export interface QueryCapture {
		name: string;
		text?: string;
		node: SyntaxNode;
		encodedLanguageId: number;
	}

	export interface IState {
		clone(): IState;
		equals(other: IState): boolean;
	}

	export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

	export interface Hover {
		contents: IMarkdownString[];
		range?: IRange;
		canIncreaseVerbosity?: boolean;
		canDecreaseVerbosity?: boolean;
	}

	export interface HoverProvider<THover = Hover> {
		provideHover(model: editor.ITextModel, position: Position, token: CancellationToken, context?: HoverContext<THover>): ProviderResult<THover>;
	}

	export interface HoverContext<THover = Hover> {
		verbosityRequest?: HoverVerbosityRequest<THover>;
	}

	export interface HoverVerbosityRequest<THover = Hover> {
		verbosityDelta: number;
		previousHover: THover;
	}

	export enum HoverVerbosityAction {
		Increase = 0,
		Decrease = 1
	}

	export enum CompletionItemKind {
		Method = 0,
		Function = 1,
		Constructor = 2,
		Field = 3,
		Variable = 4,
		Class = 5,
		Struct = 6,
		Interface = 7,
		Module = 8,
		Property = 9,
		Event = 10,
		Operator = 11,
		Unit = 12,
		Value = 13,
		Constant = 14,
		Enum = 15,
		EnumMember = 16,
		Keyword = 17,
		Text = 18,
		Color = 19,
		File = 20,
		Reference = 21,
		Customcolor = 22,
		Folder = 23,
		TypeParameter = 24,
		User = 25,
		Issue = 26,
		Tool = 27,
		Snippet = 28
	}

	export interface CompletionItemLabel {
		label: string;
		detail?: string;
		description?: string;
	}

	export enum CompletionItemTag {
		Deprecated = 1
	}

	export enum CompletionItemInsertTextRule {
		None = 0,
		KeepWhitespace = 1,
		InsertAsSnippet = 4
	}

	export interface CompletionItemRanges {
		insert: IRange;
		replace: IRange;
	}

	export interface CompletionItem {
		label: string | CompletionItemLabel;
		kind: CompletionItemKind;
		tags?: ReadonlyArray<CompletionItemTag>;
		detail?: string;
		documentation?: string | IMarkdownString;
		sortText?: string;
		filterText?: string;
		preselect?: boolean;
		insertText: string;
		insertTextRules?: CompletionItemInsertTextRule;
		range: IRange | CompletionItemRanges;
		commitCharacters?: string[];
		additionalTextEdits?: editor.ISingleEditOperation[];
		command?: Command;
		action?: Command;
	}

	export interface CompletionList {
		suggestions: CompletionItem[];
		incomplete?: boolean;
		dispose?(): void;
	}

	export interface PartialAcceptInfo {
		kind: PartialAcceptTriggerKind;
		acceptedLength: number;
	}

	export enum PartialAcceptTriggerKind {
		Word = 0,
		Line = 1,
		Suggest = 2
	}

	export enum CompletionTriggerKind {
		Invoke = 0,
		TriggerCharacter = 1,
		TriggerForIncompleteCompletions = 2
	}

	export interface CompletionContext {
		triggerKind: CompletionTriggerKind;
		triggerCharacter?: string;
	}

	export interface CompletionItemProvider {
		triggerCharacters?: string[];
		provideCompletionItems(model: editor.ITextModel, position: Position, context: CompletionContext, token: CancellationToken): ProviderResult<CompletionList>;
		resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>;
	}

	export enum InlineCompletionTriggerKind {
		Automatic = 0,
		Explicit = 1
	}

	export interface IInlineCompletionChangeHint {
		readonly data?: unknown;
	}

	export interface InlineCompletionContext {
		readonly triggerKind: InlineCompletionTriggerKind;
		readonly selectedSuggestionInfo: SelectedSuggestionInfo | undefined;
		readonly includeInlineEdits: boolean;
		readonly includeInlineCompletions: boolean;
		readonly requestIssuedDateTime: number;
		readonly earliestShownDateTime: number;
		readonly changeHint?: IInlineCompletionChangeHint;
	}

	export interface IInlineCompletionModelInfo {
		models: IInlineCompletionModel[];
		currentModelId: string;
	}

	export interface IInlineCompletionModel {
		name: string;
		id: string;
	}

	export interface IInlineCompletionProviderOption {
		readonly id: string;
		readonly label: string;
		readonly values: readonly IInlineCompletionProviderOptionValue[];
		readonly currentValueId: string;
	}

	export interface IInlineCompletionProviderOptionValue {
		readonly id: string;
		readonly label: string;
	}

	export class SelectedSuggestionInfo {
		readonly range: IRange;
		readonly text: string;
		readonly completionKind: CompletionItemKind;
		readonly isSnippetText: boolean;
		constructor(range: IRange, text: string, completionKind: CompletionItemKind, isSnippetText: boolean);
		equals(other: SelectedSuggestionInfo): boolean;
	}

	export interface InlineCompletion {
		readonly insertText: string | {
			snippet: string;
		} | undefined;
		readonly range?: IRange;
		readonly additionalTextEdits?: editor.ISingleEditOperation[];
		readonly uri?: UriComponents;
		readonly command?: Command;
		readonly gutterMenuLinkAction?: Command;
		readonly shownCommand?: Command;
		readonly completeBracketPairs?: boolean;
		readonly isInlineEdit?: boolean;
		readonly showInlineEditMenu?: boolean;
		readonly showRange?: IRange;
		readonly warning?: InlineCompletionWarning;
		readonly hint?: IInlineCompletionHint;
		readonly supportsRename?: boolean;
		readonly correlationId?: string | undefined;
		readonly jumpToPosition?: IPosition;
		readonly doNotLog?: boolean;
	}

	export interface InlineCompletionWarning {
		message: IMarkdownString | string;
		icon?: IconPath;
	}

	export enum InlineCompletionHintStyle {
		Code = 1,
		Label = 2
	}

	export interface IInlineCompletionHint {
		range: IRange;
		style: InlineCompletionHintStyle;
		content: string;
	}

	export type IconPath = editor.ThemeIcon;

	export interface InlineCompletions<TItem extends InlineCompletion = InlineCompletion> {
		readonly items: readonly TItem[];
		readonly commands?: InlineCompletionCommand[];
		readonly suppressSuggestions?: boolean | undefined;
		readonly enableForwardStability?: boolean | undefined;
	}

	export type InlineCompletionCommand = {
		command: Command;
		icon?: editor.ThemeIcon;
	};

	export type InlineCompletionProviderGroupId = string;

	export interface InlineCompletionsProvider<T extends InlineCompletions = InlineCompletions> {
		provideInlineCompletions(model: editor.ITextModel, position: Position, context: InlineCompletionContext, token: CancellationToken): ProviderResult<T>;
		handleItemDidShow?(completions: T, item: T['items'][number], updatedInsertText: string, editDeltaInfo: EditDeltaInfo): void;
		handlePartialAccept?(completions: T, item: T['items'][number], acceptedCharacters: number, info: PartialAcceptInfo): void;
		handleRejection?(completions: T, item: T['items'][number]): void;
		handleEndOfLifetime?(completions: T, item: T['items'][number], reason: InlineCompletionEndOfLifeReason<T['items'][number]>, lifetimeSummary: LifetimeSummary): void;
		disposeInlineCompletions(completions: T, reason: InlineCompletionsDisposeReason): void;
		onDidChangeInlineCompletions?: IEvent<IInlineCompletionChangeHint | void>;
		groupId?: InlineCompletionProviderGroupId;
		yieldsToGroupIds?: InlineCompletionProviderGroupId[];
		excludesGroupIds?: InlineCompletionProviderGroupId[];
		displayName?: string;
		debounceDelayMs?: number;
		modelInfo?: IInlineCompletionModelInfo;
		onDidModelInfoChange?: IEvent<void>;
		setModelId?(modelId: string): Promise<void>;
		providerOptions?: readonly IInlineCompletionProviderOption[];
		onDidProviderOptionsChange?: IEvent<void>;
		setProviderOption?(optionId: string, valueId: string): Promise<void>;
		toString?(): string;
	}

	export type InlineCompletionsDisposeReason = {
		kind: 'lostRace' | 'tokenCancellation' | 'other' | 'empty' | 'notTaken';
	};

	export enum InlineCompletionEndOfLifeReasonKind {
		Accepted = 0,
		Rejected = 1,
		Ignored = 2
	}

	export type InlineCompletionEndOfLifeReason<TInlineCompletion = InlineCompletion> = {
		kind: InlineCompletionEndOfLifeReasonKind.Accepted;
		alternativeAction: boolean;
	} | {
		kind: InlineCompletionEndOfLifeReasonKind.Rejected;
	} | {
		kind: InlineCompletionEndOfLifeReasonKind.Ignored;
		supersededBy?: TInlineCompletion;
		userTypingDisagreed: boolean;
	};

	export type LifetimeSummary = {
		requestUuid: string;
		correlationId: string | undefined;
		partiallyAccepted: number;
		partiallyAcceptedCountSinceOriginal: number;
		partiallyAcceptedRatioSinceOriginal: number;
		partiallyAcceptedCharactersSinceOriginal: number;
		shown: boolean;
		shownDuration: number;
		shownDurationUncollapsed: number;
		timeUntilShown: number | undefined;
		timeUntilActuallyShown: number | undefined;
		timeUntilProviderRequest: number;
		timeUntilProviderResponse: number;
		notShownReason: string | undefined;
		editorType: string;
		viewKind: string | undefined;
		preceeded: boolean;
		languageId: string;
		requestReason: string;
		performanceMarkers?: string;
		cursorColumnDistance?: number;
		cursorLineDistance?: number;
		lineCountOriginal?: number;
		lineCountModified?: number;
		characterCountOriginal?: number;
		characterCountModified?: number;
		disjointReplacements?: number;
		sameShapeReplacements?: boolean;
		typingInterval: number;
		typingIntervalCharacterCount: number;
		selectedSuggestionInfo: boolean;
		availableProviders: string;
		skuPlan: string | undefined;
		skuType: string | undefined;
		renameCreated: boolean | undefined;
		renameDuration: number | undefined;
		renameTimedOut: boolean | undefined;
		renameDroppedOtherEdits: number | undefined;
		renameDroppedRenameEdits: number | undefined;
		editKind: string | undefined;
		longDistanceHintVisible?: boolean;
		longDistanceHintDistance?: number;
		isForAnotherDocument?: boolean;
	};

	export interface CodeAction {
		title: string;
		command?: Command;
		edit?: WorkspaceEdit;
		diagnostics?: editor.IMarkerData[];
		kind?: string;
		isPreferred?: boolean;
		isAI?: boolean;
		disabled?: string;
		ranges?: IRange[];
	}

	export enum CodeActionTriggerType {
		Invoke = 1,
		Auto = 2
	}

	export interface CodeActionList extends IDisposable {
		readonly actions: ReadonlyArray<CodeAction>;
	}

	export interface ParameterInformation {
		label: string | [number, number];
		documentation?: string | IMarkdownString;
	}

	export interface SignatureInformation {
		label: string;
		documentation?: string | IMarkdownString;
		parameters: ParameterInformation[];
		activeParameter?: number;
	}

	export interface SignatureHelp {
		signatures: SignatureInformation[];
		activeSignature: number;
		activeParameter: number;
	}

	export interface SignatureHelpResult extends IDisposable {
		value: SignatureHelp;
	}

	export enum SignatureHelpTriggerKind {
		Invoke = 1,
		TriggerCharacter = 2,
		ContentChange = 3
	}

	export interface SignatureHelpContext {
		readonly triggerKind: SignatureHelpTriggerKind;
		readonly triggerCharacter?: string;
		readonly isRetrigger: boolean;
		readonly activeSignatureHelp?: SignatureHelp;
	}

	export interface SignatureHelpProvider {
		readonly signatureHelpTriggerCharacters?: ReadonlyArray<string>;
		readonly signatureHelpRetriggerCharacters?: ReadonlyArray<string>;
		provideSignatureHelp(model: editor.ITextModel, position: Position, token: CancellationToken, context: SignatureHelpContext): ProviderResult<SignatureHelpResult>;
	}

	export enum DocumentHighlightKind {
		Text = 0,
		Read = 1,
		Write = 2
	}

	export interface DocumentHighlight {
		range: IRange;
		kind?: DocumentHighlightKind;
	}

	export interface MultiDocumentHighlight {
		uri: Uri;
		highlights: DocumentHighlight[];
	}

	export interface DocumentHighlightProvider {
		provideDocumentHighlights(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>;
	}

	export interface MultiDocumentHighlightProvider {
		readonly selector: LanguageSelector;
		provideMultiDocumentHighlights(primaryModel: editor.ITextModel, position: Position, otherModels: editor.ITextModel[], token: CancellationToken): ProviderResult<Map<Uri, DocumentHighlight[]>>;
	}

	export interface LinkedEditingRangeProvider {
		provideLinkedEditingRanges(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<LinkedEditingRanges>;
	}

	export interface LinkedEditingRanges {
		ranges: IRange[];
		wordPattern?: RegExp;
	}

	export interface ReferenceContext {
		includeDeclaration: boolean;
	}

	export interface ReferenceProvider {
		provideReferences(model: editor.ITextModel, position: Position, context: ReferenceContext, token: CancellationToken): ProviderResult<Location[]>;
	}

	export interface Location {
		uri: Uri;
		range: IRange;
	}

	export interface LocationLink {
		originSelectionRange?: IRange;
		uri: Uri;
		range: IRange;
		targetSelectionRange?: IRange;
	}

	export type Definition = Location | Location[] | LocationLink[];

	export interface DefinitionProvider {
		provideDefinition(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	export interface DeclarationProvider {
		provideDeclaration(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	export interface ImplementationProvider {
		provideImplementation(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	export interface TypeDefinitionProvider {
		provideTypeDefinition(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	export enum SymbolKind {
		File = 0,
		Module = 1,
		Namespace = 2,
		Package = 3,
		Class = 4,
		Method = 5,
		Property = 6,
		Field = 7,
		Constructor = 8,
		Enum = 9,
		Interface = 10,
		Function = 11,
		Variable = 12,
		Constant = 13,
		String = 14,
		Number = 15,
		Boolean = 16,
		Array = 17,
		Object = 18,
		Key = 19,
		Null = 20,
		EnumMember = 21,
		Struct = 22,
		Event = 23,
		Operator = 24,
		TypeParameter = 25
	}

	export enum SymbolTag {
		Deprecated = 1
	}

	export interface DocumentSymbol {
		name: string;
		detail: string;
		kind: SymbolKind;
		tags: ReadonlyArray<SymbolTag>;
		containerName?: string;
		range: IRange;
		selectionRange: IRange;
		children?: DocumentSymbol[];
	}

	export interface DocumentSymbolProvider {
		displayName?: string;
		provideDocumentSymbols(model: editor.ITextModel, token: CancellationToken): ProviderResult<DocumentSymbol[]>;
	}

	export interface TextEdit {
		range: IRange;
		text: string;
		eol?: editor.EndOfLineSequence;
	}

	export interface FormattingOptions {
		tabSize: number;
		insertSpaces: boolean;
	}

	export interface DocumentFormattingEditProvider {
		readonly displayName?: string;
		provideDocumentFormattingEdits(model: editor.ITextModel, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	export interface DocumentRangeFormattingEditProvider {
		readonly displayName?: string;
		provideDocumentRangeFormattingEdits(model: editor.ITextModel, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
		provideDocumentRangesFormattingEdits?(model: editor.ITextModel, ranges: Range[], options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	export interface OnTypeFormattingEditProvider {
		autoFormatTriggerCharacters: string[];
		provideOnTypeFormattingEdits(model: editor.ITextModel, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	export interface ILink {
		range: IRange;
		url?: Uri | string;
		tooltip?: string;
	}

	export interface ILinksList {
		links: ILink[];
		dispose?(): void;
	}

	export interface LinkProvider {
		provideLinks(model: editor.ITextModel, token: CancellationToken): ProviderResult<ILinksList>;
		resolveLink?: (link: ILink, token: CancellationToken) => ProviderResult<ILink>;
	}

	export interface IColor {
		readonly red: number;
		readonly green: number;
		readonly blue: number;
		readonly alpha: number;
	}

	export interface IColorPresentation {
		label: string;
		textEdit?: TextEdit;
		additionalTextEdits?: TextEdit[];
	}

	export interface IColorInformation {
		range: IRange;
		color: IColor;
	}

	export interface DocumentColorProvider {
		provideDocumentColors(model: editor.ITextModel, token: CancellationToken): ProviderResult<IColorInformation[]>;
		provideColorPresentations(model: editor.ITextModel, colorInfo: IColorInformation, token: CancellationToken): ProviderResult<IColorPresentation[]>;
	}

	export interface SelectionRange {
		range: IRange;
	}

	export interface SelectionRangeProvider {
		provideSelectionRanges(model: editor.ITextModel, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[][]>;
	}

	export interface FoldingContext {
	}

	export interface FoldingRangeProvider {
		onDidChange?: IEvent<this>;
		provideFoldingRanges(model: editor.ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]>;
	}

	export interface FoldingRange {
		start: number;
		end: number;
		kind?: FoldingRangeKind;
	}

	export class FoldingRangeKind {
		value: string;
		static readonly Comment: FoldingRangeKind;
		static readonly Imports: FoldingRangeKind;
		static readonly Region: FoldingRangeKind;
		static fromValue(value: string): FoldingRangeKind;
		constructor(value: string);
	}

	export interface WorkspaceEditMetadata {
		needsConfirmation: boolean;
		label: string;
		description?: string;
	}

	export interface WorkspaceFileEditOptions {
		overwrite?: boolean;
		ignoreIfNotExists?: boolean;
		ignoreIfExists?: boolean;
		recursive?: boolean;
		copy?: boolean;
		folder?: boolean;
		skipTrashBin?: boolean;
		maxSize?: number;
	}

	export interface IWorkspaceFileEdit {
		oldResource?: Uri;
		newResource?: Uri;
		options?: WorkspaceFileEditOptions;
		metadata?: WorkspaceEditMetadata;
	}

	export interface IWorkspaceTextEdit {
		resource: Uri;
		textEdit: TextEdit & {
			insertAsSnippet?: boolean;
			keepWhitespace?: boolean;
		};
		versionId: number | undefined;
		metadata?: WorkspaceEditMetadata;
	}

	export interface WorkspaceEdit {
		edits: Array<IWorkspaceTextEdit | IWorkspaceFileEdit | ICustomEdit>;
	}

	export interface ICustomEdit {
		readonly resource: Uri;
		readonly metadata?: WorkspaceEditMetadata;
		undo(): Promise<void> | void;
		redo(): Promise<void> | void;
	}

	export interface Rejection {
		rejectReason?: string;
	}

	export interface RenameLocation {
		range: IRange;
		text: string;
	}

	export interface RenameProvider {
		provideRenameEdits(model: editor.ITextModel, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit & Rejection>;
		resolveRenameLocation?(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<RenameLocation & Rejection>;
	}

	export enum NewSymbolNameTag {
		AIGenerated = 1
	}

	export enum NewSymbolNameTriggerKind {
		Invoke = 0,
		Automatic = 1
	}

	export interface NewSymbolName {
		readonly newSymbolName: string;
		readonly tags?: readonly NewSymbolNameTag[];
	}

	export interface NewSymbolNamesProvider {
		supportsAutomaticNewSymbolNamesTriggerKind?: Promise<boolean | undefined>;
		provideNewSymbolNames(model: editor.ITextModel, range: IRange, triggerKind: NewSymbolNameTriggerKind, token: CancellationToken): ProviderResult<NewSymbolName[]>;
	}

	export interface Command {
		id: string;
		title: string;
		tooltip?: string;
		arguments?: unknown[];
	}

	export interface CommentThreadRevealOptions {
		preserveFocus: boolean;
		focusReply: boolean;
	}

	export interface CommentAuthorInformation {
		name: string;
		iconPath?: UriComponents;
	}

	export interface PendingCommentThread {
		range: IRange | undefined;
		uri: Uri;
		uniqueOwner: string;
		isReply: boolean;
		comment: PendingComment;
	}

	export interface PendingComment {
		body: string;
		cursor: IPosition;
	}

	export interface CodeLens {
		range: IRange;
		id?: string;
		command?: Command;
	}

	export interface CodeLensList {
		readonly lenses: readonly CodeLens[];
		dispose?(): void;
	}

	export interface CodeLensProvider {
		onDidChange?: IEvent<this>;
		provideCodeLenses(model: editor.ITextModel, token: CancellationToken): ProviderResult<CodeLensList>;
		resolveCodeLens?(model: editor.ITextModel, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>;
	}

	export enum InlayHintKind {
		Type = 1,
		Parameter = 2
	}

	export interface InlayHintLabelPart {
		label: string;
		tooltip?: string | IMarkdownString;
		command?: Command;
		location?: Location;
	}

	export interface InlayHint {
		label: string | InlayHintLabelPart[];
		tooltip?: string | IMarkdownString;
		textEdits?: TextEdit[];
		position: IPosition;
		kind?: InlayHintKind;
		paddingLeft?: boolean;
		paddingRight?: boolean;
	}

	export interface InlayHintList {
		hints: InlayHint[];
		dispose(): void;
	}

	export interface InlayHintsProvider {
		displayName?: string;
		onDidChangeInlayHints?: IEvent<void>;
		provideInlayHints(model: editor.ITextModel, range: Range, token: CancellationToken): ProviderResult<InlayHintList>;
		resolveInlayHint?(hint: InlayHint, token: CancellationToken): ProviderResult<InlayHint>;
	}

	export interface SemanticTokensLegend {
		readonly tokenTypes: string[];
		readonly tokenModifiers: string[];
	}

	export interface SemanticTokens {
		readonly resultId?: string;
		readonly data: Uint32Array;
	}

	export interface SemanticTokensEdit {
		readonly start: number;
		readonly deleteCount: number;
		readonly data?: Uint32Array;
	}

	export interface SemanticTokensEdits {
		readonly resultId?: string;
		readonly edits: SemanticTokensEdit[];
	}

	export interface DocumentSemanticTokensProvider {
		readonly onDidChange?: IEvent<void>;
		getLegend(): SemanticTokensLegend;
		provideDocumentSemanticTokens(model: editor.ITextModel, lastResultId: string | null, token: CancellationToken): ProviderResult<SemanticTokens | SemanticTokensEdits>;
		releaseDocumentSemanticTokens(resultId: string | undefined): void;
	}

	export interface DocumentRangeSemanticTokensProvider {
		readonly onDidChange?: IEvent<void>;
		getLegend(): SemanticTokensLegend;
		provideDocumentRangeSemanticTokens(model: editor.ITextModel, range: Range, token: CancellationToken): ProviderResult<SemanticTokens>;
	}

	export interface ILanguageExtensionPoint {
		id: string;
		extensions?: string[];
		filenames?: string[];
		filenamePatterns?: string[];
		firstLine?: string;
		aliases?: string[];
		mimetypes?: string[];
		configuration?: Uri;
	}
	export interface IMonarchLanguage {
		tokenizer: {
			[name: string]: IMonarchLanguageRule[];
		};
		ignoreCase?: boolean;
		unicode?: boolean;
		defaultToken?: string;
		brackets?: IMonarchLanguageBracket[];
		start?: string;
		tokenPostfix?: string;
		includeLF?: boolean;
		[key: string]: any;
	}

	export type IShortMonarchLanguageRule1 = [string | RegExp, IMonarchLanguageAction];

	export type IShortMonarchLanguageRule2 = [string | RegExp, IMonarchLanguageAction, string];

	export interface IExpandedMonarchLanguageRule {
		regex?: string | RegExp;
		action?: IMonarchLanguageAction;
		include?: string;
	}

	export type IMonarchLanguageRule = IShortMonarchLanguageRule1 | IShortMonarchLanguageRule2 | IExpandedMonarchLanguageRule;

	export type IShortMonarchLanguageAction = string;

	export interface IExpandedMonarchLanguageAction {
		group?: IMonarchLanguageAction[];
		cases?: Object;
		token?: string;
		next?: string;
		switchTo?: string;
		goBack?: number;
		bracket?: string;
		nextEmbedded?: string;
		log?: string;
	}

	export type IMonarchLanguageAction = IShortMonarchLanguageAction | IExpandedMonarchLanguageAction | (IShortMonarchLanguageAction | IExpandedMonarchLanguageAction)[];

	export interface IMonarchLanguageBracket {
		open: string;
		close: string;
		token: string;
	}

}

declare namespace monaco.worker {


	export interface IMirrorTextModel {
		readonly version: number;
	}

	export interface IMirrorModel extends IMirrorTextModel {
		readonly uri: Uri;
		readonly version: number;
		getValue(): string;
	}

	export interface IWorkerContext<H = {}> {
		host: H;
		getMirrorModels(): IMirrorModel[];
	}

}

//dtsv=3
