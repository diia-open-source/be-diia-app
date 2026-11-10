import { PathLike } from 'fs'
import { FileHandle } from 'fs/promises'

export function lookupOrThrow(
    dictionary: Map<PathLike | FileHandle, string>,
    label: string,
): (key: PathLike | FileHandle) => Promise<string> {
    return async (path: PathLike | FileHandle): Promise<string> => {
        const value = dictionary.get(path)

        if (value === undefined) {
            throw new Error(`unexpected ${label}: ${JSON.stringify(path)}`)
        }

        return value
    }
}
