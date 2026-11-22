// Runs inside the existing isolated Blender job. No network access or user code.
export default String.raw`
if job.get('bake'):
    import bmesh
    from mathutils.bvhtree import BVHTree
    options=job['bake']; samples=options['samples']; distance=options['distance']
    moving={track['objectId'] for track in plan['tracks']}
    eligible=[value for value in doc['objectList'] if value['objType']!='mannequin' and value.get('stageRole')!='character']
    if not eligible: raise ValueError('没有可烘焙的场景或道具；人物不参与烘焙')
    bpy.context.view_layer.update()
    prepared={}; staticVertices=[]; staticFaces=[]; totalTriangles=0
    originalTriangles=sum(sum(max(0,len(face.vertices)-2) for face in child.data.polygons) for value in eligible for child in objects[value['threeJsonId']][0].children_recursive if child.type=='MESH')
    extraBudget=max(0,160000-originalTriangles)
    for value in eligible:
        root=objects[value['threeJsonId']][0]; meshes=[]
        objectTriangles=sum(sum(max(0,len(face.vertices)-2) for face in child.data.polygons) for child in root.children_recursive if child.type=="MESH")
        for child in root.children_recursive:
            if child.type!='MESH': continue
            data=child.data.copy(); bm=bmesh.new(); bm.from_mesh(data)
            baseCount=sum(max(0,len(face.verts)-2) for face in bm.faces)
            cuts=(1 if samples==16 else 2 if samples==32 else 3) if baseCount<1000 else 0
            while cuts and (baseCount*((cuts+1)**2-1)>extraBudget or objectTriangles+baseCount*((cuts+1)**2-1)>20000): cuts-=1
            if cuts: bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=cuts,use_grid_fill=True)
            bmesh.ops.triangulate(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free(); data.update()
            extra=max(0,len(data.polygons)-baseCount); extraBudget-=extra; objectTriangles+=extra
            if len(data.polygons)>20000: raise ValueError('单个烘焙模型超过2万三角面，请先简化模型')
            meshes.append((child,data))
        count=sum(len(data.polygons) for child,data in meshes); totalTriangles+=count
        if count>20000 or totalTriangles>160000: raise ValueError('烘焙网格超过烘焙16万三角面上限，请降低质量或简化模型')
        prepared[value['threeJsonId']]=meshes
        if value.get('stageRole')=='environment' and value['threeJsonId'] not in moving and not value.get('attachment'):
            for child,data in meshes:
                offset=len(staticVertices); staticVertices.extend(child.matrix_world @ vertex.co for vertex in data.vertices)
                staticFaces.extend(tuple(offset+i for i in face.vertices) for face in data.polygons)
    staticTree=BVHTree.FromPolygons(staticVertices,staticFaces,all_triangles=True) if staticFaces else None
    output=[]; completed=0; total=sum(len(data.polygons)*3 for meshes in prepared.values() for child,data in meshes)
    for value in eligible:
        objectId=value['threeJsonId']; root=objects[objectId][0]; meshes=prepared[objectId]
        vertices=[]; faces=[]
        for child,data in meshes:
            offset=len(vertices); vertices.extend(child.matrix_world @ vertex.co for vertex in data.vertices)
            faces.extend(tuple(offset+i for i in face.vertices) for face in data.polygons)
        selfTree=BVHTree.FromPolygons(vertices,faces,all_triangles=True)
        useStatic=value.get('stageRole')=='environment' and objectId not in moving and not value.get('attachment')
        tree=staticTree if useStatic and staticTree else selfTree
        parts={}; cache={}
        sourceParts=next(item for item in preset_catalog if item['id']==value['presetId'])['parts'] if value['objType']=='preset' else value.get('meshParts',[])
        for child,data in meshes:
            local=root.matrix_world.inverted() @ child.matrix_world
            normalMatrix=child.matrix_world.to_3x3().inverted().transposed()
            for face in data.polygons:
                color=sourceParts[face.material_index]['color'] if sourceParts and face.material_index<len(sourceParts) else '#ffffff'
                part=parts.setdefault(color,{'positions':[],'indices':[],'color':color,'ao':[]})
                normal=(normalMatrix @ face.normal).normalized(); center=child.matrix_world @ face.center
                tangent=normal.cross(Vector((0,0,1)) if abs(normal.z)<.9 else Vector((0,1,0))).normalized(); bitangent=normal.cross(tangent)
                for index in face.vertices:
                    vertex=data.vertices[index]; position=child.matrix_world @ vertex.co
                    origin=position.lerp(center,.002)+normal*max(.0002,distance*.0005)
                    key=tuple(round(v,5) for v in (*origin,*normal))
                    if key not in cache:
                        blocked=0
                        for sample in range(samples):
                            radius=math.sqrt((sample+.5)/samples); angle=sample*2.399963229728653
                            direction=tangent*(radius*cos(angle))+bitangent*(radius*sin(angle))+normal*math.sqrt(1-radius*radius)
                            hit=tree.ray_cast(origin,direction,distance)
                            if hit[0] is not None: blocked+=1
                        cache[key]=round(1-blocked/samples,4)
                    point=local @ vertex.co
                    part['indices'].append(len(part['positions'])//3)
                    part['positions'].extend(round(component,6) for component in point); part['ao'].append(cache[key])
                    completed+=1
                    if completed%3000==0: print('PREVIS_PROGRESS %d %d'%(completed,total),flush=True)
        if parts: output.append({'objectId':objectId,'parts':list(parts.values())})
    with open(os.path.join(out,'bake.json'),'w',encoding='utf-8') as file: json.dump(output,file,separators=(',',':'))
    print('PREVIS_PROGRESS 1 1',flush=True)
    # Normal exit; do not run the camera/video renderer for an AO job.
    sys.exit(0)
`;
