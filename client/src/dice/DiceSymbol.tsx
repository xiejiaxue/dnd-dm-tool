import { CROWN_PATH } from './crown';
import type { DieSides } from './rules';

type Shape = {
  outline: string;
  seams: string;
  light: string;
  dark: string;
  front?: string;
  numberY: number;
};

// Shared silhouettes keep the selector and the flat result dice consistent.
const shapes: Record<Exclude<DieSides, 100>, Shape> = {
  4: {
    outline: 'M50 5 95 87H5Z',
    seams: 'M50 5 50 68 5 87M50 68 95 87',
    light: 'M50 5 50 68 5 87Z',
    dark: 'M5 87 50 68 95 87Z',
    numberY: 56,
  },
  6: {
    outline: 'M13 13H87V87H13Z',
    seams: 'M13 13 23 23H77L87 13M77 23V77L87 87M13 87 23 77H77M23 23V77',
    light: 'M13 13H87L77 23H23V77L13 87Z',
    dark: 'M87 13V87H13L23 77H77V23Z',
    numberY: 51,
  },
  8: {
    outline: 'M50 3 96 50 50 97 4 50Z',
    seams: 'M50 3 25 65H75L50 3M4 50 25 65 50 97 75 65 96 50',
    light: 'M50 3 25 65 4 50Z',
    dark: 'M4 50 25 65H75L96 50 50 97Z',
    numberY: 49,
  },
  10: {
    outline: 'M50 3 92 35 94 66 50 97 6 66 8 35Z',
    seams: 'M50 3 23 65 50 78 77 65 50 3M6 66 23 65M77 65 94 66M50 78V97',
    light: 'M50 3 23 65 6 66 8 35Z',
    dark: 'M6 66 50 78 94 66 50 97Z',
    numberY: 53,
  },
  12: {
    outline: 'M50 3 78 13 96 37 96 65 75 87 50 97 25 87 4 65 4 37 22 13Z',
    seams: 'M50 24 77 44 67 75H33L23 44Z M50 3V24M4 37 23 44M96 37 77 44M25 87 33 75M75 87 67 75',
    light: 'M50 3 78 13 96 37 77 44 50 24 23 44 4 37 22 13Z',
    dark: 'M4 65 33 75H67L96 65 75 87 50 97 25 87Z',
    front: 'M50 24 77 44 67 75H33L23 44Z',
    numberY: 53,
  },
  20: {
    outline: 'M50 3 91 26 94 74 50 97 6 74 9 26Z',
    seams: 'M50 3 22 33H78L50 3M9 26 22 33 6 74 50 82 94 74 78 33 91 26M22 33 50 82 78 33M50 82V97',
    light: 'M50 3 78 33H22Z M9 26 22 33 6 74Z',
    dark: 'M6 74 50 82 94 74 50 97Z M78 33 91 26 94 74Z',
    front: 'M22 33H78L50 82Z',
    numberY: 51,
  },
};

function SingleDie({ sides, value, variant }: { sides: Exclude<DieSides, 100>; value?: number | string; variant: 'solid' | 'outline' }) {
  const shape = shapes[sides];
  if (variant === 'outline') {
    return <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
      <path d={shape.outline} /><path d={shape.seams} strokeOpacity=".72" />
    </g>;
  }
  return <g>
    <path className="dice-face-base" d={shape.outline} />
    <path className="dice-face-light" d={shape.light} />
    <path className="dice-face-dark" d={shape.dark} />
    {shape.front && <path className="dice-face-front" d={shape.front} />}
    {sides === 20 && String(value) === '20'
      ? <path d={CROWN_PATH} fill="#fffdf8" transform={`translate(30 ${shape.numberY - 20}) scale(.4)`} />
      : value !== undefined && <text className="dice-face-value" x="50" y={shape.numberY} dy=".35em" fontSize={String(value).length > 2 ? 27 : 34}>{value}</text>}
  </g>;
}

export function DiceFaces({ sides, value, variant = 'solid' }: { sides: DieSides; value?: number | string; variant?: 'solid' | 'outline' }) {
  if (sides !== 100) return <SingleDie sides={sides} value={value} variant={variant} />;
  return <>
    <g transform="translate(-2 0) scale(.72)" opacity={variant === 'solid' ? .75 : 1}><SingleDie sides={10} variant={variant} /></g>
    <g transform="translate(24 17) scale(.79)">{variant === 'outline' && <path d={shapes[10].outline} fill="var(--dice-icon-surface, var(--paper))" />}<SingleDie sides={10} value={value} variant={variant} /></g>
  </>;
}

export default function DiceSymbol({ sides, value, variant = 'outline', className = '' }: { sides: DieSides; value?: number | string; variant?: 'solid' | 'outline'; className?: string }) {
  return <svg className={`dice-symbol ${className}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <DiceFaces sides={sides} value={value} variant={variant} />
  </svg>;
}
