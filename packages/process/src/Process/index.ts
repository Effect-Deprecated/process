import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as T from "@effect-ts/core/Effect"
import * as O from "@effect-ts/core/Option"
import { constUndefined } from "@effect-ts/system/Function"
import type { ChildProcessWithoutNullStreams as NodeJSChildProcess } from "child_process"
import { spawn } from "child_process"
import { env } from "process"
import type { Stream as NodeJSStream } from "stream"

import type { StandardCommand } from "../Command"
import * as CE from "../CommandError"
import * as EC from "../ExitCode"
import * as PO from "../ProcessOutput"
import { ProcessStream } from "../ProcessStream"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents a handle to a running NodeJS `ChildProcess`.
 */
export class Process {
  constructor(readonly process: NodeJSChildProcess) {}
}

/**
 * Represents valid values that can be passed to the child process as `stdio`
 * options.
 */
export type StdioOption =
  | "pipe"
  | "ipc"
  | "ignore"
  | "inherit"
  | NodeJSStream
  | number
  | undefined

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Begin execution of the specified `Command` in a child process.
 */
export function start(command: StandardCommand): T.IO<CE.CommandError, Process> {
  return T.refineOrDie_(
    T.chain_(
      T.succeedWith(() => env),
      (env) =>
        T.effectAsyncInterrupt((cb) => {
          const process = spawn(command.command, C.toArray(command.args), {
            stdio: [
              "pipe",
              PO.toStdioOption(command.stdout),
              PO.toStdioOption(command.stderr)
            ],
            cwd: O.getOrElseS_(command.workingDirectory, constUndefined),
            env: { ...env, ...Object.fromEntries(command.env) }
          })

          process.on("error", (err) => {
            cb(T.fail(err))
          })

          if (process.pid) {
            cb(T.succeed(new Process(process as any)))
          }

          return T.effectAsync((cb) => {
            if (process.pid) {
              process.kill("SIGTERM")
            }

            process.on("exit", () => {
              cb(T.unit)
            })
          })
        })
    ),
    (e) =>
      O.getFirstAssociative<CE.CommandError>().combine(
        CE.isProgramNotFound(e),
        O.getFirstAssociative<CE.CommandError>().combine(
          CE.isPermissionDenied(e),
          CE.isIOError(e)
        )
      )
  )
}

// -----------------------------------------------------------------------------
// Destructors
// -----------------------------------------------------------------------------

/**
 * Access the standard output stream of a running `Process`.
 */
export function stdout(self: Process): ProcessStream {
  return new ProcessStream(() => self.process.stdout)
}

/**
 * Access the standard error stream of a running `Process`.
 */
export function stderr(self: Process): ProcessStream {
  return new ProcessStream(() => self.process.stderr)
}

/**
 * Access the underlying NodeJS `ChildProcess` wrapped in an `Effect`.
 */
export function execute_<T>(
  self: Process,
  f: (process: NodeJSChildProcess) => T
): T.IO<CE.CommandError, T> {
  return T.refineOrDie_(
    T.succeedWith(() => f(self.process)),
    CE.isIOError
  )
}

/**
 * Access the underlying NodeJS `ChildProcess` wrapped in an `Effect`.
 *
 * @dataFirst execute_
 */
export function execute<T>(f: (process: NodeJSChildProcess) => T) {
  return (self: Process): T.IO<CE.CommandError, T> => execute_(self, f)
}

/**
 * Return the exit code after the `Process` has finished executing.
 */
export function exitCode(self: Process): T.IO<CE.CommandError, EC.ExitCode> {
  return T.refineOrDie_(
    T.effectAsyncInterrupt((cb) => {
      self.process.on("exit", (code, signal) => {
        if (code != null) {
          cb(T.succeed(new EC.ExitCode(code)))
        } else {
          // If code is `null`, then `signal` must be defined. See the NodeJS
          // documentation for the `"exit"` event on a `child_process`.
          // https://nodejs.org/api/child_process.html#child_process_event_exit
          cb(
            T.fail(
              new CE.IOError({
                reason: `exitCode: process interrupted due to receipt of signal ${signal}`
              })
            )
          )
        }
      })
      // Terminate the running process if the `Fiber` is terminated
      return T.succeedWith(() => {
        self.process.kill("SIGTERM")
      })
    }),
    CE.isIOError
  )
}

/**
 * Tests whether the process is still alive (not terminated or completed).
 */
export function isAlive(self: Process): T.UIO<boolean> {
  return T.orElse_(
    execute_(
      self,
      (process) =>
        process.exitCode == null && process.signalCode == null && !process.killed
    ),
    () => T.succeed(false)
  )
}

/**
 * Terminate a `Process` by sending a `"SIGTERM"` signal and then waiting for
 * the `Process` to terminate.
 */
export function kill(self: Process): T.IO<CE.CommandError, void> {
  return T.refineOrDie_(
    T.effectAsync((cb) => {
      self.process.kill("SIGTERM")
      self.process.on("exit", () => {
        cb(T.unit)
      })
    }),
    CE.isIOError
  )
}

/**
 * Terminate a `Process` by sending the specified signal and then waiting for
 * the `Process` to terminate.
 */
export function killSignal_(
  self: Process,
  signal: NodeJS.Signals
): T.IO<CE.CommandError, void> {
  return T.refineOrDie_(
    T.effectAsync((cb) => {
      self.process.kill(signal)
      self.process.on("exit", () => {
        cb(T.unit)
      })
    }),
    CE.isIOError
  )
}

/**
 * Terminate a `Process` by sending the specified signal and then waiting for
 * the `Process` to terminate..
 *
 * @dataFirst killSignal_
 */
export function killSignal(signal: NodeJS.Signals) {
  return (self: Process): T.IO<CE.CommandError, void> => killSignal_(self, signal)
}

/**
 * Return the exit code of this process if it is zero. If non-zero, it will
 * fail with `CommandError.NonZeroErrorCode`.
 */
export function successfulExitCode(self: Process): T.IO<CE.CommandError, EC.ExitCode> {
  return T.filterOrElse_(
    exitCode(self),
    (exitCode): exitCode is EC.ExitCode => exitCode === EC.Success,
    (exitCode) => T.fail(new CE.NonZeroExitCode({ exitCode }))
  )
}
