/* eslint-disable @typescript-eslint/ban-types */
declare namespace Fig {
	type TemplateStrings = "filepaths" | "folders" | "history" | "help";

	type Template = TemplateStrings | TemplateStrings[];

	type HistoryContext = {
		currentWorkingDirectory: string;
		time: number;
		exitCode: number;
		shell: string;
	};

	type TemplateSuggestionContext =
		| { templateType: "filepaths" }
		| { templateType: "folders" }
		| { templateType: "help" }
		| ({ templateType: "history" } & Partial<HistoryContext>);

	type TemplateSuggestion = Modify<
		Suggestion,
		{ name?: string; context: TemplateSuggestionContext }
	>;

	type SpecLocation =
		| { type: "local"; path?: string; name: string }
		| { type: "global"; name: string };

	type LoadSpec =
		| string
		| Subcommand
		| ((
			token: string,
			executeCommand: ExecuteCommandFunction
		) => Promise<SpecLocation | SpecLocation[] | Subcommand>);

	type SuggestionType =
		| "folder"
		| "file"
		| "arg"
		| "subcommand"
		| "option"
		| "special"
		| "mixin"
		| "shortcut";

	type SingleOrArray<T> = T | T[];

	type GetVersionCommand = (executeCommand: ExecuteCommandFunction) => Promise<string>;

	type ShellContext = {
		currentWorkingDirectory: string;
		environmentVariables: Record<string, string>;
		currentProcess: string;
		sshPrefix: string;
	};

	type GeneratorContext = ShellContext & {
		isDangerous?: boolean;
		searchTerm: string;
	};

	type Function<T = void, R = void> = (param: T) => R;

	type Modify<T, R> = Omit<T, keyof R> & R;

	type StringOrFunction<T = void, R = void> = string | Function<T, R>;

	type ArgDiff = Modify<Fig.Arg, { remove?: true }>;

	type OptionDiff = Modify<
		Fig.Option,
		{
			args?: ArgDiff | ArgDiff[];
			remove?: true;
		}
	>;

	type SubcommandDiff = Modify<
		Fig.Subcommand,
		{
			subcommands?: SubcommandDiff[];
			options?: OptionDiff[];
			args?: ArgDiff | ArgDiff[];
			remove?: true;
		}
	>;

	type SpecDiff = Omit<SubcommandDiff, "name" | "remove">;

	type VersionDiffMap = Record<string, SpecDiff>;

	type Spec =
		| Subcommand
		| ((version?: string) => Subcommand)
		| ((version?: string) => {
			versionedSpecPath: string;
			version?: string;
		});

	type ExecuteCommandInput = {
		command: string;
		args: string[];
		cwd?: string;
		env?: Record<string, string | undefined>;
		timeout?: number;
	};

	type ExecuteCommandOutput = {
		stdout: string;
		stderr: string;
		status: number;
	};

	type ExecuteCommandFunction = (args: ExecuteCommandInput) => Promise<ExecuteCommandOutput>;

	type CacheMaxAge = {
		strategy: "max-age";
		ttl: number;
	};

	type CacheStaleWhileRevalidate = {
		strategy?: "stale-while-revalidate";
		ttl?: number;
	};

	type Cache = (CacheMaxAge | CacheStaleWhileRevalidate) & {
		cacheByDirectory?: boolean;

		cacheKey?: string;
	};

	type TriggerOnChange = {
		on: "change";
	};

	type TriggerOnThreshold = {
		on: "threshold";
		length: number;
	};

	type TriggerOnMatch = {
		on: "match";
		string: string | string[];
	};

	type Trigger =
		| string
		| ((newToken: string, oldToken: string) => boolean)
		| TriggerOnChange
		| TriggerOnThreshold
		| TriggerOnMatch;

	interface BaseSuggestion {
		displayName?: string;
		insertValue?: string;
		replaceValue?: string;
		description?: string;
		icon?: string;
		isDangerous?: boolean;
		priority?: number;
		hidden?: boolean;
		deprecated?: boolean | Omit<BaseSuggestion, "deprecated">;

		previewComponent?: string;

		_internal?: Record<string, unknown>;
	}

	interface Suggestion extends BaseSuggestion {
		name?: SingleOrArray<string>;
		type?: SuggestionType;
	}

	interface Subcommand extends BaseSuggestion {
		name: SingleOrArray<string>;

		subcommands?: Subcommand[];

		requiresSubcommand?: boolean;

		options?: Option[];

		args?: SingleOrArray<Arg>;
		filterStrategy?: "fuzzy" | "prefix" | "default";
		additionalSuggestions?: (string | Suggestion)[];
		loadSpec?: LoadSpec;
		generateSpec?: (tokens: string[], executeCommand: ExecuteCommandFunction) => Promise<Spec | undefined>;

		generateSpecCacheKey?: Function<{ tokens: string[] }, string | undefined> | string;

		parserDirectives?: {
			flagsArePosixNoncompliant?: boolean;
			optionsMustPrecedeArguments?: boolean;
			optionArgSeparators?: SingleOrArray<string>;
		};

		cache?: boolean;
	}

	interface Option extends BaseSuggestion {
		name: SingleOrArray<string>;

		args?: SingleOrArray<Arg>;
		isPersistent?: boolean;
		isRequired?: boolean;
		requiresEquals?: boolean;
		requiresSeparator?: boolean | string;
		isRepeatable?: boolean | number;
		exclusiveOn?: string[];
		dependsOn?: string[];
	}

	interface Arg {
		name?: string;

		description?: string;

		isDangerous?: boolean;

		suggestions?: (string | Suggestion)[];
		template?: Template;
		generators?: SingleOrArray<Generator>;
		filterStrategy?: "fuzzy" | "prefix" | "default";
		suggestCurrentToken?: boolean;
		isVariadic?: boolean;

		optionsCanBreakVariadicArg?: boolean;

		isOptional?: boolean;
		isCommand?: boolean;
		isScript?: boolean;
		isModule?: string;

		debounce?: boolean;
		default?: string;
		loadSpec?: LoadSpec;

		parserDirectives?: {
			alias?: string | ((token: string, exec: ExecuteCommandFunction) => Promise<string>);
		};
	}

	interface Generator {
		template?: Template;
		filterTemplateSuggestions?: Function<TemplateSuggestion[], Suggestion[]>;
		script?:
		| string[]
		| Function<string[], string[] | undefined>
		| ExecuteCommandInput
		| Function<string[], ExecuteCommandInput>;
		scriptTimeout?: number;
		postProcess?: (out: string, tokens: string[]) => (Suggestion | null)[] | undefined;
		splitOn?: string;
		trigger?: Trigger;
		getQueryTerm?: StringOrFunction<string, string>;
		custom?: (
			tokens: string[],
			executeCommand: ExecuteCommandFunction,
			generatorContext: GeneratorContext
		) => Promise<(Suggestion | null)[] | undefined>;
		cache?: Cache;
	}
}
