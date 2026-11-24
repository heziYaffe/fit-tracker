# Build a MakeHuman (CC0) body re-posed into the UAL (CC0) T-pose, with body shape keys and UAL bone weights.
import json, numpy as np, sys
D='/tmp/mh/makehuman/data/'
SEX=sys.argv[1] if len(sys.argv)>1 else 'm'
V=[];G={};cur=None;F={}
for l in open(D+'3dobjs/base.obj'):
    if l.startswith('v '): V.append([float(x) for x in l.split()[1:4]])
    elif l.startswith('g '): cur=l.split()[1]; G.setdefault(cur,set())
    elif l.startswith('f '):
        idx=[int(p.split('/')[0])-1 for p in l.split()[1:]]
        G[cur].update(idx); F.setdefault(cur,[]).append(idx)
V0=np.array(V)
def tgt(path):
    d=np.zeros_like(V0)
    for l in open(D+'targets/'+path):
        if l.startswith('#') or not l.strip(): continue
        p=l.split(); d[int(p[0])]=[float(p[1]),float(p[2]),float(p[3])]
    return d
g='male' if SEX=='m' else 'female'
base=V0.copy()
for race in ['caucasian','african','asian']: base+=tgt(f'macrodetails/{race}-{g}-young.target')/3
if SEX=='f':
    base+=tgt('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target')*0.3 if False else 0
U=f'macrodetails/universal-{g}-young-'
keys={
 'weightUp':tgt(U+'averagemuscle-maxweight.target'),
 'weightDown':tgt(U+'averagemuscle-minweight.target'),
 'muscleUp':tgt(U+'maxmuscle-averageweight.target'),
 'muscleDown':tgt(U+'minmuscle-averageweight.target'),
 'waist':tgt('measure/measure-waist-circ-incr.target'),
 'belly':tgt('stomach/stomach-pregnant-incr.target'),
 'chest':tgt('measure/measure-bust-circ-incr.target'),
 'hips':tgt('measure/measure-hips-circ-incr.target'),
 'thighs':tgt('measure/measure-thigh-circ-incr.target'),
 'arms':tgt('measure/measure-upperarm-circ-incr.target'),
 'shoulders':tgt('measure/measure-shoulder-dist-incr.target'),
}
sk=json.load(open(D+'rigs/default.mhskel'))
J={k:base[v].mean(0) for k,v in sk['joints'].items()}
MB=sk['bones']
def H(b): return J[MB[b]['head']]
def T(b): return J[MB[b]['tail']]
# ---- UAL bone ← MH bones
M={'pelvis':['root','spine05','pelvis.L','pelvis.R'],'spine_01':['spine04','spine03'],'spine_02':['spine02'],'spine_03':['spine01','breast.L','breast.R'],
   'neck_01':['neck01','neck02','neck03']}
headset=['head','jaw','special01','special03','special04']+[b for b in MB if any(b.startswith(p) for p in ['eye','oculi','orbicularis','oris','levator','risorius','temporalis','tongue','special0'])]
M['Head']=list(dict.fromkeys(headset))
for s,S in (('l','L'),('r','R')):
    M[f'clavicle_{s}']=[f'clavicle.{S}',f'shoulder01.{S}']
    M[f'upperarm_{s}']=[f'upperarm01.{S}',f'upperarm02.{S}']
    M[f'lowerarm_{s}']=[f'lowerarm01.{S}',f'lowerarm02.{S}']
    M[f'hand_{s}']=[f'wrist.{S}']+[f'metacarpal{i}.{S}' for i in range(1,5)]
    for n,fi in (('thumb',1),('index',2),('middle',3),('ring',4),('pinky',5)):
        for k in (1,2,3): M[f'{n}_0{k}_{s}']=[f'finger{fi}-{k}.{S}']
    M[f'thigh_{s}']=[f'upperleg01.{S}',f'upperleg02.{S}']
    M[f'calf_{s}']=[f'lowerleg01.{S}',f'lowerleg02.{S}']
    M[f'foot_{s}']=[f'foot.{S}']
    M[f'ball_{s}']=[b for b in MB if b.startswith('toe') and b.endswith('.'+S)]
mh2u={}
for u,l in M.items():
    for b in l: mh2u[b]=u
missing=[b for b in MB if b not in mh2u]
assert not missing, missing
# MH-pose head/tail per UAL bone
mhHT={'pelvis':(H('spine05'),T('spine05')),'spine_01':(H('spine04'),T('spine03')),'spine_02':(H('spine02'),T('spine02')),'spine_03':(H('spine01'),T('spine01')),
      'neck_01':(H('neck01'),T('neck03')),'Head':(H('head'),T('head'))}
for s,S in (('l','L'),('r','R')):
    mhHT[f'clavicle_{s}']=(H(f'clavicle.{S}'),T(f'shoulder01.{S}'))
    mhHT[f'upperarm_{s}']=(H(f'upperarm01.{S}'),T(f'upperarm02.{S}'))
    mhHT[f'lowerarm_{s}']=(H(f'lowerarm01.{S}'),T(f'lowerarm02.{S}'))
    mhHT[f'hand_{s}']=(H(f'wrist.{S}'),H(f'finger3-1.{S}'))
    for n,fi in (('thumb',1),('index',2),('middle',3),('ring',4),('pinky',5)):
        for k in (1,2,3): mhHT[f'{n}_0{k}_{s}']=(H(f'finger{fi}-{k}.{S}'),T(f'finger{fi}-{k}.{S}'))
    mhHT[f'thigh_{s}']=(H(f'upperleg01.{S}'),T(f'upperleg02.{S}'))
    mhHT[f'calf_{s}']=(H(f'lowerleg01.{S}'),T(f'lowerleg02.{S}'))
    toes=[H(f'toe{i}-1.{S}') for i in range(1,6)]
    mhHT[f'foot_{s}']=(H(f'foot.{S}'),np.mean(toes,0))
    mhHT[f'ball_{s}']=(np.mean(toes,0),T(f'toe3-3.{S}') if f'toe3-3.{S}' in MB else np.mean([T(f'toe{i}-2.{S}') for i in range(2,5)],0))
UAL=json.load(open('/tmp/ualrest.json'))
def nrm(v): return v/np.linalg.norm(v)
def rmin(a,b):
    a=nrm(a);b=nrm(b);v=np.cross(a,b);c=float(np.dot(a,b))
    if c<-0.9999: return -np.eye(3)
    K=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+K+K@K*(1/(1+c))
udir=lambda b: nrm(np.array(UAL[b]['t'])-np.array(UAL[b]['h']))
# re-pose chains: arms from upperarm, legs from thigh; spine/clavicle/head unchanged
R={b:np.eye(3) for b in mhHT}
newH={};newT={}
order=['pelvis','spine_01','spine_02','spine_03','neck_01','Head']
for s in 'lr':
    order+= [f'clavicle_{s}',f'upperarm_{s}',f'lowerarm_{s}',f'hand_{s}']+[f'{n}_0{k}_{s}' for n in ('thumb','index','middle','ring','pinky') for k in (1,2,3)]+[f'thigh_{s}',f'calf_{s}',f'foot_{s}',f'ball_{s}']
parentU=lambda b: UAL[b]['p']
for b in order:
    h,t=mhHT[b]; p=parentU(b)
    repose = any(b.startswith(x) for x in ('upperarm','lowerarm','hand','thumb','index','middle','ring','pinky','thigh','calf','foot','ball'))
    Rp=R.get(p,np.eye(3)) if p in mhHT else np.eye(3)
    if repose:
        d=Rp@(t-h); R[b]=rmin(d,udir(b))@Rp
    else: R[b]=Rp if False else np.eye(3)
    # new head: transform MH head by the parent's posed transform
    if p in newH and repose:
        ph=mhHT[p][0]; newH[b]=newH[p]+R[p]@(h-ph)
    else: newH[b]=h.copy()
    newT[b]=newH[b]+R[b]@(t-h)
# twist report for hands
for s in 'lr':
    a=nrm(mhHT[f'pinky_01_{s}'][0]-mhHT[f'index_01_{s}'][0]); a2=R[f'hand_{s}']@a
    u=nrm(np.array(UAL[f'pinky_01_{s}']['h'])-np.array(UAL[f'index_01_{s}']['h']))
    print('hand across-axis posed',a2.round(2),'ual',u.round(2))
# ---- weights
W=json.load(open(D+'rigs/default_weights.mhw'))['weights']
names=sorted(mhHT.keys()); bi={b:i for i,b in enumerate(names)}
NV=len(V0); Wm=np.zeros((NV,len(names)))
for b,lst in W.items():
    u=mh2u.get(b)
    if u is None: continue
    for i,w in lst: Wm[i,bi[u]]+=w
s=Wm.sum(1); print('unweighted verts',(s==0).sum())
Wm[s==0,bi['pelvis']]=1; Wm/=Wm.sum(1,keepdims=True)
# LBS repose: v' = Σ w_b (newH_b + R_b (v - h_b))
Hm=np.array([mhHT[b][0] for b in names]); Hn=np.array([newH[b] for b in names]); Rs=np.array([R[b] for b in names])
def pose_pts(P):
    out=np.zeros_like(P)
    for j in range(len(names)):
        w=Wm[:,j]; m=w>0
        if not m.any(): continue
        out[m]+=w[m,None]*(Hn[j]+(P[m]-Hm[j])@Rs[j].T)
    return out
def pose_vec(Dv):
    out=np.zeros_like(Dv)
    for j in range(len(names)):
        w=Wm[:,j]; m=w>0
        if m.any(): out[m]+=w[m,None]*(Dv[m]@Rs[j].T)
    return out
P=pose_pts(base)
K={k:pose_vec(v) for k,v in keys.items()}
# ---- parts
body=np.array([f for f in F['body']])
def tri(fs):
    t=[]
    for f in fs:
        for i in range(1,len(f)-1): t.append([f[0],f[i],f[i+1]])
    return np.array(t)
parts={'body':tri(F['body']),'hair':tri(F['helper-hair']),'eyeL':tri(F['helper-l-eye']),'eyeR':tri(F['helper-r-eye'])}
# scale: MH decimeters → metres, height normalized to 1.75 m, feet on the ground
bodyIdx=np.unique(parts['body'])
ymin=P[bodyIdx,1].min(); ymax=P[bodyIdx,1].max(); sc=1.75/(ymax-ymin)
off=np.array([0,-ymin,0])
P=(P+off)*sc; K={k:v*sc for k,v in K.items()}
for b in names: newH[b]=(newH[b]+off)*sc; newT[b]=(newT[b]+off)*sc
# eyes / upper-lid info for the blink key (MH weights of the upper-lid muscles)
info={}
for s,S in (('L','l'),('R','r')):
    e=np.unique(parts['eye'+s]); c=P[e].mean(0); r=np.abs(P[e]-c).max(0)
    info['eye'+s]={'c':c.tolist(),'r':r.tolist()}
lid=np.zeros(NV)
for b in ('orbicularis03.L','orbicularis03.R','orbicularis04.L','orbicularis04.R'):
    js=[J[MB[b]['head']][1], J[MB[b]['tail']][1]]
    info[b]=[(x+off[1])*sc for x in js]
np.savez(f'/tmp/hb/human_{SEX}.npz',P=P,W=Wm,names=np.array(names),**{'k_'+k:v for k,v in K.items()},**{'f_'+k:v for k,v in parts.items()},
         newH=np.array([newH[b] for b in names]),newT=np.array([newT[b] for b in names]))
mhw={b:[ [i,w] for i,w in W[b]] for b in ('orbicularis03.L','orbicularis03.R','orbicularis04.L','orbicularis04.R') if b in W}
json.dump({'info':info,'lidw':mhw,'scale':sc},open(f'/tmp/hb/human_{SEX}_info.json','w'))
print('done',SEX,'verts',NV,'scale',sc,'pelvis',newH['pelvis'],'hand_l',newH['hand_l'],'ual hand',UAL['hand_l']['h'])
