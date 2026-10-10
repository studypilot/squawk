import { useState } from "react"

export function TokenSecret({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
   const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")

   async function copy() {
      try {
         await navigator.clipboard.writeText(secret)
         setCopyState("copied")
      } catch {
         setCopyState("failed")
      }
   }

   return (
      <section className="token-secret" aria-labelledby="token-secret-title">
         <h3 id="token-secret-title">Token created</h3>
         <p className="warning">Copy this token now. It will not be shown again.</p>
         <div className="token-secret-row">
            <input
               className="mono"
               readOnly
               value={secret}
               aria-label="New token"
               onFocus={event => event.currentTarget.select()}
            />
            <button type="button" onClick={copy}>
               {copyState === "copied" ? "Copied" : "Copy"}
            </button>
         </div>
         {copyState === "failed" && (
            <p className="muted">Copying failed. Select the token and copy it manually.</p>
         )}
         <button type="button" className="secondary" onClick={onDismiss}>
            Done
         </button>
      </section>
   )
}
