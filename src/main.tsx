import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

type Locale = "en" | "es";
type KeyState = "empty" | "validating" | "valid" | "blocked" | "error";
type FetchState = "idle" | "loading" | "success" | "error";
type ApiKeyMeta = { accessLevel: string; selections: string[]; validatedAt: string; raw: unknown };
type AuditEvent = { id: string; time: string; type: string; message: string };
type CooldownSnapshot = { id: string; time: string; cooldowns: unknown; bars: unknown };

type ModuleConfig = {
  en: string;
  es: string;
  scopes: string;
  ready: boolean;
};

const modules: ModuleConfig[] = [
  { en: "Overview", es: "Resumen", scopes: "public", ready: true },
  { en: "Cooldowns", es: "Cooldowns", scopes: "minimal: user/cooldowns, user/bars", ready: true },
  { en: "Profile", es: "Perfil", scopes: "public/minimal: user/basic, user/education", ready: false },
  { en: "Travel", es: "Viajes", scopes: "public/minimal: user/travel + public market data", ready: false },
  { en: "Market", es: "Mercado", scopes: "public: market and item endpoints", ready: false },
  { en: "Networth", es: "Networth", scopes: "limited/custom: user/networth", ready: false },
  { en: "History", es: "Historial", scopes: "browser storage, 30-day local retention", ready: true },
  { en: "Settings", es: "Ajustes", scopes: "none", ready: true }
];

function loadJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function addAudit(type: string, message: string) {
  const events = loadJson<AuditEvent[]>("tornapps:audit", []);
  const next = [{ id: crypto.randomUUID(), time: new Date().toISOString(), type, message }, ...events].slice(0, 50);
  saveJson("tornapps:audit", next);
  return next;
}

function flattenValues(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flattenValues);
  return [];
}

function inferKeyMeta(data: unknown): ApiKeyMeta {
  const values = flattenValues(data);
  const lower = values.map((value) => value.toLowerCase());
  const jsonLower = JSON.stringify(data).toLowerCase();
  const accessLevel = jsonLower.includes("full")
    ? "Full Access"
    : jsonLower.includes("limited")
      ? "Limited"
      : jsonLower.includes("minimal")
        ? "Minimal"
        : jsonLower.includes("custom")
          ? "Custom"
          : "Public or Custom";
  const selections = values
    .filter((value) => value.includes("/") || ["public", "minimal", "limited", "custom", "full"].includes(value.toLowerCase()))
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 40);
  const likelyFull = accessLevel === "Full Access" || lower.includes("full") || lower.includes("full access");
  return { accessLevel: likelyFull ? "Full Access" : accessLevel, selections, validatedAt: new Date().toISOString(), raw: data };
}

async function fetchTorn(endpoint: string, apiKey: string): Promise<unknown> {
  const separator = endpoint.includes("?") ? "&" : "?";
  const response = await fetch(`https://api.torn.com/v2${endpoint}${separator}comment=TornApps`, {
    headers: { Authorization: `ApiKey ${apiKey}` }
  });
  const data = await response.json();
  if (!response.ok || (data && typeof data === "object" && "error" in data)) {
    throw new Error(JSON.stringify(data) || `Torn API returned ${response.status}`);
  }
  return data;
}

async function validateTornKey(apiKey: string): Promise<ApiKeyMeta> {
  const meta = inferKeyMeta(await fetchTorn("/key/info", apiKey));
  if (meta.accessLevel === "Full Access") {
    throw new Error("Full Access keys are blocked. Create a Public, Minimal, Limited, or Custom Torn API key instead.");
  }
  return meta;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function extractNestedRecord(data: unknown, key: string): Record<string, unknown> {
  const record = asRecord(data);
  const nested = record ? asRecord(record[key]) : null;
  return nested ?? record ?? {};
}

function extractNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function getBarSummaries(bars: unknown) {
  const root = extractNestedRecord(bars, "bars");
  return Object.entries(root).flatMap(([name, value]) => {
    const record = asRecord(value);
    if (!record) return [];
    const current = extractNumber(record, ["current", "value", "amount"]);
    const maximum = extractNumber(record, ["maximum", "max"]);
    const tickTime = extractNumber(record, ["tick_time", "tickTime", "next", "time"]);
    return [{ name, current, maximum, tickTime }];
  });
}

function getCooldownSummaries(cooldowns: unknown) {
  const root = extractNestedRecord(cooldowns, "cooldowns");
  return Object.entries(root).flatMap(([name, value]) => {
    if (typeof value === "number") return [{ name, seconds: value }];
    const record = asRecord(value);
    const seconds = record ? extractNumber(record, ["seconds", "time", "remaining", "cooldown"]): null;
    return seconds === null ? [] : [{ name, seconds }];
  });
}

function getNextAction(cooldowns: unknown, bars: unknown, isEs: boolean): string {
  const barSummaries = getBarSummaries(bars);
  const energy = barSummaries.find((bar) => bar.name.toLowerCase().includes("energy"));
  const nerve = barSummaries.find((bar) => bar.name.toLowerCase().includes("nerve"));
  if (energy?.current !== null && energy?.maximum !== null && energy?.current === energy?.maximum) {
    return isEs ? "Energia llena: gastala antes de viajar o esperar." : "Energy is full: spend it before travelling or waiting.";
  }
  if (nerve?.current !== null && nerve?.maximum !== null && nerve?.current === nerve?.maximum) {
    return isEs ? "Nerve lleno: haz crimenes antes de esperar." : "Nerve is full: use crimes before waiting.";
  }
  const readyCooldowns = getCooldownSummaries(cooldowns).filter((cooldown) => cooldown.seconds <= 0).map((cooldown) => cooldown.name);
  if (readyCooldowns.length > 0) {
    return isEs ? `Listo ahora: ${readyCooldowns.join(", ")}.` : `Ready now: ${readyCooldowns.join(", ")}.`;
  }
  return isEs ? "Nada urgente detectado. Revisa cooldowns y barras cuando cambien." : "No urgent action detected. Recheck cooldowns and bars when they change.";
}

function saveCooldownSnapshot(cooldowns: unknown, bars: unknown): CooldownSnapshot[] {
  const snapshots = loadJson<CooldownSnapshot[]>("tornapps:cooldownSnapshots", []);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const next = [{ id: crypto.randomUUID(), time: new Date().toISOString(), cooldowns, bars }, ...snapshots]
    .filter((snapshot) => new Date(snapshot.time).getTime() >= cutoff)
    .slice(0, 200);
  saveJson("tornapps:cooldownSnapshots", next);
  return next;
}

function App() {
  const [locale, setLocale] = useState<Locale>((localStorage.getItem("tornapps:locale") as Locale) || "en");
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [apiKey, setApiKey] = useState(localStorage.getItem("tornapps:apiKey") || "");
  const [keyState, setKeyState] = useState<KeyState>(apiKey ? "valid" : "empty");
  const [keyMeta, setKeyMeta] = useState<ApiKeyMeta | null>(loadJson<ApiKeyMeta | null>("tornapps:keyMeta", null));
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(loadJson<AuditEvent[]>("tornapps:audit", []));
  const [message, setMessage] = useState<string>("");
  const [cooldownState, setCooldownState] = useState<FetchState>("idle");
  const [cooldownMessage, setCooldownMessage] = useState("");
  const [cooldowns, setCooldowns] = useState<unknown>(null);
  const [bars, setBars] = useState<unknown>(null);
  const [snapshots, setSnapshots] = useState<CooldownSnapshot[]>(loadJson<CooldownSnapshot[]>("tornapps:cooldownSnapshots", []));
  const isEs = locale === "es";
  const names = useMemo(() => modules.map((module) => (isEs ? module.es : module.en)), [isEs]);
  const cooldownSummary = getCooldownSummaries(cooldowns);
  const barSummary = getBarSummaries(bars);

  function toggleLocale() {
    const next = isEs ? "en" : "es";
    localStorage.setItem("tornapps:locale", next);
    setLocale(next);
  }

  async function validateKey() {
    const trimmed = apiKey.trim();
    if (trimmed.length < 8) {
      setKeyState("error");
      setMessage(isEs ? "Introduce una API key valida." : "Enter a valid API key.");
      return;
    }
    setKeyState("validating");
    setMessage(isEs ? "Validando con Torn..." : "Validating with Torn...");
    try {
      const meta = await validateTornKey(trimmed);
      localStorage.setItem("tornapps:apiKey", trimmed);
      saveJson("tornapps:keyMeta", meta);
      setKeyMeta(meta);
      setKeyState("valid");
      setMessage(isEs ? "API key validada. La key queda solo en este navegador." : "API key validated. The key stays in this browser only.");
      setAuditEvents(addAudit("key_validated", `Validated ${meta.accessLevel} key`));
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown validation error.";
      const blocked = text.toLowerCase().includes("full access");
      setKeyState(blocked ? "blocked" : "error");
      setMessage(text);
      setAuditEvents(addAudit(blocked ? "key_blocked" : "key_error", blocked ? "Blocked Full Access key" : "Key validation failed"));
    }
  }

  async function refreshCooldowns() {
    const storedKey = apiKey.trim() || localStorage.getItem("tornapps:apiKey") || "";
    if (!storedKey) {
      setCooldownState("error");
      setCooldownMessage(isEs ? "Primero valida una API key Minimal o Custom." : "Validate a Minimal or Custom API key first.");
      return;
    }
    setCooldownState("loading");
    setCooldownMessage(isEs ? "Actualizando cooldowns y barras..." : "Refreshing cooldowns and bars...");
    try {
      const [cooldownsData, barsData] = await Promise.all([
        fetchTorn("/user/cooldowns", storedKey),
        fetchTorn("/user/bars", storedKey)
      ]);
      setCooldowns(cooldownsData);
      setBars(barsData);
      setSnapshots(saveCooldownSnapshot(cooldownsData, barsData));
      setCooldownState("success");
      setCooldownMessage(isEs ? "Cooldowns actualizados." : "Cooldowns refreshed.");
      setAuditEvents(addAudit("cooldowns_refreshed", "Fetched user/cooldowns and user/bars"));
    } catch (error) {
      setCooldownState("error");
      setCooldownMessage(error instanceof Error ? error.message : "Unknown cooldown refresh error.");
      setAuditEvents(addAudit("cooldowns_error", "Cooldown refresh failed"));
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setCooldownMessage(isEs ? "Este navegador no soporta notificaciones." : "This browser does not support notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification("TornApps", { body: isEs ? "Notificaciones activadas mientras la app este abierta." : "Notifications enabled while the app is open." });
    }
  }

  function resetKey() {
    localStorage.removeItem("tornapps:apiKey");
    localStorage.removeItem("tornapps:keyMeta");
    setApiKey("");
    setKeyMeta(null);
    setKeyState("empty");
    setMessage(isEs ? "API key eliminada del navegador." : "API key removed from browser.");
    setAuditEvents(addAudit("key_reset", "Removed browser-stored API key"));
  }

  if (!unlocked) {
    return <main className="lock"><section className="card lockcard"><div className="logo">TA</div><p className="eyebrow">{isEs ? "Asistente personal de Torn" : "Privacy-first Torn assistant"}</p><h1>{isEs ? "Desbloquear TornApps" : "Unlock TornApps"}</h1><p className="muted">{isEs ? "Bloqueo local del navegador. No uses tu contrasena de Torn." : "Local browser lock. Do not use your Torn password."}</p><input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={isEs ? "Frase local" : "Local passphrase"} /><button className="primary" onClick={() => setUnlocked(passphrase.length >= 4)}>{isEs ? "Entrar" : "Enter"}</button><button className="ghost" onClick={toggleLocale}>{isEs ? "English" : "Espanol"}</button></section></main>;
  }

  return <div className="shell"><aside><div className="brand"><div className="logo small">TA</div><div><strong>TornApps</strong><span>M2 cooldowns</span></div></div><nav>{names.slice(0,4).map((name) => <a key={name} href={name === names[0] ? "#dashboard" : "#modules"}>{name}</a>)}</nav></aside><main className="content"><header><div><p className="eyebrow">{isEs ? "Privacidad primero" : "Privacy first"}</p><h1>{isEs ? "Centro de mando personal" : "Personal command center"}</h1><p className="muted">{isEs ? "M2 lee cooldowns y barras con una key Minimal o Custom." : "M2 reads cooldowns and bars with a Minimal or Custom key."}</p></div><button className="ghost" onClick={toggleLocale}>{locale.toUpperCase()}</button></header><section id="dashboard" className="hero card"><div><h2>{isEs ? "Configurar API key" : "API key setup"}</h2><p>{isEs ? "La key se guarda solo en localStorage de este navegador. No hay backend ni servidor." : "The key is stored only in this browser localStorage. There is no backend or server storage."}</p><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEs ? "Pega tu Torn API key" : "Paste your Torn API key"} /><div className="buttonrow"><button className="primary inline" onClick={() => void validateKey()} disabled={keyState === "validating"}>{keyState === "validating" ? (isEs ? "Validando..." : "Validating...") : (isEs ? "Validar key" : "Validate key")}</button><button className="ghost" onClick={resetKey}>{isEs ? "Eliminar" : "Reset"}</button></div>{message ? <p className={`notice ${keyState}`}>{message}</p> : null}</div><div className="security card"><h3>{isEs ? "Estado de key" : "Key status"}</h3><p><strong>{isEs ? "Estado" : "Status"}:</strong> {keyState}</p><p><strong>{isEs ? "Acceso" : "Access"}:</strong> {keyMeta?.accessLevel || "Not validated"}</p><p><strong>{isEs ? "Validada" : "Validated"}:</strong> {keyMeta ? new Date(keyMeta.validatedAt).toLocaleString() : "-"}</p></div></section><section className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Cooldowns y barras" : "Cooldowns and bars"}</h2><p>{isEs ? "Primer modulo real: energia, nerve, happy y cooldowns principales." : "First live module: energy, nerve, happy, and major cooldowns."}</p></div><div className="buttonrow compact"><button className="primary inline" onClick={() => void refreshCooldowns()} disabled={cooldownState === "loading"}>{cooldownState === "loading" ? (isEs ? "Actualizando..." : "Refreshing...") : (isEs ? "Actualizar" : "Refresh")}</button><button className="ghost" onClick={() => void enableNotifications()}>{isEs ? "Notificaciones" : "Notifications"}</button></div></div>{cooldownMessage ? <p className={`notice ${cooldownState}`}>{cooldownMessage}</p> : null}<div className="next-action"><strong>{isEs ? "Siguiente accion:" : "Next action:"}</strong> {getNextAction(cooldowns, bars, isEs)}</div><div className="metric-grid"><div><h3>{isEs ? "Barras" : "Bars"}</h3>{barSummary.length === 0 ? <p className="muted">{isEs ? "Sin datos todavia." : "No data yet."}</p> : barSummary.map((bar) => <div className="metric" key={bar.name}><span>{bar.name}</span><strong>{bar.current ?? "?"} / {bar.maximum ?? "?"}</strong>{bar.tickTime ? <small>{isEs ? "Tick" : "Tick"}: {formatSeconds(bar.tickTime)}</small> : null}</div>)}</div><div><h3>{isEs ? "Cooldowns" : "Cooldowns"}</h3>{cooldownSummary.length === 0 ? <p className="muted">{isEs ? "Sin datos todavia." : "No data yet."}</p> : cooldownSummary.map((cooldown) => <div className="metric" key={cooldown.name}><span>{cooldown.name}</span><strong>{formatSeconds(cooldown.seconds)}</strong></div>)}</div></div><details className="raw"><summary>{isEs ? "Datos raw" : "Raw data"}</summary><pre>{JSON.stringify({ cooldowns, bars }, null, 2)}</pre></details></section><section id="modules" className="grid">{modules.map((module, index) => <article className="card module" key={module.en}><div className="row"><h3>{names[index]}</h3><span>{module.ready ? (isEs ? "Listo" : "Ready") : (isEs ? "Plan" : "Planned")}</span></div><p>{module.scopes}</p></article>)}</section><section className="card audit"><h2>{isEs ? "Historial local" : "Local history"}</h2><p>{isEs ? `${snapshots.length} snapshots de cooldowns guardados.` : `${snapshots.length} cooldown snapshots stored.`}</p>{auditEvents.length === 0 ? <p>{isEs ? "Sin eventos todavia." : "No events yet."}</p> : auditEvents.slice(0,5).map((event) => <p key={event.id}><strong>{event.type}</strong> · {new Date(event.time).toLocaleString()} · {event.message}</p>)}</section></main></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
