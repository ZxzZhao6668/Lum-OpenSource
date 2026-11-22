import bakeScript from "./bakeScript";
import presetCatalog from "../../../../../packages/nodes/director3dNode/src/presets/catalog.json";
import { virtualStageAssets, stageCostumes } from "@lum/node-shared/virtualStageAssets";
// Embedded so source and bundled server execute the identical trusted renderer.
export default String.raw`
import bpy, json, sys, math, os
from mathutils import Vector, Quaternion, Matrix
from math import sin, cos, pi
preset_catalog = json.loads(${JSON.stringify(JSON.stringify([...presetCatalog, ...virtualStageAssets]))})
stage_costumes = json.loads(${JSON.stringify(JSON.stringify(stageCostumes))})
args = sys.argv[sys.argv.index('--') + 1:]
with open(args[0], encoding='utf-8-sig') as file:
    job = json.load(file)
doc, plan = job['scene'], job['plan']
out = os.path.dirname(args[0])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = job['width']
scene.render.resolution_y = job['height']
scene.render.resolution_percentage = 100
scene.render.fps = job['fps']
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'
scene.world = bpy.data.worlds.new('PrevisWorld')
def rgb(value):
    # Three.js Color converts sRGB input into linear values.
    values = [int(value[i:i+2], 16) / 255 for i in (1,3,5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values)
scene.world.color = rgb(doc['sceneConfig']['scene']['background'])
studio = doc.get('studio', {})
if studio.get('materialMode') == 'pbr' or any(part.get('ao') for value in doc['objectList'] for part in value.get('meshParts',[])): studio['renderer'] = 'eevee'
if studio.get('renderer') == 'eevee':
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.eevee.use_raytracing = True
    scene.eevee.use_fast_gi = True
    scene.eevee.fast_gi_method = 'AMBIENT_OCCLUSION_ONLY'
    scene.eevee.fast_gi_distance = 3
    scene.eevee.fast_gi_quality = .5
    scene.eevee.fast_gi_ray_count = 4
    scene.world.use_nodes = True
    fill = next((light for light in doc['sceneConfig']['lights'] if light['type'] in ('ambient','hemisphere')), {'color':'#ffffff','intensity':0})
    world_nodes = scene.world.node_tree.nodes
    lighting_background = world_nodes['Background']
    lighting_background.inputs['Color'].default_value = (*rgb(fill['color']), 1)
    lighting_background.inputs['Strength'].default_value = fill['intensity']
    # Camera background stays unchanged while fill light and PBR reflections are adjustable.
    camera_background = world_nodes.new('ShaderNodeBackground')
    camera_background.inputs['Color'].default_value = (*rgb(doc['sceneConfig']['scene']['background']), 1)
    camera_background.inputs['Strength'].default_value = 1
    ray = world_nodes.new('ShaderNodeLightPath')
    mix = world_nodes.new('ShaderNodeMixShader')
    scene.world.node_tree.links.new(ray.outputs['Is Camera Ray'], mix.inputs[0])
    scene.world.node_tree.links.new(lighting_background.outputs['Background'], mix.inputs[1])
    scene.world.node_tree.links.new(camera_background.outputs['Background'], mix.inputs[2])
    scene.world.node_tree.links.new(mix.outputs[0], world_nodes['World Output'].inputs['Surface'])

def configure_material(material, color, alpha=1, roughness=.85, metalness=0):
    material.diffuse_color = (*color, alpha)
    if studio.get('renderer') == 'eevee':
        material.use_nodes = True
        shader = material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*color, alpha)
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Metallic'].default_value = metalness
    return material
def material_finish(value):
    if studio.get('materialMode') == 'pbr' and value.get('stageRole') == 'environment':
        return studio.get('pbrRoughness',.45), studio.get('pbrMetalness',0)
    return value['material'].get('roughness',.85), value['material'].get('metalness',0)
axis = bpy.data.objects.new('Y-up to Z-up', None)
scene.collection.objects.link(axis)
axis.rotation_euler = (pi/2, 0, 0)
if studio.get('renderer') == 'eevee':
    for index, item in enumerate(doc['sceneConfig']['lights']):
        if item['type'] in ('ambient', 'hemisphere'): continue
        light = bpy.data.lights.new('StageLight'+str(index), 'SUN' if item['type']=='directional' else 'AREA')
        light.energy = min(item.get('intensity',2),8) if light.type=='SUN' else min(item.get('intensity',2),8)*250
        light.color = rgb(item.get('color','#ffffff'))
        if light.type=='SUN': light.angle = .08
        else: light.size = 6
        lamp=bpy.data.objects.new(light.name,light);scene.collection.objects.link(lamp);lamp.parent=axis
        lamp.location=Vector(tuple(item.get('position',{'x':-8,'y':12,'z':8})[k] for k in ('x','y','z')))
        target=Vector(tuple(item.get('target',{'x':0,'y':0,'z':0})[k] for k in ('x','y','z')))
        lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
def vec(value): return Vector((value['x'], value['y'], value['z']))
def quat(value):
    x,y,z = (value[k]/2 for k in ('x','y','z'))
    c1,c2,c3,s1,s2,s3 = cos(x),cos(y),cos(z),sin(x),sin(y),sin(z)
    return Quaternion((c1*c2*c3-s1*s2*s3, s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3+s1*s2*c3))
def empty(name, parent, position=(0,0,0)):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = position
    obj.rotation_mode = 'QUATERNION'
    return obj
def mesh(name, vertices, faces, parent, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    for polygon in data.polygons: polygon.use_smooth = True
    return obj
def surface(name, rows, parent, material, close=True, cap=False):
    vertices = [point for row in rows for point in row]
    n = len(rows[0]); faces = []
    for row in range(len(rows)-1):
        for col in range(n if close else n-1):
            a=row*n+col; b=row*n+(col+1)%n
            faces.append((a,a+n,b+n,b))
    if cap:
        faces.append(tuple(reversed(range(n))))
        faces.append(tuple((len(rows)-1)*n+i for i in range(n)))
    return mesh(name,vertices,faces,parent,material)
def body(parent, rings, material):
    rows = [[(cos(i/16*2*pi)*r[1],r[0],sin(i/16*2*pi)*r[2]+(r[3] if len(r)>3 else 0)) for i in range(16)] for r in rings]
    surface(parent.name+'Body', rows, parent, material, cap=True)
def mannequin(root, value, material):
    parts = {}
    hidden = set(value.get('hiddenParts', []))
    appearance = value.get('appearance')
    costume = stage_costumes[appearance['style']] if appearance else []
    materials = {'cloth': material}
    if appearance:
        for key in ('skin', 'hair', 'accent', 'shoe'):
            materials[key] = configure_material(bpy.data.materials.new(key), rgb('#242932' if key=='shoe' else appearance[key]))
    def joint(parent, name, position, rings):
        obj = empty(name, parent, position)
        obj.hide_render = parent.hide_render or name in hidden
        parts[name] = obj
        if not obj.hide_render and not any(part['joint']==name and part.get('replace') for part in costume):
            body(obj, rings, materials['skin'] if appearance and name in ('head','neck','leftWrist','rightWrist') else material)
        if name in value.get('pose', {}): obj.rotation_quaternion = quat(value['pose'][name])
        return obj
    hips = joint(root,'hips',(0,.95,0),[[-.12,.06,.065],[-.07,.145,.095],[.015,.175,.105],[.1,.125,.085],[.15,.115,.075]])
    spine = joint(hips,'spine',(0,.15,0),[[-.045,.12,.08],[.04,.12,.075],[.16,.16,.095],[.28,.205,.105],[.34,.19,.09],[.385,.09,.06],[.4,.048,.04]])
    neck = joint(spine,'neck',(0,.425,0),[[-.04,.048,.043],[.045,.043,.04],[.08,.052,.047]])
    joint(neck,'head',(0,.07,0),[[-.045,.038,.043,.015],[-.01,.072,.075,.008],[.055,.092,.095],[.125,.09,.09],[.17,.075,.075],[.198,.035,.036],[.205,.002,.002]])
    for side,direction in [('left',1),('right',-1)]:
        shoulder = joint(spine,side+'Shoulder',(direction*.235,.3,0),[[-.32,.04,.039],[-.27,.045,.044],[-.12,.064,.06],[-.025,.073,.069],[.035,.052,.049],[.058,.008,.008]])
        elbow = joint(shoulder,side+'Elbow',(0,-.3,0),[[-.28,.029,.028],[-.24,.033,.032],[-.14,.044,.042],[-.065,.052,.048],[0,.04,.039],[.022,.025,.026]])
        joint(elbow,side+'Wrist',(0,-.26,0),[[-.14,.021,.016],[-.12,.039,.022],[-.04,.043,.026],[.015,.029,.025]])
        hip = joint(hips,side+'Hip',(direction*.105,-.04,0),[[-.43,.047,.046],[-.37,.057,.054],[-.22,.087,.083],[-.07,.097,.091],[.015,.079,.078],[.06,.045,.05]])
        knee = joint(hip,side+'Knee',(0,-.41,0),[[-.42,.031,.032],[-.35,.037,.04],[-.2,.061,.062],[-.1,.066,.06],[-.015,.05,.047],[.025,.041,.04]])
        joint(knee,side+'Ankle',(0,-.4,0),[[-.1,.051,.12,.045],[-.07,.059,.132,.053],[-.025,.048,.107,.032],[.025,.032,.04]])
    for part in costume:
        parent = parts[part['joint']]
        if not parent.hide_render: body(parent, part['rings'], materials[part['color']])
    return parts
def primitive(root, value, material):
    g=value['geometry']; kind=value['objType']
    def p(key, default): return g.get(key,default)
    if kind in ['preset','mesh']:
        preset=next(item for item in preset_catalog if item['id']==value['presetId']) if kind=='preset' else {'parts':value['meshParts']}
        vertices=[]; faces=[]; assignments=[]; materials=[]; aoValues=[]
        tint=rgb(value['material']['color'])
        for part in preset['parts']:
            aoValues.extend(part.get('ao',[1]*(len(part['positions'])//3)))
            offset=len(vertices); pts=part['positions']; idx=part['indices']
            vertices.extend([tuple(pts[i:i+3]) for i in range(0,len(pts),3)])
            faces.extend([tuple(offset+j for j in idx[i:i+3]) for i in range(0,len(idx),3)])
            color=rgb(part['color']); mat=bpy.data.materials.new(part['color'])
            result_color=rgb('#e5e3dd') if studio.get('clayEnvironment') and value.get('stageRole')=='environment' else tuple(color[i]*tint[i] for i in range(3))
            configure_material(mat,result_color,value['material'].get('opacity',1),*material_finish(value))
            assignments.extend([len(materials)]*(len(idx)//3));materials.append(mat)
        obj=mesh(value.get('presetId',value.get('name','model')),vertices,faces,root,materials[0])
        for mat in materials[1:]:obj.data.materials.append(mat)
        for face,index in zip(obj.data.polygons,assignments):face.material_index=index;face.use_smooth=False
        if any('ao' in part for part in preset['parts']):
            attribute=obj.data.color_attributes.new(name='bakedAo',type='FLOAT_COLOR',domain='POINT')
            for entry,factor in zip(attribute.data,aoValues):entry.color=(factor,factor,factor,1)
            for mat in materials:
                shader=mat.node_tree.nodes.get('Principled BSDF')
                color=tuple(shader.inputs['Base Color'].default_value)
                node=mat.node_tree.nodes.new('ShaderNodeVertexColor'); node.layer_name='bakedAo'
                multiply=mat.node_tree.nodes.new('ShaderNodeMixRGB'); multiply.blend_type='MULTIPLY'
                multiply.inputs[0].default_value=1; multiply.inputs[1].default_value=color
                mat.node_tree.links.new(node.outputs['Color'],multiply.inputs[2])
                mat.node_tree.links.new(multiply.outputs[0],shader.inputs['Base Color'])
        return
    if kind=='box':
        w,h,d=p('width',1)/2,p('height',1)/2,p('depth',1)/2
        vertices=[(x*w,y*h,z*d) for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
        obj=mesh(kind,vertices,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],root,material)
        for face in obj.data.polygons: face.use_smooth=False
        return
    if kind=='plane':
        w,h=p('width',1)/2,p('height',1)/2
        mesh(kind,[(-w,-h,0),(w,-h,0),(w,h,0),(-w,h,0)],[(0,1,2,3)],root,material); return
    n=max(3,int(p('radialSegments',32)))
    if kind in ('cylinder','cone'):
        top=0 if kind=='cone' else p('radiusTop',1)
        bottom=p('radius',1) if kind=='cone' else p('radiusBottom',1)
        height=p('height',1); start=p('thetaStart',0); length=p('thetaLength',2*pi)
        rows=[[(sin(start+i/n*length)*r,y,cos(start+i/n*length)*r) for i in range(n+1)] for r,y in [(bottom,-height/2),(top,height/2)]]
        surface(kind,rows,root,material,close=False,cap=not p('openEnded',False)); return
    if kind=='sphere':
        n=max(3,int(p('widthSegments',32))); m=max(2,int(p('heightSegments',16))); r=p('radius',1)
        rows=[]
        for j in range(m+1):
            theta=p('thetaStart',0)+j/m*p('thetaLength',pi)
            rows.append([(-r*cos(p('phiStart',0)+i/n*p('phiLength',2*pi))*sin(theta),r*cos(theta),r*sin(p('phiStart',0)+i/n*p('phiLength',2*pi))*sin(theta)) for i in range(n+1)])
        surface(kind,rows,root,material,close=False); return
    if kind=='ring':
        n=max(3,int(p('thetaSegments',32))); m=max(1,int(p('phiSegments',1)))
        rows=[[(r*cos(p('thetaStart',0)+i/n*p('thetaLength',2*pi)),r*sin(p('thetaStart',0)+i/n*p('thetaLength',2*pi)),0) for i in range(n+1)] for r in [p('innerRadius',.5)+(p('outerRadius',1)-p('innerRadius',.5))*j/m for j in range(m+1)]]
        surface(kind,rows,root,material,close=False); return
    if kind=='torus':
        n=max(3,int(p('tubularSegments',48))); m=max(3,int(p('radialSegments',12))); r=p('radius',1); tube=p('tube',.4)
        rows=[[( (r+tube*cos(j/m*2*pi))*cos(i/n*p('arc',2*pi)),(r+tube*cos(j/m*2*pi))*sin(i/n*p('arc',2*pi)),tube*sin(j/m*2*pi)) for i in range(n+1)] for j in range(m+1)]
        surface(kind,rows,root,material,close=False); return
    if kind=='capsule':
        n=max(3,int(p('radialSegments',8))); m=max(1,int(p('capSegments',4))); r=p('radius',1); length=p('length',1)
        profile=[(sin(j/m*pi/2)*r,-length/2-cos(j/m*pi/2)*r) for j in range(m+1)]+[(cos(j/m*pi/2)*r,length/2+sin(j/m*pi/2)*r) for j in range(m+1)]
        surface(kind,[[(sin(i/n*2*pi)*radius,y,cos(i/n*2*pi)*radius) for i in range(n)] for radius,y in profile],root,material)
objects={}; defaults={}
for value in doc['objectList']:
    root=empty(value.get('name',value['threeJsonId']),axis,vec(value['position']))
    rot=value.get('rotation',{}); scale=value.get('scale',{})
    root.rotation_quaternion=quat({'x':rot.get('rotationX',0),'y':rot.get('rotationY',0),'z':rot.get('rotationZ',0)})
    root.scale=(scale.get('scaleX',1),scale.get('scaleY',1),scale.get('scaleZ',1))
    material=bpy.data.materials.new(value['threeJsonId'])
    base_color='#e5e3dd' if studio.get('clayEnvironment') and value.get('stageRole')=='environment' else value['material']['color']
    configure_material(material,rgb(base_color),value['material'].get('opacity',1),*material_finish(value))
    parts=mannequin(root,value,material) if value['objType']=='mannequin' else {}
    if value['objType']!='mannequin': primitive(root,value,material)
    objects[value['threeJsonId']]=(root,parts)
for value in doc['objectList']:
    attachment=value.get('attachment')
    if attachment:
        root=objects[value['threeJsonId']][0]
        root.parent=objects[attachment['objectId']][1][attachment['joint']]
        root.location=vec(attachment['offset']); root.rotation_quaternion=quat(attachment['rotation'])
        if root.parent.hide_render:
            for child in [root, *root.children_recursive]: child.hide_render=True
${bakeScript}
for track in plan['tracks']:
    root,parts=objects[track['objectId']]
    obj=parts[track['joint']] if track.get('joint') else root
    defaults[(track['objectId'],track.get('joint'))]=(obj.location.copy(),obj.scale.copy())
def camera_pose(view):
    position=vec(view['camera']['position']); backward=position-vec(view['controls']['target'])
    if backward.length==0: backward.z=1
    backward.normalize(); right=Vector((0,1,0)).cross(backward)
    if right.length==0:
        backward.z += .0001; backward.normalize(); right=Vector((0,1,0)).cross(backward)
    right.normalize(); up=backward.cross(right)
    return position,Matrix((right,up,backward)).transposed().to_quaternion()
data=bpy.data.cameras.new('PrevisCamera'); cam=bpy.data.objects.new('PrevisCamera',data)
scene.collection.objects.link(cam); cam.parent=axis; cam.rotation_mode='QUATERNION'; scene.camera=cam
data.sensor_fit='VERTICAL'
frames=plan['cameraFrames']; poses=[camera_pose(frame['view']) for frame in frames]
def segment(frames,time):
    end=next((i for i,f in enumerate(frames) if f['time']>=time),len(frames)-1)
    a=max(0,end-1); b=end
    progress=1 if a==b else max(0,min(1,(time-frames[a]['time'])/(frames[b]['time']-frames[a]['time'])))
    return a,b,progress
count=1 if 'frameTime' in job else math.ceil(plan['duration']*job['fps']); scene.frame_start=1; scene.frame_end=count
for index in range(count):
    frame=index+1; time=job.get('frameTime',index/job['fps']); scene.frame_set(frame)
    for track in plan['tracks']:
        root,parts=objects[track['objectId']]; obj=parts[track['joint']] if track.get('joint') else root
        a,b,t=segment(track['frames'],time); first,last=track['frames'][a],track['frames'][b]
        obj.rotation_quaternion=quat(first['rotation']).slerp(quat(last['rotation']),t)
        obj.keyframe_insert('rotation_quaternion',frame=frame)
        for prop,base in zip(('position','scale'),defaults[(track['objectId'],track.get('joint'))]):
            if not any(prop in f for f in track['frames']): continue
            start=vec(first[prop]) if prop in first else base; end=vec(last[prop]) if prop in last else base
            setattr(obj,'location' if prop=='position' else prop,start.lerp(end,t))
            obj.keyframe_insert('location' if prop=='position' else prop,frame=frame)
    a,b,t=segment(frames,time)
    if frames[b]['easing']=='cut': t=1 if time>=frames[b]['time'] else 0
    if frames[b]['easing']=='smooth': t=t*t*(3-2*t)
    cam.location=poses[a][0].lerp(poses[b][0],t); cam.rotation_quaternion=poses[a][1].slerp(poses[b][1],t)
    first,last=frames[a]['view']['camera'],frames[b]['view']['camera']
    fov=first['fov']+(last['fov']-first['fov'])*t
    data.lens=data.sensor_height/(2*math.tan(math.radians(fov)/2))
    data.clip_start=first['near']+(last['near']-first['near'])*t; data.clip_end=first['far']+(last['far']-first['far'])*t
    cam.keyframe_insert('location',frame=frame); cam.keyframe_insert('rotation_quaternion',frame=frame)
    for prop in ('lens','clip_start','clip_end'): data.keyframe_insert(prop,frame=frame)
    scene.render.filepath=os.path.join(out,'frames','frame_%06d.png'%index)
    bpy.ops.render.render(write_still=True)
    print('PREVIS_PROGRESS %d %d'%(frame,count),flush=True)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'scene.blend'))
`;
