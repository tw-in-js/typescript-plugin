import type * as ts from 'typescript/lib/tsserverlibrary'

import * as Path from 'path'
import Module from 'module'
import { fileURLToPath } from 'url'

import clearModule from 'clear-module'

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

export const findConfig = (project: ts.server.Project, cwd = process.cwd()): string | undefined => {
  const locatePath = (files: string[]) =>
    files.map((file) => Path.resolve(cwd, file)).find((file) => project.fileExists(file))

  return (
    locatePath(TWIND_CONFIG_FILES) ||
    locatePath(TWIND_CONFIG_FILES.map((file) => Path.join('config', file))) ||
    locatePath(TWIND_CONFIG_FILES.map((file) => Path.join('src', file))) ||
    locatePath(TWIND_CONFIG_FILES.map((file) => Path.join('public', file))) ||
    locatePath(TAILWIND_CONFIG_FILES)
  )
}

export const loadFile = <T>(file: string, cwd = process.cwd()): T => {
  const moduleId = Path.resolve(cwd, file)

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const from = fileURLToPath(import.meta.url)

    const require = Module.createRequire?.(from) || Module.createRequireFromPath(from)

    clearModule(moduleId)

    require('sucrase/register')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(moduleId) as T
  } catch (error) {
    console.error(`Failed to load ${moduleId}: ${(error as Error).stack}`)
    return {} as T
  }
}

export const loadConfig = (configFile: string, cwd = process.cwd()): Configuration => {
  const exports = loadFile<{ default: Configuration } & Configuration>(configFile, cwd)

  const config = exports.default || exports || {}

  // could be tailwind config
  if (
    (Array.isArray(config.plugins) ||
      // Twind has variants as {key: string}; Tailwind array or object
      Object.values(config.variants || {}).some((value) => typeof value == 'object') ||
      typeof config.prefix == 'string',
    'presets' in config ||
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
  project: ts.server.Project,
  cwd = process.cwd(),
  configFile?: string,
): Configuration & { configFile: string | undefined } => {
  configFile ??= findConfig(project, cwd)

  return {
    ...(configFile ? loadConfig(Path.resolve(cwd, configFile), cwd) : {}),
    configFile,
  }
}
