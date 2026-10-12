import { markdownPreview } from "@squawk/shared"
import type { Site, Squawk } from "@squawk/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { listSites, listSquawks, updateSquawkStatus } from "../api/client"
import type { SquawkStatusFilter } from "../api/client"
import { usePagedQuery, useQuery } from "../api/hooks"
import { Author } from "../components/author"
import { EmptyState } from "../components/empty-state"
import { BubbleIcon, CheckIcon, ChevronDownIcon, InboxIcon, SearchIcon } from "../components/icons"
import { Menu } from "../components/menu"
import { ErrorNotice } from "../components/notice"
import { RelativeTime } from "../components/relative-time"
import { ScreenshotThumbnail } from "../components/screenshot-with-pin"
import { Segmented } from "../components/segmented"
import { Skeleton, SkeletonRows } from "../components/skeleton"
import { StatusChip } from "../components/status-chip"
import { useToast } from "../components/toast"
import { truncate } from "../lib/format"
import { squawkLink } from "../lib/links"

const STATUS_OPTIONS: ReadonlyArray<{ value: SquawkStatusFilter; label: string }> = [
   { value: "open", label: "Open" },
   { value: "resolved", label: "Resolved" },
   { value: "all", label: "All" }
]

function parseStatus(value: string | null): SquawkStatusFilter {
   return value === "resolved" || value === "all" ? value : "open"
}

function isTypingTarget(target: EventTarget | null): boolean {
   if (!(target instanceof HTMLElement)) {
      return false
   }
   return (
      target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
      target.closest("[role='dialog']") !== null
   )
}

export function SitePage() {
   const siteKey = useParams().key ?? ""
   const [searchParams, setSearchParams] = useSearchParams()
   const status = parseStatus(searchParams.get("status"))
   const [page, setPage] = useState("")
   const [search, setSearch] = useState("")
   const [selectedId, setSelectedId] = useState<string | null>(null)
   const searchInput = useRef<HTMLInputElement>(null)
   const navigate = useNavigate()
   const showToast = useToast()

   const sites = useQuery("sites", listSites)
   const site: Site | undefined = sites.data?.find(candidate => candidate.key === siteKey)

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
   const selectedIndex = visible.findIndex(squawk => squawk.id === selectedId)

   function changeStatus(value: SquawkStatusFilter) {
      const next = new URLSearchParams(searchParams)
      if (value === "open") {
         next.delete("status")
      } else {
         next.set("status", value)
      }
      setSearchParams(next)
   }

   const toggleStatus = useCallback(
      async (squawk: Squawk) => {
         const nextStatus = squawk.status === "open" ? "resolved" : "open"
         try {
            await updateSquawkStatus(squawk.id, nextStatus)
            showToast(`${nextStatus === "resolved" ? "Resolved" : "Reopened"} #${squawk.number}`)
            squawks.reload()
            sites.reload()
         } catch (caught) {
            showToast(caught instanceof Error ? caught.message : "Updating the status failed.")
         }
      },
      [showToast, squawks, sites]
   )

   useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
         if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault()
            searchInput.current?.focus()
            searchInput.current?.select()
            return
         }
         if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
            return
         }
         if (event.key === "/") {
            event.preventDefault()
            searchInput.current?.focus()
            return
         }
         if (visible.length === 0) {
            return
         }
         if (event.key === "j" || event.key === "ArrowDown") {
            event.preventDefault()
            const next = visible[Math.min(visible.length - 1, selectedIndex + 1)]
            if (next !== undefined) {
               setSelectedId(next.id)
            }
            return
         }
         if (event.key === "k" || event.key === "ArrowUp") {
            event.preventDefault()
            const next = visible[Math.max(0, selectedIndex === -1 ? 0 : selectedIndex - 1)]
            if (next !== undefined) {
               setSelectedId(next.id)
            }
            return
         }
         const selected = selectedIndex === -1 ? undefined : visible[selectedIndex]
         if (selected === undefined) {
            return
         }
         if (event.key === "Enter") {
            event.preventDefault()
            void navigate(squawkLink(selected.id))
            return
         }
         if (event.key === "r") {
            event.preventDefault()
            void toggleStatus(selected)
         }
      }
      document.addEventListener("keydown", onKeyDown)
      return () => document.removeEventListener("keydown", onKeyDown)
   }, [visible, selectedIndex, navigate, toggleStatus])

   useEffect(() => {
      if (selectedIndex === -1) {
         return
      }
      document
         .querySelector(`[data-squawk-id="${CSS.escape(selectedId ?? "")}"]`)
         ?.scrollIntoView({ block: "nearest" })
   }, [selectedIndex, selectedId])

   const initialLoading = squawks.loading && squawks.items.length === 0
   const emptyFiltered = squawks.items.length > 0 && visible.length === 0
   const emptyList = !squawks.loading && squawks.error === undefined && squawks.items.length === 0

   return (
      <>
         <header className="page-header">
            <div>
               <nav className="breadcrumb" aria-label="Breadcrumb">
                  <Link to="/">Sites</Link>
                  <span className="breadcrumb-separator">/</span>
               </nav>
               <h1 className="page-title page-title-site">
                  <span className="site-key">{siteKey}</span>
                  {site?.displayName != null && (
                     <span className="site-display-name">{site.displayName}</span>
                  )}
               </h1>
            </div>
            {site !== undefined && (
               <div className="site-counts">
                  <span className="count-chip">{site.openCount} open</span>
                  <span className="text-2">{site.resolvedCount} resolved</span>
               </div>
            )}
         </header>

         <div className="toolbar">
            <Segmented
               value={status}
               options={STATUS_OPTIONS}
               onChange={changeStatus}
               label="Status"
            />
            <Menu
               closeSignal={page}
               align="start"
               triggerClassName="button button-secondary page-filter"
               trigger={
                  <>
                     <span className={page === "" ? undefined : "mono"}>
                        {page === "" ? "All pages" : truncate(page, 32)}
                     </span>
                     <ChevronDownIcon size={14} />
                  </>
               }
            >
               <div className="menu-list" role="listbox" aria-label="Page">
                  <button
                     type="button"
                     role="option"
                     aria-selected={page === ""}
                     className="menu-item"
                     onClick={() => setPage("")}
                  >
                     <span>All pages</span>
                     {page === "" && <CheckIcon size={14} />}
                  </button>
                  {pageOptions.map(pageKey => (
                     <button
                        key={pageKey}
                        type="button"
                        role="option"
                        aria-selected={page === pageKey}
                        className="menu-item"
                        title={pageKey}
                        onClick={() => setPage(pageKey)}
                     >
                        <span className="mono">{truncate(pageKey, 48)}</span>
                        {page === pageKey && <CheckIcon size={14} />}
                     </button>
                  ))}
               </div>
            </Menu>
            <label className="search">
               <SearchIcon size={15} className="search-icon" />
               <input
                  ref={searchInput}
                  type="search"
                  className="input search-input"
                  value={search}
                  placeholder="Search squawks"
                  aria-label="Search squawks"
                  onChange={event => setSearch(event.target.value)}
                  onKeyDown={event => {
                     if (event.key === "Escape") {
                        event.currentTarget.blur()
                     }
                  }}
               />
               <kbd className="search-kbd">⌘K</kbd>
            </label>
         </div>

         {initialLoading && (
            <div className="squawk-list">
               <SkeletonRows rows={5}>
                  <Skeleton width={56} height={56} radius={6} />
                  <span className="skeleton-stack">
                     <Skeleton width="55%" height={14} />
                     <Skeleton width="35%" />
                  </span>
                  <Skeleton width={56} height={20} radius={6} />
               </SkeletonRows>
            </div>
         )}
         {emptyFiltered && (
            <EmptyState
               icon={<SearchIcon size={22} />}
               title="Nothing matches"
               hint="No loaded squawks match the page or search filter."
            />
         )}
         {emptyList && (
            <EmptyState
               icon={status === "resolved" ? <CheckIcon size={22} /> : <InboxIcon size={22} />}
               title={
                  status === "all"
                     ? "No squawks on this site yet"
                     : status === "open"
                       ? "No open squawks"
                       : "Nothing resolved yet"
               }
               hint={
                  status === "open"
                     ? "All clear. New squawks from the overlay land here."
                     : status === "resolved"
                       ? "Resolved squawks move here."
                       : "The first squawk filed on this site opens it here."
               }
            />
         )}
         {visible.length > 0 && (
            <>
               <ul className="squawk-list">
                  {visible.map(squawk => (
                     <li key={squawk.id} data-squawk-id={squawk.id}>
                        <SquawkRow
                           squawk={squawk}
                           selected={squawk.id === selectedId}
                           showPage={page === ""}
                           onSelect={() => setSelectedId(squawk.id)}
                        />
                     </li>
                  ))}
               </ul>
               <p className="keyboard-hints" aria-hidden="true">
                  <kbd>j</kbd>
                  <kbd>k</kbd> move
                  <kbd>↵</kbd> open
                  <kbd>r</kbd> resolve / reopen
                  <kbd>/</kbd> search
               </p>
            </>
         )}
         {squawks.error !== undefined && <ErrorNotice error={squawks.error} />}
         {squawks.loading && !initialLoading && (
            <p className="notice" role="status">
               Loading…
            </p>
         )}
         {squawks.hasMore && !squawks.loading && (
            <button
               type="button"
               className="button button-secondary load-more"
               onClick={squawks.loadMore}
            >
               Load more
            </button>
         )}
      </>
   )
}

function SquawkRow({
   squawk,
   selected,
   showPage,
   onSelect
}: {
   squawk: Squawk
   selected: boolean
   showPage: boolean
   onSelect: () => void
}) {
   return (
      <Link
         to={squawkLink(squawk.id)}
         className={selected ? "squawk-row squawk-row-selected" : "squawk-row"}
         aria-current={selected ? "true" : undefined}
         onMouseEnter={onSelect}
         onFocus={onSelect}
      >
         <ScreenshotThumbnail screenshot={squawk.screenshot} anchor={squawk.anchor} />
         <span className="squawk-summary">
            <span className="squawk-body">{truncate(markdownPreview(squawk.body), 140)}</span>
            <span className="squawk-meta">
               <Author author={squawk.author} showAvatar />
               <span className="squawk-meta-dot">·</span>
               <RelativeTime value={squawk.createdAt} />
               {showPage && (
                  <span className="squawk-meta-page">
                     <span className="squawk-meta-dot">·</span>
                     <span className="mono page-key" title={squawk.page}>
                        {squawk.page}
                     </span>
                  </span>
               )}
               {squawk.commentCount > 0 && (
                  <>
                     <span className="squawk-meta-dot">·</span>
                     <span className="squawk-replies">
                        <BubbleIcon size={13} />
                        {squawk.commentCount}
                     </span>
                  </>
               )}
            </span>
         </span>
         <StatusChip status={squawk.status} />
         <span className="squawk-number">#{squawk.number}</span>
      </Link>
   )
}
