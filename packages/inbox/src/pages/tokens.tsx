import { createTokenInputSchema, LIMITS } from "@squawk/shared"
import type { Token } from "@squawk/shared"
import { useState } from "react"
import type { FormEvent } from "react"
import { createToken, listTokens, revokeToken } from "../api/client"
import type { CreateTokenInput } from "../api/client"
import { useQuery } from "../api/hooks"
import { Author } from "../components/author"
import { EmptyState } from "../components/empty-state"
import { KeyIcon } from "../components/icons"
import { ErrorNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { Skeleton, SkeletonRows } from "../components/skeleton"
import { useToast } from "../components/toast"
import { TokenSecret } from "../components/token-secret"
import { formatDateTime } from "../lib/format"

export function TokensPage() {
   const tokens = useQuery("tokens", listTokens)

   return (
      <>
         <header className="page-header">
            <div>
               <h1 className="page-title">Tokens</h1>
               <p className="page-subtitle">
                  Overlay and CLI logins create login tokens. Agent tokens are created here or with
                  the CLI and act on behalf of a coding agent.
               </p>
            </div>
         </header>
         <CreateTokenForm onCreated={tokens.reload} />
         <h2 className="section-title">All tokens</h2>
         {tokens.error !== undefined && <ErrorNotice error={tokens.error} />}
         {tokens.data === undefined && tokens.error === undefined && (
            <div className="table-card">
               <SkeletonRows rows={3}>
                  <Skeleton width="20%" height={14} />
                  <Skeleton width={110} height={18} radius={3} />
                  <Skeleton width={44} height={20} radius={6} />
                  <Skeleton width="15%" />
               </SkeletonRows>
            </div>
         )}
         {tokens.data !== undefined && tokens.data.length === 0 && (
            <EmptyState
               icon={<KeyIcon size={22} />}
               title="No tokens yet."
               hint="Login tokens appear after the first overlay or CLI sign-in."
            />
         )}
         {tokens.data !== undefined && tokens.data.length > 0 && (
            <TokenTable tokens={tokens.data} onRevoked={tokens.reload} />
         )}
      </>
   )
}

function TokenTable({ tokens, onRevoked }: { tokens: Token[]; onRevoked: () => void }) {
   return (
      <div className="table-card">
         <table className="table tokens-table">
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
                     <td className="token-name">
                        <span>{token.name}</span>
                     </td>
                     <td>
                        <code className="code">{token.prefix}</code>
                     </td>
                     <td>
                        <span className={`chip chip-${token.kind}`}>{token.kind}</span>
                     </td>
                     <td>
                        {token.siteKey === null ? (
                           <span className="text-3">all sites</span>
                        ) : (
                           <span className="mono">{token.siteKey}</span>
                        )}
                     </td>
                     <td>
                        <Author author={token.createdBy} showAvatar />
                     </td>
                     <td className="text-2">
                        <RelativeTime value={token.createdAt} />
                     </td>
                     <td className="text-2">
                        {token.expiresAt === null ? (
                           <span className="text-3">never</span>
                        ) : (
                           <RelativeTime value={token.expiresAt} />
                        )}
                     </td>
                     <td className="text-2">
                        {token.lastUsedAt === null ? (
                           <span className="text-3">never</span>
                        ) : (
                           <RelativeTime value={token.lastUsedAt} />
                        )}
                     </td>
                     <td className="numeric">
                        {token.revokedAt === null ? (
                           <RevokeButton token={token} onRevoked={onRevoked} />
                        ) : (
                           <span
                              className="text-3"
                              title={`Revoked ${formatDateTime(token.revokedAt)}`}
                           >
                              Revoked
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
   const [confirming, setConfirming] = useState(false)
   const [revoking, setRevoking] = useState(false)
   const showToast = useToast()

   async function revoke() {
      setRevoking(true)
      try {
         await revokeToken(token.id)
         showToast(`Revoked “${token.name}”`)
         onRevoked()
      } catch (caught) {
         showToast(caught instanceof Error ? caught.message : "Revoking failed.")
      } finally {
         setRevoking(false)
         setConfirming(false)
      }
   }

   if (confirming) {
      return (
         <span className="inline-confirm" role="group" aria-label={`Revoke ${token.name}?`}>
            <span className="inline-confirm-question">Revoke?</span>
            <button
               type="button"
               className="button button-danger button-small"
               disabled={revoking}
               onClick={() => void revoke()}
            >
               Yes
            </button>
            <button
               type="button"
               className="button button-ghost button-small"
               disabled={revoking}
               onClick={() => setConfirming(false)}
            >
               No
            </button>
         </span>
      )
   }

   return (
      <button
         type="button"
         className="button button-ghost button-small button-danger-text"
         aria-label={`Revoke ${token.name}`}
         onClick={() => setConfirming(true)}
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
      <section className="card create-token-card">
         <h2 className="card-title">Create agent token</h2>
         <p className="card-hint">
            Give it to a coding agent so it can read, answer and resolve squawks. Scope it to one
            site key when you can.
         </p>
         {secret !== null && <TokenSecret secret={secret} onDismiss={() => setSecret(null)} />}
         <form className="form-grid" onSubmit={submit}>
            <label className="field">
               <span className="field-label">Name</span>
               <input
                  className="input"
                  value={name}
                  required
                  maxLength={LIMITS.tokenNameMaxLength}
                  placeholder="claude on feature-x"
                  onChange={event => setName(event.target.value)}
               />
            </label>
            <label className="field">
               <span className="field-label">
                  Site key <span className="field-optional">optional</span>
               </span>
               <input
                  className="input mono"
                  value={siteKey}
                  maxLength={LIMITS.siteKeyMaxLength}
                  placeholder="all sites"
                  onChange={event => setSiteKey(event.target.value)}
               />
            </label>
            <label className="field">
               <span className="field-label">
                  Expires after days <span className="field-optional">optional</span>
               </span>
               <input
                  className="input"
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
               <button type="submit" className="button button-primary" disabled={creating}>
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
