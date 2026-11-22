import { writingWorkspace } from '../projects/projectIdentity';
import {node,action,modal,downloadText} from '../ui/localUi';
import {isWritingUse,listSkills,importSkills,assignSkill,removeSkill,skillUses,preferredSkill,rememberSkill,type SkillUse,type WritingSkill} from './skillStore';
import {skillCategory,groupSkills,readExpandedSkillGroups,rememberExpandedSkillGroups} from './skillGroups';
const availableUses = Object.entries(skillUses).filter(([key]) => !writingWorkspace || isWritingUse(key as SkillUse));

export async function skillSelect(use:SkillUse){
 const select=node('select');select.setAttribute('aria-label','Skill');let revision=0;
 const optional = writingWorkspace && use === 'agent';
 const refresh=async()=>{
   const token = ++revision, all = await listSkills(use), preferred = await preferredSkill(use, all);
   if(token !== revision) return;
   const current = select.value;
   const keep = select.options.length > 0 && (optional && !current || all.some(s => s.id === current));
   select.replaceChildren();
   if(optional) { const none=node('option','不使用额外技能'); none.value=''; select.append(none); }
   for(const skill of all) {
     const option=node('option', skill.name + ' · ' + (skill.source==='laper-public'?'Laper 公开':skill.source==='local'?'本地':'导入'));
     option.value=skill.id;option.title=skill.description;select.append(option);
   }
   select.value = keep ? current : preferred?.id ?? '';
   select.dispatchEvent(new Event('input'));
 };
 await refresh();const changed=()=>void refresh().catch(e=>{select.title=String(e);});window.addEventListener('dsh:skills-changed',changed);
 let mounted=false;const lifecycle=new MutationObserver(()=>{if(select.isConnected)mounted=true;else if(mounted){lifecycle.disconnect();window.removeEventListener('dsh:skills-changed',changed);}});lifecycle.observe(document.body,{childList:true,subtree:true});
 select.onchange=()=>void rememberSkill(use,select.value).catch(e=>{select.title=String(e);});
 return Object.assign(select, {async chooseSkill(id:string){
   if(!Array.from(select.options).some(option=>option.value===id))await refresh();
   if(!Array.from(select.options).some(option=>option.value===id))throw Error('此技能已不适用于当前功能，请重新选择');
   select.value=id;select.dispatchEvent(new Event('input'));
 }});
}
export async function mountSkillLibrary(body:HTMLElement, defaultAgent=false, index?:HTMLElement|null){
 body.classList.add('skillLibrary');
 index?.setAttribute('role','navigation');index?.setAttribute('aria-label','技能分类');
 body.replaceChildren(node('p',writingWorkspace?'选择适合当前稿件的构思、改写或润色规则。':'点击分类展开技能，或搜索名称、模型和风格。人物／场景／分镜图技能在对应生图面板选择；视频技能可在写作 Agent 分阶段使用。画布 Agent 的“选择技能”也可使用本页全部内置与导入 Skill，打开列表或发送任务时同步。选择技能不会切换模型或自动生成视频。导入文件只作为创作规则读取。','localMuted'));
 const status=node('p');status.setAttribute('role','status');const input=node('input');input.type='file';input.accept='.md,.markdown,.txt,.json';input.multiple=true;input.setAttribute('aria-label','导入 Skill');input.hidden=true;
 const importRow=node('div','','localRow');const agentUse=node('input');agentUse.type='checkbox';agentUse.checked=defaultAgent;const agentLabel=node('label');agentLabel.append(agentUse,node('span','导入后同时用于写作 Agent'));importRow.append(action('导入 Skill',()=>input.click()),node('span','支持 Markdown / TXT / JSON','localMuted'),agentLabel);
 const filters=node('div','','skillFilters');
 const search=node('input');search.type='search';search.placeholder=writingWorkspace?'搜索写作技能':'搜索名称、模型或风格，如 Seedance 2.0';search.setAttribute('aria-label','搜索技能');
 const collection=node('select');collection.setAttribute('aria-label','筛选技能包');
 const use=node('select');use.setAttribute('aria-label','筛选技能用途');
 const allUses=node('option','全部用途');allUses.value='';use.append(allUses);
 for(const [key,label]of availableUses){const option=node('option',label);option.value=key;use.append(option);}
 const count=node('span','','localMuted');count.setAttribute('role','status');
 filters.append(search,collection,use,count);
 const groups=node('div','','skillGroups');let skills:WritingSkill[]=[],revision=0,visible:WritingSkill[]=[];
 const expanded=readExpandedSkillGroups();let filteredExpanded=new Set<string>(),lastFilter='';
 let groupViews:{name:string;section:HTMLDetailsElement;sync:()=>void}[]=[];
 const groupActions=node('div','','skillGroupActions');
 const setAll=(open:boolean)=>{for(const view of groupViews){view.section.open=open;view.sync();}};
 const expandAll=action('全部展开',()=>setAll(true)),collapseAll=action('全部收起',()=>setAll(false));
 groupActions.append(node('span','按分类浏览 · 展开状态自动记住','localMuted'),expandAll,collapseAll);
 const render=()=>{
 const query=search.value.toLowerCase().replace(/\s+/g,'');
 visible=skills.filter(s=>(!collection.value||(s.collection??'其他技能')===collection.value)&&(!use.value||s.uses.includes(use.value as SkillUse))&&`${s.name} ${s.description} ${skillCategory(s)}`.toLowerCase().replace(/\s+/g,'').includes(query));
 const categorized=groupSkills(visible),filter=query||collection.value||use.value?JSON.stringify([query,collection.value,use.value]):'';
 if(filter!==lastFilter){filteredExpanded=new Set(categorized.map(([name])=>name));lastFilter=filter;}
 const openGroups=filter?filteredExpanded:expanded;
 count.textContent=`显示 ${visible.length} / ${skills.length} 个技能 · ${categorized.length} 类`;groups.replaceChildren();index?.replaceChildren();groupViews=[];
 expandAll.disabled=collapseAll.disabled=!visible.length;
 if(!visible.length)groups.append(node('p','没有匹配的技能，试试其他关键词或筛选条件。','localMuted'));
 for(const [name,items]of categorized){
 const section=node('details','','skillGroup');section.open=openGroups.has(name);
 const heading=node('summary','','skillGroupHeading');
 const chevron=node('span','›','skillGroupChevron');chevron.setAttribute('aria-hidden','true');
 const indicator=node('span',section.open?'收起':'展开','skillGroupIndicator');indicator.setAttribute('aria-hidden','true');
 heading.append(chevron,node('h3',name),node('span',`${items.length} 个技能`,'skillGroupCount'),indicator);
 const grid=node('div','','localGrid skillGroupGrid');
 section.append(heading,grid);groups.append(section);
 index?.append(action(name,()=>{
   section.open=true;
   heading.focus({preventScroll:true});
   section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }));
 const sync=()=>{if(!section.isConnected)return;indicator.textContent=section.open?'收起':'展开';if(section.open)openGroups.add(name);else openGroups.delete(name);if(!filter)rememberExpandedSkillGroups(expanded);};
 section.addEventListener('toggle',sync);groupViews.push({name,section,sync});
 for(const s of items){
  const card=node('article','','localCard');card.dataset.skillId=s.id;const details=node('details');details.append(node('summary','查看规则'),node('pre',s.instruction,'skillRules'));
  const choices=node('div','','skillChoices');const checks=availableUses.map(([key,label])=>{const wrap=node('label');const box=node('input');box.type='checkbox';box.checked=s.uses.includes(key as SkillUse);wrap.append(box,node('span',label));choices.append(wrap);return {key:key as SkillUse,box};});
  card.append(node('h3',s.name),node('p',`${s.source==='laper-public'?'Laper 公开文风':s.source==='local'?'本地 Skill':'导入 Skill'} · ${s.description}`),details,choices,action('保存功能分配',async()=>{await assignSkill(s.id,[...checks.filter(c=>c.box.checked).map(c=>c.key),...s.uses.filter(u=>writingWorkspace&&!isWritingUse(u))]);status.textContent='功能分配已保存';await refresh();}),action('导出 Skill',()=>downloadText(`${s.name.replace(/[\\/:*?"<>|]/g,'_')}.json`,JSON.stringify(s,null,2),'application/json')));
  if(s.uses.includes('agent'))card.append(action('启用技能',async()=>{await rememberSkill('agent',s.id);window.dispatchEvent(new CustomEvent('dsh:skill-advisor',{detail:s.id}));status.textContent=`已启用 ${s.name}，在写作 Agent 输入要求后发送`; }));
  for(const source of s.sources??[]){const link=node('a',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
  if(s.source==='imported')card.append(action('删除 Skill',async()=>{if(!confirm(`删除 Skill「${s.name}」？`))return;await removeSkill(s.id);await refresh();}));
  const actions=node('div','','skillCardActions'),sources=node('div','','skillSources');
  card.querySelectorAll(':scope > button').forEach(button=>actions.append(button));
  card.querySelectorAll(':scope > a').forEach(link=>sources.append(link));
  card.append(actions,sources);grid.append(card);
 }}};
 const refresh=async()=>{const ticket=++revision;const next=await listSkills(undefined, writingWorkspace);if(ticket!==revision)return;skills=next;const selected=collection.value;collection.replaceChildren();const all=node('option','全部技能包');all.value='';collection.append(all);for(const name of new Set(skills.map(s=>s.collection??'其他技能'))){const option=node('option',name);option.value=name;collection.append(option);}collection.value=[...collection.options].some(option=>option.value===selected)?selected:'';render();};
 search.oninput=render;collection.onchange=render;use.onchange=render;
 importRow.append(action('导出当前筛选技能包',()=>{if(!visible.length)throw Error('没有可导出的技能');const text=JSON.stringify(visible,null,2);if(visible.length>100||text.length>600000)throw Error('当前合集超过单次导入上限，请按技能包或用途分批筛选后导出（每包最多100个、600000字符）');downloadText(`${(collection.value||'技能合集').replace(/[\\/:*?"<>|]/g,'_')}.json`,text,'application/json');}));
 input.onchange=()=>void(async()=>{input.disabled=true;try{let count=0;const useForAgent=agentUse.checked;for(const f of Array.from(input.files??[])){if(f.size>2*1024*1024)throw Error('Skill 文件最大2MB');const imported=await importSkills(f.name,await f.text());if(useForAgent)for(const s of imported)if(!s.uses.includes('agent'))await assignSkill(s.id,[...s.uses,'agent']);for(const s of imported)expanded.add(skillCategory(s));count+=imported.length;}rememberExpandedSkillGroups(expanded);search.value='';collection.value='';use.value='';status.textContent=`已导入 ${count} 个 Skill，已展开所属分类，请核对功能分配`;await refresh();}catch(e){status.textContent=String(e);}finally{input.disabled=false;input.value='';}})();body.append(importRow,input,filters,status,groupActions,groups);await refresh();
}
export async function openSkillLibrary(){const {body}=modal('Skill 库');await mountSkillLibrary(body);}
