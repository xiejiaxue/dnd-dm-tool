const paths = {
  dice: ['M12 2 21 7v10l-9 5-9-5V7l9-5ZM12 2 7 8h10L12 2ZM3 7l4 1-4 9 9 1 9-1-4-9 4-1M7 8l5 10 5-10M12 18v4'],
  select: ['m5 3 14 10-7 1-3 7-4-18Z'],
  place: ['M12 4v16M4 12h16', 'M5 5h14v14H5Z'],
  wall: ['M4 5h16v14H4Z', 'M4 12h16M12 5v7M8 12v7M16 12v7'],
  erase: ['m14 3 7 7-10 11H6L1 16Z', 'm8 10 7 7M11 21h10'],
  actors: ['M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8M18 15a6 6 0 0 1 4 6'],
  library: ['M3 4h6v17H3ZM11 4h5v17h-5Z', 'm18 4 4 16'],
  plus: ['M12 4v16M4 12h16'],
  minus: ['M4 12h16'],
  reset: ['M20 8a8 8 0 1 0 0 8M20 3v5h-5'],
  view: ['M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'],
  chevron: ['m7 9 5 5 5-5'],
  back: ['m10 5-7 7 7 7M3 12h18'],
  close: ['m6 6 12 12M18 6 6 18'],
  settings: ['M4 7h16M4 17h16', 'M8 4v6M16 14v6'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'm15.5 15.5 4.5 4.5'],
  map: ['m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16'],
} as const;

export default function CampaignIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="campaign-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((d, i) => <path d={d} key={i} />)}</svg>;
}
