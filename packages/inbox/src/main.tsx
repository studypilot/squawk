import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import "./styles/tokens.css"
import "./styles/base.css"
import "./styles/components.css"
import "./styles/pages.css"

const container = document.getElementById("root")
if (container === null) {
   throw new Error("The inbox needs an element with the id root.")
}

createRoot(container).render(
   <StrictMode>
      <App />
   </StrictMode>
)
