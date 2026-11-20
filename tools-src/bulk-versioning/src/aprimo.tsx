import { createContext, useContext, useMemo, type ReactNode } from "react"
import { createClient } from "aprimo-js"

// Aprimo Builder Tools port: the extension page (bulk-boot.js) owns the site and sign-in, using the same rules as
// the Rules Manager (site from the open tab in this window, "Use my open DAM tab" or "Sign in with Aprimo"). It hands
// this bundle a bridge on window.armBridge before loading it; every request asks the bridge for a current token.

export interface ArmBridge {
  tenant: string
  origins: { dam: string; main: string }
  inAprimo: boolean
  getAccessToken: () => Promise<string>
  /** Shows the extension's site/sign-in banner for an auth or site problem; true when it handled the error. */
  showProblem: (e: unknown) => boolean
  /** Aprimo answered 401: returns a new token to retry once with, or throws the error the banner shows. */
  tokenRejected: (opts?: { retried?: boolean }) => Promise<string>
}

type AxiosLike = {
  interceptors: { response: { use: (ok: (r: unknown) => unknown, fail: (e: AxiosErrorLike) => unknown) => void } }
  request: (config: AxiosErrorLike["config"]) => Promise<unknown>
}
type AxiosErrorLike = { response?: { status?: number }; config: { headers: Record<string, string> & { set?: (k: string, v: string) => void }; _armRetried?: boolean } }

/** On a 401, ask the extension for a new token and retry once, the same as its other tools do; else show the banner. */
function retryOn401(http: AxiosLike, bridge: ArmBridge) {
  http.interceptors.response.use((r) => r, async (error) => {
    if (error?.response?.status !== 401) throw error
    const config = error.config
    let token: string
    try {
      token = await bridge.tokenRejected({ retried: !!config._armRetried })
    } catch (e) {
      bridge.showProblem(e)
      throw e
    }
    config._armRetried = true
    if (typeof config.headers.set === "function") config.headers.set("Authorization", `Bearer ${token}`)
    else config.headers.Authorization = `Bearer ${token}`
    return http.request(config)
  })
}

declare global {
  interface Window {
    armBridge: ArmBridge
  }
}

type AprimoClient = ReturnType<typeof createClient>

interface AprimoContextValue {
  client: AprimoClient | null
  isConnected: boolean
  connection: { environment: string } | null
}

const Ctx = createContext<AprimoContextValue>({ client: null, isConnected: false, connection: null })

export function AprimoProvider({ bridge, children }: { bridge: ArmBridge; children: ReactNode }) {
  const value = useMemo<AprimoContextValue>(() => {
    const client = createClient({
      type: "custom",
      environment: bridge.tenant,
      tokenProvider: async () => {
        try {
          return await bridge.getAccessToken()
        } catch (e) {
          bridge.showProblem(e) // signed out, token expired or the site's tab closed: show the banner
          throw e
        }
      },
    })
    // aprimo-js builds https://{env}.dam.aprimo.com and https://{env}.aprimo.com itself; follow the extension's
    // configured hosts instead (identical normally, different only for the dev fake tenant).
    const internal = client as unknown as Record<string, { baseUrl: string; http: AxiosLike }>
    internal.damHttp.baseUrl = bridge.origins.dam
    internal.moHttp.baseUrl = bridge.origins.main
    internal.pmHttp.baseUrl = bridge.origins.main
    for (const k of ["damHttp", "moHttp", "pmHttp"]) retryOn401(internal[k].http, bridge)
    return { client, isConnected: true, connection: { environment: bridge.tenant } }
  }, [bridge])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAprimo() {
  return useContext(Ctx)
}
