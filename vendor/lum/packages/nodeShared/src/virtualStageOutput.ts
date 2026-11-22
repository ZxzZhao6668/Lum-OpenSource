export const virtualStageOutputKey = "virtualStageOutput";
export interface VirtualStageOutput { sourceId:string;kind:"image"|"video";url:string;mimeType:"image/png"|"video/mp4";label:string }
export type PublishVirtualStageOutput = (output:VirtualStageOutput)=>Promise<{canvasId:string;nodeId:string}>;
export function validateVirtualStageOutput(value:VirtualStageOutput) {
  if (!value || !/^[\w-]{1,100}$/.test(value.sourceId) || !["image","video"].includes(value.kind)
    || value.mimeType!==(value.kind==="image"?"image/png":"video/mp4") || typeof value.label!=="string" || !value.label.trim() || value.label.length>150
    || typeof value.url!=="string" || !value.url.startsWith(`assets/${value.sourceId}/`) || value.url.split("/").some(part=>!part || part==="." || part===".." || !/^[\w .-]+$/.test(part))
    || !value.url.endsWith(value.kind==="image"?".png":".mp4")) throw new Error("片场输出文件信息无效");
  return value;
}
