import * as Path from 'path'
import Module from 'module'

import { buildSync } from 'esbuild'
import findUp from 'find-up'

import type { Configuration } from 'twind'

export const findConfig = (cwd = process.cwd()): string | undefined =>
  findUp.sync(['twind.config.ts', 'twind.config.mjs', 'twind.config.js', 'twind.config.cjs'], {
    cwd,
  })

export const loadConfig = (configFile: string): Configuration => {
  const result = buildSync({
    bundle: true,
    entryPoints: [configFile],
    format: 'cjs',
    platform: 'node',
    target: `node${process.versions.node}`,
    external: Module.builtinModules,
    sourcemap: 'inline',
    minify: false,
    splitting: false,
    write: false,
  })

  const module = { exports: {} as { default?: Configuration } & Configuration }

  new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    result.outputFiles[0].text,
  )(
    module.exports,
    Module.createRequire?.(configFile) || Module.createRequireFromPath(configFile),
    module,
    configFile,
    Path.dirname(configFile),
  )

  const config = module.exports.default || module.exports || {}

  // could be tailwind config
  if (
    (Array.isArray(config.plugins) ||
      // Twind has variants as {key: string}; Tailwind array or object
      Object.values(config.variants || {}).some((value) => typeof value == 'object') ||
      typeof config.prefix == 'string',
    'presets' in config ||
      'important' in config ||
      'separator' in config ||
      'variantOrder' in config ||
      'corePlugins' in config ||
      'purge' in config)
  ) {
    // console.error(
    //   kleur.red(
    //     `${kleur.bold(
    //       Path.relative(process.cwd(), configFile),
    //     )} is a tailwindcss configuration file – ${kleur.bold(
    //       'only',
    //     )} the theme, darkMode, purge files are used`,
    //   ),
    // )

    return {
      theme: config.theme,
      darkMode: config.darkMode,
    }
  }

  return config
}

export const getConfig = (
  cwd = process.cwd(),
  configFile?: string,
): Configuration & { configFile: string | undefined } => {
  configFile ??= findConfig(cwd)

  return {
    ...(configFile ? loadConfig(Path.resolve(cwd, configFile)) : {}),
    configFile,
  }
}
