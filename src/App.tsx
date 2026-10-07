import { useEffect, useRef, useState } from "react"

type Tab = {
  id: string
  title: string
  url: string
  history: string[]
  position: number
  private?: boolean
  closing?: boolean
}
type Shortcut = { name: string; domain: string; color: string }
const initialShortcuts: Shortcut[] = [
  { name: "YouTube", domain: "youtube.com", color: "#ff3333" },
  { name: "Discord", domain: "discord.com", color: "#8e9bff" },
  { name: "Reddit", domain: "reddit.com", color: "#ff6633" },
  { name: "Spotify", domain: "open.spotify.com", color: "#36dc82" },
  { name: "GitHub", domain: "github.com", color: "#ffffff" },
  { name: "Twitch", domain: "twitch.tv", color: "#b795ff" },
]
const wallpapers = [
  {
    name: "Alpine",
    url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=90",
  },
  {
    name: "Forest",
    url: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=2400&q=90",
  },
  {
    name: "Coast",
    url: "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=2400&q=90",
  },
  { name: "Midnight", url: "" },
]
const newTab = (): Tab => ({
  id: crypto.randomUUID(),
  title: "New tab",
  url: "",
  history: [""],
  position: 0,
})
type Widget = {
  image?: string
  x: number
  y: number
  size: number
  width: number
  opacity: number
  color: string
  background: string
  visible: boolean
  text: string
  style: string
  radius: number
  font: string
}
type Home = {
  shadeColor?: string
  wallpaperZoom?: number
  wallpaperX?: number
  wallpaperY?: number
  widgets: Record<string, Widget>
  dim: number
  blur: number
  saturation: number
  cursor: boolean
  cursorImage: string
  logoImage: string
  logoMark: boolean
  wallpaperMode: string
}
type Login = { id: string; host: string; username: string; password: string }
type Profile = {
  id: string
  name: string
  avatar: string
  salt: string
  verifier: string
  vault?: { iv: string; data: string }
}
const widgetNames: Record<string, string> = {
  logo: "Logo",
  tagline: "Tagline",
  search: "Search bar",
  clock: "Clock",
  date: "Date",
  greeting: "Greeting",
  customize: "Customize button",
  add: "Add shortcut",
}
function defaultHome(): Home {
  const item = (x: number, y: number, width: number, text = ""): Widget => ({
    x,
    y,
    size: 1,
    width,
    text,
    color: "#eeeeef",
    background: "#252a35",
    opacity: 1,
    visible: true,
    style: "glass",
    radius: 16,
    font: "DM Sans",
  })
  const widgets: Record<string, Widget> = {
    logo: {
      ...item(50, 27, 450, "caffeine"),
      font: "Manrope",
      style: "transparent",
    },
    tagline: item(50, 37, 500, "Your internet. A little more you."),
    search: item(50, 48, 640, "Search or enter a URL"),
    clock: { ...item(50, 77, 240), font: "Manrope" },
    date: item(50, 85, 300),
    greeting: item(17, 7, 450, "A little escape, a lot of possibility."),
    customize: item(90, 94, 210),
    add: item(80, 62, 66),
  }
  initialShortcuts.forEach((shortcut, index) => {
    widgets[`shortcut:${shortcut.domain}`] = item(
      20 + index * 10,
      62,
      66,
      shortcut.name,
    )
  })
  return {
    widgets,
    dim: 35,
    blur: 0,
    saturation: 55,
    cursor: false,
    cursorImage: "",
    logoImage: "",
    logoMark: true,
    wallpaperMode: "cover",
  }
}
const toBase64 = (value: ArrayBuffer | Uint8Array) =>
  btoa(
    Array.from(new Uint8Array(value))
      .map((byte) => String.fromCharCode(byte))
      .join(""),
  )
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
async function profileKey(pin: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromBase64(salt),
      iterations: 210000,
      hash: "SHA-256",
    },
    material,
    256,
  )
  return {
    key: await crypto.subtle.importKey("raw", bits, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
    verifier: toBase64(await crypto.subtle.digest("SHA-256", bits)),
  }
}
async function encryptVault(key: CryptoKey, logins: Login[]) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(logins)),
  )
  return { iv: toBase64(iv), data: toBase64(data) }
}
async function mediaStore(key: string, file?: Blob): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("caffeine-media", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("assets")
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(
        "assets",
        file ? "readwrite" : "readonly",
      )
      const operation = file
        ? transaction.objectStore("assets").put(file, key)
        : transaction.objectStore("assets").get(key)
      operation.onsuccess = () => resolve(file || operation.result)
      transaction.oncomplete = () => database.close()
      transaction.onerror = () => reject(transaction.error)
    }
  })
}
function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
let proxyInit: Promise<void> | undefined
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`
// caffeine's own proxy: a service worker that fetches pages through /p/ and rewrites HTML/CSS.
export function encodeProxied(url: string) {
  return `/p/${btoa(unescape(encodeURIComponent(url)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")}`
}
export function decodeProxied(href: string) {
  const marker = "/p/"
  const index = href.indexOf(marker)
  if (index === -1) return ""
  try {
    return decodeURIComponent(
      escape(
        atob(
          href
            .slice(index + marker.length)
            .split("?")[0]
            .split("#")[0]
            .replace(/-/g, "+")
            .replace(/_/g, "/"),
        ),
      ),
    )
  } catch {
    return ""
  }
}
async function initializeProxy() {
  if (!window.isSecureContext || !navigator.serviceWorker)
    throw new Error(
      "The proxy needs HTTPS or localhost with service worker support.",
    )
  if (!proxyInit)
    proxyInit = (async () => {
      await navigator.serviceWorker.register(asset("caffeine-proxy.js"), {
        scope: import.meta.env.BASE_URL,
      })
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Proxy worker did not start. Try an HTTPS host outside the preview.",
                ),
              ),
            12000,
          ),
        ),
      ])
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Reload to activate the proxy worker.")),
            12000,
          )
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true },
          )
        })
    })().catch((error) => {
      proxyInit = undefined
      throw error
    })
  await proxyInit
}
function proxyUrl(url: string) {
  return encodeProxied(url)
}
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    back: <path d="m14 5-7 7 7 7" />,
    forward: <path d="m10 5 7 7-7 7" />,
    reload: (
      <>
        <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.5 5.8" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    star: (
      <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L3 9.6l6.2-.9Z" />
    ),
    fullscreen: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    puzzle: (
      <path d="M4 9V4h5a3 3 0 1 1 6 0h5v5a3 3 0 1 0 0 6v5h-5a3 3 0 1 0-6 0H4v-5a3 3 0 1 0 0-6Z" />
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z" />
        <circle cx="12" cy="11" r="3" />
      </>
    ),
    sliders: (
      <>
        <path d="M5 3v18M12 3v18M19 3v18" />
        <path d="M2 8h6m1 8h6m1-9h6" />
      </>
    ),
    coffee: (
      <>
        <path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 9h2a3 3 0 0 1 0 6h-2M8 2v3m5-3v3M2 22h18" />
      </>
    ),
    folder: <path d="M3 7V5h6l2 2h10v13H3Z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 6-6 4 4 3-3 5 5" />
      </>
    ),
    chevron: <path d="m7 10 5 5 5-5" />,
    check: <path d="m5 12 4 4L19 6" />,
    moon: <path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z" />,
    more: (
      <>
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.globe}
    </svg>
  )
}
function Tool({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: string
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  )
}
function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback
  } catch {
    return fallback
  }
}
export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([newTab()])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [address, setAddress] = useState("")
  const [panel, setPanel] = useState("")
  const [settingsPage, setSettingsPage] = useState("Appearance")
  const [wallpaper, setWallpaper] = useState(() =>
    readStored("caffeine-wallpaper", wallpapers[0].url),
  )
  const [video, setVideo] = useState("")
  const [accent, setAccent] = useState(() =>
    readStored("caffeine-accent", "#b8a2ef"),
  )
  const [showClock, setShowClock] = useState(() =>
    readStored("caffeine-clock", true),
  )
  const [showBookmarks, setShowBookmarks] = useState(() =>
    readStored("caffeine-bookmarkbar", true),
  )
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() =>
    readStored("caffeine-shortcuts", initialShortcuts),
  )
  const [bookmarks, setBookmarks] = useState<Shortcut[]>(() =>
    readStored("caffeine-bookmarks", [
      { name: "Google", domain: "google.com", color: "" },
      { name: "YouTube", domain: "youtube.com", color: "" },
      { name: "Discord", domain: "discord.com", color: "" },
      { name: "GitHub", domain: "github.com", color: "" },
    ]),
  )
  const [visits, setVisits] = useState<string[]>(() =>
    readStored("caffeine-history", []),
  )
  const [extensions, setExtensions] = useState(() =>
    readStored("caffeine-extensions", {
      blocker: true,
      dark: false,
      focus: false,
    }),
  )
  const [wisp, setWisp] = useState(() => readStored("caffeine-wisp", ""))
  const [proxyReady, setProxyReady] = useState(false)
  const [error, setError] = useState("")
  const [now, setNow] = useState(new Date())
  const [shortcutName, setShortcutName] = useState("")
  const [shortcutUrl, setShortcutUrl] = useState("")
  const [wallpaperPath, setWallpaperPath] = useState("")
  const [home, setHome] = useState<Home>(defaultHome)
  const [editing, setEditing] = useState(false)
  const [selectedWidget, setSelectedWidget] = useState("logo")
  const [profiles, setProfiles] = useState<Profile[]>(() =>
    readStored("caffeine-profiles", []),
  )
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileForm, setProfileForm] = useState({
    name: "",
    pin: "",
    avatar: "",
  })
  const [unlockId, setUnlockId] = useState("")
  const [unlockPin, setUnlockPin] = useState("")
  const [onboardStep, setOnboardStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [logins, setLogins] = useState<Login[]>([])
  const [pendingLogin, setPendingLogin] = useState<Login | null>(null)
  const [autofill, setAutofill] = useState(false)
  const [autoTranslate, setAutoTranslate] = useState(false)
  const [language, setLanguage] = useState("en")
  const [serverBundled, setServerBundled] = useState(false)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [serverAccess, setServerAccess] = useState(false)
  const [serverPassword, setServerPassword] = useState("")
  const [remoteImages, setRemoteImages] = useState(true)
  const vaultKey = useRef<CryptoKey | null>(null)
  const profileId = useRef("")
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)
  const frameHandlers = useRef<Record<string, {
    document: Document
    handler: EventListener
  }>>({})
  const frames = useRef<Record<string, HTMLIFrameElement | null>>({})
  const addressRef = useRef<HTMLInputElement>(null)
  const active = tabs.find((tab) => tab.id === activeId) || tabs[0]
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setAddress(active.url)
  }, [active.url, activeId])
  useEffect(() => {
    if (!profile) return
    const values = {
      wallpaper: wallpaper.startsWith("blob:") ? "uploaded" : wallpaper,
      accent,
      clock: showClock,
      bookmarkbar: showBookmarks,
      shortcuts,
      bookmarks,
      history: visits,
      extensions,
      wisp,
      home,
      autofill,
      autoTranslate,
      language,
      remoteImages,
      video: video.startsWith("blob:") ? "uploaded" : video,
    }
    try {
      localStorage.setItem(
        `caffeine-profile:${profile.id}`,
        JSON.stringify(values),
      )
    } catch {
      setError("Local storage is full. Remove some uploaded profile images.")
    }
    navigator.serviceWorker?.controller?.postMessage({
      type: "blocker",
      enabled: extensions.blocker,
    })
  }, [
    profile,
    wallpaper,
    accent,
    showClock,
    showBookmarks,
    shortcuts,
    bookmarks,
    visits,
    extensions,
    wisp,
    home,
    autofill,
    autoTranslate,
    language,
    remoteImages,
    video,
  ])
  useEffect(() => {
    if (!profile) {
      setProxyReady(false)
      return
    }
    let cancelled = false
    setProxyReady(false)
    initializeProxy()
      .then(() => {
        if (!cancelled) {
          setProxyReady(true)
          navigator.serviceWorker.controller?.postMessage({
            type: "blocker",
            enabled: extensions.blocker,
          })
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [profile?.id])
  useEffect(() => {
    fetch(asset("api/runtime"))
      .then((response) => response.json())
      .then((data) => {
        if (data.bundledWisp === true) { setServerBundled(true); setPasswordRequired(data.authenticationRequired === true); setServerAccess(data.authenticated === true) }
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    const previous = Object.values(frameHandlers.current)
    previous.forEach(({ document, handler }) =>
      document.removeEventListener("submit", handler, true),
    )
    frameHandlers.current = {}
    tabs.forEach((tab) => {
      if (tab.url) wireFrame(tab.id)
    })
    return () =>
      Object.values(frameHandlers.current).forEach(({ document, handler }) =>
        document.removeEventListener("submit", handler, true),
      )
  }, [profile?.id, autofill, logins, tabs.length, proxyReady])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "l") {
        event.preventDefault()
        addressRef.current?.focus()
        addressRef.current?.select()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "t") {
        event.preventDefault()
        addTab()
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault()
        addTab(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "w") {
        event.preventDefault()
        closeTab(activeId)
      }
      if (event.key === "Escape") {
        setPanel("")
        setEditing(false)
      }
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  })
  function addTab(isPrivate = active.private || false) {
    const tab = { ...newTab(), private: isPrivate }
    setTabs((previous) => [...previous, tab])
    setActiveId(tab.id)
    setPanel("")
  }
  function closeTab(id: string) {
    setTabs((previous) =>
      previous.map((tab) => (tab.id === id ? { ...tab, closing: true } : tab)),
    )
    setTimeout(
      () =>
        setTabs((previous) => {
          const remaining = previous.filter((tab) => tab.id !== id)
          if (!remaining.length) remaining.push(newTab())
          setActiveId((current) =>
            current === id ? remaining[remaining.length - 1].id : current,
          )
          return remaining
        }),
      180,
    )
  }
  function navigate(input: string) {
    const text = input.trim()
    if (!text) return
    let url = text
    if (!/^https?:\/\//i.test(text))
      url = /^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text)
        ? `https://${text}`
        : `https://www.google.com/search?q=${encodeURIComponent(text)}`
    try {
      const parsed = new URL(url)
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error()
      setTabs((previous) =>
        previous.map((tab) =>
          tab.id === activeId
            ? {
                ...tab,
                url,
                title: parsed.hostname.replace("www.", ""),
                history: [...tab.history.slice(0, tab.position + 1), url],
                position: tab.position + 1,
              }
            : tab,
        ),
      )
      if (!active.private)
        setVisits((previous) =>
          [url, ...previous.filter((item) => item !== url)].slice(0, 100),
        )
      setPanel("")
      setPendingLogin(null)
    } catch {
      setError("Enter a valid website address.")
    }
  }
  function travel(offset: number) {
    setTabs((previous) =>
      previous.map((tab) => {
        if (tab.id !== activeId) return tab
        const position = tab.position + offset
        const url = tab.history[position]
        return {
          ...tab,
          position,
          url,
          title: url ? new URL(url).hostname : "New tab",
        }
      }),
    )
  }
  function togglePanel(value: string) {
    setPanel((previous) => (previous === value ? "" : value))
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setError(
        "Fullscreen is unavailable in this preview. Open the app in its own window.",
      )
    }
  }
  function remoteImage(url: string) {
    if (
      url.startsWith("blob:") ||
      url.startsWith("data:") ||
      url.startsWith("/")
    )
      return url
    if (!remoteImages) return ""
    return serverBundled
      ? `${asset("api/image")}?url=${encodeURIComponent(url)}`
      : proxyReady
        ? proxyUrl(url)
        : `https://images.weserv.nl/?url=${encodeURIComponent(url)}`
  }
  function favicon(domain: string) {
    return remoteImage(
      domain === "github.com"
        ? "https://cdn-icons-png.flaticon.com/256/25/25231.png"
        : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    )
  }
  async function upload(file?: File) {
    if (!file) return
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/"))
      return setError("Choose an image or MP4/WebM video.")
    if (file.size > 150 * 1024 * 1024)
      return setError("Wallpaper uploads must be under 150 MB.")
    try {
      await mediaStore(`${profile?.id || "draft"}:wallpaper`, file)
      const url = URL.createObjectURL(file)
      if (file.type.startsWith("video/")) setVideo(url)
      else {
        setVideo("")
        setWallpaper(url)
      }
    } catch {
      setError("Could not save wallpaper. Browser storage may be full.")
    }
  }
  function updateWidget(id: string, values: Partial<Widget>) {
    setHome((previous) => ({
      ...previous,
      widgets: {
        ...previous.widgets,
        [id]: { ...previous.widgets[id], ...values },
      },
    }))
  }
  function startDrag(event: React.PointerEvent, id: string) {
    if (!editing) return
    event.preventDefault()
    setSelectedWidget(id)
    const widget = home.widgets[id]
    dragRef.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      x: widget.x,
      y: widget.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: React.PointerEvent) {
    const drag = dragRef.current
    const box = canvasRef.current?.getBoundingClientRect()
    if (!drag || !box) return
    updateWidget(drag.id, {
      x: Math.max(
        2,
        Math.min(
          98,
          drag.x + ((event.clientX - drag.startX) / box.width) * 100,
        ),
      ),
      y: Math.max(
        2,
        Math.min(
          98,
          drag.y + ((event.clientY - drag.startY) / box.height) * 100,
        ),
      ),
    })
  }
  async function uploadSmall(
    file: File | undefined,
    destination: "avatar" | "cursor" | "logo" | "element",
  ) {
    if (!file) return
    if (!file.type.startsWith("image/"))
      return setError("Choose an image file.")
    if (file.size > 1024 * 1024)
      return setError("Choose an image smaller than 1 MB.")
    try {
      const image = await dataUrl(file)
      if (destination === "avatar")
        setProfileForm((previous) => ({ ...previous, avatar: image }))
      else if (destination === "cursor") {
        const source = new Image()
        await new Promise<void>((resolve, reject) => { source.onload = () => resolve(); source.onerror = () => reject(new Error('Invalid cursor image.')); source.src = image })
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable.')
        const scale = Math.min(32 / source.width, 32 / source.height)
        context.drawImage(source, 0, 0, source.width * scale, source.height * scale)
        setHome(previous => ({ ...previous, cursorImage: canvas.toDataURL('image/png'), cursor: true }))
      }
      else if (destination === 'element') updateWidget(selectedWidget, { image })
      else setHome((previous) => ({ ...previous, logoImage: image }))
    } catch {
      setError("Could not read image.")
    }
  }
  function saveProfiles(next: Profile[]) {
    localStorage.setItem("caffeine-profiles", JSON.stringify(next))
    setProfiles(next)
  }
  async function activateProfile(
    next: Profile,
    key: CryptoKey,
    initial = false,
  ) {
    vaultKey.current = key
    profileId.current = next.id
    setLogins([])
    setPendingLogin(null)
    setEditing(false)
    if (next.vault) {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(next.vault.iv) },
        key,
        fromBase64(next.vault.data),
      )
      setLogins(JSON.parse(new TextDecoder().decode(plain)))
    }
    const prefs = readStored<Record<string, unknown>>(
      `caffeine-profile:${next.id}`,
      {},
    )
    if (!initial) {
      setHome(prefs.home as Home || defaultHome())
      setAccent(prefs.accent as string || "#b8a2ef")
      setWallpaper(
        prefs.wallpaper as string === "uploaded"
          ? wallpapers[0].url
          : typeof prefs.wallpaper === 'string' ? prefs.wallpaper : wallpapers[0].url,
      )
      setVideo(
        prefs.video as string === "uploaded" ? "" : prefs.video as string || "",
      )
    }
    setShortcuts(prefs.shortcuts as Shortcut[] || initialShortcuts)
    setBookmarks(
      prefs.bookmarks as Shortcut[] || [
        { name: "Google", domain: "google.com", color: "" },
        { name: "GitHub", domain: "github.com", color: "" },
      ],
    )
    setVisits(prefs.history as string[] || [])
    setExtensions(
      prefs.extensions as typeof extensions || (initial ? extensions : {
        blocker: true,
        dark: false,
        focus: false,
      }),
    )
    setAutofill(!!prefs.autofill)
    setAutoTranslate(!!prefs.autoTranslate)
    setLanguage(prefs.language as string || "en")
    setRemoteImages(prefs.remoteImages !== false)
    setShowBookmarks(prefs.bookmarkbar !== false)
    setShowClock(prefs.clock !== false)
    setWisp(
      prefs.wisp as string ||
        (initial ? wisp : "") ||
        (serverBundled
          ? `${
              location.protocol === "https:" ? "wss" : "ws"
            }://${location.host}/wisp/`
          : ""),
    )
    const tab = newTab()
    setTabs([tab])
    setActiveId(tab.id)
    setProfile(next)
    setPanel("")
    setUnlockPin("")
    setProfileForm({ name: "", pin: "", avatar: "" })
    if (
      prefs.wallpaper === "uploaded" ||
      prefs.video === "uploaded" ||
      initial
    ) {
      const stored = await mediaStore(
        `${initial ? "draft" : next.id}:wallpaper`,
      )
      if (stored && profileId.current === next.id) {
        if (initial) await mediaStore(`${next.id}:wallpaper`, stored)
        const url = URL.createObjectURL(stored)
        if (stored.type.startsWith("video/")) setVideo(url)
        else setWallpaper(url)
      }
    }
  }
  async function createProfile() {
    if (!profileForm.name.trim() || profileForm.pin.length < 4)
      return setError(
        "Choose a name and a password or PIN of at least 4 characters.",
      )
    setBusy(true)
    try {
      const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)))
      const derived = await profileKey(profileForm.pin, salt)
      const next: Profile = {
        id: crypto.randomUUID(),
        name: profileForm.name.trim(),
        avatar: profileForm.avatar,
        salt,
        verifier: derived.verifier,
      }
      saveProfiles([...profiles, next])
      await activateProfile(next, derived.key, profiles.length === 0)
    } catch {
      setError(
        "Could not create profile. Use an HTTPS connection with local storage enabled.",
      )
    } finally {
      setBusy(false)
    }
  }
  async function unlockProfile() {
    setBusy(true)
    try {
      const target = profiles.find((item) => item.id === unlockId)
      if (!target) throw new Error()
      const derived = await profileKey(unlockPin, target.salt)
      if (derived.verifier !== target.verifier) throw new Error()
      await activateProfile(target, derived.key)
    } catch {
      setError("Could not unlock this profile. Check your password or PIN.")
    } finally {
      setBusy(false)
    }
  }
  function lockProfile() {
    profileId.current = ""
    vaultKey.current = null
    setProfile(null)
    setLogins([])
    setPendingLogin(null)
    setPanel("")
    setEditing(false)
    const tab = newTab()
    setTabs([tab])
    setActiveId(tab.id)
  }
  async function saveLogin(login: Login) {
    if (!profile || !vaultKey.current || active.private) return
    const id = profile.id
    const next = [
      ...logins.filter(
        (item) =>
          !(item.host === login.host && item.username === login.username),
      ),
      login,
    ]
    const encrypted = await encryptVault(vaultKey.current, next)
    if (profileId.current !== id) return
    setLogins(next)
    saveProfiles(
      profiles.map((item) =>
        item.id === id ? { ...item, vault: encrypted } : item,
      ),
    )
    setPendingLogin(null)
  }
  async function removeLogin(id: string) {
    if (!profile || !vaultKey.current) return
    const owner = profile.id
    const next = logins.filter((item) => item.id !== id)
    const encrypted = await encryptVault(vaultKey.current, next)
    if (profileId.current !== owner) return
    setLogins(next)
    saveProfiles(
      profiles.map((item) =>
        item.id === owner ? { ...item, vault: encrypted } : item,
      ),
    )
  }
  function frameUrl(id: string) {
    const href = frames.current[id]?.contentWindow?.location.href || ""
    if (!href) return ""
    try {
      if (href.includes("/p/")) return decodeProxied(href) || href
      // srcdoc frames keep their real URL on the injected base variable.
      const base = (frames.current[id]?.contentWindow as unknown as { __CAFFEINE_BASE__?: string })?.__CAFFEINE_BASE__
      if (base && /^https?:\/\//i.test(base)) return base
      return href
    } catch {
      return ""
    }
  }
  function wireFrame(id: string) {
    try {
      const tab = tabs.find((item) => item.id === id)
      const frame = frames.current[id]
      const document = frame?.contentDocument
      if (!tab || !document || !profile) return
      const old = frameHandlers.current[id]
      if (old) old.document.removeEventListener("submit", old.handler, true)
      const decoded = frameUrl(id)
      const host = new URL(decoded).hostname
      if (document.title)
        setTabs((previous) =>
          previous.map((item) =>
            item.id === id
              ? { ...item, title: document.title.slice(0, 60) }
              : item,
          ),
        )
      if (
        tab.private ||
        !autofill ||
        host.endsWith("translate.goog") ||
        host === "translate.google.com"
      )
        return
      const login = logins.find((item) => item.host === host)
      if (login) document.querySelectorAll("form").forEach((form) => {
          const password = form.querySelector<HTMLInputElement>(
            'input[type="password"]',
          )
          const username = form.querySelector<HTMLInputElement>(
            'input[autocomplete="username"],input[type="email"],input[name*="user"],input[name*="email"]',
          )
          if (password && username) {
            const setter = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(document.createElement('input')),
              "value",
            )?.set
            if (setter) {
              setter.call(username, login.username)
              setter.call(password, login.password)
              username.dispatchEvent(new Event("input", { bubbles: true }))
              password.dispatchEvent(new Event("input", { bubbles: true }))
            }
          }
        })
      const handler: EventListener = (event) => {
        const form = event.target as HTMLFormElement
        if (form.tagName !== "FORM") return
        try {
          const currentHost = new URL(frameUrl(id)).hostname
          if (currentHost !== host) return
          const password = form.querySelector<HTMLInputElement>(
            'input[type="password"]',
          )
          const username = form.querySelector<HTMLInputElement>(
            'input[autocomplete="username"],input[type="email"],input[name*="user"],input[name*="email"]',
          )
          if (
            password?.value &&
            username?.value &&
            !logins.some(
              (item) =>
                item.host === host &&
                item.username === username.value &&
                item.password === password.value,
            )
          )
            setPendingLogin({
              id: crypto.randomUUID(),
              host,
              username: username.value,
              password: password.value,
            })
        } catch {}
      }
      document.addEventListener("submit", handler, true)
      frameHandlers.current[id] = { document, handler }
    } catch {}
  }
  function translatedUrl(url: string) {
    return autoTranslate &&
      !new URL(url).hostname.includes("translate.google") &&
      !new URL(url).hostname.endsWith("translate.goog")
      ? `https://translate.google.com/translate?sl=auto&tl=${language}&u=${encodeURIComponent(url)}`
      : url
  }
  async function connectBundled() {
    try {
      const response = await fetch(asset("api/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: serverPassword }),
      })
      if (!response.ok) throw new Error()
      setServerPassword("")
      setServerAccess(true)
      setError("Server access unlocked.")
    } catch {
      setError(
        "Could not unlock the bundled server. Check the server access password.",
      )
    }
  }
  function homeContent(id: string, widget: Widget) {
    if (id.startsWith("shortcut:")) {
      const shortcut = shortcuts.find(
        (item) => `shortcut:${item.domain}` === id,
      )
      if (!shortcut) return null
      return (
        <button className="shortcut" onClick={() => navigate(shortcut.domain)}>
          <span
            className="shortcut-icon"
            style={{
              background: widget.background,
              borderRadius: widget.radius,
            }}
          >
            <span className="shortcut-letter">{shortcut.name[0]}</span>
            <img
              className={shortcut.domain === "github.com" && !widget.image ? "github-icon" : ""}
              src={widget.image || favicon(shortcut.domain) || undefined}
              onLoad={event => { event.currentTarget.style.display = 'block'; const fallback = event.currentTarget.previousElementSibling as HTMLElement | null; if (fallback) fallback.style.opacity = '0' }}
              onError={(event) => {
                event.currentTarget.style.display = "none"
                const fallback = event.currentTarget.previousElementSibling as HTMLElement | null
                if (fallback) fallback.style.opacity = '.6'
              }}
              alt=""
            />
          </span>
          <span>{widget.text || shortcut.name}</span>
        </button>
      )
    }
    if (id === "logo")
      return (
        <div
          className={`hero-brand logo-${widget.style}`}
          style={{ "--logo-ground": widget.background, borderRadius: widget.radius } as React.CSSProperties}
        >
          {home.logoImage ? (
            <img
              src={home.logoImage}
              className="custom-logo-image"
              alt="Custom logo"
            />
          ) : (
            <>
              {home.logoMark && <Icon name="coffee" size={38} />}
              <h1 style={widget.style === 'outline' ? { WebkitTextStroke: `1.4px ${widget.color}`, color: 'transparent' } : undefined}>
                {widget.text}
                <span>.</span>
              </h1>
            </>
          )}
        </div>
      )
    if (id === "tagline") return <p className="hero-tagline">{widget.text}</p>
    if (id === "greeting")
      return <span className="greeting">{widget.text}</span>
    if (id === "search")
      return (
        <form
          className={`hero-search surface-${widget.style}`}
          style={{
            background:
              widget.background + (widget.style === "glass" ? "a6" : ""),
            borderRadius: widget.radius,
          }}
          onSubmit={(event) => {
            event.preventDefault()
            navigate(new FormData(event.currentTarget).get("search") as string)
          }}
        >
          <Icon name="search" size={20} />
          <input
            name="search"
            placeholder={widget.text}
            aria-label="Search the web"
            autoComplete="off"
          />
          <kbd>↵</kbd>
        </form>
      )
    if (id === "clock")
      return (
        <div className="clock">
          <span>
            {widget.text || now.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
        </div>
      )
    if (id === "date")
      return (
        <p className="canvas-date">
          {widget.text || now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      )
    if (id === "add")
      return (
        <button
          className="shortcut add-shortcut"
          onClick={() => setPanel("shortcut")}
        >
          <span
            className="shortcut-icon"
            style={{
              background: widget.background,
              borderRadius: widget.radius,
            }}
          >
            <Icon name="plus" size={23} />
          </span>
          <span>{widget.text || "Add shortcut"}</span>
        </button>
      )
    if (id === "customize")
      return (
        <button
          className="customize-button"
          onClick={() => {
            setEditing(true)
            setSelectedWidget("logo")
          }}
          style={{ background: widget.background, borderRadius: widget.radius }}
        >
          <Icon name="sliders" size={15} />
          {widget.text || "Customize caffeine"}
        </button>
      )
    return <p className="canvas-custom-text">{widget.text}</p>
  }
  const editedWidget = home.widgets[selectedWidget]
  const range = (
    label: string,
    value: number,
    min: number,
    max: number,
    action: (value: number) => void,
    step = 1,
  ) => (
    <label className="editor-range">
      <span>
        {label}
        <small>
          {Math.round(value * (step < 1 ? 100 : 1))}
          {step < 1 ? "%" : ""}
        </small>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => action(Number(event.target.value))}
      />
    </label>
  )
  const toggle = (label: string, checked: boolean, action: () => void) => (
    <button className="setting-row" onClick={action}>
      <span>{label}</span>
      <span
        className={`switch ${checked ? "on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span />
      </span>
    </button>
  )
  return (
    <div
      className="browser"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <header className="chrome">
        <div className="tab-strip">
          <button
            className="tab-dropdown tool"
            aria-label="Tab list"
            onClick={() => togglePanel("tabs")}
          >
            <Icon name="chevron" size={15} />
          </button>
          <div className="tabs">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`tab ${tab.id === activeId ? "selected" : ""} ${
                  tab.closing ? "closing" : ""
                } ${tab.private ? "private-tab" : ""}`}
              >
                <button
                  className="tab-select"
                  onClick={() => {
                    setActiveId(tab.id)
                    setPendingLogin(null)
                  }}
                >
                  {tab.private ? (
                    <Icon name="moon" size={15} />
                  ) : tab.url ? (
                    <img
                      src={favicon(new URL(tab.url).hostname) || undefined}
                      alt=""
                    />
                  ) : (
                    <Icon name="coffee" size={15} />
                  )}
                  <span>
                    {tab.private && !tab.url ? "Incognito" : tab.title}
                  </span>
                </button>
                <button
                  className="tab-close"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => closeTab(tab.id)}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
          <Tool icon="plus" label="New tab" onClick={() => addTab()} />
          <div className="browser-wordmark">
            <Icon name="coffee" size={14} /> caffeine
          </div>
        </div>
        <div className="toolbar">
          <Tool
            icon="back"
            label="Back"
            onClick={() => travel(-1)}
            disabled={active.position === 0}
          />
          <Tool
            icon="forward"
            label="Forward"
            onClick={() => travel(1)}
            disabled={active.position === active.history.length - 1}
          />
          <Tool
            icon="reload"
            label="Reload"
            onClick={() => {
              const frame = frames.current[activeId]
              if (frame) frame.src = frame.src
            }}
          />
          <form
            className="omnibox"
            onSubmit={(event) => {
              event.preventDefault()
              navigate(address)
            }}
          >
            <Icon name={active.url ? "shield" : "sliders"} size={16} />
            <input
              ref={addressRef}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Search Google or type a URL"
              aria-label="Address bar"
              onFocus={(event) => event.target.select()}
            />
            <span className="address-shortcut">Ctrl L</span>
            <Tool
              icon="star"
              label="Bookmark this page"
              active={bookmarks.some(
                (item) => `https://${item.domain}` === active.url,
              )}
              onClick={() => {
                if (active.url) {
                  const domain = new URL(active.url).hostname
                  setBookmarks((previous) =>
                    previous.some((item) => item.domain === domain)
                      ? previous.filter((item) => item.domain !== domain)
                      : [
                          ...previous,
                          { name: active.title, domain, color: "" },
                        ],
                  )
                } else togglePanel("bookmarks")
              }}
            />
          </form>
          <Tool icon="fullscreen" label="Fullscreen" onClick={fullscreen} />
          <span className="toolbar-divider" />
          <Tool
            icon="shield"
            label="Privacy protection"
            active={extensions.blocker}
            onClick={() => {
              setSettingsPage("Extensions")
              setPanel("settings")
            }}
          />
          <Tool
            icon="puzzle"
            label="Extensions"
            onClick={() => {
              setSettingsPage("Extensions")
              togglePanel("settings")
            }}
          />
          <button
            className="profile"
            title={profile?.name || "Profiles"}
            aria-label={profile?.name || 'Profiles'}
            onClick={() => togglePanel("profiles")}
          >
            {profile?.avatar ? <img src={profile.avatar} alt="" /> : profile?.name[0] || 'c'}
          </button>
          <Tool
            icon="more"
            label="Browser menu"
            onClick={() => togglePanel("menu")}
          />
        </div>
        {showBookmarks && (
          <div className="bookmarks-bar">
            {bookmarks.map((item) => (
              <button key={item.domain} onClick={() => navigate(item.domain)}>
                <img src={favicon(item.domain)} alt="" />
                {item.name}
              </button>
            ))}
            <span className="bookmark-separator" />
            <button onClick={() => togglePanel("bookmarks")}>
              <Icon name="folder" size={14} />
              Bookmarks
            </button>
            <button
              className="all-bookmarks"
              onClick={() => togglePanel("bookmarks")}
            >
              <Icon name="folder" size={14} />
              All bookmarks
            </button>
          </div>
        )}
      </header>
      <main className="viewport">
        {tabs.map(
          (tab) =>
            tab.url && (
              <div
                key={tab.id}
                className={`site-view ${tab.id === activeId ? "" : "hidden"}`}
              >
                {proxyReady ? (
                  <iframe
                    ref={(element) => {
                      frames.current[tab.id] = element
                    }}
                    src={proxyUrl(translatedUrl(tab.url))}
                    title={tab.title}
                    className={extensions.dark ? "dark-site" : ""}
                    allow="fullscreen; autoplay; clipboard-write"
                    sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin"
                    onLoad={() => wireFrame(tab.id)}
                  />
                ) : (
                  <div className="proxy-empty">
                    <Icon name="globe" size={38} />
                    <h2>Your next stop is ready.</h2>
                    <p>Browsing runs through caffeine's built-in proxy.</p>
                    <code>{tab.url}</code>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setSettingsPage("Connection")
                        setPanel("settings")
                      }}
                    >
                      Set up connection <Icon name="forward" size={15} />
                    </button>
                  </div>
                )}
              </div>
            ),
        )}
        {!active.url && (
          <div ref={canvasRef} className={`new-tab home-canvas ${editing ? 'editing' : ''} ${home.cursor ? 'custom-cursor' : ''}`} style={{ '--home-cursor': home.cursorImage ? `url("${home.cursorImage}") 8 8, auto` : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='32' viewBox='0 0 28 32'%3E%3Cpath d='M3 2v23l6-6 5 10 4-2-5-10h9Z' fill='%23eee9fa' stroke='%239b80d1' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E") 3 2, auto` } as React.CSSProperties}>
            <div
              className="wallpaper"
              style={{
                backgroundImage: wallpaper && remoteImage(wallpaper) ? `url("${remoteImage(wallpaper)}")` : undefined,
                filter: `saturate(${home.saturation}%) blur(${home.blur}px)`,
                backgroundSize: home.wallpaperMode,
                backgroundPosition: `${home.wallpaperX ?? 50}% ${home.wallpaperY ?? 54}%`,
                transform: `scale(${(home.wallpaperZoom ?? 100) / 100})`,
              }}
            >
              {video && <video src={video} autoPlay loop muted playsInline onError={() => { setVideo(''); setError('Video preset could not load. Check its filename in public/wallpapers/.') }} />}
            </div>
            <div className="wallpaper-shade" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${home.shadeColor || '#0c1019'} ${home.dim / 2}%, transparent), color-mix(in srgb, ${home.shadeColor || '#0c1019'} ${home.dim}%, transparent))` }} />
            {Object.entries(home.widgets).map(([id, widget]) => widget.visible && (editing || ((showClock || !['clock', 'date'].includes(id)) && (!extensions.focus || !(id.startsWith('shortcut:') || id === 'add')))) && <div
              key={id}
              className={`canvas-widget ${editing && selectedWidget === id ? 'widget-selected' : ''}`}
              style={{ left: `clamp(min(${widget.width * widget.size / 2}px, 46vw), ${widget.x}%, calc(100% - min(${widget.width * widget.size / 2}px, 46vw)))`, top: `${widget.y}%`, width: `min(${widget.width}px, 92vw)`, transform: `translate(-50%, -50%) scale(${widget.size})`, opacity: widget.opacity, color: widget.color, fontFamily: widget.font }}
              onPointerDown={event => startDrag(event, id)} onPointerMove={moveDrag}
              onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}
              tabIndex={editing ? 0 : undefined}
              onKeyDown={event => {
                if (!editing) return
                const offset = event.shiftKey ? 5 : 1
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault(); setSelectedWidget(id)
                  updateWidget(id, { x: Math.max(2, Math.min(98, widget.x + (event.key === 'ArrowLeft' ? -offset : event.key === 'ArrowRight' ? offset : 0))), y: Math.max(2, Math.min(98, widget.y + (event.key === 'ArrowUp' ? -offset : event.key === 'ArrowDown' ? offset : 0))) })
                }
              }}>
              {editing && <span className="widget-label">{widgetNames[id] || widget.text || 'Shortcut'}</span>}
              <div className="widget-content">{homeContent(id, widget)}</div>
            </div>)}
            {editing && <aside className="canvas-editor"><div className="editor-header"><span><Icon name="sliders" size={16} />Your canvas.</span><Tool icon="check" label="Finish editing" onClick={() => setEditing(false)} /></div><p className="hint">Drag anything. Arrow keys nudge it.</p><label className="field-label">Element<select value={selectedWidget} onChange={event => setSelectedWidget(event.target.value)}>{Object.entries(home.widgets).map(([id, widget]) => <option key={id} value={id}>{widgetNames[id] || widget.text || 'Shortcut'}{widget.visible ? '' : ' · hidden'}</option>)}</select></label>
              {editedWidget && <><div className="editor-actions"><button onClick={() => updateWidget(selectedWidget, { visible: !editedWidget.visible })}>{editedWidget.visible ? 'Hide element' : 'Show element'}</button><button onClick={() => updateWidget(selectedWidget, { x: 50, y: 50 })}>Center</button></div>{range('Horizontal', editedWidget.x, 2, 98, value => updateWidget(selectedWidget, { x: value }))}{range('Vertical', editedWidget.y, 2, 98, value => updateWidget(selectedWidget, { y: value }))}{range('Size', editedWidget.size, .25, 2.5, value => updateWidget(selectedWidget, { size: value }), .01)}{range('Width', editedWidget.width, 40, 1200, value => updateWidget(selectedWidget, { width: value }))}{range('Opacity', editedWidget.opacity, 0, 1, value => updateWidget(selectedWidget, { opacity: value }), .01)}{range('Corners', editedWidget.radius, 0, 50, value => updateWidget(selectedWidget, { radius: value }))}<div className="editor-colors"><label>Text<input type="color" value={editedWidget.color} onChange={event => updateWidget(selectedWidget, { color: event.target.value })} /></label><label>Surface<input type="color" value={editedWidget.background} onChange={event => updateWidget(selectedWidget, { background: event.target.value })} /></label></div><label className="field-label">Text<input className="text-input" value={editedWidget.text} onChange={event => updateWidget(selectedWidget, { text: event.target.value })} placeholder="Element text" /></label><label className="field-label">Typeface<select value={editedWidget.font} onChange={event => updateWidget(selectedWidget, { font: event.target.value })}>{['DM Sans', 'Manrope', 'Georgia', 'monospace', 'Arial'].map(font => <option key={font}>{font}</option>)}</select></label>{['logo', 'search'].includes(selectedWidget) && <label className="field-label">Treatment<select value={editedWidget.style} onChange={event => updateWidget(selectedWidget, { style: event.target.value })}>{['transparent', 'outline', 'glass', 'half-transparent', 'solid', 'custom'].map(style => <option key={style}>{style}</option>)}</select></label>}{selectedWidget === 'logo' && <>{toggle('Show coffee mark', home.logoMark, () => setHome({ ...home, logoMark: !home.logoMark }))}<label className="upload-button">Upload logo<input type="file" accept="image/*" onChange={event => uploadSmall(event.target.files?.[0], 'logo')} /></label>{home.logoImage && <button className="quiet-button" onClick={() => setHome({ ...home, logoImage: '' })}>Use text logo</button>}</>}</>}
              <div className="editor-divider" /><p className="section-caption">Wallpaper</p>{range('Dim', home.dim, 0, 100, value => setHome({ ...home, dim: value }))}{range('Blur', home.blur, 0, 25, value => setHome({ ...home, blur: value }))}{range('Saturation', home.saturation, 0, 200, value => setHome({ ...home, saturation: value }))}<label className="field-label">Fit<select value={home.wallpaperMode} onChange={event => setHome({ ...home, wallpaperMode: event.target.value })}>{['cover', 'contain', 'auto'].map(mode => <option key={mode}>{mode}</option>)}</select></label><label className="upload-button">Upload wallpaper<input type="file" accept="image/*,video/mp4,video/webm" onChange={event => upload(event.target.files?.[0])} /></label>{toggle('Custom cursor', home.cursor, () => setHome({ ...home, cursor: !home.cursor }))}<label className="upload-button">Upload cursor<input type="file" accept="image/*" onChange={event => uploadSmall(event.target.files?.[0], 'cursor')} /></label><div className="editor-actions"><button onClick={() => setHome({ ...home, widgets: Object.fromEntries(Object.entries(home.widgets).map(([id, widget]) => [id, { ...widget, visible: false }])) })}>Wallpaper only</button><button onClick={() => { setHome(defaultHome()); setSelectedWidget('logo'); setShowClock(true) }}>Reset layout</button></div><button className="quiet-button" onClick={() => { const id = `text:${crypto.randomUUID()}`; setHome({ ...home, widgets: { ...home.widgets, [id]: { ...defaultHome().widgets.tagline, text: 'Your words.', x: 50, y: 50 } } }); setSelectedWidget(id) }}>+ Add text</button><button className="primary-button editor-done" onClick={() => setEditing(false)}>Done <Icon name="check" size={15} /></button>
              {selectedWidget.startsWith('shortcut:') && <><label className="upload-button">Custom shortcut icon<input type="file" accept="image/*" onChange={event => uploadSmall(event.target.files?.[0], 'element')} /></label>{editedWidget?.image && <button className="quiet-button" onClick={() => updateWidget(selectedWidget, { image: undefined })}>Restore site icon</button>}</>}
              <div className="editor-divider" />
              <div className="editor-colors"><label>Wallpaper tint<input type="color" value={home.shadeColor || '#0c1019'} onChange={event => setHome({ ...home, shadeColor: event.target.value })} /></label></div>
              {range('Wallpaper zoom', home.wallpaperZoom ?? 100, 100, 200, value => setHome({ ...home, wallpaperZoom: value }))}
              {range('Wallpaper horizontal', home.wallpaperX ?? 50, 0, 100, value => setHome({ ...home, wallpaperX: value }))}
              {range('Wallpaper vertical', home.wallpaperY ?? 54, 0, 100, value => setHome({ ...home, wallpaperY: value }))}
            </aside>}
          </div>
        )}
      </main>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button aria-label="Dismiss" onClick={() => setError("")}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {panel === "menu" && (
        <>
          <button
            className="dismiss-menu"
            aria-label="Close menu"
            onClick={() => setPanel("")}
          />
          <div className="browser-menu">
            {[
              ["plus", "New tab", "Ctrl T"],
              ["moon", "New incognito tab", "Ctrl Shift N"],
              ["sliders", "Edit home screen", ""],
              ["coffee", "Profiles", ""],
              ["clock", "History", ""],
              ["star", "Bookmarks", ""],
              ["download", "Downloads", ""],
              ["puzzle", "Extensions", ""],
              ["settings", "Settings", ""],
            ].map(([icon, label, key]) => (
              <button
                key={label}
                onClick={() => {
                  if (label === "New tab") addTab()
                  else if (label === 'New incognito tab') { addTab(true); setError('Incognito does not save history or passwords. Proxy cookies and website sessions are shared with normal tabs.') }
                  else if (label === 'Edit home screen') { if (active.url) addTab(false); setEditing(true); setPanel('') }
                  else if (label === "Settings" || label === "Extensions") {
                    setSettingsPage(
                      label === "Extensions" ? "Extensions" : "Appearance",
                    )
                    setPanel("settings")
                  } else setPanel(label.toLowerCase())
                }}
              >
                <Icon name={icon} size={16} />
                <span>{label}</span>
                <kbd>{key}</kbd>
              </button>
            ))}
          </div>
        </>
      )}
      {panel && !['menu', 'profiles', 'newprofile'].includes(panel) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPanel("")
          }}
        >
          <section
            className={`modal ${panel === "settings" ? "settings-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={panel}
          >
            <div className="modal-heading">
              <span>
                <Icon
                  name={panel === "settings" ? "sliders" : "coffee"}
                  size={19}
                />
                {panel === "settings"
                  ? "Make it yours."
                  : panel === "shortcut"
                    ? "A new favorite."
                    : panel.charAt(0).toUpperCase() + panel.slice(1)}
              </span>
              <Tool
                icon="close"
                label="Close dialog"
                onClick={() => setPanel("")}
              />
            </div>
            {panel === "settings" ? (
              <div className="settings-layout">
                <nav className="settings-nav">
                  {[
                    "Appearance",
                    "New tab",
                    "Extensions",
                    "Passwords",
                    "Connection",
                    "About",
                  ].map((page) => (
                    <button
                      key={page}
                      className={settingsPage === page ? "selected" : ""}
                      onClick={() => setSettingsPage(page)}
                    >
                      <Icon
                        name={
                          {
                            Appearance: "image",
                            "New tab": "globe",
                            Extensions: "puzzle",
                            Connection: "shield",
                            About: "coffee",
                          }[page] || "settings"
                        }
                        size={17}
                      />
                      {page}
                    </button>
                  ))}
                  <div className="settings-credit">
                    caffeine <span>by 34ms/lucas</span>
                  </div>
                </nav>
                <div className="settings-body">
                  <h2>{settingsPage}</h2>
                  {settingsPage === "Appearance" && (
                    <>
                      <button className="canvas-launch" onClick={() => { if (active.url) addTab(false); setPanel(''); setEditing(true) }}><Icon name="sliders" size={21} /><span><strong>Everything, your way.</strong><small>Move, resize, restyle or hide any element.</small></span><Icon name="forward" size={17} /></button>
                      <p className="section-caption">A different view.</p>
                      <div className="wallpaper-grid">
                        {wallpapers.map((item) => (
                          <button
                            key={item.name}
                            className={`wallpaper-choice ${
                              wallpaper === item.url && !video ? "chosen" : ""
                            }`}
                            onClick={() => {
                              setWallpaper(item.url)
                              setVideo("")
                            }}
                            style={{
                              backgroundImage: item.url
                              ? `url(${remoteImage(item.url)})`
                                : undefined,
                            }}
                          >
                            <span>{item.name}</span>
                            {wallpaper === item.url && !video && (
                              <Icon name="check" size={17} />
                            )}
                          </button>
                        ))}
                      </div>
                      <label className="upload-button">
                        <Icon name="plus" size={17} />
                        Upload wallpaper
                        <input
                          type="file"
                          accept="image/*,video/mp4,video/webm"
                          onChange={(event) => upload(event.target.files?.[0])}
                        />
                      </label>
                      <p className="hint">
                        Images or looping videos, saved locally to this profile.
                      </p>
                      <form
                        className="inline-form"
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (wallpaperPath) {
                            setVideo(
                              `/wallpapers/${wallpaperPath.replace(/^\/+/, "")}`,
                            )
                            setError("")
                          }
                        }}
                      >
                        <input
                          value={wallpaperPath}
                          onChange={(event) =>
                            setWallpaperPath(event.target.value)
                          }
                          placeholder="Preset filename, e.g. alpine.mp4"
                          aria-label="Video preset filename"
                        />
                        <button type="submit">Use</button>
                      </form>
                      <p className="hint">
                        Add preset MP4s to public/wallpapers/.
                      </p>
                      <p className="section-caption">Your signature color.</p>
                      <div className="accent-colors">
                        {[
                          "#b8a2ef",
                          "#a1c5ff",
                          "#9bd6b2",
                          "#f0bd9c",
                          "#f39cba",
                          "#e4e4e4",
                        ].map((color) => (
                          <button
                            key={color}
                            aria-label={`Accent ${color}`}
                            className={accent === color ? "selected" : ""}
                            style={{ background: color }}
                            onClick={() => setAccent(color)}
                          >
                            {accent === color && (
                              <Icon name="check" size={17} />
                            )}
                          </button>
                        ))}
                        <label title="Custom accent" className="custom-color">
                          <Icon name="plus" size={17} />
                          <input
                            type="color"
                            value={accent}
                            onChange={(event) => setAccent(event.target.value)}
                          />
                        </label>
                      </div>
                    </>
                  )}
                  {settingsPage === "New tab" && (
                    <>
                      {toggle("Show clock & date", showClock, () =>
                        setShowClock(!showClock),
                      )}
                      {toggle("Show bookmarks bar", showBookmarks, () =>
                        setShowBookmarks(!showBookmarks),
                      )}
                      {toggle(
                        "Focus mode · hide shortcuts",
                        extensions.focus,
                        () =>
                          setExtensions({
                            ...extensions,
                            focus: !extensions.focus,
                          }),
                      )}
                      <p className="section-caption">Your shortcuts</p>
                      {shortcuts.map((item) => (
                        <div className="list-row" key={item.domain}>
                          <img src={favicon(item.domain)} alt="" />
                          <span>{item.name}</span>
                          <Tool
                            icon="close"
                            label={`Remove ${item.name}`}
                            onClick={() =>
                              setShortcuts(
                                shortcuts.filter(
                                  (shortcut) => shortcut.domain !== item.domain,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                      <button
                        className="upload-button"
                        onClick={() => setPanel("shortcut")}
                      >
                        <Icon name="plus" size={16} />
                        Add shortcut
                      </button>
                    </>
                  )}
                  {settingsPage === "Extensions" && (
                    <>
                      <div className="extension-card"><Icon name="globe" size={25} /><div><strong>Auto-translate</strong><p>Open websites through Google’s translated view.</p></div>{toggle('Enable auto-translate', autoTranslate, () => setAutoTranslate(!autoTranslate))}</div><label className="field-label">Translate to<select value={language} onChange={event => setLanguage(event.target.value)}>{[['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic']].map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><p className="hint">Translation sends the page URL to Google. Some sites cannot be translated. Existing tabs refresh when the language changes.</p>
                      <p className="hint">
                        Built-in tools. Chrome CRX files cannot run in a web
                        page.
                      </p>
                      <div className="extension-card">
                        <Icon name="shield" size={25} />
                        <div>
                          <strong>Quiet web</strong>
                          <p>Block common advertising & tracking domains.</p>
                        </div>
                        {toggle("Enable ad blocker", extensions.blocker, () =>
                          setExtensions({
                            ...extensions,
                            blocker: !extensions.blocker,
                          }),
                        )}
                      </div>
                      <div className="extension-card">
                        <Icon name="moon" size={25} />
                        <div>
                          <strong>Night lens</strong>
                          <p>Dim bright sites with a dark color filter.</p>
                        </div>
                        {toggle("Enable night lens", extensions.dark, () =>
                          setExtensions({
                            ...extensions,
                            dark: !extensions.dark,
                          }),
                        )}
                      </div>
                      <div className="extension-card">
                        <Icon name="coffee" size={25} />
                        <div>
                          <strong>Focus</strong>
                          <p>A quieter new tab. Just you and your next idea.</p>
                        </div>
                        {toggle("Enable focus", extensions.focus, () =>
                          setExtensions({
                            ...extensions,
                            focus: !extensions.focus,
                          }),
                        )}
                      </div>
                    </>
                  )}
                  {settingsPage === "Connection" && (
                    <>
                      <p className="hint">
                        Browsing runs through caffeine's own proxy: a service
                        worker that fetches pages via /p/ and rewrites HTML, CSS
                        and images so sites load inside the tab. No Wisp server,
                        Scramjet or bare-mux is needed.
                      </p>
                      <p className="hint">
                        {proxyReady
                          ? "Proxy active. Sites load through this host."
                          : "Proxy starting… open a site or reload once the service worker activates."}
                      </p>
                      {serverBundled && (passwordRequired || serverAccess) && <div className="bundled-connect"><strong>This host can require an access password.</strong><p className="hint">{serverAccess ? "Server access is unlocked for this browser session." : "Enter the server access password to unlock browsing on this host."}</p>{!serverAccess && <input type="password" className="text-input" placeholder="Server access password" value={serverPassword} onChange={event => setServerPassword(event.target.value)} autoComplete="off" />}{!serverAccess && <button className="primary-button" onClick={connectBundled}>Unlock server</button>}</div>}
                      <p className="hint">
                        The preview host may restrict service workers. Deploy to
                        HTTPS or localhost. Brand icons use an image proxy until
                        the proxy is connected.
                      </p>
                      {toggle('Load remote images through a proxy', remoteImages, () => setRemoteImages(!remoteImages))}<p className="hint">No direct image fallback: connected browsing uses the built-in proxy; the bundled host uses its own /api/image endpoint; static previews use images.weserv.nl. Uploaded images stay local. Turning this off hides remote images.</p>
                      <details className="hosting-guide"><summary>Host at caffeine.lucasvass.uk</summary><ol><li>Use a Node host such as a VPS, Railway, or Render, not static-only Pages.</li><li>Install with <code>pnpm install</code>, build with <code>pnpm build:host</code>, and start with <code>pnpm start</code>.</li><li>Set <code>HOST=0.0.0.0</code>, <code>NODE_ENV=production</code>, and optionally a long <code>PROXY_PASSWORD</code>. Your host provides <code>PORT</code>.</li><li>Attach <code>caffeine.lucasvass.uk</code> to the host. Add the CNAME or A record it specifies in Cloudflare DNS and enable HTTPS.</li><li>No separate proxy server is needed — the included Node server also serves the /p/ proxy traffic used by the service worker.</li></ol><p>Cloudflare Pages can serve the frontend, but the /p/ proxy needs a real Node runtime (or a Worker rewrite), so a plain static host cannot browse for you.</p><p>Use a dedicated subdomain rather than an iframe on your main site. Service worker registration is not reliable inside cross-site embeds. Your existing website can link to the subdomain.</p></details>
                    </>
                  )}
                  {settingsPage === 'Passwords' && <>{toggle('Offer to save & autofill passwords', autofill, () => setAutofill(!autofill))}<p className="hint">Opt-in, best-effort support for conventional login forms. Saved credentials are AES-GCM encrypted locally with a key derived from your profile password/PIN. Incognito never saves or fills them. A long password is much safer than a short PIN.</p><p className="hint">A web proxy is not a hardened password manager. Do not store important or sensitive credentials here. Dynamic forms and translated pages may not support autofill.</p>{logins.map(login => <div className="list-row" key={login.id}><Icon name="shield" /><span>{login.host}<small className="login-username">{login.username}</small></span><Tool icon="close" label={`Delete login for ${login.host}`} onClick={() => removeLogin(login.id).catch(() => setError('Could not update vault.'))} /></div>)}{!logins.length && <p className="hint">No saved passwords.</p>}</>}
                  {settingsPage === "About" && (
                    <div className="about">
                      <Icon name="coffee" size={45} />
                      <h2>caffeine.</h2>
                      <p>
                        Made by <strong>34ms/lucas</strong>
                      </p>
                      <p className="hint">Your internet. A little more you.</p>
                      <p className="hint">
                        Powered by Scramjet & Bare Mux. A browser inside your
                        browser, not a replacement for Chrome. Native CRX
                        extensions, browser-level downloads and Chrome APIs are
                        not available.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : panel === "shortcut" ? (
              <form
                className="shortcut-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  try {
                    const domain = new URL(
                      shortcutUrl.includes("://")
                        ? shortcutUrl
                        : `https://${shortcutUrl}`,
                    ).hostname
                    if (!shortcutName || !domain.includes("."))
                      throw new Error()
                    setShortcuts([
                      ...shortcuts.filter((item) => item.domain !== domain),
                      { name: shortcutName, domain, color: "" },
                    ])
                    setHome(previous => ({ ...previous, widgets: { ...previous.widgets, [`shortcut:${domain}`]: { ...defaultHome().widgets.add, x: 50, y: 62, text: shortcutName } } }))
                    setShortcutName("")
                    setShortcutUrl("")
                    setPanel("")
                  } catch {
                    setError("Enter a name and valid website URL.")
                  }
                }}
              >
                <label>
                  Name
                  <input
                    required
                    className="text-input"
                    value={shortcutName}
                    onChange={(event) => setShortcutName(event.target.value)}
                    placeholder="Your favorite place"
                  />
                </label>
                <label>
                  URL
                  <input
                    required
                    className="text-input"
                    value={shortcutUrl}
                    onChange={(event) => setShortcutUrl(event.target.value)}
                    placeholder="example.com"
                  />
                </label>
                <button className="primary-button">Add shortcut</button>
              </form>
            ) : (
              <div className="simple-panel">
                {panel === "tabs" &&
                  tabs.map((tab) => (
                    <button
                      className="list-row"
                      key={tab.id}
                      onClick={() => {
                        setActiveId(tab.id)
                        setPanel("")
                      }}
                    >
                      <Icon name="globe" />
                      <span>{tab.title}</span>
                      {tab.id === activeId && <Icon name="check" />}
                    </button>
                  ))}
                {panel === "bookmarks" &&
                  bookmarks.map((item) => (
                    <div className="list-row" key={item.domain}>
                      <img src={favicon(item.domain)} alt="" />
                      <button onClick={() => navigate(item.domain)}>
                        {item.name}
                      </button>
                      <Tool
                        icon="close"
                        label="Remove bookmark"
                        onClick={() =>
                          setBookmarks(
                            bookmarks.filter(
                              (mark) => mark.domain !== item.domain,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                {panel === "history" && (
                  <>
                    <button
                      className="quiet-button"
                      onClick={() => setVisits([])}
                    >
                      Clear history
                    </button>
                    {visits.length ? (
                      visits.map((url) => (
                        <button
                          className="list-row"
                          key={url}
                          onClick={() => navigate(url)}
                        >
                          <Icon name="clock" />
                          <span>{url}</span>
                        </button>
                      ))
                    ) : (
                      <p className="hint">
                        Your browsing history will appear here.
                      </p>
                    )}
                  </>
                )}
                {panel === "downloads" && (
                  <p className="hint">
                    Downloads from proxied sites are handled by your real
                    browser. Open its downloads panel to view them.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      {pendingLogin && !active.private && <div className="password-prompt"><div><Icon name="shield" size={20} /><span><strong>Save this login?</strong><small>{pendingLogin.username} · {pendingLogin.host}</small></span></div><p>Encrypted on this device, in your profile.</p><div className="editor-actions"><button onClick={() => setPendingLogin(null)}>Not now</button><button onClick={() => saveLogin(pendingLogin).catch(() => setError('Could not save password.'))}>Save password</button></div></div>}
      {(!profile || panel === 'profiles' || panel === 'newprofile') && <div className="modal-backdrop profile-backdrop"><section className="profile-modal" role="dialog" aria-modal="true" aria-label={profiles.length === 0 ? 'Welcome to caffeine' : 'Profiles'}>
        <div className="profile-modal-top"><span className="small-wordmark"><Icon name="coffee" size={20} />caffeine.</span>{profile && <Tool icon="close" label="Close profiles" onClick={() => { setPanel(''); setUnlockId(''); setUnlockPin('') }} />}</div>
        {(profiles.length === 0 || panel === 'newprofile') ? <>
          {profiles.length === 0 && <div className="onboarding-progress">{[0, 1, 2].map(step => <span className={onboardStep >= step ? 'filled' : ''} key={step} />)}<small>0{onboardStep + 1} / 03</small></div>}
          {(profiles.length > 0 || onboardStep === 0) && <div className="onboarding-step"><span className="eyebrow">YOUR SPACE STARTS HERE</span><h2>A browser that’s<br />a little more you.</h2>{profiles.length === 0 && <p className="official-proxy">crypted’s official proxy.</p>}<form onSubmit={event => { event.preventDefault(); if (profiles.length === 0) setOnboardStep(1); else createProfile() }}><div className="profile-avatar-upload"><label className="avatar-preview">{profileForm.avatar ? <img src={profileForm.avatar} alt="Your avatar" /> : <span>{profileForm.name[0] || '+'}</span>}<input type="file" accept="image/*" onChange={event => uploadSmall(event.target.files?.[0], 'avatar')} /></label><span>Pick a photo.<small>Or keep it simple.</small></span></div><label className="field-label">Your name<input className="text-input" required maxLength={32} value={profileForm.name} onChange={event => setProfileForm({ ...profileForm, name: event.target.value })} placeholder="What should we call you?" autoComplete="nickname" /></label><label className="field-label">Profile password or PIN<input className="text-input" type="password" required minLength={4} maxLength={128} value={profileForm.pin} onChange={event => setProfileForm({ ...profileForm, pin: event.target.value })} placeholder="At least 4 characters" autoComplete="new-password" /></label><p className="hint">Local to this browser. No cloud account or password recovery. Use a long password for stronger protection.</p><button className="primary-button onboarding-next" disabled={busy}>{busy ? 'Creating…' : profiles.length ? 'Create profile' : 'Make it mine'}<Icon name="forward" size={16} /></button></form></div>}
          {profiles.length === 0 && onboardStep === 1 && <div className="onboarding-step"><span className="eyebrow">SET THE SCENE</span><h2>Your own little<br />escape.</h2><p className="hint">Start with a view. Everything can change later.</p><div className="wallpaper-grid onboarding-wallpapers">{wallpapers.map(item => <button key={item.name} className={`wallpaper-choice ${wallpaper === item.url && !video ? 'chosen' : ''}`} style={{ backgroundImage: item.url ? `url(${remoteImage(item.url)})` : undefined }} onClick={() => { setWallpaper(item.url); setVideo('') }}><span>{item.name}</span>{wallpaper === item.url && !video && <Icon name="check" size={17} />}</button>)}</div><label className="upload-button"><Icon name="image" size={16} />Or upload your own<input type="file" accept="image/*,video/mp4,video/webm" onChange={event => upload(event.target.files?.[0])} /></label><p className="section-caption">A signature color</p><div className="accent-colors">{['#b8a2ef', '#a1c5ff', '#9bd6b2', '#f0bd9c', '#f39cba'].map(color => <button style={{ background: color }} className={color === accent ? 'selected' : ''} key={color} aria-label={`Accent ${color}`} onClick={() => setAccent(color)}>{accent === color && <Icon name="check" size={16} />}</button>)}</div><div className="onboarding-buttons"><button className="quiet-button" onClick={() => setOnboardStep(0)}>Back</button><button className="primary-button" onClick={() => setOnboardStep(2)}>Looks like me<Icon name="forward" size={16} /></button></div></div>}
          {profiles.length === 0 && onboardStep === 2 && <div className="onboarding-step"><span className="eyebrow">ONE LAST THING</span><h2>Your internet.<br />Your rules.</h2><p className="hint">The canvas works immediately. Browsing runs through caffeine's built-in proxy as soon as your profile opens.</p>{serverBundled ? <div className="setup-included"><Icon name="shield" size={25} /><div><strong>Proxy is already included.</strong><p>This host serves the /p/ proxy directly — no separate Wisp server needed.</p></div></div> : <p className="hint">Hosting instructions are ready in Settings → Connection.</p>}{toggle('Block ads & trackers', extensions.blocker, () => setExtensions({ ...extensions, blocker: !extensions.blocker }))}{toggle('Custom home cursor', home.cursor, () => setHome({ ...home, cursor: !home.cursor }))}<div className="onboarding-buttons"><button className="quiet-button" onClick={() => setOnboardStep(1)}>Back</button><button className="primary-button" disabled={busy} onClick={createProfile}>{busy ? 'Creating your space…' : 'Let’s go'}<Icon name="forward" size={16} /></button></div></div>}
        </> : <div className="onboarding-step"><span className="eyebrow">YOUR LOCAL PROFILES</span><h2>{profile ? 'Make yourself at home.' : 'Welcome back.'}</h2><p className="hint">Separate layouts, bookmarks, history and encrypted vaults. Website cookies remain shared on this proxy origin.</p><div className="profile-list">{profiles.map(item => <button className={`profile-card ${unlockId === item.id ? 'chosen' : ''}`} key={item.id} onClick={() => { if (profile?.id === item.id) setPanel(''); else { setUnlockId(item.id); setUnlockPin('') } }}><span className="avatar-preview">{item.avatar ? <img src={item.avatar} alt="" /> : item.name[0]}</span><span>{item.name}<small>{profile?.id === item.id ? 'Current profile' : 'Unlock to enter'}</small></span><Icon name={profile?.id === item.id ? 'check' : 'forward'} size={16} /></button>)}</div>{unlockId && <form className="profile-unlock" onSubmit={event => { event.preventDefault(); unlockProfile() }}><input className="text-input" type="password" autoFocus value={unlockPin} onChange={event => setUnlockPin(event.target.value)} placeholder="Profile password or PIN" required autoComplete="current-password" /><button className="primary-button" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}<Icon name="forward" size={15} /></button></form>}<div className="editor-actions"><button onClick={() => { setProfileForm({ name: '', pin: '', avatar: '' }); setPanel('newprofile') }}>+ New profile</button>{profile && <button onClick={lockProfile}>Lock profile</button>}</div><p className="hint">Profiles are local conveniences, not isolated Chrome accounts. Keep this site on its own subdomain.</p></div>}
      </section></div>}
    </div>
  )
}
