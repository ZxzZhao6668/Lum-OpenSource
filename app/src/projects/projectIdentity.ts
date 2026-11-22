const requested = new URLSearchParams(location.search).get('project');
export const currentProjectId = requested === 'legacy' || /^[a-f0-9-]{36}$/i.test(requested ?? '') ? requested : null;
// Project writing and production share the same document IDs and database.
const view = new URLSearchParams(location.search).get('view');
export const writingWorkspace = !!currentProjectId && view !== 'production' && view !== 'canvas';
export const projectDatabaseName = (id: string) => id === 'legacy' ? 'laper-data' : `laper-project-${id}`;
export const projectStorageKey = (key: string) => currentProjectId && currentProjectId !== 'legacy' ? `project:${currentProjectId}:${key}` : key;
