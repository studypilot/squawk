import { useState } from "react"
import { createBrowserRouter, Link, useRouteError } from "react-router"
import type { RouteObject } from "react-router"
import { RouterProvider } from "react-router/dom"
import { PlaneMark } from "./assets/plane-mark"
import { EmptyState } from "./components/empty-state"
import { AlertIcon } from "./components/icons"
import { Layout } from "./components/layout"
import { ToastProvider } from "./components/toast"
import { ConnectPage } from "./pages/connect"
import { DevicePage } from "./pages/device"
import { SitePage } from "./pages/site"
import { SitesPage } from "./pages/sites"
import { SquawkPage } from "./pages/squawk"
import { TokensPage } from "./pages/tokens"

function NotFoundPage() {
   return (
      <EmptyState icon={<PlaneMark size={22} />} title="Not found" hint="This page does not exist.">
         <Link to="/" className="button button-secondary">
            Back to the sites
         </Link>
      </EmptyState>
   )
}

function RouteErrorPage() {
   const error = useRouteError()
   return (
      <main className="content">
         <EmptyState
            icon={<AlertIcon size={22} />}
            title="Something went wrong"
            hint={error instanceof Error ? error.message : "An unexpected error occurred."}
         >
            <a href="/" className="button button-secondary">
               Reload the inbox
            </a>
         </EmptyState>
      </main>
   )
}

export const routes: RouteObject[] = [
   // The overlay's sign-in popup: no navigation, and its own redirect to sign in.
   { path: "/connect", element: <ConnectPage />, errorElement: <RouteErrorPage /> },
   {
      path: "/",
      element: <Layout />,
      errorElement: <RouteErrorPage />,
      children: [
         { index: true, element: <SitesPage /> },
         { path: "sites/:key", element: <SitePage /> },
         { path: "squawks/:id", element: <SquawkPage /> },
         { path: "tokens", element: <TokensPage /> },
         { path: "device", element: <DevicePage /> },
         { path: "*", element: <NotFoundPage /> }
      ]
   }
]

export function App() {
   const [router] = useState(() => createBrowserRouter(routes))
   return (
      <ToastProvider>
         <RouterProvider router={router} />
      </ToastProvider>
   )
}
