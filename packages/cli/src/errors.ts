/** An expected failure: the message goes to stderr, the process exits with `exitCode`. */
export class CliError extends Error {
   readonly exitCode: number = 1
}

/** No server or token is configured, or the server rejected the token. Exits with 2. */
export class NotLoggedInError extends CliError {
   override readonly exitCode: number = 2
}

export const LOGIN_HINT = 'Run "squawk login --server <url>" or set SQUAWK_SERVER and SQUAWK_TOKEN.'
