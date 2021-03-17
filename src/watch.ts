import * as fs from 'fs'

export function watch(
  file: string,
  listener: (event: 'rename' | 'change', filename: string) => void,
): void {
  try {
    const watcher = fs.watch(
      file,
      {
        persistent: false,
      },
      (event, filename) => {
        watcher.close()
        listener(event, filename)
      },
    )
  } catch (error) {
    if (error.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      throw error
    }
  }
}
