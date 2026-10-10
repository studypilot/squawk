import { Link, NavLink, Outlet } from "react-router"
import { getMe, logout } from "../api/client"
import { useQuery } from "../api/hooks"
import { Author } from "./author"

const VERSION = import.meta.env.VITE_SQUAWK_VERSION ?? "dev"

export function Layout() {
   const me = useQuery("me", getMe)

   return (
      <div className="app">
         <header className="top-bar">
            <div className="top-bar-inner">
               <Link to="/" className="wordmark">
                  Squawk
               </Link>
               <nav className="main-nav" aria-label="Main">
                  <NavLink to="/" end>
                     Sites
                  </NavLink>
                  <NavLink to="/tokens">Tokens</NavLink>
               </nav>
               <div className="current-user">
                  {me.data !== undefined && <Author author={me.data.principal} showAvatar />}
                  <button type="button" className="link-button" onClick={() => void logout()}>
                     Log out
                  </button>
               </div>
            </div>
         </header>
         <main className="content">
            <Outlet />
         </main>
         <footer className="footer">Squawk {VERSION}</footer>
      </div>
   )
}
