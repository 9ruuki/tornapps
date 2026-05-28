import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

type Locale = "en" | "es";
type ToolId = "overview" | "api" | "travel" | "history" | "settings";
type Status = "idle" | "loading" | "success" | "error";
type AuditEvent = { id: string; time: string; type: string; message: string };
type Probe = { label: string; endpoint: string; ok: boolean; error?: string };
type TravelPlan = { id: string; time: string; destination: string; capacity: number; buy: number; sell: number; profit: number; profitHour: number };

const TORN_API_PAGE = "https://www.torn.com/preferences.php#tab=api";
const REQUIRED_ENDPOINTS = ["key/info", "user/basic", "user/cooldowns", "user/bars", "user/travel", "user/networth"];
const destinations = [["Mexico", "Mexico", 18], ["Cayman Islands", "Islas Caiman", 35], ["Canada", "Canada", 41], ["Hawaii", "Hawaii", 94], ["United Kingdom", "Reino Unido", 111], ["Argentina", "Argentina", 117], ["Switzerland", "Suiza", 123], ["Japan", "Japon", 158], ["China", "China", 169], ["United Arab Emirates", "Emiratos Arabes", 190], ["South Africa", "Sudafrica", 208]] as const;
const tools: Array<{ id: ToolId; icon: string; en: string; es: string; descEn: string; descEs: string }> = [
  { id: "overview", icon: "⌘", en: "Overview", es: "Resumen", descEn: "Build status", descEs: "Estado" },
  { id: "api", icon: "◇", en: "Custom API Key", es: "API Key Custom", descEn: "Required first", descEs: "Primero" },
  { id: "travel", icon: "✈", en: "Travel Planner", es: "Viajes", descEn: "Manual ROI", descEs: "ROI manual" },
  { id: "history", icon: "≡", en: "History", es: "Historial", descEn: "Local events", descEs: "Eventos" },
  { id: "settings", icon: "⚙", en: "Settings", es: "Ajustes", descEn: "Privacy", descEs: "Privacidad" }
];

function tr(locale: Locale, en: string, es: string) { return locale === "es" ? es : en; }
function load<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function save(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
function money(value: number) { return `$${Math.round(value).toLocaleString()}`; }
function audit(type: string, message: string) { const next = [{ id: crypto.randomUUID(), time: new Date().toISOString(), type, message }, ...load<AuditEvent[]>("ta.audit", [])].slice(0, 80); save("ta.audit", next); return next; }
async function callTorn(endpoint: string, key: string) { const sep = endpoint.includes("?") ? "&" : "?"; const res = await fetch(`https://api.torn.com/v2/${endpoint}${sep}comment=TornApps`, { headers: { Authorization: `ApiKey ${key}` } }); const data = await res.json(); if (!res.ok || (data && typeof data === "object" && "error" in data)) throw new Error(JSON.stringify(data)); return data; }
function accessType(payload: unknown) { const text = JSON.stringify(payload).toLowerCase(); if (text.includes("full")) return "full"; if (text.includes("limited")) return "limited"; if (text.includes("minimal")) return "minimal"; if (text.includes("public")) return "public"; if (text.includes("custom")) return "custom"; return "unknown"; }

function App() {
  const [locale, setLocale] = useState<Locale>((localStorage.getItem("ta.locale") as Locale) || "en");
  const [active, setActive] = useState<ToolId>((localStorage.getItem("ta.active") as ToolId) || "api");
  const [apiKey, setApiKey] = useState(localStorage.getItem("ta.apiKey") || "");
  const [apiStatus, setApiStatus] = useState<Status>(apiKey ? "success" : "idle");
  const [message, setMessage] = useState("");
  const [probes, setProbes] = useState<Probe[]>(load<Probe[]>("ta.probes", []));
  const [events, setEvents] = useState<AuditEvent[]>(load<AuditEvent[]>("ta.audit", []));
  const [plans, setPlans] = useState<TravelPlan[]>(load<TravelPlan[]>("ta.travelPlans", []));
  const [dest, setDest] = useState(0); const [capacity, setCapacity] = useState(19); const [buy, setBuy] = useState(0); const [sell, setSell] = useState(0); const [stay, setStay] = useState(0);
  const tool = tools.find(x => x.id === active) || tools[0];
  const tripTime = Number(destinations[dest][2]) * 2 + stay; const profit = (sell - buy) * capacity; const profitHour = tripTime ? profit / (tripTime / 60) : 0;
  const customReady = apiStatus === "success" && probes.length > 0 && probes.every(p => p.ok);
  const setTool = (id: ToolId) => { setActive(id); localStorage.setItem("ta.active", id); };
  const log = (type: string, text: string) => setEvents(audit(type, text));
  const toggleLocale = () => { const next = locale === "en" ? "es" : "en"; setLocale(next); localStorage.setItem("ta.locale", next); };

  async function copyRequirements() { await navigator.clipboard.writeText(`TornApps custom key\nRequired endpoints:\n${REQUIRED_ENDPOINTS.join("\n")}`); setMessage(tr(locale, "Permission checklist copied.", "Lista de permisos copiada.")); }
  async function validateCustomKey() {
    const key = apiKey.trim();
    if (key.length < 8) { setApiStatus("error"); setMessage(tr(locale, "Paste a Custom API key first.", "Pega primero una API key Custom.")); return; }
    setApiStatus("loading"); setMessage(tr(locale, "Checking key type and required endpoints...", "Comprobando tipo de key y endpoints requeridos..."));
    try {
      const info = await callTorn("key/info", key);
      const type = accessType(info);
      if (type !== "custom") throw new Error(tr(locale, `Rejected: key type is ${type}. TornApps only accepts Custom keys.`, `Rechazada: la key es ${type}. TornApps solo acepta keys Custom.`));
      const results: Probe[] = [];
      for (const endpoint of REQUIRED_ENDPOINTS) {
        try { await callTorn(endpoint, key); results.push({ label: endpoint, endpoint, ok: true }); }
        catch (error) { results.push({ label: endpoint, endpoint, ok: false, error: error instanceof Error ? error.message : "failed" }); }
      }
      setProbes(results); save("ta.probes", results);
      const missing = results.filter(r => !r.ok);
      if (missing.length) { setApiStatus("error"); setMessage(tr(locale, `Custom key detected, but ${missing.length} required permissions are missing.`, `Key Custom detectada, pero faltan ${missing.length} permisos requeridos.`)); log("api_missing_permissions", missing.map(x => x.endpoint).join(", ")); return; }
      localStorage.setItem("ta.apiKey", key); setApiStatus("success"); setMessage(tr(locale, "Custom key approved. All required checks passed.", "Key Custom aprobada. Todos los checks han pasado.")); log("api_custom_valid", "all required probes passed");
    } catch (error) { setApiStatus("error"); setMessage(error instanceof Error ? error.message : "Validation failed"); log("api_rejected", "custom validation failed"); }
  }
  function savePlan() { const entry = { id: crypto.randomUUID(), time: new Date().toISOString(), destination: String(destinations[dest][0]), capacity, buy, sell, profit, profitHour }; const next = [entry, ...plans].slice(0, 50); setPlans(next); save("ta.travelPlans", next); log("travel_plan", "saved travel plan"); }
  function clearData() { ["ta.apiKey", "ta.probes", "ta.audit", "ta.travelPlans"].forEach(k => localStorage.removeItem(k)); setApiKey(""); setApiStatus("idle"); setProbes([]); setEvents([]); setPlans([]); setMessage(""); }

  return <div className="app"><aside className="sidebar"><div className="brand"><Logo /><div><strong>TornApps</strong><span>{tr(locale, "Custom-key workspace", "Workspace con key Custom")}</span></div></div><nav>{tools.map(x => <button key={x.id} className={active === x.id ? "active" : ""} onClick={() => setTool(x.id)}><b>{x.icon}</b><span>{x[locale]}</span><small>{x[`desc${locale === "en" ? "En" : "Es"}` as "descEn"]}</small></button>)}</nav></aside><main className="main"><header><div><p className="eyebrow">{tool[locale]}</p><h1>{tr(locale, "Custom key first. Tools after.", "Primero key Custom. Luego herramientas.")}</h1><p className="subtle">{tr(locale, "Limited, Minimal, Public and Full Access keys are rejected. TornApps only runs with a Custom key.", "Limited, Minimal, Public y Full Access se rechazan. TornApps solo funciona con key Custom.")}</p></div><button className="btn" onClick={toggleLocale}>{locale.toUpperCase()}</button></header><section className="tiles"><Tile label="Key" value={customReady ? "Custom OK" : "Not ready"} /><Tile label="Checks" value={`${probes.filter(p => p.ok).length}/${REQUIRED_ENDPOINTS.length}`} /><Tile label="Plans" value={String(plans.length)} /><Tile label="Events" value={String(events.length)} /></section>{active === "overview" && <Panel title="Checkpoint R3" subtitle={tr(locale, "The app is currently focused on making API access correct before adding more tools.", "La app esta centrada en corregir el acceso API antes de anadir mas herramientas.")}><CheckList probes={probes} /></Panel>}{active === "api" && <Panel title="Custom API Key" subtitle={tr(locale, "Create a Custom key named TornApps, copy the permissions checklist, then validate it here.", "Crea una key Custom llamada TornApps, copia la lista de permisos y validala aqui.")}><div className="actions"><a className="btn primary" href={TORN_API_PAGE} target="_blank" rel="noreferrer">{tr(locale, "Create Custom Key on Torn", "Crear Custom Key en Torn")}</a><button className="btn" onClick={() => void copyRequirements()}>{tr(locale, "Copy required permissions", "Copiar permisos requeridos")}</button></div><p className="subtle">{tr(locale, "Name/comment: TornApps. Select every endpoint listed below. Torn does not reliably support pre-filling custom-key permissions from a static app, so TornApps validates them after paste.", "Nombre/comment: TornApps. Selecciona todos los endpoints listados abajo. Torn no permite pre-rellenar permisos de forma fiable desde una app estatica, asi que TornApps los valida despues de pegar la key.")}</p><input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste Custom API key" /><div className="actions"><button className="btn primary" onClick={() => void validateCustomKey()}>{tr(locale, "Validate Custom Key", "Validar Custom Key")}</button><button className="btn danger" onClick={clearData}>{tr(locale, "Clear local data", "Borrar datos locales")}</button></div><Notice status={apiStatus} text={message} /><CheckList probes={probes} /></Panel>}{active === "travel" && <Panel title={tr(locale, "Travel Planner", "Planificador de viajes")} subtitle={tr(locale, "Manual travel profit calculator. Works without API once values are entered.", "Calculadora manual de viajes. Funciona sin API al introducir valores.")}><div className="form"><select className="input" value={dest} onChange={e => setDest(Number(e.target.value))}>{destinations.map((d, i) => <option key={d[0]} value={i}>{locale === "en" ? d[0] : d[1]} · {d[2]}m</option>)}</select><input className="input" type="number" value={capacity} onChange={e => setCapacity(Number(e.target.value) || 0)} placeholder="Capacity" /><input className="input" type="number" value={buy} onChange={e => setBuy(Number(e.target.value) || 0)} placeholder="Buy price" /><input className="input" type="number" value={sell} onChange={e => setSell(Number(e.target.value) || 0)} placeholder="Sell price" /><input className="input" type="number" value={stay} onChange={e => setStay(Number(e.target.value) || 0)} placeholder="Extra minutes" /></div><section className="tiles"><Tile label="Trip" value={`${tripTime}m`} /><Tile label="Profit" value={money(profit)} /><Tile label="Profit/hour" value={money(profitHour)} /></section><button className="btn primary" onClick={savePlan}>Save plan</button></Panel>}{active === "history" && <Panel title="History" subtitle="Local events.">{events.map(e => <div className="rowline" key={e.id}><strong>{e.type}</strong><span>{new Date(e.time).toLocaleString()}</span><p>{e.message}</p></div>)}</Panel>}{active === "settings" && <Panel title="Settings" subtitle="Local privacy controls."><button className="btn danger" onClick={clearData}>Delete local data</button></Panel>}<nav className="mobile">{tools.map(x => <button key={x.id} className={active === x.id ? "active" : ""} onClick={() => setTool(x.id)}>{x.icon}</button>)}</nav></main></div>;
}

function Logo() { return <div className="ta-logo"><span>T</span><i>A</i></div>; }
function Tile({ label, value }: { label: string; value: string }) { return <div className="tile"><span>{label}</span><strong>{value}</strong></div>; }
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-head"><h2>{title}</h2><p>{subtitle}</p></div>{children}</section>; }
function Notice({ status, text }: { status: Status; text: string }) { return text ? <p className={`notice ${status}`}>{text}</p> : null; }
function CheckList({ probes }: { probes: Probe[] }) { const map = new Map(probes.map(p => [p.endpoint, p])); return <div className="checklist">{REQUIRED_ENDPOINTS.map(endpoint => { const probe = map.get(endpoint); return <div key={endpoint} className={probe?.ok ? "ok" : probe ? "bad" : "pending"}><span>{probe?.ok ? "✓" : probe ? "!" : "•"}</span><strong>{endpoint}</strong><small>{probe?.ok ? "OK" : probe?.error ? "Missing or blocked" : "Required"}</small></div>; })}</div>; }

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
