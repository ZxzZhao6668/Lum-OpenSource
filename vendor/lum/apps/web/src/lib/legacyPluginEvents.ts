const pluginEvents = [
  "agentDraft", "agentNodeCancel", "agentNodePrepare", "agentNodeProgress", "agentNodeRequest",
  "agentNodeResult", "ext-config-updated", "ext-updated", "node-config-updated", "plugin-installed",
  "provider-config-changed", "virtualStageClosed",
];

export function registerLegacyPluginEvents() {
  const forwarded = new WeakSet<Event>();
  const bindings = pluginEvents.flatMap(name => [
    [`lum:${name}`, `toonflow:${name}`],
    [`toonflow:${name}`, `lum:${name}`],
  ] as const).map(([source, target]) => {
    const forward = (event: Event) => {
      if (forwarded.has(event)) return;
      const alias = new CustomEvent(target, { detail: (event as CustomEvent).detail, cancelable: event.cancelable });
      forwarded.add(alias);
      if (!window.dispatchEvent(alias)) event.preventDefault();
    };
    window.addEventListener(source, forward);
    return () => window.removeEventListener(source, forward);
  });
  return () => bindings.forEach(remove => remove());
}
