import type { Site } from "@squawk/shared"
import { useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { listSites, updateSiteDisplayName } from "../api/client"
import { useQuery } from "../api/hooks"
import { ErrorNotice, LoadingNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { siteLink } from "../lib/links"

function compareByLastActivity(first: Site, second: Site): number {
   const firstTime = first.lastActivityAt ?? first.createdAt
   const secondTime = second.lastActivityAt ?? second.createdAt
   return secondTime.localeCompare(firstTime)
}

export function SitesPage() {
   const sites = useQuery("sites", listSites)

   if (sites.error !== undefined) {
      return <ErrorNotice error={sites.error} />
   }
   if (sites.data === undefined) {
      return <LoadingNotice />
   }
   if (sites.data.length === 0) {
      return <EmptySites />
   }

   const sorted = [...sites.data].sort(compareByLastActivity)

   function rename(siteKey: string, displayName: string | null) {
      sites.setData(current =>
         current.map(site => (site.key === siteKey ? { ...site, displayName } : site))
      )
   }

   return (
      <>
         <h1>Sites</h1>
         <div className="table-wrapper">
            <table className="table">
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
                  {sorted.map(site => (
                     <tr key={site.key}>
                        <td>
                           <Link to={siteLink(site.key)} className="mono">
                              {site.key}
                           </Link>
                        </td>
                        <td>
                           <DisplayNameEditor site={site} onSaved={rename} />
                        </td>
                        <td className="numeric">{site.openCount}</td>
                        <td className="numeric">{site.resolvedCount}</td>
                        <td>
                           {site.lastActivityAt === null ? (
                              <span className="muted">No activity</span>
                           ) : (
                              <RelativeTime value={site.lastActivityAt} />
                           )}
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </>
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
               <span className="muted">No name</span>
            ) : (
               <span>{site.displayName}</span>
            )}
            <button
               type="button"
               className="link-button"
               aria-label={`Edit display name of ${site.key}`}
               onClick={() => setDraft(site.displayName ?? "")}
            >
               Edit
            </button>
         </div>
      )
   }

   return (
      <form className="inline-edit" onSubmit={save}>
         <input
            value={draft}
            maxLength={200}
            autoFocus
            aria-label={`Display name of ${site.key}`}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
               if (event.key === "Escape") {
                  setDraft(null)
               }
            }}
         />
         <button type="submit" disabled={saving}>
            Save
         </button>
         <button type="button" className="secondary" onClick={() => setDraft(null)}>
            Cancel
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
      <>
         <h1>Sites</h1>
         <section className="empty-state">
            <h2>No sites yet</h2>
            <p>
               A site appears here as soon as someone leaves the first squawk on it. Add the overlay
               to any page you want feedback on:
            </p>
            <pre className="snippet">
               <code>{snippet}</code>
            </pre>
            <p className="muted">
               <code>data-site</code> groups squawks, for example by branch. Without it the
               page&apos;s hostname is used.
            </p>
         </section>
      </>
   )
}
