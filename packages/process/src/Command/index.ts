import { Tagged } from "@effect-ts/core/Case"
import * as A from "@effect-ts/core/Collections/Immutable/Array"
import type { Chunk } from "@effect-ts/core/Collections/Immutable/Chunk"
import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as Map from "@effect-ts/core/Collections/Immutable/Map"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Stream"
import { pipe } from "@effect-ts/core/Function"
import type { Option } from "@effect-ts/core/Option"
import * as O from "@effect-ts/core/Option"
import { matchTag_ } from "@effect-ts/core/Utils"
import type { Byte } from "@effect-ts/node/Byte"
import * as NS from "@effect-ts/node/Stream"
import * as FileSystem from "fs"
import type { Writable as NodeJSWritableStream } from "stream"

import type { CommandError } from "../CommandError"
import * as CE from "../CommandError"
import type { ExitCode } from "../ExitCode"
import * as P from "../Process"
import * as PI from "../ProcessInput"
import * as PO from "../ProcessOutput"
import * as PS from "../ProcessStream"

// TODOS:
// - Handle redirecting of `stderr` to `stdout` when `redirectErrorStream` is `true`
// - Figure out how to capture `stdout` and `stderr` separately - at the moment
//   it can only be done in parallel

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents a command to execute in a child process.
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
  readonly args: Chunk<string>
  readonly env: Map.Map<string, string>
  readonly workingDirectory: Option<string>
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
    stdin: PI.Inherit,
    stdout: new PO.Pipe(),
    stderr: new PO.Pipe(),
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
 * @dataFirst pipeTo_
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
 * @dataFirst env_
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
 * @dataFirst workingDirectory_
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
 * @dataFirst stdin_
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
 * @dataFirst stderr_
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
 * @dataFirst stdout_
 */
export function stdout(stdout: PO.ProcessOutput) {
  return (self: Command): Command => stdout_(self, stdout)
}

/**
 * Inherit standard input, standard error, and standard output.
 */
export function inheritIO(self: Command): Command {
  return stdin_(stderr_(stdout_(self, new PO.Inherit()), new PO.Inherit()), PI.Inherit)
}

/**
 * Redirect the error stream to be merged with the standard output stream. The
 * moral equivalent of `2 > &1`.
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
 * moral equivalent of `2 > &1`.
 *
 * @dataFirst redirectErrorStream_
 */
export function redirectErrorStream(redirectErrorStream: boolean) {
  return (self: Command): Command => redirectErrorStream_(self, redirectErrorStream)
}

/**
 * Redirect standard output to a NodeJS `Writable` stream.
 */
export function redirectStdout_(self: Command, stream: NodeJSWritableStream): Command {
  return stdout_(self, new PO.Redirect({ redirectTo: stream }))
}

/**
 * Redirect standard output to a NodeJS `Writable` stream.
 *
 * @dataFirst redirectStdout_
 */
export function redirectStdout(stream: NodeJSWritableStream) {
  return (self: Command): Command => redirectStdout_(self, stream)
}

/**
 * Feed a string to the process `stdin` stream with a default the default
 * `BufferEncoding` of UTF-8.
 */
export function feed_(self: Command, input: string): Command {
  return stdin_(self, PI.fromUTF8String(input))
}

/**
 * Feed a string to the process `stdin` stream with a default the default
 * `BufferEncoding` of UTF-8.
 *
 * @dataFirst feed_
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
export function flatten(self: Command): Chunk<StandardCommand> {
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
export function run(self: Command): T.IO<CommandError, P.Process> {
  return pipe(
    self,
    T.matchTag({
      StandardCommand: (c) =>
        T.gen(function* (_) {
          yield* _(validateWorkingDirectory(c.workingDirectory))

          const process = yield* _(P.start(c))

          yield* _(
            O.fold_(
              c.stdin.source,
              () => T.unit,
              (input) =>
                T.chain_(
                  P.execute_(process, (p) => p.stdin),
                  (stdin) =>
                    T.forkDaemon(
                      S.run_(
                        input,
                        NS.sinkFromWritable(() => stdin)
                      )
                    )
                )
            )
          )

          return process
        }),
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
export function exitCode(self: Command): T.IO<CommandError, ExitCode> {
  return T.chain_(run(self), P.exitCode)
}

/**
 * Return the exit code of this process if it is zero. If non-zero, it will
 * fail with `CommandError.NonZeroErrorCode`.
 */
export function successfulExitCode(self: Command): T.IO<CommandError, ExitCode> {
  return T.chain_(run(self), P.successfulExitCode)
}

/**
 * Runs the command returning the entire output as a string with the
 * specified `BufferEncoding`.
 */
export function stringWithEncoding_(
  self: Command,
  encoding: BufferEncoding
): T.IO<CommandError, string> {
  return T.chain_(run(self), (process) =>
    PS.stringWithEncoding_(P.stdout(process), encoding)
  )
}

/**
 * Runs the command returning the entire output as a string with the
 * specified `BufferEncoding`.
 *
 * @dataFirst string_
 */
export function stringWithEncoding(encoding: BufferEncoding) {
  return (self: Command): T.IO<CommandError, string> =>
    stringWithEncoding_(self, encoding)
}

/**
 * Runs the command returning the entire output as a string with the
 * `BufferEncoding` set to `"utf8"`.
 */
export function string(self: Command): T.IO<CommandError, string> {
  return stringWithEncoding_(self, "utf8")
}

/**
 * Runs the command returning the output as a `Stream` of lines with the
 * specified `BufferEncoding`.
 */
export function linesStream(self: Command): S.IO<CommandError, string> {
  return S.chain_(S.fromEffect(run(self)), (process) =>
    PS.linesStream(P.stdout(process))
  )
}

/**
 * Runs the command returning the output as a `Chunk` of lines with the
 * specified `BufferEncoding`.
 */
export function lines(self: Command): T.IO<CommandError, Chunk<string>> {
  return T.map_(S.runCollect(linesStream(self)), C.from)
}

/**
 * Runs the command returning the output as a chunked `Stream` of `Byte`s.
 */
export function stream(self: Command): S.IO<CommandError, Byte> {
  return S.chain_(S.fromEffect(run(self)), (process) => PS.stream(P.stdout(process)))
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
  workingDirectory: Option<string>
): T.IO<CommandError, void> {
  return O.fold_(
    workingDirectory,
    () => T.unit,
    (directory) =>
      T.unlessM_(
        T.fail(new CE.WorkingDirectoryMissing({ workingDirectory: directory })),
        pathExists(directory)
      )
  )
}
