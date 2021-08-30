import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Stream"
import type { Sink } from "@effect-ts/core/Effect/Stream/Sink"
import * as O from "@effect-ts/core/Option"
import type { Byte } from "@effect-ts/node/Byte"
import * as NS from "@effect-ts/node/Stream"
import { constUndefined } from "@effect-ts/system/Function"
import type { ChildProcessWithoutNullStreams as NodeJSChildProcess } from "child_process"
import { spawn } from "child_process"
import type { Stream as NodeJSStream } from "stream"

import type { StandardCommand } from "../Command"
import * as CE from "../CommandError"
import * as EC from "../ExitCode"
import * as PO from "../ProcessOutput"
import * as PS from "../ProcessStream"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents a handle to a running NodeJS `ChildProcess`.
 */
export class Process {
  constructor(
    readonly process: NodeJSChildProcess,
    readonly stdin: Sink<unknown, NS.WritableError, Byte, never, void>,
    readonly stderr: S.IO<CE.CommandError, Byte>,
    readonly stdout: S.IO<CE.CommandError, Byte>
  ) {}
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
      T.succeedWith(() => process.env),
      (env) =>
        T.effectAsyncInterrupt((cb) => {
          const proc = spawn(command.command, C.toArray(command.args), {
            stdio: [
              "pipe",
              PO.toStdioOption(command.stdout),
              PO.toStdioOption(command.stderr)
            ],
            cwd: O.getOrElseS_(command.workingDirectory, constUndefined),
            env: { ...env, ...Object.fromEntries(command.env) }
          })

          proc.on("error", (err: Error) => {
            cb(T.fail(err))
          })

          // If the process is assigned a process identifier, then we know it
          // was spawned successfully
          if (proc.pid) {
            if (proc.stdin == null) {
              cb(T.die(new Error(`Invalid process: stdin stream not found`)))
            }
            if (proc.stderr == null) {
              cb(T.die(new Error(`Invalid process: stderr stream not found`)))
            }
            if (proc.stdout == null) {
              cb(T.die(new Error(`Invalid process: stdout stream not found`)))
            }

            /* eslint-disable @typescript-eslint/no-non-null-assertion */
            const stdin = NS.sinkFromWritable(() => proc.stdin!)
            const stderr = PS.fromReadableStream(() => proc.stderr!)
            const stdout = PS.fromReadableStream(() => proc.stdout!)
            /* eslint-enable  @typescript-eslint/no-non-null-assertion */

            if (command.redirectErrorStream) {
              const merged = S.merge_(stdout, stderr)
              cb(T.succeed(new Process(proc as any, stdin, S.empty, merged)))
            } else {
              cb(T.succeed(new Process(proc as any, stdin, stderr, stdout)))
            }
          }

          return T.effectAsync((cb) => {
            if (proc.pid) {
              proc.kill("SIGTERM")
            }

            proc.on("exit", () => {
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
  return T.succeed(
    self.process.exitCode == null &&
      self.process.signalCode == null &&
      !self.process.killed
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
