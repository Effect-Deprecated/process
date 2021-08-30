import type { Chunk } from "@effect-ts/core/Collections/Immutable/Chunk"
import type { IO as Stream } from "@effect-ts/core/Effect/Stream"
import * as S from "@effect-ts/core/Effect/Stream"
import type { Option } from "@effect-ts/core/Option"
import * as O from "@effect-ts/core/Option"
import type { Byte } from "@effect-ts/node/Byte"
import { buffer, chunk } from "@effect-ts/node/Byte"
import { streamFromReadable } from "@effect-ts/node/Stream"
import { Readable } from "stream"

import type { CommandError } from "../CommandError"
import { IOError } from "../CommandError"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Configures the pipe that is established between the parent and child
 * processes' `stdin` stream.
 */
export class ProcessInput {
  constructor(readonly source: Option<Stream<CommandError, Byte>>) {}
}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Pass through the `stdin` stream to/from the parent process.
 */
export const inherit: ProcessInput = new ProcessInput(O.none)

/**
 * Returns a `ProcessInput` from an array of `Byte`s.
 */
export function fromByteArray(bytes: Chunk<Byte>): ProcessInput {
  return new ProcessInput(
    O.some(
      S.mapError_(
        streamFromReadable(() => Readable.from(buffer(bytes))),
        (readableError) => new IOError({ reason: readableError.error.message })
      )
    )
  )
}

/**
 * Returns a `ProcessInput` from a stream of `Byte`s.
 */
export function fromStream(stream: Stream<CommandError, Byte>): ProcessInput {
  return new ProcessInput(O.some(stream))
}

/**
 * Returns a `ProcessInput` from a string with the given `BufferEncoding`.
 */
export function fromString(text: string, encoding: BufferEncoding): ProcessInput {
  return new ProcessInput(O.some(S.fromChunk(chunk(Buffer.from(text, encoding)))))
}

/**
 * Returns a `ProcessInput` from a UTF-8 string.
 */
export function fromUTF8String(text: string): ProcessInput {
  return new ProcessInput(O.some(S.fromChunk(chunk(Buffer.from(text, "utf-8")))))
}
