import numpy as np, json, sys

def hullp(pts):
    pts=sorted(map(tuple,pts))
    def cr(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo=[];up=[]
    for p in pts:
        while len(lo)>=2 and cr(lo[-2],lo[-1],p)<=0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up)>=2 and cr(up[-2],up[-1],p)<=0: up.pop()
        up.append(p)
    return np.array(lo[:-1]+up[:-1])
out={}
for sex in 'mf':
    Z=np.load(f'human_{sex}.npz'); P=Z['P']; n=list(Z['names']); H=Z['newH']
    body=np.arange(P.shape[0])  # assume body verts first; restrict below by masks
    BV=np.unique(Z['f_body']); P=P[BV]
    keys=[k[2:] for k in Z.files if k.startswith('k_')]
    yb=lambda b:H[n.index(b)][1]
    def perim(pts):
        if len(pts)<5: return 0
        v=hullp(pts); return np.sum(np.linalg.norm(v-np.roll(v,1,0),axis=1))
    def meas(Q):
        r={}
        def ring(y0,xmax,xmin=-9):
            m=(abs(Q[:,1]-y0)<0.008)&(Q[:,0]<xmax)&(Q[:,0]>xmin)&(abs(Q[:,2])<0.3); return perim(Q[m][:,[0,2]])
        r['waist']=ring(yb('spine_02')-0.02,0.2,-0.2)
        r['hips']=ring(yb('pelvis')-0.06,0.25,-0.25)
        r['chest']=ring(yb('spine_03')+0.08,0.17,-0.17)
        r['thigh']=ring(yb('thigh_l')-0.12,0.3,0.0)
        ua=H[n.index('upperarm_l')]; la=H[n.index('lowerarm_l')]; xm=(ua[0]+la[0])/2
        m=(abs(Q[:,0]-xm)<0.008)&(abs(Q[:,1]-ua[1])<0.12); r['arm']=perim(Q[m][:,[1,2]])
        m=(abs(Q[:,1]-(ua[1]-0.05))<0.01)&(abs(Q[:,0])<0.3); r['shoulder']=Q[m][:,0].max()-Q[m][:,0].min()
        r['belly']=Q[(abs(Q[:,1]-(yb('spine_01')+0.03))<0.02)&(abs(Q[:,0])<0.08)][:,2].max()
        return r
    m0=meas(P); res={'base':m0}
    for k in keys:
        D=Z['k_'+k]; idx=Z['i_'+k] if ('i_'+k) in Z.files else None
        Q=P.copy()
        Q=P+D[BV]
        m1=meas(Q); res[k]={a:round((m1[a]-m0[a])/m0[a],4) if a!='belly' else round(m1[a]-m0[a],4) for a in m0}
    out[sex]=res
print(json.dumps(out,indent=0))
