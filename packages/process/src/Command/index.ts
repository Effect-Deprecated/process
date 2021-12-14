// ets_tracing: off

import { Tagged } from "@effect-ts/core/Case"
import * as A from "@effect-ts/core/Collections/Immutable/Array"
import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as Map from "@effect-ts/core/Collections/Immutable/Map"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Experimental/Stream"
import { pipe } from "@effect-ts/core/Function"
import * as O from "@effect-ts/core/Option"
import { matchTag_ } from "@effect-ts/core/Utils"
import type { Byte } from "@effect-ts/node/Byte"
import * as FileSystem from "fs"
import type { Writable } from "stream"

import * as CE from "../CommandError"
import type { ExitCode } from "../ExitCode"
import * as NS from "../Internal/NodeStream"
import * as P from "../Process"
import * as PI from "../ProcessInput"
import * as PO from "../ProcessOutput"
import * as PS from "../ProcessStream"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents a command that should be executed in a separate process.
 */
export type Command = StandardCommand | PipedCommand

/**
 * Represents a standard command.
 *
 * ```sh
 * echo "This is a standard command"
 * ```
 */
export class StandardCommand extends Tagged("StandardCommand")<{
  readonly command: string
  readonly args: C.Chunk<string>
  readonly env: Map.Map<string, string>
  readonly workingDirectory: O.Option<string>
  readonly stdin: PI.ProcessInput
  readonly stdout: PO.ProcessOutput
  readonly stderr: PO.ProcessOutput
  readonly redirectErrorStream: boolean
}> {}

/**
 * Represents a piped command.
 *
 * ```sh
 * command1 | command2
 * ```
 */
export class PipedCommand extends Tagged("PipedCommand")<{
  readonly left: Command
  readonly right: Command
}> {}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Create a command with the specified process name and an optional list of
 * arguments.
 */
export function command(processName: string, ...args: Array<string>): Command {
  return new StandardCommand({
    command: processName,
    args: C.from(args),
    env: Map.empty,
    workingDirectory: O.emptyOf<string>(),
    stdin: PI.inherit,
    stdout: PO.pipe,
    stderr: PO.pipe,
    redirectErrorStream: false
  })
}

/**
 * Pipe one command to another command from left to right. The moral equivalent
 * of piping the output of one shell command to another:
 *
 * ```sh
 * command1 | command2
 * ```
 */
export function pipeTo_(left: Command, right: Command): Command {
  return new PipedCommand({ left, right })
}

/**
 * Pipe one command to another command from left to right. The moral equivalent
 * of piping the output of one shell command to another:
 *
 * ```sh
 * command1 | command2
 * ```
 *
 * @ets_data_first pipeTo_
 */
export function pipeTo(into: Command) {
  return (self: Command): Command => pipeTo_(self, into)
}

// -----------------------------------------------------------------------------
// Combinators
// -----------------------------------------------------------------------------

/**
 * Specify the environment variables that will be used when running this command.
 */
export function env_(self: Command, env: Map.Map<string, string>): Command {
  return matchTag_(self, {
    StandardCommand: (c) => c.copy({ env }),
    PipedCommand: (c) =>
      new PipedCommand({ left: env_(c.left, env), right: env_(c.right, env) })
  })
}

/**
 * Specify the environment variables that will be used when running this command.
 *
 * @ets_data_first env_
 */
export function env(env: Map.Map<string, string>) {
  return (self: Command): Command => env_(self, env)
}

/**
 * Set the working directory that will be used when this command will be run.
 *
 * For a `PipedCommand`, each piped `Command`'s working directory will also be
 * set.
 */
export function workingDirectory_(self: Command, workingDirectory: string): Command {
  return matchTag_(self, {
    StandardCommand: (c) => c.copy({ workingDirectory: O.some(workingDirectory) }),
    PipedCommand: (c) =>
      new PipedCommand({
        left: workingDirectory_(c.left, workingDirectory),
        right: workingDirectory_(c.right, workingDirectory)
      })
  })
}

/**
 * Set the working directory that will be used when this command will be run.
 *
 * For a `PipedCommand`, each piped `Command`'s working directory will also be
 * set.
 *
 * @ets_data_first workingDirectory_
 */
export function workingDirectory(workingDirectory: string) {
  return (self: Command): Command => workingDirectory_(self, workingDirectory)
}
/**
 * Specify what to do with the standard input of this `Command`.
 */
export function stdin_(self: Command, stdin: PI.ProcessInput): Command {
  return matchTag_(self, {
    StandardCommand: (c) => c.copy({ stdin }),
    // For piped commands it only makes sense to provide `stdin` for the
    // leftmost command as the rest will be piped in.
    PipedCommand: (c) => c.copy({ left: stdin_(c.left, stdin) })
  })
}

/**
 * Specify what to do with the standard input of this `Command`.
 *
 * @ets_data_first stdin_
 */
export function stdin(stdin: PI.ProcessInput) {
  return (self: Command): Command => stdin_(self, stdin)
}

/**
 * Specify what to do with the standard error of this `Command`.
 */
export function stderr_(self: Command, stderr: PO.ProcessOutput): Command {
  return matchTag_(self, {
    StandardCommand: (c) => c.copy({ stderr }),
    PipedCommand: (c) => c.copy({ right: stderr_(c.right, stderr) })
  })
}

/**
 * Specify what to do with the standard error of this `Command`.
 *
 * @ets_data_first stderr_
 */
export function stderr(stderr: PO.ProcessOutput) {
  return (self: Command): Command => stderr_(self, stderr)
}

/**
 * Specify what to do with the standard error of this `Command`.
 */
export function stdout_(self: Command, stdout: PO.ProcessOutput): Command {
  return matchTag_(self, {
    StandardCommand: (c) => c.copy({ stdout }),
    PipedCommand: (c) => c.copy({ right: stdout_(c.right, stdout) })
  })
}

/**
 * Specify what to do with the standard error of this `Command`.
 *
 * @ets_data_first stdout_
 */
export function stdout(stdout: PO.ProcessOutput) {
  return (self: Command): Command => stdout_(self, stdout)
}

/**
 * Inherit standard input, standard error, and standard output.
 */
export function inheritIO(self: Command): Command {
  return stdin_(stderr_(stdout_(self, PO.inherit), PO.inherit), PI.inherit)
}

/**
 * Redirect the error stream to be merged with the standard output stream. The
 * moral equivalent of `2>&1`.
 */
export function redirectErrorStream_(
  self: Command,
  redirectErrorStream: boolean
): Command {
  return matchTag_(self, {
    StandardCommand: (c) => c.copy({ redirectErrorStream }),
    PipedCommand: (c) =>
      new PipedCommand({
        left: c.left,
        right: redirectErrorStream_(c.right, redirectErrorStream)
      })
  })
}

/**
 * Redirect the error stream to be merged with the standard output stream. The
 * moral equivalent of `2>&1`.
 *
 * @ets_data_first redirectErrorStream_
 */
export function redirectErrorStream(redirectErrorStream: boolean) {
  return (self: Command): Command => redirectErrorStream_(self, redirectErrorStream)
}

/**
 * Redirect standard output to a NodeJS `Writable` stream.
 */
export function redirectStdout_(self: Command, stream: Writable): Command {
  return stdout_(self, new PO.Redirect({ redirectTo: stream }))
}

/**
 * Redirect standard output to a NodeJS `Writable` stream.
 *
 * @ets_data_first redirectStdout_
 */
export function redirectStdout(stream: Writable) {
  return (self: Command): Command => redirectStdout_(self, stream)
}

/**
 * Feed a string to the process `stdin` stream with a default the default
 * `BufferEncoding` of UTF-8.
 */
export function feed_(self: Command, input: string): Command {
  return stdin_(self, PI.fromString(input))
}

/**
 * Feed a string to the process `stdin` stream with a default the default
 * `BufferEncoding` of UTF-8.
 *
 * @ets_data_first feed_
 */
export function feed(input: string) {
  return (self: Command): Command => feed_(self, input)
}

/**
 * Flatten this command to a non-empty chunk of standard commands.
 *
 * * For a `StandardCommand`, this simply returns a `1` element `Chunk`
 * * For a `PipedCommand`, all commands in the pipe will be extracted out into
 * a `Chunk` from left to right.
 */
export function flatten(self: Command): C.Chunk<StandardCommand> {
  return matchTag_(self, {
    StandardCommand: (c) => C.single(c),
    PipedCommand: (c) => C.concat_(flatten(c.left), flatten(c.right))
  })
}

// -----------------------------------------------------------------------------
// Executors
// -----------------------------------------------------------------------------

/**
 * Start running the `Command` returning a handle to the running process.
 */
export function run(self: Command): T.IO<CE.CommandError, P.Process> {
  return pipe(
    self,
    T.matchTag({
      StandardCommand: (c) =>
        pipe(
          validateWorkingDirectory(c.workingDirectory),
          T.zipRight(P.start(c)),
          T.tap((proc) =>
            O.fold_(
              c.stdin.source,
              () => T.unit,
              (input) => T.forkDaemon(S.run_(input, proc.stdin))
            )
          )
        ),
      PipedCommand: (c) => {
        const chunk = flatten(c)

        if (chunk.length === 1) {
          return run(C.unsafeHead(chunk))
        }

        const inputStream = A.reduce_(
          C.toArray(chunk).slice(1, chunk.length - 1),
          stream(C.unsafeHead(chunk)),
          (s, command) => stream(stdin_(command, PI.fromStream(s)))
        )

        return run(stdin_(C.unsafeLast(chunk), PI.fromStream(inputStream)))
      }
    })
  )
}

/**
 * Runs the `Command` returning only the exit code.
 */
export function exitCode(self: Command): T.IO<CE.CommandError, ExitCode> {
  return T.chain_(run(self), P.exitCode)
}

/**
 * Return the exit code of this process if it is zero. If non-zero, it will
 * fail with `CommandError.NonZeroErrorCode`.
 */
export function successfulExitCode(self: Command): T.IO<CE.CommandError, ExitCode> {
  return T.chain_(run(self), P.successfulExitCode)
}

/**
 * Runs the command returning the entire output as a string with the
 * specified `BufferEncoding`.
 */
export function stringWithEncoding_(
  self: Command,
  encoding: BufferEncoding
): T.IO<CE.CommandError, string> {
  return T.chain_(run(self), (process) =>
    T.map_(NS.runBuffer(process.stdout), (buffer) => buffer.toString(encoding))
  )
}

/**
 * Runs the command returning the entire output as a string with the
 * specified `BufferEncoding`.
 *
 * @ets_data_first stringWithEncoding_
 */
export function stringWithEncoding(encoding: BufferEncoding) {
  return (self: Command): T.IO<CE.CommandError, string> =>
    stringWithEncoding_(self, encoding)
}

/**
 * Runs the command returning the entire output as a string with the
 * `BufferEncoding` set to `"utf8"`.
 */
export function string(self: Command): T.IO<CE.CommandError, string> {
  return stringWithEncoding_(self, "utf8")
}

/**
 * Runs the command returning the output as a `Stream` of lines with the
 * specified `BufferEncoding`.
 */
export function linesStream(self: Command): S.IO<CE.CommandError, string> {
  return S.chain_(S.fromEffect(run(self)), (process) => PS.linesStream(process.stdout))
}

/**
 * Runs the command returning the output as a `Chunk` of lines with the
 * specified `BufferEncoding`.
 */
export function lines(self: Command): T.IO<CE.CommandError, C.Chunk<string>> {
  return T.map_(S.runCollect(linesStream(self)), C.from)
}

/**
 * Runs the command returning the output as a chunked `Stream` of `Byte`s.
 */
export function stream(self: Command): S.IO<CE.CommandError, Byte> {
  return S.chain_(S.fromEffect(run(self)), (process) => process.stdout)
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function pathExists(path: string): T.UIO<boolean> {
  return T.effectAsync((cb) => {
    FileSystem.stat(path, (err, stats) => {
      if (err != null) {
        cb(T.succeed(false))
      } else {
        cb(T.succeed(stats.isDirectory() || stats.isFile()))
      }
    })
  })
}

function validateWorkingDirectory(
  workingDirectory: O.Option<string>
): T.IO<CE.CommandError, void> {
  return O.fold_(
    workingDirectory,
    () => T.unit,
    (directory) =>
      T.unlessM_(
        T.fail(new CE.WorkingDirectoryMissing({ directory })),
        pathExists(directory)
      )
  )
}
