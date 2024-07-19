import * as path from 'path'
import Module from 'module'
import { fileURLToPath } from 'url'

import type { Logger } from 'typescript-template-language-service-decorator'
import type TS from 'typescript/lib/typescript'

import cssbeautify from 'cssbeautify'
import stringify from 'fast-json-stable-stringify'

import type {
  Context,
  Theme,
  ThemeSectionType,
  CSSRules,
  CSSRuleValue,
  ThemeScreenValue,
  TW,
  Configuration,
  ReportInfo,
} from 'twind'
import { theme, create, silent } from 'twind'
import { VirtualSheet, virtualSheet } from 'twind/sheets'
import { getConfig, loadFile } from './load'
import { getColor, KNOWN_COLORS } from './colors'

import type { ConfigurationManager } from './configuration'
import { watch } from './watch'
import { parse } from './parser'

const isCSSProperty = (key: string, value: CSSRuleValue): boolean =>
  !'@:&'.includes(key[0]) && ('rg'.includes((typeof value)[5]) || Array.isArray(value))

const detectKind = (directive: string): CompletionToken['kind'] => {
  return directive.endsWith(':') ? 'variant' : 'utility'
}

const sameValueToUndefined = (ref: string, value: string | undefined): string | undefined =>
  ref === value ? undefined : value

const convertRem = (value: string | undefined): string | undefined => {
  const replaced = value?.replace(
    /(-?(?:\d+\.)?\d+)rem/g,
    (_, number) => `${Number(number) * 16}px`,
  )

  return value === replaced ? value : `${value} (${replaced})`
}

const detailsFromThemeValue = <Section extends keyof Theme>(
  section: Section,
  value: ThemeSectionType<Theme[Section]>,
): string | undefined => {
  if (value == null) return

  switch (section) {
    case 'screens': {
      // | string
      // | [size: string, lineHeight: string]
      // | [size: string, options: { lineHeight?: string; letterSpacing?: string }]
      const screen = value as ThemeSectionType<Theme['screens']>

      // >=726px, (display-mode:standalone), >=500px & <=700px
      return typeof screen == 'string'
        ? '≥' + screen
        : ((Array.isArray(screen)
            ? (screen as ThemeScreenValue[])
            : [screen as unknown]) as ThemeScreenValue[])
            .filter(Boolean)
            .map((value) => {
              if (typeof value == 'string') {
                return '≥' + value
              }

              return (
                (value as { raw?: string }).raw ||
                // >=500px & <=700px
                Object.keys(value)
                  .map(
                    (feature) => (
                      { min: '≥', max: '≤' }[feature as 'min'],
                      (value as Record<string, string>)[feature as 'min']
                    ),
                  )
                  .join(' & ')
              )
            })
            .filter(Boolean)
            .join(', ')
    }

    case 'fontSize': {
      // | string
      // | [size: string, lineHeight: string]
      // | [size: string, options: { lineHeight?: string; letterSpacing?: string }]
      const fontSize = value as ThemeSectionType<Theme['fontSize']>

      // 1rem/2rem - ignoring the letterSpacing
      return typeof fontSize == 'string'
        ? fontSize
        : [fontSize[0], typeof fontSize[1] == 'string' ? fontSize[1] : fontSize[1].lineHeight]
            .filter(Boolean)
            .join('/')
    }

    case 'fontFamily': {
      return Array.isArray(value) ? value.filter(Boolean).join(', ') : (value as string)
    }
  }

  if (
    typeof value == 'string' &&
    ((/color/i.test(section) && !KNOWN_COLORS.has(value)) || /\s/.test(value))
  ) {
    return value
  }

  return undefined
}

const getSampleInterpolation = (interpolation: CompletionToken['interpolation']): string => {
  switch (interpolation) {
    case 'nonzero':
      return '1'
    case 'number':
      return '1'
    case 'string':
      return 'xyz'
  }

  return ''
}

export interface CompletionToken {
  readonly kind: 'screen' | 'variant' | 'utility'
  readonly raw: string
  // dark:, sm:, after::, bg-black, row-span-
  /**
   * A string that should be inserted into a document when selecting
   * this completion.
   */
  readonly value: string
  // row-span-{{nonzero}}
  /**
   * The label of this completion item.
   */
  readonly label: string
  /**
   * A human-readable string with additional information
   * about this item, like type or symbol information.
   *
   * The extract important info from the theme or CSS.
   * - theme(...) and value != key
   *   - screen: => theme value – ...
   *   - my-6 => 1.5rem – ...
   *   - text-red-600 => #DC2626 – ...
   *   - text-2xl => 1.5rem/2rem – ...
   *   - bg-opacity-40 => 0.4 – ...
   *   - translate-x-2 => 0.5rem – ...
   * - {{string}} => NonEmptyString
   * - {{number}} => NonNegativeNumber
   * - {{nonzero}} => positive number
   * - if several rules: x rules
   * - if at-rule use at rule
   * - if variant: use &:hover, &>*
   * - fallback to stringify declartions (order: props, custom)
   */
  readonly detail: string
  readonly color?: string
  readonly theme?: {
    section: keyof Theme
    key: string
    value: ThemeSectionType<Theme[keyof Theme]>
  }
  readonly interpolation?:
    | `string` // NonEmptyString
    | `number` // NonNegativeNumber
    | `nonzero` // PositiveNumber

  /**
   * ```css
   * /** spacing[0.5]: 0.125rem *\/
   * .py-0.5 {
   *   padding-top: 0.125rem;
   *   padding-bottom: 0.125rem;
   * }
   * ```
   */
  readonly css: string
}

export interface Completions {
  tokens: CompletionToken[]
  screens: Set<string>
  variants: Set<string>
}

export class Twind {
  private _watchers: (() => void)[] = []
  private _completions: Completions | undefined
  private _state:
    | {
        program: TS.Program
        sheet: VirtualSheet
        reports: ReportInfo[]
        tw: TW
        context: Context
        config: Configuration
        twindDTSSourceFile: TS.SourceFile | undefined
      }
    | undefined

  constructor(
    private readonly typescript: typeof TS,
    private readonly info: TS.server.PluginCreateInfo,
    private readonly configurationManager: ConfigurationManager,
    private readonly logger: Logger,
  ) {
    configurationManager.onUpdatedConfig(() => this._reset())
    // TODO watch changes to package.json, package-lock.json, yarn.lock, pnpm-lock.yaml
    ;['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].forEach((file) => {
      watch(path.resolve(info.project.getCurrentDirectory(), file), () => this._reset())
    })
  }

  public get enabled(): boolean {
    return Boolean(this.state?.twindDTSSourceFile)
  }

  private _reset(): void {
    this.logger.log('reset state')
    this._state = this._completions = undefined
    this._watchers.forEach((unwatch) => unwatch())
    this._watchers.length = 0
  }

  private get state() {
    if (this._state) {
      return this._state
    }

    let program = this.info.languageService.getProgram()

    if (!program) {
      return undefined
    }

    const { configFile, ...config } = getConfig(
      this.info.project,
      program.getCurrentDirectory(),
      this.configurationManager.config.configFile,
    )

    if (configFile) {
      this.logger.log(`loaded twind config from ${configFile}: ${JSON.stringify(config)}`)

      // Reset all state on config file changes
      this._watchers.push(watch(configFile, () => this._reset(), { once: true }))
    } else {
      this.logger.log(`no local twind config found`)
    }

    const sheet = virtualSheet()
    const reports: ReportInfo[] = []
    sheet.init(() => {
      reports.length = 0
    })

    // Prefer project twind and fallback to bundled twind
    const resolvedModule = this.info.languageServiceHost.getResolvedModuleWithFailedLookupLocationsFromCache?.(
      'twind',
      program.getRootFileNames()[0],
    )

    let twindDTSFile = resolvedModule?.resolvedModule?.resolvedFileName

    if (twindDTSFile) {
      this.logger.log(`found local twind dts at ${twindDTSFile}`)
    }

    let twindDTSSourceFile =
      (twindDTSFile &&
        program.getSourceFiles().find((sourceFile) => sourceFile.fileName == twindDTSFile)) ||
      program
        .getSourceFiles()
        .find((sourceFile) => sourceFile.fileName.endsWith('twind/twind.d.ts'))

    // No local twind but a twind.config -> use our twind
    if (
      !twindDTSSourceFile &&
      !twindDTSFile &&
      configFile &&
      /twind\.config\.\w+$/.test(configFile)
    ) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const from = fileURLToPath(import.meta.url)

      const { resolve } = Module.createRequire?.(from) || Module.createRequireFromPath(from)

      try {
        twindDTSFile = resolve('twind').replace(/\.\w+$/, '.d.ts')
        if (twindDTSFile) {
          this.logger.log(`found builtin twind dts at ${twindDTSFile}`)
        }
      } catch {
        // ignore
      }
    }

    if (!twindDTSSourceFile && twindDTSFile) {
      const options = program.getCompilerOptions()

      program = this.typescript.createProgram({
        rootNames: [...program.getRootFileNames(), twindDTSFile.replace(/\.d\.ts$/, '.js')],
        options: {
          ...options,
          typeRoots: [...(options.typeRoots || []), path.dirname(twindDTSFile)],
        },
        oldProgram: program,
      })

      twindDTSSourceFile = program
        .getSourceFiles()
        .find((sourceFile) => sourceFile.fileName.endsWith('twind/twind.d.ts'))
    }

    if (twindDTSSourceFile) {
      this.logger.log(`using twind completions from ${twindDTSSourceFile.fileName}`)
      this._watchers.push(watch(twindDTSSourceFile.fileName, () => this._reset(), { once: true }))
    } else {
      this.logger.log(`no twind completions found`)
    }

    const twindFile = twindDTSSourceFile?.fileName.replace(/\.d\.ts/, '.js')
    let version: string | undefined = 'undefined'

    if (twindFile) {
      this._watchers.push(watch(twindFile, () => this._reset(), { once: true }))

      const packageJSON = this.info.project.readFile(
        path.join(path.dirname(twindFile), 'package.json'),
      )

      if (packageJSON) {
        try {
          version = (JSON.parse(packageJSON) || {}).version
        } catch {
          // ignore
        }
      }
    }

    if (twindFile) {
      this.logger.log(`loading twind${version ? '@' + version : ''} from ${twindFile}`)
    } else {
      this.logger.log(`using builtin twind`)
    }

    // Prefer local twind
    const { tw } = (
      (twindFile &&
        (loadFile(twindFile, program.getCurrentDirectory()) as typeof import('twind'))?.create) ||
      create
    )({
      ...config,
      sheet,
      mode: {
        ...silent,
        report: (info: ReportInfo) => {
          // Ignore error from substitions
          if (
            !(
              (info.id === 'UNKNOWN_DIRECTIVE' && /\${x*}/.test(info.rule)) ||
              (info.id === 'UNKNOWN_THEME_VALUE' && /\${x*}/.test(String(info.key)))
            )
          ) {
            reports.push(info)
          }
        },
      },
      plugins: {
        ...config.plugins,
        // Used to generate CSS for variants
        TYPESCRIPT_PLUGIN_PLACEHOLDER: { '--typescript_plugin_placeholder': 'none' },
      },
      preflight: false,
      hash: false,
      prefix: false,
    })

    let context: Context
    tw((ctx: Context) => {
      context = ctx
      return ''
    })

    this._state = {
      program,
      sheet,
      tw,
      reports,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      context: context!,
      config,
      twindDTSSourceFile,
    }

    return this._state
  }

  css(rule: string): string | undefined {
    const { state } = this

    return state && generateCSS(state.sheet, state.tw, rule)
  }

  getDiagnostics(rule: string): ReportInfo[] | undefined {
    const { state } = this

    if (!state) {
      return undefined
    }

    state.sheet.reset()

    // verifiy rule with types: align-xxx -> invalid
    const { completions } = this

    for (const parsed of parse(rule)) {
      if (/\${x*}/.test(parsed.name)) continue

      const hasArbitrayValue = /-(\[[^\]]+])/.test(parsed.name)

      const utilitiyExists =
        !parsed.name ||
        completions.tokens.some((completion) => {
          if (completion.kind != 'utility') return false

          if (hasArbitrayValue) {
            return parsed.name.startsWith(completion.value) && parsed.name != completion.value
          }

          switch (completion.interpolation) {
            case 'string': {
              return parsed.name.startsWith(completion.value) && parsed.name != completion.value
            }
            case 'number': {
              return (
                parsed.name.startsWith(completion.value) &&
                parsed.name != completion.value &&
                Number(parsed.name.slice(completion.value.length)) >= 0
              )
            }
            case 'nonzero': {
              return (
                parsed.name.startsWith(completion.value) &&
                parsed.name != completion.value &&
                Number(parsed.name.slice(completion.value.length)) > 0
              )
            }
            default: {
              return completion.value == parsed.name
            }
          }
        })

      if (!utilitiyExists) {
        state.reports.push({
          id: 'UNKNOWN_DIRECTIVE',
          rule: parsed.name,
        })
      }
    }

    state.tw(rule)

    // Remove duplicates
    return [
      ...new Map([
        ...state.reports.map((report): [string, ReportInfo] => [stringify(report), report]),
      ]).values(),
    ]
  }

  get completions(): Completions {
    return this._completions || (this._completions = this._getCompletions())
  }

  private _getCompletions(): Completions {
    const { state } = this

    if (!state) {
      return { screens: new Set(), variants: new Set(), tokens: [] }
    }

    const { program, config, sheet, tw, context } = state

    const checker = program.getTypeChecker()

    let tokens: string[] = []

    if (state.twindDTSSourceFile) {
      const { typescript: ts } = this
      const visit = (node: TS.Node) => {
        if (tokens.length) return

        // TODO use CoreCompletionTokens and UserCompletionTokens
        if (
          ts.isTypeAliasDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.escapedText == 'CompletionTokens'
        ) {
          const type = checker.getTypeAtLocation(node)

          // (type.flags & ts.TypeFlags.Union) | (type.flags & ts.TypeFlags.Intersection)
          const { types } = type as TS.UnionOrIntersectionType

          // (type.flags & ts.TypeFlags.StringLiteral)
          tokens = types.map((type) => (type as TS.StringLiteralType).value)
        } else {
          ts.forEachChild(node, visit)
        }
      }

      // Walk the tree to search for classes
      this.typescript.forEachChild(state.twindDTSSourceFile, visit)
    }

    // Add plugins and variants from loaded config
    // as first to be overwritten by specific types
    tokens.unshift(...Object.keys(config.plugins || {}))
    tokens.unshift(...Object.keys(config.variants || {}).map((x) => x + ':'))

    const createCompletionToken = (
      directive: string,
      {
        kind = detectKind(directive),
        raw = directive,
        value = directive,
        label = value,
        theme,
        color = getColor(theme?.value),
        detail,
        css,
        interpolation,
        ...options
      }: Partial<CompletionToken> = {},
    ): CompletionToken => {
      return {
        ...options,
        kind,
        raw,
        value,
        interpolation,
        label,
        color,
        theme,
        get detail() {
          return (
            detail ??
            (detail =
              (theme &&
                convertRem(
                  sameValueToUndefined(
                    theme.key,
                    detailsFromThemeValue(theme.section, theme.value),
                  ),
                )) ||
              translateInterpolation(interpolation) ||
              detailFromCSS(sheet, tw, value, interpolation))
          )
        },
        get css() {
          return css ?? (css = generateCSS(sheet, tw, value, interpolation))
        },
      }
    }

    // Assume there can only be one interpolation
    const INTERPOLATION_RE = /{{([^}]+)}}/

    const completionTokens = new Map<string, CompletionToken>()
    const screens = new Set(Object.keys(theme('screens')(context)).map((x) => x + ':'))
    tokens.unshift(...screens)

    tokens.forEach((directive): void => {
      const match = INTERPOLATION_RE.exec(directive)

      if (!match) {
        completionTokens.set(directive, createCompletionToken(directive))
        return
      }

      const prefix = directive.slice(0, match.index)
      const suffix = directive.slice(match.index + match[0].length)
      const value = match[1]

      // | `theme(${keyof Theme})`
      // | `range(${number},${number},${number})`
      // | `string` // NonEmptyString
      // | `number` // NonNegativeNumber
      // | `nonzero` // PositiveNumber
      if (value.startsWith('theme(') && value.endsWith(')')) {
        const sectionKey = value.slice(6, -1)

        const section = theme(sectionKey as keyof Theme)(context)

        Object.keys(section)
          .filter((key, _index, keys) => {
            // Remove flattened values
            if (key.includes('.') && keys.includes(key.replace(/\./g, '-'))) {
              return false
            }

            // Is this the base object for nested values
            const value = section[key]

            if (
              typeof value === 'object' &&
              Object.keys(value).every((nestedKey) => keys.includes(`${key}-${nestedKey}`))
            ) {
              return false
            }

            return true
          })
          // Add marker for arbitrary value
          .concat('[')
          .forEach((key) => {
            if (key == '[' && suffix) {
              return
            }

            let className = prefix
            if (key && key != 'DEFAULT') {
              className += key
            }
            if (className.endsWith('-')) {
              className = className.slice(0, -1)
            }

            className += suffix

            completionTokens.set(
              className,
              createCompletionToken(className, {
                kind: screens.has(className) ? 'screen' : undefined,
                raw: directive,
                label: className.endsWith('[') && key === '[' ? `${className}…]` : undefined,
                theme:
                  key == '['
                    ? { section: sectionKey as keyof Theme, key: '', value: '' }
                    : { section: sectionKey as keyof Theme, key, value: section[key] },
              }),
            )
          })
      } else if (value.startsWith('range(') && value.endsWith(')')) {
        const [start, end, step = 1] = value.slice(6, -1).split(',').map(Number)

        for (let n = start; n <= end; n += step) {
          const className = prefix + n + suffix
          completionTokens.set(
            className,
            createCompletionToken(className, {
              raw: directive,
            }),
          )
        }
      } else {
        completionTokens.set(
          prefix,
          createCompletionToken(prefix, {
            raw: directive,
            label: `${prefix}…${suffix}`,
            interpolation: value as CompletionToken['interpolation'],
          }),
        )
      }
    })

    const variants = new Set<string>()

    for (const completionToken of completionTokens.values()) {
      if (completionToken.kind !== 'utility') {
        variants.add(completionToken.value)
      }
    }

    return {
      tokens: [...completionTokens.values()],
      screens,
      variants,
    }
  }
}

function generateCSS(
  sheet: VirtualSheet,
  tw: TW,
  value: string,
  interpolation?: CompletionToken['interpolation'],
): string {
  sheet.reset()

  if (interpolation) {
    value = value.replace(/…/g, getSampleInterpolation(interpolation))
  }

  if (value.endsWith('-[')) {
    value += '…]'
  }

  if (value.endsWith(':')) {
    tw(value + 'TYPESCRIPT_PLUGIN_PLACEHOLDER')
  } else {
    tw(value)
  }

  return cssbeautify(
    sheet.target
      // remove * { } rules
      .filter((rule) => !/^\s*\*\s*{/.test(rule))
      .join('\n')
      // Add whitespace after non-escaped ,
      .replace(/([^\\],)(\S)/g, '$1 $2'),

    {
      autosemicolon: true,
      indent: '  ',
      openbrace: 'end-of-line',
    },
  )
    .replace(/TYPESCRIPT_PLUGIN_PLACEHOLDER/g, '<...>')
    .replace(/^(\s*)--typescript_plugin_placeholder:\s*none\s*;$/gm, '$1/* ... */')
    .trim()
}

// TODO do not match @keyframes
const CSS_DECLARATION_RE = /[{;]\s*([A-Z\d-]+)\s*:\s*([^;}]+)/gi

function detailFromCSS(
  sheet: VirtualSheet,
  tw: TW,
  value: string,
  interpolation?: CompletionToken['interpolation'],
): string {
  if (interpolation) {
    value = value.replace(/…/g, getSampleInterpolation(interpolation))
  }

  if (value.endsWith('-[')) {
    value += '…]'
  }

  let style: CSSRules = {}
  tw(({ css }) => {
    style = value.endsWith(':') ? css(value + 'TYPESCRIPT_PLUGIN_PLACEHOLDER') : css(value)
    return ''
  })

  const { 0: key, length } = Object.keys(style).filter(
    (key) => !(/^([@:]global)/.test(key) || isCSSProperty(key, style[key])),
  )

  // - if several rules: x rules
  if (length > 1) {
    return `${length} rules`
  }

  // - if at-rule use at rule
  // - if variant: use &:hover, &>*
  if (value.endsWith(':') && key && /^@|&/.test(key)) {
    // TODO beautify children: siblings
    // TODO order of suggestions
    // TODO grouping prefix is ommited
    return key.replace(/([,+><*]|&(?!:))(\S)/g, '$1 $2')
  }

  // fallback to stringify declarations – interpolation has already been added to the value
  const css = generateCSS(sheet, tw, value)

  let result = ''

  // Reset as we break early
  CSS_DECLARATION_RE.lastIndex = 0
  for (let match: RegExpExecArray | null; (match = CSS_DECLARATION_RE.exec(css)); ) {
    const [, property, value] = match

    if (result.length < 30) {
      result += (result && '; ') + `${property}: ${convertRem(value)}`
    } else {
      result += '; …'
      break
    }
  }

  return result
}

function translateInterpolation(
  interpolation?: CompletionToken['interpolation'],
): string | undefined {
  switch (interpolation) {
    case `string`: // NonEmptyString
      return 'any string'
    case `number`: // NonNegativeNumber
      return 'a number greater or equal zero'
    case `nonzero`: // PositiveNumber
      return 'a number greater zero'
  }

  return interpolation
}
