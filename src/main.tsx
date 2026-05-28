import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

const modules = ["Overview", "Cooldowns", "Profile", "Travel", "Market", "Networth", "History", "Settings"];
const esModules = ["Resumen", "Cooldowns", "Perfil", "Viajes", "Mercado", "Networth", "Historial", "Ajustes"];

function App() {
  const [locale, setLocale] = useState(localStorage.getItem("tornapps:locale") || "en");
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const isEs = locale === "es";
  const names = isEs ? esModules : modules;

  function toggleLocale() {
    const next = isEs ? "en" : "es";
    localStorage.setItem("tornapps:locale", next);
    setLocale(next);
  }

  if (!unlocked) {
    return <main className="lock"><section className="card lockcard"><div className="logo">TA</div><p className="eyebrow">{isEs ? "Asistente personal de Torn" : "Privacy-first Torn assistant"}</p><h1>{isEs ? "Desbloquear TornApps" : "Unlock TornApps"}</h1><p className="muted">{isEs ? "Bloqueo local del navegador. No uses tu contrasena de Torn." : "Local browser lock. Do not use your Torn password."}</p><input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={isEs ? "Frase local" : "Local passphrase"} /><button className="primary" onClick={() => setUnlocked(passphrase.length >= 4)}>{isEs ? "Entrar" : "Enter"}</button><button className="ghost" onClick={toggleLocale}>{isEs ? "English" : "Espanol"}</button></section></main>;
  }

  return <div className="shell"><aside><div className="brand"><div className="logo small">TA</div><div><strong>TornApps</strong><span>M0 static shell</span></div></div><nav>{names.slice(0,3).map((name) => <a key={name} href="#modules">{name}</a>)}</nav></aside><main className="content"><header><div><p className="eyebrow">{isEs ? "Privacidad primero" : "Privacy first"}</p><h1>{isEs ? "Centro de mando personal" : "Personal command center"}</h1><p className="muted">{isEs ? "Shell inicial. Lo siguiente es validar API key y bloquear Full Access." : "Initial shell. Next step is API key validation and Full Access blocking."}</p></div><button className="ghost" onClick={toggleLocale}>{locale.toUpperCase()}</button></header><section className="hero card"><h2>{isEs ? "Siguiente accion" : "Next action"}</h2><p>{isEs ? "Construir pantalla de API key, key/info y deteccion de permisos." : "Build API key screen, key/info validation, and scope detection."}</p></section><section id="modules" className="grid">{names.map((name, index) => <article className="card module" key={name}><div className="row"><h3>{name}</h3><span>{index === 0 || index === 7 ? (isEs ? "Listo" : "Ready") : (isEs ? "Plan" : "Planned")}</span></div><p>{isEs ? "Modulo preparado para la siguiente fase." : "Module placeholder ready for the next phase."}</p></article>)}</section></main></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
