import { useState } from "react"
import { useSearchParams } from "react-router"
import { ApiError, decideDevice, getDeviceInfo } from "../api/client"
import type { DeviceInfo } from "../api/client"
import { useQuery } from "../api/hooks"
import { ErrorNotice, LoadingNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { formatUserCode, isCompleteUserCode } from "../lib/format"

type Decision = "approve" | "deny"

const UNKNOWN_CODE_MESSAGE =
   "This code is unknown or has expired. Start the login again in the overlay or the CLI."

function isUnknownCode(error: Error): boolean {
   return error instanceof ApiError && (error.status === 404 || error.status === 410)
}

export function DevicePage() {
   const [searchParams] = useSearchParams()
   const [code, setCode] = useState(() => formatUserCode(searchParams.get("code") ?? ""))
   const [decided, setDecided] = useState<Decision | null>(null)
   const complete = isCompleteUserCode(code)
   const info = useQuery(complete ? `device:${code}` : null, () => getDeviceInfo(code))

   if (decided !== null) {
      return (
         <section className="card device-card">
            <h1>{decided === "approve" ? "Login approved" : "Login denied"}</h1>
            <p>You can close this tab.</p>
         </section>
      )
   }

   return (
      <section className="card device-card">
         <h1>Approve a device</h1>
         <p className="muted">
            Enter the code shown in the overlay or the CLI to let it act on your behalf.
         </p>
         <label className="device-code-label">
            Code
            <input
               className="mono device-code-input"
               value={code}
               autoComplete="off"
               spellCheck={false}
               placeholder="WXYZ-1234"
               onChange={event => setCode(formatUserCode(event.target.value))}
            />
         </label>
         {complete && info.loading && <LoadingNotice />}
         {info.error !== undefined &&
            (isUnknownCode(info.error) ? (
               <p className="notice notice-error" role="alert">
                  {UNKNOWN_CODE_MESSAGE}
               </p>
            ) : (
               <ErrorNotice error={info.error} />
            ))}
         {info.data !== undefined && <DeviceDecision info={info.data} onDecided={setDecided} />}
      </section>
   )
}

function DeviceDecision({
   info,
   onDecided
}: {
   info: DeviceInfo
   onDecided: (decision: Decision) => void
}) {
   const [pending, setPending] = useState(false)
   const [error, setError] = useState<string | null>(null)
   const expired = new Date(info.expiresAt).getTime() <= Date.now()

   async function decide(decision: Decision) {
      setPending(true)
      setError(null)
      try {
         await decideDevice(info.userCode, decision)
         onDecided(decision)
      } catch (caught) {
         if (caught instanceof Error && isUnknownCode(caught)) {
            setError(UNKNOWN_CODE_MESSAGE)
         } else {
            setError(caught instanceof Error ? caught.message : "The request failed.")
         }
      } finally {
         setPending(false)
      }
   }

   if (expired) {
      return (
         <p className="notice notice-error" role="alert">
            {UNKNOWN_CODE_MESSAGE}
         </p>
      )
   }

   return (
      <div className="device-decision">
         <p>
            <strong>{info.kind === "overlay" ? "Overlay" : "CLI"}</strong> on{" "}
            <span className="mono">{info.label}</span>
         </p>
         <p className="muted">
            Code expires <RelativeTime value={info.expiresAt} />.
         </p>
         <div className="button-row">
            <button type="button" disabled={pending} onClick={() => void decide("approve")}>
               Approve
            </button>
            <button
               type="button"
               className="secondary"
               disabled={pending}
               onClick={() => void decide("deny")}
            >
               Deny
            </button>
         </div>
         {error !== null && (
            <p className="error-text" role="alert">
               {error}
            </p>
         )}
      </div>
   )
}
