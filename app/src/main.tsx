import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/workspace.css";
import "./styles/host.css";
import { App } from "./App";
import './canvas/cardLayout.css';
import { initializeAppearance } from './appearance/appearance';
import { installLumStartup } from './appearance/startupCover';
import { installLumMotion } from './appearance/lumMotion';
import { installDesktopShell } from './desktop/desktopShell';
import { installInstallerUpdateBridge } from './desktop/installerUpdateBridge';
import './appearance/lumTokens.css';
import './appearance/lumHost.css';
import './appearance/lumTypography.css';
import './appearance/lumMotion.css';
import './appearance/startupCover.css';

const cleanupAppearance = initializeAppearance();
const cleanupMotion = installLumMotion();
const cleanupStartup = installLumStartup();
const cleanupDesktop = installDesktopShell();
const cleanupInstallerUpdate = installInstallerUpdateBridge();
if (import.meta.hot) import.meta.hot.dispose(() => { cleanupAppearance(); cleanupMotion(); cleanupStartup(); cleanupDesktop(); cleanupInstallerUpdate(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
