import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

type Locale = "en" | "es";
type Status = "idle" | "loading" | "success" | "error";
type ApiKeyMeta = { accessLevel: string; validatedAt: string; raw: unknown };
type AuditEvent = { id: string; time: string; type: string; message: string };
type Snapshot = { id: string; time: string; payload: unknown };
type TravelPlan = { id: string; time: string; destination: string; capacity: number; buy: number; sell: number; profit: number; pph: number };
type MarketObservation = { id: string; time: string; itemId: number; itemName: string; listingCount: number; lowestPrice: number | null; averagePrice: number | null; targetPrice: number; raw: unknown };
type WatchlistItem = { id: string; time: string; itemId: number; itemName: string; targetPrice: number; notes: string };

const destinations = [
  ["mexico", "Mexico", "Mexico", 18], ["cayman", "Cayman Islands", "Islas Caiman", 35], ["canada", "Canada", "Canada", 41], ["hawaii", "Hawaii", "Hawaii", 94], ["uk", "United Kingdom", "Reino Unido", 111], ["argentina", "Argentina", "Argentina", 117], ["switzerland", "Switzerland", "Suiza", 123], ["japan", "Japan", "Japon", 158], ["china", "China", "China", 169], ["uae", "United Arab Emirates", "Emiratos Arabes", 190], ["south-africa", "South Africa", "Sudafrica", 208]
] as const;

const modules = [
  ["Overview", "Resumen", "public", true],
  ["Cooldowns", "Cooldowns", "minimal: user/cooldowns, user/bars", true],
  ["Profile", "Perfil", "public/minimal: user/basic, user/education, user/personalstats", true],
  ["Travel", "Viajes", "manual planner + user/travel", true],
  ["Market", "Mercado", "public market lookup + local watchlists", true],
  ["Networth", "Networth", "limited/custom: user/networth", false],
  ["History", "Historial", "browser storage, 30-day retention", true],
  ["Settings", "Ajustes", "none", true]
] as const;

function loadJson<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
function saveJson(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
function audit(type: string, message: string) { const next = [{ id: crypto.randomUUID(), time: new Date().toISOString(), type, message }, ...loadJson<AuditEvent[]>("tornapps:audit", [])].slice(0, 80); saveJson("tornapps:audit", next); return next; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nested(data: unknown, key: string): Record<string, unknown> { const r = record(data); return record(r[key]); }
function num(r: Record<string, unknown>, keys: string[]): number | null { for (const k of keys) if (typeof r[k] === "number") return r[k] as number; return null; }
function str(r: Record<string, unknown>, keys: string[]): string | null { for (const k of keys) if (typeof r[k] === "string" || typeof r[k] === "number") return String(r[k]); return null; }
function money(v: number | null) { return v === null || !Number.isFinite(v) ? "-" : `$${Math.round(v).toLocaleString()}`; }
function secs(s: number) { if (s <= 0) return "Ready"; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; }
function flatten(value: unknown): string[] { if (["string", "number", "boolean"].includes(typeof value)) return [String(value)]; if (Array.isArray(value)) return value.flatMap(flatten); return value && typeof value === "object" ? Object.values(value as Record<string, unknown>).flatMap(flatten) : []; }

async function fetchTorn(endpoint: string, key: string): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.torn.com/v2${endpoint}${sep}comment=TornApps`, { headers: { Authorization: `ApiKey ${key}` } });
  const data = await res.json();
  if (!res.ok || (data && typeof data === "object" && "error" in data)) throw new Error(JSON.stringify(data) || `Torn API returned ${res.status}`);
  return data;
}

async function tryFetchTorn(endpoints: string[], key: string): Promise<unknown> {
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try { return await fetchTorn(endpoint, key); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(errors[0] || "No market endpoint succeeded.");
}

function inferKey(data: unknown): ApiKeyMeta {
  const low = JSON.stringify(data).toLowerCase();
  const accessLevel = low.includes("full") ? "Full Access" : low.includes("limited") ? "Limited" : low.includes("minimal") ? "Minimal" : low.includes("custom") ? "Custom" : "Public or Custom";
  return { accessLevel, validatedAt: new Date().toISOString(), raw: data };
}

function bars(data: unknown) { return Object.entries(nested(data, "bars")).flatMap(([name, value]) => { const r = record(value); return r ? [{ name, current: num(r, ["current", "value"]), max: num(r, ["maximum", "max"]), tick: num(r, ["tick_time", "next", "time"]) }] : []; }); }
function cooldowns(data: unknown) { return Object.entries(nested(data, "cooldowns")).flatMap(([name, value]) => typeof value === "number" ? [{ name, seconds: value }] : [{ name, seconds: num(record(value), ["seconds", "time", "remaining", "cooldown"]) ?? 0 }]); }
function facts(basic: unknown, education: unknown, stats: unknown) { const b = { ...record(basic), ...nested(basic, "basic"), ...nested(basic, "user") }; const e = { ...record(education), ...nested(education, "education") }; return [["Name", str(b, ["name", "username", "player_name"])], ["Level", str(b, ["level"])], ["Status", str(b, ["status", "state"] )], ["Rank", str(b, ["rank", "rank_name"])], ["Faction", str(b, ["faction", "faction_name"])], ["Company", str(b, ["company", "company_name", "job"])], ["Current education", str(e, ["current", "course", "name"])], ["Personal stats fields", Object.keys(record(stats)).length ? `${Object.keys(record(stats)).length} fields loaded` : null]].filter((x): x is [string, string] => Boolean(x[1])); }

function numericPrices(value: unknown): number[] {
  const prices: number[] = [];
  const scan = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(scan);
    else if (node && typeof node === "object") {
      const r = node as Record<string, unknown>;
      for (const [key, val] of Object.entries(r)) {
        if (["price", "cost", "market_price"].includes(key.toLowerCase()) && typeof val === "number" && val > 0) prices.push(val);
        scan(val);
      }
    }
  };
  scan(value);
  return prices.slice(0, 200);
}

function marketObservation(raw: unknown, itemId: number, fallbackName: string, targetPrice: number): MarketObservation {
  const prices = numericPrices(raw);
  const lowestPrice = prices.length ? Math.min(...prices) : null;
  const averagePrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const values = flatten(raw);
  const itemName = values.find((v) => /[A-Za-z]/.test(v) && v.length > 2 && v.length < 80) || fallbackName || `Item ${itemId}`;
  return { id: crypto.randomUUID(), time: new Date().toISOString(), itemId, itemName, listingCount: prices.length, lowestPrice, averagePrice, targetPrice, raw };
}

function saveSnapshot<T extends { time: string }>(key: string, entry: T, max = 150): T[] { const cutoff = Date.now() - 30 * 86400000; const next = [entry, ...loadJson<T[]>(key, [])].filter((x) => new Date(x.time).getTime() >= cutoff).slice(0, max); saveJson(key, next); return next; }

function App() {
  const [locale, setLocale] = useState<Locale>((localStorage.getItem("tornapps:locale") as Locale) || "en");
  const [unlocked, setUnlocked] = useState(false), [passphrase, setPassphrase] = useState("");
  const [apiKey, setApiKey] = useState(localStorage.getItem("tornapps:apiKey") || "");
  const [keyState, setKeyState] = useState<Status>(apiKey ? "success" : "idle"), [keyMeta, setKeyMeta] = useState<ApiKeyMeta | null>(loadJson<ApiKeyMeta | null>("tornapps:keyMeta", null));
  const [events, setEvents] = useState<AuditEvent[]>(loadJson<AuditEvent[]>("tornapps:audit", [])), [msg, setMsg] = useState("");
  const [coolState, setCoolState] = useState<Status>("idle"), [coolMsg, setCoolMsg] = useState(""), [coolData, setCoolData] = useState<unknown>(null), [barData, setBarData] = useState<unknown>(null), [coolSnaps, setCoolSnaps] = useState<Snapshot[]>(loadJson<Snapshot[]>("tornapps:cooldownSnapshots", []));
  const [profileState, setProfileState] = useState<Status>("idle"), [profileMsg, setProfileMsg] = useState(""), [basic, setBasic] = useState<unknown>(null), [education, setEducation] = useState<unknown>(null), [personal, setPersonal] = useState<unknown>(null), [profileSnaps, setProfileSnaps] = useState<Snapshot[]>(loadJson<Snapshot[]>("tornapps:profileSnapshots", []));
  const [travelState, setTravelState] = useState<Status>("idle"), [travelMsg, setTravelMsg] = useState(""), [travelData, setTravelData] = useState<unknown>(null), [travelPlans, setTravelPlans] = useState<TravelPlan[]>(loadJson<TravelPlan[]>("tornapps:travelPlans", []));
  const [dest, setDest] = useState("mexico"), [capacity, setCapacity] = useState(19), [buy, setBuy] = useState(0), [sell, setSell] = useState(0), [stay, setStay] = useState(0);
  const [marketState, setMarketState] = useState<Status>("idle"), [marketMsg, setMarketMsg] = useState(""), [itemId, setItemId] = useState(1), [itemName, setItemName] = useState(""), [targetPrice, setTargetPrice] = useState(0), [watchNotes, setWatchNotes] = useState("");
  const [marketRaw, setMarketRaw] = useState<unknown>(null), [observations, setObservations] = useState<MarketObservation[]>(loadJson<MarketObservation[]>("tornapps:marketObservations", [])), [watchlist, setWatchlist] = useState<WatchlistItem[]>(loadJson<WatchlistItem[]>("tornapps:marketWatchlist", []));
  const isEs = locale === "es";
  const moduleNames = useMemo(() => modules.map((m) => isEs ? m[1] : m[0]), [isEs]);
  const destination = destinations.find((d) => d[0] === dest) ?? destinations[0];
  const travelMinutes = Number(destination[3]) * 2 + stay, profit = (sell - buy) * capacity, pph = travelMinutes ? profit / (travelMinutes / 60) : 0;
  const latestObservation = observations[0];

  const storedKey = () => apiKey.trim() || localStorage.getItem("tornapps:apiKey") || "";
  const setAudit = (type: string, message: string) => setEvents(audit(type, message));
  const toggleLocale = () => { const next = isEs ? "en" : "es"; localStorage.setItem("tornapps:locale", next); setLocale(next); };

  async function validateKey() { const key = apiKey.trim(); if (key.length < 8) { setKeyState("error"); setMsg(isEs ? "Introduce una API key valida." : "Enter a valid API key."); return; } setKeyState("loading"); setMsg(isEs ? "Validando con Torn..." : "Validating with Torn..."); try { const meta = inferKey(await fetchTorn("/key/info", key)); if (meta.accessLevel === "Full Access") throw new Error("Full Access keys are blocked."); localStorage.setItem("tornapps:apiKey", key); saveJson("tornapps:keyMeta", meta); setKeyMeta(meta); setKeyState("success"); setMsg(isEs ? "Key validada y guardada solo en este navegador." : "Key validated and stored only in this browser."); setAudit("key_validated", `Validated ${meta.accessLevel} key`); } catch (e) { setKeyState("error"); setMsg(e instanceof Error ? e.message : "Validation failed"); setAudit("key_error", "Key validation failed"); } }
  async function refreshCooldowns() { const key = storedKey(); if (!key) return setCoolMsg(isEs ? "Valida una API key primero." : "Validate an API key first."); setCoolState("loading"); try { const [c, b] = await Promise.all([fetchTorn("/user/cooldowns", key), fetchTorn("/user/bars", key)]); setCoolData(c); setBarData(b); setCoolSnaps(saveSnapshot("tornapps:cooldownSnapshots", { id: crypto.randomUUID(), time: new Date().toISOString(), payload: { c, b } })); setCoolState("success"); setCoolMsg(isEs ? "Cooldowns actualizados." : "Cooldowns refreshed."); setAudit("cooldowns_refreshed", "Fetched cooldowns and bars"); } catch (e) { setCoolState("error"); setCoolMsg(e instanceof Error ? e.message : "Cooldown refresh failed"); } }
  async function refreshProfile() { const key = storedKey(); if (!key) return setProfileMsg(isEs ? "Valida una API key primero." : "Validate an API key first."); setProfileState("loading"); const [b, e, p] = await Promise.allSettled([fetchTorn("/user/basic", key), fetchTorn("/user/education", key), fetchTorn("/user/personalstats?cat=popular", key)]); if (b.status === "rejected") { setProfileState("error"); setProfileMsg(b.reason instanceof Error ? b.reason.message : "Profile failed"); return; } const ed = e.status === "fulfilled" ? e.value : null, ps = p.status === "fulfilled" ? p.value : null; setBasic(b.value); setEducation(ed); setPersonal(ps); setProfileSnaps(saveSnapshot("tornapps:profileSnapshots", { id: crypto.randomUUID(), time: new Date().toISOString(), payload: { basic: b.value, education: ed, personal: ps } }, 100)); setProfileState("success"); setProfileMsg(isEs ? "Perfil actualizado." : "Profile refreshed."); setAudit("profile_refreshed", "Fetched profile data"); }
  async function refreshTravel() { const key = storedKey(); if (!key) return setTravelMsg(isEs ? "Valida una API key primero." : "Validate an API key first."); setTravelState("loading"); try { const t = await fetchTorn("/user/travel", key); setTravelData(t); saveSnapshot("tornapps:travelStateSnapshots", { id: crypto.randomUUID(), time: new Date().toISOString(), payload: t }, 100); setTravelState("success"); setTravelMsg(isEs ? "Estado de viaje actualizado." : "Travel state refreshed."); setAudit("travel_state_refreshed", "Fetched user/travel"); } catch (e) { setTravelState("error"); setTravelMsg(e instanceof Error ? e.message : "Travel failed"); } }
  async function lookupMarket() { const key = storedKey(); if (!key) return setMarketMsg(isEs ? "Valida una API key primero." : "Validate an API key first."); if (!itemId || itemId < 1) return setMarketMsg(isEs ? "Introduce un item ID valido." : "Enter a valid item ID."); setMarketState("loading"); setMarketMsg(isEs ? "Consultando mercado..." : "Looking up market..."); try { const raw = await tryFetchTorn([`/market/${itemId}/itemmarket`, `/market/itemmarket?id=${itemId}`, `/torn/${itemId}/itemdetails`], key); const obs = marketObservation(raw, itemId, itemName, targetPrice); setMarketRaw(raw); setObservations(saveSnapshot("tornapps:marketObservations", obs, 250)); setMarketState("success"); setMarketMsg(obs.lowestPrice !== null && targetPrice > 0 && obs.lowestPrice <= targetPrice ? (isEs ? "Precio objetivo encontrado." : "Target price found.") : (isEs ? "Mercado actualizado." : "Market refreshed.")); setAudit("market_lookup", `Checked item ${itemId}`); } catch (e) { setMarketState("error"); setMarketMsg(e instanceof Error ? e.message : "Market lookup failed"); setAudit("market_error", "Market lookup failed"); } }
  function savePlan() { const plan = { id: crypto.randomUUID(), time: new Date().toISOString(), destination: String(destination[1]), capacity, buy, sell, profit, pph }; const next = [plan, ...travelPlans].slice(0, 50); saveJson("tornapps:travelPlans", next); setTravelPlans(next); setAudit("travel_plan_saved", `Saved ${destination[1]} plan`); }
  function saveWatch() { const item: WatchlistItem = { id: crypto.randomUUID(), time: new Date().toISOString(), itemId, itemName: itemName || `Item ${itemId}`, targetPrice, notes: watchNotes }; const next = [item, ...watchlist].slice(0, 80); saveJson("tornapps:marketWatchlist", next); setWatchlist(next); setAudit("market_watch_saved", `Saved watchlist item ${item.itemName}`); }
  function resetKey() { localStorage.removeItem("tornapps:apiKey"); localStorage.removeItem("tornapps:keyMeta"); setApiKey(""); setKeyMeta(null); setKeyState("idle"); setMsg(isEs ? "API key eliminada." : "API key removed."); setAudit("key_reset", "Removed API key"); }

  if (!unlocked) return <main className="lock"><section className="card lockcard"><div className="logo">TA</div><p className="eyebrow">{isEs ? "Asistente personal de Torn" : "Privacy-first Torn assistant"}</p><h1>{isEs ? "Desbloquear TornApps" : "Unlock TornApps"}</h1><p className="muted">{isEs ? "Bloqueo local del navegador. No uses tu contrasena de Torn." : "Local browser lock. Do not use your Torn password."}</p><input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={isEs ? "Frase local" : "Local passphrase"} /><button className="primary" onClick={() => setUnlocked(passphrase.length >= 4)}>{isEs ? "Entrar" : "Enter"}</button><button className="ghost" onClick={toggleLocale}>{isEs ? "English" : "Espanol"}</button></section></main>;

  return <div className="shell"><aside><div className="brand"><div className="logo small">TA</div><div><strong>TornApps</strong><span>M5 market</span></div></div><nav>{moduleNames.slice(0, 6).map((name) => <a key={name} href={name === moduleNames[0] ? "#dashboard" : name === moduleNames[2] ? "#profile" : name === moduleNames[3] ? "#travel" : name === moduleNames[4] ? "#market" : "#modules"}>{name}</a>)}</nav></aside><main className="content"><header><div><p className="eyebrow">{isEs ? "Privacidad primero" : "Privacy first"}</p><h1>{isEs ? "Centro de mando personal" : "Personal command center"}</h1><p className="muted">{isEs ? "M5 anade busqueda de mercado, observaciones y watchlists." : "M5 adds market lookup, observations, and watchlists."}</p></div><button className="ghost" onClick={toggleLocale}>{locale.toUpperCase()}</button></header>

  <section id="dashboard" className="hero card"><div><h2>{isEs ? "Configurar API key" : "API key setup"}</h2><p>{isEs ? "La key se guarda solo en este navegador." : "The key is stored only in this browser."}</p><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEs ? "Pega tu Torn API key" : "Paste your Torn API key"} /><div className="buttonrow"><button className="primary inline" onClick={() => void validateKey()} disabled={keyState === "loading"}>{keyState === "loading" ? (isEs ? "Validando..." : "Validating...") : (isEs ? "Validar key" : "Validate key")}</button><button className="ghost" onClick={resetKey}>{isEs ? "Eliminar" : "Reset"}</button></div>{msg && <p className={`notice ${keyState}`}>{msg}</p>}</div><div className="security card"><h3>{isEs ? "Estado de key" : "Key status"}</h3><p><strong>Status:</strong> {keyState}</p><p><strong>Access:</strong> {keyMeta?.accessLevel || "Not validated"}</p><p><strong>Validated:</strong> {keyMeta ? new Date(keyMeta.validatedAt).toLocaleString() : "-"}</p></div></section>

  <section className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Cooldowns y barras" : "Cooldowns and bars"}</h2><p>{isEs ? "Energia, nerve, happy y cooldowns." : "Energy, nerve, happy, and cooldowns."}</p></div><button className="primary inline" onClick={() => void refreshCooldowns()} disabled={coolState === "loading"}>{coolState === "loading" ? "..." : isEs ? "Actualizar" : "Refresh"}</button></div>{coolMsg && <p className={`notice ${coolState}`}>{coolMsg}</p>}<div className="metric-grid"><div><h3>{isEs ? "Barras" : "Bars"}</h3>{bars(barData).map((b) => <div className="metric" key={b.name}><span>{b.name}</span><strong>{b.current ?? "?"} / {b.max ?? "?"}</strong>{b.tick ? <small>{secs(b.tick)}</small> : null}</div>)}</div><div><h3>Cooldowns</h3>{cooldowns(coolData).map((c) => <div className="metric" key={c.name}><span>{c.name}</span><strong>{secs(c.seconds)}</strong></div>)}</div></div></section>

  <section id="profile" className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Perfil" : "Profile"}</h2><p>{isEs ? "Perfil basico, educacion y stats." : "Basic profile, education, and stats."}</p></div><button className="primary inline" onClick={() => void refreshProfile()} disabled={profileState === "loading"}>{profileState === "loading" ? "..." : isEs ? "Actualizar perfil" : "Refresh profile"}</button></div>{profileMsg && <p className={`notice ${profileState}`}>{profileMsg}</p>}<div className="metric-grid"><div>{facts(basic, education, personal).map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div><h3>{isEs ? "Historial" : "History"}</h3><p className="muted">{profileSnaps.length} profile snapshots stored.</p></div></div></section>

  <section id="travel" className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Planificador de viajes" : "Travel planner"}</h2><p>{isEs ? "Calculadora manual de beneficio por hora." : "Manual profit-per-hour calculator."}</p></div><button className="primary inline" onClick={() => void refreshTravel()} disabled={travelState === "loading"}>{travelState === "loading" ? "..." : isEs ? "Estado viaje" : "Travel state"}</button></div>{travelMsg && <p className={`notice ${travelState}`}>{travelMsg}</p>}<div className="metric-grid"><div><select className="input" value={dest} onChange={(e) => setDest(e.target.value)}>{destinations.map((d) => <option key={d[0]} value={d[0]}>{isEs ? d[2] : d[1]} ({d[3]}m)</option>)}</select><input className="input" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value) || 0)} placeholder="capacity" /><input className="input" type="number" value={buy} onChange={(e) => setBuy(Number(e.target.value) || 0)} placeholder="buy price" /><input className="input" type="number" value={sell} onChange={(e) => setSell(Number(e.target.value) || 0)} placeholder="sell price" /><input className="input" type="number" value={stay} onChange={(e) => setStay(Number(e.target.value) || 0)} placeholder="extra minutes" /><button className="primary inline" onClick={savePlan}>{isEs ? "Guardar plan" : "Save plan"}</button></div><div><div className="metric"><span>{isEs ? "Tiempo" : "Time"}</span><strong>{travelMinutes}m</strong></div><div className="metric"><span>{isEs ? "Beneficio" : "Profit"}</span><strong>{money(profit)}</strong></div><div className="metric"><span>{isEs ? "Beneficio/h" : "Profit/h"}</span><strong>{money(pph)}</strong></div><div className="metric"><span>{isEs ? "Planes" : "Plans"}</span><strong>{travelPlans.length}</strong></div></div></div><details className="raw"><summary>{isEs ? "Estado raw" : "Raw state"}</summary><pre>{JSON.stringify(travelData, null, 2)}</pre></details></section>

  <section id="market" className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Herramientas de mercado" : "Market tools"}</h2><p>{isEs ? "Busca itemmarket publico, guarda observaciones y watchlists." : "Look up public itemmarket data, store observations, and save watchlists."}</p></div><button className="primary inline" onClick={() => void lookupMarket()} disabled={marketState === "loading"}>{marketState === "loading" ? "..." : isEs ? "Buscar mercado" : "Lookup market"}</button></div>{marketMsg && <p className={`notice ${marketState}`}>{marketMsg}</p>}<div className="metric-grid"><div><label className="field-label">Item ID</label><input className="input" type="number" value={itemId} onChange={(e) => setItemId(Number(e.target.value) || 0)} /><label className="field-label">{isEs ? "Nombre opcional" : "Optional name"}</label><input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Xanax, plushie, flower..." /><label className="field-label">{isEs ? "Precio objetivo" : "Target price"}</label><input className="input" type="number" value={targetPrice} onChange={(e) => setTargetPrice(Number(e.target.value) || 0)} /><label className="field-label">Notes</label><input className="input" value={watchNotes} onChange={(e) => setWatchNotes(e.target.value)} placeholder={isEs ? "Motivo de seguimiento" : "Why track this item"} /><div className="buttonrow"><button className="primary inline" onClick={saveWatch}>{isEs ? "Guardar watch" : "Save watch"}</button></div></div><div><h3>{isEs ? "Ultima observacion" : "Latest observation"}</h3><div className="metric"><span>Item</span><strong>{latestObservation?.itemName || "-"}</strong></div><div className="metric"><span>{isEs ? "Listings detectados" : "Detected listings"}</span><strong>{latestObservation?.listingCount ?? 0}</strong></div><div className="metric"><span>{isEs ? "Precio minimo" : "Lowest price"}</span><strong>{money(latestObservation?.lowestPrice ?? null)}</strong></div><div className="metric"><span>{isEs ? "Precio medio" : "Average price"}</span><strong>{money(latestObservation?.averagePrice ?? null)}</strong></div><div className="metric"><span>Watchlist</span><strong>{watchlist.length}</strong></div><div className="metric"><span>{isEs ? "Observaciones" : "Observations"}</span><strong>{observations.length}</strong></div></div></div><details className="raw"><summary>{isEs ? "Raw market" : "Raw market"}</summary><pre>{JSON.stringify(marketRaw, null, 2)}</pre></details></section>

  <section id="modules" className="grid">{modules.map((m, i) => <article className="card module" key={m[0]}><div className="row"><h3>{moduleNames[i]}</h3><span>{m[3] ? (isEs ? "Listo" : "Ready") : (isEs ? "Plan" : "Planned")}</span></div><p>{m[2]}</p></article>)}</section><section className="card audit"><h2>{isEs ? "Historial local" : "Local history"}</h2><p>{coolSnaps.length} cooldown snapshots · {profileSnaps.length} profile snapshots · {travelPlans.length} travel plans · {observations.length} market observations</p>{events.slice(0, 6).map((e) => <p key={e.id}><strong>{e.type}</strong> · {new Date(e.time).toLocaleString()} · {e.message}</p>)}</section></main></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
