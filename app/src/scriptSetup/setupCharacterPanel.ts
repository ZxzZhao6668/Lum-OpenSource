import { listEntitySummaries, type EntitySummary } from '../data/entityCatalog';
import { node } from '../ui/localUi';
import {
  applyCharacterProfile, createCharacterWithProfile, readCharacterProfileEditor, type CharacterProfileSource,
} from './characterProfiles';
import { PERSONALITY_GROUPS, matchesCatalog, toChoice } from './scriptSetupCatalog';
import {
  PROFILE_FIELDS, emptyCharacterProfile, type CharacterEdit, type CharacterProfile, type ProfileField, type ScriptSetupPayload, type SetupCharacter,
} from './scriptSetupModel';
import { button, checkbox, choicePicker, editStages, focusLater, labelledButton, note, orderList, searchControl, selectControl, textControl, type SetupView } from './setupControls';

type Scope = {projectId: string; workspaceEpoch: string};
const identity = (character: SetupCharacter) => 'entityId' in character ? character.entityId : character.draftProfileId;
const summaryName = (row: EntitySummary) => `${row.name} · ${row.id}${row.meta ? ` · ${row.meta}` : ''}`;
export function renderCharacters(view: SetupView, payload: ScriptSetupPayload, edits: Map<string, CharacterEdit>, scope: Scope) {
  let catalog: readonly EntitySummary[] = [];
  let selected = '';
  const roster=node('div','','ssChoiceList'), addSlot=node('div'), editSlot=node('div');
  const intro=note('从项目角色选择，或先建立待绑定人设。已绑定角色的编辑随设定草稿保存；只有点「应用到人物档案」才会更新档案。');
  view.body.append(intro,roster,addSlot,editSlot);
  function renderRoster() {
    roster.replaceChildren();
    for (const character of payload.characters) {
      const id = identity(character);
      const row = 'entityId' in character ? catalog.find(item => item.id === id) : undefined;
      const label = 'entityId' in character ? row ? summaryName(row) : `已绑定 · ${id}` : `${character.name || '未命名人设'} · 待绑定`;
      const b = button(label, () => void view.perform(async () => {selected=id;renderRoster();await renderEditor();}));
      b.dataset.characterId=id;b.setAttribute('aria-pressed',String(selected===id));roster.append(b);
    }
    if (!payload.characters.length) roster.append(note('尚未选择人物。'));
  }
  function renderAdd() {
    const search = searchControl('按人物名称、身份或 ID 搜索');
    const chooser = selectControl('添加项目人物', [['','请选择']], '', () => {add.disabled = !chooser.select.value;});
    const add = button('添加已有角色', () => void view.perform(async () => {
      const id=chooser.select.value;
      if (!id || payload.characters.some(character=>identity(character)===id)) return;
      if (payload.characters.length >= 200) throw Error('最多添加 200 个人物。');
      const {record} = await readCharacterProfileEditor(id);
      if (!addSlot.isConnected) return;
      payload.characters.push({entityId:id,profileRevision:record?.revision??0}); selected=id;view.change();renderRoster();filter();await renderEditor();
    }));
    function filter() {
      const value=chooser.select.value;
      const all=catalog.filter(row => !payload.characters.some(c=>identity(c)===row.id) && matchesCatalog(search.value,row.name,row.meta,row.id));
      const initial=node('option',all.length ? '请选择' : '没有匹配的可添加角色');initial.value='';chooser.select.replaceChildren(initial);
      for (const row of all) {const option=node('option',summaryName(row));option.value=row.id;chooser.select.append(option);}
      chooser.select.value=all.some(row=>row.id===value)?value:'';add.disabled=!chooser.select.value;
    }
    search.oninput=filter;
    const draft=button('新建待绑定人设',()=> {
      if (payload.characters.length>=200) {view.notice('最多添加 200 个人物。',true);return;}
      const draftProfileId=`draft-${crypto.randomUUID()}`;
      payload.characters.push({draftProfileId,name:'',profile:emptyCharacterProfile()});
      selected=draftProfileId;view.change();renderRoster();void renderEditor();
    });
    const row=node('div','','ssRow');row.append(search,chooser.wrap,add,draft);addSlot.replaceChildren(row);filter();
  }
  function remove(character: SetupCharacter) {
    const id=identity(character);
    payload.characters=payload.characters.filter(c=>identity(c)!==id);
    if ('entityId' in character) edits.delete(id);
    selected='';view.change();renderRoster();renderAdd();editSlot.replaceChildren(note('已从设定中移除。项目角色及其档案保留。'));
  }
  async function adopt(createdId: string, previousId: string, profileRevision: number) {
    const index=payload.characters.findIndex(c=>identity(c)===previousId);
    if (index<0) return;
    payload.characters[index]={entityId:createdId,profileRevision};
    selected=createdId;view.change();catalog=await listEntitySummaries('character');
    if (view.body.isConnected) {renderRoster();renderAdd();await renderEditor();}
  }
  async function renderEditor() {
    const character=payload.characters.find(c=>identity(c)===selected);
    editSlot.replaceChildren();
    if (!character) return;
    const id=identity(character), removeButton=button('从设定中移除',()=>remove(character));
    if (!('entityId' in character)) {
      const name=textControl('待绑定人设名称',character.name,value=>{character.name=value;view.change();renderRoster();},{max:120});
      const bind=selectControl('绑定已有项目角色', [['','请选择'],...catalog.filter(row=>!payload.characters.some(c=>identity(c)===row.id)).map(row=>[row.id,summaryName(row)] as [string,string])], '',()=>{bindButton.disabled=!bind.select.value;});
      const bindButton=button('绑定并保留待应用编辑',()=>void view.perform(async()=>{
        const target=bind.select.value;if(!target) return;
        const {source,record}=await readCharacterProfileEditor(target);
        if (source.workspaceEpoch!==scope.workspaceEpoch) throw Error('工作区已恢复，请重新打开设定器。');
        if (!editSlot.isConnected || selected!==id) return;
        const profile=structuredClone(character.profile);
        // Stage a merge: draft values win only when populated; preserve existing facts and locks.
        if (record) {
          for(const key of Object.keys(PROFILE_FIELDS) as ProfileField[]) if(!profile[key].trim() || record.profile.lockedFields.includes(key)) profile[key]=record.profile[key];
          if(!profile.personality.length || record.profile.lockedFields.includes('personality')) profile.personality=record.profile.personality;
          if(!profile.relationships.length || record.profile.lockedFields.includes('relationships')) profile.relationships=record.profile.relationships;
          if(!profile.growth.length || record.profile.lockedFields.includes('growth')) profile.growth=record.profile.growth;
          profile.lockedFields=[...new Set([...record.profile.lockedFields,...profile.lockedFields])];
        }
        profile.relationships=profile.relationships.filter(rel=>rel.entityId!==target);
        edits.set(target,{entityId:target,expectedRevision:record?.revision??0,expectedEntityFingerprint:source.fingerprint,profile});
        await adopt(target,id,record?.revision??0);view.notice('人设已绑定；请核对编辑后再明确应用档案。');
      }));bindButton.disabled=true;
      const create=button('新建项目角色并应用档案',()=>void view.perform(async()=>{
        const {receipt}=await createCharacterWithProfile(character.name,character.profile,scope);
        if (!editSlot.isConnected || selected!==id) return;
        await adopt(receipt.record.entityId,id,receipt.record.revision);
        view.notice(`项目人物已新建，档案版本 ${receipt.record.revision} 已写入。`);
      }));
      editSlot.append(name.wrap,note('待绑定人设只参与文字创作。绑定或新建后才有真实人物 ID。'),bind.wrap,bindButton,create,
        profileFields(view,character.profile,catalog,undefined,view.change),removeButton);
      focusLater(name.input);return;
    }
    let current: Awaited<ReturnType<typeof readCharacterProfileEditor>>;
    editSlot.append(note('正在读取人物档案…'));
    try { current=await readCharacterProfileEditor(id); }
    catch (error) { if (editSlot.isConnected && selected===id) editSlot.replaceChildren(note(error instanceof Error ? error.message : String(error)),removeButton);return; }
    if (!editSlot.isConnected || selected!==id) return;
    const pending=edits.get(id);
    const profile=structuredClone(pending?.profile ?? current.record?.profile ?? emptyCharacterProfile());
    let expectedRevision=pending?.expectedRevision ?? current.record?.revision ?? 0;
    let expectedEntityFingerprint=pending?.expectedEntityFingerprint ?? current.source.fingerprint;
    function change() {edits.set(id,{entityId:id,profile,expectedRevision,expectedEntityFingerprint});view.change();}
    const apply=button('应用到人物档案',()=>void view.perform(async()=>{
      if(!edits.has(id)){view.notice('当前人物没有待应用编辑。');return;}
      const receipt=await applyCharacterProfile(id,profile,expectedRevision,expectedEntityFingerprint,scope);
      character.profileRevision=receipt.record.revision; edits.delete(id);view.change();await renderEditor();
      view.notice(`「${receipt.source.name}」档案版本 ${receipt.record.revision} 已写入；人物造型未修改。`);
    }),'ssPrimary');
    const conflict = expectedRevision !== (current.record?.revision ?? 0) || expectedEntityFingerprint !== current.source.fingerprint;
    const title=node('h4',current.source.name,'ssSubtitle');title.tabIndex=-1;
    editSlot.replaceChildren(title, note(sourceText(current.source,current.record?.revision)), apply, removeButton);
    if(conflict){
      const review=node('details','','ssGroup');const old=current.record?.profile??emptyCharacterProfile();
      review.append(node('summary','档案有更新：查看当前版本与本地编辑'),note('核对改动后可沿用当前档案为基准；这一步还不会写入人物。'));
      for (const key of [...Object.keys(PROFILE_FIELDS), 'personality','relationships','growth','lockedFields'] as (keyof CharacterProfile)[]) {
        if (JSON.stringify(profile[key])===JSON.stringify(old[key])) continue;
        const describe=(data: CharacterProfile[typeof key]) => typeof data==='string' ? data||'未设' : JSON.stringify(data);
        review.append(note(`${PROFILE_FIELDS[key as ProfileField]??key} · 当前：${describe(old[key])} · 本地：${describe(profile[key])}`));
      }
      apply.disabled=true;
      review.append(button('沿用当前档案版本，保留本地编辑',()=>{expectedRevision=current.record?.revision??0;expectedEntityFingerprint=current.source.fingerprint;change();apply.disabled=false;review.remove();apply.focus();}),
        button('用当前档案重新编辑',()=>{edits.delete(id);view.change();void renderEditor();}));
      editSlot.append(review);
    }
    editSlot.append(profileFields(view,profile,catalog,id,change));
    focusLater(title);
  }
  renderRoster();
  void view.perform(async()=>{catalog=await listEntitySummaries('character');if(view.body.isConnected){renderRoster();renderAdd();}});
}
function sourceText(source: CharacterProfileSource, revision?: number) {
  return [source.entityId, source.meta, revision ? `档案 v${revision}` : '尚未建立档案',
    source.appearanceName ? `已采用造型：${source.appearanceName}，档案不会替换造型` : source.hasImage ? '项目人物现有图片保留' : ''].filter(Boolean).join(' · ');
}

function profileFields(view: SetupView, data: CharacterProfile, catalog: readonly EntitySummary[], selfId: string | undefined, change: () => void) {
  const fields=node('div','','ssProfileFields');
  const text=(key: ProfileField, options: {multiline?:boolean}={})=>textControl(PROFILE_FIELDS[key],data[key],value=>{data[key]=value;change();},options).wrap;
  const identityGroup=node('fieldset','','ssGroup');identityGroup.append(node('legend','身份与职业'),text('identity'),text('occupation'));
  const personality=node('fieldset','','ssGroup');personality.append(node('legend','人物性格'),note('每人最多 5 个核心性格；首项优先。情境表现写在标签下方。'));
  const ordered=orderList(data.personality, item=>item.label,()=>{change();picker.refresh();});
  const picker=choicePicker(view,PERSONALITY_GROUPS,{
    label:'搜索性格标签',active:()=>data.personality,limit:5,custom:'personality',
    pick:item=>{const index=data.personality.findIndex(c=>c.id===item.id);if(index<0)data.personality.push(toChoice(item));else data.personality.splice(index,1);change();ordered.render();},
  });
  personality.append(ordered.list,picker.wrap,text('everyday',{multiline:true}),text('underPressure',{multiline:true}));
  const traits=node('fieldset','','ssGroup');traits.append(node('legend','人物特点'));
  for(const key of ['speech','habits','appearance','abilities','limitations','motives','values'] as const) traits.append(text(key,{multiline:true}));
  const relationships=node('fieldset','','ssGroup');relationships.append(node('legend','关系中的表现'));
  const relationList=node('div');
  function renderRelationships(){
    relationList.replaceChildren();
    const picker=selectControl('添加关系人物',[['','请选择具体人物'],...catalog.filter(row=>row.id!==selfId&&!data.relationships.some(rel=>rel.entityId===row.id)).map(row=>[row.id,summaryName(row)] as [string,string])],'',()=>{add.disabled=!picker.select.value;});
    const add=button('添加关系',()=>{if(!picker.select.value)return;if(data.relationships.length>=100){view.notice('最多添加 100 条人物关系。',true);return;}data.relationships.push({entityId:picker.select.value,behavior:''});change();renderRelationships();});add.disabled=true;
    for(const rel of data.relationships){
      const other=catalog.find(row=>row.id===rel.entityId);
      const row=node('div','','ssRow');
      const title=other?summaryName(other):`失效人物 · ${rel.entityId}`;
      row.append(textControl(`面对 ${title} 时`,rel.behavior,value=>{rel.behavior=value;change();},{multiline:true}).wrap,
        labelledButton('移除关系',`移除与 ${title} 的关系`,()=>{data.relationships=data.relationships.filter(item=>item!==rel);change();renderRelationships();}));
      relationList.append(row);
    }
    relationList.append(picker.wrap,add);
  }
  relationships.append(relationList);renderRelationships();
  const growth=node('fieldset','','ssGroup');growth.append(node('legend','目标与成长'),text('goal',{multiline:true}),editStages(data.growth,change));
  const locks=node('fieldset','','ssGroup ssLocks');locks.append(node('legend','人物字段锁定'),note('锁定值作为人物事实供新任务检查，也会保留在绑定草稿时。'));
  const labels={...PROFILE_FIELDS,personality:'核心性格',relationships:'关系',growth:'成长阶段'} as const;
  for(const key of Object.keys(labels) as (keyof typeof labels)[]) locks.append(checkbox(labels[key], data.lockedFields.includes(key),on=>{
    data.lockedFields=on?[...data.lockedFields,key]:data.lockedFields.filter(field=>field!==key);change();
  }));
  fields.append(identityGroup,personality,traits,relationships,growth,locks);return fields;
}

