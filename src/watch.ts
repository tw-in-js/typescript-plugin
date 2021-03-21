import * as fs from 'fs'

export function watch(
  file: string,
  listener: (event: 'rename' | 'change', filename: string) => void,
  { once }: { once?: boolean } = {},
): () => void {
  try {
    const watcher = fs.watch(
      file,
      {
        persistent: false,
      },
      (event, filename) => {
        if (once) watcher.close()

        listener(event, filename)
      },
    )

    return () => watcher.close()
  } catch (error) {
    if (['ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', 'ENOENT'].includes(error.code)) {
      return () => {
        /* no-op*/
      }
    }

    throw error
  }
}
