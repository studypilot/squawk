import { CopyButton } from "./copy-button"
import { AlertIcon } from "./icons"

export function TokenSecret({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
   return (
      <section className="token-secret" aria-labelledby="token-secret-title">
         <h3 id="token-secret-title">Token created</h3>
         <div className="token-secret-row">
            <input
               className="input mono token-secret-input"
               readOnly
               value={secret}
               aria-label="New token"
               onFocus={event => event.currentTarget.select()}
            />
            <CopyButton text={secret} label="Copy token" className="button button-primary">
               Copy
            </CopyButton>
         </div>
         <p className="token-secret-warning">
            <AlertIcon size={14} />
            <span>Copy this token now. It will not be shown again.</span>
         </p>
         <button type="button" className="button button-secondary button-small" onClick={onDismiss}>
            Done
         </button>
      </section>
   )
}
