import { useState } from "react"
import { useSearchParams } from "react-router"
import { PlaneMark } from "../assets/plane-mark"
import { ApiError, decideDevice, getDeviceInfo } from "../api/client"
import type { DeviceInfo } from "../api/client"
import { useQuery } from "../api/hooks"
import { CheckIcon, CloseIcon, TerminalIcon } from "../components/icons"
import { ErrorNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { Skeleton } from "../components/skeleton"
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
      const approved = decided === "approve"
      return (
         <section className="card device-card device-card-done">
            <span className={approved ? "device-result device-result-ok" : "device-result"}>
               {approved ? <CheckIcon size={22} /> : <CloseIcon size={22} />}
            </span>
            <h1 className="device-title">{approved ? "Device approved" : "Login denied"}</h1>
            <p className="text-2">
               {approved
                  ? "The overlay or CLI is signed in as you."
                  : "Nothing was granted. The code is no longer valid."}
            </p>
            <p className="text-2">You can close this tab.</p>
         </section>
      )
   }

   return (
      <section className="card device-card">
         <PlaneMark size={28} className="device-mark" />
         <h1 className="device-title">Approve a device</h1>
         <p className="text-2 device-intro">
            Enter the code shown in the overlay or the CLI to let it act on your behalf.
         </p>
         <label className="field device-code-field">
            <span className="field-label">Code</span>
            <input
               className="input mono device-code-input"
               value={code}
               autoComplete="off"
               spellCheck={false}
               placeholder="WXYZ-1234"
               onChange={event => setCode(formatUserCode(event.target.value))}
            />
         </label>
         {complete && info.loading && info.data === undefined && (
            <div className="device-requester" role="status" aria-label="Loading">
               <Skeleton width={32} height={32} radius={8} />
               <span className="skeleton-stack">
                  <Skeleton width={160} height={13} />
                  <Skeleton width={100} />
               </span>
            </div>
         )}
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
         <div className="device-requester">
            <span className="device-requester-icon">
               {info.kind === "overlay" ? <PlaneMark size={16} /> : <TerminalIcon size={16} />}
            </span>
            <span className="device-requester-text">
               <span>
                  {info.kind === "overlay" ? "Overlay" : "CLI"} on{" "}
                  <span className="mono">{info.label}</span>
               </span>
               <span className="text-3">
                  Code expires <RelativeTime value={info.expiresAt} />
               </span>
            </span>
         </div>
         <div className="button-row">
            <button
               type="button"
               className="button button-primary button-large"
               disabled={pending}
               onClick={() => void decide("approve")}
            >
               Approve
            </button>
            <button
               type="button"
               className="button button-secondary button-large"
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
