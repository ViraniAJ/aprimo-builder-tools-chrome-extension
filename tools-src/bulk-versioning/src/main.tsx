import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { AprimoProvider } from "@/aprimo"
import { BulkTool, type ToolMode } from "@/bulk-tool"

// Aprimo Builder Tools: entry point for extension/app/bulk.html. bulk-boot.js sets up the site and sign-in, puts the
// bridge on window.armBridge, then loads this bundle. ?mode=preview gives Bulk Previews (same component).

const MODE: ToolMode = new URLSearchParams(window.location.search).get("mode") === "preview" ? "preview" : "version"

function followSystemTheme() {
  // Inside Aprimo's admin page the tool matches Aprimo (light); on its own it follows the system theme.
  if (window.armBridge.inAprimo) return
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => document.documentElement.classList.toggle("dark", mq.matches)
  apply()
  mq.addEventListener("change", apply)
}

function boot() {
  followSystemTheme()
  // A file dropped outside the drop zone would otherwise replace the page.
  window.addEventListener("dragover", (e) => e.preventDefault())
  window.addEventListener("drop", (e) => e.preventDefault())
  createRoot(document.getElementById("bv-root")!).render(
    <AprimoProvider bridge={window.armBridge}>
      <BulkTool mode={MODE} />
      <Toaster richColors position="bottom-right" theme={window.armBridge.inAprimo ? "light" : "system"} />
    </AprimoProvider>,
  )
}

boot()
