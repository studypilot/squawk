import { useState } from "react"
import { createBrowserRouter, Link, useRouteError } from "react-router"
import type { RouteObject } from "react-router"
import { RouterProvider } from "react-router/dom"
import { Layout } from "./components/layout"
import { DevicePage } from "./pages/device"
import { SitePage } from "./pages/site"
import { SitesPage } from "./pages/sites"
import { SquawkPage } from "./pages/squawk"
import { TokensPage } from "./pages/tokens"

function NotFoundPage() {
   return (
      <>
         <h1>Not found</h1>
         <p>
            This page does not exist. <Link to="/">Back to the sites</Link>
         </p>
      </>
   )
}

function RouteErrorPage() {
   const error = useRouteError()
   return (
      <main className="content">
         <h1>Something went wrong</h1>
         <p className="notice notice-error" role="alert">
            {error instanceof Error ? error.message : "An unexpected error occurred."}
         </p>
         <p>
            <a href="/">Reload the inbox</a>
         </p>
      </main>
   )
}

export const routes: RouteObject[] = [
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
   return <RouterProvider router={router} />
}
