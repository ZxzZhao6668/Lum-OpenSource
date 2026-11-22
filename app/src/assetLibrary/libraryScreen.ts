import {action,field,mainPanel,modal,node} from '../ui/localUi';
import {attachImageImport} from '../entities/entityImageImport';
import {mountLazyThumbnail} from '../ui/lazyThumbnail';
import {openImageViewer} from '../ui/imageViewer';
import {assetCategories,createSharedAsset,updateSharedAsset,getSharedAssetMedia,getSharedAssetThumbnail,sharedAssetCoverId,observeSharedAssets,addSharedAssetsToProject,type AssetCategory,type SharedAsset} from './store';
import {currentProjectId} from '../projects/projectIdentity';
import {openAssetAppearances} from './assetAppearancesPanel';
import './libraryScreen.css';

const pageSize = 24;

function editSharedAsset(asset:SharedAsset){
  const {dialog,body}=modal('编辑资产库资料');
  const name=field('名称',asset.name),notes=field('备注',asset.notes,true);
  name.input.maxLength=200;notes.input.maxLength=12000;
  const label=node('label','','localField'),select=node('select');select.setAttribute('aria-label','分类');
  for(const [value,text] of Object.entries(assetCategories)){const option=node('option',text);option.value=value;select.append(option);}select.value=asset.category;label.append(node('span','分类'),select);
  const preview=node('div','','assetLibraryPreview');preview.setAttribute('role','button');preview.tabIndex=0;preview.setAttribute('aria-label',`查看${asset.name}原图`);
  const mediaId = sharedAssetCoverId(asset);
  const open=()=>openImageViewer(getSharedAssetMedia(mediaId),asset.name);preview.onclick=open;preview.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}};
  body.append(preview,name.wrap,label,notes.wrap,node('p','修改共用库中的资料，已经添加到项目的副本保持不变。','localMuted'),action('保存资料',async()=>{
    await updateSharedAsset(asset.id,{name:name.input.value,notes:notes.input.value,category:select.value as AssetCategory},asset.version);dialog.close();
  }));
  const thumbnail=mountLazyThumbnail(preview,asset.name,()=>({key:mediaId,load:()=>getSharedAssetThumbnail(mediaId),prepared:true}));
  dialog.addEventListener('close',thumbnail.dispose,{once:true});
  return () => { if (dialog.open) dialog.close(); };
}

export function mountSharedAssetLibrary(root:HTMLElement){
  const {page,body,header}=mainPanel(root,'资产库');page.classList.add('assetLibraryPage');
  header.append(node('span','所有项目共用','assetLibraryBadge'));
  let category:AssetCategory='male',uploadCategory:AssetCategory=category,rows:SharedAsset[]=[],busy=false,disposed=false,pageIndex=0;
  const selected=new Set<string>(),disposers:Array<()=>void>=[];
  const intro=node('p','上传图片建立共用资产，按需添加到当前项目的人物、地点或道具。名称和备注可随时编辑。','localMuted');
  const groups=node('div','','assetLibraryTabs');groups.setAttribute('role','group');groups.setAttribute('aria-label','资产类型');
  const genders=node('div','','assetLibraryGenders');genders.setAttribute('role','group');genders.setAttribute('aria-label','人物分类');
  const filters=node('div','','assetLibraryFilters'),search=node('input');search.type='search';search.placeholder='搜索名称或备注';search.setAttribute('aria-label','搜索资产库');
  const count=node('span','','localMuted');filters.append(search,count);
  const toolbar=node('div','','localRow');
  const paging=node('nav','','assetLibraryPaging');paging.setAttribute('aria-label','资产列表分页');
  const pageLabel=node('span','','localMuted');pageLabel.setAttribute('aria-live','polite');
  const previous=node('button','上一页','localButton'),next=node('button','下一页','localButton');
  previous.type=next.type='button';
  previous.onclick=()=>{pageIndex--;paint();};next.onclick=()=>{pageIndex++;paint();};
  paging.append(previous,pageLabel,next);
  let closeDetail:(()=>void)|undefined;
  const status=node('p','','localStatus');status.setAttribute('role','status');
  const grid=node('div','','localGrid assetLibraryGrid');
  const visible=()=>rows.filter(row=>row.category===category&&`${row.name}\n${row.notes}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
  const chosen=()=>visible().filter(row=>selected.has(row.id));
  const updateSelection=()=>{count.textContent=`${assetCategories[category]} · ${visible().length} 项 · 已选 ${chosen().length} 项`;add.disabled=busy||!currentProjectId||!chosen().length;all.disabled=none.disabled=busy;grid.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>{input.checked=selected.has(input.value);input.disabled=busy;});};
  const all=action('全选当前结果',()=>{visible().forEach(row=>selected.add(row.id));updateSelection();});
  const none=action('取消选择',()=>{selected.clear();updateSelection();});
  const add=node('button','添加到当前项目','localButton');add.type='button';
  add.onclick=async()=>{
    const ids=chosen().map(row=>row.id);if(!ids.length)return;busy=true;updateSelection();status.textContent='正在添加到当前项目…';
    try{const result=await addSharedAssetsToProject(ids);status.textContent=`已添加 ${result.added} 项，已在项目中 ${result.existing} 项。可在人物、地点或道具页面使用。`;}
    catch(error){status.textContent=`${error instanceof Error?error.message:String(error)}；已完成的添加会保留，再次添加会跳过已有副本。`;}
    finally{busy=false;updateSelection();}
  };toolbar.append(all,none,add);
  if(!currentProjectId)toolbar.append(action('前往项目首页',()=>location.assign('/')),node('span','打开一个项目后即可添加资产。','localMuted'));
  const changeCategory=(value:AssetCategory)=>{category=value;pageIndex=0;selected.clear();status.textContent='';paint();};
  const characters=action('人物',()=>changeCategory(category==='female'?'female':'male'));
  const scenes=action('场景',()=>changeCategory('scene')),props=action('道具',()=>changeCategory('prop'));
  const male=action('男',()=>changeCategory('male')),female=action('女',()=>changeCategory('female'));
  groups.append(characters,scenes,props);genders.append(male,female);
  body.append(intro,groups,genders,filters,toolbar,status,grid,paging);
  attachImageImport(header,{title:()=>`上传${assetCategories[uploadCategory]}图片`,begin:()=>{uploadCategory=category;},save:async(name,image)=>{await createSharedAsset({category:uploadCategory,name,image});},complete:()=>{search.value='';pageIndex=0;paint();}});
  function paint(){
    if(disposed||!page.isConnected)return;
    characters.setAttribute('aria-pressed',String(category==='male'||category==='female'));scenes.setAttribute('aria-pressed',String(category==='scene'));props.setAttribute('aria-pressed',String(category==='prop'));
    male.setAttribute('aria-pressed',String(category==='male'));female.setAttribute('aria-pressed',String(category==='female'));genders.hidden=category!=='male'&&category!=='female';
    disposers.splice(0).forEach(dispose=>dispose());grid.replaceChildren();
    const matches=visible(), pages=Math.max(1,Math.ceil(matches.length/pageSize));
    pageIndex=Math.max(0,Math.min(pageIndex,pages-1));
    pageLabel.textContent='第 '+(pageIndex+1)+' / '+pages+' 页';
    previous.disabled=pageIndex===0;next.disabled=pageIndex===pages-1;paging.hidden=pages===1;
    for(const asset of matches.slice(pageIndex*pageSize,(pageIndex+1)*pageSize)){
      const mediaId=sharedAssetCoverId(asset);
      const card=node('article','','localCard assetLibraryCard');card.dataset.assetId=asset.id;
      const image=node('button','','assetLibraryPreview');image.type='button';image.setAttribute('aria-label',`查看${asset.name}原图`);image.onclick=()=>openImageViewer(getSharedAssetMedia(mediaId),asset.name);
      const heading=node('label','','assetLibrarySelection'),check=node('input');check.type='checkbox';check.value=asset.id;check.setAttribute('aria-label',`选择 ${asset.name}`);check.onchange=()=>{if(check.checked)selected.add(asset.id);else selected.delete(asset.id);updateSelection();};heading.append(check,node('strong',asset.name));
      const controls=node('div','','localRow assetLibraryCardActions');
      controls.append(action('造型与视图',()=>{closeDetail?.();closeDetail=openAssetAppearances(asset.id);}),
        action('编辑资产',()=>{closeDetail?.();closeDetail=editSharedAsset(asset);}));
      card.append(image,heading,node('p',asset.notes||'暂无备注','assetLibraryNotes'),controls);grid.append(card);
      disposers.push(mountLazyThumbnail(image,asset.name,()=>({key:mediaId,load:()=>getSharedAssetThumbnail(mediaId),prepared:true})).dispose);
    }
    if(!grid.children.length)grid.append(node('p',search.value?'没有符合条件的资产。':`暂无${assetCategories[category]}，点击右上角“上传图片”添加。`,'localMuted'));
    updateSelection();
  }
  let paintTimer:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{clearTimeout(paintTimer);paintTimer=setTimeout(paint,60);};
  search.oninput=()=>{pageIndex=0;schedule();};
  const subscription=observeSharedAssets(value=>{rows=value;const ids=new Set(rows.map(row=>row.id));for(const id of selected)if(!ids.has(id))selected.delete(id);schedule();},error=>{status.textContent=`资产库读取失败：${error instanceof Error?error.message:String(error)}`;});
  const detach=new MutationObserver(()=>{if(page.isConnected)return;disposed=true;closeDetail?.();clearTimeout(paintTimer);subscription.unsubscribe();disposers.splice(0).forEach(dispose=>dispose());rows=[];detach.disconnect();});
  detach.observe(root,{childList:true,subtree:true});paint();
}
