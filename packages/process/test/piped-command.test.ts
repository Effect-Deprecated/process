import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as Map from "@effect-ts/core/Collections/Immutable/Map"
import * as T from "@effect-ts/core/Effect"
import * as O from "@effect-ts/core/Option"
import * as TE from "@effect-ts/jest/Test"
import { pipe } from "@effect-ts/system/Function"

import * as Command from "../src/Command"
import * as ProcessInput from "../src/ProcessInput"
import * as ProcessOutput from "../src/ProcessOutput"

describe("PipedCommand", () => {
  const { it } = TE.runtime()

  it("should support piping commands together", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("echo", "2\n1\n3"),
          Command.pipeTo(Command.command("cat")),
          Command.pipeTo(Command.command("sort")),
          Command.lines
        )
      )

      expect(C.toArray(output)).toEqual(["1", "2", "3"])
    }))

  it("should ensure that piping is associative", () =>
    T.gen(function* (_) {
      const program = pipe(
        Command.command("echo", "2\n1\n3"),
        Command.pipeTo(Command.command("cat")),
        Command.pipeTo(Command.command("sort")),
        Command.pipeTo(Command.command("head", "-2")),
        Command.lines
      )

      const output = yield* _(
        pipe(
          T.do,
          T.bind("lines1", () => program),
          T.bind("lines2", () => program)
        )
      )

      expect(output.lines1).toEqual(output.lines2)
    }))

  it("should allow stdin on a piped command", () =>
    T.gen(function* (_) {
      const output = yield* _(
        pipe(
          Command.command("cat"),
          Command.pipeTo(Command.command("sort")),
          Command.pipeTo(Command.command("head", "-2")),
          Command.stdin(ProcessInput.fromString("2\n1\n3")),
          Command.lines
        )
      )

      expect(C.toArray(output)).toEqual(["1", "2"])
    }))

  it("should delegate env to all commands", () =>
    T.succeedWith(() => {
      const env = Map.make([["key", "value"]])

      const command = pipe(
        Command.command("cat"),
        Command.pipeTo(Command.command("sort")),
        Command.pipeTo(Command.command("head", "-2")),
        Command.env(env)
      )

      const envs = pipe(
        Command.flatten(command),
        C.map((c) => c.env)
      )

      expect(C.toArray(envs)).toEqual([env, env, env])
    }))

  it("should delegate workingDirectory to all commands", () =>
    T.succeedWith(() => {
      const workingDirectory = "working-directory"

      const command = pipe(
        Command.command("cat"),
        Command.pipeTo(Command.command("sort")),
        Command.pipeTo(Command.command("head", "-2")),
        Command.workingDirectory(workingDirectory)
      )

      const dirs = pipe(
        Command.flatten(command),
        C.map((c) => c.workingDirectory)
      )

      expect(C.toArray(dirs)).toEqual([
        O.some(workingDirectory),
        O.some(workingDirectory),
        O.some(workingDirectory)
      ])
    }))

  it("should delegate stderr to the right-most command", () =>
    T.succeedWith(() => {
      const command = pipe(
        Command.command("cat"),
        Command.pipeTo(Command.command("sort")),
        Command.pipeTo(Command.command("head", "-2")),
        Command.stderr(new ProcessOutput.Inherit())
      )

      const stderrs = pipe(
        Command.flatten(command),
        C.map((c) => c.stderr)
      )

      expect(C.toArray(stderrs)).toEqual([
        new ProcessOutput.Pipe(),
        new ProcessOutput.Pipe(),
        new ProcessOutput.Inherit()
      ])
    }))

  it("should delegate stdout to the right-most command", () =>
    T.succeedWith(() => {
      const command = pipe(
        Command.command("cat"),
        Command.pipeTo(Command.command("sort")),
        Command.pipeTo(Command.command("head", "-2")),
        Command.stdout(new ProcessOutput.Inherit())
      )

      const stdouts = pipe(
        Command.flatten(command),
        C.map((c) => c.stdout)
      )

      expect(C.toArray(stdouts)).toEqual([
        new ProcessOutput.Pipe(),
        new ProcessOutput.Pipe(),
        new ProcessOutput.Inherit()
      ])
    }))

  it("should delegate redirectErrorStream to the right-most command", () =>
    T.succeedWith(() => {
      const command = pipe(
        Command.command("cat"),
        Command.pipeTo(Command.command("sort")),
        Command.pipeTo(Command.command("head", "-2")),
        Command.redirectErrorStream(true)
      )

      const stdouts = pipe(
        Command.flatten(command),
        C.map((c) => c.redirectErrorStream)
      )

      expect(C.toArray(stdouts)).toEqual([false, false, true])
    }))
})
