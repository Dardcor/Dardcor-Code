export interface EditorOptions {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  tabSize?: number;
  insertSpaces?: boolean;
  autoIndent?: string;
  detectIndentation?: boolean;
  trimAutoWhitespace?: boolean;
  wordWrap?: string;
  wordWrapColumn?: number;
  wrappingIndent?: string;
  wrappingStrategy?: string;
  wordBreak?: string;
  autoClosingBrackets?: string;
  autoClosingQuotes?: string;
  autoClosingDelete?: string;
  autoClosingOvertype?: string;
  autoSurround?: string;
  formatOnType?: boolean;
  formatOnPaste?: boolean;
  bracketPairColorization?: any;
  guides?: any;
  selectOnLineNumbers?: boolean;
  glyphMargin?: boolean;
  lineDecorationsWidth?: number;
  lineNumbersMinChars?: number;
  lineNumbers?: any;
  cursorBlinking?: string;
  cursorSmoothCaretAnimation?: string;
  cursorStyle?: string;
  cursorSurroundingLines?: number;
  cursorSurroundingLinesStyle?: string;
  cursorWidth?: number;
  cursorSticky?: boolean;
  stickyScroll?: any;
  dragAndDrop?: boolean;
  emptySelectionClipboard?: boolean;
  copyWithSyntaxHighlighting?: boolean;
  multiCursorModifier?: string;
  multiCursorPaste?: string;
  multiCursorLimit?: number;
  accessibilitySupport?: string;
  accessibilityPageSize?: number;
}
export enum EditorAutoClosingStrategy { Always, LanguageDefined, BeforeWhitespace, Never }
export enum EditorAutoIndentStrategy { None, Keep, Brackets, Advanced, Full }
export enum EditorAutoSurroundStrategy { LanguageDefined, Quotes, Brackets, Never }
export enum EditorCursorBlinkingStyle { Hidden, Blink, Smooth, Phase, Expand }
export enum EditorCursorStyle { Line, Block, Underline, LineThin, BlockOutline, UnderlineThin }
export enum EditorLineNumbers { On, Off, Relative, Interval }
export enum EditorMultiCursorModifier { CtrlCmd, Alt }
export enum EditorScrollbarVisibility { Auto, Hidden, Visible }
export enum EditorWordWrap { Off, On, WordWrapColumn, Bounded }
export enum RenderLineNumbersType { Off, On, Relative, Interval }
export enum WrappingIndent { None, Same, Indent, DeepIndent }
export enum WrappingStrategy { Simple, Advanced }
