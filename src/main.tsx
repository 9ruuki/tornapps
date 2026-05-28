import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

type Locale = "en" | "es";
type ToolId = "overview" | "api" | "travel" | "history" | "settings";
type Status = "idle" | "loading" | "success" | "error";
type AuditEvent = { id: string; time: string; type: string; message: string };
type Probe = { label: string; endpoint: string; ok: boolean; error?: string };
type Destination = { id: string; en: string; es: string; minutes: number; risk: string };
type TravelRow = { destination: Destination; tripTime: number; profit: number; profitHour: number; tripsPerDay: number; dailyProfit: number; activity: string };
type TravelPlan = { id: string; time: string; destination: string; capacity: number; buy: number; sell: number; margin: number; tripTime: number; profit: number; profitHour: number };

const TORN_API_PAGE = "https://www.torn.com/preferences.php#tab=api";
const REQUIRED_ENDPOINTS = ["key/info", "user/basic", "user/cooldowns", "user/bars", "user/travel", "user/networth"];
const destinations: Destination[] = [
  { id: "mexico", en: "Mexico", es: "Mexico", minutes: 18, risk: "Low" },
  { id: "cayman", en: "Cayman Islands", es: "Islas Caiman", minutes: 35, risk: "Low" },
  { id: "canada", en: "Canada", es: "Canada", minutes: 41, risk: "Low" },
  { id: "hawaii", en: "Hawaii", es: "Hawaii", minutes: 94, risk: "Medium" },
  { id: "uk", en: "United Kingdom", es: "Reino Unido", minutes: 111, risk: "Medium" },
  { id: "argentina", en: "Argentina", es: "Argentina", minutes: 117, risk: "Medium" },
  { id: "switzerland", en: "Switzerland", es: "Suiza", minutes: 123, risk: "Medium" },
  { id: "japan", en: "Japan", es: "Japon", minutes: 158, risk: "High" },
  { id: "china", en: "China", es: "China", minutes: 169, risk: "High" },
  { id: "uae", en: "United Arab Emirates", es: "Emiratos Arabes", minutes: 190, risk: "High" },
  { id: "south-africa", en: "South Africa", es: "Sudafrica", minutes: 208, risk: "High" }
];
const tools: Array<{ id: ToolId; icon: string; en: string; es: string; descEn: string; descEs: string }> = [
  { id: "overview", icon: "⌘", en: "Overview", es: "Resumen", descEn: "Build status", descEs: "Estado" },
  { id: "api", icon: "◇", en: "Custom API Key", es: "API Key Custom", descEn: "Required first", descEs: "Primero" },
  { id: "travel", icon: "✈", en: "Travel Planner", es: "Viajes", descEn: "ROI engine", descEs: "Motor ROI" },
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
function safeNumber(value: string) { return Math.max(0, Number(value) || 0); }
function activityLabel(tripsPerDay: number) { if (tripsPerDay >= 12) return "High"; if (tripsPerDay >= 6) return "Medium"; return "Low"; }

function App() {
  const [locale, setLocale] = useState<Locale>((localStorage.getItem("ta.locale") as Locale) || "en");
  const [active, setActive] = useState<ToolId>((localStorage.getItem("ta.active") as ToolId) || "travel");
  const [apiKey, setApiKey] = useState(localStorage.getItem("ta.apiKey") || "");
  const [apiStatus, setApiStatus] = useState<Status>(apiKey ? "success" : "idle");
  const [message, setMessage] = useState("");
  const [probes, setProbes] = useState<Probe[]>(load<Probe[]>("ta.probes", []));
  const [events, setEvents] = useState<AuditEvent[]>(load<AuditEvent[]>("ta.audit", []));
  const [plans, setPlans] = useState<TravelPlan[]>(load<TravelPlan[]>("ta.travelPlans", []));
  const [destinationId, setDestinationId] = useState(localStorage.getItem("ta.travel.destination") || "mexico");
  const [capacity, setCapacity] = useState(load<number>("ta.travel.capacity", 19));
  const [buy, setBuy] = useState(load<number>("ta.travel.buy", 0));
  const [sell, setSell] = useState(load<number>("ta.travel.sell", 0));
  const [stay, setStay] = useState(load<number>("ta.travel.stay", 0));
  const [dailyMinutes, setDailyMinutes] = useState(load<number>("ta.travel.dailyMinutes", 240));
  const tool = tools.find(x => x.id === active) || tools[0];
  const selected = destinations.find(d => d.id === destinationId) || destinations[0];
  const margin = sell - buy;
  const travelRows: TravelRow[] = useMemo(() => destinations.map(destination => {
    const tripTime = destination.minutes * 2 + stay;
    const profit = margin * capacity;
    const profitHour = tripTime > 0 ? profit / (tripTime / 60) : 0;
    const tripsPerDay = tripTime > 0 ? dailyMinutes / tripTime : 0;
    return { destination, tripTime, profit, profitHour, tripsPerDay, dailyProfit: profit * tripsPerDay, activity: activityLabel(tripsPerDay) };
  }).sort((a, b) => b.profitHour - a.profitHour), [capacity, dailyMinutes, margin, stay]);
  const selectedRow = travelRows.find(row => row.destination.id === selected.id) || travelRows[0];
  const bestRow = travelRows[0];
  const customReady = apiStatus === "success" && probes.length > 0 && probes.every(p => p.ok);
  const setTool = (id: ToolId) => { setActive(id); localStorage.setItem("ta.active", id); };
  const log = (type: string, text: string) => setEvents(audit(type, text));
  const toggleLocale = () => { const next = locale === "en" ? "es" : "en"; setLocale(next); localStorage.setItem("ta.locale", next); };

  function updateTravel(field: "destination" | "capacity" | "buy" | "sell" | "stay" | "dailyMinutes", value: string | number) {
    if (field === "destination") { const text = String(value); setDestinationId(text); localStorage.setItem("ta.travel.destination", text); return; }
    const numeric = typeof value === "number" ? value : safeNumber(value);
    if (field === "capacity") setCapacity(numeric);
    if (field === "buy") setBuy(numeric);
    if (field === "sell") setSell(numeric);
    if (field === "stay") setStay(numeric);
    if (field === "dailyMinutes") setDailyMinutes(numeric);
    save(`ta.travel.${field}`, numeric);
  }
  async function copyRequirements() { await navigator.clipboard.writeText(`TornApps custom key\nRequired endpoints:\n${REQUIRED_ENDPOINTS.join("\n")}`); setMessage(tr(locale, "Permission checklist copied.", "Lista de permisos copiada.")); }
  async function validateCustomKey() {
    const key = apiKey.trim();
    if (key.length < 8) { setApiStatus("error"); setMessage(tr(locale, "Paste a Custom API key first.", "Pega primero una API key Custom.")); return; }
    setApiStatus("loading"); setMessage(tr(locale, "Checking key type and required endpoints...", "Comprobando tipo de key y endpoints requeridos..."));
    try {
      const info = await callTorn("key/info", key); const type = accessType(info);
      if (type !== "custom") throw new Error(tr(locale, `Rejected: key type is ${type}. TornApps only accepts Custom keys.`, `Rechazada: la key es ${type}. TornApps solo acepta keys Custom.`));
      const results: Probe[] = [];
      for (const endpoint of REQUIRED_ENDPOINTS) { try { await callTorn(endpoint, key); results.push({ label: endpoint, endpoint, ok: true }); } catch (error) { results.push({ label: endpoint, endpoint, ok: false, error: error instanceof Error ? error.message : "failed" }); } }
      setProbes(results); save("ta.probes", results);
      const missing = results.filter(r => !r.ok);
      if (missing.length) { setApiStatus("error"); setMessage(tr(locale, `Custom key detected, but ${missing.length} required permissions are missing.`, `Key Custom detectada, pero faltan ${missing.length} permisos requeridos.`)); log("api_missing_permissions", missing.map(x => x.endpoint).join(", ")); return; }
      localStorage.setItem("ta.apiKey", key); setApiStatus("success"); setMessage(tr(locale, "Custom key approved. All required checks passed.", "Key Custom aprobada. Todos los checks han pasado.")); log("api_custom_valid", "all required probes passed");
    } catch (error) { setApiStatus("error"); setMessage(error instanceof Error ? error.message : "Validation failed"); log("api_rejected", "custom validation failed"); }
  }
  function savePlan(row = selectedRow) { const entry = { id: crypto.randomUUID(), time: new Date().toISOString(), destination: row.destination.en, capacity, buy, sell, margin, tripTime: row.tripTime, profit: row.profit, profitHour: row.profitHour }; const next = [entry, ...plans].slice(0, 50); setPlans(next); save("ta.travelPlans", next); log("travel_plan", `saved ${row.destination.en}`); }
  function clearData() { ["ta.apiKey", "ta.probes", "ta.audit", "ta.travelPlans"].forEach(k => localStorage.removeItem(k)); setApiKey(""); setApiStatus("idle"); setProbes([]); setEvents([]); setPlans([]); setMessage(""); }

  return <div className="app"><aside className="sidebar"><div className="brand"><Logo /><div><strong>TornApps</strong><span>{tr(locale, "Checkpoint R4", "Checkpoint R4")}</span></div></div><nav>{tools.map(x => <button key={x.id} className={active === x.id ? "active" : ""} onClick={() => setTool(x.id)}><b>{x.icon}</b><span>{x[locale]}</span><small>{x[`desc${locale === "en" ? "En" : "Es"}` as "descEn"]}</small></button>)}</nav></aside><main className="main"><header><div><p className="eyebrow">{tool[locale]}</p><h1>{tr(locale, "Useful modules, not placeholders.", "Modulos utiles, no placeholders.")}</h1><p className="subtle">{tr(locale, "R4 rebuilds Travel into a real planning module before adding more tools.", "R4 convierte Viajes en un modulo real antes de anadir mas herramientas.")}</p></div><button className="btn" onClick={toggleLocale}>{locale.toUpperCase()}</button></header><section className="tiles"><Tile label="Key" value={customReady ? "Custom OK" : "Not ready"} /><Tile label="Best route" value={bestRow.destination.en} /><Tile label="Best $/h" value={money(bestRow.profitHour)} /><Tile label="Plans" value={String(plans.length)} /></section>{active === "overview" && <Panel title="Checkpoint R4" subtitle={tr(locale, "Travel Planner is now the first module with real decision value.", "Viajes es ahora el primer modulo con valor real de decision.")}><TravelSummary locale={locale} row={bestRow} /><CheckList probes={probes} /></Panel>}{active === "api" && <Panel title="Custom API Key" subtitle={tr(locale, "Create a Custom key named TornApps, copy the permissions checklist, then validate it here.", "Crea una key Custom llamada TornApps, copia la lista de permisos y validala aqui.")}><div className="actions"><a className="btn primary" href={TORN_API_PAGE} target="_blank" rel="noreferrer">{tr(locale, "Create Custom Key on Torn", "Crear Custom Key en Torn")}</a><button className="btn" onClick={() => void copyRequirements()}>{tr(locale, "Copy required permissions", "Copiar permisos requeridos")}</button></div><input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste Custom API key" /><div className="actions"><button className="btn primary" onClick={() => void validateCustomKey()}>{tr(locale, "Validate Custom Key", "Validar Custom Key")}</button><button className="btn danger" onClick={clearData}>{tr(locale, "Clear local data", "Borrar datos locales")}</button></div><Notice status={apiStatus} text={message} /><CheckList probes={probes} /></Panel>}{active === "travel" && <Panel title={tr(locale, "Travel ROI Planner", "Planificador ROI de viajes")} subtitle={tr(locale, "Compare every destination by profit per hour, daily profit and activity level.", "Compara todos los destinos por beneficio/hora, beneficio diario y actividad.")}><div className="form"><select className="input" value={destinationId} onChange={e => updateTravel("destination", e.target.value)}>{destinations.map(d => <option key={d.id} value={d.id}>{locale === "en" ? d.en : d.es} - {d.minutes}m</option>)}</select><input className="input" type="number" value={capacity} onChange={e => updateTravel("capacity", e.target.value)} placeholder="Capacity" /><input className="input" type="number" value={buy} onChange={e => updateTravel("buy", e.target.value)} placeholder="Buy price" /><input className="input" type="number" value={sell} onChange={e => updateTravel("sell", e.target.value)} placeholder="Sell price" /><input className="input" type="number" value={stay} onChange={e => updateTravel("stay", e.target.value)} placeholder="Extra minutes per trip" /><input className="input" type="number" value={dailyMinutes} onChange={e => updateTravel("dailyMinutes", e.target.value)} placeholder="Available minutes/day" /></div><section className="tiles"><Tile label="Selected" value={selected.en} /><Tile label="Trip time" value={`${selectedRow.tripTime}m`} /><Tile label="Trip profit" value={money(selectedRow.profit)} /><Tile label="Profit/hour" value={money(selectedRow.profitHour)} /></section><TravelSummary locale={locale} row={selectedRow} /><div className="actions"><button className="btn primary" onClick={() => savePlan(selectedRow)}>{tr(locale, "Save selected plan", "Guardar plan seleccionado")}</button><button className="btn" onClick={() => savePlan(bestRow)}>{tr(locale, "Save best route", "Guardar mejor ruta")}</button></div><TravelTable locale={locale} rows={travelRows} selectedId={selected.id} onSelect={(id) => updateTravel("destination", id)} /></Panel>}{active === "history" && <Panel title="History" subtitle="Local events.">{events.map(e => <div className="rowline" key={e.id}><strong>{e.type}</strong><span>{new Date(e.time).toLocaleString()}</span><p>{e.message}</p></div>)}</Panel>}{active === "settings" && <Panel title="Settings" subtitle="Local privacy controls."><button className="btn danger" onClick={clearData}>Delete local data</button></Panel>}<nav className="mobile">{tools.map(x => <button key={x.id} className={active === x.id ? "active" : ""} onClick={() => setTool(x.id)}>{x.icon}</button>)}</nav></main></div>;
}

function Logo() { return <div className="ta-logo"><span>T</span><i>A</i></div>; }
function Tile({ label, value }: { label: string; value: string }) { return <div className="tile"><span>{label}</span><strong>{value}</strong></div>; }
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-head"><h2>{title}</h2><p>{subtitle}</p></div>{children}</section>; }
function Notice({ status, text }: { status: Status; text: string }) { return text ? <p className={`notice ${status}`}>{text}</p> : null; }
function CheckList({ probes }: { probes: Probe[] }) { const map = new Map(probes.map(p => [p.endpoint, p])); return <div className="checklist">{REQUIRED_ENDPOINTS.map(endpoint => { const probe = map.get(endpoint); return <div key={endpoint} className={probe?.ok ? "ok" : probe ? "bad" : "pending"}><span>{probe?.ok ? "✓" : probe ? "!" : "•"}</span><strong>{endpoint}</strong><small>{probe?.ok ? "OK" : probe?.error ? "Missing or blocked" : "Required"}</small></div>; })}</div>; }
function TravelSummary({ locale, row }: { locale: Locale; row: TravelRow }) { return <div className="decision-card"><div><span>{tr(locale, "Recommendation", "Recomendacion")}</span><strong>{locale === "en" ? row.destination.en : row.destination.es}</strong><p>{tr(locale, "Best when comparing your current item margin against available play time.", "Mejor comparando tu margen actual contra tu tiempo disponible.")}</p></div><div className="decision-metrics"><Tile label="Trips/day" value={row.tripsPerDay.toFixed(1)} /><Tile label="Daily profit" value={money(row.dailyProfit)} /><Tile label="Activity" value={row.activity} /></div></div>; }
function TravelTable({ locale, rows, selectedId, onSelect }: { locale: Locale; rows: TravelRow[]; selectedId: string; onSelect: (id: string) => void }) { return <div className="travel-table"><div className="table-head"><span>Destination</span><span>Trip</span><span>Profit</span><span>$/h</span><span>Daily</span></div>{rows.map(row => <button key={row.destination.id} className={row.destination.id === selectedId ? "selected" : ""} onClick={() => onSelect(row.destination.id)}><span>{locale === "en" ? row.destination.en : row.destination.es}</span><span>{row.tripTime}m</span><span>{money(row.profit)}</span><span>{money(row.profitHour)}</span><span>{money(row.dailyProfit)}</span></button>)}</div>; }

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
