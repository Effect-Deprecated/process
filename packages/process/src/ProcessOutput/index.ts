import { Tagged } from "@effect-ts/system/Case"
import { matchTag_ } from "@effect-ts/system/Utils"
import type { StdioOption } from "execa"
import type { Writable as NodeJSWritableStream } from "stream"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Configures the pipes that are established between the parent and child
 * processes `stderr` and `stdout` streams.
 */
export type ProcessOutput = Inherit | Pipe | Redirect

/**
 * Pass through the corresponding stdio stream to/from the parent process
 * (either `stderr` or `stdout`).
 */
export class Inherit extends Tagged("Inherit")<{}> {}

/**
 * Create a pipe between the child process and the parent process (either
 * `stderr` or `stdout`).
 */
export class Pipe extends Tagged("Pipe")<{}> {}

/**
 * Share a `Readable` or `Writable` `Stream` that refers to a tty, file, socket,
 * or a pipe with the child process. The stream's underlying file descriptor
 * is duplicated in the `ChildProcess` to the file descriptor that corresponds
 * to the index in the stdio array. The stream must have an underlying
 * descriptor (file streams do not until the `"open"` event has occurred).
 */
export class Redirect extends Tagged("Redirect")<{
  redirectTo: NodeJSWritableStream
}> {}

// -----------------------------------------------------------------------------
// Destructors
// -----------------------------------------------------------------------------

/**
 * Convert an `effect-ts/process` `ProcessOutput` to a `ChildProcess`
 * `StdioOption`.
 */
export function toStdioOption(processOutput: ProcessOutput): StdioOption {
  return matchTag_(processOutput, {
    Inherit: () => "inherit" as StdioOption,
    Pipe: () => "pipe" as StdioOption,
    Redirect: (redirect) => redirect.redirectTo
  })
}
