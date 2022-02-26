import { matchTag_ } from "@effect-ts/core/Utils"

import type { CommandError } from "../src/CommandError/index.js"

/**
 * Convert a `CommandError` to a string.
 */
export function stringifyError(error: CommandError): string {
  return matchTag_(
    error,
    {
      NonZeroExitCode: (_) => `${_._tag}: ${_.exitCode}`,
      WorkingDirectoryMissing: (_) => `${_._tag}: ${_.directory}`
    },
    (_) => `${_._tag}: ${_.message}`
  )
}
