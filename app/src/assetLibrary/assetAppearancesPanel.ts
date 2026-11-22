import { action, field, modal, node } from '../ui/localUi';
import { mountLazyThumbnail } from '../ui/lazyThumbnail';
import { openImageViewer } from '../ui/imageViewer';
import { currentProjectId } from '../projects/projectIdentity';
import {
  addSharedAssetViewToProject, assetViewPurposes, createSharedAssetAppearance,
  getSharedAssetMedia, getSharedAssetThumbnail, listSharedAssetAppearances, setActiveSharedAssetAppearance,
  type AssetAppearance, type AssetViewInput, type AssetViewPurpose, type SharedAsset,
} from './store';

const showOriginal = (mediaId: string, label: string) => openImageViewer(getSharedAssetMedia(mediaId), label);

function draftAppearance(asset: SharedAsset, basis: AssetAppearance, onSave: (id: string) => Promise<void>) {
  const { dialog, body } = modal('从图片新建造型');
  dialog.classList.add('assetLibraryDetail');
  const name = field('造型名称', '');
  name.input.maxLength = 120;
  const fileLabel = node('label', '', 'localField');
  const files = node('input');
  files.type = 'file';
  files.multiple = true;
  files.accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
  fileLabel.append(node('span', '添加视图图片'), files);
  const copyExisting = node('input');
  copyExisting.type = 'checkbox';
  const copyLabel = node('label', '', 'assetLibrarySelection');
  copyLabel.append(copyExisting, node('span', `一并保留「${basis.name}」的 ${basis.views.length} 张视图`));
  const inputs = node('div', '', 'assetLibraryViewInputs');
  const status = node('p', '', 'localStatus');
  status.setAttribute('role', 'status');
  let selected: { file: File; name: HTMLInputElement | HTMLTextAreaElement; purpose: HTMLSelectElement }[] = [];
  files.onchange = () => {
    selected = [];
    inputs.replaceChildren();
    status.textContent = '';
    const list = [...files.files ?? []];
    if (list.length > 25) {
      files.value = '';
      status.textContent = '每个造型最多 25 张视图';
      return;
    }
    for (const item of list) {
      const viewName = field('视图名称', item.name.replace(/\.[^.]*$/, '').slice(0, 120));
      viewName.input.maxLength = 120;
      const tag = node('label', '', 'localField'), select = node('select');
      for (const [key, title] of Object.entries(assetViewPurposes)) {
        const option = node('option', title);
        option.value = key;
        select.append(option);
      }
      tag.append(node('span', '用途'), select);
      const row = node('div', '', 'assetLibraryViewFields');
      row.append(viewName.wrap, tag);
      inputs.append(row);
      selected.push({ file: item, name: viewName.input, purpose: select });
    }
  };
  const save = action('保存并设为当前造型', async () => {
    const views: AssetViewInput[] = copyExisting.checked
      ? basis.views.map(({ mediaId, name, purpose, source }) => ({ mediaId, name, purpose, source })) : [];
    views.push(...selected.map(item => ({ name: item.name.value, purpose: item.purpose.value as AssetViewPurpose, image: item.file })));
    status.textContent = '正在校验并保存原图…';
    try {
      const result = await createSharedAssetAppearance(asset.id, { name: name.input.value, views }, asset.version, asset.appearanceVersion ?? 1, {
        assertCurrent: () => { if (!dialog.open) throw Error('造型窗口已关闭'); },
      });
      dialog.close();
      await onSave(result.appearance.id);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  body.append(name.wrap, fileLabel, copyLabel, inputs, node('p', '每张原图最大 32 MiB，支持 PNG、JPEG、WebP。', 'localMuted'), status, save);
  return dialog;
}

export function openAssetAppearances(assetId: string) {
  const { dialog, body } = modal('造型与视图');
  dialog.classList.add('assetLibraryDetail');
  const content = node('div', '', 'assetLibraryDetailContent');
  const status = node('p', '正在读取造型…', 'localStatus');
  status.setAttribute('role', 'status');
  body.append(content, status);
  let thumbnail: ReturnType<typeof mountLazyThumbnail> | undefined;
  let editor: HTMLDialogElement | undefined;
  const cleanup = () => {
    thumbnail?.dispose();
    if (editor?.open) editor.close();
    window.removeEventListener('dsh:nav', close);
  };
  const close = () => { if (dialog.open) dialog.close(); };
  window.addEventListener('dsh:nav', close);
  dialog.addEventListener('close', cleanup, { once: true });
  async function render(preferred?: string) {
    const { asset, appearances } = await listSharedAssetAppearances(assetId);
    if (!dialog.open) return;
    const active = asset.activeAppearanceId ?? 'legacy';
    const current = appearances.find(item => item.id === preferred) ?? appearances.find(item => item.id === active);
    if (!current) throw Error('当前造型不存在');
    const appearanceLabel = node('label', '', 'localField'), appearanceSelect = node('select');
    const viewLabel = node('label', '', 'localField'), viewSelect = node('select');
    const preview = node('button', '', 'assetLibraryPreview');
    preview.type = 'button';
    const info = node('p', '', 'localMuted');
    const controls = node('div', '', 'localRow');
    const refresh = action('重新读取', async () => { await render(appearanceSelect.value); });
    appearanceLabel.append(node('span', '造型版本'), appearanceSelect);
    viewLabel.append(node('span', '视图'), viewSelect);
    for (const item of appearances) {
      const option = node('option', `版本 ${item.revision} · ${item.name}${item.id === active ? '（当前）' : ''}`);
      option.value = item.id;
      appearanceSelect.append(option);
    }
    appearanceSelect.value = current.id;
    const choices = node('div', '', 'assetLibraryViewFields');
    choices.append(appearanceLabel, viewLabel);
    thumbnail?.dispose();
    content.replaceChildren(node('h3', asset.name), choices, preview, info, controls);

    function renderView() {
      const appearance = appearances.find(item => item.id === appearanceSelect.value)!;
      const view = appearance.views.find(item => item.id === viewSelect.value) ?? appearance.views[0];
      thumbnail?.dispose();
      preview.textContent = '查看原图';
      preview.setAttribute('aria-label', `查看${view.name}原图`);
      preview.onclick = () => showOriginal(view.mediaId, view.name);
      thumbnail = mountLazyThumbnail(preview, view.name, () => ({
        key: view.mediaId, load: () => getSharedAssetThumbnail(view.mediaId), prepared: true,
      }));
      info.textContent = view.source?.taskId ? `来源任务：${view.source.taskId}` : '';
      info.hidden = !info.textContent;
      const add = action('将此视图添加到项目', async () => {
        const result = await addSharedAssetViewToProject({ assetId, appearanceId: appearance.id, viewId: view.id });
        status.textContent = result.added ? '所选视图已作为独立副本添加到当前项目。' : '当前项目已有此视图的副本。';
      });
      add.disabled = !currentProjectId;
      const activate = action('设为当前造型', async () => {
        await setActiveSharedAssetAppearance(assetId, appearance.id, asset.version, asset.appearanceVersion ?? 1);
        await render(appearance.id);
        status.textContent = `当前造型已切换为「${appearance.name}」。`;
      });
      activate.disabled = appearance.id === active;
      controls.replaceChildren(activate,
        action('从图片新建造型', () => { editor = draftAppearance(asset, appearance, render); }), add, refresh);
    }

    function selectAppearance() {
      const appearance = appearances.find(item => item.id === appearanceSelect.value)!;
      viewSelect.replaceChildren(...appearance.views.map(view => {
        const option = node('option', `${view.name} · ${assetViewPurposes[view.purpose]}`);
        option.value = view.id;
        return option;
      }));
      renderView();
    }
    status.textContent = currentProjectId ? '' : '请从项目首页打开一个项目后再添加视图。';
    appearanceSelect.onchange = selectAppearance;
    viewSelect.onchange = renderView;
    selectAppearance();
  }
  void render().catch(error => { status.textContent = error instanceof Error ? error.message : String(error); });
  return close;
}
