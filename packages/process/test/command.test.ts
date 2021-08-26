import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as Map from "@effect-ts/core/Collections/Immutable/Map"
import * as T from "@effect-ts/core/Effect"
import * as Ex from "@effect-ts/core/Effect/Exit"
import * as F from "@effect-ts/core/Effect/Fiber"
import * as S from "@effect-ts/core/Effect/Stream"
import { pipe } from "@effect-ts/core/Function"
import * as O from "@effect-ts/core/Option"
import * as TE from "@effect-ts/jest/Test"
import { TestClock } from "@effect-ts/system/Testing/TestClock"

import * as Command from "../src/Command"
import * as CommandError from "../src/CommandError"
import * as ExitCode from "../src/ExitCode"
import { splitLines, utf8Decode } from "../src/Internal/Transducer"
import * as Process from "../src/Process"
import * as ProcessInput from "../src/ProcessInput"
import * as ProcessStream from "../src/ProcessStream"

describe("Command", () => {
  const { it } = TE.runtime()

  it("should convert stdout to a string", () =>
    T.gen(function* (_) {
      const output = yield* _(Command.string(Command.command("echo", "-n", "test")))

      expect(output).toEqual("test")
    }))

  it("should convert stdout to a list of lines", () =>
    T.gen(function* (_) {
      const output = yield* _(Command.lines(Command.command("echo", "-n", "1\n2\n3")))

      expect(output).toEqual(C.from(["1", "2", "3"]))
    }))

  it("should stream lines of output", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("echo", "-n", "1\n2\n3"),
          Command.linesStream,
          S.runCollect
        )
      )

      expect(output).toEqual(["1", "2", "3"])
    }))

  it("should work with a Stream directly", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("echo", "-n", "1\n2\n3"),
          Command.stream,
          S.aggregate(utf8Decode),
          S.aggregate(splitLines),
          S.runCollect
        )
      )

      expect(output).toEqual(["1", "2", "3"])
    }))

  it("should fail when trying to run a command that does not exist", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.command("some-invalid-command", "test"),
        Command.string
      )

      const output = yield* _(T.result(command))

      expect(Ex.untraced(output)).toEqual(
        Ex.fail(
          new CommandError.ProgramNotFound({
            reason: "spawn some-invalid-command ENOENT"
          })
        )
      )
    }))

  it("should pass environment variables", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("bash", "-c", 'echo -n "var = $VAR"'),
          Command.env(Map.make([["VAR", "value"]])),
          Command.string
        )
      )

      expect(output).toEqual("var = value")
    }))

  it("should accept streaming stdin", () =>
    T.gen(function* (_) {
      const stream = pipe(Command.command("echo", "-n", "a", "b", "c"), Command.stream)

      const output = yield* _(
        pipe(
          Command.command("cat"),
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
          Command.command("cat"),
          Command.stdin(ProcessInput.fromUTF8String("piped in")),
          Command.string
        )
      )

      expect(output).toEqual("piped in")
    }))

  it("should support different encodings", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("cat"),
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
          Command.command("ls"),
          Command.workingDirectory("packages/process/src"),
          Command.lines
        )
      )

      expect(output).toContain("Command")
    }))

  it("should be able to fall back to a different program", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("custom-echo", "-n", "test"),
          Command.string,
          T.catchTag("ProgramNotFound", () =>
            pipe(Command.command("echo", "-n", "test"), Command.string)
          )
        )
      )

      expect(output).toEqual("test")
    }))

  it("should interrupt a process manually", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("sleep", "20"),
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
        Command.command("sleep", "20"),
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

  // TODO: Figure out how to capture stdout and stderr separately - at the
  //       moment the way the stream is run causes only one stream to be
  //       captured if not run in parallel
  it("should capture stderr and stdout separately", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.command("./both-streams-test.sh"),
        Command.workingDirectory("packages/process/test/bash")
      )

      const output = yield* _(
        pipe(
          Command.run(command),
          T.chain((process) =>
            T.zipPar_(
              ProcessStream.string(Process.stdout(process)),
              ProcessStream.string(Process.stderr(process))
            )
          )
        )
      )
      const stdout = output.get(0)
      const stderr = output.get(1)

      expect(stdout).toEqual("stdout1\nstdout2\n")
      expect(stderr).toEqual("stderr1\nstderr2\n")
    }))

  it("should return non-zero exit code in success channel", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(Command.command("ls", "--non-existent-flag"), Command.exitCode)
      )

      expect(output).toEqual(ExitCode.Failure)
    }))

  it("should throw permission denied as a typed error", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.command("./no-permissions.sh"),
        Command.workingDirectory("packages/process/test/bash")
      )

      const output = yield* _(T.result(Command.string(command)))

      expect(Ex.untraced(output)).toEqual(
        Ex.fail(
          new CommandError.PermissionDenied({
            reason: "spawn ./no-permissions.sh EACCES"
          })
        )
      )
    }))

  // it("should merge stderr into stdout when redirectErrorStream is true", () =>
  //   T.gen(function* (_) {
  //     const command = pipe(
  //       Command.command("./both-streams-test.sh"),
  //       Command.workingDirectory("packages/process/test/bash"),
  //       Command.redirectErrorStream(true)
  //     )
  //
  //     const { stderr, stdout } = yield* _(
  //       pipe(
  //         T.do,
  //         T.bind("process", () => Command.run(command)),
  //         T.bind("stdout", ({ process }) =>
  //           ProcessStream.string(Process.stdout(process))
  //         ),
  //         T.bind("stderr", ({ process }) =>
  //           ProcessStream.string(Process.stderr(process))
  //         )
  //       )
  //     )
  //
  //     expect(stderr).toBe("")
  //     expect(stdout).toBe("stdout1\nstderr1\nstdout2\nstderr\n")
  //   }))

  it("should be able to kill a running process", () =>
    T.gen(function* (_) {
      const command = pipe(
        Command.command("./echo-repeat.sh"),
        Command.workingDirectory("packages/process/test/bash")
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
          Command.command("ls"),
          Command.workingDirectory("/some/bad/path"),
          Command.lines,
          T.result
        )
      )

      expect(Ex.untraced(exit)).toEqual(
        Ex.fail(
          new CommandError.WorkingDirectoryMissing({
            workingDirectory: "/some/bad/path"
          })
        )
      )
    }))
})
