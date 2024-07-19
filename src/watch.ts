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
    const errno = error as NodeJS.ErrnoException
    if (errno.code && ['ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', 'ENOENT'].includes(errno.code)) {
      return () => {
        /* no-op*/
      }
    }

    throw error
  }
}
