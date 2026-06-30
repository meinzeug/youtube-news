# YouTube News Studio

Moderne Next.js-16-Webapp zur automatisierten Produktion von YouTube-News-Videos:

- Quellenverwaltung für RSS-Feeds und HTML-Seiten
- Regelmäßiger Crawl per API oder `npm run worker`
- OpenRouter-Integration für umformulierte deutsche Sprechertexte
- ElevenLabs TTS plus lokaler FFmpeg-Fallback ohne externe API
- Bild-/Thumbnail-Generierung als scriptbare SVG-Dateien
- FFmpeg-Rendering zu MP4
- Einstellungsseite für OpenRouter, ElevenLabs und YouTube-OAuth-Konfiguration
- YouTube-Upload-Endpunkt als sauberer Integrationspunkt für Google OAuth/YouTube Data API

## Start

```bash
npm install
npm run dev
```

Öffne http://localhost:3000.

## Automatisierung

```bash
npm run worker
```

Oder per Cron/Webhook:

```bash
curl -X POST http://localhost:3000/api/workflow/run \
  -H 'content-type: application/json' \
  -d '{"crawl":true}'
```

## Hinweise

Binärdateien werden nicht eingecheckt. Audio-/Video-Artefakte entstehen zur Laufzeit unter `public/generated/` und sind per `.gitignore` ausgeschlossen.
