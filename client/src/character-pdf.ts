import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
export interface PdfSection { title: string; rows?: [string, string][]; paragraphs?: string[] }
export interface CharacterPdf { name: string; subtitle: string; sections: PdfSection[] }
let fontPromise: Promise<ArrayBuffer> | undefined;
export async function buildCharacterPdf(data: CharacterPdf, fontBytes?: ArrayBuffer): Promise<Uint8Array> {
  if (!fontBytes) {
    fontPromise ??= fetch('/fonts/DMSansSC-Regular.ttf').then(response => { if (!response.ok) throw new Error('PDF 字体加载失败'); return response.arrayBuffer(); }).catch(error => { fontPromise = undefined; throw error; });
    fontBytes = await fontPromise;
  }
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // Full embedding avoids missing CJK glyphs in fontkit subsets across PDF readers.
  const font = await document.embedFont(fontBytes, { subset: false });
  const supported = new Set(font.getCharacterSet());
  const clean = (value: string) => Array.from(String(value).replace(/\r\n?/g, '\n').replace(/\t/g, '  ')).map(char => char === '\n' || supported.has(char.codePointAt(0)!) ? char : '□').join('');
  const ink = rgb(.12,.13,.12), muted = rgb(.38,.39,.36), accent = rgb(.73,.21,.15), line = rgb(.82,.83,.79);
  const width = 595.28, height = 841.89, margin = 44, contentWidth = width - margin * 2;
  let page: PDFPage, y = 0;
  const newPage = () => { page = document.addPage([width,height]); y = height - margin; page.drawRectangle({x:margin,y:y-3,width:28,height:3,color:accent}); page.drawText('DM / CHARACTER SHEET', {x:margin+40,y:y-3,size:9,font,color:muted}); y -= 34; };
  const ensure = (space: number) => { if (y - space < 52) newPage(); };
  const wrap = (text: string, size: number, maxWidth = contentWidth): string[] => {
    const lines: string[] = [];
    for (const paragraph of clean(text).split('\n')) {
      let current = '';
      for (const char of paragraph) { if (current && font.widthOfTextAtSize(current + char, size) > maxWidth) { lines.push(current); current = ''; } current += char; }
      lines.push(current);
    }
    return lines;
  };
  const text = (value: string, size = 10, color = ink, x = margin, maxWidth = contentWidth) => {
    for (const row of wrap(value || '—',size,maxWidth)) { ensure(size*1.7); page.drawText(row,{x,y:y-size,size,font,color}); y -= size*1.7; }
  };
  newPage();
  text(data.name || '未命名角色',26); y -= 4; text(data.subtitle,10,muted); y -= 18;
  data.sections.forEach((section, index) => {
    const rowHeight = (section.rows ?? []).reduce((total, [label, value]) => total + Math.max(wrap(label,10,106).length, wrap(value || '—',10,contentWidth-118).length) * 18 + 3, 0);
    ensure(Math.min(height - margin - 90, Math.max(76, rowHeight + 60))); page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.7,color:line}); y -= 13;
    text(`${String(index+1).padStart(2,'0')}  ${section.title}`,13,accent); y -= 9;
    for (const [label,value] of section.rows ?? []) {
      const valueLines = wrap(value || '—',10,contentWidth-118);
      const labelLines = wrap(label,10,106);
      const rows = Math.max(valueLines.length,labelLines.length);
      for(let i=0;i<rows;i++) { ensure(18); if(labelLines[i]) page.drawText(labelLines[i],{x:margin,y:y-10,size:10,font,color:muted}); if(valueLines[i]) page.drawText(valueLines[i],{x:margin+118,y:y-10,size:10,font,color:ink}); y -= 18; }
      y -= 3;
    }
    for (const paragraph of section.paragraphs ?? []) { text(paragraph); y -= 7; }
    y -= 14;
  });
  document.getPages().forEach((item,index) => { item.drawLine({start:{x:margin,y:36},end:{x:width-margin,y:36},thickness:.5,color:line}); item.drawText('D&D 5e / DM 追踪',{x:margin,y:22,size:8,font,color:muted}); item.drawText(`${index+1} / ${document.getPageCount()}`,{x:width-margin-35,y:22,size:8,font,color:muted}); });
  document.setTitle(`${data.name} - 角色卡`); document.setCreator('DM 追踪'); document.setLanguage('zh-CN');
  return document.save();
}
export async function downloadCharacterPdf(data: CharacterPdf): Promise<void> {
  const bytes = await buildCharacterPdf(data);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], {type:'application/pdf'}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=`${(data.name || '角色卡').replace(/[\\/:*?"<>|]/g,'_')}.pdf`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
