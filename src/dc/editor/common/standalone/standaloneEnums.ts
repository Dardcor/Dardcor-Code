/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// THIS IS A GENERATED FILE. DO NOT EDIT DIRECTLY.


export enum AccessibilitySupport {
	Unknown = 0,
	Disabled = 1,
	Enabled = 2
}

export enum CodeActionTriggerType {
	Invoke = 1,
	Auto = 2
}

export enum CompletionItemInsertTextRule {
	None = 0,
	KeepWhitespace = 1,
	InsertAsSnippet = 4
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

export enum CompletionItemTag {
	Deprecated = 1
}

export enum CompletionTriggerKind {
	Invoke = 0,
	TriggerCharacter = 1,
	TriggerForIncompleteCompletions = 2
}

export enum ContentWidgetPositionPreference {
	EXACT = 0,
	ABOVE = 1,
	BELOW = 2
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

export enum DefaultEndOfLine {
	LF = 1,
	CRLF = 2
}

export enum DocumentHighlightKind {
	Text = 0,
	Read = 1,
	Write = 2
}

export enum EditorAutoIndentStrategy {
	None = 0,
	Keep = 1,
	Brackets = 2,
	Advanced = 3,
	Full = 4
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

export enum EndOfLinePreference {
	TextDefined = 0,
	LF = 1,
	CRLF = 2
}

export enum EndOfLineSequence {
	LF = 0,
	CRLF = 1
}

export enum GlyphMarginLane {
	Left = 1,
	Center = 2,
	Right = 3
}

export enum HoverVerbosityAction {
	Increase = 0,
	Decrease = 1
}

export enum IndentAction {
	None = 0,
	Indent = 1,
	IndentOutdent = 2,
	Outdent = 3
}

export enum InjectedTextCursorStops {
	Both = 0,
	Right = 1,
	Left = 2,
	None = 3
}

export enum InlayHintKind {
	Type = 1,
	Parameter = 2
}

export enum InlineCompletionEndOfLifeReasonKind {
	Accepted = 0,
	Rejected = 1,
	Ignored = 2
}

export enum InlineCompletionHintStyle {
	Code = 1,
	Label = 2
}

export enum InlineCompletionTriggerKind {
	Automatic = 0,
	Explicit = 1
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

export enum MarkerSeverity {
	Hint = 1,
	Info = 2,
	Warning = 4,
	Error = 8
}

export enum MarkerTag {
	Unnecessary = 1,
	Deprecated = 2
}

export enum MinimapPosition {
	Inline = 1,
	Gutter = 2
}

export enum MinimapSectionHeaderStyle {
	Normal = 1,
	Underlined = 2
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

export enum NewSymbolNameTag {
	AIGenerated = 1
}

export enum NewSymbolNameTriggerKind {
	Invoke = 0,
	Automatic = 1
}

export enum OverlayWidgetPositionPreference {
	TOP_RIGHT_CORNER = 0,
	BOTTOM_RIGHT_CORNER = 1,
	TOP_CENTER = 2
}

export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7
}

export enum PartialAcceptTriggerKind {
	Word = 0,
	Line = 1,
	Suggest = 2
}

export enum PositionAffinity {
	Left = 0,
	Right = 1,
	None = 2,
	LeftOfInjectedText = 3,
	RightOfInjectedText = 4
}

export enum RenderLineNumbersType {
	Off = 0,
	On = 1,
	Relative = 2,
	Interval = 3,
	Custom = 4
}

export enum RenderMinimap {
	None = 0,
	Text = 1,
	Blocks = 2
}

export enum ScrollType {
	Smooth = 0,
	Immediate = 1
}

export enum ScrollbarVisibility {
	Auto = 1,
	Hidden = 2,
	Visible = 3
}

export enum SelectionDirection {
	LTR = 0,
	RTL = 1
}

export enum ShowLightbulbIconMode {
	Off = 'off',
	OnCode = 'onCode',
	On = 'on'
}

export enum SignatureHelpTriggerKind {
	Invoke = 1,
	TriggerCharacter = 2,
	ContentChange = 3
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

export enum TextDirection {
	LTR = 0,
	RTL = 1
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

export enum TrackedRangeStickiness {
	AlwaysGrowsWhenTypingAtEdges = 0,
	NeverGrowsWhenTypingAtEdges = 1,
	GrowsOnlyWhenTypingBefore = 2,
	GrowsOnlyWhenTypingAfter = 3
}

export enum WrappingIndent {
	None = 0,
	Same = 1,
	Indent = 2,
	DeepIndent = 3
}