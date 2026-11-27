import sys, struct, time
sys.path.insert(0, r"C:\Dev\Lucid\lucid")
import poe_files as pf
t=time.time()
idx=pf.decompress_bundle(open(r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile\Bundles2\_.index.bin","rb").read())
dt=time.time()-t
p=4; n=struct.unpack_from("<I",idx,0)[0]; ok=True
for i in range(n):
    ln=struct.unpack_from("<I",idx,p)[0]
    try: idx[p+4:p+4+ln].decode()
    except Exception: ok=False; break
    p+=4+ln+4
print("ok" if ok else "CORRUPT", "%.2fs" % dt)
