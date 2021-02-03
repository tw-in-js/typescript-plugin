export interface TailwindjsPluginConfiguration {
  readonly tags: ReadonlyArray<string>
  // Readonly validate: boolean;
  // readonly lint: { [key: string]: any };
  // readonly emmet: { [key: string]: any };
}

export class ConfigurationManager {
  private static readonly defaultConfiguration: TailwindjsPluginConfiguration = {
    tags: ['tw', 'apply'],
    // Validate: true,
    // lint: {
    //     emptyRules: 'ignore',
    // },
    // emmet: {},
  }

  private readonly _configUpdatedListeners = new Set<() => void>()

  public get config(): TailwindjsPluginConfiguration {
    return this._configuration
  }

  private _configuration: TailwindjsPluginConfiguration = ConfigurationManager.defaultConfiguration

  public updateFromPluginConfig(config: TailwindjsPluginConfiguration): void {
    this._configuration = {
      ...ConfigurationManager.defaultConfiguration,
      ...config,
    }

    for (const listener of this._configUpdatedListeners) {
      listener()
    }
  }

  public onUpdatedConfig(listener: () => void): void {
    this._configUpdatedListeners.add(listener)
  }
}
