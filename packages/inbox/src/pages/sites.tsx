import type { Site } from "@squawk/shared"
import { useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { PlaneMark } from "../assets/plane-mark"
import { listSites, updateSiteDisplayName } from "../api/client"
import { useQuery } from "../api/hooks"
import { CopyButton } from "../components/copy-button"
import { EmptyState } from "../components/empty-state"
import { CheckIcon, CloseIcon, CopyIcon, PencilIcon } from "../components/icons"
import { ErrorNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { Skeleton, SkeletonRows } from "../components/skeleton"
import { useToast } from "../components/toast"
import { siteLink } from "../lib/links"

function compareByLastActivity(first: Site, second: Site): number {
   const firstTime = first.lastActivityAt ?? first.createdAt
   const secondTime = second.lastActivityAt ?? second.createdAt
   return secondTime.localeCompare(firstTime)
}

export function SitesPage() {
   const sites = useQuery("sites", listSites)

   function rename(siteKey: string, displayName: string | null) {
      sites.setData(current =>
         current.map(site => (site.key === siteKey ? { ...site, displayName } : site))
      )
   }

   return (
      <>
         <header className="page-header">
            <div>
               <h1 className="page-title">Sites</h1>
               <p className="page-subtitle">One site per branch or preview deployment.</p>
            </div>
         </header>
         {sites.error !== undefined && <ErrorNotice error={sites.error} />}
         {sites.data === undefined && sites.error === undefined && (
            <div className="table-card">
               <SkeletonRows rows={4}>
                  <Skeleton width={140} height={20} radius={6} />
                  <Skeleton width="30%" />
                  <Skeleton width={36} height={20} radius={6} />
                  <Skeleton width={72} />
               </SkeletonRows>
            </div>
         )}
         {sites.data !== undefined && sites.data.length === 0 && <EmptySites />}
         {sites.data !== undefined && sites.data.length > 0 && (
            <SitesTable sites={[...sites.data].sort(compareByLastActivity)} onRenamed={rename} />
         )}
      </>
   )
}

function SitesTable({
   sites,
   onRenamed
}: {
   sites: Site[]
   onRenamed: (siteKey: string, displayName: string | null) => void
}) {
   return (
      <div className="table-card">
         <table className="table sites-table">
            <thead>
               <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Display name</th>
                  <th scope="col" className="numeric">
                     Open
                  </th>
                  <th scope="col" className="numeric">
                     Resolved
                  </th>
                  <th scope="col">Last activity</th>
               </tr>
            </thead>
            <tbody>
               {sites.map(site => (
                  <tr key={site.key}>
                     <td>
                        <Link to={siteLink(site.key)} className="site-key">
                           {site.key}
                        </Link>
                     </td>
                     <td>
                        <DisplayNameEditor site={site} onSaved={onRenamed} />
                     </td>
                     <td className="numeric">
                        <span
                           className={
                              site.openCount === 0 ? "count-chip count-chip-zero" : "count-chip"
                           }
                        >
                           {site.openCount}
                        </span>
                     </td>
                     <td className="numeric text-2">{site.resolvedCount}</td>
                     <td className="text-2">
                        {site.lastActivityAt === null ? (
                           <span className="text-3">No activity</span>
                        ) : (
                           <RelativeTime value={site.lastActivityAt} />
                        )}
                     </td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   )
}

function DisplayNameEditor({
   site,
   onSaved
}: {
   site: Site
   onSaved: (siteKey: string, displayName: string | null) => void
}) {
   const [draft, setDraft] = useState<string | null>(null)
   const [saving, setSaving] = useState(false)
   const [error, setError] = useState<string | null>(null)
   const showToast = useToast()

   async function save(event: FormEvent) {
      event.preventDefault()
      if (draft === null) {
         return
      }
      const displayName = draft.trim() === "" ? null : draft.trim()
      setSaving(true)
      setError(null)
      try {
         await updateSiteDisplayName(site.key, displayName)
         onSaved(site.key, displayName)
         setDraft(null)
         showToast(displayName === null ? "Display name cleared" : "Display name saved")
      } catch (caught) {
         setError(caught instanceof Error ? caught.message : "Saving failed.")
      } finally {
         setSaving(false)
      }
   }

   if (draft === null) {
      return (
         <div className="inline-edit">
            {site.displayName === null ? (
               <span className="text-3">No name</span>
            ) : (
               <span className="inline-edit-value">{site.displayName}</span>
            )}
            <button
               type="button"
               className="icon-button inline-edit-trigger"
               aria-label={`Edit display name of ${site.key}`}
               onClick={() => setDraft(site.displayName ?? "")}
            >
               <PencilIcon size={14} />
            </button>
         </div>
      )
   }

   return (
      <form className="inline-edit" onSubmit={save}>
         <input
            className="input input-small"
            value={draft}
            maxLength={200}
            autoFocus
            placeholder="Display name"
            aria-label={`Display name of ${site.key}`}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
               if (event.key === "Escape") {
                  setDraft(null)
               }
            }}
         />
         <button type="submit" className="icon-button" aria-label="Save" disabled={saving}>
            <CheckIcon size={15} />
         </button>
         <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            onClick={() => setDraft(null)}
         >
            <CloseIcon size={15} />
         </button>
         {error !== null && (
            <span className="error-text" role="alert">
               {error}
            </span>
         )}
      </form>
   )
}

function EmptySites() {
   const snippet = `<script src="${window.location.origin}/squawk.js" data-site="my-branch" defer></script>`
   return (
      <EmptyState
         icon={<PlaneMark size={22} />}
         title="No sites yet"
         hint="Load squawk.js on a preview and file the first squawk."
      >
         <div className="snippet">
            <pre>
               <code>{snippet}</code>
            </pre>
            <CopyButton text={snippet} label="Copy script tag" className="icon-button snippet-copy">
               <CopyIcon size={15} />
            </CopyButton>
         </div>
         <p className="empty-state-footnote">
            <code>data-site</code> groups squawks, for example by branch. Without it the page&apos;s
            hostname is used.
         </p>
      </EmptyState>
   )
}
