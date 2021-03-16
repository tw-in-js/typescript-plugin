// Original code forked from https://github.com/microsoft/typescript-styled-plugin/blob/master/src/_language-service.ts
// License MIT

import type {
  Logger,
  TemplateContext,
  TemplateLanguageService,
} from 'typescript-template-language-service-decorator'
import type * as ts from 'typescript/lib/tsserverlibrary'
import * as vscode from 'vscode-languageserver-types'

import type { ConfigurationManager } from './configuration'

import { defaultBaseSortFn, matchSorter } from 'match-sorter'

import { CompletionToken, Twind } from './twind'
import { parse, Rule } from './parser'

function arePositionsEqual(left: ts.LineAndCharacter, right: ts.LineAndCharacter): boolean {
  return left.line === right.line && left.character === right.character
}

// !function isAfter(left: vscode.Position, right: vscode.Position): boolean {
//   return right.line > left.line || (right.line === left.line && right.character >= left.character)
// }

// !function overlaps(a: vscode.Range, b: vscode.Range): boolean {
//   return !isAfter(a.end, b.start) && !isAfter(b.end, a.start)
// }

// !const emptyCompletionList: vscode.CompletionList = {
//   items: [],
//   isIncomplete: false,
// }

const enum ErrorCodes {
  UNKNOWN_DIRECTIVE = -2020,
  UNKNOWN_VARIANT = -2021,
  UNKNOWN_THEME_VALUE = -2022,
}

const pad = (n: string): string => n.padStart(8, '0')

const naturalExpand = (value: number | string): string => ('' + value).replace(/\d+/g, pad)

// By default, match-sorter assumes spaces to be the word separator.
// Lets split the text into whitespace spearated words
const prepareText = (value: string): string =>
  value
    .replace(/[A-Z]/g, ' $&')
    .replace(/(?<!^)[_-]/g, ' ')
    .replace(/(?<!^|\d)\d/g, ' $&')
    .replace(/\d(?!$|\d)/g, '$& ')

class CompletionsCache {
  private _cachedCompletionsFile?: string
  private _cachedCompletionsPosition?: ts.LineAndCharacter
  private _cachedCompletionsContent?: string
  private _completions?: vscode.CompletionList

  public getCached(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): vscode.CompletionList | undefined {
    if (
      this._completions &&
      context.fileName === this._cachedCompletionsFile &&
      this._cachedCompletionsPosition &&
      arePositionsEqual(position, this._cachedCompletionsPosition) &&
      context.text === this._cachedCompletionsContent
    ) {
      return this._completions
    }
  }

  public updateCached(
    context: TemplateContext,
    position: ts.LineAndCharacter,
    completions: vscode.CompletionList,
  ): void {
    this._cachedCompletionsFile = context.fileName
    this._cachedCompletionsPosition = position
    this._cachedCompletionsContent = context.text
    this._completions = completions
  }
}

export class TwindTemplateLanguageService implements TemplateLanguageService {
  private readonly typescript: typeof ts
  private readonly info: ts.server.PluginCreateInfo
  private readonly configurationManager: ConfigurationManager
  private readonly logger: Logger
  private readonly _completionsCache = new CompletionsCache()
  private readonly _twind: Twind

  constructor(
    typescript: typeof ts,
    info: ts.server.PluginCreateInfo,
    configurationManager: ConfigurationManager,
    logger: Logger,
  ) {
    this.typescript = typescript
    this.info = info
    this.configurationManager = configurationManager
    this.logger = logger
    this._twind = new Twind(typescript, info, configurationManager, logger)
  }

  public getCompletionsAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.WithMetadata<ts.CompletionInfo> {
    const items = this.getCompletionItems(context, position)

    return translateCompletionItemsToCompletionInfo(context, items)
  }

  public getCompletionEntryDetails(
    context: TemplateContext,
    position: ts.LineAndCharacter,
    name: string,
  ): ts.CompletionEntryDetails {
    const item = this.getCompletionItems(context, position).items.find((x) => x.label === name)

    if (item) {
      return translateCompletionItemsToCompletionEntryDetails(this.typescript, item)
    }

    return {
      name,
      kind: this.typescript.ScriptElementKind.unknown,
      kindModifiers: '',
      tags: [],
      displayParts: toDisplayParts(name),
      documentation: [],
    }
  }

  public getQuickInfoAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.QuickInfo | undefined {
    const rules = parse(context.text, context.toOffset(position))

    const rule = rules.map((rule) => rule.value).join(' ')

    if (!rule) {
      return undefined
    }

    const css = this._twind.css(rule)

    const span = rules
      .flatMap((rule) => rule.spans)
      .reduce((a, b) => ({
        start: Math.min(a.start, b.start),
        end: Math.max(a.end, b.end),
      }))

    return {
      kind: translateCompletionItemKind(this.typescript, vscode.CompletionItemKind.Property),
      kindModifiers: '',
      textSpan: {
        start: span.start,
        length: span.end - span.start,
      },
      displayParts: toDisplayParts(rule),
      documentation: css
        ? toDisplayParts({
            kind: 'markdown',
            value: '```css\n' + css + '\n```',
          })
        : undefined,
      tags: [],
    }
  }

  public getSemanticDiagnostics(context: TemplateContext): ts.Diagnostic[] {
    return parse(context.text).flatMap((rule): ts.Diagnostic[] =>
      (this._twind.getDiagnostics(rule.value) || [])
        .map((info): ts.Diagnostic | undefined => {
          switch (info.id) {
            case 'UNKNOWN_DIRECTIVE': {
              return {
                messageText: `Unknown utility "${rule.name}"`,
                start: rule.loc.start,
                length: rule.loc.end - rule.loc.start,
                file: context.node.getSourceFile(),
                category: this.typescript.DiagnosticCategory.Warning,
                code: ErrorCodes.UNKNOWN_DIRECTIVE,
              }
            }
            case 'UNKNOWN_THEME_VALUE': {
              if (info.key) {
                const [section, ...key] = info.key?.split('.')

                return {
                  messageText: `Unknown theme value "${section}[${key.join('.')}]"`,
                  start: rule.loc.start,
                  length: rule.loc.end - rule.loc.start,
                  file: context.node.getSourceFile(),
                  category: this.typescript.DiagnosticCategory.Warning,
                  code: ErrorCodes.UNKNOWN_THEME_VALUE,
                }
              }
            }
          }
        })
        // check if every rule.variants exist
        .concat(
          rule.variants
            .filter((variant) => !this._twind.completions.variants.has(variant.raw))
            .map(
              (variant): ts.Diagnostic => ({
                messageText: `Unknown variant "${variant.raw}"`,
                start: variant.loc.start,
                length: variant.loc.end - variant.loc.start,
                file: context.node.getSourceFile(),
                category: this.typescript.DiagnosticCategory.Warning,
                code: ErrorCodes.UNKNOWN_VARIANT,
              }),
            ),
        )
        .filter((value): value is ts.Diagnostic => Boolean(value)),
    )
  }

  // public getSupportedCodeFixes(): number[] {
  //   return [ErrorCodes.UNKNOWN_DIRECTIVE, ErrorCodes.UNKNOWN_THEME_VALUE]
  // }

  // public getCodeFixesAtPosition(
  //   context: TemplateContext,
  //   start: number,
  //   end: number,
  //   _errorCodes: number[],
  //   _format: ts.FormatCodeSettings,
  // ): ts.CodeAction[] {
  //   const doc = this.virtualDocumentFactory.createVirtualDocument(context)
  //   const stylesheet = this.scssLanguageService.parseStylesheet(doc)
  //   const range = this.toVsRange(context, start, end)
  //   const diagnostics = this.scssLanguageService
  //     .doValidation(doc, stylesheet)
  //     .filter((diagnostic) => overlaps(diagnostic.range, range))

  //   return this.translateCodeActions(
  //     context,
  //     this.scssLanguageService.doCodeActions(doc, range, { diagnostics }, stylesheet),
  //   )
  // }

  // public getOutliningSpans(context: TemplateContext): ts.OutliningSpan[] {
  //   const doc = this.virtualDocumentFactory.createVirtualDocument(context)
  //   const ranges = this.scssLanguageService.getFoldingRanges(doc)
  //   return ranges
  //     .filter((range) => {
  //       // Filter out ranges outside on last line
  //       const end = context.toOffset({
  //         line: range.endLine,
  //         character: range.endCharacter || 0,
  //       })
  //       return end < context.text.length
  //     })
  //     .map((range) => this.translateOutliningSpan(context, range))
  // }

  private getCompletionItem(
    context: TemplateContext,
    position: ts.LineAndCharacter,
    completion: CompletionToken,
    rule: Rule,
    sortedIndex: number,
  ): vscode.CompletionItem {
    const label =
      rule.prefix && completion.kind == 'utility'
        ? completion.label.slice(rule.prefix.length + 1)
        : completion.label

    const newText =
      rule.prefix && completion.kind == 'utility'
        ? completion.value.slice(rule.prefix.length + 1)
        : completion.value

    const textEdit = {
      newText,
      range: {
        start: context.toPosition(rule.loc.start),
        end: context.toPosition(rule.loc.end),
      },
    }

    return {
      kind: completion.color
        ? vscode.CompletionItemKind.Color
        : completion.kind == 'screen'
        ? vscode.CompletionItemKind.EnumMember
        : completion.kind == 'variant'
        ? vscode.CompletionItemKind.Module
        : vscode.CompletionItemKind.Property,
      data: completion.kind,
      label,
      preselect: false,
      filterText: rule.value,
      sortText: sortedIndex.toString().padStart(8, '0'),
      detail: completion.detail,
      documentation: {
        kind: vscode.MarkupKind.Markdown,
        value: [
          completion.css && '```css\n' + completion.css + '\n```',
          completion.theme &&
            '**Theme**\n\n```json\n' +
              JSON.stringify(
                {
                  [completion.theme.section]: {
                    [completion.theme.key]: completion.theme.value,
                  },
                },
                null,
                2,
              ) +
              '\n```',
          this.configurationManager.config.debug &&
            '**Parsed**\n\n```json\n' +
              JSON.stringify(
                {
                  ...rule,
                  sortedIndex,
                  textEdit,
                },
                null,
                2,
              ) +
              '\n```',
          this.configurationManager.config.debug &&
            '**Completion**\n\n```json\n' + JSON.stringify(completion, null, 2) + '\n```',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },

      textEdit,
    }
  }

  private getCompletionItems(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): vscode.CompletionList {
    this.logger.log(
      `getCompletionItems[${context.fileName}:${position.line}:${
        position.character
      }] ${JSON.stringify(context.text)}`,
    )

    const cached = this._completionsCache.getCached(context, position)

    if (cached) {
      return cached
    }

    const completions: vscode.CompletionList = {
      isIncomplete: true,
      items: [],
    }

    const { completions: twindCompletions } = this._twind

    const rule = parse(context.text, context.toOffset(position), true)

    const hasScreenVariant = rule.variants.some((variant) =>
      twindCompletions.screens.has(variant.raw),
    )

    const screens = hasScreenVariant
      ? []
      : twindCompletions.tokens.filter((completion) => completion.kind == 'screen')

    const variants = twindCompletions.tokens.filter(
      (completion) =>
        completion.kind == 'variant' &&
        !rule.variants.some((variant) => variant.raw === completion.value),
    )

    const utilities = twindCompletions.tokens.filter(
      (completion) =>
        completion.kind == 'utility' &&
        (!rule.negated || completion.value.startsWith('-')) &&
        (!rule.prefix || completion.value.startsWith(rule.prefix + '-')),
    )

    // TODO Start a new directive group
    const matched = [
      ...matchSorter(screens, prepareText(rule.raw), {
        threshold: matchSorter.rankings.MATCHES,
        keys: [
          (completion) => prepareText(naturalExpand(completion.detail) + ' ' + completion.value),
        ],
      }),
      ...matchSorter(utilities, prepareText(rule.raw), {
        threshold: matchSorter.rankings.ACRONYM,
        keys: [(completion) => prepareText(naturalExpand(completion.value))],
        sorter: (items) =>
          items.sort((a, b) => {
            if (a.rankedValue[0] == '-' && b.rankedValue[0] != '-') {
              return 1
            }

            if (a.rankedValue[0] != '-' && b.rankedValue[0] == '-') {
              return -1
            }

            return defaultBaseSortFn(a, b)
          }),
      }),
      ...matchSorter(variants, prepareText(rule.raw), {
        threshold: matchSorter.rankings.ACRONYM,
        keys: [(completion) => prepareText(completion.value)],
      }),
    ]

    completions.items = matched.map((completion, index) =>
      this.getCompletionItem(context, position, completion, rule, index),
    )

    // this._completions.tokens.forEach((completion) => {
    //   if (completion.kind != 'utility' && !completion.value.startsWith(parsed.token)) {
    //     return
    //   }

    //   if (completion.kind == 'utility' && !completion.value.startsWith(parsed.directive)) {
    //     return
    //   }

    //   if (completion.kind == 'screen' && hasScreenVariant) {
    //     return
    //   }

    //   if (completion.kind == 'variant' && parsed.variants.includes(completion.value)) {
    //     return
    //   }

    //   completions.items.push(this.getCompletionItem(context, position, completion, parsed))
    // })

    // completions.items = [
    //   // Start a new directive group
    //   ...Object.keys(this.state.directives)
    //     .filter((key) => key.startsWith(directive))
    //     // Tex
    //     // text-current
    //     // => text
    //     // ring-off
    //     // ring-offset-70
    //     // => ring-offset
    //     .map((key) => {
    //       const nextDash = key.indexOf('-', directive.length)
    //       return nextDash >= 0 ? key.slice(0, nextDash) : ''
    //     })
    //     .filter((group, index, groups) => group && groups.indexOf(group) === index)
    //     .map((key) => ({
    //       kind: vscode.CompletionItemKind.Module,
    //       data: 'directive-group',
    //       label: prefix ? key.slice(prefix.length + 1) : key,
    //       sortText: `#${key}`,
    //       detail: `${key}(...)`,
    //       documentation: { kind: vscode.MarkupKind.PlainText, value: `Start a new ${key} group` },
    //       textEdit: {
    //         newText: (prefix ? key.slice(prefix.length + 1) : key).slice(token.length),
    //         range: {
    //           start: context.toPosition(tokenStartOffset + token.length),
    //           end: position,
    //         },
    //       },
    //     })),
    // ]

    if (rule.prefix && (!rule.raw || rule.raw === '&')) {
      completions.items.unshift({
        kind: vscode.CompletionItemKind.Constant,
        label: `&`,
        detail: `${rule.prefix}`,
        sortText: `&${rule.prefix}`,
        documentation: this.configurationManager.config.debug
          ? {
              kind: vscode.MarkupKind.Markdown,
              value: [
                '**Parsed**\n\n```json\n' +
                  JSON.stringify(
                    {
                      ...rule,
                      items: completions.items.map(({ label, filterText, sortText, textEdit }) => ({
                        label,
                        filterText,
                        sortText,
                        textEdit,
                      })),
                      matched: matched.map((x) => x.value),
                      // utilities: utilities.map((x) => x.value),
                    },
                    null,
                    2,
                  ) +
                  '\n```',
              ]
                .filter(Boolean)
                .join('\n\n'),
            }
          : undefined,
        textEdit: {
          newText: '&',
          range: {
            start: context.toPosition(rule.loc.start),
            end: context.toPosition(rule.loc.end),
          },
        },
      })
    }

    // if (this.configurationManager.config.debug) {
    //   completions.items.unshift({
    //     kind: vscode.CompletionItemKind.Constant,
    //     label: `----`,
    //     filterText: parsed.token,
    //     preselect: true,
    //     detail: parsed.directive,
    //     sortText: `&${parsed.prefix}`,
    //     documentation: {
    //       kind: vscode.MarkupKind.Markdown,
    //       value: [
    //         this.configurationManager.config.debug &&
    //           '**Parsed**\n\n```json\n' +
    //             JSON.stringify(
    //               {
    //                 ...parsed,
    //                 items: completions.items.map(({ label, filterText, sortText, textEdit }) => ({
    //                   label,
    //                   filterText,
    //                   sortText,
    //                   textEdit,
    //                 })),
    //                 matched: matched.map((x) => x.value),
    //                 // utilities: utilities.map((x) => x.value),
    //               },
    //               null,
    //               2,
    //             ) +
    //             '\n```',
    //       ]
    //         .filter(Boolean)
    //         .join('\n\n'),
    //     },
    //     textEdit: {
    //       newText: `&`.slice(parsed.token.length),
    //       range: {
    //         start: context.toPosition(parsed.tokenStartOffset + parsed.token.length),
    //         end: position,
    //       },
    //     },
    //   })
    // }

    this._completionsCache.updateCached(context, position, completions)

    return completions
  }
}

function translateCompletionItemsToCompletionInfo(
  context: TemplateContext,
  items: vscode.CompletionList,
): ts.WithMetadata<ts.CompletionInfo> {
  return {
    metadata: {
      isIncomplete: items.isIncomplete,
    },
    isGlobalCompletion: false,
    isMemberCompletion: false,
    isNewIdentifierLocation: false,
    entries: items.items.map((x) => translateCompletionEntry(context, x)),
  }
}

function translateCompletionItemsToCompletionEntryDetails(
  typescript: typeof ts,
  item: vscode.CompletionItem,
): ts.CompletionEntryDetails {
  return {
    name: item.label,
    kind: item.kind
      ? translateCompletionItemKind(typescript, item.kind)
      : typescript.ScriptElementKind.unknown,
    kindModifiers: getKindModifiers(item),
    displayParts: toDisplayParts(item.detail),
    documentation: toDisplayParts(item.documentation),
    tags: [],
  }
}

function translateCompletionEntry(
  context: TemplateContext,
  item: vscode.CompletionItem,
): ts.CompletionEntry {
  return {
    name: item.label,
    kind: item.kind
      ? translateCompletionItemKind(context.typescript, item.kind)
      : context.typescript.ScriptElementKind.unknown,
    kindModifiers: getKindModifiers(item),
    sortText: item.sortText || item.label,
    insertText: item.textEdit && item.textEdit.newText,
    replacementSpan: item.textEdit && {
      start: context.toOffset(item.textEdit.range.start),
      length:
        context.toOffset(item.textEdit.range.end) - context.toOffset(item.textEdit.range.start),
    },
  }
}

function translateCompletionItemKind(
  typescript: typeof ts,
  kind: vscode.CompletionItemKind,
): ts.ScriptElementKind {
  switch (kind) {
    case vscode.CompletionItemKind.Module:
      return typescript.ScriptElementKind.moduleElement
    case vscode.CompletionItemKind.Property:
      return typescript.ScriptElementKind.memberVariableElement
    case vscode.CompletionItemKind.Unit:
    case vscode.CompletionItemKind.Value:
      return typescript.ScriptElementKind.constElement
    case vscode.CompletionItemKind.Enum:
      return typescript.ScriptElementKind.enumElement
    case vscode.CompletionItemKind.EnumMember:
      return typescript.ScriptElementKind.enumMemberElement
    case vscode.CompletionItemKind.Keyword:
      return typescript.ScriptElementKind.keyword
    case vscode.CompletionItemKind.Constant:
      return typescript.ScriptElementKind.constElement
    case vscode.CompletionItemKind.Color:
      return typescript.ScriptElementKind.primitiveType
    case vscode.CompletionItemKind.Reference:
      return typescript.ScriptElementKind.alias
    case vscode.CompletionItemKind.Snippet:
    case vscode.CompletionItemKind.Text:
      return typescript.ScriptElementKind.string
    default:
      return typescript.ScriptElementKind.unknown
  }
}

function getKindModifiers(item: vscode.CompletionItem): string {
  if (item.kind === vscode.CompletionItemKind.Color) {
    return 'color'
  }

  return ''
}

// !function translateSeverity(
//   typescript: typeof ts,
//   severity: vscode.DiagnosticSeverity | undefined,
// ): ts.DiagnosticCategory {
//   switch (severity) {
//     case vscode.DiagnosticSeverity.Information:
//     case vscode.DiagnosticSeverity.Hint:
//       return typescript.DiagnosticCategory.Message

//     case vscode.DiagnosticSeverity.Warning:
//       return typescript.DiagnosticCategory.Warning

//     case vscode.DiagnosticSeverity.Error:
//     default:
//       return typescript.DiagnosticCategory.Error
//   }
// }

function toDisplayParts(text: string | vscode.MarkupContent | undefined): ts.SymbolDisplayPart[] {
  if (!text) {
    return []
  }

  return [
    {
      kind: 'text',
      text: typeof text === 'string' ? text : text.value,
    },
  ]
}
