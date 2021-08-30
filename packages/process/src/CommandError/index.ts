import { Tagged } from "@effect-ts/core/Case"
import * as O from "@effect-ts/core/Option"

import type { ExitCode } from "../ExitCode"
import * as SystemError from "../Internal/SystemError"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * An error that can occur as a result of running a `Command`.
 */
export type CommandError =
  | IOError
  | ProgramNotFound
  | PermissionDenied
  | NonZeroExitCode
  | WorkingDirectoryMissing

export class IOError extends Tagged("IOError")<{
  readonly reason: string
}> {}

export class ProgramNotFound extends Tagged("ProgramNotFound")<{
  readonly reason: string
}> {}

export class PermissionDenied extends Tagged("PermissionDenied")<{
  readonly reason: string
}> {}

export class NonZeroExitCode extends Tagged("NonZeroExitCode")<{
  readonly exitCode: ExitCode
}> {}

export class WorkingDirectoryMissing extends Tagged("WorkingDirectoryMissing")<{
  readonly workingDirectory: string
}> {}

// -----------------------------------------------------------------------------
// Unapply
// -----------------------------------------------------------------------------

/**
 * Refine the provided unknown value to either a `Some<IOError>`, or
 * `None`.
 */
export function isIOError(u: unknown): O.Option<IOError> {
  if (u instanceof Error) {
    return O.some(new IOError({ reason: u.message }))
  }
  return O.none
}

/**
 * Refine the provided unknown value to either a `Some<ProgramNotFound>`, or
 * `None`.
 */
export function isProgramNotFound(u: unknown): O.Option<ProgramNotFound> {
  // Handle NodeJS `SystemError`s
  if (SystemError.isSystemError(u) && u.code === "ENOENT") {
    return O.some(new ProgramNotFound({ reason: u.message }))
  }
  // Handle regular `Error`
  if (u instanceof Error && u.message.indexOf("ENOENT") > -1) {
    return O.some(new ProgramNotFound({ reason: u.message }))
  }
  return O.none
}

/**
 * Refine the provided unknown value to either a `Some<PermissionDenied>`, or
 * `None`.
 */
export function isPermissionDenied(u: unknown): O.Option<PermissionDenied> {
  // Handle NodeJS `SystemError`s
  if (SystemError.isSystemError(u) && (u.code === "EACCES" || u.code === "EPERM")) {
    return O.some(new PermissionDenied({ reason: u.message }))
  }
  // Handle regular `Error`
  if (
    u instanceof Error &&
    (u.message.indexOf("EACCES") !== -1 || u.message.indexOf("EPERM") !== -1)
  ) {
    return O.some(new PermissionDenied({ reason: u.message }))
  }
  return O.none
}
