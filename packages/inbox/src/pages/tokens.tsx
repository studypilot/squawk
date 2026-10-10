import { createTokenInputSchema, LIMITS } from "@squawk/shared"
import type { Token } from "@squawk/shared"
import { useState } from "react"
import type { FormEvent } from "react"
import { createToken, listTokens, revokeToken } from "../api/client"
import type { CreateTokenInput } from "../api/client"
import { useQuery } from "../api/hooks"
import { Author } from "../components/author"
import { ErrorNotice, LoadingNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { TokenSecret } from "../components/token-secret"

export function TokensPage() {
   const tokens = useQuery("tokens", listTokens)

   return (
      <>
         <h1>Tokens</h1>
         <p className="muted">
            Overlay and CLI logins create login tokens. Agent tokens are created here or with the
            CLI and act on behalf of a coding agent.
         </p>
         <CreateTokenForm onCreated={tokens.reload} />
         <h2>All tokens</h2>
         {tokens.error !== undefined && <ErrorNotice error={tokens.error} />}
         {tokens.data === undefined && tokens.error === undefined && <LoadingNotice />}
         {tokens.data !== undefined && tokens.data.length === 0 && (
            <p className="notice">No tokens yet.</p>
         )}
         {tokens.data !== undefined && tokens.data.length > 0 && (
            <TokenTable tokens={tokens.data} onRevoked={tokens.reload} />
         )}
      </>
   )
}

function TokenTable({ tokens, onRevoked }: { tokens: Token[]; onRevoked: () => void }) {
   return (
      <div className="table-wrapper">
         <table className="table">
            <thead>
               <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Site</th>
                  <th scope="col">Created by</th>
                  <th scope="col">Created</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                     <span className="visually-hidden">Actions</span>
                  </th>
               </tr>
            </thead>
            <tbody>
               {tokens.map(token => (
                  <tr key={token.id} className={token.revokedAt === null ? undefined : "revoked"}>
                     <td>{token.name}</td>
                     <td className="mono">{token.prefix}</td>
                     <td>
                        <span className={`badge badge-${token.kind}`}>{token.kind}</span>
                     </td>
                     <td>
                        {token.siteKey === null ? (
                           <span className="muted">all sites</span>
                        ) : (
                           <span className="mono">{token.siteKey}</span>
                        )}
                     </td>
                     <td>
                        <Author author={token.createdBy} />
                     </td>
                     <td>
                        <RelativeTime value={token.createdAt} />
                     </td>
                     <td>
                        {token.expiresAt === null ? (
                           <span className="muted">never</span>
                        ) : (
                           <RelativeTime value={token.expiresAt} />
                        )}
                     </td>
                     <td>
                        {token.lastUsedAt === null ? (
                           <span className="muted">never</span>
                        ) : (
                           <RelativeTime value={token.lastUsedAt} />
                        )}
                     </td>
                     <td>
                        {token.revokedAt === null ? (
                           <RevokeButton token={token} onRevoked={onRevoked} />
                        ) : (
                           <span className="muted">
                              Revoked <RelativeTime value={token.revokedAt} />
                           </span>
                        )}
                     </td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   )
}

function RevokeButton({ token, onRevoked }: { token: Token; onRevoked: () => void }) {
   const [revoking, setRevoking] = useState(false)

   async function revoke() {
      const confirmed = window.confirm(
         `Revoke the token "${token.name}"? Anything using it loses access immediately.`
      )
      if (!confirmed) {
         return
      }
      setRevoking(true)
      try {
         await revokeToken(token.id)
         onRevoked()
      } catch (caught) {
         window.alert(caught instanceof Error ? caught.message : "Revoking failed.")
      } finally {
         setRevoking(false)
      }
   }

   return (
      <button
         type="button"
         className="danger"
         disabled={revoking}
         aria-label={`Revoke ${token.name}`}
         onClick={revoke}
      >
         Revoke
      </button>
   )
}

function CreateTokenForm({ onCreated }: { onCreated: () => void }) {
   const [name, setName] = useState("")
   const [siteKey, setSiteKey] = useState("")
   const [expiresInDays, setExpiresInDays] = useState("")
   const [error, setError] = useState<string | null>(null)
   const [creating, setCreating] = useState(false)
   const [secret, setSecret] = useState<string | null>(null)

   async function submit(event: FormEvent) {
      event.preventDefault()
      const parsed = createTokenInputSchema.safeParse({
         name: name.trim(),
         siteKey: siteKey.trim() === "" ? null : siteKey.trim(),
         expiresInDays: expiresInDays.trim() === "" ? null : Number(expiresInDays)
      })
      if (!parsed.success) {
         setError(parsed.error.issues[0]?.message ?? "Check the form.")
         return
      }
      await create(parsed.data)
   }

   async function create(input: CreateTokenInput) {
      setCreating(true)
      setError(null)
      try {
         const response = await createToken(input)
         setSecret(response.secret)
         setName("")
         setSiteKey("")
         setExpiresInDays("")
         onCreated()
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : "Creating the token failed.")
      } finally {
         setCreating(false)
      }
   }

   return (
      <section className="card">
         <h2>Create agent token</h2>
         {secret !== null && <TokenSecret secret={secret} onDismiss={() => setSecret(null)} />}
         <form className="form-grid" onSubmit={submit}>
            <label>
               Name
               <input
                  value={name}
                  required
                  maxLength={LIMITS.tokenNameMaxLength}
                  placeholder="claude on feature-x"
                  onChange={event => setName(event.target.value)}
               />
            </label>
            <label>
               Site key <span className="muted">(optional)</span>
               <input
                  value={siteKey}
                  maxLength={LIMITS.siteKeyMaxLength}
                  placeholder="all sites"
                  onChange={event => setSiteKey(event.target.value)}
               />
            </label>
            <label>
               Expires after days <span className="muted">(optional)</span>
               <input
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={expiresInDays}
                  placeholder="never"
                  onChange={event => setExpiresInDays(event.target.value)}
               />
            </label>
            <div className="form-actions">
               <button type="submit" disabled={creating}>
                  Create token
               </button>
            </div>
            {error !== null && (
               <p className="error-text" role="alert">
                  {error}
               </p>
            )}
         </form>
      </section>
   )
}
