// Shared deterministic meshes: the browser and Blender receive identical geometry.
type Point = [number, number, number];
interface Part { color: string; positions: number[]; indices: number[] }
interface Asset { id: string; name: string; category: string; parts: Part[] }

function builder() {
  const parts: Part[] = [];
  function part(color = "#e5e3dd") { const value: Part = { color, positions: [], indices: [] }; parts.push(value); return value; }
  function face(target: Part, points: Point[]) {
    const offset = target.positions.length / 3;
    for (const point of points) target.positions.push(...point);
    for (let i=1;i<points.length-1;i++) target.indices.push(offset,offset+i,offset+i+1);
  }
  function box(target: Part, center: Point, size: Point) {
    const [x,y,z]=center, [w,h,d]=size.map(value=>value/2);
    const p:Point[]=[[-w!,-h!,-d!],[-w!,-h!,d!],[-w!,h!,-d!],[-w!,h!,d!],[w!,-h!,-d!],[w!,-h!,d!],[w!,h!,-d!],[w!,h!,d!]].map(([a,b,c])=>[a!+x,b!+y,c!+z]);
    for (const indices of [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]) face(target,indices.map(index=>p[index]!));
  }
  function tube(target: Part, from: Point, to: Point, bottom: number, top = bottom, segments = 12) {
    const d=to.map((value,i)=>value-from[i]!) as Point, length=Math.hypot(...d);
    const axis=d.map(value=>value/length) as Point, reference:Point=Math.abs(axis[1])<.9?[0,1,0]:[1,0,0];
    const cross=(a:Point,b:Point):Point=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    let u=cross(axis,reference); const ul=Math.hypot(...u); u=u.map(value=>value/ul) as Point; const v=cross(axis,u);
    const rings=[from,to].map((center,row)=>Array.from({length:segments},(_,i)=>center.map((value,k)=>value+(u[k]!*Math.cos(i/segments*Math.PI*2)+v[k]!*Math.sin(i/segments*Math.PI*2))*(row?top:bottom)) as Point));
    for(let i=0;i<segments;i++)face(target,[rings[0]![i]!,rings[0]![(i+1)%segments]!,rings[1]![(i+1)%segments]!,rings[1]![i]!]);
    face(target,[...rings[0]!].reverse());face(target,rings[1]!);
  }
  function prism(target:Part, polygon:[number,number][], front:number, back:number) {
    face(target,polygon.map(([x,y])=>[x,y,front]));face(target,[...polygon].reverse().map(([x,y])=>[x,y,back]));
    polygon.forEach(([x,y],i)=>{const [nx,ny]=polygon[(i+1)%polygon.length]!;face(target,[[x,y,front],[x,y,back],[nx,ny,back],[nx,ny,front]]);});
  }
  return {parts,part,face,box,tube,prism};
}
function wall(gate:boolean):Asset {
  const b=builder(), wall=b.part(), stone=b.part("#d0cec8"), tile=b.part("#dcdbd6");
  if(gate){
    b.box(wall,[-2.25,2.1,0],[1.5,4.2,.48]);b.box(wall,[2.25,2.1,0],[1.5,4.2,.48]);
    for(let i=0;i<60;i++){
      const x=-1.5+i*.05,nx=x+.05, y=1.25+Math.sqrt(Math.max(0,2.25-x*x)),ny=1.25+Math.sqrt(Math.max(0,2.25-nx*nx));
      b.prism(wall,[[x,y],[nx,ny],[nx,4.2],[x,4.2]],.24,-.24);
      const low=Math.max(0,2.5-y),nlow=Math.max(0,2.5-ny);
      if(low>0||nlow>0)b.prism(stone,[[x,0],[nx,0],[nx,nlow],[x,low]],.27,-.27);
    }
    const start=Math.asin(-1.25/1.5),end=Math.PI-start;
    for(let i=0;i<72;i++){
      const a=start+(end-start)*i/72,c=start+(end-start)*(i+1)/72;
      b.prism(stone,[[1.5*Math.cos(a),Math.max(0,1.25+1.5*Math.sin(a))],[1.66*Math.cos(a),Math.max(0,1.25+1.66*Math.sin(a))],[1.66*Math.cos(c),Math.max(0,1.25+1.66*Math.sin(c))],[1.5*Math.cos(c),Math.max(0,1.25+1.5*Math.sin(c))]],.31,-.31);
    }
  }else{
    b.box(wall,[0,2.1,0],[6,4.2,.48]);
    for(let row=0;row<3;row++)for(let col=0;col<12;col++)b.box(stone,[-2.75+col*.5,.1+row*.2,.005],[.485,.19,.53]);
  }
  b.box(stone,[0,4.12,0],[6.12,.15,.7]);b.box(tile,[0,4.27,0],[6.16,.14,.82]);
  for(let i=0;i<40;i++){
    const x=-2.925+i*.15;b.tube(tile,[x,4.36,-.5],[x,4.36,.5],.087,.087,10);
    b.tube(stone,[x,4.36,.51],[x,4.36,.54],.09,.09,12);
  }
  return {id:gate?"stageMoonGate":"stagePalaceWall",name:gate?"月亮门宫墙":"宫墙与瓦顶",category:"建筑",parts:b.parts};
}
function tree():Asset {
  const b=builder(),bark=b.part("#bcb9ae"),foliage=b.part("#e0e3d8");let seed=184;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const trunk:Point[]=[[0,0,0],[.08,1.9,.03],[-.05,3.1,.15],[.12,4.15,.06],[.28,5.1,.08]];
  for(let i=0;i<4;i++)b.tube(bark,trunk[i]!,trunk[i+1]!,.3-i*.043,.26-i*.044,14);
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2;b.tube(bark,[0,.3,0],[Math.cos(a)*.65,.04,Math.sin(a)*.65],.14,.045,8);
  }
  for(let limb=0;limb<9;limb++){
    const angle=limb*2.4,origin:Point=[.02,2.8+(limb%3)*.6,.08],tip:Point=[Math.cos(angle)*(1.8+random()*.9),4.4+random()*1.4,Math.sin(angle)*(1.8+random()*.8)];
    const middle:Point=[tip[0]*.48,origin[1]+.65,tip[2]*.48];
    b.tube(bark,origin,middle,.14,.09,10);b.tube(bark,middle,tip,.09,.025,8);
    for(let twig=0;twig<4;twig++){
      const end:Point=[tip[0]+(random()-.5)*1.3,tip[1]+(random()-.2)*.8,tip[2]+(random()-.5)*1.3];b.tube(bark,middle,end,.035,.009,6);
      for(let leaf=0;leaf<42;leaf++){
        const p:Point=[end[0]+(random()-.5)*1.5,end[1]+(random()-.5)*.85,end[2]+(random()-.5)*1.5],r=.12+random()*.12,a=random()*Math.PI*2;
        const u:Point=[Math.cos(a)*r,(random()-.5)*r,Math.sin(a)*r],v:Point=[-Math.sin(a)*r*.65,r*.2,Math.cos(a)*r*.65];
        const points:Point[]=[p.map((n,k)=>n-u[k]!) as Point,p.map((n,k)=>n+v[k]!) as Point,p.map((n,k)=>n+u[k]!) as Point,p.map((n,k)=>n-v[k]!) as Point];
        b.face(foliage,points);b.face(foliage,[...points].reverse());
      }
    }
  }
  return {id:"stagePlaneTree",name:"梧桐树 · 枝叶",category:"树木",parts:b.parts};
}
function paving():Asset {
  const b=builder(),p=b.part("#deddd6");
  for(let row=0;row<10;row++)for(let col=0;col<10;col++)b.box(p,[-2.25+col*.5,.035,-2.25+row*.5],[.484,.07,.484]);
  return {id:"stagePaving",name:"石板道路 · 5米",category:"场地",parts:b.parts};
}
function furniture(kind:"table"|"chair"|"lantern"|"sword"|"column"):Asset {
  const b=builder(),wood=b.part("#785443"),dark=b.part("#343238"),gold=b.part("#c5a266");
  if(kind==="table"||kind==="chair"){
    const table=kind==="table",width=table?1.6:.55,depth=table?.85:.55,height=table?.8:.45;
    b.box(wood,[0,height,0],[width,.09,depth]);
    for(const x of [-1,1])for(const z of [-1,1])b.box(wood,[x*(width/2-.07),height/2,z*(depth/2-.07)],[.07,height,.07]);
    if(!table){b.box(wood,[0,.82,-.23],[.55,.38,.06]);for(const x of [-.24,.24])b.box(wood,[x,.72,-.23],[.06,.52,.06]);}
  }else if(kind==="column"){
    b.box(dark,[0,.09,0],[.65,.18,.65]);b.tube(wood,[0,.18,0],[0,3.8,0],.22,.19,24);b.box(gold,[0,3.85,0],[.65,.18,.65]);
  }else if(kind==="sword"){
    b.box(dark,[0,.13,0],[.045,.26,.035]);b.box(gold,[0,.27,0],[.21,.045,.055]);b.prism(b.part("#c5d0d3"),[[-.035,.3],[.035,.3],[.025,1.03],[0,1.13],[-.025,1.03]],.012,-.012);
  }else{
    b.tube(gold,[0,0,0],[0,.05,0],.18,.18,16);b.tube(b.part("#b3503c"),[0,.05,0],[0,.48,0],.2,.2,16);b.tube(gold,[0,.48,0],[0,.53,0],.18,.18,16);
    for(let i=0;i<8;i++){const a=i/8*Math.PI*2;b.tube(gold,[Math.cos(a)*.2,.05,Math.sin(a)*.2],[Math.cos(a)*.2,.48,Math.sin(a)*.2],.008,.008,5);}
  }
  const titles={table:"木桌",chair:"木椅",lantern:"灯笼",sword:"长剑",column:"廊柱"};
  return {id:`stage${kind[0]!.toUpperCase()}${kind.slice(1)}`,name:titles[kind],category:kind==="column"?"建筑":"道具",parts:b.parts};
}
export const virtualStageAssets:Asset[]=[wall(false),wall(true),tree(),paving(),...(["table","chair","lantern","sword","column"] as const).map(furniture)];

type Ring = [height: number, width: number, depth: number, forward?: number];
type CostumeColor = "cloth" | "skin" | "hair" | "accent" | "shoe";
interface CostumePart { joint: string; color: CostumeColor; rings: Ring[]; replace?: boolean }
export interface StageAppearance { style: "robe" | "modern"; skin: string; hair: string; accent: string }

function costume(robe: boolean): CostumePart[] {
  const parts: CostumePart[] = [
    { joint: "hips", color: "cloth", replace: true, rings: robe ? [[-.81,.35,.22],[-.6,.3,.2],[-.25,.23,.16],[.08,.16,.11],[.15,.14,.1]] : [[-.12,.09,.09],[-.06,.18,.12],[.1,.14,.1],[.15,.13,.09]] },
    { joint: "spine", color: "cloth", replace: true, rings: [[-.05,.14,.1],[.04,.14,.095],[.16,.18,.115],[.28,.22,.125],[.34,.2,.11],[.385,.1,.075],[.4,.055,.05]] },
    { joint: "hips", color: "accent", rings: [[.06,.167,.115],[.11,.16,.11],[.145,.145,.1]] },
    { joint: "head", color: "hair", rings: [[.12,.095,.095],[.17,.08,.08],[.205,.04,.04],[.213,.002,.002]] },
  ];
  if (robe) {
    parts.push({ joint: "head", color: "hair", rings: [[.2,.032,.035,-.018],[.23,.06,.05,-.018],[.285,.05,.045,-.018],[.3,.025,.025,-.018]] });
    parts.push({ joint: "head", color: "hair", rings: [[-.4,.06,.022,-.105],[-.1,.065,.03,-.105],[.14,.08,.04,-.06]] });
    parts.push({ joint: "head", color: "accent", rings: [[.235,.062,.052,-.018],[.247,.062,.052,-.018]] });
  }
  for (const side of ["left", "right"]) {
    parts.push({ joint: `${side}Shoulder`, color: "cloth", replace: true, rings: [[-.32,robe?.10:.055,robe?.085:.05],[-.12,.085,.075],[-.025,.087,.08],[.04,.06,.055],[.065,.01,.01]] });
    parts.push({ joint: `${side}Elbow`, color: "cloth", replace: true, rings: [[-.27,robe?.13:.04,robe?.09:.038],[-.21,robe?.15:.045,robe?.1:.042],[-.07,.09,.07],[.025,.065,.06]] });
    parts.push({ joint: `${side}Ankle`, color: "shoe", replace: true, rings: [[-.1,.058,.13,.045],[-.07,.064,.14,.053],[-.015,.05,.11,.032],[.045,.04,.045]] });
  }
  return parts;
}
// ACT: 衣服随刚性关节运动；不模拟布料，也不追求脸部细节。
export const stageCostumes = { robe: costume(true), modern: costume(false) };
