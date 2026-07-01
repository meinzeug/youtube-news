export type SourcePreset = {
  name: string;
  url: string;
  description: string;
  intervalMinutes: number;
  category: string;
};

export const sourcePresets: SourcePreset[] = [
  {
    name: 'BILD.de Startseite',
    url: 'https://www.bild.de',
    description: 'Große Boulevard-News-Startseite zum Testen der HTML- und JSON-LD-Erkennung.',
    intervalMinutes: 30,
    category: 'Boulevard',
  },
  {
    name: 'Tagesschau Inland',
    url: 'https://www.tagesschau.de/inland/',
    description: 'Öffentlich-rechtliche Inlandsnachrichten als stabiler HTML-Test für seriöse Meldungen.',
    intervalMinutes: 45,
    category: 'Nachrichten',
  },
  {
    name: 'heise online News',
    url: 'https://www.heise.de/rss/heise-atom.xml',
    description: 'RSS/Atom-Feed für Technik- und Digitalthemen mit zuverlässigen Metadaten.',
    intervalMinutes: 60,
    category: 'Technik',
  },
  {
    name: 'DW Deutsch',
    url: 'https://rss.dw.com/rdf/rss-de-all',
    description: 'RSS-Feed der Deutschen Welle für internationale Themen auf Deutsch.',
    intervalMinutes: 60,
    category: 'International',
  },
];
