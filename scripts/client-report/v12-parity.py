"""v12 웹 PDF ↔ 원본 v12 PDF 쪽별 대조(글자·숫자·픽셀).

사용:
  1) 웹 개발 서버: cd apps/web && NEXT_PUBLIC_APP_URL=http://localhost:3108 NEXT_PUBLIC_WEB_URL=http://localhost:3107 npx next dev -p 3107
  2) curl -o web.pdf "http://localhost:3107/r/dev/pdf?fixture=knowverse-v12"
  3) python3 scripts/client-report/v12-parity.py web.pdf <_v12_v4_minimal/final/노우버스_…v12….pdf> <이미지 저장 폴더>
기준(2026-09-30 실측): 11쪽 · 숫자 11/11쪽 일치 · 글자 10쪽 100%(6쪽 99.3% = 말줄임 글리프 "..."/"…" 차이) · 픽셀 차이 쪽당 ≤0.09%(72dpi, 채널차 >40).
필요: PyMuPDF(fitz), Pillow.
"""
import difflib
import re
import sys

import fitz
from PIL import Image, ImageChops
web,orig,out=sys.argv[1],sys.argv[2],sys.argv[3]
A,B=fitz.open(web),fitz.open(orig)
norm=lambda t: re.sub(r'\s+','',t)
tot_text=tot_num=0
print('쪽 | 글자일치 | 숫자일치 | 픽셀차이%(72dpi) | 차이 예시')
for i in range(max(A.page_count,B.page_count)):
    ta,tb=A[i].get_text(),B[i].get_text()
    na,nb=norm(ta),norm(tb)
    ratio=difflib.SequenceMatcher(None,na,nb,autojunk=False).ratio()
    numa,numb=re.findall(r'\d+(?:\.\d+)?',ta),re.findall(r'\d+(?:\.\d+)?',tb)
    same_nums = sorted(numa)==sorted(numb)
    pa=A[i].get_pixmap(dpi=72); pb=B[i].get_pixmap(dpi=72)
    ia=Image.frombytes('RGB',(pa.width,pa.height),pa.samples); ib=Image.frombytes('RGB',(pb.width,pb.height),pb.samples)
    if ia.size!=ib.size: ib=ib.resize(ia.size)
    diff=ImageChops.difference(ia,ib).convert('L').point(lambda v:255 if v>40 else 0)
    px=sum(1 for v in diff.getdata() if v)/ (ia.width*ia.height)*100
    
    ex=''
    if na!=nb:
        sm=difflib.SequenceMatcher(None,na,nb,autojunk=False)
        ops=[(tag,na[a1:a2][:25],nb[b1:b2][:25]) for tag,a1,a2,b1,b2 in sm.get_opcodes() if tag!='equal'][:2]
        ex=str(ops)
    if not same_nums:
        ex+=' 숫자차 web-only:'+str(sorted(set(numa)-set(numb)))[:60]+' orig-only:'+str(sorted(set(numb)-set(numa)))[:60]
    print(f'{i+1:02d} | {ratio*100:.1f}% | {"예" if same_nums else "아니오"} | {px:.2f}% | {ex[:230]}')
    ia.save(f'{out}/web_p{i+1:02d}.png'); ib.save(f'{out}/orig_p{i+1:02d}.png')
