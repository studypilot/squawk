import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useSearchParams } from "react-router"
import { CONNECT_MESSAGE_TYPE, isWebOrigin, LOGIN_TOKEN_TTL_DAYS } from "@squawk/shared"
import type { ConnectMessage, UserAuthor } from "@squawk/shared"
import { SquawkMark } from "../assets/squawk-mark"
import { ApiError, connectOrigin, getConnectInfo, getMe } from "../api/client"
import { authorName } from "../components/author"
import { Avatar } from "../components/avatar"
import { AlertIcon, CheckIcon } from "../components/icons"
import { LoadingNotice } from "../components/notice"

/** Indirection over the popup's own window so tests can supply an opener and observe closing. */
export const connectWindow = {
   opener(): Window | null {
      return (window.opener as Window | null) ?? null
   },
   close(): void {
      window.close()
   }
}

type ConnectState =
   | { step: "loading" }
   | { step: "consent"; user: UserAuthor }
   | { step: "connecting"; user: UserAuthor | null }
   | { step: "done" }
   | { step: "error"; message: string }

/**
 * `/connect?origin=…`, opened by the overlay as a popup. Uses the browser session to issue a
 * login token for the overlay's page origin, after asking unless the origin is trusted, and
 * posts it to the opener with that origin as the target, so no other page can receive it.
 */
export function ConnectPage() {
   const [searchParams] = useSearchParams()
   const origin = searchParams.get("origin") ?? ""
   const [opener] = useState(() => connectWindow.opener())

   if (!isWebOrigin(origin)) {
      return (
         <ConnectFrame>
            <ConnectError message="This sign-in link is broken: it does not name the site that asked to sign in." />
         </ConnectFrame>
      )
   }
   if (opener === null) {
      return (
         <ConnectFrame>
            <section className="card device-card device-card-done">
               <p className="text-2">Open this page from the Squawk overlay.</p>
            </section>
         </ConnectFrame>
      )
   }
   return (
      <ConnectFrame>
         <ConnectFlow origin={origin} opener={opener} />
      </ConnectFrame>
   )
}

function ConnectFlow({ origin, opener }: { origin: string; opener: Window }) {
   const [state, setState] = useState<ConnectState>({ step: "loading" })
   const started = useRef(false)

   function post(message: ConnectMessage): void {
      opener.postMessage(message, origin)
   }

   async function connect(user: UserAuthor | null): Promise<void> {
      if (opener.closed) {
         setState({ step: "error", message: "The page that asked to sign in was closed." })
         return
      }
      setState({ step: "connecting", user })
      try {
         const label = `Overlay on ${new URL(origin).hostname}`
         const { token } = await connectOrigin(origin, label)
         post({ type: CONNECT_MESSAGE_TYPE, status: "ok", token })
         setState({ step: "done" })
         connectWindow.close()
      } catch (error) {
         setState({ step: "error", message: describe(error) })
      }
   }

   function cancel(): void {
      post({ type: CONNECT_MESSAGE_TYPE, status: "cancelled" })
      connectWindow.close()
   }

   useEffect(() => {
      // Runs once even under StrictMode's double effects, so at most one token is issued.
      if (started.current) return
      started.current = true
      void (async () => {
         try {
            const me = await getMe()
            const info = await getConnectInfo(origin)
            if (me.principal.kind !== "user") {
               setState({ step: "error", message: "Sign in to Squawk in this browser first." })
               return
            }
            if (info.trusted) {
               await connect(me.principal)
               return
            }
            setState({ step: "consent", user: me.principal })
         } catch (error) {
            // A 401 already sent the browser to the sign-in page, which returns here.
            if (error instanceof ApiError && error.status === 401) return
            setState({ step: "error", message: describe(error) })
         }
      })()
      // Bound to the origin of the first render on purpose; the popup never changes it.
   }, [])

   switch (state.step) {
      case "loading":
         return (
            <section className="card device-card">
               <SquawkMark size={28} className="device-mark" />
               <LoadingNotice label="Checking your session" />
            </section>
         )
      case "consent":
      case "connecting":
         if (state.user === null) {
            return (
               <section className="card device-card">
                  <SquawkMark size={28} className="device-mark" />
                  <LoadingNotice label="Signing in" />
               </section>
            )
         }
         return (
            <ConsentCard
               origin={origin}
               user={state.user}
               pending={state.step === "connecting"}
               onAllow={() => void connect(state.user)}
               onCancel={cancel}
            />
         )
      case "done":
         return (
            <section className="card device-card device-card-done">
               <span className="device-result device-result-ok">
                  <CheckIcon size={22} />
               </span>
               <h1 className="device-title">Signed in</h1>
               <p className="text-2">You can close this window.</p>
            </section>
         )
      case "error":
         return <ConnectError message={state.message} />
   }
}

function ConsentCard({
   origin,
   user,
   pending,
   onAllow,
   onCancel
}: {
   origin: string
   user: UserAuthor
   pending: boolean
   onAllow: () => void
   onCancel: () => void
}) {
   const name = authorName(user)
   return (
      <section className="card device-card" aria-labelledby="connect-title">
         <SquawkMark size={28} className="device-mark" />
         <h1 className="device-title" id="connect-title">
            Connect this site
         </h1>
         <p className="text-2 device-intro">
            Allow <span className="mono connect-origin">{origin}</span> to file squawks as {name}?
         </p>
         <div className="device-decision">
            <div className="device-requester">
               <Avatar author={user} size={32} />
               <span className="device-requester-text">
                  <span>{name}</span>
                  <span className="text-3">{user.email}</span>
               </span>
            </div>
            <div className="button-row">
               <button
                  type="button"
                  className="button button-primary button-large"
                  disabled={pending}
                  onClick={onAllow}
               >
                  Allow
               </button>
               <button
                  type="button"
                  className="button button-secondary button-large"
                  disabled={pending}
                  onClick={onCancel}
               >
                  Cancel
               </button>
            </div>
            <p className="text-3 connect-note">
               The site gets a sign-in token for {LOGIN_TOKEN_TTL_DAYS} days. You can revoke it on
               the Tokens page.
            </p>
         </div>
      </section>
   )
}

function ConnectError({ message }: { message: string }) {
   return (
      <section className="card device-card device-card-done">
         <span className="device-result">
            <AlertIcon size={22} />
         </span>
         <h1 className="device-title">Cannot connect</h1>
         <p className="text-2" role="alert">
            {message}
         </p>
      </section>
   )
}

function ConnectFrame({ children }: { children: ReactNode }) {
   return <main className="connect-page">{children}</main>
}

function describe(error: unknown): string {
   return error instanceof Error ? error.message : "The request failed."
}
