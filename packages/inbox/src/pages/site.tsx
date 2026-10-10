import type { Squawk } from "@squawk/shared"
import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { listSquawks, screenshotPath } from "../api/client"
import type { SquawkStatusFilter } from "../api/client"
import { usePagedQuery } from "../api/hooks"
import { Author } from "../components/author"
import { ErrorNotice, LoadingNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { StatusChip } from "../components/status-chip"
import { firstLine, truncate } from "../lib/format"
import { squawkLink } from "../lib/links"

const STATUS_OPTIONS: ReadonlyArray<{ value: SquawkStatusFilter; label: string }> = [
   { value: "open", label: "Open" },
   { value: "resolved", label: "Resolved" },
   { value: "all", label: "All" }
]

function parseStatus(value: string | null): SquawkStatusFilter {
   return value === "resolved" || value === "all" ? value : "open"
}

export function SitePage() {
   const siteKey = useParams().key ?? ""
   const [searchParams, setSearchParams] = useSearchParams()
   const status = parseStatus(searchParams.get("status"))
   const [page, setPage] = useState("")
   const [search, setSearch] = useState("")

   const squawks = usePagedQuery(`${siteKey}\n${status}`, cursor =>
      listSquawks({ site: siteKey, status, cursor })
   )

   const pages = useMemo(
      () => [...new Set(squawks.items.map(squawk => squawk.page))].sort(),
      [squawks.items]
   )
   const pageOptions = page === "" || pages.includes(page) ? pages : [page, ...pages]
   const normalizedSearch = search.trim().toLowerCase()
   const visible = squawks.items.filter(
      squawk =>
         (page === "" || squawk.page === page) &&
         (normalizedSearch === "" || squawk.body.toLowerCase().includes(normalizedSearch))
   )

   function changeStatus(value: string) {
      const next = new URLSearchParams(searchParams)
      if (value === "open") {
         next.delete("status")
      } else {
         next.set("status", value)
      }
      setSearchParams(next)
   }

   return (
      <>
         <p className="breadcrumb">
            <Link to="/">Sites</Link>
         </p>
         <h1 className="mono">{siteKey}</h1>
         <div className="filters">
            <label>
               Status
               <select value={status} onChange={event => changeStatus(event.target.value)}>
                  {STATUS_OPTIONS.map(option => (
                     <option key={option.value} value={option.value}>
                        {option.label}
                     </option>
                  ))}
               </select>
            </label>
            <label>
               Page
               <select value={page} onChange={event => setPage(event.target.value)}>
                  <option value="">All pages</option>
                  {pageOptions.map(pageKey => (
                     <option key={pageKey} value={pageKey}>
                        {truncate(pageKey, 60)}
                     </option>
                  ))}
               </select>
            </label>
            <label className="grow">
               Search
               <input
                  type="search"
                  value={search}
                  placeholder="Search text"
                  onChange={event => setSearch(event.target.value)}
               />
            </label>
         </div>
         {squawks.items.length > 0 && visible.length === 0 && (
            <p className="notice">No loaded squawks match the filters.</p>
         )}
         {!squawks.loading && squawks.error === undefined && squawks.items.length === 0 && (
            <p className="notice">
               {status === "all" ? "No squawks on this site yet." : `No ${status} squawks.`}
            </p>
         )}
         {visible.length > 0 && (
            <ul className="squawk-list">
               {visible.map(squawk => (
                  <li key={squawk.id}>
                     <SquawkRow squawk={squawk} />
                  </li>
               ))}
            </ul>
         )}
         {squawks.error !== undefined && <ErrorNotice error={squawks.error} />}
         {squawks.loading && <LoadingNotice />}
         {squawks.hasMore && !squawks.loading && (
            <button type="button" className="secondary load-more" onClick={squawks.loadMore}>
               Load more
            </button>
         )}
      </>
   )
}

function SquawkRow({ squawk }: { squawk: Squawk }) {
   return (
      <Link to={squawkLink(squawk.id)} className="squawk-row">
         <span className="squawk-number">#{squawk.number}</span>
         <span className="thumbnail">
            {squawk.screenshot !== null && (
               <img src={screenshotPath(squawk.screenshot.id)} alt="" loading="lazy" />
            )}
         </span>
         <span className="squawk-summary">
            <span className="squawk-body">{truncate(firstLine(squawk.body), 140)}</span>
            <span className="squawk-meta">
               <span className="mono page-key" title={squawk.page}>
                  {squawk.page}
               </span>
               <Author author={squawk.author} />
               <RelativeTime value={squawk.createdAt} />
               <span>
                  {squawk.commentCount} {squawk.commentCount === 1 ? "reply" : "replies"}
               </span>
            </span>
         </span>
         <StatusChip status={squawk.status} />
      </Link>
   )
}
