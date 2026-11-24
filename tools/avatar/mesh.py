import bpy, json, sys, numpy as np, mathutils, bmesh
argv=sys.argv[sys.argv.index('--')+1:]
SEX=argv[0]; OUT=argv[1]
Z=np.load(f'/tmp/hb/human_{SEX}.npz'); INFO=json.load(open(f'/tmp/hb/human_{SEX}_info.json'))
names=list(Z['names']); P=Z['P']; W=Z['W']; newH=Z['newH']; newT=Z['newT']
keys=[k[2:] for k in Z.files if k.startswith('k_')]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/tmp/assets/ual2/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb")
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; arm.name='Armature'
for o in list(bpy.data.objects):
    if o!=arm: bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
arm.animation_data_clear()
toB=lambda v: mathutils.Vector((v[0], -v[2], v[1]))   # glTF (x, y up, z front) → Blender (x, -z, y)
bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='EDIT')
eb=arm.data.edit_bones
idx={n:i for i,n in enumerate(names)}
for b in eb:
    if b.name in idx:
        i=idx[b.name]; d=(b.tail-b.head).normalized(); L=(toB(newT[i])-toB(newH[i])).length
        roll=b.roll; b.head=toB(newH[i]); b.tail=b.head+d*max(L,0.01); b.roll=roll
for b in eb:   # leaf bones follow their parent
    if b.name not in idx and b.parent is not None:
        d=(b.tail-b.head).normalized(); L=(b.tail-b.head).length; roll=b.roll
        b.head=b.parent.tail; b.tail=b.head+d*L; b.roll=roll
# eye bones (not animated by the clips; driven at runtime for blinks of the gaze)
for s in ('L','R'):
    c=INFO['info']['eye'+s]['c']; e=eb.new('eye_'+s.lower()); e.head=toB(c); e.tail=toB([c[0],c[1],c[2]+0.02]); e.parent=eb['Head']
bpy.ops.object.mode_set(mode='OBJECT')
# ---- mesh from parts
F={k[2:]:Z[k] for k in Z.files if k.startswith('f_')}
NV=len(P)
# vertex normals (for the clothes offset)
Nrm=np.zeros_like(P)
tri=F['body']; fn=np.cross(P[tri[:,1]]-P[tri[:,0]],P[tri[:,2]]-P[tri[:,0]])
for k in range(3): np.add.at(Nrm,tri[:,k],fn)
Nrm/=np.maximum(np.linalg.norm(Nrm,axis=1,keepdims=True),1e-9)
bix=lambda n: idx[n]
def wsum(v,bs): return sum(W[v,bix(b)] for b in bs)
yk=newH[bix('calf_l')][1]; yh=newH[bix('pelvis')][1]; ywaist=newH[bix('spine_01')][1]+0.04
armB=[b for b in names if b.startswith(('upperarm','lowerarm','hand','thumb','index','middle','ring','pinky','clavicle'))]
cent=P[tri].mean(1)
shortsF=[i for i,f in enumerate(tri) if yk+0.42*(yh-yk) < cent[i,1] < ywaist-0.005 and wsum(f[0],armB)<0.05]
partsOut=[('body',tri,None)]
newVerts=[]  # (source index, offset)
def dup(faces,offset,mat):
    vs=np.unique(faces); m={v:NV+len(newVerts)+i for i,v in enumerate(vs)}
    for v in vs: newVerts.append((v,offset))
    partsOut.append((mat,np.vectorize(m.get)(faces),None))
dup(tri[shortsF],0.006,'cloth')
if SEX=='f':
    ych=newH[bix('spine_03')][1]
    topF=[i for i,f in enumerate(tri) if ych-0.05 < cent[i,1] < ych+0.1 and wsum(f[0],armB)<0.08 and wsum(f[1],armB)<0.08]
    dup(tri[topF],0.005,'cloth')
ec=np.array(INFO['info']['eyeL']['c'])
hw=W[:,bix('Head')]
hairF=[i for i,f in enumerate(tri) if min(hw[f])>0.85 and (cent[i,1]>ec[1]+0.05 or (cent[i,1]>ec[1]-0.035 and cent[i,2]<ec[2]-0.085)) and not (abs(cent[i,0])>0.07 and cent[i,1]<ec[1]+0.03 and cent[i,2]>ec[2]-0.12)]
dup(tri[hairF],0.007,'hair')
partsOut.append(('eye',F['eyeL'],'eye_l')); partsOut.append(('eye',F['eyeR'],'eye_r'))
src=np.array([v for v,_ in newVerts]); offs=np.array([o for _,o in newVerts])
PA=np.concatenate([P, P[src]+Nrm[src]*offs[:,None]])
# hair: push the scalp helper out a little
WA=np.concatenate([W,W[src]])
KA={k:np.concatenate([Z['k_'+k],Z['k_'+k][src]]) for k in keys}
used=np.unique(np.concatenate([p[1].ravel() for p in partsOut]))
remap=-np.ones(len(PA),int); remap[used]=np.arange(len(used))
me=bpy.data.meshes.new('Human')
verts=[tuple(toB(PA[i])) for i in used]
faces=[]; fmat=[]
mats=['skin','cloth','hair','eye']
for mat,fs,_ in partsOut:
    for f in fs: faces.append([int(remap[x]) for x in f]); fmat.append(mats.index(mat) if mat!='body' else 0)
me.from_pydata(verts,[],faces); me.update()
for m in mats:
    mm=bpy.data.materials.new(m); mm.use_nodes=True
    col={'skin':(0.85,0.62,0.5,1),'cloth':(0.12,0.1,0.2,1),'hair':(0.15,0.09,0.05,1),'eye':(0.95,0.95,0.95,1)}[m]
    bsdf=mm.node_tree.nodes['Principled BSDF']; bsdf.inputs['Base Color'].default_value=col; bsdf.inputs['Roughness'].default_value=0.6
    me.materials.append(mm)
for i,p in enumerate(me.polygons): p.material_index=fmat[i]; p.use_smooth=True
ob=bpy.data.objects.new('Human',me); bpy.context.collection.objects.link(ob)
irisM=bpy.data.materials.new('iris'); irisM.use_nodes=True; irisM.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.12,0.07,0.04,1); irisM.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=0.25
me.materials.append(irisM)
irisObjs=[]
for s_ in ('L','R'):
    c=np.array(INFO['info']['eye'+s_]['c']); r=np.array(INFO['info']['eye'+s_]['r'])
    bm=bmesh.new(); bmesh.ops.create_uvsphere(bm,u_segments=16,v_segments=8,radius=1.0)
    for v in bm.verts: v.co=mathutils.Vector((v.co.x*r[0]*0.5, v.co.y*r[1]*0.5, v.co.z*0.12*r[2]))
    for v in bm.verts: v.co=toB(c+np.array([v.co.x, v.co.y, v.co.z+r[2]*0.86]))
    m2=bpy.data.meshes.new('iris'+s_); bm.to_mesh(m2); bm.free()
    o2=bpy.data.objects.new('iris'+s_,m2); bpy.context.collection.objects.link(o2); m2.materials.append(irisM)
    for p in m2.polygons: p.use_smooth=True
    g=o2.vertex_groups.new(name='eye_'+s_.lower()); g.add(list(range(len(m2.vertices))),1.0,'REPLACE')
    irisObjs.append(o2)
# weights: top 4 per vertex; eyes rigid on the eye bones
eyeV={'eye_l':np.unique(F['eyeL']),'eye_r':np.unique(F['eyeR'])}
groups={n:ob.vertex_groups.new(name=n) for n in names}
for n in ('eye_l','eye_r'): groups[n]=ob.vertex_groups.new(name=n)
eyeset={}
for n,vs in eyeV.items():
    for v in vs: eyeset[v]=n
for newi,oldi in enumerate(used):
    if oldi in eyeset: groups[eyeset[oldi]].add([newi],1.0,'REPLACE'); continue
    w=WA[oldi]; top=np.argsort(-w)[:4]; s=w[top].sum()
    for j in top:
        if w[j]>0.002: groups[names[j]].add([newi],float(w[j]/s),'REPLACE')
# shape keys
ob.shape_key_add(name='Basis')
for k in keys:
    sk=ob.shape_key_add(name=k); d=KA[k][used]
    for i,v in enumerate(sk.data): v.co=v.co+toB(d[i])
# blink: rotate upper-lid vertices (MH orbicularis weights) down around each eye centre
lw=INFO['lidw']
for s in ('L','R'):
    c=np.array(INFO['info']['eye'+s]['c']); r=np.array(INFO['info']['eye'+s]['r'])
    pass
sk=ob.shape_key_add(name='blink')
ws=np.zeros(NV)
for b in ('orbicularis03.L','orbicularis03.R'):
    for i,w in lw.get(b,[]):
        ws[i]=max(ws[i],w)
for newi,oldi in enumerate(used):
    if oldi>=NV or oldi in eyeset: continue
    w=ws[oldi]
    if w<=0.01: continue
    p=PA[oldi]
    s='L' if p[0]>0 else 'R'
    c=np.array(INFO['info']['eye'+s]['c'])
    ang=0.8*w
    q=p-c; y=q[1]*np.cos(ang)-q[2]*np.sin(ang); z=q[1]*np.sin(ang)+q[2]*np.cos(ang)
    np2=c+np.array([q[0],y,z])
    sk.data[newi].co=toB(np2)
ob.parent=arm; mod=ob.modifiers.new('Armature','ARMATURE'); mod.object=arm
for o2 in irisObjs:
    # shape keys must match to join: give the iris the same (zero) keys, then join into the body mesh
    pass
bpy.ops.object.select_all(action='DESELECT')
for o2 in irisObjs: o2.select_set(True)
ob.select_set(True); bpy.context.view_layer.objects.active=ob
bpy.ops.object.join()
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False, export_skins=True, export_morph=True, export_morph_normal=False, export_def_bones=False, export_apply=False)
print('exported',OUT,'verts',len(verts),'faces',len(faces),'keys',keys)
