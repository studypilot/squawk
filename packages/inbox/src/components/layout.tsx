import { useState } from "react"
import { Link, NavLink, Outlet } from "react-router"
import { SquawkMark } from "../assets/squawk-mark"
import { ApiError, getMe, loginUrl, logout } from "../api/client"
import { useQuery } from "../api/hooks"
import { applyTheme, readTheme, THEME_OPTIONS } from "../lib/theme"
import type { Theme } from "../lib/theme"
import { authorName } from "./author"
import { Avatar } from "./avatar"
import { Menu } from "./menu"
import { Segmented } from "./segmented"
import { Skeleton } from "./skeleton"

const VERSION = import.meta.env.VITE_SQUAWK_VERSION ?? "dev"
const REPOSITORY_URL = "https://github.com/studypilot/squawk"

export function Layout() {
   const me = useQuery("me", getMe)
   const signedOut = me.error instanceof ApiError && me.error.status === 401

   return (
      <div className="app">
         <header className="top-bar">
            <div className="top-bar-inner">
               <Link to="/" className="brand" aria-label="Squawk home">
                  <SquawkMark size={20} className="brand-mark" />
                  <span className="wordmark">Squawk</span>
               </Link>
               {!signedOut && (
                  <nav className="main-nav" aria-label="Main">
                     <NavLink to="/" end>
                        Sites
                     </NavLink>
                     <NavLink to="/tokens">Tokens</NavLink>
                  </nav>
               )}
               <div className="top-bar-end">
                  {me.data !== undefined && <UserMenu principal={me.data.principal} />}
                  {me.data === undefined && !signedOut && (
                     <span className="user-button" aria-hidden="true">
                        <Skeleton width={24} height={24} radius="50%" />
                        <Skeleton width={88} height={12} />
                     </span>
                  )}
               </div>
            </div>
         </header>
         <main className="content">{signedOut ? <SignedOutCard /> : <Outlet />}</main>
         <footer className="footer">
            <span>Squawk {VERSION}</span>
            <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
               CLI &amp; docs
            </a>
         </footer>
      </div>
   )
}

function UserMenu({ principal }: { principal: Parameters<typeof Avatar>[0]["author"] }) {
   const [theme, setTheme] = useState<Theme>(readTheme)
   const name = authorName(principal)

   function changeTheme(next: Theme) {
      applyTheme(next)
      setTheme(next)
   }

   return (
      <Menu
         triggerClassName="user-button"
         triggerLabel={`Account menu for ${name}`}
         trigger={
            <>
               <Avatar author={principal} size={24} />
               <span className="user-name">{name}</span>
            </>
         }
      >
         <div className="user-menu">
            <div className="user-menu-identity">
               <Avatar author={principal} size={32} />
               <div>
                  <div className="user-menu-name">{name}</div>
                  {principal.kind === "user" && (
                     <div className="user-menu-email">{principal.email}</div>
                  )}
               </div>
            </div>
            <div className="user-menu-section">
               <span className="user-menu-label">Theme</span>
               <Segmented
                  value={theme}
                  options={THEME_OPTIONS}
                  onChange={changeTheme}
                  label="Theme"
                  size="small"
               />
            </div>
            <div className="user-menu-section">
               <button type="button" className="menu-item" onClick={() => void logout()}>
                  Log out
               </button>
            </div>
         </div>
      </Menu>
   )
}

function SignedOutCard() {
   const returnTo = window.location.pathname + window.location.search
   return (
      <section className="auth-card">
         <SquawkMark size={32} className="auth-card-mark" />
         <h1>Squawk</h1>
         <p className="auth-card-tagline">Comments on your preview builds.</p>
         <a className="button button-primary button-large" href={loginUrl(returnTo)}>
            Continue with Google
         </a>
         <p className="auth-card-note">Sign in with your team&apos;s Google account.</p>
      </section>
   )
}
