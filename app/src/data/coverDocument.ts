/** Text-model projection only. The stored document/backup retains the original image. */
export function coverTextContext(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const cover=value as Record<string,unknown>;
 return {...Object.fromEntries(['title','author','contact','synopsis'].filter(key=>typeof cover[key]==='string').map(key=>[key,cover[key]])),hasImage:typeof cover.image==='string'&&!!cover.image};
}
