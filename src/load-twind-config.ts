import * as Path from 'path'
import Module from 'module'

import { buildSync } from 'esbuild'
import findUp from 'find-up'
import locatePath from 'locate-path'

import type { Configuration } from 'twind'

const TWIND_CONFIG_FILES = [
  'twind.config.ts',
  'twind.config.mjs',
  'twind.config.js',
  'twind.config.cjs',
]

const TAILWIND_CONFIG_FILES = [
  'tailwind.config.ts',
  'tailwind.config.mjs',
  'tailwind.config.js',
  'tailwind.config.cjs',
]

// TODO use typescript to check files
// this.typescript.server.toNormalizedPath(fileName)
// info.project.containsFile()
export const findConfig = (cwd = process.cwd()): string | undefined =>
  locatePath.sync(TWIND_CONFIG_FILES.map((file) => Path.resolve(cwd, 'config', file))) ||
  locatePath.sync(TWIND_CONFIG_FILES.map((file) => Path.resolve(cwd, 'src', file))) ||
  locatePath.sync(TWIND_CONFIG_FILES.map((file) => Path.resolve(cwd, 'public', file))) ||
  findUp.sync(TWIND_CONFIG_FILES, { cwd }) ||
  findUp.sync(TAILWIND_CONFIG_FILES, { cwd })

export const loadConfig = (configFile: string, cwd = process.cwd()): Configuration => {
  const result = buildSync({
    bundle: true,
    entryPoints: [configFile],
    format: 'cjs',
    platform: 'node',
    target: 'es2018', // `node${process.versions.node}`,
    external: Module.builtinModules,
    // Follow WMR rules
    mainFields: ['esmodules', 'modern', 'module', 'jsnext:main', 'main'],
    conditions: ['development', 'esmodules', 'module', 'node', 'import', 'require', 'default'],
    sourcemap: 'inline',
    minify: false,
    splitting: false,
    write: false,
    absWorkingDir: cwd,
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
    ...(configFile ? loadConfig(Path.resolve(cwd, configFile), cwd) : {}),
    configFile,
  }
}
