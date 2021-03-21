export interface TwindPluginConfiguration {
  readonly tags: ReadonlyArray<string>
  readonly configFile?: string
  readonly debug?: boolean
  // Readonly validate: boolean;
  // readonly lint: { [key: string]: any };
  // readonly emmet: { [key: string]: any };
}

export class ConfigurationManager {
  private static readonly defaultConfiguration: TwindPluginConfiguration = {
    tags: ['tw', 'apply'],
    debug: false,
    // Validate: true,
    // lint: {
    //     emptyRules: 'ignore',
    // },
    // emmet: {},
  }

  private readonly _configUpdatedListeners = new Set<() => void>()

  public get config(): TwindPluginConfiguration {
    return this._configuration
  }

  private _configuration: TwindPluginConfiguration = {
    ...ConfigurationManager.defaultConfiguration,
    tags: [...ConfigurationManager.defaultConfiguration.tags],
  }

  public updateFromPluginConfig(config: Partial<TwindPluginConfiguration> = {}): void {
    const { tags, ...mergedConfig } = {
      ...ConfigurationManager.defaultConfiguration,
      ...config,
    }

    this._configuration = {
      ...mergedConfig,
      debug: 'true' == String(mergedConfig.debug),
      tags: this._configuration.tags,
    }
    ;(this._configuration.tags as string[]).length = 0
    ;(this._configuration.tags as string[]).push(...tags)

    for (const listener of this._configUpdatedListeners) {
      listener()
    }
  }

  public onUpdatedConfig(listener: () => void): void {
    this._configUpdatedListeners.add(listener)
  }
}
