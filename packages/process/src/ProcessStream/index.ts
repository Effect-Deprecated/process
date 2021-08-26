import type { Chunk } from "@effect-ts/core/Collections/Immutable/Chunk"
import * as C from "@effect-ts/core/Collections/Immutable/Chunk"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Stream"
import type { Lazy } from "@effect-ts/core/Function"
import type { Byte } from "@effect-ts/node/Byte"
import * as NS from "@effect-ts/node/Stream"
import type { Readable as NodeJSReadableStream } from "stream"

import * as CE from "../CommandError"
import { splitLines, utf8Decode } from "../Internal/Transducer"

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents the output of a process as a NodeJS `Readable` stream.
 */
export class ProcessStream {
  constructor(readonly stream: Lazy<NodeJSReadableStream>) {}
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
  return T.map_(NS.runBuffer(stream(self)), (buffer) => buffer.toString(encoding))
}

/**
 * Return the entire output of this process as a string with the specified
 * `BufferEncoding`
 *
 * @dataFirst string_
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
export function lines(self: ProcessStream): T.IO<CE.CommandError, Chunk<string>> {
  return T.map_(S.runCollect(linesStream(self)), C.from)
}

/**
 * Return the output of this `Process` as a `Stream` of lines with the default
 * `BufferEncoding` of `"utf8"`.
 */
export function linesStream(self: ProcessStream): S.IO<CE.CommandError, string> {
  return S.aggregate_(S.aggregate_(stream(self), utf8Decode), splitLines)
}

/**
 * Return the output of this `Process` as a chunked `Stream` of `Byte`s.
 */
export function stream(self: ProcessStream): S.IO<CE.CommandError, Byte> {
  return S.mapError_(
    NS.streamFromReadable(self.stream),
    (readableError) => new CE.IOError({ reason: readableError.error.message })
  )
}
