(() => {
  const required = [
    "key/info",
    "user/basic",
    "user/cooldowns",
    "user/bars",
    "user/travel",
    "user/networth",
    "market/itemmarket"
  ];
  const setValue = (el, value) => {
    if (!el) return false;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const clickByText = (texts) => {
    const targets = [...document.querySelectorAll("button,a,label,span,div,input,select,option")];
    const lower = texts.map((text) => text.toLowerCase());
    const found = targets.find((el) => lower.some((text) => (el.textContent || el.value || "").toLowerCase().includes(text)));
    if (found) {
      found.click();
      found.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  };
  const checkByText = (text) => {
    const labels = [...document.querySelectorAll("label")];
    const label = labels.find((el) => (el.textContent || "").toLowerCase().includes(text.toLowerCase()));
    if (label) {
      const forId = label.getAttribute("for");
      const input = forId ? document.getElementById(forId) : label.querySelector("input");
      if (input && "checked" in input) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      label.click();
      return true;
    }
    return clickByText([text]);
  };
  const nameFields = [...document.querySelectorAll("input,textarea")].filter((el) => /name|title|comment|description/i.test(el.name || el.id || el.placeholder || ""));
  setValue(nameFields[0] || document.querySelector("input[type='text']"), "TornApps");
  setValue(nameFields[1] || document.querySelector("textarea"), "TornApps unified tools");
  clickByText(["custom"]);
  required.forEach((endpoint) => {
    checkByText(endpoint);
    const last = endpoint.split("/").pop();
    if (last) checkByText(last);
  });
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:999999;right:16px;bottom:16px;max-width:360px;background:#10131d;color:white;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:14px;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.45)";
  box.innerHTML = `<strong>TornApps helper ran</strong><br><br>It attempted to set name/comment, select Custom, and tick required selections.<br><br><small>If some boxes were not ticked, tick these manually:<br>${required.join("<br>")}</small>`;
  document.body.appendChild(box);
})();
