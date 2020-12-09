import type * as ts from 'typescript/lib/tsserverlibrary'
import type { TemplateSettings } from 'typescript-template-language-service-decorator'

import { decorateWithTemplateLanguageService } from 'typescript-template-language-service-decorator'
import { ConfigurationManager, TailwindjsPluginConfiguration } from './configuration'
import { TailwindjsTemplateLanguageService } from './language-service'
import { LanguageServiceLogger } from './logger'
import { getSubstitutions } from './substituter'
// Import { StyledVirtualDocumentFactory } from './_virtual-document-provider'

export class TailwindjsPlugin {
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
      this._logger.log('Invalid typescript version detected. TypeScript 3.x required.')
      return info.languageService
    }

    return decorateWithTemplateLanguageService(
      this.typescript,
      info.languageService,
      info.project,
      new TailwindjsTemplateLanguageService(this.typescript, this._configManager, this._logger),
      getTemplateSettings(this._configManager, this._logger),
      { logger: this._logger },
    )
  }

  public onConfigurationChanged(config: TailwindjsPluginConfiguration): void {
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
      return getSubstitutions(templateString, spans)
    },
  }
}

function isValidTypeScriptVersion(typescript: typeof ts): boolean {
  const [major] = typescript.version.split('.')

  return Number(major) >= 3
}
