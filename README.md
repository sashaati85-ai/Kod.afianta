# KOD.Afianta

This repository contains the static production build currently served at:

https://kod.afianta.ru/

The files were copied from the AdminVPS deployment directory:

`/opt/apps/kod/site`

## Local Preview

```powershell
npm run preview
```

Then open:

http://localhost:4173/

## Deployment Notes

The live server uses Caddy in front of nginx:

- domain: `kod.afianta.ru`
- app directory: `/opt/apps/kod`
- public files: `/opt/apps/kod/site`
- Caddy route: `reverse_proxy 127.0.0.1:3003`
