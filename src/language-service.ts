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

import { matchSorter, MatchSorterOptions } from 'match-sorter'

import { CompletionToken, Twind } from './twind'
import { parse, Rule } from './parser'

// function arePositionsEqual(left: ts.LineAndCharacter, right: ts.LineAndCharacter): boolean {
//   return left.line === right.line && left.character === right.character
// }

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

// Use a tie-breaker sorter that respects numbers
const collator = new Intl.Collator(undefined, {
  numeric: true,
  caseFirst: 'false',
})

const KIND_SORTING: CompletionToken['kind'][] = ['screen', 'utility', 'variant']

const baseSort: NonNullable<MatchSorterOptions<CompletionToken>['baseSort']> = (
  { item: a },
  { item: b },
) => {
  const kindOrder = KIND_SORTING.indexOf(a.kind) - KIND_SORTING.indexOf(b.kind)

  if (kindOrder) {
    return kindOrder
  }

  // Sort screens by their min width
  if (a.kind == 'screen') {
    return collator.compare(a.detail + ' ' + a.value, b.detail + ' ' + b.value)
  }

  // Sort negated labels last
  if (a.label[0] == '-' && b.label[0] != '-') {
    return 1
  }

  if (a.label[0] != '-' && b.label[0] == '-') {
    return -1
  }

  // Sort arbitary values last
  if (a.value.endsWith('[') && !b.value.endsWith('[')) {
    return 1
  }

  if (!a.value.endsWith('[') && b.value.endsWith('[')) {
    return -1
  }

  // Sort interpolated values last
  if (a.value.endsWith('-') && !b.value.endsWith('-')) {
    return 1
  }

  if (!a.value.endsWith('-') && b.value.endsWith('-')) {
    return -1
  }

  return collator.compare(a.label, b.label)
}

// By default, match-sorter assumes spaces to be the word separator.
// Lets split the text into whitespace separated words
const prepareText = (value: string): string =>
  value
    .replace(/[A-Z]/g, ' $&')
    .replace(/(?<!^)[_-]/g, ' ')
    .replace(/(?<!^|\d)\d/g, ' $&')
    .replace(/\d(?!$|\d)/g, '$& ')
    .replace(/\s+/g, ' ')

export class TwindLanguageService implements TemplateLanguageService {
  private readonly typescript: typeof ts
  private readonly configurationManager: ConfigurationManager
  private readonly logger: Logger
  private readonly _twind: Twind

  constructor(
    typescript: typeof ts,
    info: ts.server.PluginCreateInfo,
    configurationManager: ConfigurationManager,
    logger: Logger,
  ) {
    this.typescript = typescript
    this.configurationManager = configurationManager
    this.logger = logger
    this._twind = new Twind(typescript, info, configurationManager, logger)
  }

  public get enabled(): boolean {
    return this._twind.enabled
  }

  public getCompletionsAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.WithMetadata<ts.CompletionInfo> {
    const start = Date.now()

    const rule = parse(context.text, context.toOffset(position), true)

    const completions = this.getCompletionTokens(context, position)

    if (this.configurationManager.config.debug) {
      this.logger.log(`getCompletionsAtPosition: ${Date.now() - start}ms`)
    }

    return translateCompletionItemsToCompletionInfo(context, {
      isIncomplete: true,
      items: completions.map((completion, index) =>
        this.getCompletionItem(context, completion, rule, index),
      ),
    })
  }

  public getCompletionEntryDetails(
    context: TemplateContext,
    position: ts.LineAndCharacter,
    name: string,
  ): ts.CompletionEntryDetails {
    const start = Date.now()

    const rule = parse(context.text, context.toOffset(position), true)

    const needle = rule.prefix && name === '&' ? rule.prefix : name

    const { completions } = this._twind

    const completion = completions.tokens.find((completion) => {
      const label =
        rule.prefix &&
        completion.kind == 'utility' &&
        completion.label.startsWith(rule.prefix + '-')
          ? completion.label.slice(rule.prefix.length + 1)
          : completion.label

      return label === needle
    })

    if (completion) {
      const item = this.getCompletionItem(context, completion, rule, 0)

      item.label = name
      item.detail = completion.detail
      item.documentation = {
        kind: vscode.MarkupKind.Markdown,
        value: [
          completion.css && '```css\n' + completion.css + '\n```',
          completion.theme &&
            '**Theme**\n\n```json\n' +
              JSON.stringify(
                {
                  [completion.theme.section]: {
                    [completion.theme.key || '…']: completion.theme.value || '…',
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
                  textEdit: item.textEdit,
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
      }

      if (this.configurationManager.config.debug) {
        this.logger.log(`getCompletionEntryDetails: ${Date.now() - start}ms`)
      }

      return translateCompletionItemToCompletionEntryDetails(this.typescript, item)
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

    const rule = rules
      .filter((rule) => !/\${x*}/.test(rule.value))
      .map((rule) => rule.value)
      .join(' ')

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
                messageText: `Unknown utility "${info.rule}"`,
                start: rule.loc.start,
                length: rule.loc.end - rule.loc.start,
                file: context.node.getSourceFile(),
                category: this.typescript.DiagnosticCategory.Error,
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
                  category: this.typescript.DiagnosticCategory.Error,
                  code: ErrorCodes.UNKNOWN_THEME_VALUE,
                }
              }
            }
          }
        })
        // Check non-empty directive
        .concat(
          rule.name
            ? undefined
            : {
                messageText: `Missing utility class`,
                start: rule.spans[0].start,
                length: rule.spans[rule.spans.length - 1].end - rule.spans[0].start,
                file: context.node.getSourceFile(),
                category: this.typescript.DiagnosticCategory.Error,
                code: ErrorCodes.UNKNOWN_DIRECTIVE,
              },
        )
        // check if every rule.variants exist
        .concat(
          rule.variants
            .filter(
              (variant) =>
                !(
                  this._twind.completions.variants.has(variant.value) ||
                  (variant.value[0] == '[' && variant.value[variant.value.length - 2] == ']') ||
                  /\${x*}/.test(variant.value)
                ),
            )
            .map(
              (variant): ts.Diagnostic => ({
                messageText: `Unknown variant "${variant.value}"`,
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
    completion: CompletionToken,
    rule: Rule,
    sortedIndex: number,
  ): vscode.CompletionItem {
    return {
      kind: completion.color
        ? vscode.CompletionItemKind.Color
        : completion.kind == 'screen'
        ? vscode.CompletionItemKind.EnumMember
        : completion.kind == 'variant'
        ? vscode.CompletionItemKind.Module
        : completion.interpolation
        ? vscode.CompletionItemKind.Variable
        : vscode.CompletionItemKind.Property,
      data: completion.kind,
      label:
        rule.prefix && completion.label !== '&' && completion.kind == 'utility'
          ? completion.label.slice(rule.prefix.length + 1)
          : completion.label,
      preselect: false,
      filterText: rule.name,
      sortText: sortedIndex.toString().padStart(8, '0'),
      textEdit: {
        newText:
          rule.prefix && completion.label !== '&' && completion.kind == 'utility'
            ? completion.value.slice(rule.prefix.length + 1)
            : completion.value,
        range: {
          start: context.toPosition(rule.loc.start),
          end: context.toPosition(rule.loc.end),
        },
      },
    }
  }

  private getCompletionTokens(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): CompletionToken[] {
    const start = Date.now()

    const rule = parse(context.text, context.toOffset(position), true)

    const { completions } = this._twind

    const hasScreenVariant = rule.variants.some((variant) => completions.screens.has(variant.value))

    const screens = hasScreenVariant
      ? []
      : completions.tokens.filter((completion) => completion.kind == 'screen')

    const variants = completions.tokens.filter(
      (completion) =>
        completion.kind == 'variant' &&
        !rule.variants.some((variant) => variant.value === completion.value),
    )

    const utilities = completions.tokens.filter(
      (completion) =>
        completion.kind == 'utility' &&
        (!rule.negated || completion.value.startsWith('-')) &&
        (!rule.prefix || completion.value.startsWith(rule.prefix + '-')),
    )

    // TODO Start a new directive group
    const needle = prepareText(rule.raw)
    const matched = matchSorter([...screens, ...utilities, ...variants], needle, {
      // threshold: matchSorter.rankings.MATCHES,
      keys: [
        (completion) =>
          completion.kind == 'screen'
            ? prepareText(completion.value + ' ' + completion.detail)
            : prepareText(completion.value),
      ],
      baseSort,
    })

    if (rule.prefix && (!rule.raw || rule.raw === '&')) {
      const selfRef = completions.tokens.find(
        (completion) => completion.kind == 'utility' && completion.value === rule.prefix,
      )

      if (selfRef) {
        matched.unshift(
          Object.assign(
            Object.defineProperties(
              Object.assign({}, selfRef),
              Object.getOwnPropertyDescriptors(selfRef),
            ),
            {
              value: '&',
              raw: '&',
              label: '&',
            },
          ),
        )
      }
    }

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

    if (this.configurationManager.config.debug) {
      this.logger.log(
        `getCompletionTokens: ${JSON.stringify({
          position: context.toOffset(position),
          needle: prepareText(rule.raw),
          example: prepareText('translate-x-4.5'),
          rule,
          matched: matched.map((x) => x.label),
        })}`,
      )
      this.logger.log(`getCompletionTokens: ${Date.now() - start}ms`)
    }

    return matched
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

function translateCompletionItemToCompletionEntryDetails(
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
    case vscode.CompletionItemKind.Variable:
      return typescript.ScriptElementKind.variableElement
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
