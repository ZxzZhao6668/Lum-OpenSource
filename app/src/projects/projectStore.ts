import Dexie from 'dexie';
import { DataDB } from '../data/db';
import { projectDatabaseName } from './projectIdentity';

export type ProjectKind = 'script' | 'novel';
export interface Project {
  id: string; name: string; kind: ProjectKind; createdAt: number; openedAt: number; trashedAt?: number;
}
export interface ProjectSummary extends Project { summary: string; updatedAt: number; unavailable?: boolean }
class ProjectCatalog extends Dexie {
  projects!: Dexie.Table<Project, string>;
  constructor() { super('writing-project-catalog'); this.version(1).stores({ projects: 'id, openedAt, trashedAt' }); }
}
const catalog = new ProjectCatalog();
let initialization: Promise<void> | undefined;
export function initializeProjects() {
  return initialization ??= (async () => {
    if (await catalog.projects.get('legacy') || !await Dexie.exists('laper-data')) return;
    const old = new DataDB('laper-data');
    try {
      if (!await old.docs.count() && !await old.entities.count()) return;
      const meta = (await old.docs.get('project:meta'))?.payload as { name?: string; kind?: ProjectKind } | undefined;
      const now = Date.now();
      await catalog.transaction('rw', catalog.projects, async () => {
        if (!await catalog.projects.get('legacy')) await catalog.projects.add({ id: 'legacy', name: meta?.name || '我的写作项目', kind: meta?.kind === 'novel' ? 'novel' : 'script', createdAt: now, openedAt: now });
      });
    } finally { old.close(); }
  })().catch(error => { initialization = undefined; throw error; });
}
export async function getProject(id: string) { await initializeProjects(); return catalog.projects.get(id); }
/** Project selector options without loading manuscript or media payloads. */
export async function listWritingProjectChoices(): Promise<Project[]> {
  await initializeProjects();
  return (await catalog.projects.orderBy('openedAt').reverse().toArray()).filter(project => !project.trashedAt);
}
export async function listProjects(): Promise<ProjectSummary[]> {
  await initializeProjects();
  const result: ProjectSummary[] = [];
  for (const item of await catalog.projects.toArray()) {
    const data = new DataDB(projectDatabaseName(item.id));
    try {
      if (!await Dexie.exists(data.name)) {
        result.push({ ...item, unavailable: true, summary: '本地项目数据暂不可用。记录已保留，请从备份恢复或检查浏览器存储。', updatedAt: item.openedAt || item.createdAt });
        continue;
      }
      const meta = (await data.docs.get('project:meta'))?.payload as { name?: string; synopsis?:string } | undefined;
      const index = (await data.docs.get('episode:ep_001'))?.payload as { chapters?: { episodeId?: string; content?: string }[] } | undefined;
      const first = index?.chapters?.[0];
      const blocks = (await data.docs.get(`script:${first?.episodeId ?? 'ep_001'}`))?.payload as { text: string }[] | undefined;
      const cover = (await data.docs.get(`cover:${first?.episodeId ?? 'ep_001'}`))?.payload as { synopsis?: string } | undefined;
      const summary = meta?.synopsis || cover?.synopsis || (item.kind === 'novel' ? first?.content : '') || blocks?.map(block => block.text).filter(Boolean).join(' ') || first?.content || '开始你的创作之旅…';
      const last = await data.docs.orderBy('updatedAt').last();
      result.push({ ...item, name: meta?.name || item.name, summary: summary.slice(0, 160), updatedAt: last?.updatedAt ?? item.createdAt });
    } finally { data.close(); }
  }
  return result.sort((a,b) => Number(!!a.unavailable) - Number(!!b.unavailable) || Math.max(b.openedAt,b.updatedAt) - Math.max(a.openedAt,a.updatedAt));
}
export async function createProject(name: string, kind: ProjectKind): Promise<Project> {
  const title = name.trim(); if (!title || title.length > 120) throw Error('项目名称需为 1—120 字');
  const now = Date.now(); const project: Project = { id: crypto.randomUUID(), name: title, kind, createdAt: now, openedAt: now };
  const data = new DataDB(projectDatabaseName(project.id));
  try {
    await data.transaction('rw', data.docs, async () => {
      await data.docs.bulkAdd([
        { key:'project:meta', payload:{ name:project.name, kind, emptyProjectVersion:3 }, updatedAt:now },
        { key:'episode:ep_001', payload:{ collapsed:false, chapters:[{ id:'ep_001', episodeId:'ep_001', title:'未分章草稿', content:'', draft:true }] }, updatedAt:now },
        { key:'script:ep_001', payload:[], updatedAt:now },
        { key:'entities:initialized', payload:true, updatedAt:now },
        { key:'outline:ep_001', payload:{active:0,docs:[{id:'outline',title:'大纲',html:'<p></p>'}]}, updatedAt:now },
        { key:'storyboard:ep_001', payload:[], updatedAt:now },
        { key:'scene:desc:ep_001', payload:{}, updatedAt:now },
        { key:'project:worldview', payload:'', updatedAt:now },
      ]);
    });
    await catalog.projects.add(project);
    return project;
  } finally { data.close(); }
}
export async function openProject(id: string, view: 'writing' | 'production' = 'writing') {
  const project = await getProject(id); if (!project || project.trashedAt) throw Error('请先从回收站恢复项目');
  if (!await Dexie.exists(projectDatabaseName(id))) throw Error(`项目“${project.name}”的数据不可用，请保留备份后检查浏览器存储。`);
  await catalog.projects.update(id, { openedAt:Date.now() });
  location.assign(`/?project=${encodeURIComponent(id)}${view === 'production' ? '&view=production' : ''}`);
}
export async function renameProject(id: string, name: string) {
  const title = name.trim(); if (!title || title.length > 120) throw Error('项目名称需为 1—120 字');
  const project = await getProject(id); if (!project) throw Error('项目不存在');
  const data = new DataDB(projectDatabaseName(id));
  try {
    if (!await Dexie.exists(data.name)) throw Error(`项目“${project.name}”的数据不可用，暂不能重命名，请保留备份后检查浏览器存储。`);
    await data.transaction('rw',data.docs,async()=>{
      const meta = (await data.docs.get('project:meta'))?.payload as Record<string,unknown> | undefined;
      await data.docs.put({ key:'project:meta',payload:{...meta,name:title,kind:project.kind},updatedAt:Date.now() });
    });
    await catalog.projects.update(id,{name:title});
  } finally { data.close(); }
}
export async function trashProject(id: string, trash: boolean) {
  if (!await getProject(id)) throw Error('项目不存在');
  await catalog.projects.update(id, { trashedAt:trash ? Date.now() : undefined });
}
