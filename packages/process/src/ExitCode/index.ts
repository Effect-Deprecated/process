// ets_tracing: off

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/**
 * Represents the returned exit code after a process has completed.
 */
export class ExitCode {
  constructor(readonly code: number) {}
}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Represents a `Command` that exited successfully with an exit code of `0`.
 */
export const Success: ExitCode = new ExitCode(0)

/**
 * Represents a `Command` that exited unsuccessfully with an exit code of `1`.
 */
export const Failure: ExitCode = new ExitCode(1)
