import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

type Locale = "en" | "es";
type KeyState = "empty" | "validating" | "valid" | "blocked" | "error";
type FetchState = "idle" | "loading" | "success" | "error";
type ApiKeyMeta = { accessLevel: string; selections: string[]; validatedAt: string; raw: unknown };
type AuditEvent = { id: string; time: string; type: string; message: string };
type CooldownSnapshot = { id: string; time: string; cooldowns: unknown; bars: unknown };
type ProfileSnapshot = { id: string; time: string; basic: unknown; education: unknown; personalStats: unknown };
type TravelStateSnapshot = { id: string; time: string; travel: unknown };
type SavedTravelPlan = { id: string; time: string; destination: string; capacity: number; buyPrice: number; sellPrice: number; stayMinutes: number; profit: number; profitPerHour: number };

type ModuleConfig = {
  en: string;
  es: string;
  scopes: string;
  ready: boolean;
};

type TravelDestination = {
  id: string;
  en: string;
  es: string;
  minutesEachWay: number;
  noteEn: string;
  noteEs: string;
};

const modules: ModuleConfig[] = [
  { en: "Overview", es: "Resumen", scopes: "public", ready: true },
  { en: "Cooldowns", es: "Cooldowns", scopes: "minimal: user/cooldowns, user/bars", ready: true },
  { en: "Profile", es: "Perfil", scopes: "public/minimal: user/basic, user/education, user/personalstats", ready: true },
  { en: "Travel", es: "Viajes", scopes: "public/minimal: manual profit model + optional user/travel", ready: true },
  { en: "Market", es: "Mercado", scopes: "public: market and item endpoints", ready: false },
  { en: "Networth", es: "Networth", scopes: "limited/custom: user/networth", ready: false },
  { en: "History", es: "Historial", scopes: "browser storage, 30-day local retention", ready: true },
  { en: "Settings", es: "Ajustes", scopes: "none", ready: true }
];

const travelDestinations: TravelDestination[] = [
  { id: "mexico", en: "Mexico", es: "Mexico", minutesEachWay: 18, noteEn: "Fast route; useful when short on time.", noteEs: "Ruta rapida; util con poco tiempo." },
  { id: "cayman", en: "Cayman Islands", es: "Islas Caiman", minutesEachWay: 35, noteEn: "Short trip; compare profit per hour carefully.", noteEs: "Viaje corto; compara beneficio por hora." },
  { id: "canada", en: "Canada", es: "Canada", minutesEachWay: 41, noteEn: "Mid-short route for quick cycles.", noteEs: "Ruta media-corta para ciclos rapidos." },
  { id: "hawaii", en: "Hawaii", es: "Hawaii", minutesEachWay: 94, noteEn: "Longer route; better if margin is high.", noteEs: "Ruta mas larga; mejor si el margen es alto." },
  { id: "uk", en: "United Kingdom", es: "Reino Unido", minutesEachWay: 111, noteEn: "Long route; good for fewer check-ins.", noteEs: "Ruta larga; util para menos actividad." },
  { id: "argentina", en: "Argentina", es: "Argentina", minutesEachWay: 117, noteEn: "Long route; compare against travel cooldown timing.", noteEs: "Ruta larga; compara con tus cooldowns." },
  { id: "switzerland", en: "Switzerland", es: "Suiza", minutesEachWay: 123, noteEn: "Long route; often used for high-value planning.", noteEs: "Ruta larga; usada para planificacion de alto valor." },
  { id: "japan", en: "Japan", es: "Japon", minutesEachWay: 158, noteEn: "Very long route; prioritize high margin.", noteEs: "Ruta muy larga; prioriza margen alto." },
  { id: "china", en: "China", es: "China", minutesEachWay: 169, noteEn: "Very long route; lower activity requirement.", noteEs: "Ruta muy larga; requiere menos actividad." },
  { id: "uae", en: "United Arab Emirates", es: "Emiratos Arabes", minutesEachWay: 190, noteEn: "Very long route; plan around cooldowns.", noteEs: "Ruta muy larga; planifica alrededor de cooldowns." },
  { id: "south-africa", en: "South Africa", es: "Sudafrica", minutesEachWay: 208, noteEn: "Longest preset route; only worth it with strong margins.", noteEs: "Ruta preset mas larga; solo compensa con buen margen." }
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

function firstRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) return {};
  const likely = ["basic", "profile", "user", "education", "personalstats", "personal_stats"];
  for (const key of likely) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  return record;
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

function money(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
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

function extractString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
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

function getProfileFacts(basic: unknown, education: unknown, personalStats: unknown) {
  const b = firstRecord(basic);
  const edu = firstRecord(education);
  const stats = firstRecord(personalStats);
  return [
    { label: "Name", value: extractString(b, ["name", "username", "player_name"]) },
    { label: "Level", value: extractString(b, ["level"]) },
    { label: "Status", value: extractString(b, ["status", "state", "life_state"]) },
    { label: "Rank", value: extractString(b, ["rank", "rank_name"]) },
    { label: "Faction", value: extractString(b, ["faction", "faction_name"]) },
    { label: "Company", value: extractString(b, ["company", "company_name", "job"]) },
    { label: "Current education", value: extractString(edu, ["current", "current_education", "course", "name"]) },
    { label: "Personal stats fields", value: Object.keys(stats).length ? `${Object.keys(stats).length} fields loaded` : null }
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
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

function saveProfileSnapshot(basic: unknown, education: unknown, personalStats: unknown): ProfileSnapshot[] {
  const snapshots = loadJson<ProfileSnapshot[]>("tornapps:profileSnapshots", []);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const next = [{ id: crypto.randomUUID(), time: new Date().toISOString(), basic, education, personalStats }, ...snapshots]
    .filter((snapshot) => new Date(snapshot.time).getTime() >= cutoff)
    .slice(0, 100);
  saveJson("tornapps:profileSnapshots", next);
  return next;
}

function saveTravelStateSnapshot(travel: unknown): TravelStateSnapshot[] {
  const snapshots = loadJson<TravelStateSnapshot[]>("tornapps:travelStateSnapshots", []);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const next = [{ id: crypto.randomUUID(), time: new Date().toISOString(), travel }, ...snapshots]
    .filter((snapshot) => new Date(snapshot.time).getTime() >= cutoff)
    .slice(0, 100);
  saveJson("tornapps:travelStateSnapshots", next);
  return next;
}

function saveTravelPlan(plan: SavedTravelPlan): SavedTravelPlan[] {
  const plans = loadJson<SavedTravelPlan[]>("tornapps:travelPlans", []);
  const next = [plan, ...plans].slice(0, 50);
  saveJson("tornapps:travelPlans", next);
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
  const [profileState, setProfileState] = useState<FetchState>("idle");
  const [profileMessage, setProfileMessage] = useState("");
  const [basicProfile, setBasicProfile] = useState<unknown>(null);
  const [education, setEducation] = useState<unknown>(null);
  const [personalStats, setPersonalStats] = useState<unknown>(null);
  const [profileSnapshots, setProfileSnapshots] = useState<ProfileSnapshot[]>(loadJson<ProfileSnapshot[]>("tornapps:profileSnapshots", []));
  const [travelState, setTravelState] = useState<FetchState>("idle");
  const [travelMessage, setTravelMessage] = useState("");
  const [travelData, setTravelData] = useState<unknown>(null);
  const [travelStateSnapshots, setTravelStateSnapshots] = useState<TravelStateSnapshot[]>(loadJson<TravelStateSnapshot[]>("tornapps:travelStateSnapshots", []));
  const [travelPlans, setTravelPlans] = useState<SavedTravelPlan[]>(loadJson<SavedTravelPlan[]>("tornapps:travelPlans", []));
  const [destinationId, setDestinationId] = useState(travelDestinations[0].id);
  const [capacity, setCapacity] = useState(19);
  const [buyPrice, setBuyPrice] = useState(0);
  const [sellPrice, setSellPrice] = useState(0);
  const [stayMinutes, setStayMinutes] = useState(0);
  const isEs = locale === "es";
  const names = useMemo(() => modules.map((module) => (isEs ? module.es : module.en)), [isEs]);
  const cooldownSummary = getCooldownSummaries(cooldowns);
  const barSummary = getBarSummaries(bars);
  const profileFacts = getProfileFacts(basicProfile, education, personalStats);
  const selectedDestination = travelDestinations.find((destination) => destination.id === destinationId) ?? travelDestinations[0];
  const travelMinutes = selectedDestination.minutesEachWay * 2 + stayMinutes;
  const profitPerItem = sellPrice - buyPrice;
  const profit = profitPerItem * capacity;
  const profitPerHour = travelMinutes > 0 ? profit / (travelMinutes / 60) : 0;

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

  async function refreshProfile() {
    const storedKey = apiKey.trim() || localStorage.getItem("tornapps:apiKey") || "";
    if (!storedKey) {
      setProfileState("error");
      setProfileMessage(isEs ? "Primero valida una API key Public, Minimal o Custom." : "Validate a Public, Minimal, or Custom API key first.");
      return;
    }
    setProfileState("loading");
    setProfileMessage(isEs ? "Actualizando perfil..." : "Refreshing profile...");
    const [basicResult, educationResult, statsResult] = await Promise.allSettled([
      fetchTorn("/user/basic", storedKey),
      fetchTorn("/user/education", storedKey),
      fetchTorn("/user/personalstats?cat=popular", storedKey)
    ]);
    if (basicResult.status === "rejected") {
      setProfileState("error");
      setProfileMessage(basicResult.reason instanceof Error ? basicResult.reason.message : "Could not fetch profile.");
      setAuditEvents(addAudit("profile_error", "Profile refresh failed"));
      return;
    }
    const educationData = educationResult.status === "fulfilled" ? educationResult.value : null;
    const statsData = statsResult.status === "fulfilled" ? statsResult.value : null;
    setBasicProfile(basicResult.value);
    setEducation(educationData);
    setPersonalStats(statsData);
    setProfileSnapshots(saveProfileSnapshot(basicResult.value, educationData, statsData));
    setProfileState("success");
    const partial = educationResult.status === "rejected" || statsResult.status === "rejected";
    setProfileMessage(partial ? (isEs ? "Perfil actualizado parcialmente. Algunos datos requieren otro scope." : "Profile partially refreshed. Some data may require another scope.") : (isEs ? "Perfil actualizado." : "Profile refreshed."));
    setAuditEvents(addAudit("profile_refreshed", partial ? "Fetched profile with partial data" : "Fetched user/basic, user/education, and user/personalstats"));
  }

  async function refreshTravelState() {
    const storedKey = apiKey.trim() || localStorage.getItem("tornapps:apiKey") || "";
    if (!storedKey) {
      setTravelState("error");
      setTravelMessage(isEs ? "Primero valida una API key Minimal o Custom." : "Validate a Minimal or Custom API key first.");
      return;
    }
    setTravelState("loading");
    setTravelMessage(isEs ? "Actualizando estado de viaje..." : "Refreshing travel state...");
    try {
      const travel = await fetchTorn("/user/travel", storedKey);
      setTravelData(travel);
      setTravelStateSnapshots(saveTravelStateSnapshot(travel));
      setTravelState("success");
      setTravelMessage(isEs ? "Estado de viaje actualizado." : "Travel state refreshed.");
      setAuditEvents(addAudit("travel_state_refreshed", "Fetched user/travel"));
    } catch (error) {
      setTravelState("error");
      setTravelMessage(error instanceof Error ? error.message : "Unknown travel state error.");
      setAuditEvents(addAudit("travel_state_error", "Travel state refresh failed"));
    }
  }

  function persistTravelPlan() {
    const plan: SavedTravelPlan = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      destination: selectedDestination.en,
      capacity,
      buyPrice,
      sellPrice,
      stayMinutes,
      profit,
      profitPerHour
    };
    setTravelPlans(saveTravelPlan(plan));
    setAuditEvents(addAudit("travel_plan_saved", `Saved ${selectedDestination.en} plan`));
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

  return <div className="shell"><aside><div className="brand"><div className="logo small">TA</div><div><strong>TornApps</strong><span>M4 travel</span></div></div><nav>{names.slice(0,6).map((name) => <a key={name} href={name === names[0] ? "#dashboard" : name === names[2] ? "#profile" : name === names[3] ? "#travel" : "#modules"}>{name}</a>)}</nav></aside><main className="content"><header><div><p className="eyebrow">{isEs ? "Privacidad primero" : "Privacy first"}</p><h1>{isEs ? "Centro de mando personal" : "Personal command center"}</h1><p className="muted">{isEs ? "M4 anade planificador de viajes y estado user/travel." : "M4 adds the travel planner and user/travel state."}</p></div><button className="ghost" onClick={toggleLocale}>{locale.toUpperCase()}</button></header><section id="dashboard" className="hero card"><div><h2>{isEs ? "Configurar API key" : "API key setup"}</h2><p>{isEs ? "La key se guarda solo en localStorage de este navegador. No hay backend ni servidor." : "The key is stored only in this browser localStorage. There is no backend or server storage."}</p><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEs ? "Pega tu Torn API key" : "Paste your Torn API key"} /><div className="buttonrow"><button className="primary inline" onClick={() => void validateKey()} disabled={keyState === "validating"}>{keyState === "validating" ? (isEs ? "Validando..." : "Validating...") : (isEs ? "Validar key" : "Validate key")}</button><button className="ghost" onClick={resetKey}>{isEs ? "Eliminar" : "Reset"}</button></div>{message ? <p className={`notice ${keyState}`}>{message}</p> : null}</div><div className="security card"><h3>{isEs ? "Estado de key" : "Key status"}</h3><p><strong>{isEs ? "Estado" : "Status"}:</strong> {keyState}</p><p><strong>{isEs ? "Acceso" : "Access"}:</strong> {keyMeta?.accessLevel || "Not validated"}</p><p><strong>{isEs ? "Validada" : "Validated"}:</strong> {keyMeta ? new Date(keyMeta.validatedAt).toLocaleString() : "-"}</p></div></section><section className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Cooldowns y barras" : "Cooldowns and bars"}</h2><p>{isEs ? "Energia, nerve, happy y cooldowns principales." : "Energy, nerve, happy, and major cooldowns."}</p></div><div className="buttonrow compact"><button className="primary inline" onClick={() => void refreshCooldowns()} disabled={cooldownState === "loading"}>{cooldownState === "loading" ? (isEs ? "Actualizando..." : "Refreshing...") : (isEs ? "Actualizar" : "Refresh")}</button><button className="ghost" onClick={() => void enableNotifications()}>{isEs ? "Notificaciones" : "Notifications"}</button></div></div>{cooldownMessage ? <p className={`notice ${cooldownState}`}>{cooldownMessage}</p> : null}<div className="next-action"><strong>{isEs ? "Siguiente accion:" : "Next action:"}</strong> {getNextAction(cooldowns, bars, isEs)}</div><div className="metric-grid"><div><h3>{isEs ? "Barras" : "Bars"}</h3>{barSummary.length === 0 ? <p className="muted">{isEs ? "Sin datos todavia." : "No data yet."}</p> : barSummary.map((bar) => <div className="metric" key={bar.name}><span>{bar.name}</span><strong>{bar.current ?? "?"} / {bar.maximum ?? "?"}</strong>{bar.tickTime ? <small>Tick: {formatSeconds(bar.tickTime)}</small> : null}</div>)}</div><div><h3>Cooldowns</h3>{cooldownSummary.length === 0 ? <p className="muted">{isEs ? "Sin datos todavia." : "No data yet."}</p> : cooldownSummary.map((cooldown) => <div className="metric" key={cooldown.name}><span>{cooldown.name}</span><strong>{formatSeconds(cooldown.seconds)}</strong></div>)}</div></div><details className="raw"><summary>{isEs ? "Datos raw" : "Raw data"}</summary><pre>{JSON.stringify({ cooldowns, bars }, null, 2)}</pre></details></section><section id="profile" className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Perfil" : "Profile"}</h2><p>{isEs ? "Perfil basico, educacion y personal stats populares." : "Basic profile, education, and popular personal stats."}</p></div><button className="primary inline" onClick={() => void refreshProfile()} disabled={profileState === "loading"}>{profileState === "loading" ? (isEs ? "Actualizando..." : "Refreshing...") : (isEs ? "Actualizar perfil" : "Refresh profile")}</button></div>{profileMessage ? <p className={`notice ${profileState}`}>{profileMessage}</p> : null}<div className="metric-grid"><div><h3>{isEs ? "Resumen" : "Summary"}</h3>{profileFacts.length === 0 ? <p className="muted">{isEs ? "Sin datos todavia." : "No data yet."}</p> : profileFacts.map((fact) => <div className="metric" key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div><div><h3>{isEs ? "Historial" : "History"}</h3><p className="muted">{isEs ? `${profileSnapshots.length} snapshots de perfil guardados.` : `${profileSnapshots.length} profile snapshots stored.`}</p><p className="muted">{isEs ? "Se conserva un maximo de 30 dias en este navegador." : "Maximum 30 days retained in this browser."}</p></div></div><details className="raw"><summary>{isEs ? "Datos raw" : "Raw data"}</summary><pre>{JSON.stringify({ basicProfile, education, personalStats }, null, 2)}</pre></details></section><section id="travel" className="card cooldown-panel"><div className="section-head"><div><h2>{isEs ? "Planificador de viajes" : "Travel planner"}</h2><p>{isEs ? "Modelo manual: introduce precios actuales y capacidad. M5 usara mercado publico." : "Manual model: enter current prices and capacity. M5 will add public market data."}</p></div><button className="primary inline" onClick={() => void refreshTravelState()} disabled={travelState === "loading"}>{travelState === "loading" ? (isEs ? "Actualizando..." : "Refreshing...") : (isEs ? "Estado viaje" : "Travel state")}</button></div>{travelMessage ? <p className={`notice ${travelState}`}>{travelMessage}</p> : null}<div className="metric-grid"><div><h3>{isEs ? "Calculadora" : "Calculator"}</h3><label className="field-label">{isEs ? "Destino" : "Destination"}</label><select className="input" value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>{travelDestinations.map((destination) => <option key={destination.id} value={destination.id}>{isEs ? destination.es : destination.en} ({destination.minutesEachWay}m)</option>)}</select><label className="field-label">{isEs ? "Capacidad" : "Capacity"}</label><input className="input" type="number" value={capacity} onChange={(event) => setCapacity(Math.max(0, Number(event.target.value) || 0))} /><label className="field-label">{isEs ? "Precio compra por item" : "Buy price per item"}</label><input className="input" type="number" value={buyPrice} onChange={(event) => setBuyPrice(Math.max(0, Number(event.target.value) || 0))} /><label className="field-label">{isEs ? "Precio venta por item" : "Sell price per item"}</label><input className="input" type="number" value={sellPrice} onChange={(event) => setSellPrice(Math.max(0, Number(event.target.value) || 0))} /><label className="field-label">{isEs ? "Minutos extra estancia" : "Extra stay minutes"}</label><input className="input" type="number" value={stayMinutes} onChange={(event) => setStayMinutes(Math.max(0, Number(event.target.value) || 0))} /><div className="buttonrow"><button className="primary inline" onClick={persistTravelPlan}>{isEs ? "Guardar plan" : "Save plan"}</button></div></div><div><h3>{isEs ? "Resultado" : "Result"}</h3><div className="metric"><span>{isEs ? "Ruta" : "Route"}</span><strong>{isEs ? selectedDestination.es : selectedDestination.en}</strong><small>{isEs ? selectedDestination.noteEs : selectedDestination.noteEn}</small></div><div className="metric"><span>{isEs ? "Tiempo total" : "Total time"}</span><strong>{travelMinutes}m</strong></div><div className="metric"><span>{isEs ? "Margen por item" : "Margin per item"}</span><strong>{money(profitPerItem)}</strong></div><div className="metric"><span>{isEs ? "Beneficio viaje" : "Trip profit"}</span><strong>{money(profit)}</strong></div><div className="metric"><span>{isEs ? "Beneficio por hora" : "Profit per hour"}</span><strong>{money(profitPerHour)}</strong></div><div className="metric"><span>{isEs ? "Planes guardados" : "Saved plans"}</span><strong>{travelPlans.length}</strong></div><div className="metric"><span>{isEs ? "Snapshots estado" : "State snapshots"}</span><strong>{travelStateSnapshots.length}</strong></div></div></div><details className="raw"><summary>{isEs ? "Estado raw user/travel" : "Raw user/travel state"}</summary><pre>{JSON.stringify(travelData, null, 2)}</pre></details></section><section id="modules" className="grid">{modules.map((module, index) => <article className="card module" key={module.en}><div className="row"><h3>{names[index]}</h3><span>{module.ready ? (isEs ? "Listo" : "Ready") : (isEs ? "Plan" : "Planned")}</span></div><p>{module.scopes}</p></article>)}</section><section className="card audit"><h2>{isEs ? "Historial local" : "Local history"}</h2><p>{isEs ? `${snapshots.length} snapshots de cooldowns guardados.` : `${snapshots.length} cooldown snapshots stored.`}</p><p>{isEs ? `${profileSnapshots.length} snapshots de perfil guardados.` : `${profileSnapshots.length} profile snapshots stored.`}</p><p>{isEs ? `${travelPlans.length} planes de viaje guardados.` : `${travelPlans.length} travel plans stored.`}</p>{auditEvents.length === 0 ? <p>{isEs ? "Sin eventos todavia." : "No events yet."}</p> : auditEvents.slice(0,5).map((event) => <p key={event.id}><strong>{event.type}</strong> · {new Date(event.time).toLocaleString()} · {event.message}</p>)}</section></main></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
