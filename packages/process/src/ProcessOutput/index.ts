// ets_tracing: off

import type * as stream from "stream"

import type { StdioOption } from "../Process/index.js"

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
export interface Inherit {
  readonly _tag: "Inherit"
}

/**
 * Create a pipe between the child process and the parent process (either
 * `stderr` or `stdout`).
 */
export interface Pipe {
  readonly _tag: "Pipe"
}

/**
 * Share a `Readable` or `Writable` `Stream` that refers to a tty, file, socket,
 * or a pipe with the child process. The stream's underlying file descriptor
 * is duplicated in the `ChildProcess` to the file descriptor that corresponds
 * to the index in the stdio array. The stream must have an underlying
 * descriptor (file streams do not until the `"open"` event has occurred).
 */
export interface Redirect {
  readonly _tag: "Redirect"
  readonly redirectTo: stream.Writable
}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Pass through the corresponding stdio stream to/from the parent process
 * (either `stderr` or `stdout`).
 */
export const Inherit: ProcessOutput = {
  _tag: "Inherit"
}

/**
 * Create a pipe between the child process and the parent process (either
 * `stderr` or `stdout`).
 */
export const Pipe: ProcessOutput = {
  _tag: "Pipe"
}

/**
 * Share a `Readable` or `Writable` `Stream` that refers to a tty, file, socket,
 * or a pipe with the child process. The stream's underlying file descriptor
 * is duplicated in the `ChildProcess` to the file descriptor that corresponds
 * to the index in the stdio array. The stream must have an underlying
 * descriptor (file streams do not until the `"open"` event has occurred).
 */
export function redirect(redirectTo: stream.Writable): ProcessOutput {
  return { _tag: "Redirect", redirectTo }
}

// -----------------------------------------------------------------------------
// Destructors
// -----------------------------------------------------------------------------

/**
 * Convert an `@effect-ts/process` `ProcessOutput` to a `ChildProcess`
 * `StdioOption`.
 */
export function toStdioOption(self: ProcessOutput): StdioOption {
  switch (self._tag) {
    case "Inherit":
      return "inherit"
    case "Pipe":
      return "pipe"
    case "Redirect":
      return self.redirectTo
  }
}
