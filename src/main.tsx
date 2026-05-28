import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

type Locale = "en" | "es";
type KeyState = "empty" | "validating" | "valid" | "blocked" | "error";
type ApiKeyMeta = { accessLevel: string; selections: string[]; validatedAt: string; raw: unknown };
type AuditEvent = { id: string; time: string; type: string; message: string };

const modules = [
  { en: "Overview", es: "Resumen", scopes: "public", ready: true },
  { en: "Cooldowns", es: "Cooldowns", scopes: "minimal: user/cooldowns, user/bars", ready: false },
  { en: "Profile", es: "Perfil", scopes: "public/minimal: user/basic, user/education", ready: false },
  { en: "Travel", es: "Viajes", scopes: "public/minimal: user/travel + public market data", ready: false },
  { en: "Market", es: "Mercado", scopes: "public: market and item endpoints", ready: false },
  { en: "Networth", es: "Networth", scopes: "limited/custom: user/networth", ready: false },
  { en: "History", es: "Historial", scopes: "browser storage, 30-day local retention", ready: false },
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

async function validateTornKey(apiKey: string): Promise<ApiKeyMeta> {
  const response = await fetch("https://api.torn.com/v2/key/info?comment=TornApps", {
    headers: { Authorization: `ApiKey ${apiKey}` }
  });
  const data = await response.json();
  if (!response.ok || (data && typeof data === "object" && "error" in data)) {
    const message = JSON.stringify(data);
    throw new Error(message || `Torn API returned ${response.status}`);
  }
  const meta = inferKeyMeta(data);
  if (meta.accessLevel === "Full Access") {
    throw new Error("Full Access keys are blocked. Create a Public, Minimal, Limited, or Custom Torn API key instead.");
  }
  return meta;
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
  const isEs = locale === "es";
  const names = useMemo(() => modules.map((module) => (isEs ? module.es : module.en)), [isEs]);

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

  return <div className="shell"><aside><div className="brand"><div className="logo small">TA</div><div><strong>TornApps</strong><span>M1 key validation</span></div></div><nav>{names.slice(0,4).map((name) => <a key={name} href={name === names[0] ? "#dashboard" : "#modules"}>{name}</a>)}</nav></aside><main className="content"><header><div><p className="eyebrow">{isEs ? "Privacidad primero" : "Privacy first"}</p><h1>{isEs ? "Centro de mando personal" : "Personal command center"}</h1><p className="muted">{isEs ? "M1 valida tu API key con key/info y bloquea Full Access." : "M1 validates your API key with key/info and blocks Full Access."}</p></div><button className="ghost" onClick={toggleLocale}>{locale.toUpperCase()}</button></header><section id="dashboard" className="hero card"><div><h2>{isEs ? "Configurar API key" : "API key setup"}</h2><p>{isEs ? "La key se guarda solo en localStorage de este navegador. No hay backend ni servidor." : "The key is stored only in this browser localStorage. There is no backend or server storage."}</p><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEs ? "Pega tu Torn API key" : "Paste your Torn API key"} /><div className="buttonrow"><button className="primary inline" onClick={() => void validateKey()} disabled={keyState === "validating"}>{keyState === "validating" ? (isEs ? "Validando..." : "Validating...") : (isEs ? "Validar key" : "Validate key")}</button><button className="ghost" onClick={resetKey}>{isEs ? "Eliminar" : "Reset"}</button></div>{message ? <p className={`notice ${keyState}`}>{message}</p> : null}</div><div className="security card"><h3>{isEs ? "Estado de key" : "Key status"}</h3><p><strong>{isEs ? "Estado" : "Status"}:</strong> {keyState}</p><p><strong>{isEs ? "Acceso" : "Access"}:</strong> {keyMeta?.accessLevel || "Not validated"}</p><p><strong>{isEs ? "Validada" : "Validated"}:</strong> {keyMeta ? new Date(keyMeta.validatedAt).toLocaleString() : "-"}</p></div></section><section id="modules" className="grid">{modules.map((module, index) => <article className="card module" key={module.en}><div className="row"><h3>{names[index]}</h3><span>{module.ready ? (isEs ? "Listo" : "Ready") : (isEs ? "Plan" : "Planned")}</span></div><p>{module.scopes}</p></article>)}</section><section className="card audit"><h2>{isEs ? "Auditoria local" : "Local audit"}</h2>{auditEvents.length === 0 ? <p>{isEs ? "Sin eventos todavia." : "No events yet."}</p> : auditEvents.slice(0,5).map((event) => <p key={event.id}><strong>{event.type}</strong> · {new Date(event.time).toLocaleString()} · {event.message}</p>)}</section></main></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
