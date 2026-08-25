import type { ReactNode } from 'react';
import type { StatBlock } from '../format';

/** Shared rules presentation for compendium monsters and campaign NPCs. */
export default function StatBlockView({ stat }: { stat: StatBlock }) {
  return (
    <>
      <div className="mb-2 text-xs text-zinc-400">{stat.meta}</div>
      {stat.rows.length > 0 && (
        <table className="mb-3 w-full text-xs">
          <tbody>
            {stat.rows.map(([key, value]) => (
              <tr key={`${key}-${value}`}>
                <td className="w-20 align-top text-zinc-500">{key}</td>
                <td className="text-zinc-200">{inlineMarkdown(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="space-y-2 text-sm leading-relaxed text-zinc-200">
        {stat.body.map((paragraph, index) => (
          <p key={index} className="whitespace-pre-wrap">{inlineMarkdown(paragraph)}</p>
        ))}
      </div>
    </>
  );
}

function inlineMarkdown(value: string): ReactNode {
  return value.split(/(\*\*.+?\*\*)/gu).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index} className="font-semibold text-zinc-100">{part.slice(2, -2)}</strong>
    : part);
}
