export const lspSymbolKinds: readonly number[] = [
	1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26
];

export const lspCompletionItemKinds: readonly number[] = [
	1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
];

export function buildClientCapabilities(): Record<string, unknown> {
	return {
		workspace: {
			workspaceFolders: true,
			configuration: true,
			applyEdit: true,
			didChangeConfiguration: { dynamicRegistration: true },
			didChangeWatchedFiles: { dynamicRegistration: true },
			symbol: {
				dynamicRegistration: true,
				symbolKind: { valueSet: lspSymbolKinds },
				tagSupport: { valueSet: [1] }
			},
			executeCommand: { dynamicRegistration: true },
			workspaceEdit: {
				documentChanges: true,
				resourceOperations: ['create', 'rename', 'delete'],
				failureHandling: 'textOnlyTransactional',
				normalizesLineEndings: true,
				changeAnnotationSupport: { groupsOnLabel: true }
			},
			inlayHint: { refreshSupport: true },
			semanticTokens: { refreshSupport: true },
			diagnostics: { refreshSupport: true }
		},
		textDocument: {
			synchronization: { dynamicRegistration: true, willSave: true, willSaveWaitUntil: true, didSave: true },
			completion: {
				dynamicRegistration: true,
				completionItem: {
					snippetSupport: true,
					commitCharactersSupport: true,
					documentationFormat: ['markdown', 'plaintext'],
					deprecatedSupport: true,
					preselectSupport: true,
					tagSupport: { valueSet: [1, 2] },
					insertReplaceSupport: true,
					insertTextModeSupport: { valueSet: [1, 2] },
					labelDetailsSupport: true
				},
				completionItemKind: { valueSet: lspCompletionItemKinds },
				contextSupport: true
			},
			hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
			signatureHelp: {
				dynamicRegistration: true,
				signatureInformation: {
					documentationFormat: ['markdown', 'plaintext'],
					parameterInformation: { labelOffsetSupport: true },
					activeParameterSupport: true
				},
				contextSupport: true
			},
			declaration: { dynamicRegistration: true, linkSupport: true },
			definition: { dynamicRegistration: true, linkSupport: true },
			typeDefinition: { dynamicRegistration: true, linkSupport: true },
			implementation: { dynamicRegistration: true, linkSupport: true },
			references: { dynamicRegistration: true },
			documentHighlight: { dynamicRegistration: true },
			documentSymbol: {
				dynamicRegistration: true,
				symbolKind: { valueSet: lspSymbolKinds },
				hierarchicalDocumentSymbolSupport: true,
				tagSupport: { valueSet: [1] },
				labelSupport: true
			},
			codeAction: {
				dynamicRegistration: true,
				codeActionLiteralSupport: {
					codeActionKind: {
						valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports']
					}
				},
				isPreferredSupport: true,
				disabledSupport: true,
				dataSupport: true,
				resolveSupport: { properties: ['edit'] },
				honorsChangeAnnotations: false
			},
			codeLens: { dynamicRegistration: true },
			documentLink: { dynamicRegistration: true, tooltipSupport: true },
			colorProvider: { dynamicRegistration: true },
			rename: {
				dynamicRegistration: true,
				prepareSupport: true,
				prepareSupportDefaultBehavior: 1,
				honorsChangeAnnotations: false
			},
			publishDiagnostics: {
				relatedInformation: true,
				versionSupport: true,
				tagSupport: { valueSet: [1, 2] },
				codeDescriptionSupport: true,
				dataSupport: true,
				codeActionSupport: true
			},
			foldingRange: {
				dynamicRegistration: true,
				rangeLimit: 5000,
				lineFoldingOnly: true,
				foldingRangeKind: { valueSet: ['comment', 'imports', 'region'] },
				foldingRangeCollapsedText: true
			},
			selectionRange: { dynamicRegistration: true },
			documentOnTypeFormatting: { dynamicRegistration: true },
			formatting: { dynamicRegistration: true },
			rangeFormatting: { dynamicRegistration: true },
			semanticTokens: {
				dynamicRegistration: true,
				tokenTypes: [
					'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
					'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method',
					'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator',
					'decorator'
				],
				tokenModifiers: [
					'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
					'async', 'modification', 'documentation', 'defaultLibrary'
				],
				formats: ['relative'],
				overlappingTokenSupport: false,
				multilineTokenSupport: false,
				serverCancelSupport: false,
				augmentsSyntaxTokens: true
			},
			inlayHint: {
				dynamicRegistration: true,
				resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'] }
			},
			inlineValue: { dynamicRegistration: true },
			callHierarchy: { dynamicRegistration: true },
			typeHierarchy: { dynamicRegistration: true },
			linkedEditingRange: { dynamicRegistration: true }
		},
		window: {
			workDoneProgress: true,
			showDocument: { support: true },
			showMessage: { messageActionItem: { additionalPropertiesSupport: true } }
		},
		general: {
			positionEncodings: ['utf-16'],
			staleRequestSupport: { cancel: true, retryOnContentModified: [] },
			markdown: { parser: 'marked', version: '1.2.0' }
		}
	};
}
