import type * as ts from 'typescript/lib/tsserverlibrary'
import type { TemplateSettings } from 'typescript-template-language-service-decorator'

import { decorateWithTemplateLanguageService } from 'typescript-template-language-service-decorator'
import { ConfigurationManager, TwindPluginConfiguration } from './configuration'
import { TwindTemplateLanguageService } from './language-service'
import { LanguageServiceLogger } from './logger'
import { getSubstitutions } from './substituter'

export class TwindPlugin {
  private readonly typescript: typeof ts
  private _logger?: LanguageServiceLogger
  private readonly _configManager = new ConfigurationManager()

  public constructor(typescript: typeof ts) {
    this.typescript = typescript
  }

  public create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    this._logger = new LanguageServiceLogger(info)
    this._configManager.updateFromPluginConfig(info.config)

    console.log('config: ' + JSON.stringify(this._configManager.config))

    this._logger.log('config: ' + JSON.stringify(this._configManager.config))

    if (!isValidTypeScriptVersion(this.typescript)) {
      this._logger.log('Invalid typescript version detected. TypeScript 4.1 required.')
      return info.languageService
    }

    // Set up decorator
    // const proxy: ts.LanguageService = {
    //   ...info.languageService,
    //   getCompletionsAtPosition: (fileName, position, options) => {
    //     // emmetCompletions: false
    //     const prior = info.languageService.getCompletionsAtPosition(fileName, position, options)

    //     logger.log(
    //       'getCompletionsAtPosition: ' + JSON.stringify({ fileName, position, prior }, null, 2),
    //     )

    //     // prior.entries = prior.entries.filter((e) => e.name !== 'caller')
    //     return prior
    //   },
    // }

    return decorateWithTemplateLanguageService(
      this.typescript,
      info.languageService,
      info.project,
      new TwindTemplateLanguageService(this.typescript, info, this._configManager, this._logger),
      getTemplateSettings(this._configManager, this._logger),
      { logger: this._logger },
    )
  }

  public onConfigurationChanged(config: TwindPluginConfiguration): void {
    if (this._logger) {
      this._logger.log('onConfigurationChanged')
    }

    this._configManager.updateFromPluginConfig(config)
  }
}

export function getTemplateSettings(
  configManager: ConfigurationManager,
  logger: LanguageServiceLogger,
): TemplateSettings {
  return {
    get tags() {
      return configManager.config.tags
    },
    enableForStringWithSubstitutions: true,
    getSubstitutions(templateString, spans): string {
      logger.log(`getSubstitutions: ${JSON.stringify(templateString)} (${JSON.stringify(spans)})`)
      return getSubstitutions(/* templateString, spans */)
    },
  }
}

function isValidTypeScriptVersion(typescript: typeof ts): boolean {
  const [major, minor] = typescript.version.split('.')

  return Number(major) > 4 || (Number(major) == 4 && Number(minor) >= 1)
}
