/**
 * Dardcor Code - CodeAction Kind Definitions
 */

export class CodeActionKind {
	public static readonly Empty: CodeActionKind = new CodeActionKind("");

	public static readonly QuickFix: CodeActionKind = new CodeActionKind("quickfix");

	public static readonly Refactor: CodeActionKind = new CodeActionKind("refactor");
	public static readonly RefactorExtract: CodeActionKind = new CodeActionKind("refactor.extract");
	public static readonly RefactorInline: CodeActionKind = new CodeActionKind("refactor.inline");
	public static readonly RefactorMove: CodeActionKind = new CodeActionKind("refactor.move");
	public static readonly RefactorRewrite: CodeActionKind = new CodeActionKind("refactor.rewrite");

	public static readonly Source: CodeActionKind = new CodeActionKind("source");
	public static readonly SourceOrganizeImports: CodeActionKind = new CodeActionKind("source.organizeImports");
	public static readonly SourceFixAll: CodeActionKind = new CodeActionKind("source.fixAll");

	private static readonly _cachedKinds = new Map<string, CodeActionKind>();

	public static fromValue(value: string): CodeActionKind {
		const cached = CodeActionKind._cachedKinds.get(value);
		if (cached) {
			return cached;
		}
		const kind = new CodeActionKind(value);
		CodeActionKind._cachedKinds.set(value, kind);
		return kind;
	}

	constructor(public readonly value: string) {}

	public append(part: string): CodeActionKind {
		return new CodeActionKind(this.value ? `${this.value}.${part}` : part);
	}

	public contains(other: CodeActionKind): boolean {
		return this.value === other.value || other.value.startsWith(`${this.value}.`);
	}

	public intersects(other: CodeActionKind): boolean {
		return this.contains(other) || other.contains(this);
	}

	public removeSubKind(): CodeActionKind {
		const index = this.value.lastIndexOf(".");
		if (index === -1) {
			return CodeActionKind.Empty;
		}
		return CodeActionKind.fromValue(this.value.substring(0, index));
	}

	public equals(other: CodeActionKind): boolean {
		return this.value === other.value;
	}

	public isQuickFix(): boolean {
		return CodeActionKind.QuickFix.contains(this);
	}

	public isRefactor(): boolean {
		return CodeActionKind.Refactor.contains(this);
	}

	public isSource(): boolean {
		return CodeActionKind.Source.contains(this);
	}

	public toString(): string {
		return this.value;
	}
}

export const CodeActionTriggerSource = {
	QuickFix: "quickfix",
	Refactor: "refactor",
	SourceAction: "sourceAction",
	OrganizeImports: "source.organizeImports",
	FixAll: "source.fixAll"
} as const;
