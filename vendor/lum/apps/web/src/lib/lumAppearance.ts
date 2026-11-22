import { onBeforeUnmount, watchEffect } from "vue";
import { uiSettings } from "@/stores/settings";

export function useLumAppearance() {
  const hostOrigins = new Set(["http://localhost:5178", "http://127.0.0.1:5178", "http://127.0.0.1:6178"]);
  const systemTheme = matchMedia("(prefers-color-scheme: dark)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const referrerOrigin = URL.canParse(document.referrer) ? new URL(document.referrer).origin : "";
  let hostOrigin = hostOrigins.has(referrerOrigin) ? referrerOrigin : "";
  const apply = () => {
    const settings = uiSettings.value;
    const dark = settings.theme === "dark" || (settings.theme === "system" && systemTheme.matches);
    const theme = dark ? "black" : settings.lumPalette === "mono" ? "white" : "lime";
    const appearance = { theme, motion: settings.lumMotion, glass: settings.lumGlass, primaryColor: settings.primaryColor, fontScale: settings.fontScale, radius: settings.radius, startupAnimation: settings.startupAnimation };
    try { localStorage.setItem("lum:appearance:v1", JSON.stringify(appearance)); } catch { /* Cached appearance is optional; persistent settings stay authoritative. */ }
    const root = document.documentElement;
    root.dataset.lumTheme = theme;
    root.dataset.lumMotion = reduced.matches ? "off" : settings.lumMotion;
    root.dataset.lumGlass = settings.lumGlass ? "on" : "off";
    root.dataset.lumStartup = settings.startupAnimation ? "on" : "off";
    root.style.setProperty("--lum-radius", `${settings.radius}px`);
    root.style.setProperty("--lum-accent", settings.primaryColor);
    const rgb = [1, 3, 5].map(offset => parseInt(settings.primaryColor.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    root.style.setProperty("--lum-on-accent", rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? "#171a15" : "#fff");
    window.dispatchEvent(new Event("lum:appearanceChanged"));
    if (window.parent !== window && hostOrigin) window.parent.postMessage({ type: "lum:appearance", appearance }, hostOrigin);
  };
  const receive = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent || !hostOrigins.has(event.origin) || event.data?.type !== "lum:appearanceRequest") return;
    hostOrigin = event.origin;
    apply();
  };
  watchEffect(apply);
  systemTheme.addEventListener("change", apply);
  reduced.addEventListener("change", apply);
  window.addEventListener("message", receive);
  onBeforeUnmount(() => { systemTheme.removeEventListener("change", apply); reduced.removeEventListener("change", apply); window.removeEventListener("message", receive); });
}

export function requestLumStartupPreview() {
  const origin = URL.canParse(document.referrer) ? new URL(document.referrer).origin : "";
  if (window.parent !== window && ["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(origin)) window.parent.postMessage({ type: "lum:startupPreview" }, origin);
  else window.dispatchEvent(new Event("lum:startupPreview"));
}
