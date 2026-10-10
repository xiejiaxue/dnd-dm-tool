"""Convert the OFL Noto Sans SC OTF into quadratic TTF for reliable PDF subsets.
Usage: python3 scripts/build-pdf-font.py input.otf output.ttf
Source: https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/SC
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
source = TTFont(sys.argv[1])
order = source.getGlyphOrder()
source_glyphs = source.getGlyphSet()
glyphs = {}
for name in order:
    pen = TTGlyphPen(None)
    source_glyphs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
    glyphs[name] = pen.glyph()
font = FontBuilder(source['head'].unitsPerEm, isTTF=True)
font.setupGlyphOrder(order)
font.setupCharacterMap(source.getBestCmap())
font.setupGlyf(glyphs)
font.setupHorizontalMetrics(source['hmtx'].metrics)
font.setupHorizontalHeader(ascent=source['hhea'].ascent, descent=source['hhea'].descent)
font.setupNameTable({'familyName':'DM Sans SC','styleName':'Regular','uniqueFontIdentifier':'DM Sans SC Regular 1.0','fullName':'DM Sans SC Regular','psName':'DMSansSC-Regular','version':'Version 1.0','copyright':source['name'].getDebugName(0) or 'Noto Sans SC contributors','licenseDescription':'SIL Open Font License 1.1; derived from Noto Sans SC','licenseInfoURL':'https://openfontlicense.org/'})
font.setupOS2(sTypoAscender=source['OS/2'].sTypoAscender,sTypoDescender=source['OS/2'].sTypoDescender,usWinAscent=source['OS/2'].usWinAscent,usWinDescent=source['OS/2'].usWinDescent)
font.setupPost()
font.save(sys.argv[2])
