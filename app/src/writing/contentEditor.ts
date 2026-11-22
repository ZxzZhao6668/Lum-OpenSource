/** Live page bridge. Call flush before navigating or applying a content proposal,
 * then reload after the write. The host must prevent edits during that operation. */
export interface ContentEditor {
  flush(): Promise<void>;
  reload(): Promise<void>;
  hasUnsavedChanges?(): boolean;
}

let active: { root: HTMLElement; editor: ContentEditor; valid: boolean } | null = null;

export function getActiveContentEditor(): ContentEditor | null {
  if (active && !active.root.isConnected) active.valid = false;
  return active?.valid ? active.editor : null;
}

window.addEventListener('beforeunload', event => {
  if (getActiveContentEditor()?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/** Returns a guard used immediately before every queued page write. */
export function registerContentEditor(root: HTMLElement, editor: ContentEditor): () => boolean {
  if (active) active.valid = false;
  const entry = { root, editor, valid: true };
  active = entry;
  return () => {
    if (!root.isConnected) entry.valid = false;
    return active === entry && entry.valid;
  };
}
