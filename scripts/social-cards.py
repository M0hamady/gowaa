"""Branded 1200x630 link cards in the site font (Cairo), Arabic shaped with Pillow/RAQM.
A place with its own reviewed shop photos shows them in the card; never customer photos."""
from PIL import Image,ImageDraw,ImageFont,ImageOps
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
out=root/'public/social';out.mkdir(exist_ok=True)
regular=str(root/'scripts/fonts/Cairo-400.ttf');bold=str(root/'scripts/fonts/Cairo-800.ttf')
def font(size,weight=True):return ImageFont.truetype(bold if weight else regular,size)
def photo_panel(im,photos):
 # Up to 3 shop photos in the left panel (410x550), rounded, center-cropped.
 box=(40,40,410,590);w,h=box[2]-box[0],box[3]-box[1]
 tiles=[(0,0,w,h)] if len(photos)==1 else [(0,0,w,h//2-5),(0,h//2+5,w,h)] if len(photos)==2 else [(0,0,w,int(h*.58)-5),(0,int(h*.58)+5,w//2-5,h),(w//2+5,int(h*.58)+5,w,h)]
 panel=Image.new('RGB',(w,h),'#123e32')
 for path,(x0,y0,x1,y1) in zip(photos,tiles):
  try:panel.paste(ImageOps.fit(Image.open(path).convert('RGB'),(x1-x0,y1-y0)),(x0,y0))
  except Exception:pass
 mask=Image.new('L',(w,h),0);ImageDraw.Draw(mask).rounded_rectangle((0,0,w,h),radius=28,fill=255)
 im.paste(panel,(box[0],box[1]),mask)
def card(key,title,subtitle,tag,photos=()):
 im=Image.new('RGB',(1200,630),'#123e32');d=ImageDraw.Draw(im)
 if photos:photo_panel(im,photos)
 # A light route and neighborhood blocks reinforce the map identity.
 for x,y,w,h in ([] if photos else [(35,65,135,98),(220,25,130,150),(30,220,95,110),(175,240,150,125),(85,432,110,130),(280,460,110,105)]):
  d.rounded_rectangle((x,y,x+w,y+h),radius=20,fill='#1c4a3c',outline='#2d5a47',width=2)
 if not photos:
  d.line([(0,392),(160,392),(160,195),(365,195),(365,90)],fill='#769665',width=9,joint='curve')
  for x,y in [(160,392),(365,90)]:d.ellipse((x-17,y-17,x+17,y+17),fill='#d1f36a');d.ellipse((x-6,y-6,x+6,y+6),fill='#123e32')
 d.rounded_rectangle((438,40,1152,590),radius=32,fill='#f7f6ed')
 d.rounded_rectangle((1000,75,1112,187),radius=28,fill='#123e32')
 # Faithful vector interpretation of the project's existing house/location icon.
 d.line([(1030,137),(1030,116),(1056,98),(1082,116),(1082,148)],fill='#d1f36a',width=7,joint='curve')
 d.arc((1030,128,1082,170),0,180,fill='#d1f36a',width=7)
 d.ellipse((1048,127,1064,143),fill='#d1f36a')
 d.text((974,128),'جوه',font=font(62),fill='#123e32',anchor='rs',direction='rtl')
 d.text((974,172),'كل كيان أقرب ليك',font=font(24,False),fill='#557061',anchor='rs',direction='rtl')
 d.rounded_rectangle((784,214,1112,258),radius=18,fill='#e0edc3')
 d.text((1095,218),tag,font=font(24),fill='#28553d',anchor='ra',direction='rtl')
 words=title.split();lines=[];line=''
 for word in words:
  trial=(line+' '+word).strip()
  if d.textlength(trial,font=font(49),direction='rtl')>630 and line:lines.append(line);line=word
  else:line=trial
 if line:lines.append(line)
 size=49 if len(lines)<=2 else 41
 for i,line in enumerate(lines[:3]):d.text((1104,286+i*64),line,font=font(size),fill='#123e32',anchor='ra',direction='rtl')
 d.text((1104,478),subtitle,font=font(25,False),fill='#627166',anchor='ra',direction='rtl')
 d.line([(478,531),(1112,531)],fill='#dce2d5',width=2)
 d.text((1104,552),'jowwa-kayan.vercel.app',font=font(23,False),fill='#28553d',anchor='ra')
 if not photos:d.text((48,574),'JOWWA / KAYAN',font=font(20),fill='#b4c7b4')
 im.save(out/(key+'.png'),optimize=True)
for args in [('home','كل كيان.. في مكان واحد','خريطة العمارات • الباصات • الخدمات','خريطة ومشاوير وخدمات'),('places','محتاج إيه جوه كيان؟','أرقام تواصل • مواقع • مصادر واضحة','دليل الأماكن والخدمات'),('buses','اعرف خطك. قبل ما تتحرك.','مواعيد الذهاب والعودة بمصادرها','دليل باصات كيان'),('market','خدمات ومنتجات من أهل كيان','تواصل مع البائع وأكد التوفر','سوق جوه'),('service','خدمة من أهل كيان','التفاصيل والتواصل داخل الرابط','سوق جوه • خدمة ومنتج'),('seller','بروفايل بائع على جوه','منتجات وخدمات وطرق تواصل','أهل كيان')]:card(*args)
def shop_photos(p):
 # Only reviewed shop photos stored with the site (public/menus/<slug>/photo-N.jpg).
 out=[]
 for value in [p.get('cardPhotos') or []][0]:
  f=root/'public'/value.lstrip('/')
  if value.startswith('/menus/') and f.exists():out.append(f)
 return out[:3]
for p in json.loads((root/'public/data/places.json').read_text('utf-8')):
 photos=shop_photos(p)
 card(p['id'],p['name'],'المنيو والصور والتواصل' if photos else 'التفاصيل والتواصل ومصدر المعلومة',p['category']+' • دليل جوه',photos)
print('Generated',len(list(out.glob('*.png'))),'Arabic social cards at 1200 x 630')
