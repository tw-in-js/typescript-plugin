// Based on https://github.com/microsoft/typescript-template-language-service-decorator/blob/26deaa4fc4af1237a94a44e033e92514077fbede/src/standard-template-source-helper.ts

import type * as ts from 'typescript/lib/tsserverlibrary'

import type {
  TemplateContext,
  TemplateSettings,
} from 'typescript-template-language-service-decorator'
import type ScriptSourceHelper from 'typescript-template-language-service-decorator/lib/script-source-helper'
import type TemplateSourceHelper from 'typescript-template-language-service-decorator/lib/template-source-helper'
import { relative } from 'typescript-template-language-service-decorator/lib/nodes'
import type { ConfigurationManager } from './configuration'
import { match, Matcher } from './match'
import { getSourceMatchers } from './source-matcher'

class PlaceholderSubstituter {
  public static replacePlaceholders(
    typescript: typeof ts,
    settings: TemplateSettings,
    node: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral,
  ): string {
    const literalContents = node.getText().slice(1, -1)
    if (node.kind === typescript.SyntaxKind.NoSubstitutionTemplateLiteral) {
      return literalContents
    }

    return PlaceholderSubstituter.getSubstitutions(
      settings,
      literalContents,
      PlaceholderSubstituter.getPlaceholderSpans(node),
    )
  }

  private static getPlaceholderSpans(node: ts.TemplateExpression) {
    const spans: Array<{ start: number; end: number }> = []
    const stringStart = node.getStart() + 1

    let nodeStart = node.head.end - stringStart - 2
    for (const child of node.templateSpans.map((x) => x.literal)) {
      const start = child.getStart() - stringStart + 1
      spans.push({ start: nodeStart, end: start })
      nodeStart = child.getEnd() - stringStart - 2
    }
    return spans
  }

  private static getSubstitutions(
    settings: TemplateSettings,
    contents: string,
    locations: ReadonlyArray<{ start: number; end: number }>,
  ): string {
    if (settings.getSubstitutions) {
      return settings.getSubstitutions(contents, locations)
    }

    const parts: string[] = []
    let lastIndex = 0
    for (const span of locations) {
      parts.push(contents.slice(lastIndex, span.start))
      parts.push(this.getSubstitution(settings, contents, span.start, span.end))
      lastIndex = span.end
    }
    parts.push(contents.slice(lastIndex))
    return parts.join('')
  }

  private static getSubstitution(
    settings: TemplateSettings,
    templateString: string,
    start: number,
    end: number,
  ): string {
    return settings.getSubstitution
      ? settings.getSubstitution(templateString, start, end)
      : 'x'.repeat(end - start)
  }
}

class StandardTemplateContext /* implements TemplateContext */ {
  constructor(
    public readonly typescript: typeof ts,
    public readonly fileName: string,
    public readonly node: ts.StringLiteralLike | ts.TemplateLiteral,
    private readonly helper: ScriptSourceHelper,
    private readonly templateSettings: TemplateSettings,
  ) {}

  public toOffset(position: ts.LineAndCharacter): number {
    const docOffset = this.helper.getOffset(
      this.fileName,
      position.line + this.stringBodyPosition.line,
      position.line === 0
        ? this.stringBodyPosition.character + position.character
        : position.character,
    )
    return docOffset - this.stringBodyOffset
  }

  public toPosition(offset: number): ts.LineAndCharacter {
    const docPosition = this.helper.getLineAndChar(this.fileName, this.stringBodyOffset + offset)
    return relative(this.stringBodyPosition, docPosition)
  }

  // @memoize
  private get stringBodyOffset(): number {
    return this.node.getStart() + 1
  }

  // @memoize
  private get stringBodyPosition(): ts.LineAndCharacter {
    return this.helper.getLineAndChar(this.fileName, this.stringBodyOffset)
  }

  // @memoize
  public get text(): string {
    return this.typescript.isTemplateExpression(this.node)
      ? PlaceholderSubstituter.replacePlaceholders(
          this.typescript,
          this.templateSettings,
          this.node,
        )
      : this.node.text
  }

  // @memoize
  public get rawText(): string {
    return this.node.getText().slice(1, -1)
  }
}

export function getTemplateSettings(configManager: ConfigurationManager): TemplateSettings {
  return {
    get tags() {
      return configManager.config.tags
    },
    enableForStringWithSubstitutions: true,
    getSubstitution(templateString, start, end) {
      return `\${${'x'.repeat(end - start - 3)}}`
    },
  }
}

export class StandardTemplateSourceHelper implements TemplateSourceHelper {
  private templateSettings: TemplateSettings
  private sourceMatchers: Matcher[]

  constructor(
    private readonly typescript: typeof ts,
    private readonly configManager: ConfigurationManager,
    private readonly helper: ScriptSourceHelper,
  ) {
    this.templateSettings = getTemplateSettings(this.configManager)
    this.sourceMatchers = getSourceMatchers(this.typescript, this.configManager.config)

    configManager.onUpdatedConfig(() => {
      this.templateSettings = getTemplateSettings(this.configManager)
      this.sourceMatchers = getSourceMatchers(this.typescript, this.configManager.config)
    })
  }

  public getTemplate(fileName: string, position: number): TemplateContext | undefined {
    const node = this.getValidTemplateNode(this.helper.getNode(fileName, position))

    if (!node) {
      return undefined
    }

    // Make sure we are inside the template string
    if (position <= node.pos) {
      return undefined
    }

    // Make sure we are not inside of a placeholder
    if (this.typescript.isTemplateExpression(node)) {
      let start = node.head.end
      for (const child of node.templateSpans.map((x) => x.literal)) {
        const nextStart = child.getStart()
        if (position >= start && position <= nextStart) {
          return undefined
        }
        start = child.getEnd()
      }
    }

    return new StandardTemplateContext(
      this.typescript,
      fileName,
      node,
      this.helper,
      this.templateSettings,
    ) as TemplateContext
  }

  public getAllTemplates(fileName: string): readonly TemplateContext[] {
    return this.helper
      .getAllNodes(fileName, (node) => this.getValidTemplateNode(node) !== undefined)
      .map(
        (node) =>
          new StandardTemplateContext(
            this.typescript,
            fileName,
            this.getValidTemplateNode(node) as ts.StringLiteralLike,
            this.helper,
            this.templateSettings,
          ) as TemplateContext,
      )
  }

  public getRelativePosition(context: TemplateContext, offset: number): ts.LineAndCharacter {
    const baseLC = this.helper.getLineAndChar(context.fileName, context.node.getStart() + 1)
    const cursorLC = this.helper.getLineAndChar(context.fileName, offset)
    return relative(baseLC, cursorLC)
  }

  private getValidTemplateNode(
    node: ts.Node | undefined,
  ): ts.StringLiteralLike | ts.TemplateLiteral | undefined {
    if (!node) {
      return undefined
    }

    const { typescript: ts } = this

    if (ts.isTaggedTemplateExpression(node)) {
      return this.getValidTemplateNode(node.template)
    }

    // TODO if templateSettings.enableForStringWithSubstitutions
    if (ts.isTemplateHead(node) || ts.isTemplateSpan(node)) {
      return this.getValidTemplateNode(node.parent)
    }

    if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      return this.getValidTemplateNode(node.parent)
    }

    // TODO Identifier, TemplateHead, TemplateMiddle, TemplateTail
    // export type StringLiteralLike = StringLiteral | NoSubstitutionTemplateLiteral;
    // export type PropertyNameLiteral = Identifier | StringLiteralLike | NumericLiteral;
    if (
      !(ts.isStringLiteralLike(node) || ts.isTemplateLiteral(node) || ts.isTemplateExpression(node))
    ) {
      return undefined
    }

    // Ignore strings that are part of an expression
    // x + '...'
    if (ts.isStringLiteralLike(node) && ts.isBinaryExpression(node.parent)) {
      return undefined
    }

    let currentNode: ts.Node = node

    while (currentNode && !ts.isSourceFile(currentNode)) {
      if (match(currentNode, this.sourceMatchers)) {
        return node
      }

      if (ts.isCallLikeExpression(currentNode)) {
        return undefined
      }

      // TODO stop conditions
      currentNode = currentNode.parent
    }
  }
}
