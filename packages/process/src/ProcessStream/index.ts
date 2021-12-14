// ets_tracing: off

import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Experimental/Stream"
import { pipe } from "@effect-ts/core/Function"
import * as Byte from "@effect-ts/node/Byte"
import type * as stream from "stream"

import * as CE from "../CommandError"
import * as NS from "../Internal/NodeStream"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

export type ProcessStream = S.IO<CE.CommandError, Byte.Byte>

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Create a chunked `Stream` of `Byte`s from a NodeJS `ReadableStream`.
 */
export function fromReadableStream(
  readable: () => stream.Readable
): S.IO<CE.CommandError, Byte.Byte> {
  return S.mapError_(NS.streamFromReadable(readable), (e) => CE.fromError(e.error))
}

// -----------------------------------------------------------------------------
// Executors
// -----------------------------------------------------------------------------

/**
 * Return the entire output of this process as a string with the specified
 * `BufferEncoding`.
 */
export function stringWithEncoding_(
  self: ProcessStream,
  encoding: BufferEncoding
): T.IO<CE.CommandError, string> {
  return T.map_(NS.runBuffer(self), (buffer) => buffer.toString(encoding))
}

/**
 * Return the entire output of this process as a string with the specified
 * `BufferEncoding`
 *
 * @ets_data_first stringWithEncoding_
 */
export function stringWithEncoding(encoding: BufferEncoding) {
  return (self: ProcessStream): T.IO<CE.CommandError, string> =>
    stringWithEncoding_(self, encoding)
}

/**
 * Return the entire output of this process as a string with the default
 * `BufferEncoding` of `"utf8"`.
 */
export function string(processStream: ProcessStream): T.IO<CE.CommandError, string> {
  return stringWithEncoding_(processStream, "utf8")
}

/**
 * Return the output of this `Process` as a `Chunk` of lines with the default
 * `BufferEncoding` of `"utf8"`.
 */
export function lines(self: ProcessStream): T.IO<CE.CommandError, C.Chunk<string>> {
  return T.map_(S.runCollect(linesStream(self)), C.from)
}

/**
 * Return the output of this `Process` as a `Stream` of lines with the default
 * `BufferEncoding` of `"utf8"`.
 */
export function linesStream(self: ProcessStream): S.IO<CE.CommandError, string> {
  return pipe(
    self,
    S.mapChunks((c) => C.single(Byte.buffer(c).toString("utf-8"))),
    S.splitLines
  )
}
