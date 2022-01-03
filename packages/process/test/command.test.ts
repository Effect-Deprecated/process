import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as Map from "@effect-ts/core/Collections/Immutable/Map"
import * as T from "@effect-ts/core/Effect"
import * as Ex from "@effect-ts/core/Effect/Exit"
import * as S from "@effect-ts/core/Effect/Experimental/Stream"
import * as F from "@effect-ts/core/Effect/Fiber"
import { pipe } from "@effect-ts/core/Function"
import * as O from "@effect-ts/core/Option"
import * as TE from "@effect-ts/jest/Test"
import * as Byte from "@effect-ts/node/Byte"
import { TestClock } from "@effect-ts/system/Testing/TestClock"
import * as path from "path"

import * as Command from "../src/Command"
import * as ExitCode from "../src/ExitCode"
import * as Process from "../src/Process"
import * as ProcessInput from "../src/ProcessInput"
import * as ProcessStream from "../src/ProcessStream"
import * as TestUtils from "./test-utils"

const TEST_BASH_SCRIPTS_DIRECTORY = path.join(__dirname, "bash")

describe("Command", () => {
  const { it } = TE.runtime()

  it("should convert stdout to a string", () =>
    T.gen(function* (_) {
      const output = yield* _(Command.string(Command.make("echo", "-n", "test")))

      expect(output).toEqual("test")
    }))

  it("should convert stdout to a list of lines", () =>
    T.gen(function* (_) {
      const output = yield* _(Command.lines(Command.make("echo", "-n", "1\n2\n3")))

      expect(C.toArray(output)).toEqual(["1", "2", "3"])
    }))

  it("should stream lines of output", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(Command.make("echo", "-n", "1\n2\n3"), Command.linesStream, S.runCollect)
      )

      expect(C.toArray(output)).toEqual(["1", "2", "3"])
    }))

  it("should work with a Stream directly", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("echo", "-n", "1\n2\n3"),
          Command.stream,
          S.mapChunks((c) => C.single(Byte.buffer(c).toString("utf-8"))),
          S.splitLines,
          S.runCollect
        )
      )

      expect(C.toArray(output)).toEqual(["1", "2", "3"])
    }))

  it("should fail when trying to run a command that does not exist", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.make("some-invalid-command", "test"),
        Command.string,
        T.mapError(TestUtils.stringifyError)
      )

      const output = yield* _(T.result(command))

      expect(Ex.untraced(output)).toEqual(
        Ex.fail("ProgramNotFound: spawn some-invalid-command ENOENT")
      )
    }))

  it("should pass environment variables", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("bash", "-c", 'echo -n "var = $VAR"'),
          Command.env(Map.make([["VAR", "value"]])),
          Command.string
        )
      )

      expect(output).toEqual("var = value")
    }))

  it("should accept streaming stdin", () =>
    T.gen(function* (_) {
      const stream = pipe(Command.make("echo", "-n", "a", "b", "c"), Command.stream)

      const output = yield* _(
        pipe(
          Command.make("cat"),
          Command.stdin(ProcessInput.fromStream(stream)),
          Command.string
        )
      )

      expect(output).toEqual("a b c")
    }))

  it("should accept string stdin", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("cat"),
          Command.stdin(ProcessInput.fromString("piped in")),
          Command.string
        )
      )

      expect(output).toEqual("piped in")
    }))

  it("should support different encodings", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("cat"),
          Command.stdin(ProcessInput.fromString("piped in", "utf16le")),
          Command.stringWithEncoding("utf16le")
        )
      )

      expect(output).toEqual("piped in")
    }))

  it("should set the working directory", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("ls"),
          Command.workingDirectory(path.join(__dirname, "..", "src")),
          Command.lines
        )
      )

      expect(C.toArray(output)).toContain("Command")
    }))

  it("should be able to fall back to a different program", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("custom-echo", "-n", "test"),
          Command.string,
          T.catchTag("ProgramNotFound", () =>
            pipe(Command.make("echo", "-n", "test"), Command.string)
          )
        )
      )

      expect(output).toEqual("test")
    }))

  it("should interrupt a process manually", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("sleep", "20"),
          Command.exitCode,
          T.fork,
          T.chain((fiber) => T.fork(F.interrupt(fiber))),
          T.chain((fiber) => F.join(fiber))
        )
      )

      expect(Ex.interrupted(output)).toBeTruthy()
    }))

  it("should interrupt a process due to a timeout", () =>
    T.gen(function* (_) {
      const testClock = yield* _(TestClock)

      const command = pipe(
        Command.make("sleep", "20"),
        Command.exitCode,
        T.timeout(5000)
      )

      const output = yield* _(
        pipe(
          T.do,
          T.bind("fiber", () => T.fork(command)),
          T.bind("adjustFiber", () => T.fork(testClock.adjust(5000))),
          T.tap(() => T.sleep(5000)),
          T.chain(({ adjustFiber, fiber }) =>
            pipe(
              F.join(adjustFiber),
              T.chain(() => F.join(fiber))
            )
          )
        )
      )

      expect(O.isNone(output)).toBeTruthy()
    }))

  it("should capture stderr and stdout separately", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.make("./both-streams-test.sh"),
        Command.workingDirectory(TEST_BASH_SCRIPTS_DIRECTORY)
      )

      const { stderr, stdout } = yield* _(
        pipe(
          T.do,
          T.bind("proc", () => Command.run(command)),
          T.bind("stdout", ({ proc }) => ProcessStream.string(proc.stdout)),
          T.bind("stderr", ({ proc }) => ProcessStream.string(proc.stderr))
        )
      )

      expect(stdout).toEqual("stdout1\nstdout2\n")
      expect(stderr).toEqual("stderr1\nstderr2\n")
    }))

  it("should return non-zero exit code in success channel", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.make("./non-zero-exit.sh"),
          Command.workingDirectory(TEST_BASH_SCRIPTS_DIRECTORY),
          Command.exitCode
        )
      )

      expect(output).toEqual(ExitCode.Failure)
    }))

  it("should throw permission denied as a typed error", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.make("./no-permissions.sh"),
        Command.workingDirectory(TEST_BASH_SCRIPTS_DIRECTORY)
      )

      const output = yield* _(
        T.result(pipe(Command.string(command), T.mapError(TestUtils.stringifyError)))
      )

      expect(Ex.untraced(output)).toEqual(
        Ex.fail("PermissionDenied: spawn ./no-permissions.sh EACCES")
      )
    }))

  it("should merge stderr into stdout when redirectErrorStream is true", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.make("./both-streams-test.sh"),
        Command.workingDirectory(TEST_BASH_SCRIPTS_DIRECTORY),
        Command.redirectErrorStream(true)
      )

      const { stderr, stdout } = yield* _(
        pipe(
          T.do,
          T.bind("proc", () => Command.run(command)),
          T.bind("stdout", ({ proc }) => ProcessStream.string(proc.stdout)),
          T.bind("stderr", ({ proc }) => ProcessStream.string(proc.stderr))
        )
      )

      expect(stderr).toBe("")
      expect(stdout).toContain("stdout1\nstdout2")
      expect(stdout).toContain("stderr1\nstderr2\n")
    }))

  it("should be able to kill a running process", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.make("./echo-repeat.sh"),
        Command.workingDirectory(TEST_BASH_SCRIPTS_DIRECTORY)
      )

      const output = yield* _(
        pipe(
          Command.run(command),
          T.chain((process) =>
            pipe(
              T.do,
              T.bind("isAliveBeforeKill", () => Process.isAlive(process)),
              T.tap(() => Process.kill(process)),
              T.bind("isAliveAfterKill", () => Process.isAlive(process))
            )
          )
        )
      )

      expect(output.isAliveBeforeKill).toBeTruthy()
      expect(output.isAliveAfterKill).toBeFalsy()
    }))

  it("should throw non-existent working directory as a typed error", () =>
    T.gen(function* (_) {
      const exit = yield* _(
        pipe(
          Command.make("ls"),
          Command.workingDirectory("/some/bad/path"),
          Command.lines,
          T.mapError(TestUtils.stringifyError),
          T.result
        )
      )

      expect(Ex.untraced(exit)).toEqual(
        Ex.fail("WorkingDirectoryMissing: /some/bad/path")
      )
    }))
})
