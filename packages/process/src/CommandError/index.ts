// ets_tracing: off

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

/**
 * Represents the possible properties that an error can have depending upon
 * whether the error was a standard JavaScript `Error` or a NodeJS
 * `ErrnoException`.
 *
 * See https://nodejs.org/api/errors.html#errormessage for more information.
 */
export interface ErrorProperties {
  /**
   * A string description of the error.
   */
  readonly message: string
  /**
   * A string describing the point in the code at which the error was
   * instantiated.
   */
  readonly stack: O.Option<string>
  /**
   * If the error was a NodeJS `ErrnoException`, the `code` is a string
   * representing the system error code.
   */
  readonly code: O.Option<string>
  /**
   * If the error was a NodeJS `ErrnoException`, the `errno` is a a negative
   * number which corresponds to the error code defined in libuv Error handling.
   *
   * See https://docs.libuv.org/en/v1.x/errors.html for more information.
   */
  readonly errno: O.Option<number>
  /**
   * If the error was a NodeJS `ErrnoException`, the `syscall` is a string
   * describing the syscall that failed.
   *
   * See https://man7.org/linux/man-pages/man2/syscalls.2.html for more
   * information.
   */
  readonly syscall: O.Option<string>
  /**
   * If the error was a NodeJS `ErrnoException`, the `path` is a string
   * containing a relevant invalid pathname.
   */
  readonly path: O.Option<string>
}

/**
 * An error representing the case where the system encountered an input/output
 * exception.
 */
export class IOError extends Tagged("IOError")<ErrorProperties> {}

/**
 * An error representing the case where the program specified by a `Command`
 * could not be found.
 */
export class ProgramNotFound extends Tagged("ProgramNotFound")<ErrorProperties> {}

/**
 * An error representing the case where the current system user has insufficient
 * permissions to run the specified `Command`.
 */
export class PermissionDenied extends Tagged("PermissionDenied")<ErrorProperties> {}

/**
 * An error representing the case where a program run by a `Command` exited with
 * a non-zero exit code.
 */
export class NonZeroExitCode extends Tagged("NonZeroExitCode")<{
  readonly exitCode: ExitCode
}> {}

/**
 * An error representing the case where the working directory specified by a
 * `Command` does not exist.
 */
export class WorkingDirectoryMissing extends Tagged("WorkingDirectoryMissing")<{
  readonly directory: string
}> {}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Converts an `Error` into a `CommandError`.
 */
export function fromError(e: Error): CommandError {
  return new IOError(
    SystemError.isSystemError(e)
      ? systemErrorToProperties(e)
      : standardErrorToProperties(e)
  )
}

// -----------------------------------------------------------------------------
// Unapply
// -----------------------------------------------------------------------------

/**
 * Refine the provided unknown value to either a `Some<IOError>`, or
 * `None`.
 */
export function isIOError(u: unknown): O.Option<IOError> {
  if (SystemError.isSystemError(u)) {
    return O.some(new IOError(systemErrorToProperties(u)))
  }
  if (u instanceof Error) {
    return O.some(new IOError(standardErrorToProperties(u)))
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
    return O.some(new ProgramNotFound(systemErrorToProperties(u)))
  }
  // Handle regular `Error`
  if (u instanceof Error && u.message.indexOf("ENOENT") > -1) {
    return O.some(new ProgramNotFound(standardErrorToProperties(u)))
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
    return O.some(new PermissionDenied(systemErrorToProperties(u)))
  }
  // Handle regular `Error`
  if (
    u instanceof Error &&
    (u.message.indexOf("EACCES") !== -1 || u.message.indexOf("EPERM") !== -1)
  ) {
    return O.some(new PermissionDenied(standardErrorToProperties(u)))
  }
  return O.none
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/**
 * Converts a standard JavaScript error to an instance of `ErrorProperties`.
 */
function standardErrorToProperties(error: Error): ErrorProperties {
  return {
    message: error.message,
    stack: O.fromNullable(error.stack),
    code: O.none,
    errno: O.none,
    syscall: O.none,
    path: O.none
  }
}

/**
 * Converts a NodeJS `ErrnoException` to an instance of `ErrorProperties`.
 */
function systemErrorToProperties(error: NodeJS.ErrnoException): ErrorProperties {
  return {
    message: error.message,
    stack: O.fromNullable(error.stack),
    code: O.fromNullable(error.code),
    errno: O.fromNullable(error.errno),
    syscall: O.fromNullable(error.syscall),
    path: O.fromNullable(error.path)
  }
}
