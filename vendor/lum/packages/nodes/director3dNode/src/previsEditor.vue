<template>
  <teleport to="body">
  <section ref="editorRoot" tabindex="-1" class="previsEditor nodrag nopan nowheel" :class="{ virtualStageEditor: virtualStage, cameraView: virtualStage && stageView === 'camera', stagePanelsClosed: virtualStage && (rightFolded || stagePane === 'none' && !aiOpen && !terrainOpen), stageRightFolded: virtualStage && rightFolded, stageHeaderFolded: virtualStage && headerFolded, stageRailFolded: virtualStage && railFolded, stageViewFolded: virtualStage && viewFolded, stageMonitorFolded: virtualStage && monitorFolded, stageTimelineHidden: virtualStage && timelineHidden, stageChatFolded: virtualStage && chatFolded, timelineCollapsed: virtualStage && timelineCollapsed }" role="dialog" :aria-label="virtualStage ? '虚拟片场工作台' : '实时三维预演工作台'" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop @keydown.stop="onKey" @keyup.stop="onKeyUp">
    <button v-if="virtualStage && headerFolded" class="stageEdgeTab topEdge" aria-label="展开顶部功能栏" @click="headerFolded=false">⌄ 项目工具</button>
    <header v-show="!virtualStage || !headerFolded" class="topBar">
      <strong>{{ virtualStage ? '虚拟片场' : '三维预演' }}</strong><input v-if="virtualStage" class="stageName" v-model="draft.plan.name" maxlength="80" aria-label="片场名称" :disabled="busy" @change="persist" /><button :disabled="busy || terrainOpen" @click="openScenario">{{ virtualStage ? 'AI 排戏' : 'AI 文案编排' }}</button><span class="statusText" role="status"><span v-if="status">{{ status }}</span></span><previsSettings />
      <button title="Ctrl+Z" :disabled="!undoStack.length || busy" @click="undo">撤销 Ctrl+Z</button><button title="Ctrl+Shift+Z" :disabled="!redoStack.length || busy" @click="redo">重做</button>
      <button :disabled="busy" @click="persist">{{ saving ? '保存中…' : '保存' }}</button><button @click="close">关闭</button><button v-if="virtualStage" aria-label="隐藏顶部功能栏" @click="headerFolded=true">⌃ 收起</button>
    </header>
    <p v-if="error && !aiOpen && !terrainOpen" class="errorText" role="alert">{{ error }} <button type="button" aria-label="关闭错误提示" @click="error = ''">关闭</button></p>
    <div v-if="externalPreview" class="previewNotice">总 Agent 提供了修改草稿，尚未保存。<button @click="applyExternal">应用草稿</button><button @click="cancelExternal">取消</button></div>
    <div class="workArea">
      <button v-if="virtualStage && railFolded" class="stageEdgeTab leftEdge" aria-label="展开左侧功能栏" @click="railFolded=false">› 工具</button>
      <button v-if="virtualStage" class="stageEdgeTab rightEdge" :aria-label="rightFolded || stagePane==='none' && !aiOpen && !terrainOpen ? '展开右侧功能栏' : '隐藏右侧功能栏'" @click="toggleRightPanel">{{ rightFolded || stagePane==='none' && !aiOpen && !terrainOpen ? '‹ 展开' : '› 收起' }}<span v-if="aiBusy">处理中</span></button>
      <button v-if="virtualStage && monitorFolded" class="stageEdgeTab monitorEdge" aria-label="展开取景工具" @click="monitorFolded=false">⌃ 取景工具</button>
      <nav v-if="virtualStage" v-show="!railFolded" class="stageRail" aria-label="片场工具">
        <button class="railFoldButton" aria-label="隐藏左侧功能栏" @click="railFolded=true">‹ 收起</button>
        <button v-for="item in stageTools" :key="item.id" :title="item.label" :aria-label="item.label" :aria-pressed="stagePane===item.id && !aiOpen && !terrainOpen" :disabled="aiBusy || !!aiPreview" @click="toggleStagePane(item.id)"><component :is="item.icon" :size="22" /><span>{{ item.label }}</span></button>
        <span class="railDivider"></span><button title="图片生成场地" :disabled="busy" @click="openTerrain"><icon-photo :size="22" /><span>看图搭景</span></button><button title="AI 排戏" :disabled="busy || terrainOpen" @click="openScenario"><icon-sparkles :size="22" /><span>AI 排戏</span></button>
        <details class="stageRailSection" open>
          <summary>视角模式</summary>
          <div class="stageViewTabs" aria-label="视角模式">
            <button :class="{selected:stageView==='stage' && mode!=='observe'}" @click="stageView='stage';setMode('select')">布景 <span>Alt+1</span></button>
            <button :class="{selected:mode==='observe' && stageView==='stage'}" @click="stageView='stage';setMode('observe')">漫游 <span>Alt+2</span></button>
            <button :class="{selected:stageView==='camera'}" @click="enterCameraView">摄影机 <span>Alt+3</span></button>
          </div>
        </details>
        <details v-show="stageView!=='camera'" class="stageRailSection" open>
          <summary>编辑工具</summary>
          <div class="viewToolbar" aria-label="场景编辑工具">
            <button :class="{selected:mode==='select'}" @click="setMode('select')">选择 / 拖动</button><button :class="{selected:mode==='observe'}" @click="setMode('observe')">观察</button>
            <button v-for="tool in transformTools" :key="tool.id" :class="{selected:mode==='select' && transformMode===tool.id}" :disabled="!objectId || busy || selectedObject?.locked" @click="setTransformMode(tool.id)">{{ tool.label }}</button><button :disabled="!objectId" @click="focusObject">聚焦 F</button>
            <button :disabled="!objectId && !cameraId" :class="{selected:mode==='path'}" @click="setMode('path')">画路线</button><button @click="topView">俯视</button><button @click="sideView">侧视</button>
            <button :aria-pressed="transformSpace==='local'" @click="transformSpace=transformSpace==='world'?'local':'world'">{{ transformSpace==='world'?'世界坐标':'局部坐标' }}</button><button :aria-pressed="transformSnap" title="移动 0.25 米、旋转 15 度、缩放 0.1 倍" @click="transformSnap=!transformSnap">吸附</button>
          </div>
        </details>
      </nav>
      <aside v-if="virtualStage && stagePane==='cameras' && !aiOpen && !terrainOpen" class="stageFloatingPanel multiCameraPanel" :class="{cameraStack:cameraPreviewLayout==='stack'}" aria-label="多机位预览"><div class="panelTitle"><strong>多机位预览</strong><button aria-label="收起多机位面板" @click="rightFolded=true">›</button></div><p class="cameraHint">{{ currentTime.toFixed(2) }} 秒 · 低帧率实时预览。拖入下方镜头轨道，在落点切换机位。</p><div class="buttonRow"><button :disabled="busy" @click="addCamera(false)">＋ 新机位</button><button :disabled="busy" @click="addCamera(true)">复制机位</button><button @click="refreshThumbnails()">刷新</button></div><label class="cameraLayoutChoice">预览排列<select v-model="cameraPreviewLayout" aria-label="机位预览排列"><option value="stack">竖排大画面</option><option value="grid">四宫格</option></select></label><div class="cameraPreviewGrid"><article v-for="camera in visibleCameraPreviews" :key="camera.id" class="cameraPreviewCard" :class="{selected:cameraId===camera.id}" @dragstart.prevent><button class="cameraPreviewImage" @pointerdown="beginCameraPointer($event,camera.id)" @pointermove="moveCameraPointer" @pointerup="finishCameraPointer" @pointercancel="cancelCameraPointer" @lostpointercapture="cancelCameraPointer" :aria-label="'预览机位 '+camera.name" @click="if($event.detail===0){selectCamera(camera.id);enterCameraView()}"><img v-if="thumbnails[camera.id]" :src="thumbnails[camera.id]" :alt="camera.name+'取景预览'" draggable="false" /><span v-else>正在准备取景…</span><strong>{{ camera.name }}</strong></button><div class="cameraPreviewActions"><button :disabled="busy" :aria-label="camera.name+'加入播放头'" @click="insertCameraAtPlayhead(camera.id)">＋ 入时间线</button><button @click="selectCamera(camera.id);stagePane='properties'">参数</button><button :disabled="busy || !!camera.locked || draft.state.cameras.length < 2" :aria-label="'删除机位 '+camera.name" :title="camera.locked ? '请先解锁机位' : draft.state.cameras.length < 2 ? '至少保留一个机位' : '删除机位，可 Ctrl+Z 撤销；关联镜头改用其他机位'" @click="deleteCamera(camera.id)">删除</button></div></article></div><div class="cameraPages"><button :disabled="cameraPage===0" @click="cameraPage--">上一组</button><span>{{ cameraPage+1 }} / {{ Math.max(1,Math.ceil(draft.state.cameras.length/4)) }}</span><button :disabled="(cameraPage+1)*4>=draft.state.cameras.length" @click="cameraPage++">下一组</button></div><p class="cameraHint">镜头条可拖动排序、拖边缘调整切点。播放和 Blender 输出共用这条切镜时间线。</p></aside>
      <aside v-if="virtualStage && stagePane==='library' && !aiOpen && !terrainOpen" class="stageFloatingPanel"><div class="panelTitle"><span>资产与组块</span><button aria-label="收起模型库" @click="rightFolded=true">›</button></div><stageLibraryPanel :disabled="busy" @add="addLibraryModel" /></aside>
      <aside v-if="virtualStage && stagePane==='environment' && !aiOpen && !terrainOpen" class="stageFloatingPanel environmentPanel">
        <div class="panelTitle"><strong>环境</strong><button aria-label="收起环境面板" @click="rightFolded=true">›</button></div>
        <label>场景材质<select aria-label="场景材质" :value="draft.scene.studio?.materialMode ?? (draft.scene.studio?.clayEnvironment!==false ? 'clay' : 'color')" :disabled="busy" @change="setStageEnvironment('material',($event.target as HTMLSelectElement).value)"><option value="clay">白色粘土</option><option value="color">模型原色</option><option value="pbr">PBR 材质</option></select></label>
        <template v-if="draft.scene.studio?.materialMode==='pbr'">
          <label>粗糙度<input aria-label="PBR粗糙度" type="number" min="0" max="1" step=".05" :value="draft.scene.studio?.pbrRoughness ?? .45" :disabled="busy" @change="setStagePbr('pbrRoughness',Number(($event.target as HTMLInputElement).value))" /></label>
          <label>金属度<input aria-label="PBR金属度" type="number" min="0" max="1" step=".05" :value="draft.scene.studio?.pbrMetalness ?? 0" :disabled="busy" @change="setStagePbr('pbrMetalness',Number(($event.target as HTMLInputElement).value))" /></label>
          <p>保留模型主色，使用物理光照与环境反射。粗糙度越低越光滑；石材、木材金属度为 0，金属为 1。此模式不自动生成写实贴图。</p>
        </template>
        <p v-else>白色粘土作用于场景布景，人物与动作道具保留主色。</p>
        <label>背景<input aria-label="场景背景颜色" type="color" :value="draft.scene.sceneConfig.scene.background" :disabled="busy" @change="setStageEnvironment('background',($event.target as HTMLInputElement).value)" /></label>
        <label>辅助网格<input type="checkbox" v-model="viewGrid" /></label><button @click="stagePane='lighting'">光线调节</button><button @click="topView">俯视场地</button><button @click="sideView">侧面观察</button>
      </aside>
      <aside v-if="virtualStage && stagePane==='baking' && !aiOpen && !terrainOpen" class="stageFloatingPanel environmentPanel bakingPanel">
        <div class="panelTitle"><strong>场景 / 道具烘焙</strong><button aria-label="收起烘焙面板" @click="rightFolded=true">›</button></div>
        <previsBakePanel :bake="draft.scene.studio?.bake" :busy="busy" :baking="baking" :stale="bakeStale" :count="bakeCount" :progress="bakeProgress" :references="terrainReferences" :uploadReference="uploadTerrainReference" :readReference="readTerrainReference" @start="startBake" @cancel="bakeController?.abort()" @enabled="setBakeOption('enabled',$event)" @strength="setBakeOption('strength',$event)" @matchReference="matchBakeReference"><template #modelPicker><previsAgentModel :models="agentModels" :model="agentModel" :busy="aiBusy" :loading="agentPreparing" @change="refreshAgentModel" @refresh="refreshAgentModel()" /></template></previsBakePanel>
      </aside>
      <aside v-if="virtualStage && stagePane==='lighting' && !aiOpen && !terrainOpen" class="stageFloatingPanel environmentPanel lightingPanel">
        <div class="panelTitle"><strong>光线调节</strong><button aria-label="收起光线面板" @click="rightFolded=true">›</button></div>
        <div class="buttonRow"><button :disabled="busy" @click="setStageEnvironment('lighting','daylight')">日光</button><button :disabled="busy" @click="setStageEnvironment('lighting','soft')">柔光</button><button :disabled="busy" @click="setStageEnvironment('lighting','evening')">傍晚</button></div>
        <label>主光强度<input aria-label="主光强度" type="number" min="0" max="8" step=".1" :value="stageLighting.intensity" :disabled="busy" @change="setStageLight('intensity',Number(($event.target as HTMLInputElement).value))" /></label>
        <label>水平方向（°）<input aria-label="主光水平方向" type="number" min="0" max="360" step="5" :value="Math.round(stageLighting.azimuth)" :disabled="busy" @change="setStageLight('azimuth',Number(($event.target as HTMLInputElement).value))" /></label>
        <label>光照高度（°）<input aria-label="主光高度" type="number" min="0" max="90" step="5" :value="Math.round(stageLighting.elevation)" :disabled="busy" @change="setStageLight('elevation',Number(($event.target as HTMLInputElement).value))" /></label>
        <label>主光颜色<input aria-label="主光颜色" type="color" :value="stageLighting.color" :disabled="busy" @change="setStageLight('color',($event.target as HTMLInputElement).value)" /></label>
        <label>环境补光<input aria-label="环境补光强度" type="number" min="0" max="3" step=".1" :value="stageLighting.globalIntensity" :disabled="busy" @change="setStageLight('globalIntensity',Number(($event.target as HTMLInputElement).value))" /></label>
        <p>强度为 0 时关闭对应光源。方向和高度控制阴影朝向；补光提升暗部，在 PBR 模式中同时影响环境反射。</p><p>修改自动保存，可撤销。Blender 导出使用相同灯光参数。</p>
      </aside>
      <aside v-show="!virtualStage || (stagePane==='scene' && !aiOpen && !terrainOpen)" class="assetPanel" :class="{ skillsExpanded }"><div v-if="virtualStage" class="panelTitle"><strong>场景与人物</strong><button aria-label="收起场景面板" @click="rightFolded=true">›</button></div>
        <div v-if="virtualStage" class="stageLayouts"><h3>布景</h3><select v-model="stageLayout" aria-label="片场布景"><option value="courtyard">宫墙梧桐道</option><option value="study">古代书房</option></select><button :disabled="busy" @click="addStageLayout">添加白模布景</button></div>
        <details v-if="virtualStage" class="assetGroup"><summary>导入 / 导出模型</summary><input ref="modelInput" type="file" accept=".glb" aria-label="导入静态 GLB 模型" :disabled="busy" @change="importModel" /><p class="assetHint">GLB ≤12 MB，单模型 ≤2 万三角面。保留形状与材质主色，自动落地；纹理、顶点颜色、骨骼动画不导入。</p><button :disabled="busy || !draft.scene.objectList.length" @click="downloadModels">导出当前布景 GLB</button></details>
        <previsPresetPanel :disabled="busy" @add="addAssetPreset" />
        <previsSkillPanel :sources="scriptSources" :context="skillContext" :duration="draft.plan.duration" :disabled="busy || terrainOpen" :initialDraft="promptDraft" @save="savePromptDraft" @use="useSkillPrompt" @expanded="skillsExpanded = $event" />
        <h3>场景物体</h3>
        <button :disabled="busy" @click="openTerrain">图片生成场地</button>
        <p class="assetHint">从项目资料中选择分镜、人物、场景与道具，再用 AI 排戏生成可修改的草稿。</p>
        <details v-for="group in assetGroups" :key="group.name" class="assetGroup" :open="groupOpen[group.name]" @toggle="groupOpen[group.name]=($event.target as HTMLDetailsElement).open"><summary>{{ group.name }}（{{ group.objects.length }}）</summary><button v-for="object in group.objects" :key="object.threeJsonId" :class="{ selected: objectId === object.threeJsonId }" @click="selectObject(object.threeJsonId)">{{ objectKind(object) }} · {{ object.name || object.threeJsonId }}</button></details>
        <details class="assetGroup" :open="groupOpen['机位']" @toggle="groupOpen['机位']=($event.target as HTMLDetailsElement).open"><summary>机位（{{ draft.state.cameras.length }}）</summary><button @click="refreshThumbnails()">刷新机位缩略图</button>
        <button v-for="camera in draft.state.cameras" :key="camera.id" :class="{ selected: cameraId === camera.id && !objectId }" @click="selectCamera(camera.id)"><img v-if="thumbnails[camera.id]" :src="thumbnails[camera.id]" alt="机位取景" style="width:100%;display:block" />{{ camera.name }}</button>
        <div class="buttonRow"><button @click="addCamera(false)">新增机位</button><button @click="addCamera(true)">复制</button></div>
        <button :disabled="busy || !!selectedCamera?.locked || draft.state.cameras.length < 2" @click="deleteCamera()">删除所选机位</button>
        <button @click="captureView">观察角度保存到机位</button>
        </details>
      </aside>
      <main class="viewArea">
        <div v-if="!virtualStage" class="viewToolbar">
          <button :class="{ selected: mode === 'select' }" @click="setMode('select')">选择 / 拖动</button>
          <button :class="{ selected: mode === 'observe' }" @click="setMode('observe')">观察</button>
          <button :disabled="!objectId && !cameraId" :class="{ selected: mode === 'path' }" @click="setMode('path')">画路线</button>
          <button @click="topView">俯视</button><button @click="sideView">侧视</button>
        </div>
        <p v-if="pendingPath" class="routeNotice">正在为 {{ selectedObject?.name }} 绘制 {{ pendingPath.start.toFixed(1) }}–{{ (pendingPath.start+pendingPath.duration).toFixed(1) }} 秒路线。拖绘或点起点、终点。<button @click="cancelPathCreation">取消绘制</button></p><div class="canvasWrap">
          <canvas :key="canvasKey" ref="editCanvas" tabindex="0" aria-label="场景编辑视窗；选择机位后，右键转动机位，滚轮前后移动机位，方向键平移机位" @contextmenu.prevent @wheel.prevent="observerWheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerCancel" @lostpointercapture="lostPointer" @blur="movementKeys.clear();finishCameraNavigation()" />
          <span class="canvasLabel">场景编辑 · {{ mode === 'path' ? '拖绘 / 点击续点 · 滚轮缩放 · 方向键 / 小键盘8/2/4/6移画面 · Esc结束' : mode === 'observe' ? '观察视角：WASD 移动 · Q/E 升降 · Shift 加速 · 右键转向 · 可保存到机位' : virtualStage ? '右键 / 中键环绕 · Alt+左键平移 · 滚轮缩放 · W/E/R变换 · F聚焦 · H漫游' : '选中机位：右键转镜头 · 滚轮移机位前后 · 方向键移机位上下左右 · Ctrl+Z撤回' }}</span>
        </div>
        <div ref="monitorDock" class="monitorDock" :class="{stageMonitorDock:virtualStage && stageView!=='camera'}" :style="virtualStage && stageView!=='camera' && monitorPosition ? {left:monitorPosition.x+'px',top:monitorPosition.y+'px',bottom:'auto'} : undefined">
          <div v-if="virtualStage && stageView!=='camera'" class="monitorDragBar"><button class="monitorDragHandle" aria-label="拖动监看窗口" title="拖动移动，方向键微调，双击复位" @pointerdown="beginMonitorDrag" @pointermove="moveMonitorDrag" @pointerup="endMonitorDrag" @pointercancel="cancelMonitorDrag" @lostpointercapture="cancelMonitorDrag" @keydown.stop="moveMonitorWithKeys" @dblclick="monitorPosition=undefined">⠿ 取景监看</button><button aria-label="隐藏监看窗口" @click="monitorFolded=true">×</button></div>
          <div class="monitorWrap" :style="{ aspectRatio: `${renderWidth} / ${renderHeight}` }"><canvas ref="monitorCanvas" tabindex="0" aria-label="镜头实际取景监看" @contextmenu.prevent @wheel.prevent="stageView==='camera' && observerWheel($event)" @pointerdown="stageView==='camera' && pointerDown($event)" @pointermove="stageView==='camera' && pointerMove($event)" @pointerup="stageView==='camera' && pointerUp($event)" @pointercancel="pointerCancel" @lostpointercapture="lostPointer" /><div v-if="virtualStage && monitorGrid" ref="monitorGridElement" class="monitorGrid" aria-hidden="true"></div><span class="canvasLabel">{{ monitorName }} · {{ renderWidth }}×{{ renderHeight }} · {{ currentTime.toFixed(2) }} 秒</span></div>
          <div v-if="virtualStage" v-show="!monitorFolded" class="monitorTools" aria-label="取景与导出"><label>画幅<select aria-label="监看画幅" @change="setAspect(($event.target as HTMLSelectElement).value)"><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option><option value="4:3">4:3</option><option value="2.39:1">2.39:1 宽银幕</option></select></label><button :aria-pressed="monitorGrid" @click="monitorGrid=!monitorGrid">构图网格</button><button :disabled="busy" aria-label="下载当前帧 PNG" @click="captureFrame(false)">下载 PNG</button><button :disabled="busy" aria-label="当前帧加入画布" @click="captureFrame(true)">加入画布</button><button aria-label="隐藏取景工具" @click="monitorFolded=true">⌄ 收起监看</button></div>
        </div>
      </main>
      <aside v-show="!virtualStage || (['properties','output'].includes(stagePane) && !aiOpen && !terrainOpen)" class="propertyPanel"><div v-if="virtualStage" class="panelTitle"><strong>{{ stagePane==='output' ? '拍摄与导出' : '对象与机位' }}</strong><button aria-label="收起属性面板" @click="rightFolded=true">›</button></div><div v-show="!virtualStage || stagePane==='properties'">
        <h3>{{ selectedObject?.name || selectedCamera?.name || '编辑属性' }}</h3>
        <p v-if="selectedTerrain">图片场地 · {{ selectedTerrain.reference.label }}</p>
        <template v-if="selectedObject">
          <label>名称<input :value="selectedObject.name" @change="renameObject(($event.target as HTMLInputElement).value)" /></label>
          <label v-for="axis in axes" :key="axis">位置 {{ axis }}<input type="number" step="0.1" :disabled="!!selectedObject.attachment" :value="selectedObject.position[axis]" @change="setObjectPosition(axis, Number(($event.target as HTMLInputElement).value))" /></label>
          <label>朝向（度）<input type="number" step="5" :disabled="!!selectedObject.attachment" :value="Math.round((selectedObject.rotation?.rotationY ?? 0) * 180 / Math.PI)" @change="rotateObject(Number(($event.target as HTMLInputElement).value))" /></label>
          <label>主色<input type="color" :value="selectedObject.material.color" @change="setObjectColor(($event.target as HTMLInputElement).value)" /></label>
          <template v-if="virtualStage && selectedObject.objType !== 'mannequin'">
            <label>人物持物<select :value="selectedObject.attachment?.objectId || ''" @change="attachProp(($event.target as HTMLSelectElement).value)"><option value="">独立摆放</option><option v-for="actor in draft.scene.objectList.filter(item => item.objType === 'mannequin')" :key="actor.threeJsonId" :value="actor.threeJsonId">{{ actor.name }}</option></select></label>
            <template v-if="selectedObject.attachment"><label>手部<select :value="selectedObject.attachment.joint" @change="setPropHand(($event.target as HTMLSelectElement).value)"><option value="rightWrist">右手</option><option value="leftWrist">左手</option></select></label><label v-for="axis in axes" :key="axis">手部偏移 {{ axis }}<input type="number" step=".02" :value="selectedObject.attachment.offset[axis]" @change="setPropOffset(axis,Number(($event.target as HTMLInputElement).value))" /></label><p>道具随手部动作运动。持物人物使用整场编辑；暂不模拟抓握或布料碰撞。</p></template>
          </template>
          <label v-if="virtualStage">用途<select :value="selectedObject.stageRole || (selectedObject.objType === 'mannequin' ? 'character' : 'prop')" @change="setObjectRole(($event.target as HTMLSelectElement).value)"><option value="environment">场景（白模）</option><option value="character">人物（彩色）</option><option value="prop">道具（彩色）</option></select></label>
          <div class="buttonRow"><button :disabled="busy" @click="toggleObjectLock">{{ selectedObject.locked ? '解锁' : '锁定' }}</button><button :disabled="busy" @click="duplicateObject">复制</button><button :disabled="busy || selectedObject.locked" @click="deleteObject">删除</button></div>
          <label>整体大小<input type="number" min=".1" max="20" step=".1" :value="selectedObject.scale?.scaleY ?? 1" @change="scaleObject(Number(($event.target as HTMLInputElement).value))" /></label><button :disabled="terrainOpen || busy" @click="selectedObject.objType==='mannequin' && virtualStage ? openCharacterChat() : (scenarioMode=false, aiOpen=true)">{{ selectedObject.objType==='mannequin' && virtualStage ? 'AI 路线与动作' : '用 AI 修改所选对象' }}</button>
          <template v-if="selectedObject.objType === 'mannequin'">
            <label>造型<select :value="selectedObject.appearance?.style || 'none'" @change="setCostume(($event.target as HTMLSelectElement).value)"><option value="none">素色人偶</option><option value="robe">古装长袍</option><option value="modern">现代便装</option></select></label><h3>动作库</h3>
            <select v-model="actionKind" aria-label="动作库"><optgroup label="基础动作"><option v-for="kind in actionKinds.filter(kind=>!isMocapKind(kind))" :key="kind" :value="kind">{{ actionLabels[kind] }}</option></optgroup><optgroup label="CMU真实动作捕捉"><option v-for="motion in mocapMotions" :key="motion.id" :value="motion.id">{{ motion.name }} · {{ motion.duration.toFixed(1) }}s</option></optgroup></select>
            <p v-if="isMocapKind(actionKind)">CMU / cgspeed 动作捕捉，已转换到白模人偶。肢体动作原地播放，水平位移请画人物路线；时长可调整。</p>
            <label>持续秒数<input v-model.number="actionDuration" type="number" min="0.2" :max="draft.plan.duration" step="0.2" /></label>
            <button @click="addAction">从播放头添加动作</button>
          </template>
        </template>
        <template v-else-if="selectedCamera"><details class="propertyGroup" open><summary>机位</summary>
          <button @click="toggleCameraLock">{{ selectedCamera.locked ? "解锁机位" : "锁定机位" }}</button><label>景别<select @change="cameraPreset(Number(($event.target as HTMLSelectElement).value), 0)"><option value="12">远景</option><option value="7">全景</option><option value="4">中景</option><option value="2">近景</option></select></label><label>俯仰<select @change="cameraPreset(5, Number(($event.target as HTMLSelectElement).value))"><option value="0">平视</option><option value="3">俯拍</option><option value="-1">仰拍</option></select></label><label>机位名称<input :value="selectedCamera.name" @change="editCamera(camera => camera.name = ($event.target as HTMLInputElement).value)" /></label>
          <label v-for="axis in axes" :key="axis">位置 {{ axis }}<input type="number" step="0.1" :value="selectedCameraView?.camera.position[axis]" @change="editCamera(camera => camera.view.camera.position[axis] = Number(($event.target as HTMLInputElement).value), true)" /></label>
          <label>视角（度）<input type="number" min="10" max="120" :value="selectedCamera.view.camera.fov" @change="editCamera(camera => camera.view.camera.fov = Number(($event.target as HTMLInputElement).value))" /></label>
          <label>拍谁<select :value="selectedCamera.targetId || ''" @change="editCamera(camera => camera.targetId = ($event.target as HTMLSelectElement).value || undefined)"><option value="">固定目标点</option><option v-for="object in draft.scene.objectList" :key="object.threeJsonId" :value="object.threeJsonId">{{ object.name || object.threeJsonId }}</option></select></label>
          <template v-if="!selectedCamera.targetId"><label v-for="axis in axes" :key="axis">目标 {{ axis }}<input type="number" step="0.1" :value="selectedCamera.view.controls.target[axis]" @change="editCamera(camera => camera.view.controls.target[axis] = Number(($event.target as HTMLInputElement).value))" /></label></template>
          <button :disabled="terrainOpen || busy" @click="scenarioMode = false; aiOpen = true">用 AI 修改机位</button>
          </details><previsCameraPanel :camera="selectedCamera" :duration="draft.plan.duration" :time="currentTime" :disabled="busy || !!selectedCamera.locked" @follow="setCameraFollow" @preset="applyCameraPreset" />
          <previsCameraKeys v-if="virtualStage" :camera="selectedCamera" :time="currentTime" :duration="draft.plan.duration" :disabled="busy || !!selectedCamera.locked" :hasPath="draft.state.paths.some(path=>path.cameraId===selectedCamera?.id)" @record="recordCameraView" @convert="convertCameraKeys" @clear="clearCameraKeys" @remove="removeCameraKey" @update="updateCameraKey" @seek="seek" />
        </template>
        <template v-if="selectedPath">
          <h3>所选路线</h3><button @click="togglePathLock">{{ selectedPath.locked ? "解锁路线" : "锁定路线" }}</button><label>平滑<input type="range" min="0" max="1" step="0.1" :value="selectedPath.smoothing || 0" @change="setPathOption('smoothing', Number(($event.target as HTMLInputElement).value))" /></label><label>高度<input type="number" step="0.1" :value="selectedPath.points[0]?.y" @change="setPathHeight(Number(($event.target as HTMLInputElement).value))" /></label><label>朝向<select :value="selectedPath.orientation || 'along'" @change="setPathOption('orientation', ($event.target as HTMLSelectElement).value)"><option value="along">沿路线（拍谁优先）</option><option value="fixed">固定朝向</option></select></label><p>控制点可拖动或点击续点；按距离匀速运动，平滑后请复查布景相交。</p>
          <label>开始<input type="number" step="0.1" :value="selectedPath.start" @change="editPathTiming('start', Number(($event.target as HTMLInputElement).value))" /></label>
          <label>持续<input type="number" step="0.1" min="0.2" :value="selectedPath.duration" @change="editPathTiming('duration', Number(($event.target as HTMLInputElement).value))" /></label>
          <button @click="removePath">删除路线</button>
        </template>
        </div><div v-show="!virtualStage || stagePane==='output'"><p v-for="warning in spatialWarnings" :key="warning" role="status">{{ warning }}</p><h3>Blender 输出</h3><p role="status">{{ renderStatus }}</p><button v-if="frameUrl" aria-label="放大Blender校验帧" @click="expandedFrame = true"><img :src="frameUrl" alt="Blender 校验帧（点击放大）" style="width:100%" /></button><button :disabled="busy" @click="render(true)">查看当前帧（Blender）</button><div class="buttonRow"><label>宽<input v-model.number="renderWidth" type="number" min="64" max="1920" step="2" /></label><label>高<input v-model.number="renderHeight" type="number" min="64" max="1920" step="2" /></label></div>
        <div v-if="videoUrl" class="stageOutput"><video :src="videoUrl" controls preload="metadata" aria-label="渲染完成的预演视频" /><a :href="videoUrl" download="虚拟片场预演.mp4">下载预演视频</a><button v-if="virtualStage" :disabled="busy" @click="sendVideoToCanvas">视频加入画布</button></div>
        <div v-if="virtualStage" class="buttonRow"><button @click="downloadScene">下载 Blender 场景</button><button @click="exportHandoff">导出 AI 视频制作说明</button></div>
        <label>帧率<input v-model.number="renderFps" type="number" min="1" max="60" /></label><button :disabled="busy" @click="render(false)">{{ rendering ? '后台渲染中…' : '提交后台渲染' }}</button><button @click="cancelRender">取消渲染</button></div>
      </aside>
    <div v-if="aiOpen" v-show="!virtualStage || chatDetails" class="aiPanel" role="dialog" :aria-label="scenarioMode ? 'AI文案编排' : '修改所选对象'" @keydown.stop>
      <div class="buttonRow"><strong>{{ scenarioMode ? 'AI 文案编排' : '修改 ' + (selectedObject?.name || selectedCamera?.name || '所选对象') }}</strong><button v-if="virtualStage" @click="chatDetails=false;rightFolded=true">收起</button><button @click="cancelAi">关闭任务</button></div>
      <previsAgentModel :models="agentModels" :model="agentModel" :busy="aiBusy" :loading="agentPreparing" @change="refreshAgentModel" @refresh="refreshAgentModel()" />
      <p v-if="scenarioMode" class="targetHint">粘贴剧情或动作描述，AI 使用现有人物和场地编排动作、人物路线、机位运镜与切镜。先生成预览，应用后写入时间线，可 Ctrl+Z 撤销。</p><p v-else class="targetHint">{{ selectedObject ? selectedObject.objType === 'mannequin' ? '当前选中人物，可描述行走路线、停留位置和连续动作；生成后先预览再应用。' : selectedObject.objType === 'plane' ? '当前选中地面／布景。若要修改人物动作，请先从左侧选择人物。' : '当前选中道具，可修改整物体的位置、旋转和外观；人物动作请先选择人物。' : '当前选中机位，可修改取景、跟随和移动路线。' }}</p>
      <label v-if="!scenarioMode">作用范围<select v-model="aiScope" :disabled="aiBusy"><option value="shot">当前镜头覆盖</option><option value="scene">整个场次</option></select></label><p v-if="!scenarioMode">当前镜头 {{ currentShot.start.toFixed(1) }}—{{ shotEnd.toFixed(1) }} 秒。{{ aiScope === "shot" ? "保留原资产，只覆盖当前镜头。" : "共享修改可能影响以下全部镜头：" + sortedShots.map((shot, index) => `镜头${index + 1}（${shot.start.toFixed(1)}秒）`).join("、") }}</p>
      <label><input v-model="readOnly" type="checkbox" />只读说明（回复在总 Agent）</label>
      <textarea v-if="!virtualStage" v-model="instruction" :rows="scenarioMode ? 8 : 3" placeholder="例如：沿路线行走，然后回头看向门口" aria-label="修改要求" :disabled="aiBusy || !!aiPreview" />
      <p v-if="error" class="aiError" role="alert">{{ error }} <button aria-label="关闭错误提示" @click="error = ''">关闭</button></p>
      <p v-if="aiBusy" role="status">{{ aiProgress }}</p><div v-if="!aiPreview" class="buttonRow"><button v-if="!virtualStage" :disabled="aiBusy || !instruction.trim()" @click="generateAi">{{ aiBusy ? '生成中…' : readOnly ? '生成动作说明' : '生成修改预览' }}</button><button v-if="aiBusy" @click="cancelAi">取消生成</button></div>
      <template v-else><p>{{ aiSummary }}。当前视窗为预览，应用后保存。</p><div class="buttonRow"><button @click="applyAi">应用修改</button><button @click="discardAi">取消预览</button></div></template>
    </div>
    </div>
    <div v-if="cameraCardDrag?.moved" class="cameraDragGhost" :style="{left:cameraCardDrag.x+14+'px',top:cameraCardDrag.y+14+'px'}">{{ draft.state.cameras.find(camera=>camera.id===cameraCardDrag?.id)?.name }} · 拖到镜头轨道</div>
    <button v-if="virtualStage && chatFolded" class="stageEdgeTab chatEdge" aria-label="展开AI对话框" @click="chatFolded=false">⌃ AI 对话</button>
    <form v-if="virtualStage" v-show="!chatFolded" class="stageChatDock" aria-label="片场AI对话框" @submit.prevent="sendStageChat" @keydown.stop>
      <button type="button" class="chatOptions" :aria-expanded="chatDetails && aiOpen && !rightFolded" aria-label="展开AI任务选项" @click="openChatOptions"><icon-sparkles :size="18" />选项</button>
      <span v-if="characterChat" class="stageChatTarget" :title="selectedObject?.name">人物 · {{ selectedObject?.name }}</span><textarea ref="stageChatInput" v-model="instruction" rows="1" :aria-label="characterChat ? '人物路线动作描述' : '片场AI对话'" :placeholder="characterChat ? '描述人物路线和动作，例如：走到门前，停下后转身…' : '说说这一场怎么拍，例如：人物从门口走来，镜头缓慢推近…'" :disabled="aiBusy || !!aiPreview || terrainOpen" @keydown.enter.exact="sendStageChatKey" />
      <button v-if="aiPreview" type="button" @click="chatDetails=true;aiOpen=true;rightFolded=false">查看草稿</button><button v-else type="submit" :disabled="busy || terrainOpen || !instruction.trim()">{{ aiBusy ? '生成中' : '发送' }}</button>
      <button type="button" aria-label="隐藏AI对话框" @click="chatFolded=true">⌄</button>
    </form>
    <button v-if="virtualStage && timelineHidden" class="stageEdgeTab bottomEdge" aria-label="展开底部时间线" @click="timelineHidden=false">⌃ 时间线 · {{ currentTime.toFixed(1) }}秒</button>
    <footer v-show="!virtualStage || !timelineHidden" class="timelinePanel"><div v-if="virtualStage" class="timelineHeader"><strong>镜头时间线</strong><span>{{ draft.state.shots.length }} 个镜头 · {{ draft.scene.objectList.length }} 个物体</span><button :disabled="aiBusy || !!aiPreview || terrainOpen" @click="openVideoExport">导出预演视频</button><button :aria-expanded="!timelineCollapsed" @click="timelineCollapsed=!timelineCollapsed">{{ timelineCollapsed ? '完整时间线' : '精简' }}</button><button aria-label="隐藏底部时间线" @click="timelineHidden=true">⌄ 隐藏</button></div>
      <div class="playBar"><button @click="togglePlayback">{{ playing ? '暂停' : '播放' }}</button><button @click="seek(0)">回到开始</button><input type="range" aria-label="播放位置" min="0" :max="draft.plan.duration" step="0.01" :value="currentTime" @input="seek(Number(($event.target as HTMLInputElement).value))" /><span>{{ currentTime.toFixed(2) }} / {{ draft.plan.duration }} 秒</span><button @click="addShot">播放头切至所选机位</button></div>
      <previsDurationPanel :duration="draft.plan.duration" :sources="scriptSources" :disabled="busy || terrainOpen || timelineDragging" @apply="setTimelineDuration" />
      <previsTimeline ref="timelineEditor" v-show="!virtualStage || !timelineCollapsed" :cameraThumbnails="virtualStage ? thumbnails : undefined" :shots="draft.state.shots" :actions="visibleActions" :paths="visiblePaths" :cameras="draft.state.cameras" :objects="draft.scene.objectList" :duration="draft.plan.duration" :time="currentTime" :disabled="busy" :actionLabels="actionLabels" :selection="timelineSelection" :defaultObjectId="objectId" :defaultCameraId="cameraId" @seek="seek" @selectShot="selectTimelineShot" @selectAction="selectTimelineAction" @editShots="editTimelineShots" @editAction="editTimelineAction" @changeShot="changeShot" @split="splitTimelineClip" @remove="deleteTimelineClip" @dragging="timelineDragging=$event" @createPath="createTimelinePath" @selectPath="selectTimelinePath" @editPath="editTimelinePath" @createAction="createTimelineAction" @createShot="createTimelineShot" />
      <div v-if="!virtualStage" class="actionRow"><span>动作</span><div v-for="action in visibleActions" :key="action.id" class="actionChip"><button @click="selectObject(action.objectId); seek(action.start)">{{ actionLabels[action.kind] }}</button><input type="number" aria-label="动作开始秒数" step="0.1" :value="action.start" @change="changeAction(action.id, 'start', Number(($event.target as HTMLInputElement).value))" /><input type="number" aria-label="动作持续秒数" step="0.1" :value="action.duration" @change="changeAction(action.id, 'duration', Number(($event.target as HTMLInputElement).value))" /><input type="range" aria-label="拖长动作条" min="0.2" :max="draft.plan.duration - action.start" step="0.1" :value="action.duration" @change="changeAction(action.id, 'duration', Number(($event.target as HTMLInputElement).value))" /><button aria-label="删除动作" @click="removeAction(action.id)">×</button></div></div>
    </footer>
    <previsTerrainPanel v-if="terrainOpen" :references="terrainReferences" :readReference="readTerrainReference" :uploadReference="uploadTerrainReference" :busy="aiBusy" :progress="aiProgress" :error="error" :preview="terrainPreview" @dismissError="error=''" @generate="generateTerrain" @close="closeTerrain" @cancel="cancelTerrain" @apply="applyTerrain" @discard="discardTerrain" @frame="frameTerrain"><template #modelPicker><previsAgentModel :models="agentModels" :model="agentModel" :busy="aiBusy" :loading="agentPreparing" @change="refreshAgentModel" @refresh="refreshAgentModel()" /></template></previsTerrainPanel>
    <div v-if="exitPrompt" class="exitOverlay" role="alertdialog" aria-modal="true" aria-label="离开虚拟片场" @keydown.esc.stop="exitPrompt=false">
      <div class="exitCard"><strong>离开虚拟片场？</strong><p>{{ aiPreview || externalPreview ? '还有未应用的预览。可以应用后退出，或放弃本次预览，保留此前已保存的内容。' : '当前任务尚未完成。可以取消本次等待 / 生成，保存已有场景后退出。' }}</p><div class="buttonRow"><button @click="exitPrompt=false">继续编辑</button><button v-if="aiPreview || externalPreview" @click="finishAndClose(true)">应用并退出</button><button @click="finishAndClose(false)">{{ aiPreview || externalPreview ? '放弃预览并退出' : '取消任务并退出' }}</button></div></div>
    </div>
    <div v-if="expandedFrame && frameUrl" class="frameOverlay" @click="expandedFrame = false"><button @click="expandedFrame = false">关闭大图</button><img :src="frameUrl" alt="Blender校验帧大图" @click.stop /></div>
  </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { IconBox, IconLibrary, IconSun, IconAdjustments, IconMovie, IconPhoto, IconSparkles } from "@tabler/icons-vue";
import stageLibraryPanel from "./stageLibraryPanel.vue";
import { stageLibraryObject } from "./stageLibrary";
import type { StageLibraryModel } from "@lum/node-shared/stageLibrary";
import { importStageModel, exportStageModel } from "./stageModel";
import previsTerrainPanel from "./previsTerrainPanel.vue";
import previsPresetPanel from "./previsPresetPanel.vue";
import previsSkillPanel from "./previsSkillPanel.vue";
import type { PrevisPromptDraft, PrevisScriptSource } from "./previsSkills";
import { mannequinJoints } from "./mannequin";
import { assetCatalog, presetObject } from "./previsPresets";
import { createVirtualStageScene } from "./virtualStageScene";
import previsCameraPanel from "./previsCameraPanel.vue";
import previsCameraKeys from "./previsCameraKeys.vue";
import previsTimeline from "./previsTimeline.vue";
import previsDurationPanel from "./previsDurationPanel.vue";
import { resizePrevisDuration } from "./previsDuration";
import { isMocapKind, mocapLabels, mocapMotions } from "./previsMocap";
import { splitAction, splitShot, deleteShot, type TimelineSelection } from "./previsClips";
import { cameraFollowSchema, createCameraPreset, sampleCameraView, moveCameraView, turnCameraView, applyManualCameraView, recordCameraKeyframe, cameraKeyframeSchema, type CameraKeyframe, type CameraPreset } from "./previsCamera";
import { terrainKey, type TerrainReference, type TerrainRequest, type TerrainSet } from "./previsTerrain";
import { ArrowHelper, CameraHelper, Box3, BoxGeometry, BoxHelper, BufferGeometry, CylinderGeometry, Euler, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Plane, Quaternion, Raycaster, Spherical, SphereGeometry, Vector2, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { getObjectByThreeJsonId, type SceneRuntime } from "threejson/core";
import { applySceneSettings, captureCamera, createStage, disposeStage, getSceneLighting, type CameraView } from "./scene";
import { prepareSceneAnimation } from "./sceneAnimation";
import { applyCamera, prepareMotion, sampleMotion } from "./motion";
import { actionKinds, applyPrevisCameraPath, compilePrevisScene, compilePrevisPlan, normalizePrevisSnapshot, overrideInstanceId, samplePrevisPath, type PrevisAiRequest, type PrevisSnapshot, type PrevisState } from "./previs";
import { materializePrevisObject, scopePrevisDraft, validatePrevisLocks } from "./previsAgent";
import previsAgentModel from "./previsAgentModel.vue";
import previsBakePanel from "./previsBakePanel.vue";
import { canBakeObject, isStageBake, stageBakeSignature, stageBakeMotionSignature, type StageBake, type StageBakeOptions } from "@lum/node-shared/stageBake";
import previsSettings from "./previsSettings.vue";

const props = defineProps<{ virtualStage?: boolean; aiProgress?: string; snapshot: PrevisSnapshot; baseline?: PrevisSnapshot; renderStatus?: string; frameUrl?: string; videoUrl?: string; exportScene: () => Promise<void>; publishFrame?: (image:Blob)=>Promise<string>; publishVideo?: ()=>Promise<string>; assetKinds?: Record<string, string | undefined>; assetSources?: { sourceKey: string; label: string; kind?: string; entityKind?: string; text?: string; image?: { path: string; mimeType: string } }[]; scriptSources: PrevisScriptSource[]; promptDraft?: PrevisPromptDraft; savePromptDraft: (draft: PrevisPromptDraft) => void; terrainReferences: TerrainReference[]; readTerrainReference: (reference: TerrainReference) => Promise<Blob>; uploadTerrainReference: (file: File) => Promise<TerrainReference>; save: (snapshot: PrevisSnapshot) => Promise<void>; requestAi: (request: PrevisAiRequest) => Promise<PrevisSnapshot>; agentModels: {value:string;label:string}[]; agentModel: string; agentPreparing: boolean; prepareAgent: (model?: string) => Promise<void>; bakeScene: (snapshot: PrevisSnapshot, options: StageBakeOptions, signal: AbortSignal, progress: (value: string) => void) => Promise<StageBake>; renderBlender: (snapshot: PrevisSnapshot, options: { width: number; height: number; fps: number; frameTime?: number; cancel?: boolean }) => Promise<unknown> }>();
const emit = defineEmits<{ close: []; discard: [] }>();
// 场景由 JSON schema 限定；嵌套 Vue 代理也必须解除，toRaw 只处理最外层。
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const draft = ref(normalizePrevisSnapshot(clone(props.snapshot)));
const editorRoot = ref<HTMLElement>();
const editCanvas = ref<HTMLCanvasElement>();
const canvasKey = ref(0);
const monitorCanvas = ref<HTMLCanvasElement>();
const monitorDock = ref<HTMLElement>();
const monitorPosition = ref<{x:number;y:number}>();
let monitorDrag: {pointerId:number;element:HTMLElement;startX:number;startY:number;x:number;y:number;before?:{x:number;y:number}} | undefined;
function clampMonitorPosition(x:number,y:number){const root=editorRoot.value,dock=monitorDock.value;if(!root || !dock)return;monitorPosition.value={x:Math.max(12,Math.min(x,root.clientWidth-dock.offsetWidth-12)),y:Math.max(12,Math.min(y,root.clientHeight-dock.offsetHeight-12))};}
function beginMonitorDrag(event:PointerEvent){if(event.button!==0 || !monitorDock.value || !editorRoot.value)return;event.preventDefault();const element=event.currentTarget as HTMLElement,rect=monitorDock.value.getBoundingClientRect(),root=editorRoot.value.getBoundingClientRect();element.focus({preventScroll:true});monitorDrag={pointerId:event.pointerId,element,startX:event.clientX,startY:event.clientY,x:rect.left-root.left,y:rect.top-root.top,before:monitorPosition.value?{...monitorPosition.value}:undefined};element.setPointerCapture(event.pointerId);}
function moveMonitorDrag(event:PointerEvent){const drag=monitorDrag;if(!drag || drag.pointerId!==event.pointerId)return;event.preventDefault();clampMonitorPosition(drag.x+event.clientX-drag.startX,drag.y+event.clientY-drag.startY);}
function endMonitorDrag(){const drag=monitorDrag;monitorDrag=undefined;if(drag?.element.hasPointerCapture(drag.pointerId))drag.element.releasePointerCapture(drag.pointerId);}
function cancelMonitorDrag(){if(!monitorDrag)return;monitorPosition.value=monitorDrag.before;endMonitorDrag();}
function moveMonitorWithKeys(event:KeyboardEvent){if(event.key==="Escape"){event.preventDefault();cancelMonitorDrag();return;}const direction=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.key];if(!direction || !monitorDock.value || !editorRoot.value)return;event.preventDefault();const rect=monitorDock.value.getBoundingClientRect(),root=editorRoot.value.getBoundingClientRect(),step=event.shiftKey?30:10;clampMonitorPosition(rect.left-root.left+direction[0]!*step,rect.top-root.top+direction[1]!*step);}
onMounted(()=>window.addEventListener("blur",cancelMonitorDrag));onBeforeUnmount(()=>{endMonitorDrag();window.removeEventListener("blur",cancelMonitorDrag);});
const monitorGridElement=ref<HTMLDivElement>();
type StagePane = "none" | "scene" | "library" | "environment" | "lighting" | "baking" | "properties" | "output" | "cameras";
const stagePane = ref<StagePane>("scene"), stageView = ref<"stage" | "camera">("stage"), timelineCollapsed = ref(false);
const headerFolded=ref(false),railFolded=ref(false),rightFolded=ref(false),viewFolded=ref(false),monitorFolded=ref(false),timelineHidden=ref(false),cameraPage=ref(0),cameraPreviewLayout=ref<"stack"|"grid">("stack"),chatFolded=ref(false),chatDetails=ref(false);
const stageTools = [{id:"cameras",label:"多机位",icon:IconMovie},{id:"scene",label:"场景",icon:IconBox},{id:"library",label:"模型库",icon:IconLibrary},{id:"environment",label:"环境",icon:IconSun},{id:"lighting",label:"光线",icon:IconSun},{id:"baking",label:"烘焙",icon:IconSun},{id:"properties",label:"属性",icon:IconAdjustments},{id:"output",label:"拍摄",icon:IconMovie}] as const;
function enterCameraView(){stageView.value="camera";setMode("select");objectId.value=undefined;selectedPathId.value=undefined;updateHighlight();monitorSelection.value=true;void nextTick(()=>monitorCanvas.value?.focus({preventScroll:true}));}
function toggleStagePane(pane: StagePane) { if(aiBusy.value || aiPreview.value)return; cancelAi(); if(stagePane.value===pane && rightFolded.value){rightFolded.value=false;return;}stagePane.value=stagePane.value===pane?"none":pane;rightFolded.value=false; }
function toggleRightPanel(){if(rightFolded.value || stagePane.value==="none" && !aiOpen.value && !terrainOpen.value){rightFolded.value=false;if(aiOpen.value)chatDetails.value=true;if(stagePane.value==="none" && !aiOpen.value && !terrainOpen.value)stagePane.value="scene";}else rightFolded.value=true;}
function addLibraryModel(model: StageLibraryModel) {
  if(busy.value)return;
  const object=stageLibraryObject(model),anchor=controls?.target;
  if(anchor){object.position.x=Math.round(anchor.x*4)/4;object.position.z=Math.round(anchor.z*4)/4;}
  change(value=>value.scene.objectList.push(object));
  if(draft.value.scene.objectList.some(item=>item.threeJsonId===object.threeJsonId)){selectObject(object.threeJsonId);status.value="已加入 "+model.name+"；网格随片场保存";}
}
function setStageEnvironment(kind: "material" | "lighting" | "background", input: string) {
  change(value=>{
    value.scene.studio ??= {clayEnvironment:true,lighting:"daylight",renderer:"eevee"};
    if(kind==="material" && (input==="clay" || input==="color" || input==="pbr")) {
      value.scene.studio.clayEnvironment=input==="clay"; value.scene.studio.materialMode=input;
      if(input==="pbr")value.scene.studio.renderer="eevee";
    }
    else if(kind==="background") value.scene.sceneConfig.scene.background=input;
    else if(input==="daylight"||input==="soft"||input==="evening"){
      value.scene.studio.lighting=input;
      value.scene.sceneConfig.lights=[{type:"hemisphere",color:"#eef3ff",intensity:input==="soft"?1.2:.8},{type:"directional",color:input==="evening"?"#ffd4aa":"#fff4df",intensity:input==="soft"?.8:3,position:{x:-8,y:input==="evening"?3:12,z:6},target:{x:0,y:0,z:-8}}];
    }
  });
}
const stageLighting = computed(() => getSceneLighting(draft.value.scene));
function setStagePbr(field: "pbrRoughness" | "pbrMetalness", entry: number) {
  change(value => {
    if (!Number.isFinite(entry) || entry < 0 || entry > 1) throw new Error("PBR 参数范围为 0～1");
    value.scene.studio ??= { clayEnvironment: false, materialMode: "pbr", lighting: "daylight", renderer: "eevee" };
    value.scene.studio[field] = entry;
  });
}
function setStageLight(field: "azimuth" | "elevation" | "intensity" | "globalIntensity" | "color", entry: number | string) {
  change(value => {
    value.scene.studio ??= { clayEnvironment: true, lighting: "daylight", renderer: "eevee" };
    value.scene.studio.renderer = "eevee";
    const lights = value.scene.sceneConfig.lights;
    if (field === "globalIntensity") {
      const intensity = Number(entry);
      if (!Number.isFinite(intensity) || intensity < 0 || intensity > 3) throw new Error("环境补光范围为 0～3");
      const fill = lights.filter(light => light.type === "ambient" || light.type === "hemisphere");
      if (!fill.length) lights.push({ type: "hemisphere", color: "#eef3ff", intensity });
      else fill.forEach(light => { light.intensity = intensity; });
      return;
    }
    let light = lights.find(light => light.type === "directional");
    if (!light) { light = { type: "directional", color: "#fff4df", intensity: 3, position: { x: -8, y: 12, z: 6 }, target: { x: 0, y: 0, z: -8 } }; lights.push(light); }
    if (field === "color") { if (!/^#[\da-f]{6}$/i.test(String(entry))) throw new Error("光源颜色无效"); light.color = String(entry); return; }
    const number = Number(entry), max = field === "azimuth" ? 360 : field === "elevation" ? 90 : 8;
    if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`光线参数范围为 0～${max}`);
    if (field === "intensity") { light.intensity = number; return; }
    const settings = getSceneLighting(value.scene), azimuth = (field === "azimuth" ? number : settings.azimuth) * Math.PI / 180, elevation = (field === "elevation" ? number : settings.elevation) * Math.PI / 180;
    const target = light.target ?? { x: 0, y: 0, z: 0 };
    light.position = { x: target.x + Math.sin(azimuth) * Math.cos(elevation) * 20, y: target.y + Math.sin(elevation) * 20, z: target.z + Math.cos(azimuth) * Math.cos(elevation) * 20 };
  });
}
const stageLayout = ref<"courtyard" | "study">("courtyard");
const objectId = ref<string>();
const cameraId = ref(draft.value.state.cameras[0]!.id);
const selectedObject = computed(() => draft.value.state.shotOverrides?.find(entry => entry.shotId === currentShot.value.id && entry.object.threeJsonId === objectId.value)?.object ?? draft.value.scene.objectList.find(object => object.threeJsonId === objectId.value));
const selectedCamera = computed(() => draft.value.state.cameras.find(camera => camera.id === cameraId.value));
const cameraPreview = shallowRef<{ id: string; view: CameraView }>();
const selectedCameraView = computed(() => cameraPreview.value?.id === cameraId.value ? cameraPreview.value.view : selectedCamera.value ? sampleCameraView(draft.value,activePlan,cameraId.value,currentTime.value,samplePrevisPath) : undefined);
const selectedTerrain = computed(() => draft.value.state.terrainSets?.find(set => set.objectIds.includes(objectId.value ?? "")));
const activeOverrides = computed(() => draft.value.state.shotOverrides?.filter(entry => entry.shotId === currentShot.value.id) ?? []);
const visiblePaths = computed(() => [...draft.value.state.paths.filter(path => !activeOverrides.value.some(entry => entry.object.threeJsonId === path.objectId)), ...activeOverrides.value.flatMap(entry => entry.paths ?? [])]);
const visibleActions = computed(() => [...draft.value.state.actions.filter(action => !activeOverrides.value.some(entry => entry.object.threeJsonId === action.objectId)), ...activeOverrides.value.flatMap(entry => entry.actions ?? [])]);
const groupOpen=ref<Record<string,boolean>>({人物:true,场景:false,道具:true,机位:true});
const assetGroups=computed(()=>["人物","场景","道具"].map(name=>({name,objects:draft.value.scene.objectList.filter(object=>{const kind=objectKind(object);return (kind==="人物"?"人物":kind==="地点"||kind==="场地"||kind==="布景"?"场景":"道具")===name;})})));
const timelineSelection=ref<TimelineSelection>(),timelineDragging=ref(false);
const selectedPathId=ref<string>();
const pendingPath=ref<{objectId:string;start:number;duration:number;shotId:string}>();
const selectedPath = computed(() => visiblePaths.value.find(path=>path.id===selectedPathId.value) ?? visiblePaths.value.findLast(path => objectId.value ? path.objectId === objectId.value : path.cameraId === cameraId.value));
const sortedShots = computed(() => [...draft.value.state.shots].sort((a, b) => a.start - b.start));
const mode = ref<"select" | "observe" | "path">("select");
const axes = ["x", "y", "z"] as const;
const currentTime = ref(0);
const playing = ref(false);
const monitorSelection = ref(false);
const monitorName = ref("");
const thumbnails = ref<Record<string,string>>({});
const spatialWarnings = ref<string[]>([]);
const actionLabels:Record<string,string> = { stand: "站立", walk: "行走", turn: "转身", lookBack: "回头", gesture: "抬手示意", ...mocapLabels };
const actionKind = ref<typeof actionKinds[number]>("walk");
const actionDuration = ref(3);
watch(actionKind,kind=>{const motion=mocapMotions.find(motion=>motion.id===kind);if(motion)actionDuration.value=Math.min(Math.round(motion.duration*10)/10,draft.value.plan.duration-currentTime.value);});
const renderWidth = ref(1280), renderHeight = ref(720), renderFps = ref(24);
const undoStack = shallowRef<PrevisSnapshot[]>([]), redoStack = shallowRef<PrevisSnapshot[]>([]);
const error = ref(""), status = ref("就绪"), saving = ref(false), aiBusy = ref(false), rendering = ref(false);
const readOnly = ref(false), expandedFrame = ref(false);
const exportBusy=ref(false),monitorGrid=ref(false),viewGrid=ref(true);
const renderAspect=computed(()=>Number.isFinite(renderWidth.value)&&Number.isFinite(renderHeight.value)&&renderWidth.value>=64&&renderHeight.value>=64?renderWidth.value/renderHeight.value:16/9);
const aiScope = ref<"shot" | "scene">("shot");
const currentShot = computed(() => sortedShots.value.findLast(shot => shot.start <= currentTime.value) ?? sortedShots.value[0]!);
const shotEnd = computed(() => sortedShots.value.find(shot => shot.start > currentShot.value.start)?.start ?? draft.value.plan.duration);
const aiOpen = ref(false), instruction = ref("");
const scenarioMode=ref(false);
const stageChatInput=ref<HTMLTextAreaElement>();
const characterChat=computed(()=>props.virtualStage && selectedObject.value?.objType==="mannequin" && !scenarioMode.value);
function openCharacterChat(){if(busy.value || terrainOpen.value || selectedObject.value?.objType!=="mannequin")return;scenarioMode.value=false;aiScope.value="shot";readOnly.value=false;chatFolded.value=false;void nextTick(()=>stageChatInput.value?.focus());}
const skillsExpanded=ref(false);
const skillContext=computed(()=>JSON.stringify({
  duration:draft.value.plan.duration,
  objects:draft.value.scene.objectList.map(object=>({id:object.threeJsonId,name:object.name,kind:objectKind(object),type:object.objType,position:object.position})),
  cameras:draft.value.state.cameras,shots:draft.value.state.shots,
  paths:draft.value.state.paths.map(path=>({id:path.id,objectId:path.objectId,cameraId:path.cameraId,start:path.start,duration:path.duration,locked:path.locked})),
  actions:draft.value.state.actions,
  capabilities:{actionTemplates:actionKinds.map(kind=>({id:kind,label:actionLabels[kind]})),joints:mannequinJoints,customJointTracks:true,cameraFollow:["front","back","left","right"],units:"米、秒、XYZ欧拉角弧度，地面y=0，人偶面向+Z",limits:"简化人偶预演，无自动接触物理，支持attachment手部道具绑定，无自动抓握求解；复杂动作需关节关键帧近似"},
}));
function openScenario(){if(busy.value)return;chatFolded.value=false;chatDetails.value=true;rightFolded.value=false;scenarioMode.value=true;aiScope.value="scene";readOnly.value=false;instruction.value="";error.value="";playing.value=false;aiOpen.value=true;}
function openChatOptions(){if(!aiOpen.value){scenarioMode.value=!characterChat.value;aiScope.value=scenarioMode.value?"scene":"shot";aiOpen.value=true;}chatDetails.value=true;rightFolded.value=false;}
function sendStageChatKey(event:KeyboardEvent){if(event.isComposing)return;event.preventDefault();void sendStageChat();}
async function sendStageChat(){if(busy.value || terrainOpen.value || !instruction.value.trim())return;if(!aiOpen.value){scenarioMode.value=!characterChat.value;aiScope.value=scenarioMode.value?"scene":"shot";readOnly.value=false;aiOpen.value=true;}chatDetails.value=true;rightFolded.value=false;await generateAi();}
function openVideoExport(){if(aiBusy.value || aiPreview.value || terrainOpen.value)return;aiOpen.value=false;chatDetails.value=false;rightFolded.value=false;stagePane.value="output";playing.value=false;}
function useSkillPrompt(text:string){if(busy.value||terrainOpen.value)return;openScenario();instruction.value=text;status.value="已填入预演提示词，请生成修改预览后检查并应用";}
const terrainOpen = ref(false), terrainPreview = shallowRef<TerrainSet>();
async function refreshAgentModel(model?: string) { try { await props.prepareAgent(model); } catch (reason) { if (!destroyed) report(reason); } }
watch([aiOpen,terrainOpen,()=>stagePane.value],()=>{if(aiOpen.value || terrainOpen.value || stagePane.value==="baking")void refreshAgentModel();});
watch([stagePane,aiOpen,terrainOpen],()=>{rightFolded.value=false;if(aiOpen.value){chatDetails.value=true;chatFolded.value=false;}});
const visibleCameraPreviews=computed(()=>draft.value.state.cameras.slice(cameraPage.value*4,cameraPage.value*4+4));
watch(()=>draft.value.state.cameras.length,count=>{cameraPage.value=Math.min(cameraPage.value,Math.max(0,Math.ceil(count/4)-1));});
const timelineEditor=ref<InstanceType<typeof previsTimeline>>();
const cameraCardDrag=ref<{id:string;pointerId:number;startX:number;startY:number;x:number;y:number;moved:boolean}>();
let cameraDragElement:HTMLElement|undefined;
function beginCameraPointer(event:PointerEvent,id:string){if(busy.value || event.button!==0)return;event.preventDefault();event.stopPropagation();cameraDragElement=event.currentTarget as HTMLElement;cameraDragElement.focus({preventScroll:true});cameraDragElement.setPointerCapture(event.pointerId);cameraCardDrag.value={id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false};timelineHidden.value=false;timelineCollapsed.value=false;timelineDragging.value=true;}
function moveCameraPointer(event:PointerEvent){const drag=cameraCardDrag.value;if(!drag || event.pointerId!==drag.pointerId)return;event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;drag.moved ||= Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>5;if(drag.moved)timelineEditor.value?.previewCameraAt(drag.id,drag.x,drag.y);}
function finishCameraPointer(event:PointerEvent){const drag=cameraCardDrag.value;if(!drag || drag.pointerId!==event.pointerId)return;event.preventDefault();const id=drag.id,moved=drag.moved,x=event.clientX,y=event.clientY;cancelCameraPointer();if(moved){if(!timelineEditor.value?.dropCameraAt(id,x,y))status.value="请将机位画面拖到下方镜头轨道";}else{selectCamera(id);enterCameraView();}}
function cancelCameraPointer(){const drag=cameraCardDrag.value,element=cameraDragElement;cameraCardDrag.value=undefined;cameraDragElement=undefined;timelineDragging.value=false;timelineEditor.value?.clearCameraDrop();if(drag && element?.hasPointerCapture(drag.pointerId))element.releasePointerCapture(drag.pointerId);}
onMounted(()=>window.addEventListener("blur",cancelCameraPointer));onBeforeUnmount(()=>{cancelCameraPointer();window.removeEventListener("blur",cancelCameraPointer);});

function insertCameraAtPlayhead(id:string){createTimelineShot({cameraId:id,start:Math.max(0,Math.min(draft.value.plan.duration-.1,Math.round(currentTime.value*100)/100))});stagePane.value="cameras";}
const aiPreview = shallowRef<PrevisSnapshot>();
const externalPreview = shallowRef<PrevisSnapshot | undefined>(props.baseline ? clone(props.baseline) : undefined);
const aiSummary = ref("");
const baking = ref(false), bakeProgress = ref("");
let bakeController: AbortController | undefined;
const bakeCount = computed(() => draft.value.scene.objectList.filter(canBakeObject).length);
const bakeStale = computed(() => { const bake = draft.value.scene.studio?.bake; return !!bake && (bake.signature !== stageBakeSignature(draft.value.scene) || bake.motionSignature !== stageBakeMotionSignature(draft.value.scene,compilePrevisPlan(draft.value).tracks) || !!draft.value.state.shotOverrides?.some(entry => canBakeObject(entry.object))); });
const busy = computed(() => baking.value || aiBusy.value || rendering.value || exportBusy.value || !!aiPreview.value || !!externalPreview.value);
let runtime: SceneRuntime | undefined;
let renderer: WebGLRenderer | undefined;
const monitor = new PerspectiveCamera(55, 16 / 9, 0.1, 1000);
let controls: OrbitControls | undefined;
let transform: TransformControls | undefined;
let transformStart: { position: Vector3; rotation: Vector3; scale: Vector3 } | undefined;
const modelInput=ref<HTMLInputElement>();
const transformSpace=ref<"world"|"local">("world"),transformSnap=ref(false);
const movementKeys=new Set<string>();
const transformMode = ref<"translate" | "rotate" | "scale">("translate");
const transformTools = [{ id: "translate", label: "移动 W" }, { id: "rotate", label: "旋转 E" }, { id: "scale", label: "缩放 R" }] as const;
function setTransformMode(value: typeof transformMode.value) { setMode("select"); transformMode.value = value; transform?.setMode(value); updateTransform(); }
function updateTransform() {
  if (!transform) return;
  transform.setSpace(transformSpace.value);
  transform.setTranslationSnap(transformSnap.value ? .25 : null);transform.setRotationSnap(transformSnap.value?Math.PI/12:null);transform.setScaleSnap(transformSnap.value ? .1 : null);
  const object = objectId.value ? visibleObject(objectId.value) : undefined;
  if (object && !selectedObject.value?.attachment && !selectedObject.value?.locked && mode.value === "select" && !busy.value && !playing.value) transform.attach(object);
  else transform.detach();
  transform.enabled = !!transform.object;
}
function focusObject() {
  const object = objectId.value ? visibleObject(objectId.value) : undefined;
  if (!object || !runtime || !controls) return;
  const bounds = new Box3().setFromObject(object), center = bounds.getCenter(new Vector3());
  const distance = Math.max(2,bounds.getSize(new Vector3()).length() * 1.3);
  const direction = runtime.camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(center); runtime.camera.position.copy(center).addScaledVector(direction,distance); controls.update();
}
function createTransform() {
  if (!props.virtualStage || !runtime || !editCanvas.value) return;
  transform = new TransformControls(runtime.camera,editCanvas.value);
  transform.setMode(transformMode.value); transform.setSize(.8);
  runtime.scene.add(transform.getHelper());
  transform.addEventListener("mouseDown", () => {
    const object = transform?.object;
    if (!object) return;
    playing.value = false;
    transformStart = { position: object.position.clone(), rotation: new Vector3(object.rotation.x,object.rotation.y,object.rotation.z), scale: object.scale.clone() };
  });
  transform.addEventListener("mouseUp", () => {
    const object = transform?.object, start = transformStart, id = objectId.value, tool = transformMode.value;
    transformStart = undefined;
    if (!object || !start || !id) return;
    const delta = object.position.clone().sub(start.position);
    const rotation = new Vector3(object.rotation.x,object.rotation.y,object.rotation.z).sub(start.rotation);
    const factor = object.scale.clone().divide(start.scale);
    queueMicrotask(() => { change(value => {
      const item = value.scene.objectList.find(item => item.threeJsonId === id)!;
      if (tool === "translate") for (const axis of axes) translateObject(value,id,axis,delta[axis]);
      if (tool === "rotate") {
        item.rotation = { rotationX: (item.rotation?.rotationX ?? 0) + rotation.x, rotationY: (item.rotation?.rotationY ?? 0) + rotation.y, rotationZ: (item.rotation?.rotationZ ?? 0) + rotation.z };
        for (const track of value.state.basePlan?.tracks.filter(track => track.objectId === id && !track.joint) ?? []) for (const frame of track.frames) for (const axis of axes) frame.rotation[axis] += rotation[axis];
      }
      if (tool === "scale") {
        const scale = { scaleX: (item.scale?.scaleX ?? 1) * factor.x, scaleY: (item.scale?.scaleY ?? 1) * factor.y, scaleZ: (item.scale?.scaleZ ?? 1) * factor.z };
        if (Object.values(scale).some(size => !Number.isFinite(size) || size < .05 || size > 100)) throw new Error("缩放范围为 0.05～100 倍");
        item.scale = scale;
        for (const track of value.state.basePlan?.tracks.filter(track => track.objectId === id && !track.joint) ?? []) for (const frame of track.frames) if (frame.scale) for (const axis of axes) frame.scale[axis] *= factor[axis];
      }
    },true); if (error.value) void rebuild(); });
  });
  updateTransform();
}
watch([mode,objectId,busy,playing,transformSpace,transformSnap],updateTransform);
let animation: ReturnType<typeof prepareSceneAnimation> | undefined;
let motion: ReturnType<typeof prepareMotion> | undefined;
let helpers = new Group(), highlight: BoxHelper | undefined;
let frameId = 0, buildVersion = 0, destroyed = false, lastFrame = 0;
let resizeObserver: ResizeObserver | undefined;
let aiController: AbortController | undefined;
let activePlan = draft.value.plan;
let activeSnapshot = clone(draft.value);
let building = false;
let pendingSnapshot: PrevisSnapshot | undefined;
const raycaster = new Raycaster();
const ground = new Plane(new Vector3(0, 1, 0), 0);
let clickPoint: Vector3 | undefined;
let observerDrag: { pointerId: number; x: number; y: number } | undefined;
let cameraNavigation: { id: string; before: PrevisSnapshot; time: number; kind: "pointer" | "wheel" | "key"; rotated: boolean; moved: boolean; pointerId?: number; x: number; y: number } | undefined;
let cameraSaveTimer: ReturnType<typeof setTimeout> | undefined;
let drag: { before: PrevisSnapshot; point: Vector3; objectId?: string; cameraId?: string; pathId?: string; pointIndex?: number; drawing?: boolean; points?: Vector3[]; moved: boolean } | undefined;

function report(reason: unknown) {
  if(reason && typeof reason==="object" && "issues" in reason && Array.isArray(reason.issues)){
    error.value=reason.issues.slice(0,3).map(issue=>`${issue.path?.join(" → ") || "输入"}：${issue.message}`).join("；");return;
  }
  error.value = reason instanceof Error ? reason.message : String(reason);
}
function addStageLayout() {
  const scene = createVirtualStageScene(stageLayout.value);
  const empty = !draft.value.scene.objectList.length;
  change(value => {
    if (value.scene.objectList.length + scene.objectList.length > 200) throw new Error("布景超过 200 个物体的上限，请先整理场景");
    value.scene.studio = scene.studio;
    value.scene.sceneConfig.lights = scene.sceneConfig.lights;
    value.scene.sceneConfig.scene = scene.sceneConfig.scene;
    value.scene.objectList.push(...scene.objectList);
    if (empty) {
      value.scene.sceneConfig.camera = scene.sceneConfig.camera;
      value.scene.sceneConfig.controls = scene.sceneConfig.controls;
      value.state.cameras[0]!.view = { camera: scene.sceneConfig.camera, controls: scene.sceneConfig.controls };
      value.state.cameraEdited = true;
    }
  });
}
function editObject(mutator: (object: PrevisSnapshot["scene"]["objectList"][number]) => void) {
  if (!selectedObject.value) return;
  change(value => mutator(value.scene.objectList.find(item => item.threeJsonId === objectId.value)!), true);
}
function rotateObject(degrees: number) {
  if (!Number.isFinite(degrees)) return;
  change(value => {
    const object = value.scene.objectList.find(item => item.threeJsonId === objectId.value)!;
    const yaw = degrees * Math.PI / 180, delta = yaw - (object.rotation?.rotationY ?? 0);
    object.rotation = { rotationX:object.rotation?.rotationX ?? 0,rotationY:yaw,rotationZ:object.rotation?.rotationZ ?? 0 };
    for (const track of value.state.basePlan?.tracks.filter(track => track.objectId === object.threeJsonId && !track.joint) ?? []) for (const frame of track.frames) frame.rotation.y += delta;
  },true);
}
function attachProp(actorId: string) {
  if (!selectedObject.value) return;
  const visible = objectId.value ? visibleObject(objectId.value) : undefined;
  const world = visible?.getWorldPosition(new Vector3());
  const rotation = visible ? new Euler().setFromQuaternion(visible.getWorldQuaternion(new Quaternion())) : undefined;
  const scale = visible?.getWorldScale(new Vector3());
  editObject(object => {
    if (!actorId) {
      delete object.attachment;
      if (world) object.position = { x:world.x,y:world.y,z:world.z };
      if (rotation) object.rotation = { rotationX:rotation.x,rotationY:rotation.y,rotationZ:rotation.z };
      if (scale) object.scale = { scaleX:scale.x,scaleY:scale.y,scaleZ:scale.z };
    }
    else { object.stageRole = 'prop'; object.attachment = { objectId:actorId,joint:'rightWrist',offset:{x:0,y:-.08,z:0},rotation:{x:Math.PI/2,y:0,z:0} }; }
  });
}
function setPropHand(hand: string) { if (hand === 'leftWrist' || hand === 'rightWrist') editObject(object => { if (object.attachment) object.attachment.joint=hand; }); }
function setPropOffset(axis: typeof axes[number], value: number) { editObject(object => { if (object.attachment) object.attachment.offset[axis]=value; }); }
function setObjectColor(color: string) { editObject(object => object.material.color = color); }
function setObjectRole(role: string) {
  if (role === "environment" || role === "character" || role === "prop") editObject(object => object.stageRole = role);
}
function setCostume(style: string) {
  editObject(object => {
    if (style === "none") delete object.appearance;
    else if (style === "robe" || style === "modern") object.appearance = { style, skin: "#c4a68b", hair: "#20252b", accent: "#9b916e" };
  });
}
function toggleObjectLock() { editObject(object => object.locked = !object.locked); }
function duplicateObject() {
  if (!selectedObject.value) return;
  const object = clone(selectedObject.value);
  object.threeJsonId = crypto.randomUUID(); object.name = `${object.name || "物体"} 副本`.slice(0,100);
  object.locked = false; object.position.x += .7;
  change(value => value.scene.objectList.push(object));
  if (draft.value.scene.objectList.some(item => item.threeJsonId === object.threeJsonId)) selectObject(object.threeJsonId);
}
function deleteObject() {
  const id = objectId.value;
  if (!id) return;
  change(value => {
    if (value.scene.objectList.some(item => item.attachment?.objectId === id)) throw new Error("人物正在持物，请先解除道具挂接再删除");
    value.scene.objectList = value.scene.objectList.filter(item => item.threeJsonId !== id);
    value.state.paths = value.state.paths.filter(item => item.objectId !== id);
    value.state.actions = value.state.actions.filter(item => item.objectId !== id);
    value.state.shotOverrides = value.state.shotOverrides?.filter(item => item.object.threeJsonId !== id);
    if (value.state.basePlan) value.state.basePlan.tracks = value.state.basePlan.tracks.filter(item => item.objectId !== id);
    value.plan.tracks = value.plan.tracks.filter(item => item.objectId !== id);
    for (const camera of value.state.cameras) if (camera.targetId === id) { delete camera.targetId; delete camera.follow; }
    for (const set of value.state.terrainSets ?? []) set.objectIds = set.objectIds.filter(objectId => objectId !== id);
    value.state.terrainSets = value.state.terrainSets?.filter(set => set.objectIds.length > 1);
  });
  if (!draft.value.scene.objectList.some(item => item.threeJsonId === id)) objectId.value = undefined;
}
function addAssetPreset(id:string){
  if(busy.value)return;
  const object=presetObject(id),anchor=controls?.target;
  if(anchor){object.position.x=Math.round(anchor.x*10)/10;object.position.z=Math.round(anchor.z*10)/10;}
  let suffix=2;const base=object.name;while(draft.value.scene.objectList.some(item=>item.name===object.name))object.name=`${base} ${suffix++}`;
  change(value=>{if(value.scene.objectList.length>=200)throw new Error("场景最多200个物体，请先整理场景");value.scene.objectList.push(object);});
  if(draft.value.scene.objectList.some(item=>item.threeJsonId===object.threeJsonId)){selectObject(object.threeJsonId);status.value=`已添加 ${object.name}，可拖动位置或使用 AI 修改`;}
}
async function importModel(event:Event) {
  const file=(event.target as HTMLInputElement).files?.[0];if(!file || busy.value)return;
  exportBusy.value=true;error.value="";
  try {
    const meshParts=await importStageModel(file);
    exportBusy.value=false;
    const id=crypto.randomUUID();
    change(value=>{value.scene.objectList.push({threeJsonId:id,name:file.name.replace(/\.glb$/i,"").slice(0,100),objType:"mesh",meshParts,geometry:{},position:{x:0,y:0,z:0},stageRole:"prop",material:{type:"standard",color:"#ffffff",roughness:.85}});});
    if(draft.value.scene.objectList.some(object=>object.threeJsonId===id)){selectObject(id);status.value="已导入模型：可修改用途为白模场景，或保留彩色道具";}
  }catch(reason){report(reason);}finally{exportBusy.value=false;if(modelInput.value)modelInput.value.value="";}
}
async function downloadModels(){
  if(busy.value || building || !runtime)return;
  exportBusy.value=true;playing.value=false;
  try{
    animation?.setTime(currentTime.value);runtime.scene.updateMatrixWorld(true);
    const objects=draft.value.scene.objectList.map(object=>getObjectByThreeJsonId(object.threeJsonId,runtime!.scene)).filter((object):object is Object3D=>!!object).map(object=>{const copy=object.clone(true);object.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);return copy;});
    const bytes=await exportStageModel(objects),url=URL.createObjectURL(new Blob([bytes],{type:"model/gltf-binary"})),link=document.createElement("a");link.href=url;link.download="虚拟片场布景.glb";link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status.value="已导出当前时刻的静态布景；可编辑动画请下载 Blender 场景";
  }catch(reason){report(reason);}finally{exportBusy.value=false;}
}
function objectKind(object: PrevisSnapshot["scene"]["objectList"][number]) {
  if (object.stageRole) return { environment: "布景", character: "人物", prop: "道具" }[object.stageRole];
  if(object.presetId){const category=assetCatalog.find(item=>item.id===object.presetId)?.category;return category==="道具"?"道具":"布景";}
  if (props.assetKinds?.[object.threeJsonId] === "location") return "地点";
  if (draft.value.state.terrainSets?.some(set => set.objectIds.includes(object.threeJsonId))) return "场地";
  return object.objType === "mannequin" ? "人物" : object.objType === "plane" ? "布景" : "道具";
}
let savePromise:Promise<void>|undefined;
let saveRequested=false;
function persist():Promise<void> {
  if (cameraNavigation) { finishCameraNavigation(); return savePromise ?? Promise.resolve(); }
  if (externalPreview.value) return Promise.resolve();
  saveRequested=true;
  if(savePromise)return savePromise;
  savePromise=(async()=>{
    saving.value=true;error.value="";status.value="保存中…";
    try {
      do {saveRequested=false;const value=clone(draft.value);value.plan=compilePrevisPlan(value);await props.save(value);}while(saveRequested);
      status.value="已保存";
    }catch(reason){saveRequested=false;report(reason);status.value="保存失败，草稿仍保留";}
    finally{saving.value=false;savePromise=undefined;}
  })();
  return savePromise;
}
function change(mutator: (snapshot: PrevisSnapshot) => void, objectScope = false) {
  if (busy.value || drag) return;
  const before = clone(draft.value);
  try {
    const scoped = objectScope && before.state.shotOverrides?.some(entry => entry.shotId === currentShot.value.id && entry.object.threeJsonId === objectId.value);
    let next = scoped ? materializePrevisObject(before,currentShot.value.id,objectId.value) : clone(before);
    mutator(next); next.plan = compilePrevisPlan(next);
    if (scoped) next = scopePrevisDraft(before,next,{snapshot:before,instruction:"",objectId:objectId.value,time:currentTime.value,scope:"shot",shotId:currentShot.value.id,start:currentShot.value.start,end:shotEnd.value});
    validatePrevisLocks(before, next, true);
    draft.value = normalizePrevisSnapshot(next);
    undoStack.value = [...undoStack.value.slice(-49), before]; redoStack.value = [];
    error.value = ""; void rebuild(); void persist();
  } catch (reason) { report(reason); }
}
function setTimelineDuration(seconds: number, mode: "scale" | "extend") {
  if (busy.value || terrainOpen.value || timelineDragging.value || drag) return;
  finishCameraNavigation(); cancelPathCreation(); playing.value = false;
  const previous = draft.value.plan.duration, playhead = currentTime.value;
  change(value => resizePrevisDuration(value, seconds, mode));
  if (draft.value.plan.duration !== seconds) return;
  currentTime.value = Math.min(seconds, mode === "scale" ? playhead * seconds / previous : playhead);
  status.value = `时间线已设为 ${seconds} 秒；播放与导出已同步，可撤销`;
}
function undo() { const previous = undoStack.value.at(-1); if (!previous || busy.value) return; redoStack.value = [...redoStack.value, clone(draft.value)]; undoStack.value = undoStack.value.slice(0, -1); draft.value = clone(previous); void rebuild(); void persist(); }
function redo() { const next = redoStack.value.at(-1); if (!next || busy.value) return; undoStack.value = [...undoStack.value, clone(draft.value)]; redoStack.value = redoStack.value.slice(0, -1); draft.value = clone(next); void rebuild(); void persist(); }
function selectObject(id: string) { if (aiPreview.value || aiBusy.value) return; if(pendingPath.value&&pendingPath.value.objectId!==id)cancelPathCreation(); selectedPathId.value=undefined; objectId.value = id; if(props.virtualStage && stagePane.value!=="library")stagePane.value="properties"; if(props.virtualStage && selectedObject.value?.objType==="mannequin"){scenarioMode.value=false;chatFolded.value=false;} updateHighlight(); }
function selectCamera(id: string) { if (aiPreview.value) return; finishCameraNavigation(); cancelPathCreation(); selectedPathId.value=undefined; objectId.value = undefined; cameraId.value = id; if(props.virtualStage && stagePane.value!=="cameras")stagePane.value="properties"; monitorSelection.value = true; updateHighlight(); editCanvas.value?.focus({preventScroll:true}); }
function setMode(value: typeof mode.value) { movementKeys.clear();finishCameraNavigation(); if(value!=="path")pendingPath.value=undefined; clickPoint = undefined; observerDrag = undefined; mode.value = value; playing.value = false; if (controls) controls.enabled = false; if (value === "path") topView(); editCanvas.value?.focus({preventScroll:true}); }
function beginCameraNavigation(kind: "pointer" | "wheel" | "key") {
  if (cameraNavigation) return cameraNavigation.kind === kind;
  if (busy.value || drag || building || !runtime || mode.value !== "select") return false;
  const camera = selectedCamera.value;
  if (objectId.value || !camera) { status.value = "请先从左侧或场景中选中一个机位"; return false; }
  if (camera.locked || draft.value.state.paths.some(path => path.cameraId === camera.id && path.locked)) { status.value = "机位或运镜路线已锁定，请先解锁"; return false; }
  playing.value = false; monitorSelection.value = true;
  const before = clone(draft.value); before.plan = compilePrevisPlan(before);
  cameraNavigation = { id: camera.id, before, time: currentTime.value, kind, rotated: false, moved: false, x: 0, y: 0 };
  cameraPreview.value = { id: camera.id, view: sampleCameraView(before, before.plan, camera.id, currentTime.value, samplePrevisPath) };
  status.value = "正在调整所选机位，观察视角保持不动；Esc取消";
  return true;
}
function finishCameraNavigation(commit = true) {
  clearTimeout(cameraSaveTimer); cameraSaveTimer = undefined;
  const navigation = cameraNavigation, preview = cameraPreview.value;
  cameraNavigation = undefined; cameraPreview.value = undefined;
  if (navigation?.pointerId !== undefined && editCanvas.value?.hasPointerCapture(navigation.pointerId)) editCanvas.value.releasePointerCapture(navigation.pointerId);
  if (!navigation || !preview || !navigation.moved || !commit) return;
  const current = clone(draft.value); current.plan = compilePrevisPlan(current);
  if (JSON.stringify(current) !== JSON.stringify(navigation.before)) { report(new Error("场景已变化，本次机位调整未覆盖新内容")); return; }
  change(value => applyManualCameraView(value, navigation.id, navigation.time, preview.view, navigation.rotated, samplePrevisPath));
}
function moveSelectedCamera(right: number, up: number, forward: number, kind: "wheel" | "key") {
  if (!beginCameraNavigation(kind) || !cameraPreview.value || !cameraNavigation) return;
  const view = clone(cameraPreview.value.view);
  moveCameraView(view, right, up, forward, !!selectedCamera.value?.targetId);
  cameraPreview.value = { id: cameraNavigation.id, view }; cameraNavigation.moved = true;
  clearTimeout(cameraSaveTimer); cameraSaveTimer = setTimeout(() => finishCameraNavigation(), 220);
}
function lostPointer() { stageDrag=undefined; observerDrag = undefined; if (cameraNavigation?.kind === "pointer") finishCameraNavigation(false); }
function onKeyUp(event: KeyboardEvent) { movementKeys.delete(event.code); if (cameraNavigation?.kind === "key" && (/^Arrow/.test(event.key) || /^Numpad[2468]$/.test(event.code))) finishCameraNavigation(); }
function cancelCameraNavigation() { movementKeys.clear(); finishCameraNavigation(false); }
function moveObserver(right: number, up: number, forward: number) {
  if (!runtime || !controls) return;
  const direction = runtime.camera.getWorldDirection(new Vector3());
  const delta = new Vector3().setFromMatrixColumn(runtime.camera.matrixWorld,0).multiplyScalar(right).addScaledVector(new Vector3(0,1,0),up).addScaledVector(direction,forward);
  const next = runtime.camera.position.clone().add(delta);
  if ([next.x,next.y,next.z].some(value=>Math.abs(value)>9000)) return;
  runtime.camera.position.copy(next); controls.target.add(delta); controls.update();
}
function observerWheel(event: WheelEvent) {
  if (!runtime || !controls || drag) return;
  playing.value = false;
  (props.virtualStage && stageView.value==="camera"?monitorCanvas.value:editCanvas.value)?.focus({preventScroll:true});
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
  if(props.virtualStage && stageView.value==="stage"){const offset=runtime.camera.position.clone().sub(controls.target);offset.setLength(Math.max(.5,Math.min(700,offset.length()*Math.exp(Math.max(-600,Math.min(600,pixels))*.0015))));runtime.camera.position.copy(controls.target).add(offset);controls.update();return;}
  if (mode.value === "select") { moveSelectedCamera(0, 0, -Math.max(-600, Math.min(600, pixels)) * .01 * (event.shiftKey ? 3 : 1), "wheel"); return; }
  if(mode.value === "path"){
    const offset=runtime.camera.position.clone().sub(controls.target);
    offset.setLength(Math.max(.8,Math.min(500,offset.length()*Math.exp(Math.max(-600,Math.min(600,pixels))*.0015))));
    runtime.camera.position.copy(controls.target).add(offset);controls.update();return;
  }
  moveObserver(0,0,-Math.max(-600,Math.min(600,pixels))*.01*(event.shiftKey?3:1));
}
function topView() { if (!runtime || !controls) return; const target = controls.target; runtime.camera.position.set(target.x, target.y + 25, target.z + 0.01); runtime.camera.lookAt(target); controls.update(); }
function sideView() { if (!runtime || !controls) return; runtime.camera.position.copy(controls.target).add(new Vector3(25, 4, 0)); runtime.camera.lookAt(controls.target); controls.update(); }
function scaleObject(size: number) {
  if (!Number.isFinite(size) || size < .1 || size > 20) { report(new Error("整体大小应为0.1到20倍")); return; }
  change(value => {
    const object = value.scene.objectList.find(object => object.threeJsonId === objectId.value)!;
    const factor = { x:size/(object.scale?.scaleX ?? 1),y:size/(object.scale?.scaleY ?? 1),z:size/(object.scale?.scaleZ ?? 1) };
    object.scale = { scaleX:size,scaleY:size,scaleZ:size };
    for (const track of value.state.basePlan?.tracks.filter(track => track.objectId === object.threeJsonId && !track.joint) ?? []) for (const frame of track.frames) if (frame.scale) for (const axis of axes) frame.scale[axis] *= factor[axis];
  },true);
}
function renameObject(name: string) { change(value => { value.scene.objectList.find(object => object.threeJsonId === objectId.value)!.name = name; }, true); }
function translateObject(value: PrevisSnapshot, id: string, axis: typeof axes[number], delta: number) {
  value.scene.objectList.find(object => object.threeJsonId === id)!.position[axis] += delta;
  value.state.paths.filter(path => path.objectId === id).forEach(path => path.points.forEach(point => point[axis] += delta));
  value.state.basePlan?.tracks.filter(track => track.objectId === id && !track.joint).forEach(track => track.frames.forEach(frame => { if (frame.position) frame.position[axis] += delta; }));
}
function setObjectPosition(axis: typeof axes[number], position: number) { change(value => { const object = value.scene.objectList.find(object => object.threeJsonId === objectId.value)!; translateObject(value, object.threeJsonId, axis, position - object.position[axis]); }, true); }
function releaseFollow(value: PrevisSnapshot, camera: PrevisState["cameras"][number]) { if (!camera.follow) return; camera.view=sampleCameraView(value,compilePrevisPlan(value),camera.id,currentTime.value,samplePrevisPath); delete camera.follow; status.value="已切为手动机位，继续朝向原目标"; }
function editCamera(mutator: (camera: PrevisState["cameras"][number]) => void, manualPosition=false) {
  change(value => {
    const camera = value.state.cameras.find(camera => camera.id === cameraId.value)!;
    if(manualPosition) releaseFollow(value,camera);
    const base=clone(camera.view);
    if(manualPosition || camera.keyframes?.length) camera.view=sampleCameraView(value,compilePrevisPlan(value),camera.id,currentTime.value,samplePrevisPath);
    const before=clone(camera.view);
    mutator(camera);
    if(camera.keyframes?.length && JSON.stringify(camera.view)!==JSON.stringify(before)) recordCameraKeyframe(camera,currentTime.value,camera.view);
    const paths=value.state.paths.filter(path=>path.cameraId===camera.id);
    for(const axis of axes){
      const delta=camera.view.camera.position[axis]-before.camera.position[axis];
      paths.forEach(path=>path.points.forEach(point=>point[axis]+=delta));
      if(manualPosition && paths.length){
        camera.view.camera.position[axis]=base.camera.position[axis]+delta;
        camera.view.controls.target[axis]=base.controls.target[axis]+camera.view.controls.target[axis]-before.controls.target[axis];
      }
    }
    value.state.cameraEdited=true;
  });
}
function setCameraFollow(follow: PrevisState["cameras"][number]["follow"]) { change(value=>{const camera=value.state.cameras.find(camera=>camera.id===cameraId.value)!; if(follow) { if(camera.keyframes?.length)throw new Error("请先清除关键帧，或新增机位使用跟拍"); camera.follow=cameraFollowSchema.parse(follow); value.state.paths=value.state.paths.filter(path=>path.cameraId!==camera.id); } else releaseFollow(value,camera); value.state.cameraEdited=true;}); }
function applyCameraPreset(input:{preset:CameraPreset;start:number;duration:number;amount:number}) { change(value=>{const camera=value.state.cameras.find(camera=>camera.id===cameraId.value)!;if(camera.keyframes?.length)throw new Error("请先清除关键帧，或新增机位使用运镜预设");const view=sampleCameraView(value,compilePrevisPlan(value),camera.id,input.start,samplePrevisPath);const path=createCameraPreset(view,camera.id,input.preset,input.start,input.duration,input.amount);camera.view=view;delete camera.follow;value.state.paths=[...value.state.paths.filter(path=>path.cameraId!==camera.id),path];value.state.cameraEdited=true;}); }
function recordCameraView() {
  finishCameraNavigation();
  change(value=>{const camera=value.state.cameras.find(item=>item.id===cameraId.value)!;
    if(camera.follow || value.state.paths.some(path=>path.cameraId===camera.id))throw new Error("请先把现有运镜转换为关键帧");
    const view=sampleCameraView(value,compilePrevisPlan(value),camera.id,currentTime.value,samplePrevisPath);
    if(!camera.keyframes?.length && currentTime.value>0)recordCameraKeyframe(camera,0,camera.view);
    recordCameraKeyframe(camera,currentTime.value,view); value.state.cameraEdited=true;
  });
}
function convertCameraKeys() {
  change(value=>{const camera=value.state.cameras.find(item=>item.id===cameraId.value)!, plan=compilePrevisPlan(value);
    const frames=Array.from({length:25},(_,index)=>{const time=Math.round(value.plan.duration*index/24*1000)/1000;return {time,view:sampleCameraView(value,plan,camera.id,time,samplePrevisPath),easing:"linear" as const};});
    camera.keyframes=frames;camera.view=clone(frames[0]!.view);delete camera.follow;delete camera.targetId;
    value.state.paths=value.state.paths.filter(path=>path.cameraId!==camera.id);value.state.cameraEdited=true;
  });
}
function updateCameraKey(time:number,frame:CameraKeyframe) { change(value=>{const camera=value.state.cameras.find(item=>item.id===cameraId.value)!;camera.keyframes=camera.keyframes!.map(item=>item.time===time?cameraKeyframeSchema.parse(frame):item).sort((a,b)=>a.time-b.time);value.state.cameraEdited=true;}); }
function removeCameraKey(time:number) { change(value=>{const camera=value.state.cameras.find(item=>item.id===cameraId.value)!;const view=sampleCameraView(value,compilePrevisPlan(value),camera.id,currentTime.value,samplePrevisPath);camera.keyframes=camera.keyframes!.filter(item=>item.time!==time);if(!camera.keyframes.length){delete camera.keyframes;camera.view=view;}value.state.cameraEdited=true;}); }
function clearCameraKeys() { change(value=>{const camera=value.state.cameras.find(item=>item.id===cameraId.value)!;camera.view=sampleCameraView(value,compilePrevisPlan(value),camera.id,currentTime.value,samplePrevisPath);delete camera.keyframes;value.state.cameraEdited=true;}); }
function addCamera(duplicate: boolean) {
  const id = crypto.randomUUID(); change(value => { const view = duplicate && selectedCamera.value ? clone(selectedCamera.value.view) : runtime ? captureCamera(runtime) : clone(value.scene.sceneConfig); value.state.cameras.push({ id, name: nextCameraName(value), view }); });
  if (draft.value.state.cameras.some(camera => camera.id === id)) selectCamera(id);
}
function nextCameraName(value:PrevisSnapshot){let index=value.state.cameras.length+1;while(value.state.cameras.some(camera=>camera.name===`机位 ${index}`))index++;return `机位 ${index}`;}
function toggleCameraLock() { change(value => { const camera = value.state.cameras.find(camera => camera.id === cameraId.value)!; camera.locked = !camera.locked; }); }
function togglePathLock() { change(value => { const path = value.state.paths.find(path => path.id === selectedPath.value?.id)!; path.locked = !path.locked; }, true); }
function cameraPreset(distance: number, height: number) { editCamera(camera => { const target = camera.targetId ? draft.value.scene.objectList.find(object => object.threeJsonId === camera.targetId)?.position : camera.view.controls.target; if (!target) return; camera.view.controls.target = { ...target, y: target.y + 1 }; camera.view.camera.position = { x: target.x, y: target.y + 1 + height, z: target.z + distance }; },true); }
function setPathOption(field: "smoothing" | "orientation", input: number | string) { change(value => { const path = value.state.paths.find(path => path.id === selectedPath.value?.id)!; if (field === "smoothing") path.smoothing = Number(input); else path.orientation = input as "along" | "fixed"; value.state.cameraEdited ||= !!path.cameraId; }, true); }
function setPathHeight(height: number) { change(value => { const path = value.state.paths.find(path => path.id === selectedPath.value?.id)!; const delta = height - path.points[0]!.y; path.points.forEach(point => point.y += delta); value.state.cameraEdited ||= !!path.cameraId; }, true); }
function captureView() { if (runtime) { const view = captureCamera(runtime); editCamera(camera => { camera.view = view; camera.targetId = undefined; },true); } }
function deleteCamera(id=cameraId.value) { if(busy.value || draft.value.state.cameras.length<2)return;const camera=draft.value.state.cameras.find(item=>item.id===id);if(!camera || camera.locked)return;finishCameraNavigation();change(value => { value.state.cameras = value.state.cameras.filter(camera => camera.id !== id); const fallback = value.state.cameras[0]!.id; value.state.shots.forEach(shot => { if (shot.cameraId === id) shot.cameraId = fallback; }); value.state.paths = value.state.paths.filter(path => path.cameraId !== id); value.state.cameraEdited = true; }); if(!draft.value.state.cameras.some(camera=>camera.id===cameraId.value))cameraId.value=draft.value.state.cameras[0]!.id; }
function addShot() { change(value => { const start = Math.min(value.plan.duration - 0.1, Math.round(currentTime.value * 100) / 100); const existing = value.state.shots.find(shot => Math.abs(shot.start-start)<.1); if (existing) existing.cameraId = cameraId.value; else value.state.shots.push({ id: crypto.randomUUID(), cameraId: cameraId.value, start }); value.state.cameraEdited = true; }); }
function selectTimelineShot(id:string){const shot=draft.value.state.shots.find(shot=>shot.id===id);if(shot){seek(shot.start);selectCamera(shot.cameraId);timelineSelection.value={kind:"shot",id};}}
function selectTimelineAction(id:string){const action=visibleActions.value.find(action=>action.id===id);if(!action)return;playing.value=false;selectObject(action.objectId);timelineSelection.value={kind:"action",id,shotId:currentShot.value.id};}
function splitTimelineClip(){
  if(busy.value||timelineDragging.value)return;playing.value=false;
  const selected=timelineSelection.value;if(!selected){report(new Error("请先选择要分割的镜头或动作片段"));return;}
  const time=currentTime.value;
  if(selected.kind==="path"){report(new Error("路线通过拖动两端调整时段；Z用于分割动作和镜头"));return;}
  if(selected.kind==="shot")change(value=>{splitShot(value,selected.id,time);});
  else {if(selected.shotId!==currentShot.value.id){report(new Error("镜头范围已变化，请重新选择动作"));return;}const action=visibleActions.value.find(action=>action.id===selected.id);if(!action)return;selectObject(action.objectId);change(value=>{splitAction(value.state.actions,selected.id,time);},true);}
}
function deleteTimelineClip(){
  if(busy.value||timelineDragging.value)return;playing.value=false;
  const selected=timelineSelection.value;if(!selected){report(new Error("请先选择要删除的片段"));return;}
  if(selected.kind==="path"){selectTimelinePath(selected.id);removePath();return;}
  if(selected.kind==="shot")removeShot(selected.id);
  else {if(selected.shotId!==currentShot.value.id){report(new Error("镜头范围已变化，请重新选择动作"));return;}removeAction(selected.id);}
}
function cancelPathCreation(){pendingPath.value=undefined;clickPoint=undefined;if(mode.value==="path")mode.value="select";}
function createTimelinePath(input:{objectId:string;start:number;duration:number}){
  if(busy.value)return;
  if(!Number.isFinite(input.start)||!Number.isFinite(input.duration)||input.start<0||input.duration<.2||input.start+input.duration>draft.value.plan.duration){report(new Error("路线时段需位于时间线内，时长至少0.2秒"));return;}
  if(!draft.value.scene.objectList.some(object=>object.threeJsonId===input.objectId&&object.objType==="mannequin")){report(new Error("请选择人物"));return;}
  cancelPathCreation();seek(input.start);selectObject(input.objectId);
  if(visiblePaths.value.some(path=>path.objectId===input.objectId&&Math.min(path.start+path.duration,input.start+input.duration)>Math.max(path.start,input.start)+1e-8)){report(new Error("此人物在所选时段已有路线，请调整时间或先删除旧路线"));return;}
  aiOpen.value=false;error.value="";setMode("path");pendingPath.value={...input,shotId:currentShot.value.id};status.value="请在俯视画面绘制人物路线";
}
function selectTimelinePath(id:string){const path=visiblePaths.value.find(path=>path.id===id);if(!path)return;playing.value=false;if(path.objectId)selectObject(path.objectId);else selectCamera(path.cameraId!);selectedPathId.value=id;timelineSelection.value={kind:"path",id,shotId:currentShot.value.id};}
function editTimelinePath(id:string,start:number,duration:number){selectTimelinePath(id);change(value=>{const path=value.state.paths.find(path=>path.id===id);if(!path)throw new Error("路线已变化，请重新选择");path.start=start;path.duration=duration;value.state.cameraEdited ||= !!path.cameraId;},true);}
function createTimelineAction(input:{objectId:string;kind:string;start:number;duration:number}){
  if(busy.value)return;
  if(!Number.isFinite(input.start)||!Number.isFinite(input.duration)||input.start<0||input.duration<.2||input.start+input.duration>draft.value.plan.duration){report(new Error("动作开始时间和持续时间需位于时间线内，时长至少0.2秒"));return;}
  if(!actionKinds.includes(input.kind as typeof actionKinds[number])||!draft.value.scene.objectList.some(object=>object.threeJsonId===input.objectId&&object.objType==="mannequin")){report(new Error("请选择人物和有效动作"));return;}
  seek(input.start);selectObject(input.objectId);const id=crypto.randomUUID();
  change(value=>{value.state.actions.push({...input,id,kind:input.kind as typeof actionKinds[number]});},true);
  if(visibleActions.value.some(action=>action.id===id))timelineSelection.value={kind:"action",id,shotId:currentShot.value.id};
}
function createTimelineShot(input:{cameraId:string;start:number}){
  if(busy.value)return;playing.value=false;let selectedId="";
  change(value=>{
    if(!Number.isFinite(input.start)||input.start<0||input.start>value.plan.duration-.1)throw new Error("镜头开始时间需位于时间线内，至少保留0.1秒");
    let target=input.cameraId;
    if(!target){const current=value.state.cameras.find(camera=>camera.id===cameraId.value)!;target=crypto.randomUUID();value.state.cameras.push({id:target,name:nextCameraName(value),view:sampleCameraView(value,compilePrevisPlan(value),current.id,input.start,samplePrevisPath),targetId:current.targetId});}
    if(!value.state.cameras.some(camera=>camera.id===target))throw new Error("请选择有效机位");
    const ordered=[...value.state.shots].sort((a,b)=>a.start-b.start),existing=ordered.find(shot=>Math.abs(shot.start-input.start)<1e-8);
    selectedId=existing?.id??splitShot(value,ordered.findLast(shot=>shot.start<input.start)!.id,input.start);
    value.state.shots.find(shot=>shot.id===selectedId)!.cameraId=target;value.state.cameraEdited=true;
  });
  if(draft.value.state.shots.some(shot=>shot.id===selectedId))selectTimelineShot(selectedId);
}
function editTimelineShots(shots:PrevisState["shots"]){change(value=>{value.state.shots=clone(shots);value.state.cameraEdited=true;});}
function editTimelineAction(id:string,start:number,duration:number){const action=visibleActions.value.find(action=>action.id===id);if(!action)return;selectObject(action.objectId);change(value=>{const item=value.state.actions.find(action=>action.id===id);if(!item)throw new Error("所选动作已变化，请重新选择");item.start=start;item.duration=duration;},true);}
function changeShot(id: string, field: "cameraId" | "start", entry: string | number) { change(value => { const shot = value.state.shots.find(shot => shot.id === id)!; if (field === "cameraId") shot.cameraId = String(entry); else shot.start = Number(entry); value.state.cameraEdited = true; }); }
function removeShot(id: string) { change(value => { deleteShot(value,id); }); }
function addAction() { change(value => { if (!objectId.value) return; const start = Math.round(currentTime.value * 100) / 100; value.state.actions.push({ id: crypto.randomUUID(), objectId: objectId.value, kind: actionKind.value, start, duration: Math.min(actionDuration.value, value.plan.duration - start) }); }, true); }
function changeAction(id: string, field: "start" | "duration", entry: number) { const action = visibleActions.value.find(action => action.id === id); if (action) selectObject(action.objectId); change(value => { value.state.actions.find(action => action.id === id)![field] = entry; }, true); }
function removeAction(id: string) { const action = visibleActions.value.find(action => action.id === id); if (action) selectObject(action.objectId); change(value => { value.state.actions = value.state.actions.filter(action => action.id !== id); }, true); }
function editPathTiming(field: "start" | "duration", entry: number) { const id = selectedPath.value?.id; change(value => { value.state.paths.find(path => path.id === id)![field] = entry; value.state.cameraEdited ||= !!selectedPath.value?.cameraId; }, true); }
function removePath() { const id = selectedPath.value?.id; change(value => { value.state.paths = value.state.paths.filter(path => path.id !== id); value.state.cameraEdited ||= !!selectedPath.value?.cameraId; }, true); }
function seek(time: number) { if(pendingPath.value&&Math.abs(time-pendingPath.value.start)>1e-8)cancelPathCreation(); playing.value = false; monitorSelection.value = false; currentTime.value = Math.max(0, Math.min(draft.value.plan.duration, time)); }
function togglePlayback() { monitorSelection.value = false; if (!playing.value && currentTime.value >= activePlan.duration) currentTime.value = 0; playing.value = !playing.value; }

function clearHelpers() { helpers.traverse(object => { if (object instanceof Mesh || object instanceof Line) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } }); helpers.removeFromParent(); helpers = new Group(); highlight = undefined; }
function createHelpers() {
  if (!runtime) return;
  clearHelpers();
  const state = aiPreview.value ? activeSnapshot.state : draft.value.state;
  for (const camera of state.cameras) {
    const marker = new Group(); const material=new MeshBasicMaterial({color:camera.id===cameraId.value?0xffd36b:0x69b6ff,depthTest:false,depthWrite:false});
    const body=new Mesh(new BoxGeometry(.36,.25,.34),material);body.userData.cameraAccent=true;marker.add(body);
    const lens=new Mesh(new CylinderGeometry(.105,.105,.22,16),new MeshBasicMaterial({color:0x25313e,depthTest:false,depthWrite:false}));lens.rotation.x=Math.PI/2;lens.position.z=-.25;marker.add(lens);
    const glass=new Mesh(new CylinderGeometry(.082,.082,.015,16),new MeshBasicMaterial({color:0x8de3ec,depthTest:false,depthWrite:false}));glass.rotation.x=Math.PI/2;glass.position.z=-.367;marker.add(glass);
    const handle=new Mesh(new BoxGeometry(.07,.045,.22),new MeshBasicMaterial({color:0x293440,depthTest:false,depthWrite:false}));handle.position.set(0,.19,.015);marker.add(handle);
    for(const z of [-.055,.085]){const support=new Mesh(new BoxGeometry(.045,.07,.04),handle.material.clone());support.position.set(0,.15,z);marker.add(support);}
    const viewfinder=new Mesh(new BoxGeometry(.12,.09,.13),new MeshBasicMaterial({color:0x34495c,depthTest:false,depthWrite:false}));viewfinder.position.set(.18,.11,.11);marker.add(viewfinder);
    const screen=new Mesh(new BoxGeometry(.012,.15,.21),new MeshBasicMaterial({color:0xb9dbe9,depthTest:false,depthWrite:false}));screen.position.set(-.187,0,.015);marker.add(screen);
    marker.traverse(part=>{if(part instanceof Mesh)part.renderOrder=25;});
    const helperCamera = new PerspectiveCamera(camera.view.camera.fov, renderAspect.value, 0.1, 3); applyCamera(helperCamera, camera.view); helperCamera.far = 3; helperCamera.updateProjectionMatrix(); helperCamera.updateMatrixWorld();const frustum=new CameraHelper(helperCamera); helpers.add(frustum);
    const sightline=new Line(new BufferGeometry().setFromPoints([new Vector3().copy(camera.view.camera.position), new Vector3().copy(camera.view.controls.target)]), new LineBasicMaterial({ color: 0x69b6ff }));helpers.add(sightline);Object.assign(marker.userData,{viewCamera:helperCamera,frustum,sightline});
    marker.position.copy(camera.view.camera.position); marker.lookAt(camera.view.controls.target.x,camera.view.controls.target.y,camera.view.controls.target.z); marker.rotateY(Math.PI); marker.userData.cameraId = camera.id; helpers.add(marker);
  }
  for (const path of (aiPreview.value ? state.paths : visiblePaths.value)) {
    const color = path.objectId ? 0x62e0b0 : 0x69b6ff;
    const line = new Line(new BufferGeometry().setFromPoints((path.smoothing ? Array.from({ length: 121 }, (_, index) => samplePrevisPath(path, path.start + path.duration * index / 120).position) : path.points).map(point => new Vector3(point.x, point.y + 0.04, point.z))), new LineBasicMaterial({ color })); helpers.add(line);
    const middle = samplePrevisPath(path, path.start + path.duration * .5); helpers.add(new ArrowHelper(new Vector3(Math.sin(middle.yaw), 0, Math.cos(middle.yaw)), new Vector3().copy(middle.position).add(new Vector3(0,.1,0)), .8, color));
    path.points.forEach((point, index) => { const handle = new Mesh(new SphereGeometry(index === 0 ? 0.18 : 0.12, 8, 6), new MeshBasicMaterial({ color, depthTest: false })); handle.position.copy(point); handle.position.y += 0.06; handle.renderOrder = 10; Object.assign(handle.userData, { pathId: path.id, pointIndex: index }); helpers.add(handle); });
  }
  spatialWarnings.value = [];
  const obstacles = draft.value.scene.objectList.filter(object => object.objType !== "mannequin" && object.objType !== "plane").flatMap(object => { const root = getObjectByThreeJsonId(object.threeJsonId,runtime!.scene); return root ? [{object,box:new Box3().setFromObject(root)}] : []; });
  for (const path of (aiPreview.value ? state.paths : visiblePaths.value)) {
    const crossed = obstacles.find(({object,box}) => object.threeJsonId !== path.objectId && Array.from({length:81},(_,index) => samplePrevisPath(path,path.start+path.duration*index/80).position).some(point => box.clone().expandByScalar(.25).containsPoint(new Vector3().copy(point))));
    if (crossed) spatialWarnings.value.push(`路线可能穿过「${crossed.object.name || "布景"}」，请检查；提示基于包围盒。`);
  }
  for (const camera of state.cameras) {
    const target = camera.targetId && draft.value.scene.objectList.find(object => object.threeJsonId === camera.targetId);
    if (!target) continue;
    const start = new Vector3().copy(camera.view.camera.position), end = new Vector3().copy(target.position).add(new Vector3(0,1,0));
    const ray = new Raycaster(start,end.clone().sub(start).normalize(),0,start.distanceTo(end));
    const crossed = obstacles.find(({object,box}) => object.threeJsonId !== target.threeJsonId && ray.ray.intersectBox(box,new Vector3())?.distanceTo(start)! < start.distanceTo(end));
    if (crossed) spatialWarnings.value.push(`${camera.name} 看向人物的视线可能被「${crossed.object.name || "布景"}」遮挡。`);
  }
  runtime.scene.add(helpers); updateHighlight();
}
function visibleObject(id: string) {
  if (!runtime) return undefined;
  const snapshot = aiPreview.value ?? draft.value;
  const shot = [...snapshot.state.shots].sort((a,b) => a.start-b.start).findLast(shot => shot.start <= currentTime.value);
  const override = snapshot.state.shotOverrides?.find(entry => entry.shotId === shot?.id && entry.object.threeJsonId === id);
  return getObjectByThreeJsonId(override ? overrideInstanceId(override.shotId,id) : id,runtime.scene);
}
function updateHighlight() {
  for (const child of helpers.children) if (child.userData.cameraId) child.traverse(part=>{if(part instanceof Mesh && part.userData.cameraAccent && part.material instanceof MeshBasicMaterial)part.material.color.set(child.userData.cameraId === cameraId.value && !objectId.value ? 0xffd36b : 0x69b6ff);});
  if (highlight) { highlight.removeFromParent(); highlight.geometry.dispose(); highlight.material.dispose(); highlight = undefined; }
  const object = objectId.value && runtime ? visibleObject(objectId.value) : undefined;
  if (object) { highlight = new BoxHelper(object, 0xffd36b); helpers.add(highlight); }
}
async function rebuild(snapshot = clone(draft.value)) {
  pendingSnapshot = snapshot;
  if (building) return;
  building = true;
  try { while (pendingSnapshot && !destroyed) { const next = pendingSnapshot; pendingSnapshot = undefined; await buildStage(next); } }
  finally { building = false; }
}
async function buildStage(snapshot: PrevisSnapshot) {
  const version = ++buildVersion; playing.value = false;
  if (!editCanvas.value) return;
  try {
    const plan = compilePrevisPlan(snapshot);
    const cameraView = runtime ? captureCamera(runtime) : undefined;
    const target = controls?.target.clone();
    const restoreCanvasFocus = document.activeElement === editCanvas.value;
    resizeObserver?.unobserve(editCanvas.value);
    transform?.dispose(); transform = undefined; transformStart = undefined;
    controls?.dispose(); animation?.dispose(); clearHelpers(); if (runtime) { disposeStage(runtime); runtime = undefined; }
    // disposeStage 会释放 WebGL context，重建时必须使用新 canvas。
    canvasKey.value++;
    await nextTick();
    if (destroyed || !editCanvas.value) return;
    resizeObserver?.observe(editCanvas.value);
    const next = await createStage(editCanvas.value, compilePrevisScene(snapshot), undefined, 16 / 9, undefined, { gridVisible: viewGrid.value, skyVisible: false });
    if (destroyed || version !== buildVersion) { disposeStage(next); return; }
    runtime = next; activePlan = plan; activeSnapshot = snapshot;
    if (renderer) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = next.renderer.shadowMap.type; renderer.toneMapping = next.renderer.toneMapping; renderer.outputColorSpace = next.renderer.outputColorSpace; }
    if (cameraView) applyCamera(runtime.camera, cameraView);
    controls = new OrbitControls(runtime.camera, editCanvas.value); controls.target.copy(target ?? new Vector3(snapshot.scene.sceneConfig.controls.target.x, snapshot.scene.sceneConfig.controls.target.y, snapshot.scene.sceneConfig.controls.target.z)); controls.enabled = false; controls.update();
    if (restoreCanvasFocus && document.activeElement === document.body) editCanvas.value.focus({preventScroll:true});
    animation = prepareSceneAnimation(runtime, plan); motion = prepareMotion(plan.cameraFrames);
    currentTime.value = Math.min(currentTime.value, plan.duration); createHelpers(); createTransform(); resize();
  } catch (reason) { report(reason); }
}
let lastThumbnailRefresh=0;
function refreshThumbnails(visibleOnly=false) {
  if (!runtime || !renderer || !monitorCanvas.value || building || drag || transform?.dragging) return;
  const pixelRatio=renderer.getPixelRatio(), helperVisible=helpers.visible;
  const grids=runtime.scene.children.filter(child=>child.type==='GridHelper').map(child=>({child,visible:child.visible}));
  try {
    helpers.visible=false;grids.forEach(({child})=>child.visible=false);
    renderer.setPixelRatio(1);renderer.setSize(320,Math.max(90,Math.round(320/renderAspect.value)),false);
    monitor.aspect=renderAspect.value;monitor.updateProjectionMatrix();
    for(const camera of visibleOnly?visibleCameraPreviews.value:draft.value.state.cameras){
      const view=sampleCameraView(draft.value,activePlan,camera.id,currentTime.value,samplePrevisPath);
      applyCamera(monitor,view);renderer.render(runtime.scene,monitor);thumbnails.value[camera.id]=monitorCanvas.value.toDataURL("image/jpeg",.78);
    }
    lastThumbnailRefresh=performance.now();
  }catch(cause){report(cause);}finally{helpers.visible=helperVisible;grids.forEach(({child,visible})=>child.visible=visible);renderer.setPixelRatio(pixelRatio);resizeMonitor();}
}
function resize() {
  if(props.virtualStage && monitorPosition.value && !monitorFolded.value && stageView.value!=="camera")clampMonitorPosition(monitorPosition.value.x,monitorPosition.value.y);
  if (!runtime || !editCanvas.value || !renderer || !monitorCanvas.value) return;
  const rect = editCanvas.value.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) { runtime.renderer.setSize(rect.width, rect.height, false); runtime.camera.aspect = rect.width / rect.height; runtime.camera.updateProjectionMatrix(); }
  resizeMonitor();
}
function resizeMonitor(){
  if(!renderer || !monitorCanvas.value)return;
  const box = monitorCanvas.value.parentElement!.getBoundingClientRect(), aspect = renderAspect.value;
  const width = Math.max(2, Math.min(box.width - 4, (box.height - 4) * aspect)), height = width / aspect;
  renderer.setSize(width, height, false);
  monitorCanvas.value.style.width = `${width}px`; monitorCanvas.value.style.height = `${height}px`;
  if(monitorGridElement.value){monitorGridElement.value.style.width=`${width}px`;monitorGridElement.value.style.height=`${height}px`;}
}
function frame(now: number) {
  if (destroyed) return;
  const delta = Math.min(0.1, (now - lastFrame) / 1000 || 0); lastFrame = now;
  if(mode.value==="observe" && movementKeys.size && document.activeElement===editCanvas.value){
    const amount=delta*(movementKeys.has("ShiftLeft")||movementKeys.has("ShiftRight")?9:3);
    moveObserver((Number(movementKeys.has("KeyD"))-Number(movementKeys.has("KeyA")))*amount,(Number(movementKeys.has("KeyE"))-Number(movementKeys.has("KeyQ")))*amount,(Number(movementKeys.has("KeyW"))-Number(movementKeys.has("KeyS")))*amount);
  }
  if (playing.value) { currentTime.value = Math.min(activePlan.duration, currentTime.value + delta); if (currentTime.value >= activePlan.duration) playing.value = false; }
  if (runtime && renderer && animation && motion) {
    monitor.aspect = renderAspect.value; monitor.updateProjectionMatrix();
    if (!drag && !transform?.dragging) animation.setTime(currentTime.value);
    if (!drag) for (const marker of helpers.children) {
      if (!marker.userData.cameraId) continue;
      const preview = cameraPreview.value;
      const view = preview && preview.id === marker.userData.cameraId ? preview.view : sampleCameraView(activeSnapshot,activePlan,marker.userData.cameraId,currentTime.value,samplePrevisPath);
      marker.position.copy(view.camera.position); marker.lookAt(view.controls.target.x,view.controls.target.y,view.controls.target.z); marker.rotateY(Math.PI);
      const distance=marker.position.distanceTo(runtime.camera.position);
      marker.visible=distance>(props.virtualStage?3:.9);
      const {viewCamera,frustum,sightline}=marker.userData; if(viewCamera){applyCamera(viewCamera,view);viewCamera.far=3;viewCamera.updateProjectionMatrix();viewCamera.updateMatrixWorld();frustum.update();frustum.visible=marker.visible&&marker.userData.cameraId===cameraId.value&&!objectId.value;sightline.visible=frustum.visible;const points=sightline.geometry.attributes.position;points.setXYZ(0,view.camera.position.x,view.camera.position.y,view.camera.position.z);points.setXYZ(1,view.controls.target.x,view.controls.target.y,view.controls.target.z);points.needsUpdate=true;sightline.geometry.computeBoundingSphere();}
    }
    controls?.update(); highlight?.update();
    runtime.renderer.render(runtime.scene, runtime.camera);
    sampleMotion(monitor, motion, currentTime.value);
    if (!playing.value && monitorSelection.value && !aiPreview.value && selectedCamera.value) {
      const view = cameraPreview.value?.id === cameraId.value ? cameraPreview.value.view : sampleCameraView(draft.value,activePlan,cameraId.value,currentTime.value,samplePrevisPath);
      applyCamera(monitor, view);
    }
    const shot = [...activeSnapshot.state.shots].sort((a, b) => a.start - b.start).findLast(shot => shot.start <= currentTime.value);
    monitorName.value = !playing.value && monitorSelection.value ? `${selectedCamera.value?.name ?? '监看'}（选定机位）` : activeSnapshot.state.cameras.find(camera => camera.id === shot?.cameraId)?.name ?? "监看";
    helpers.visible = false;
    const grids: Object3D[] = []; runtime.scene.children.forEach(child => { if (child.type === "GridHelper" && child.visible) { child.visible = false; grids.push(child); } });
    const gizmo = transform?.getHelper(), gizmoVisible = gizmo?.visible;
    if (gizmo) gizmo.visible = false;
    if(props.virtualStage && stagePane.value==="cameras" && !rightFolded.value && !aiOpen.value && !terrainOpen.value && now-lastThumbnailRefresh>800){const savedPosition=monitor.position.clone(),savedQuaternion=monitor.quaternion.clone(),savedFov=monitor.fov,savedNear=monitor.near,savedFar=monitor.far;refreshThumbnails(true);monitor.position.copy(savedPosition);monitor.quaternion.copy(savedQuaternion);monitor.fov=savedFov;monitor.near=savedNear;monitor.far=savedFar;monitor.updateProjectionMatrix();}
    renderer.render(runtime.scene, monitor); helpers.visible = true; grids.forEach(grid => grid.visible = true);
    if (gizmo) gizmo.visible = gizmoVisible ?? true;
  }
  frameId = requestAnimationFrame(frame);
}
function cast(event: PointerEvent) { if (!runtime || !editCanvas.value) return; const rect = editCanvas.value.getBoundingClientRect(); raycaster.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), runtime.camera); }
function pointOnGround(event: PointerEvent) { cast(event); return raycaster.ray.intersectPlane(ground, new Vector3()); }
let stageDrag: {pointerId:number;x:number;y:number;kind:"pan"|"orbit"}|undefined;
function beginStageDrag(event:PointerEvent,kind:"pan"|"orbit"){event.preventDefault();playing.value=false;stageDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,kind};(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);}
function pointerDown(event: PointerEvent) {
  try { beginPointer(event); }
  catch (reason) { pointerCancel(); report(reason); }
}
function beginPointer(event: PointerEvent) {
  editCanvas.value?.focus({ preventScroll: true });
  if (transform?.enabled && transform.axis && event.button === 0) return;
  if(props.virtualStage && stageView.value==="stage" && runtime && controls && !drag && (event.button===1 || event.button===2 || (event.button===0 && (event.altKey || mode.value==="observe")))) { beginStageDrag(event,event.button===0?"pan":"orbit"); return; }
  if(props.virtualStage && stageView.value==="camera"){monitorCanvas.value?.focus({preventScroll:true});if(event.button===0)return;}
  if (mode.value === "select" && runtime && event.button === 2) {
    event.preventDefault();
    if (beginCameraNavigation("pointer") && cameraNavigation) { cameraNavigation.pointerId = event.pointerId; cameraNavigation.x = event.clientX; cameraNavigation.y = event.clientY; (event.currentTarget as HTMLCanvasElement)?.setPointerCapture(event.pointerId); }
    return;
  }
  if (mode.value === "observe" && runtime && !drag && event.button === 2) { event.preventDefault(); playing.value = false; observerDrag = {pointerId:event.pointerId,x:event.clientX,y:event.clientY}; editCanvas.value?.setPointerCapture(event.pointerId); return; }
  if (cameraNavigation) return;
  if (observerDrag) return;
  if (mode.value === "observe" || busy.value || !runtime || event.button !== 0) return;
  playing.value = false; cast(event); const point = pointOnGround(event); if (!point) return;
  if (mode.value === "path") { drag = { before: clone(draft.value), point, moved: false, drawing: true, points: [point.clone()], objectId: objectId.value, cameraId: objectId.value ? undefined : cameraId.value }; }
  else {
    const cameraHit=raycaster.intersectObjects(helpers.children.filter(child=>child.userData.cameraId && child.visible),true)[0];
    const hit = cameraHit ?? raycaster.intersectObjects([...helpers.children, ...compilePrevisScene(clone(draft.value)).objectList.flatMap(object => { const root = getObjectByThreeJsonId(object.threeJsonId, runtime!.scene); return root ? [root] : []; })], true).find(hit => !(hit.object instanceof BoxHelper) && !(hit.object instanceof Line));
    if (!hit) { if(props.virtualStage)beginStageDrag(event,"pan"); return; }
    let root: Object3D | null = hit.object;
    while (root && !root.userData.pathId && !root.userData.cameraId && !root.userData.threeJsonId && !root.userData.objJson?.threeJsonId) root = root.parent;
    if (!root) return;
    if (root.userData.pathId && visiblePaths.value.find(path => path.id === root!.userData.pathId)?.locked) return;
    if (root.userData.cameraId && draft.value.state.cameras.find(camera => camera.id === root!.userData.cameraId)?.locked) return;
    if (root.userData.pathId) {
      const path = visiblePaths.value.find(path => path.id === root!.userData.pathId)!;
      if (path.objectId) selectObject(path.objectId); else selectCamera(path.cameraId!); selectedPathId.value=path.id;
      drag = { before: clone(draft.value), point, moved: false, pathId: path.id, pointIndex: root.userData.pointIndex };
    } else if (root.userData.cameraId) { selectCamera(root.userData.cameraId); drag = { before: clone(draft.value), point, moved: false, cameraId: cameraId.value }; }
    else { let id = root.userData.threeJsonId ?? root.userData.objJson?.threeJsonId; const override = draft.value.state.shotOverrides?.find(entry => overrideInstanceId(entry.shotId, entry.object.threeJsonId) === id); id = override?.object.threeJsonId ?? id; selectObject(id); if (selectedObject.value?.locked || selectedObject.value?.attachment) return; drag = { before: clone(draft.value), point, moved: false, objectId: id }; if (!props.virtualStage) { scenarioMode.value = false; aiOpen.value = true; } }
  }
  editCanvas.value?.setPointerCapture(event.pointerId);
}
function pointerMove(event: PointerEvent) {
  if(stageDrag && event.pointerId===stageDrag.pointerId && runtime && controls){
    const dx=event.clientX-stageDrag.x,dy=event.clientY-stageDrag.y;stageDrag.x=event.clientX;stageDrag.y=event.clientY;
    const offset=runtime.camera.position.clone().sub(controls.target);
    if(stageDrag.kind==="orbit"){const sphere=new Spherical().setFromVector3(offset);sphere.theta-=dx*.006;sphere.phi=Math.max(.03,Math.min(Math.PI-.03,sphere.phi-dy*.006));offset.setFromSpherical(sphere);runtime.camera.position.copy(controls.target).add(offset);}
    else{const distance=Math.max(1,offset.length())*.0015;const delta=new Vector3().setFromMatrixColumn(runtime.camera.matrixWorld,0).multiplyScalar(-dx*distance).addScaledVector(new Vector3().setFromMatrixColumn(runtime.camera.matrixWorld,1),dy*distance);runtime.camera.position.add(delta);controls.target.add(delta);}
    runtime.camera.lookAt(controls.target);controls.update();return;
  }
  if (cameraNavigation?.pointerId === event.pointerId && cameraPreview.value) {
    const dx = event.clientX - cameraNavigation.x, dy = event.clientY - cameraNavigation.y;
    if (!dx && !dy) return;
    const view = clone(cameraPreview.value.view); turnCameraView(view, dx, dy);
    cameraPreview.value = { id: cameraNavigation.id, view }; cameraNavigation.rotated = true; cameraNavigation.moved = true;
    cameraNavigation.x = event.clientX; cameraNavigation.y = event.clientY; return;
  }
  if (observerDrag && event.pointerId === observerDrag.pointerId && runtime && controls) {
    const direction=runtime.camera.getWorldDirection(new Vector3());
    const yaw=Math.atan2(direction.x,direction.z)-(event.clientX-observerDrag.x)*.004;
    const pitch=Math.max(-Math.PI/2+.02,Math.min(Math.PI/2-.02,Math.asin(direction.y)-(event.clientY-observerDrag.y)*.004));
    const distance=Math.max(1,runtime.camera.position.distanceTo(controls.target));
    controls.target.copy(runtime.camera.position).add(new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(distance));
    controls.update(); observerDrag.x=event.clientX; observerDrag.y=event.clientY; return;
  }
  if (!drag || !runtime) return; const point = pointOnGround(event); if (!point) return;
  const delta = point.clone().sub(drag.point);
  if (delta.length() < 0.025) return;
  drag.moved = true;
  if (drag.drawing) { if (drag.points!.length < 60) drag.points!.push(point.clone()); else drag.points![59] = point.clone(); }
  else if (drag.pathId) { const path = visiblePaths.value.find(path => path.id === drag!.pathId)!; const control = path.points[drag.pointIndex!]!; control.x += delta.x; control.z += delta.z; draft.value.state.cameraEdited ||= !!path.cameraId; }
  else if (drag.objectId) {
    const override = draft.value.state.shotOverrides?.find(entry => entry.shotId === currentShot.value.id && entry.object.threeJsonId === drag!.objectId);
    if (override) {
      override.object.position.x += delta.x; override.object.position.z += delta.z;
      for (const tracks of [override.tracks, override.baseTracks ?? []]) tracks.filter(track => !track.joint).forEach(track => track.frames.forEach(frame => { if (frame.position) { frame.position.x += delta.x; frame.position.z += delta.z; } }));
      override.paths?.forEach(path => path.points.forEach(point => { point.x += delta.x; point.z += delta.z; }));
    } else { translateObject(draft.value, drag.objectId, "x", delta.x); translateObject(draft.value, drag.objectId, "z", delta.z); }
    const root = visibleObject(drag.objectId); if (root) root.position.add(delta);
  } else if (drag.cameraId) { const camera = draft.value.state.cameras.find(camera => camera.id === drag!.cameraId)!; releaseFollow(draft.value,camera); camera.view.camera.position.x += delta.x; camera.view.camera.position.z += delta.z; draft.value.state.paths.filter(path => path.cameraId === drag!.cameraId).forEach(path => path.points.forEach(point => { point.x += delta.x; point.z += delta.z; })); draft.value.state.cameraEdited = true; }
  drag.point = point;
  createHelpers();
  if (drag.drawing) { const points = drag.points!; const line = new Line(new BufferGeometry().setFromPoints(points.map(point => point.clone().add(new Vector3(0, 0.05, 0)))), new LineBasicMaterial({ color: 0x62e0b0 })); helpers.add(line); }
  if (drag.cameraId && !drag.drawing) applyCamera(monitor, selectedCamera.value!.view);
}
function pointerUp(event: PointerEvent) {
  if(stageDrag?.pointerId===event.pointerId){stageDrag=undefined;const canvas=event.currentTarget as HTMLCanvasElement;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);return;}
  if (cameraNavigation?.pointerId === event.pointerId) { finishCameraNavigation(); return; }
  if (observerDrag?.pointerId === event.pointerId) { observerDrag=undefined; editCanvas.value?.releasePointerCapture(event.pointerId); return; }
  if (!drag) return; const completed = drag; drag = undefined; editCanvas.value?.releasePointerCapture(event.pointerId);
  if (!completed.moved) {
    if (completed.drawing) {
      const existing = pendingPath.value ? undefined : selectedPath.value;
      if (existing) change(value => { const path = value.state.paths.find(path => path.id === existing.id)!; path.points.push({ x: completed.point.x, y: path.points.at(-1)!.y, z: completed.point.z }); value.state.cameraEdited ||= !!path.cameraId; }, true);
      else if (clickPoint) { completed.points = [clickPoint, completed.point]; completed.moved = true; clickPoint = undefined; }
      else { clickPoint = completed.point; status.value = "起点已选，点击下一点创建路线；继续点击可续点"; }
    }
    if (!completed.moved) return;
  }
  try {
    if (completed.drawing && completed.points!.length >= 2) {
      const start = pendingPath.value?.start ?? Math.min(currentTime.value, draft.value.plan.duration - 0.2);
      if(completed.cameraId) releaseFollow(draft.value,draft.value.state.cameras.find(camera=>camera.id===completed.cameraId)!);
      const height = completed.cameraId ? draft.value.state.cameras.find(camera => camera.id === completed.cameraId)!.view.camera.position.y : (activeOverrides.value.find(entry=>entry.object.threeJsonId===completed.objectId)?.object ?? draft.value.scene.objectList.find(object => object.threeJsonId === completed.objectId)!).position.y;
      const override = activeOverrides.value.find(entry => entry.object.threeJsonId === completed.objectId);
      const targetPaths = override ? (override.paths ??= []) : draft.value.state.paths;
      const retained = [...targetPaths];
      if (override) override.paths = retained; else draft.value.state.paths = retained;
      const pathId=crypto.randomUUID(); selectedPathId.value=pathId;
      (override ? override.paths! : draft.value.state.paths).push({ id: pathId, objectId: completed.objectId, cameraId: completed.cameraId, start, duration: pendingPath.value?.duration ?? Math.min(4, draft.value.plan.duration - start), points: completed.points!.map(point => ({ x: point.x, y: height, z: point.z })) });
      draft.value.state.cameraEdited ||= !!completed.cameraId;
    }
    const override = activeOverrides.value.find(entry => entry.object.threeJsonId === objectId.value);
    if (override && (completed.pathId || completed.drawing)) {
      const working = materializePrevisObject(clone(draft.value),currentShot.value.id,objectId.value); working.plan = compilePrevisPlan(working);
      draft.value = scopePrevisDraft(completed.before,working,{snapshot:completed.before,instruction:"",objectId:objectId.value,time:currentTime.value,scope:"shot",shotId:currentShot.value.id,start:currentShot.value.start,end:shotEnd.value});
    }
    const next = clone(draft.value); validatePrevisLocks(completed.before, next); next.plan = compilePrevisPlan(next); draft.value = normalizePrevisSnapshot(next);
    if(pendingPath.value){pendingPath.value=undefined;mode.value="select";status.value="人物路线已添加到时间线";}
    undoStack.value = [...undoStack.value.slice(-49), completed.before]; redoStack.value = []; void rebuild(); void persist();
  } catch (reason) { draft.value = completed.before; report(reason); void rebuild(); }
}
function pointerCancel() { stageDrag=undefined; finishCameraNavigation(false); observerDrag=undefined; if (!drag) return; draft.value = drag.before; drag = undefined; void rebuild(); }
function openTerrain() { if (busy.value) return; cancelAi(); error.value = ""; playing.value = false; terrainOpen.value = true; }
function cancelTerrain() { aiController?.abort(); aiBusy.value = false; }
function discardTerrain() { terrainPreview.value = undefined; discardAi(); }
function closeTerrain() { cancelTerrain(); discardTerrain(); terrainOpen.value = false; }
function applyTerrain() { if (!terrainPreview.value) return; applyAi(); terrainPreview.value = undefined; terrainOpen.value = false; }
function frameTerrain() {
  const set = terrainPreview.value; if (!set || !runtime || !controls) return;
  mode.value = "observe"; controls.enabled = false;
  controls.target.set(set.anchor.x, set.anchor.y + Math.min(set.width,set.depth)*.1, set.anchor.z);
  const distance = Math.max(set.width,set.depth); runtime.camera.position.set(set.anchor.x + distance*.75,set.anchor.y + distance*.65,set.anchor.z + distance*.8); controls.update();
}
async function generateTerrain(terrain: TerrainRequest, instruction: string) {
  if (busy.value) return;
  const source = clone(draft.value), stamp = JSON.stringify(source), controller = new AbortController(); aiController = controller;
  aiBusy.value = true; error.value = ""; playing.value = false;
  try {
    const value = await props.requestAi({ snapshot: source, instruction, terrain, scope: "scene", time: currentTime.value, signal: controller.signal });
    if (controller.signal.aborted || destroyed) return;
    if (JSON.stringify(clone(draft.value)) !== stamp) throw new Error("场景已变化，请重新生成场地；没有覆盖当前内容");
    const next = normalizePrevisSnapshot(value); next.plan = compilePrevisPlan(next);
    const set = next.state.terrainSets?.find(entry => terrainKey(entry.reference) === terrainKey(terrain.reference));
    if (!set) throw new Error("总 Agent 没有提交有效场地布局，原场景保留");
    aiPreview.value = next; terrainPreview.value = set; await rebuild(next); frameTerrain();
  } catch (reason) { if (!controller.signal.aborted) report(reason); }
  finally { if (aiController === controller) aiBusy.value = false; }
}
function setBakeOption(key: "enabled" | "strength", value: boolean | number) {
  change(next => { const bake = next.scene.studio?.bake; if (!bake) return; if (key === "enabled") bake.enabled = value === true; else bake.strength = Number(value); });
}
async function startBake(options: StageBakeOptions) {
  if (busy.value) return;
  if (draft.value.state.shotOverrides?.some(entry => canBakeObject(entry.object))) { report(new Error("场景或道具存在镜头专属覆盖，请先统一这些对象的布局后烘焙；人物覆盖不受影响")); return; }
  const source = clone(draft.value), stamp = JSON.stringify(source), controller = new AbortController();
  bakeController = controller; baking.value = true; playing.value = false; error.value = ""; bakeProgress.value = "准备 Blender 烘焙…";
  try {
    const bake = await props.bakeScene(source,options,controller.signal,value => { bakeProgress.value = value; });
    if (controller.signal.aborted || destroyed) return;
    if (JSON.stringify(clone(draft.value)) !== stamp) throw new Error("烘焙期间场景已变化，结果未覆盖当前内容，请重新烘焙");
    if (!isStageBake(bake)) throw new Error("烘焙结果无效");
    baking.value = false;
    // All geometry and colors remain in the source object list; only cache metadata changes.
    change(next => { next.scene.studio ??= {clayEnvironment:true,lighting:"daylight",renderer:"eevee"}; next.scene.studio.bake = bake; next.scene.studio.renderer = "eevee"; });
    bakeProgress.value = "烘焙完成 · " + bake.objects.length + " 个场景 / 道具，人物未参与";
  } catch (reason) { if (!controller.signal.aborted) { report(reason); bakeProgress.value = "烘焙失败，原模型保留"; } else bakeProgress.value = "已取消烘焙"; }
  finally { if (bakeController === controller) { baking.value = false; bakeController = undefined; } }
}
async function matchBakeReference(reference: TerrainReference) {
  if (busy.value) return;
  const source = clone(draft.value), stamp = JSON.stringify(source), controller = new AbortController();
  aiController = controller; aiBusy.value = true; playing.value = false; error.value = "";
  aiOpen.value = true; terrainOpen.value = false; rightFolded.value = false; chatDetails.value = true;
  try {
    const value = await props.requestAi({ snapshot: source, lookReference: reference, instruction: "匹配参考图中的光照方向、冷暖和阴影柔和程度；保留当前模型和材质模式，人物不烘焙。", scope: "scene", time: currentTime.value, signal: controller.signal });
    if (controller.signal.aborted || destroyed) return;
    if (JSON.stringify(clone(draft.value)) !== stamp) throw new Error("场景已变化，请重新匹配参考图");
    const next = normalizePrevisSnapshot(value); next.plan = compilePrevisPlan(next); aiPreview.value = next;
    aiSummary.value = "参考图光影预览：仅调整灯光与环境材质参数，人物、场景布局、机位和动画保持不变。应用后可回到烘焙面板计算 AO。";
    await rebuild(next);
  } catch (reason) { if (!controller.signal.aborted) report(reason); }
  finally { if (aiController === controller) aiBusy.value = false; }
}
async function generateAi() {
  if (aiBusy.value || !instruction.value.trim()) return;
  const source = clone(draft.value); const stamp = JSON.stringify(source); aiController = new AbortController(); const controller = aiController;
  aiBusy.value = true; error.value = "";
  try {
    const value = await props.requestAi({ snapshot: source, scenario: scenarioMode.value, scope: scenarioMode.value ? "scene" : aiScope.value, shotId: currentShot.value.id, start: currentShot.value.start, end: shotEnd.value, readOnly: readOnly.value, instruction: instruction.value, objectId: scenarioMode.value ? undefined : objectId.value, cameraId: scenarioMode.value || objectId.value ? undefined : cameraId.value, time: currentTime.value, signal: controller.signal });
    if (controller.signal.aborted || destroyed) return;
    if (JSON.stringify(clone(draft.value)) !== stamp) throw new Error("场景已变化，请重新生成修改预览");
    if (readOnly.value) { status.value = "动作说明已返回原总 Agent 对话"; return; }
    const next = normalizePrevisSnapshot(value); next.plan = compilePrevisPlan(next); aiPreview.value = next;
    const changed = next.scene.objectList.filter(object => JSON.stringify(object) !== JSON.stringify(source.scene.objectList.find(previous => previous.threeJsonId === object.threeJsonId))).map(object => object.name || object.threeJsonId);
    const overrides = (next.state.shotOverrides ?? []).filter(entry => JSON.stringify(entry) !== JSON.stringify(source.state.shotOverrides?.find(previous => previous.shotId === entry.shotId && previous.object.threeJsonId === entry.object.threeJsonId))).map(entry => {
      const shots = [...next.state.shots].sort((a,b) => a.start-b.start);
      const index = shots.findIndex(shot => shot.id === entry.shotId);
      return `${entry.object.name || entry.object.threeJsonId}（镜头${index + 1}覆盖）`;
    });
    aiSummary.value = `变化对象：${[...changed, ...overrides].join('、') || '仅轨道或机位变化'}；动作 ${source.state.actions.length} → ${next.state.actions.length}，路线 ${source.state.paths.length} → ${next.state.paths.length}，机位 ${source.state.cameras.length} → ${next.state.cameras.length}，镜头 ${source.state.shots.length} → ${next.state.shots.length}`;
    await rebuild(next);
  } catch (reason) { if (!controller.signal.aborted) report(reason); }
  finally { if (aiController === controller) aiBusy.value = false; }
}
function cancelAi() { aiController?.abort(); aiBusy.value = false; aiOpen.value = false; terrainOpen.value = false; terrainPreview.value = undefined; if (aiPreview.value) discardAi(); }
function discardAi() { aiPreview.value = undefined; void rebuild(); }
function applyAi() { if (!aiPreview.value) return; undoStack.value = [...undoStack.value.slice(-49), clone(draft.value)]; redoStack.value = []; draft.value = clone(aiPreview.value); aiPreview.value = undefined; aiOpen.value = false; void rebuild(); void persist(); }
function applyExternal() { if (!externalPreview.value) return; undoStack.value = [...undoStack.value.slice(-49), clone(externalPreview.value)]; externalPreview.value = undefined; void persist(); }
function cancelExternal() { if (!externalPreview.value) return; draft.value = clone(externalPreview.value); externalPreview.value = undefined; emit("discard"); void rebuild(); }
async function render(still = false) { rendering.value = true; error.value = ""; try { const snapshot = clone(draft.value); snapshot.plan = compilePrevisPlan(snapshot); if (![renderWidth.value, renderHeight.value].every(value => Number.isInteger(value) && value >= 64 && value <= 1920 && value % 2 === 0)) throw new Error("宽和高必须是64到1920之间的偶数"); if (!Number.isInteger(renderFps.value) || renderFps.value < 1 || renderFps.value > 60) throw new Error("帧率必须是1到60之间的整数"); if (renderWidth.value * renderHeight.value > 2073600) throw new Error("输出最多2073600像素"); const result = await props.renderBlender(snapshot, { width: renderWidth.value, height: renderHeight.value, fps: renderFps.value, frameTime: still ? currentTime.value : undefined }); status.value = `已提交 Blender 渲染${result && typeof result === 'object' && 'jobId' in result ? ` · ${result.jobId}` : ''}`; } catch (reason) { report(reason); } finally { rendering.value = false; } }
async function cancelRender() { try { await props.renderBlender(clone(draft.value), { width: renderWidth.value, height: renderHeight.value, fps: renderFps.value, cancel: true }); status.value = "已请求取消渲染"; } catch (reason) { report(reason); } }
function setAspect(value:string) {
  const size=({"16:9":[1280,720],"9:16":[720,1280],"1:1":[1024,1024],"4:3":[1280,960],"2.39:1":[1720,720]} as Record<string,number[]>)[value];
  if(size){renderWidth.value=size[0]!;renderHeight.value=size[1]!;}
}
async function captureFrame(publish:boolean) {
  if(busy.value || building || !runtime || !renderer || !monitorCanvas.value)return;
  exportBusy.value=true;playing.value=false;error.value="";
  try {
    const width=renderWidth.value,height=renderHeight.value;
    if(![width,height].every(size=>Number.isInteger(size)&&size>=64&&size<=1920&&size%2===0)||width*height>2073600)throw new Error("请设置有效输出尺寸（64～1920 偶数，总像素不超过 2073600）");
    const target=document.createElement("canvas");target.width=width;target.height=height;
    const context=target.getContext("2d");if(!context)throw new Error("当前设备不能创建截图");
    const hidden=runtime.scene.children.filter(child=>child===helpers || child.type==="GridHelper" || child===transform?.getHelper()).map(child=>({child,visible:child.visible}));
    const ratio=renderer.getPixelRatio();
    try { animation?.setTime(currentTime.value);if(motion)sampleMotion(monitor,motion,currentTime.value);if(monitorSelection.value && selectedCamera.value)applyCamera(monitor,sampleCameraView(draft.value,activePlan,cameraId.value,currentTime.value,samplePrevisPath));hidden.forEach(({child})=>child.visible=false);monitor.aspect=width/height;monitor.updateProjectionMatrix();renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.render(runtime.scene,monitor);context.drawImage(monitorCanvas.value,0,0,width,height); }
    finally {hidden.forEach(({child,visible})=>child.visible=visible);renderer.setPixelRatio(ratio);resize();}
    const blob=await new Promise<Blob>((resolve,reject)=>target.toBlob(value=>value?resolve(value):reject(new Error("截图生成失败")),"image/png"));
    if(publish){if(!props.publishFrame)throw new Error("当前入口未连接普通画布");const canvas=await props.publishFrame(blob);status.value=`已加入画布：${canvas}，关闭片场后切回画布查看`;}
    else {const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`虚拟片场-${currentTime.value.toFixed(2)}秒.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status.value="已下载实时预演画面；正式光影以 Blender 输出为准";}
  } catch(reason){report(reason);} finally{exportBusy.value=false;}
}
async function sendVideoToCanvas(){if(busy.value)return;exportBusy.value=true;try{if(!props.publishVideo)throw new Error("当前入口未连接普通画布");const canvas=await props.publishVideo();status.value=`视频已加入画布：${canvas}`;}catch(reason){report(reason);}finally{exportBusy.value=false;}}
async function downloadScene() { try { await props.exportScene(); } catch (reason) { report(reason); } }
function exportHandoff() {
  const packageData = { format:'Lum Virtual Stage',version:1,name:draft.value.plan.name,duration:draft.value.plan.duration,
    purpose:'使用预演视频作为构图、人物走位、摄影机运动与剪辑节奏参考。场景白模只约束空间结构；人物和道具的彩色简模用于身份区分，最终外观以原资产图片为准。按所选视频模型支持的参考输入使用，不能假定所有模型支持视频控制。',
    script:props.scriptSources, references:props.assetSources ?? [], referenceNote:'图片路径相对于当前项目。请随项目备份保留原资产图片；该说明文件不内嵌图片。', objects:draft.value.scene.objectList.map(object=>({id:object.threeJsonId,name:object.name,role:objectKind(object),color:object.material.color,appearance:object.appearance,attachment:object.attachment})),
    cameras:draft.value.state.cameras,shots:draft.value.state.shots,paths:draft.value.state.paths,actions:draft.value.state.actions };
  const url=URL.createObjectURL(new Blob([JSON.stringify(packageData,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='虚拟片场-AI视频制作说明.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function onKey(event: KeyboardEvent) {
  const target=event.target as HTMLElement;
  if(event.key==="Escape" && monitorDrag){event.preventDefault();cancelMonitorDrag();return;}
  if(event.key==="Escape" && cameraCardDrag.value){event.preventDefault();cancelCameraPointer();return;}
  if(event.isComposing || target.closest("input:not([type='range']), textarea, select, [contenteditable='true'], [role='textbox']") || (target.matches("input[type='range']")&&target.getAttribute("aria-label")!=="播放位置"))return;
  if(event.key==="Escape" && transform?.dragging) { transform.reset(); transformStart=undefined; return; }
  if(event.key==="Escape"){pointerCancel();cancelAi();if(props.virtualStage){if(stageView.value==="camera")stageView.value="stage";else stagePane.value="none";}setMode("select");return;}
  if(props.virtualStage && event.altKey && ["Digit1","Digit2","Digit3","Digit4"].includes(event.code)){event.preventDefault();if(event.code==="Digit3")enterCameraView();else{stageView.value="stage";setMode(event.code==="Digit2"?"observe":event.code==="Digit4"?"path":"select");}return;}
  if((event.ctrlKey||event.metaKey)&&(event.code==="KeyZ"||event.key.toLowerCase()==="z")){event.preventDefault();if(cameraNavigation){finishCameraNavigation(false);return;}if(!timelineDragging.value&&!drag){event.shiftKey?redo():undo();}return;}
  if(props.virtualStage && (target===editCanvas.value || (props.virtualStage && stageView.value==="camera" && target===monitorCanvas.value)) && mode.value==="observe" && ["KeyW","KeyA","KeyS","KeyD","KeyQ","KeyE","ShiftLeft","ShiftRight"].includes(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey){event.preventDefault();movementKeys.add(event.code);return;}
  if (props.virtualStage && (target === editCanvas.value || (props.virtualStage && stageView.value === "camera" && target === monitorCanvas.value)) && !event.repeat && !transform?.dragging) {
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') { event.preventDefault(); duplicateObject(); return; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.code === "KeyH") { event.preventDefault(); stageView.value="stage";setMode("observe");return; }
      if (event.code === "KeyO") { event.preventDefault(); stageView.value="stage";topView();return; }
      if (event.code === "KeyF") { event.preventDefault(); focusObject(); return; }
      if (event.code === 'Delete') { event.preventDefault(); deleteObject(); return; }
      const tool = { KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale' } as const;
      if (event.code in tool) { event.preventDefault(); setTransformMode(tool[event.code as keyof typeof tool]); return; }
    }
  }
  if(event.ctrlKey||event.metaKey||event.altKey||timelineDragging.value)return;
  if(!drag && (target===editCanvas.value || (props.virtualStage && stageView.value==="camera" && target===monitorCanvas.value))){
    const horizontal=event.key==="ArrowLeft"||event.code==="Numpad4"?-1:event.key==="ArrowRight"||event.code==="Numpad6"?1:0;
    const vertical=event.key==="ArrowUp"||event.code==="Numpad8"?1:event.key==="ArrowDown"||event.code==="Numpad2"?-1:0;
    if(horizontal||vertical){
      event.preventDefault();
      playing.value = false;
      if (mode.value === "select") { const step = event.shiftKey ? .8 : .2; moveSelectedCamera(horizontal * step, vertical * step, 0, "key"); return; }
      if(mode.value==="path" && runtime && controls){
        const step=Math.max(.05,runtime.camera.position.distanceTo(controls.target)*.02)*(event.shiftKey?3:1);
        const delta=new Vector3().setFromMatrixColumn(runtime.camera.matrixWorld,0).multiplyScalar(horizontal*step).addScaledVector(new Vector3().setFromMatrixColumn(runtime.camera.matrixWorld,1),vertical*step);
        if(runtime.camera.position.clone().add(delta).length()<9000){runtime.camera.position.add(delta);controls.target.add(delta);controls.update();}
      }else{const step=event.shiftKey ? .8 : .2;moveObserver(horizontal*step,vertical*step,0);}
      return;
    }
  }
  if(drag || cameraNavigation)return;
  if(event.code==="Space"){event.preventDefault();if(!event.repeat)togglePlayback();return;}
  if((event.code==="KeyZ"||event.code==="KeyR")&&!event.shiftKey){event.preventDefault();if(!event.repeat){event.code==="KeyZ"?splitTimelineClip():deleteTimelineClip();}return;}
  const direction=event.key==="ArrowLeft"||event.code==="Numpad4"?-1:event.key==="ArrowRight"||event.code==="Numpad6"?1:0;
  if(direction){event.preventDefault();const fps=Number.isInteger(renderFps.value)&&renderFps.value>=1&&renderFps.value<=60?renderFps.value:24;const frame=currentTime.value*fps;seek(event.shiftKey?currentTime.value+direction:(direction>0?Math.floor(frame+1e-7)+1:Math.ceil(frame-1e-7)-1)/fps);}
}
watch(()=>currentShot.value.id,id=>{if((timelineSelection.value?.kind==="action"||timelineSelection.value?.kind==="path")&&timelineSelection.value.shotId!==id)timelineSelection.value=undefined;});
watch([()=>draft.value.state.shots,visibleActions,visiblePaths],()=>{const selected=timelineSelection.value;if(selected&&!(selected.kind==="shot"?draft.value.state.shots:selected.kind==="path"?visiblePaths.value:visibleActions.value).some(clip=>clip.id===selected.id))timelineSelection.value=undefined;},{deep:true});
const exitPrompt = ref(false);
async function finishAndClose(apply: boolean) {
  if (apply) { if (aiPreview.value) applyAi(); if (externalPreview.value) applyExternal(); }
  else { if (externalPreview.value) cancelExternal(); cancelAi(); }
  bakeController?.abort(); baking.value = false;
  exitPrompt.value = false;
  await close();
}
async function tryClose() {
  if (aiBusy.value || baking.value || aiPreview.value || externalPreview.value) { exitPrompt.value = true; return false; }
  if (rendering.value || exportBusy.value) { status.value = "正在提交或导出视频，完成后即可退出"; return false; }
  if (transform?.dragging) { transform.reset(); transformStart=undefined; }
  pointerCancel(); finishCameraNavigation(); closeTerrain();
  await persist();
  if (error.value || saving.value) return false;
  cancelAi();
  return true;
}
async function close() { if (!await tryClose()) return; emit("close"); }
defineExpose({ tryClose });
watch(() => props.renderStatus, value => { if (value) status.value = value; });
watch(() => currentShot.value.id, () => { createHelpers(); });
watch(() => props.snapshot, value => { const next = normalizePrevisSnapshot(clone(value)); if (JSON.stringify(next) === JSON.stringify(clone(draft.value))) return; finishCameraNavigation(false); cancelAi(); externalPreview.value = props.baseline ? clone(props.baseline) : externalPreview.value ?? clone(draft.value); draft.value = next; undoStack.value = []; redoStack.value = []; objectId.value = undefined; cameraId.value = next.state.cameras[0]!.id; void rebuild(); }, { deep: true });
watch(viewGrid,value=>{if(runtime)applySceneSettings(runtime,{gridVisible:value,skyVisible:false});});
watch([stageView,timelineCollapsed,headerFolded,railFolded,rightFolded,viewFolded,monitorFolded,timelineHidden,chatFolded,renderWidth,renderHeight,monitorGrid],()=>nextTick(resize));
function notifyStagePresentation(open: boolean) {
  if (!props.virtualStage || window.parent === window) return;
  const hostOrigin = URL.canParse(document.referrer) ? new URL(document.referrer).origin : "";
  if (["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(hostOrigin)) window.parent.postMessage({ type: "lum:stagePresentation", open }, hostOrigin);
}
onMounted(() => { window.addEventListener("blur", cancelCameraNavigation); notifyStagePresentation(true); });
onBeforeUnmount(() => notifyStagePresentation(false));
onBeforeUnmount(() => { window.removeEventListener("blur", cancelCameraNavigation); finishCameraNavigation(false); });
onMounted(() => { if (!monitorCanvas.value) return; try { renderer = new WebGLRenderer({ canvas: monitorCanvas.value, antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); resizeObserver = new ResizeObserver(resize); resizeObserver.observe(editCanvas.value!); resizeObserver.observe(monitorCanvas.value.parentElement!); void rebuild(); frameId = requestAnimationFrame(frame); } catch (reason) { report(reason); } });
onBeforeUnmount(() => { destroyed = true; bakeController?.abort(); buildVersion++; aiController?.abort(); cancelAnimationFrame(frameId); resizeObserver?.disconnect(); transform?.dispose(); controls?.dispose(); animation?.dispose(); clearHelpers(); if (runtime) disposeStage(runtime); renderer?.dispose(); renderer?.forceContextLoss(); });
</script>

<style scoped>
.frameOverlay { position:absolute; inset:0; z-index:5; background:#080b11ed; display:flex; align-items:center; justify-content:center; padding:50px 20px 20px; }.frameOverlay > button { position:absolute; right:20px; top:12px; }.frameOverlay img { max-width:100%; max-height:100%; object-fit:contain; }
.aiPanel { max-height: calc(100% - 260px); overflow-y: auto; }.aiPanel .aiError, .errorText { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto; }.aiPanel .aiError { color: #ffc9cd; background: #502d35; border-radius: 6px; padding: 10px; }.aiPanel .targetHint { border-left: 3px solid #7aa9df; padding-left: 8px; }
.exitOverlay { position:absolute; inset:0; z-index:50; display:grid; place-items:center; background:#0005; backdrop-filter:blur(6px); }
.exitCard { width:min(460px,calc(100% - 32px)); box-sizing:border-box; border:1px solid var(--stageLine,#ffffff66); border-radius:18px; padding:22px; color:#fff; background:var(--stageGlass,#454545e6); backdrop-filter:var(--stageFrost,blur(20px)); box-shadow:0 12px 42px #0006; }
.exitCard strong { font-size:18px; }.exitCard p { line-height:1.6; }.exitCard .buttonRow { flex-wrap:wrap; justify-content:flex-end; }
.previsEditor { position: fixed; inset: 3vh 2vw; z-index: 10000; display: flex; flex-direction: column; min-width: 0; background: #171b24; color: #e3e8f2; border: 1px solid #45516b; border-radius: 14px; box-shadow: 0 20px 80px #0009; font: 13px/1.45 system-ui, sans-serif; overflow: hidden; }
.topBar, .buttonRow, .viewToolbar, .playBar, .shotRow, .actionRow { display: flex; align-items: center; gap: 7px; }
.topBar { padding: 12px 16px; background: #232a38; }.topBar strong { font-size: 17px; }.statusText { flex: 1; color: #a7b6ce; }
button, input, select, textarea { font: inherit; color: inherit; border: 1px solid #46516a; border-radius: 6px; background: #242d3d; padding: 6px 8px; box-sizing: border-box; }
button { cursor: pointer; } button:hover { background: #344560; } button:disabled { opacity: .45; cursor: default; } button.selected { border-color: #85b7ff; background: #314e75; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #8dc3ff; outline-offset: 1px; }
.workArea { display: flex; flex: 1; min-height: 0; }.assetPanel { width: 176px; flex-shrink: 0; overflow: auto; padding: 12px; border-right: 1px solid #343e51; }.assetPanel > button { display: block; width: 100%; text-align: left; margin-bottom: 7px; }
.assetGroup{border-top:1px solid #343e51;margin-top:10px;padding-top:4px}.assetGroup summary{cursor:pointer;padding:8px 2px;color:#c3d2e7;font-weight:600;user-select:none}.assetGroup>button{display:block;width:100%;text-align:left;margin-bottom:7px}.assetGroup .buttonRow{margin:7px 0}
h3 { font-size: 13px; color: #a7bbd8; margin: 14px 0 8px; }.assetPanel h3:first-child { margin-top: 0; }.viewArea { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 10px; gap: 8px; }.viewToolbar { flex-wrap: wrap; }.canvasWrap { position: relative; flex: 1; min-height: 130px; background: #202024; border-radius: 8px; overflow: hidden; }.canvasWrap canvas { display: block; width: 100%; height: 100%; touch-action: none; }.canvasLabel { position: absolute; top: 7px; left: 9px; font-size: 11px; background: #111a; padding: 4px 7px; border-radius: 5px; pointer-events: none; }
.monitorWrap { position: relative; width: min(100%, 400px); aspect-ratio: 16 / 9; max-height: 30vh; background: #080b11; align-self: center; border: 1px solid #46516a; border-radius: 6px; overflow: hidden; }.monitorWrap canvas { display: block; width: 100%; height: 100%; }
.routeNotice{margin:0;padding:7px;background:#2e4255;border-radius:5px}
.propertyGroup{border-bottom:1px solid #46516a;padding-bottom:8px}.propertyGroup summary{cursor:pointer;font-weight:600;padding:8px 0}.propertyGroup>button{width:100%;margin:5px 0}
.propertyPanel { width: 220px; flex-shrink: 0; border-left: 1px solid #343e51; padding: 10px 12px; overflow: auto; }.propertyPanel label { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 7px 0; }.propertyPanel input, .propertyPanel select { min-width: 0; width: 122px; }.propertyPanel > button, .propertyPanel > select { width: 100%; margin: 5px 0; }.propertyPanel .buttonRow label { display: block; width: 50%; }.propertyPanel .buttonRow input { width: 100%; }.propertyPanel p { color: #acb7ca; font-size: 12px; }
.timelinePanel { padding: 10px 14px; border-top: 1px solid #3b455b; max-height: 300px; overflow: auto; background: #1d2430; flex-shrink:0; }.playBar { white-space: nowrap; }.playBar input[type=range] { flex: 1; min-width: 80px; }.shotRow, .actionRow { margin-top: 8px; flex-wrap: wrap; }.shotChip, .actionChip { display: flex; gap: 3px; background: #293c53; padding: 4px; border-radius: 6px; }.shotChip input, .actionChip input { width: 67px; }.shotChip select { max-width: 115px; }.actionChip { background: #26483f; }
.errorText { margin: 0; padding: 8px 16px; background: #502d35; color: #ffc9cd; }.previewNotice { padding: 7px 16px; background: #3d4632; }.aiPanel { position: absolute; right: 250px; bottom: 198px; width: 330px; max-width: 45vw; padding: 15px; background: #202a3a; border: 1px solid #7aa9df; box-shadow: 0 10px 35px #0008; border-radius: 12px; }.aiPanel .buttonRow { justify-content: space-between; }.aiPanel p { color: #b9c7de; }.aiPanel textarea { width: 100%; resize: vertical; margin-bottom: 9px; }
@media (max-width: 1000px) { .assetPanel { width: 130px; }.propertyGroup{border-bottom:1px solid #46516a;padding-bottom:8px}.propertyGroup summary{cursor:pointer;font-weight:600;padding:8px 0}.propertyGroup>button{width:100%;margin:5px 0}
.propertyPanel { width: 180px; }.propertyPanel input { width: 92px; }.aiPanel { right: 210px; }.previsEditor { inset: 1vh 1vw; } }
.previsEditor, .assetPanel, .propertyPanel, .aiPanel { box-sizing: border-box; }
.topBar, .buttonRow, .playBar { flex-wrap: wrap; }.topBar { flex-shrink: 0; }.statusText { min-width: 0; flex: 1 1 160px; overflow-wrap: anywhere; }
.workArea { overflow: auto; }.viewArea { min-width: 220px; }.assetPanel button, .propertyPanel button, .aiPanel button { max-width: 100%; white-space: normal; overflow-wrap: anywhere; min-height: 32px; }
.assetPanel, .propertyPanel { overflow-wrap: anywhere; }.propertyPanel label { flex-wrap: wrap; min-width: 0; }.propertyPanel label > input, .propertyPanel label > select { max-width: 100%; margin-left: auto; }.propertyPanel .buttonRow label { flex: 1 1 70px; width: auto; }.propertyPanel .buttonRow input { min-width: 0; }
.aiPanel p, .previewNotice, .canvasLabel { overflow-wrap: anywhere; }.canvasLabel { max-width: calc(100% - 18px); box-sizing: border-box; }.shotChip, .actionChip { max-width: 100%; flex-wrap: wrap; }.playBar { white-space: normal; }
.assetPanel.skillsExpanded { width: 300px; }.aiPanel:has(textarea:not(:placeholder-shown)) { width: 440px; }

.virtualStageEditor { --stageGlass:color-mix(in srgb,var(--el-bg-color,#202733) 88%,transparent);--stageLine:var(--el-border-color,#657187);inset:10px;display:flex;flex-direction:column;overflow:hidden;background:var(--el-bg-color,#202733);color:var(--el-text-color-primary,#e3e8f2);border:1px solid var(--stageLine);border-radius:20px;box-shadow:0 18px 70px #0005; }
.virtualStageEditor button,.virtualStageEditor input,.virtualStageEditor select,.virtualStageEditor textarea { border-radius:10px;border-color:var(--stageLine);background:var(--el-fill-color-light,#2e394b);color:inherit; }
.virtualStageEditor button:hover:not(:disabled) { background:var(--el-fill-color,#3c4a60);border-color:var(--el-color-primary,#a4bdf3); }
.virtualStageEditor button:focus-visible,.virtualStageEditor input:focus-visible,.virtualStageEditor select:focus-visible,.virtualStageEditor textarea:focus-visible { outline:2px solid var(--el-color-primary,#9dbdff);outline-offset:2px; }
.virtualStageEditor .topBar { min-height:56px;box-sizing:border-box;padding:10px 16px;gap:8px;background:var(--stageGlass);border-bottom:1px solid var(--stageLine);z-index:8; }
.virtualStageEditor .topBar>strong { font-size:14px;letter-spacing:.08em; }.virtualStageEditor .stageName { width:min(200px,22vw); }
.virtualStageEditor .statusText { font-size:11px;max-height:34px;overflow:auto; }
.virtualStageEditor .workArea { position:relative;flex:1;min-height:230px;overflow:hidden;background:var(--el-fill-color,#dfe4e8); }
.virtualStageEditor .viewArea { position:absolute;inset:0;display:block;padding:0;min-width:0;overflow:hidden; }
.virtualStageEditor .canvasWrap { position:absolute;inset:0;min-height:0;margin:0;border:0;border-radius:0; }
.virtualStageEditor .canvasWrap>canvas { width:100%;height:100%;display:block; }
.virtualStageEditor .canvasWrap>.canvasLabel { left:86px;right:350px;bottom:8px;top:auto;max-width:none;background:#1c2633df;color:#f1f5fc;border:1px solid #ffffff35;border-radius:10px;font-size:10px;pointer-events:none; }
.virtualStageEditor .stageRail { position:absolute;z-index:5;left:12px;top:14px;bottom:14px;width:58px;display:flex;flex-direction:column;align-items:stretch;gap:5px;overflow:auto;padding:6px;box-sizing:border-box;border:1px solid var(--stageLine);border-radius:18px;background:var(--stageGlass);backdrop-filter:blur(22px);box-shadow:0 5px 20px #0002; }
.virtualStageEditor .stageRail button { display:flex;align-items:center;justify-content:center;flex-direction:column;gap:3px;min-height:52px;padding:5px 0;border:1px solid transparent;background:transparent; }.virtualStageEditor .stageRail button span { font-size:9px;white-space:nowrap; }.virtualStageEditor .stageRail button[aria-pressed=true] { border-color:var(--el-color-primary,#a4bdf3);background:var(--el-color-primary-light-9,#3d506e); }.railDivider { border-top:1px solid var(--stageLine);margin:5px; }
.virtualStageEditor .stageViewTabs { position:absolute;z-index:4;top:14px;left:86px;display:flex;gap:4px;padding:5px;background:var(--stageGlass);border:1px solid var(--stageLine);border-radius:14px;backdrop-filter:blur(22px); }.virtualStageEditor .stageViewTabs button { padding:7px 10px;border-color:transparent;background:transparent;font-size:11px; }
.virtualStageEditor .stageViewTabs button.selected { background:var(--el-fill-color,#4a5a70);border-color:var(--stageLine); }
.virtualStageEditor .viewToolbar { position:absolute;left:86px;top:67px;right:350px;z-index:3;display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:6px;background:var(--stageGlass);border:1px solid var(--stageLine);border-radius:13px;backdrop-filter:blur(22px);max-height:96px;overflow:auto; }
.virtualStageEditor .viewToolbar button { padding:5px 8px;min-height:28px;font-size:10px; }
.virtualStageEditor .monitorTools { position:absolute;z-index:3;left:86px;bottom:190px;width:286px;box-sizing:border-box;padding:8px;background:var(--stageGlass);border:1px solid var(--stageLine);border-radius:12px;backdrop-filter:blur(22px);font-size:10px; }.virtualStageEditor .monitorTools button,.virtualStageEditor .monitorTools select { font-size:10px;padding:5px; }
.virtualStageEditor .monitorWrap { position:absolute;left:86px;bottom:34px;width:286px;height:auto;max-height:150px;min-height:0;align-self:auto;border:2px solid #a7b3c7;border-radius:14px;background:#111822;overflow:hidden;box-shadow:0 8px 24px #0004;z-index:2; }
.virtualStageEditor .monitorWrap { display:flex;align-items:center;justify-content:center; }
.virtualStageEditor .monitorWrap canvas { display:block;width:100%;height:100%; }.virtualStageEditor .monitorWrap .canvasLabel { font-size:9px;color:#f0f3fc;background:#1b2634db;border-radius:7px; }
.virtualStageEditor .assetPanel,.virtualStageEditor .assetPanel.skillsExpanded,.virtualStageEditor .propertyPanel,.virtualStageEditor .stageFloatingPanel,.virtualStageEditor .aiPanel,.virtualStageEditor .aiPanel:has(textarea:not(:placeholder-shown)),.virtualStageEditor :deep(.terrainPanel) { position:absolute;z-index:6;top:14px;bottom:14px;right:14px;left:auto;display:block;width:310px;max-width:calc(100% - 100px);height:auto;max-height:none;min-width:0;margin:0;flex:none;box-sizing:border-box;overflow:auto;padding:16px;border:1px solid var(--stageLine);border-radius:18px;background:var(--stageGlass);color:inherit;backdrop-filter:blur(24px);box-shadow:0 10px 30px #0003; }
.virtualStageEditor :deep(.terrainPanel) { top:84px;bottom:245px; }
.virtualStageEditor .panelTitle { display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--stageLine);padding-bottom:12px;margin-bottom:14px; }.virtualStageEditor .panelTitle>button { flex:none;width:30px;min-height:30px;padding:4px;font-size:18px; }
.virtualStageEditor .environmentPanel label { display:flex;flex-direction:column;gap:7px;margin:16px 0; }.virtualStageEditor .environmentPanel p,.virtualStageEditor .aiPanel p { color:var(--el-text-color-secondary,#aebbd1);line-height:1.6; }
.virtualStageEditor .timelinePanel { box-sizing:border-box;flex:none;max-height:220px;min-height:88px;padding:10px 16px;background:var(--stageGlass);border-top:1px solid var(--stageLine);overflow:auto;z-index:7; }
.virtualStageEditor .timelineHeader { display:flex;align-items:center;gap:12px;font-size:11px;margin-bottom:8px; }.virtualStageEditor .timelineHeader>span { flex:1;color:var(--el-text-color-secondary,#acb8ce); }.virtualStageEditor .timelineHeader>button { padding:3px 10px;min-height:26px; }
.virtualStageEditor.timelineCollapsed .timelinePanel { max-height:108px; }.virtualStageEditor .playBar { gap:7px;font-size:11px; }.virtualStageEditor .playBar>button { padding:5px 8px; }
.virtualStageEditor .routeNotice { position:absolute;z-index:4;left:86px;right:350px;top:165px;border-radius:10px;padding:8px;background:#203f36ed;color:#cffff0; }
.virtualStageEditor .stageOutput { margin:12px 0;padding:8px;border:1px solid var(--stageLine);border-radius:12px; }.stageOutput video { display:block;width:100%;border-radius:10px; }.stageOutput a { display:block;padding:8px;color:var(--el-color-primary,#b3ceff); }
.stageLayouts { padding:10px;border:1px solid var(--stageLine,#7588a780);border-radius:12px;margin:8px 0; }.stageLayouts h3 { margin:0 0 8px; }.stageLayouts select,.stageLayouts button { width:100%;margin:4px 0; }
.virtualStageEditor.cameraView .monitorWrap { left:86px;right:350px;top:67px;bottom:110px;width:auto;max-height:none;aspect-ratio:auto !important;border:1px solid var(--stageLine);background:#111822; }
.virtualStageEditor.cameraView .viewToolbar { display:none; }.virtualStageEditor.cameraView .monitorTools { left:86px;right:350px;bottom:14px;top:auto;width:auto; }
.virtualStageEditor.cameraView .canvasWrap { visibility:hidden; }.virtualStageEditor.cameraView .monitorWrap canvas { object-fit:contain; }
@media(max-width:1050px) { .virtualStageEditor .assetPanel,.virtualStageEditor .assetPanel.skillsExpanded,.virtualStageEditor .propertyPanel,.virtualStageEditor .stageFloatingPanel,.virtualStageEditor .aiPanel,.virtualStageEditor .aiPanel:has(textarea:not(:placeholder-shown)),.virtualStageEditor :deep(.terrainPanel) { width:280px; }.virtualStageEditor .viewToolbar,.virtualStageEditor .canvasWrap>.canvasLabel,.virtualStageEditor .routeNotice,.virtualStageEditor.cameraView .monitorWrap,.virtualStageEditor.cameraView .monitorTools { right:308px; }.virtualStageEditor .monitorWrap,.virtualStageEditor .monitorTools { width:240px; }.virtualStageEditor .stageViewTabs button { font-size:10px;padding:6px; } }
@media(max-height:760px) { .virtualStageEditor .timelinePanel { max-height:178px; }.virtualStageEditor .monitorTools { bottom:136px; }.virtualStageEditor .monitorWrap { width:190px;max-height:96px; }.virtualStageEditor .monitorTools { width:240px; }.virtualStageEditor :deep(.terrainPanel) { bottom:195px; } }
.virtualStageEditor .monitorGrid { inset:auto;left:50%;top:50%;transform:translate(-50%,-50%); }
.virtualStageEditor.stagePanelsClosed .viewToolbar,.virtualStageEditor.stagePanelsClosed .canvasWrap>.canvasLabel,.virtualStageEditor.stagePanelsClosed .routeNotice,.virtualStageEditor.stagePanelsClosed.cameraView .monitorWrap,.virtualStageEditor.stagePanelsClosed.cameraView .monitorTools { right:14px; }
.monitorTools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 2px 6px}.monitorTools label{display:flex;align-items:center;gap:6px}.monitorWrap{position:relative}.monitorGrid{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent calc(33.333% - .5px),#ffffff90 33.333%,transparent calc(33.333% + .5px),transparent calc(66.666% - .5px),#ffffff90 66.666%,transparent calc(66.666% + .5px)),linear-gradient(0deg,transparent calc(33.333% - .5px),#ffffff90 33.333%,transparent calc(33.333% + .5px),transparent calc(66.666% - .5px),#ffffff90 66.666%,transparent calc(66.666% + .5px));}

/* The viewport fills the workspace. All stage chrome floats above it. */
.virtualStageEditor{inset:0;border:0;border-radius:0;--stageTop:82px;--stageBottom:244px;--stageLeft:86px;--stageRight:358px;--stageGlass:rgb(30% 30% 30% / .85);--stageFrost:blur(24px) saturate(.75);--stageLine:#ffffff45;--stageShadow:0 12px 32px #00000038,0 3px 8px #00000020,inset 0 1px #ffffff24;--lum-surface:#4d4d4d;--lum-panel:#414141;--lum-text:#f5f5f5;--lum-muted:#d3d3d3;--lum-input:#3b3b3b;--lum-hover:#5a5a5a;--lum-line:#ffffff40;--lum-accent-soft:#666;--lum-link:#e4f2ff;--lum-strong:#f4f8ff;--el-bg-color:#4d4d4d;--el-fill-color:#666;--el-fill-color-light:#3b3b3b;--el-text-color-primary:#f5f5f5;--el-text-color-secondary:#d3d3d3;--el-color-primary-light-9:#666}
.virtualStageEditor .workArea{position:absolute;inset:0;min-height:0;background:transparent;overflow:hidden}
.virtualStageEditor .topBar{position:absolute;top:12px;left:12px;right:12px;min-height:56px;border:1px solid var(--stageLine);border-radius:16px;backdrop-filter:var(--stageFrost);box-shadow:0 8px 30px #0002;flex-wrap:wrap}
.virtualStageEditor .topBar>strong{flex:none}.virtualStageEditor .topBar .statusText{flex:1;min-width:40px}
.virtualStageEditor .stageRail{top:var(--stageTop);bottom:var(--stageBottom);backdrop-filter:var(--stageFrost)}
.virtualStageEditor .stageRail .railFoldButton{min-height:28px;flex:none;font-size:10px;border-color:var(--stageLine)}
.virtualStageEditor .stageViewTabs{top:var(--stageTop);left:var(--stageLeft);backdrop-filter:var(--stageFrost);max-width:calc(100% - var(--stageLeft) - 44px);flex-wrap:wrap}
.virtualStageEditor .viewToolbar{top:calc(var(--stageTop) + 50px);left:var(--stageLeft);right:var(--stageRight);backdrop-filter:var(--stageFrost)}
.virtualStageEditor .canvasWrap>.canvasLabel{--stageHintInset:max(var(--stageLeft),var(--stageRight));bottom:calc(var(--stageBottom) + 8px);left:50%;right:auto;transform:translateX(-50%);width:max-content;max-width:max(120px,calc(100% - 2*var(--stageHintInset)));padding:0 8px;background:none;border:0;border-radius:0;box-shadow:none;backdrop-filter:none;color:#f7f9fc;text-align:center;font-size:11px;line-height:1.6;text-shadow:0 1px 3px #000,0 0 6px #0009}
.virtualStageEditor .assetPanel,.virtualStageEditor .assetPanel.skillsExpanded,.virtualStageEditor .propertyPanel,.virtualStageEditor .stageFloatingPanel,.virtualStageEditor .aiPanel,.virtualStageEditor .aiPanel:has(textarea:not(:placeholder-shown)),.virtualStageEditor :deep(.terrainPanel){top:var(--stageTop);bottom:var(--stageBottom);right:38px;width:300px;max-width:calc(100% - 86px);backdrop-filter:var(--stageFrost);background:var(--stageGlass);box-shadow:0 12px 36px #0003,inset 0 1px #ffffff25}
.virtualStageEditor .monitorTools{left:var(--stageLeft);bottom:calc(var(--stageBottom) + 180px);backdrop-filter:var(--stageFrost)}
.virtualStageEditor .monitorWrap{left:var(--stageLeft);bottom:calc(var(--stageBottom) + 18px)}
.virtualStageEditor.cameraView .monitorWrap{inset:0;width:100%;height:100%;max-height:none;border:0;border-radius:0;box-shadow:none}
.virtualStageEditor.cameraView .monitorWrap>.canvasLabel{left:var(--stageLeft);top:calc(var(--stageTop) + 52px)}
.virtualStageEditor.cameraView .monitorTools{left:var(--stageLeft);right:var(--stageRight);bottom:calc(var(--stageBottom) + 14px);width:auto}
.virtualStageEditor .timelinePanel{position:absolute;left:12px;right:12px;bottom:12px;max-height:220px;border:1px solid var(--stageLine);border-radius:16px;background:var(--stageGlass);backdrop-filter:var(--stageFrost);box-shadow:0 -8px 30px #0002}
.virtualStageEditor .routeNotice{top:calc(var(--stageTop) + 150px);left:var(--stageLeft);right:var(--stageRight)}
.virtualStageEditor.stageHeaderFolded{--stageTop:44px}.virtualStageEditor.stageRailFolded{--stageLeft:42px}.virtualStageEditor.stagePanelsClosed{--stageRight:42px}.virtualStageEditor.timelineCollapsed{--stageBottom:132px}.virtualStageEditor.stageTimelineHidden{--stageBottom:44px}
.virtualStageEditor.stagePanelsClosed .viewToolbar,.virtualStageEditor.stagePanelsClosed .routeNotice,.virtualStageEditor.stagePanelsClosed.cameraView .monitorTools{right:var(--stageRight)}
.virtualStageEditor.stagePanelsClosed .canvasWrap>.canvasLabel{right:auto}
.virtualStageEditor.stageRightFolded .assetPanel,.virtualStageEditor.stageRightFolded .propertyPanel,.virtualStageEditor.stageRightFolded .stageFloatingPanel,.virtualStageEditor.stageRightFolded .aiPanel,.virtualStageEditor.stageRightFolded :deep(.terrainPanel){display:none!important}
.virtualStageEditor.stageMonitorFolded:not(.cameraView) .monitorWrap{visibility:hidden;pointer-events:none}
.virtualStageEditor .stageEdgeTab{position:absolute;z-index:9;background:var(--stageGlass);backdrop-filter:var(--stageFrost);border:1px solid var(--stageLine);border-radius:12px;box-shadow:0 4px 18px #0003;font-size:11px;padding:8px;color:inherit}
.virtualStageEditor .topEdge{top:3px;left:50%;transform:translateX(-50%)}.virtualStageEditor .bottomEdge{bottom:3px;left:50%;transform:translateX(-50%)}
.virtualStageEditor .leftEdge,.virtualStageEditor .rightEdge{top:50%;transform:translateY(-50%);writing-mode:vertical-rl;min-width:28px;min-height:80px;padding:8px 5px}.virtualStageEditor .leftEdge{left:3px}.virtualStageEditor .rightEdge{right:3px}.virtualStageEditor .rightEdge span{margin-top:6px}
.virtualStageEditor .viewEdge{left:var(--stageLeft);top:var(--stageTop)}.virtualStageEditor .monitorEdge{left:var(--stageLeft);bottom:calc(var(--stageBottom) + 14px)}
.virtualStageEditor input,.virtualStageEditor select,.virtualStageEditor textarea,.virtualStageEditor button{border-radius:10px}
.virtualStageEditor :deep(.timelineEditor input),.virtualStageEditor :deep(.timelineEditor select),.virtualStageEditor :deep(.timelineEditor button),.virtualStageEditor :deep(.shotBlock),.virtualStageEditor :deep(.actionBlock),.virtualStageEditor :deep(.timelineScroll){border-radius:9px}
.virtualStageEditor .cameraHint{font-size:11px;line-height:1.65;color:inherit;opacity:.85}.virtualStageEditor .cameraPreviewGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
.virtualStageEditor .cameraPreviewCard{min-width:0;border:1px solid var(--stageLine);border-radius:12px;padding:5px;background:#00000012;cursor:grab}.virtualStageEditor .cameraPreviewCard.selected{border-color:var(--el-color-primary,#a5c4ff);box-shadow:0 0 0 1px var(--el-color-primary,#a5c4ff)}
.virtualStageEditor .cameraPreviewImage{position:relative;width:100%;padding:0;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#111822;color:white}.virtualStageEditor .cameraPreviewImage img{width:100%;height:100%;object-fit:contain;pointer-events:none}.virtualStageEditor .cameraPreviewImage strong{position:absolute;bottom:0;left:0;right:0;background:#101620b3;padding:5px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.virtualStageEditor .cameraPreviewActions{display:flex;gap:3px;margin-top:5px}.virtualStageEditor .cameraPreviewActions button{font-size:9px;padding:5px 3px;min-width:0;flex:1}.virtualStageEditor .cameraPages{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px}
@media(max-width:1050px){.virtualStageEditor{--stageRight:318px}.virtualStageEditor .assetPanel,.virtualStageEditor .assetPanel.skillsExpanded,.virtualStageEditor .propertyPanel,.virtualStageEditor .stageFloatingPanel,.virtualStageEditor .aiPanel,.virtualStageEditor .aiPanel:has(textarea:not(:placeholder-shown)),.virtualStageEditor :deep(.terrainPanel){width:260px}.virtualStageEditor .topBar{gap:5px}.virtualStageEditor .topBar button{font-size:11px;padding:6px}.virtualStageEditor.stagePanelsClosed{--stageRight:42px}}
@media(max-height:760px){.virtualStageEditor{--stageBottom:198px}.virtualStageEditor.timelineCollapsed{--stageBottom:132px}.virtualStageEditor.stageTimelineHidden{--stageBottom:44px}.virtualStageEditor .monitorTools{bottom:calc(var(--stageBottom) + 120px)}.virtualStageEditor.cameraView .monitorTools{bottom:calc(var(--stageBottom) + 14px)}}

.virtualStageEditor .stageFloatingPanel.multiCameraPanel{left:auto;right:38px;transform:none;width:360px;max-width:calc(100% - 100px)}.virtualStageEditor:has(.multiCameraPanel):not(.stageRightFolded){--stageRight:418px}.virtualStageEditor .cameraStack .cameraPreviewGrid{grid-template-columns:minmax(0,1fr)}.virtualStageEditor .cameraStack .cameraPreviewActions button{font-size:11px}.virtualStageEditor .cameraLayoutChoice{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;margin-top:10px}.virtualStageEditor .cameraPreviewCard img{max-height:200px}

.virtualStageEditor{--stageChatLift:66px;--stageBottom:calc(244px + var(--stageChatLift))}.virtualStageEditor.timelineCollapsed{--stageBottom:calc(132px + var(--stageChatLift))}.virtualStageEditor.stageTimelineHidden{--stageBottom:calc(44px + var(--stageChatLift))}.virtualStageEditor.stageChatFolded{--stageChatLift:26px}
.virtualStageEditor .timelinePanel{left:50%;right:auto;transform:translateX(-50%);width:min(1080px,calc(100% - 100px));bottom:calc(12px + var(--stageChatLift));border-radius:18px}
.virtualStageEditor .bottomEdge{bottom:calc(6px + var(--stageChatLift))}
.virtualStageEditor .stageChatDock{position:absolute;z-index:8;bottom:12px;left:50%;transform:translateX(-50%);width:min(720px,calc(100% - 100px));min-height:50px;display:flex;align-items:center;gap:8px;padding:8px 12px;box-sizing:border-box;border:1px solid var(--stageLine);border-radius:22px;background:var(--stageGlass);backdrop-filter:var(--stageFrost);box-shadow:0 8px 30px #0003}
.virtualStageEditor .stageChatDock textarea{flex:1;width:0;min-width:0;min-height:30px;max-height:64px;resize:none;box-sizing:border-box;margin:0;padding:7px 4px;border:0;background:transparent;line-height:1.5;color:inherit;font-size:12px}.virtualStageEditor .stageChatDock textarea::placeholder{color:inherit;opacity:.72}.virtualStageEditor .stageChatDock button{flex:none;padding:7px 9px;border-radius:12px;min-height:32px;font-size:11px}.virtualStageEditor .stageChatDock .chatOptions{display:flex;align-items:center;gap:5px}.virtualStageEditor .chatEdge{bottom:3px;left:50%;transform:translateX(-50%)}
@media(max-height:760px){.virtualStageEditor{--stageBottom:calc(198px + var(--stageChatLift))}.virtualStageEditor.timelineCollapsed{--stageBottom:calc(132px + var(--stageChatLift))}.virtualStageEditor.stageTimelineHidden{--stageBottom:calc(44px + var(--stageChatLift))}}


section.previsEditor.virtualStageEditor .topBar,section.previsEditor.virtualStageEditor .timelinePanel,section.previsEditor.virtualStageEditor .stageChatDock,section.previsEditor.virtualStageEditor .aiPanel{background:var(--stageGlass);backdrop-filter:var(--stageFrost);border-color:var(--stageLine)}
.virtualStageEditor>.errorText,.virtualStageEditor>.previewNotice{position:absolute;z-index:12;left:50%;top:calc(var(--stageTop) + 66px);transform:translateX(-50%);width:min(620px,calc(100% - 100px));max-height:30vh;overflow:auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px;margin:0;padding:16px;border:1px solid var(--stageLine);border-radius:16px;background:var(--el-bg-color,#263342);color:var(--el-text-color-primary,#f1f4fa);box-shadow:0 10px 40px #0006}
.virtualStageEditor>.errorText{border-color:#e39494}.virtualStageEditor .frameOverlay{z-index:15}
.virtualStageEditor .cameraPreviewImage{touch-action:none;cursor:grab}.virtualStageEditor .cameraPreviewImage:active{cursor:grabbing}.virtualStageEditor .cameraDragGhost{position:fixed;z-index:20;pointer-events:none;padding:10px 14px;border:1px solid var(--stageLine);border-radius:12px;background:var(--el-bg-color,#23313f);color:var(--el-text-color-primary,#fff);box-shadow:0 6px 20px #0005;font-size:12px}
.virtualStageEditor .stageViewTabs{max-width:calc(100% - var(--stageLeft) - var(--stageRight))}
.virtualStageEditor .monitorWrap,.virtualStageEditor .monitorTools{max-width:calc(100% - var(--stageLeft) - var(--stageRight))}
.virtualStageEditor.cameraView .monitorWrap{max-width:none}
.virtualStageEditor:not(.stageMonitorFolded):not(.cameraView) .canvasWrap>.canvasLabel{--stageHintInset:max(calc(var(--stageLeft) + 304px),var(--stageRight))}
.virtualStageEditor .topBar,.virtualStageEditor .stageRail,.virtualStageEditor .stageViewTabs,.virtualStageEditor .viewToolbar,.virtualStageEditor .monitorTools,.virtualStageEditor .stageFloatingPanel,.virtualStageEditor .assetPanel,.virtualStageEditor .propertyPanel,.virtualStageEditor .aiPanel,.virtualStageEditor .timelinePanel,.virtualStageEditor .stageChatDock,.virtualStageEditor :deep(.terrainPanel){box-shadow:var(--stageShadow)}
@media(max-width:1050px){.virtualStageEditor .stageFloatingPanel.multiCameraPanel{width:280px}.virtualStageEditor:has(.multiCameraPanel):not(.stageRightFolded){--stageRight:338px}.virtualStageEditor:not(.stageMonitorFolded):not(.cameraView) .canvasWrap>.canvasLabel{--stageHintInset:max(calc(var(--stageLeft) + 254px),var(--stageRight))}}
.virtualStageEditor{--stageLeft:224px}.virtualStageEditor.stageRailFolded{--stageLeft:42px}
.virtualStageEditor .stageRail{width:196px;padding:8px;gap:4px}
.virtualStageEditor .stageRail>button{flex:none;min-height:34px;flex-direction:row;justify-content:flex-start;gap:10px;padding:6px 10px}
.virtualStageEditor .stageRail>button span{font-size:11px}.virtualStageEditor .stageRail>.railFoldButton{justify-content:center;min-height:28px}
.virtualStageEditor .stageRailSection{flex:none;margin:4px 0 0;padding:8px 0 0;border:0;border-top:1px solid var(--stageLine)}
.virtualStageEditor .stageRailSection>summary{padding:7px 4px;cursor:pointer;font-size:11px;font-weight:600;color:inherit}
.virtualStageEditor .stageRail .stageViewTabs,.virtualStageEditor .stageRail .viewToolbar{position:static;inset:auto;width:100%;max-width:none;max-height:none;box-sizing:border-box;margin:4px 0;padding:0;border:0;background:transparent;backdrop-filter:none;box-shadow:none;overflow:visible}
.virtualStageEditor .stageRail .stageViewTabs{display:flex;flex-direction:column;gap:5px}
.virtualStageEditor .stageRail .stageViewTabs button{display:flex;flex-direction:row;justify-content:space-between;min-height:32px;padding:6px 10px;font-size:11px;border-color:var(--stageLine)}
.virtualStageEditor .stageRail .stageViewTabs button span{font-size:10px;opacity:.72}
.virtualStageEditor .stageRail .viewToolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
.virtualStageEditor .stageRail .viewToolbar button{min-width:0;min-height:32px;padding:6px 4px;font-size:11px;line-height:1.3;border:1px solid var(--stageLine);background:var(--lum-input)}
.virtualStageEditor{--stageLine:#ffffff22;--lum-line:#ffffff1c;--lum-input:#ffffff08;--lum-hover:#ffffff12;--lum-accent-soft:#ffffff12;--el-fill-color:#ffffff12;--el-fill-color-light:#ffffff08;--el-color-primary-light-9:#ffffff12}
.virtualStageEditor button:hover:not(:disabled){border-color:#ffffff38;background:var(--lum-hover)}
.virtualStageEditor .stageRail .viewToolbar button.selected,.virtualStageEditor .stageRail .viewToolbar button[aria-pressed=true]{background:#ffffff14;box-shadow:inset 0 -2px #ffffff55}
section.previsEditor.virtualStageEditor .topBar{background:none;border:0;box-shadow:none;backdrop-filter:none;text-shadow:var(--stageHeaderTextShadow)}
section.previsEditor.virtualStageEditor .topBar>strong,section.previsEditor.virtualStageEditor .topBar>input,section.previsEditor.virtualStageEditor .topBar>:deep(button),section.previsEditor.virtualStageEditor .topBar .statusText>span{min-height:32px;box-sizing:border-box;border:1px solid #ffffff66;border-radius:10px;background:var(--stageGlass);color:#fff;text-shadow:var(--stageHeaderTextShadow);backdrop-filter:var(--stageFrost);box-shadow:inset 0 1px #ffffff52,inset 0 -1px #ffffff12,0 0 7px #ffffff12,0 2px 6px #0002}
.virtualStageEditor .topBar>strong,.virtualStageEditor .topBar .statusText>span{display:inline-flex;align-items:center;padding:6px 9px}
section.previsEditor.virtualStageEditor .topBar>:deep(button:hover:not(:disabled)){background:#ffffff16;border-color:#ffffff85}
section.previsEditor.virtualStageEditor .topBar>input:focus-visible,section.previsEditor.virtualStageEditor .topBar>:deep(button:focus-visible){outline:2px solid #ffffffb3;outline-offset:2px}
.monitorDock{display:contents}
.virtualStageEditor .stageMonitorDock{position:absolute;z-index:3;left:var(--stageLeft);bottom:calc(var(--stageBottom) + 18px);display:flex;flex-direction:column;width:260px;max-width:calc(100% - var(--stageLeft) - var(--stageRight));box-sizing:border-box;border:1px solid var(--stageLine);border-radius:14px;overflow:hidden;background:var(--stageGlass);backdrop-filter:var(--stageFrost);box-shadow:0 6px 18px #0002}
.virtualStageEditor.stageMonitorFolded .stageMonitorDock{display:none}
.virtualStageEditor .stageMonitorDock .monitorWrap{position:relative;inset:auto;flex:none;align-self:auto;width:calc(100% - 12px);margin:0 6px;max-width:none;height:auto;max-height:none;aspect-ratio:16/9!important;border:0;border-radius:10px;background:#444;box-shadow:none}
.virtualStageEditor .stageMonitorDock .monitorWrap .canvasLabel{background:#4d4d4d80;border:0;font-size:9px}
.virtualStageEditor .stageMonitorDock .monitorTools{position:static;inset:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;max-width:none;padding:8px;gap:5px;border:0;border-top:1px solid var(--stageLine);border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none}
.virtualStageEditor .stageMonitorDock .monitorTools label{grid-column:1/-1;justify-content:space-between}.virtualStageEditor .stageMonitorDock .monitorTools select{flex:1;min-width:0}
.virtualStageEditor .stageMonitorDock .monitorTools button{min-width:0;padding:5px;font-size:10px}
/* Shared clear glass keeps every floating tool surface consistent with the header. */
.virtualStageEditor{--stageGlass:linear-gradient(145deg,#ffffff1a,#ffffff03);--stageFrost:blur(22px) saturate(.8) brightness(.70);--stageLine:#ffffff66;--stageShadow:inset 0 1px #ffffff52,inset 0 -1px #ffffff12,0 0 7px #ffffff12,0 4px 12px #0002;--stageHeaderTextShadow:0 1px 2px #000,0 2px 5px #000b;color:#fff;text-shadow:var(--stageHeaderTextShadow);font-size:14px;line-height:1.5;font-weight:500}
.virtualStageEditor .stageRail,.virtualStageEditor .stageFloatingPanel,.virtualStageEditor .assetPanel,.virtualStageEditor .propertyPanel,.virtualStageEditor .aiPanel,.virtualStageEditor .timelinePanel,.virtualStageEditor .stageChatDock,.virtualStageEditor .stageMonitorDock,.virtualStageEditor :deep(.terrainPanel){box-shadow:var(--stageShadow)}
.virtualStageEditor :deep(button),.virtualStageEditor :deep(input),.virtualStageEditor :deep(select),.virtualStageEditor :deep(textarea),.virtualStageEditor :deep(summary){text-shadow:var(--stageHeaderTextShadow)}
.virtualStageEditor :deep(button:not(.monitorDragHandle):not(.cameraPreviewImage):not(.shotBlock):not(.actionBlock):not(.pathBlock)),.virtualStageEditor :deep(summary){transition:translate .16s ease,background-color .16s ease,border-color .16s ease,box-shadow .16s ease}
@media(hover:hover){.virtualStageEditor :deep(button:not(:disabled):not(.monitorDragHandle):not(.cameraPreviewImage):not(.shotBlock):not(.actionBlock):not(.pathBlock):hover),.virtualStageEditor :deep(summary:hover){translate:0 -2px;border-color:#ffffffb3;background-color:#ffffff24;box-shadow:inset 0 1px #ffffff70,0 3px 10px #0003,0 0 8px #ffffff1c}.virtualStageEditor :deep(summary){border-radius:10px}}
@media(prefers-reduced-motion:reduce){.virtualStageEditor :deep(button),.virtualStageEditor :deep(summary){transition:none!important;translate:none!important}}
.virtualStageEditor :deep(button),.virtualStageEditor :deep(input),.virtualStageEditor :deep(select),.virtualStageEditor :deep(textarea){font-size:13px;font-weight:600}
.virtualStageEditor .stageRail>button span,.virtualStageEditor .stageRailSection>summary,.virtualStageEditor .stageRail .stageViewTabs button,.virtualStageEditor .stageRail .viewToolbar button,.virtualStageEditor .stageRail .railFoldButton,.virtualStageEditor .stageMonitorDock .monitorTools button,.virtualStageEditor .monitorTools select,.virtualStageEditor .stageChatDock button,.virtualStageEditor .stageChatDock textarea,.virtualStageEditor .cameraPreviewActions button,.virtualStageEditor .cameraStack .cameraPreviewActions button,.virtualStageEditor .topBar button{font-size:13px}
.virtualStageEditor .topBar>strong,.virtualStageEditor .panelTitle{font-size:15px;font-weight:700}
.virtualStageEditor .statusText,.virtualStageEditor .timelineHeader,.virtualStageEditor .playBar,.virtualStageEditor :deep(.timelineEditor){font-size:13px}
.virtualStageEditor .cameraHint,.virtualStageEditor .cameraPages,.virtualStageEditor .cameraLayoutChoice,.virtualStageEditor .cameraPreviewImage strong,.virtualStageEditor .monitorTools,.virtualStageEditor .canvasWrap>.canvasLabel,.virtualStageEditor .stageEdgeTab{font-size:12px}
.virtualStageEditor .stageRail .stageViewTabs button span,.virtualStageEditor .stageMonitorDock .monitorWrap .canvasLabel,.virtualStageEditor :deep(.timeRuler>span),.virtualStageEditor :deep(.shotBlock small){font-size:11px}
.virtualStageEditor .stageRail>button{min-height:36px}.virtualStageEditor .cameraHint{opacity:1}
/* Active labels must remain readable over the brighter translucent surfaces. */
.virtualStageEditor{--lum-muted:#f4f6fa;--el-text-color-secondary:#f4f6fa;--el-text-color-regular:#fff}
section.previsEditor.virtualStageEditor :deep(h3),section.previsEditor.virtualStageEditor :deep(summary),section.previsEditor.virtualStageEditor :deep(label),section.previsEditor.virtualStageEditor .selectionHint,section.previsEditor.virtualStageEditor .environmentPanel p,section.previsEditor.virtualStageEditor .aiPanel p,section.previsEditor.virtualStageEditor .skillHint{color:#fff;opacity:1}
.virtualStageEditor :deep(summary),.virtualStageEditor :deep(h3){font-weight:600}
/* Native option popups must share the light-text controls' dark color scheme. */
.virtualStageEditor :deep(select){color-scheme:dark}
.virtualStageEditor :deep(option),.virtualStageEditor :deep(optgroup){background:#363c44;color:#fff;text-shadow:none}
.virtualStageEditor :deep(option:checked){background:#53677e;color:#fff}
.virtualStageEditor .monitorDragBar{display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid #ffffff26}
.virtualStageEditor .monitorDragBar .monitorDragHandle{flex:1;min-width:0;padding:4px;text-align:left;cursor:grab;touch-action:none;user-select:none;border-color:transparent;background:transparent}
.virtualStageEditor .monitorDragBar .monitorDragHandle:active{cursor:grabbing}.virtualStageEditor .monitorDragBar>button:last-child{padding:2px 7px}
.virtualStageEditor .stageMonitorDock{z-index:7}
.virtualStageEditor .stageChatTarget{flex:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 7px;border:1px solid #ffffff38;border-radius:9px;background:#ffffff12;font-size:12px;font-weight:600}
.virtualStageEditor .timelineHeader{flex-wrap:wrap}.virtualStageEditor .timelineHeader>span{min-width:80px}
.virtualStageEditor .cameraPreviewActions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.virtualStageEditor .cameraPreviewActions>button:first-child{grid-column:1/-1}.virtualStageEditor .cameraStack .cameraPreviewActions{display:flex}
@supports(appearance:base-select){
  .virtualStageEditor :deep(select),.virtualStageEditor :deep(select::picker(select)){appearance:base-select}
  .virtualStageEditor :deep(select){align-items:center;gap:8px}
  .virtualStageEditor :deep(select::picker-icon){color:#edf5ff;transition:rotate .16s ease}
  .virtualStageEditor :deep(select:open::picker-icon){rotate:180deg}
  .virtualStageEditor :deep(select::picker(select)){min-width:anchor-size(width);max-width:min(420px,calc(100vw - 24px));max-height:min(320px,60vh);margin:6px 0;padding:5px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid #ffffff66;border-radius:12px;background:linear-gradient(145deg,#ffffff1a,#ffffff03),rgb(35 39 45 / .45);backdrop-filter:var(--stageFrost);box-shadow:var(--stageShadow),0 10px 30px #0004;color:#fff;font:600 13px/1.5 system-ui,sans-serif;text-shadow:var(--stageHeaderTextShadow)}
  .virtualStageEditor :deep(select option){min-height:34px;gap:10px;padding:7px 10px;margin:2px 0;border:1px solid transparent;border-radius:8px;background:transparent;color:#fff;white-space:normal;text-shadow:var(--stageHeaderTextShadow);transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease}
  .virtualStageEditor :deep(select optgroup){padding:4px;background:transparent;color:#e1e7ef}
  .virtualStageEditor :deep(select option:checked){background:#b5d9ff28;border-color:#d4e9ff70;box-shadow:inset 0 1px #ffffff38}
  .virtualStageEditor :deep(select option:hover:not(:disabled)),.virtualStageEditor :deep(select option:focus-visible){outline:none;background:#ffffff2b;border-color:#ffffff99;box-shadow:inset 0 1px #ffffff66,0 2px 7px #0002}
  .virtualStageEditor :deep(select option::checkmark){order:2;margin-inline-start:auto;color:#eef7ff}
  .virtualStageEditor :deep(select option:disabled){color:#a7afb9;opacity:.6}
}
</style>
