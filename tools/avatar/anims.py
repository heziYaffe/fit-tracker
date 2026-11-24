import bpy, json, mathutils
bpy.ops.wm.read_factory_settings(use_empty=True)
U2="/tmp/assets/ual2/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb"
U1="/tmp/assets/ual1/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb"
bpy.ops.import_scene.gltf(filepath=U2)
a2=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; a2.name='UAL2'
acts2=set(bpy.data.actions.keys())
bpy.ops.import_scene.gltf(filepath=U1)
a1=[o for o in bpy.data.objects if o.type=='ARMATURE' and o!=a2][0]; a1.name='UAL1'
MAP={'DEF-hips':'pelvis','DEF-spine.001':'spine_01','DEF-spine.002':'spine_02','DEF-spine.003':'spine_03','DEF-neck':'neck_01','DEF-head':'Head','root':'root'}
for s,S in (('l','L'),('r','R')):
    MAP.update({f'DEF-shoulder.{S}':f'clavicle_{s}',f'DEF-upper_arm.{S}':f'upperarm_{s}',f'DEF-forearm.{S}':f'lowerarm_{s}',f'DEF-hand.{S}':f'hand_{s}',
      f'DEF-thigh.{S}':f'thigh_{s}',f'DEF-shin.{S}':f'calf_{s}',f'DEF-foot.{S}':f'foot_{s}',f'DEF-toe.{S}':f'ball_{s}'})
    for f in ('index','middle','ring','pinky'):
        for k in (1,2,3): MAP[f'DEF-f_{f}.0{k}.{S}']=f'{f}_0{k}_{s}'
    for k in (1,2,3): MAP[f'DEF-thumb.0{k}.{S}']=f'thumb_0{k}_{s}'
# compare rest frames
worst=0
for o,n in MAP.items():
    b1=a1.data.bones.get(o); b2=a2.data.bones.get(n)
    if not b1 or not b2: print('missing',o,n); continue
    q1=b1.matrix_local.to_quaternion(); q2=b2.matrix_local.to_quaternion()
    ang=q1.rotation_difference(q2).angle; d=(b1.head_local-b2.head_local).length
    worst=max(worst,ang)
    if ang>0.05 or d>0.02: print('rest diff',n,round(ang,3),round(d,3))
print('worst rest angle',worst)
print('UAL1 actions',[a.name for a in bpy.data.actions if a.name not in acts2][:3])
import sys
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUT=argv[0] if argv else '/tmp/hb/anims_all.glb'
KEEP=json.loads(argv[1]) if len(argv)>1 else None
# retarget UAL1 actions onto UAL2 names
for act in list(bpy.data.actions):
    if act.name in acts2: continue
    for fc in act.fcurves:
        p=fc.data_path
        if p.startswith('pose.bones["'):
            bn=p.split('"')[1]
            if bn in MAP: fc.data_path=p.replace('"'+bn+'"','"'+MAP[bn]+'"')
for o in list(bpy.data.objects):
    if o!=a2: bpy.data.objects.remove(o, do_unlink=True)
names={}
for act in list(bpy.data.actions):
    n=act.name.replace('_Armature','').replace('_Rig','')
    if KEEP is not None and n not in KEEP: bpy.data.actions.remove(act); continue
    act.name=KEEP[n] if isinstance(KEEP,dict) else n
    act.use_fake_user=True
print('actions',[a.name for a in bpy.data.actions])
a2.animation_data_create()
for t in list(a2.animation_data.nla_tracks): a2.animation_data.nla_tracks.remove(t)
a2.animation_data.action=None
# push every action to an NLA track so the exporter writes them all
for act in bpy.data.actions:
    tr=a2.animation_data.nla_tracks.new(); tr.name=act.name; tr.strips.new(act.name, int(act.frame_range[0]), act)
bpy.ops.object.select_all(action='DESELECT'); a2.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True, export_morph=False, export_def_bones=False, export_optimize_animation_size=True)
print('exported',OUT)
