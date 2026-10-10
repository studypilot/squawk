import { ApiError } from "../api/client"

export function LoadingNotice({ label = "Loading" }: { label?: string }) {
   return (
      <p className="notice" role="status">
         {label}&hellip;
      </p>
   )
}

export function ErrorNotice({ error }: { error: Error }) {
   if (error instanceof ApiError && error.status === 401) {
      return <LoadingNotice label="Redirecting to sign in" />
   }
   return (
      <p className="notice notice-error" role="alert">
         {error.message}
      </p>
   )
}
