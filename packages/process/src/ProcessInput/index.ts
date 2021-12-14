// ets_tracing: off

import type { Chunk } from "@effect-ts/core/Collections/Immutable/Chunk"
import * as S from "@effect-ts/core/Effect/Experimental/Stream"
import * as O from "@effect-ts/core/Option"
import * as Byte from "@effect-ts/node/Byte"
import * as stream from "stream"

import * as CE from "../CommandError"
import * as NS from "../Internal/NodeStream"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Configures the pipe that is established between the parent and child
 * processes' `stdin` stream.
 */
export class ProcessInput {
  constructor(readonly source: O.Option<S.IO<CE.CommandError, Byte.Byte>>) {}
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
export function fromByteArray(bytes: Chunk<Byte.Byte>): ProcessInput {
  return new ProcessInput(
    O.some(
      S.mapError_(
        NS.streamFromReadable(() => stream.Readable.from(Byte.buffer(bytes))),
        (e) => CE.fromError(e.error)
      )
    )
  )
}

/**
 * Returns a `ProcessInput` from a stream of `Byte`s.
 */
export function fromStream(stream: S.IO<CE.CommandError, Byte.Byte>): ProcessInput {
  return new ProcessInput(O.some(stream))
}

/**
 * Returns a `ProcessInput` from a string with the specified encoding. If not
 * specified, the encoding will default to `"utf-8"`.
 */
export function fromString(
  text: string,
  encoding: BufferEncoding = "utf-8"
): ProcessInput {
  return new ProcessInput(O.some(S.fromChunk(Byte.chunk(Buffer.from(text, encoding)))))
}
