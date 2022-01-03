// ets_tracing: off

import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Experimental/Stream"
import * as SK from "@effect-ts/core/Effect/Experimental/Stream/Sink"
import { constUndefined, pipe } from "@effect-ts/core/Function"
import * as O from "@effect-ts/core/Option"
import type { Byte } from "@effect-ts/node/Byte"
import type { ChildProcess } from "child_process"
import { spawn } from "child_process"
import * as stream from "stream"

import type { StandardCommand } from "../Command"
import * as CE from "../CommandError"
import * as EC from "../ExitCode"
import * as NS from "../Internal/NodeStream"
import * as PI from "../ProcessInput"
import * as PO from "../ProcessOutput"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents a handle to a running NodeJS `ChildProcess`.
 */
export class Process {
  constructor(
    readonly process: ChildProcess,
    readonly stdin: SK.Sink<unknown, unknown, Byte, CE.CommandError, Byte, number>,
    readonly stdout: S.IO<CE.CommandError, Byte>,
    readonly stderr: S.IO<CE.CommandError, Byte>
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
  | stream.Stream
  | number
  | undefined

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Begin execution of the specified `Command` in a child process.
 */
export function start(command: StandardCommand): T.IO<CE.CommandError, Process> {
  return pipe(
    T.succeedWith(() => process.env),
    T.chain((env) =>
      T.effectAsyncInterrupt<unknown, unknown, Process>((resume) => {
        const proc = spawn(command.command, C.toArray(command.args), {
          stdio: [
            PI.toStdioOption(command.stdin),
            PO.toStdioOption(command.stdout),
            PO.toStdioOption(command.stderr)
          ],
          cwd: O.getOrElseS_(command.workingDirectory, constUndefined),
          env: { ...env, ...Object.fromEntries(command.env) }
        })

        // If starting the process throws an error, make sure to capture it
        proc.on("error", (err) => {
          proc.kill("SIGKILL")
          resume(T.fail(err))
        })

        // If the process is assigned a process identifier, then we know it
        // was spawned successfully
        if (proc.pid) {
          let stdin: SK.Sink<unknown, unknown, Byte, CE.CommandError, Byte, number> =
            SK.drain() as any
          const passThroughStderr = new stream.PassThrough()
          const passThroughStdout = new stream.PassThrough()

          if (proc.stdin !== null) {
            stdin = pipe(
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              NS.sinkFromWritable(() => proc.stdin!),
              SK.mapError((e) => CE.fromError(e.error))
            )
          }
          if (proc.stderr !== null) {
            proc.stderr.pipe(passThroughStderr)
          }
          if (proc.stdout !== null) {
            if (command.redirectErrorStream) {
              proc.stdout.pipe(passThroughStdout, { end: false })
              passThroughStderr.pipe(passThroughStdout)
            } else {
              proc.stdout.pipe(passThroughStdout)
            }
          }

          const stderr = command.redirectErrorStream
            ? S.empty
            : pipe(
                NS.streamFromReadable(() => passThroughStderr),
                S.mapError((e) => CE.fromError(e.error))
              )
          const stdout = pipe(
            NS.streamFromReadable(() => passThroughStdout),
            S.mapError((e) => CE.fromError(e.error))
          )

          resume(T.succeed(new Process(proc, stdin, stdout, stderr)))
        }

        return T.effectAsync((resume) => {
          if (proc.pid) {
            proc.kill("SIGTERM")
          }

          proc.on("exit", () => {
            resume(T.unit)
          })
        })
      })
    ),
    T.refineOrDie((e) =>
      O.getFirstAssociative<CE.CommandError>().combine(
        CE.isProgramNotFound(e),
        O.getFirstAssociative<CE.CommandError>().combine(
          CE.isPermissionDenied(e),
          CE.isIOError(e)
        )
      )
    )
  )
}

// -----------------------------------------------------------------------------
// Destructors
// -----------------------------------------------------------------------------

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
  return killSignal_(self, "SIGTERM")
}

/**
 * Terminate a `Process` by sending a `"SIGKILL"` signal and then waiting for
 * the `Process` to terminate.
 */
export function killForcibly(self: Process): T.IO<CE.CommandError, void> {
  return killSignal_(self, "SIGKILL")
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
    T.effectAsync((resume) => {
      self.process.kill(signal)
      self.process.on("exit", () => {
        resume(T.unit)
      })
    }),
    CE.isIOError
  )
}

/**
 * Terminate a `Process` by sending the specified signal and then waiting for
 * the `Process` to terminate..
 *
 * @ets_data_first killSignal_
 */
export function killSignal(signal: NodeJS.Signals) {
  return (self: Process): T.IO<CE.CommandError, void> => killSignal_(self, signal)
}

/**
 * Return the exit code after the `Process` has finished executing.
 */
export function exitCode(self: Process): T.IO<CE.CommandError, EC.ExitCode> {
  return T.refineOrDie_(
    T.effectAsyncInterrupt((resume) => {
      self.process.on("exit", (code, signal) => {
        if (code != null) {
          resume(T.succeed(new EC.ExitCode(code)))
        } else {
          // If code is `null`, then `signal` must be defined. See the NodeJS
          // documentation for the `"exit"` event on a `child_process`.
          // https://nodejs.org/api/child_process.html#child_process_event_exit
          resume(
            T.failWith(
              () => new Error(`Process interrupted due to receipt of signal: ${signal}`)
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
