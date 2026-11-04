"""Original branded link cards; Arabic shaped with Pillow/RAQM. No customer photos."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
out=root/'public/social';out.mkdir(exist_ok=True)
regular='C:/Windows/Fonts/arial.ttf';bold='C:/Windows/Fonts/arialbd.ttf'
def font(size,weight=True):return ImageFont.truetype(bold if weight else regular,size)
def card(key,title,subtitle,tag):
 im=Image.new('RGB',(1200,630),'#123e32');d=ImageDraw.Draw(im)
 # A light route and neighborhood blocks reinforce the map identity.
 for x,y,w,h in [(35,65,135,98),(220,25,130,150),(30,220,95,110),(175,240,150,125),(85,432,110,130),(280,460,110,105)]:
  d.rounded_rectangle((x,y,x+w,y+h),radius=20,fill='#1c4a3c',outline='#2d5a47',width=2)
 d.line([(0,392),(160,392),(160,195),(365,195),(365,90)],fill='#769665',width=9,joint='curve')
 for x,y in [(160,392),(365,90)]:d.ellipse((x-17,y-17,x+17,y+17),fill='#d1f36a');d.ellipse((x-6,y-6,x+6,y+6),fill='#123e32')
 d.rounded_rectangle((438,40,1152,590),radius=32,fill='#f7f6ed')
 d.rounded_rectangle((1000,75,1112,187),radius=28,fill='#123e32')
 # Faithful vector interpretation of the project's existing house/location icon.
 d.line([(1030,137),(1030,116),(1056,98),(1082,116),(1082,148)],fill='#d1f36a',width=7,joint='curve')
 d.arc((1030,128,1082,170),0,180,fill='#d1f36a',width=7)
 d.ellipse((1048,127,1064,143),fill='#d1f36a')
 d.text((974,79),'جوه',font=font(69),fill='#123e32',anchor='ra',direction='rtl')
 d.text((974,156),'كل كيان أقرب ليك',font=font(25,False),fill='#557061',anchor='ra',direction='rtl')
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
 d.text((48,574),'JOWWA / KAYAN',font=font(20),fill='#b4c7b4')
 im.save(out/(key+'.png'),optimize=True)
for args in [('home','كل كيان.. في مكان واحد','خريطة العمارات • الباصات • الخدمات','خريطة ومشاوير وخدمات'),('places','محتاج إيه جوه كيان؟','أرقام تواصل • مواقع • مصادر واضحة','دليل الأماكن والخدمات'),('buses','اعرف خطك. قبل ما تتحرك.','مواعيد الذهاب والعودة بمصادرها','دليل باصات كيان'),('market','خدمات ومنتجات من أهل كيان','تواصل مع البائع وأكد التوفر','سوق جوه'),('service','خدمة من أهل كيان','التفاصيل والتواصل داخل الرابط','سوق جوه • خدمة ومنتج'),('seller','بروفايل بائع على جوه','منتجات وخدمات وطرق تواصل','أهل كيان')]:card(*args)
for p in json.loads((root/'public/data/places.json').read_text('utf-8')):
 card(p['id'],p['name'],'التفاصيل والتواصل ومصدر المعلومة',p['category']+' • دليل جوه')
print('Generated',len(list(out.glob('*.png'))),'Arabic social cards at 1200 x 630')
