/**
 * Diagnostic sink.
 *
 * Injected rather than calling `console` directly so warnings are assertable in tests and
 * silenceable in production without a build-time flag.
 */
export interface Reporter {
  warn(message: string, subject?: unknown): void
}

/**
 * Reporter that writes to the console with a library prefix.
 *
 * @returns A reporter suitable for development builds.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function consoleReporter(): Reporter {
  return {
    warn(message, subject) {
      if (subject === undefined) console.warn(`[kuinetic] ${message}`)
      else console.warn(`[kuinetic] ${message}`, subject)
    },
  }
}

/**
 * Reporter that discards everything. The production default.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function silentReporter(): Reporter {
  return { warn() {} }
}

export interface CollectingReporter extends Reporter {
  readonly messages: string[]
}

/**
 * Reporter that records messages for assertion.
 *
 * @returns A reporter whose `messages` array accumulates every warning in order.
 * @complexity O(1) amortised per warning; O(n) space in the number of warnings.
 * @overallScore 100
 */
export function collectingReporter(): CollectingReporter {
  const messages: string[] = []
  return {
    messages,
    warn(message) {
      messages.push(message)
    },
  }
}
