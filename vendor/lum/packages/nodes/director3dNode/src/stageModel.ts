import { Box3, BufferGeometry, Color, Float32BufferAttribute, LoadingManager, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { isStageMesh, type StageMesh } from "@lum/node-shared/stageMesh";

export function createStageMesh(parts: StageMesh, tint: string, clay: boolean) {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    const color = new Color(clay ? "#e5e3dd" : part.color).multiply(new Color(clay ? "#ffffff" : tint));
    for (const n of part.positions) positions.push(n);
    for (const n of part.indices) indices.push(n + offset);
    for (let i = 0; i < part.positions.length; i += 3) { const ao = part.ao?.[i / 3] ?? 1; colors.push(color.r * ao, color.g * ao, color.b * ao); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: .85 }));
}

export async function importStageModel(file: File): Promise<StageMesh> {
  if (!/\.glb$/i.test(file.name) || !file.size || file.size > 12 * 1024 * 1024) throw new Error("请选择不超过 12 MB 的 GLB 模型");
  const bytes = await file.arrayBuffer(), view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error("不是有效的 GLB 2.0 文件");
  const jsonLength = view.getUint32(12, true);
  if (jsonLength > 2 * 1024 * 1024 || jsonLength + 28 > bytes.byteLength) throw new Error("模型描述过大或缺少内嵌网格");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)));
  if (json.asset?.version !== "2.0" || json.skins?.length || json.animations?.length || json.extensionsRequired?.length) throw new Error("请导出普通静态 GLB：不含骨骼、动画或压缩扩展");
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || json.buffers.some((item: any) => item.uri)) throw new Error("模型必须自带网格，不能引用外部文件");
  if (!Number.isInteger(json.buffers[0].byteLength) || json.buffers[0].byteLength <= 0 || !Array.isArray(json.scenes) || json.scenes.length !== 1 || !Array.isArray(json.nodes) || !Array.isArray(json.meshes) || !Array.isArray(json.accessors) || !Array.isArray(json.bufferViews)) throw new Error("请导出只包含一个场景的完整 GLB");
  if ((json.accessors?.length ?? 0) > 1024 || (json.nodes?.length ?? 0) > 512 || (json.meshes?.length ?? 0) > 128 || json.accessors?.some((item: any) => !Number.isInteger(item.count) || item.count < 0 || item.count > 180000 || item.sparse)) throw new Error("模型数据过大或使用了不支持的稀疏网格，请先简化");
  if (json.meshes?.some((item: any) => item.primitives?.some((part: any) => part.targets?.length || (part.mode !== undefined && part.mode !== 4)))) throw new Error("仅支持三角形静态网格，请先应用形态和几何修改器");
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  let allocated = 0;
  for (const accessor of json.accessors ?? []) {
    const width = components[accessor.type], bytesPerComponent = componentBytes[accessor.componentType];
    const buffer = json.bufferViews?.[accessor.bufferView], offset = accessor.byteOffset ?? 0;
    if (!width || !bytesPerComponent || !buffer || !Number.isInteger(offset) || offset < 0 || offset % bytesPerComponent) throw new Error("模型顶点格式或偏移无效");
    const stride = buffer.byteStride ?? width * bytesPerComponent;
    if (!Number.isInteger(stride) || stride < width * bytesPerComponent || stride > 252 || stride % bytesPerComponent || offset + Math.max(0, accessor.count - 1) * stride + (accessor.count ? width * bytesPerComponent : 0) > buffer.byteLength) throw new Error("模型顶点数据超出网格范围");
    allocated += accessor.count * width;
    if (allocated > 2500000) throw new Error("模型解码数据过大，请先简化");
  }
  for (const buffer of json.bufferViews ?? []) {
    const offset = buffer.byteOffset ?? 0;
    if (buffer.buffer !== 0 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(buffer.byteLength) || buffer.byteLength < 0 || offset + buffer.byteLength > json.buffers[0].byteLength) throw new Error("模型网格范围无效");
  }
  const nodes = json.nodes ?? [], parents = new Map<number, number>(), visited = new Set<number>(), active = new Set<number>();
  for (let i = 0; i < nodes.length; i++) for (const child of nodes[i].children ?? []) {
    if (!Number.isInteger(child) || child < 0 || child >= nodes.length || parents.has(child)) throw new Error("模型层级包含重复或无效节点");
    parents.set(child, i);
  }
  const visit = (id: number, depth: number) => {
    if (active.has(id) || depth > 64) throw new Error("模型层级循环或超过64层");
    if (visited.has(id)) return;
    active.add(id);
    for (const child of nodes[id].children ?? []) visit(child, depth + 1);
    active.delete(id); visited.add(id);
  };
  for (let i = 0; i < nodes.length; i++) visit(i, 0);
  const roots = json.scenes[0].nodes;
  if (!Array.isArray(roots) || roots.length > 512 || new Set(roots).size !== roots.length || roots.some((id: any) => !Number.isInteger(id) || id < 0 || id >= nodes.length || parents.has(id))) throw new Error("模型场景根节点无效");
  let totalVertices = 0, totalTriangles = 0, totalParts = 0;
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    if (!mesh || !Array.isArray(mesh.primitives)) throw new Error("模型网格引用无效");
    for (const part of mesh.primitives) {
      const position = json.accessors[part.attributes?.POSITION], indices = part.indices === undefined ? undefined : json.accessors[part.indices];
      if (!position || position.type !== "VEC3" || (part.indices !== undefined && (!indices || indices.type !== "SCALAR" || ![5121,5123,5125].includes(indices.componentType)))) throw new Error("模型顶点或索引引用无效");
      totalVertices += position.count; totalTriangles += (indices?.count ?? position.count) / 3; totalParts++;
      if (totalVertices > 60000 || totalTriangles > 20000 || totalParts > 64 || !Number.isInteger(totalTriangles)) throw new Error("模型实例合计超过2万三角面或64个材质区域，请简化后导入");
    }
  }
  // Keep basic material colors. Stripping images also prevents hidden network loads and oversized texture decoding.
  json.materials = (json.materials ?? []).map((item: any) => ({ pbrMetallicRoughness: { baseColorFactor: item.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .85 } }));
  delete json.images; delete json.textures; delete json.samplers; delete json.extensionsUsed; delete json.extensionsRequired;
  const queue: any[] = [json];
  while (queue.length) {
    const item = queue.pop();
    if (!item || typeof item !== "object") continue;
    delete item.extensions; delete item.extras;
    for (const child of Object.values(item)) if (child && typeof child === "object") queue.push(child);
  }
  const binaryOffset = 20 + jsonLength, binaryLength = view.getUint32(binaryOffset, true);
  if (view.getUint32(binaryOffset + 4, true) !== 0x004e4942 || binaryOffset + 8 + binaryLength !== bytes.byteLength || json.buffers[0].byteLength > binaryLength) throw new Error("模型的网格数据不完整");
  const description = new TextEncoder().encode(JSON.stringify(json)), padded = Math.ceil(description.length / 4) * 4;
  const sanitized = new ArrayBuffer(28 + padded + binaryLength), header = new DataView(sanitized), data = new Uint8Array(sanitized);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, sanitized.byteLength, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true); data.fill(32, 20, 20 + padded); data.set(description, 20);
  header.setUint32(20 + padded, binaryLength, true); header.setUint32(24 + padded, 0x004e4942, true); data.set(new Uint8Array(bytes, binaryOffset + 8, binaryLength), 28 + padded);
  const manager = new LoadingManager(); manager.setURLModifier(() => { throw new Error("模型不能加载外部资源"); });
  const result = await new GLTFLoader(manager).parseAsync(sanitized, "");
  try {
    result.scene.updateMatrixWorld(true);
    const parts: StageMesh = [], bounds = new Box3(), point = new Vector3(); let total = 0;
    result.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry, position = geometry.getAttribute("position");
      if (!position || position.count > 60000) throw new Error("模型顶点过多，请先简化");
      const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? position.count, materialIndex: 0 }];
      for (const group of groups) {
        total += group.count / 3;
        if (total > 20000 || parts.length >= 64) throw new Error("单个模型最多 2 万个三角面、64 个材质区域，请先简化");
        const positions: number[] = [], indices: number[] = [], remap = new Map<number, number>();
        for (let i = group.start; i < group.start + group.count; i++) {
          const index = geometry.index?.getX(i) ?? i;
          if (!remap.has(index)) {
            point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld); bounds.expandByPoint(point);
            remap.set(index, positions.length / 3); positions.push(point.x, point.y, point.z);
          }
          indices.push(remap.get(index)!);
        }
        const material = (Array.isArray(object.material) ? object.material[group.materialIndex ?? 0] : object.material) as MeshStandardMaterial;
        if (object.matrixWorld.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
        // Static import keeps base colors; texture painting and vertex colors are intentionally omitted.
        parts.push({ positions, indices, color: `#${material?.color?.getHexString() ?? "ffffff"}` });
      }
    });
    const center = bounds.getCenter(new Vector3());
    for (const part of parts) for (let i = 0; i < part.positions.length; i += 3) {
      part.positions[i] = Math.round((part.positions[i]! - center.x) * 100000) / 100000;
      part.positions[i + 1] = Math.round((part.positions[i + 1]! - bounds.min.y) * 100000) / 100000;
      part.positions[i + 2] = Math.round((part.positions[i + 2]! - center.z) * 100000) / 100000;
    }
    if (!isStageMesh(parts)) throw new Error("模型为空、尺寸过大或网格无效，请检查模型后重试");
    return parts;
  } finally {
    result.scene.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); } });
  }
}

export async function exportStageModel(objects: Object3D[]) {
  return new GLTFExporter().parseAsync(objects, { binary: true, onlyVisible: true }) as Promise<ArrayBuffer>;
}
