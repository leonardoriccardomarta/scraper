# Scraper Microservice (Playwright)

This service renders pages with Playwright to extract product data when static scraping is insufficient.

Run locally:

```
cd scraper
npm install
npm start
# service on http://localhost:8080
```

API:

- POST /render
  - body: `{ "url": "https://...", "proxy"?: { "server": "http://user:pass@host:port" } }`
  - response: `{ success: true, data: { name, price, tags } }`

Deploy suggestions:
- Railway, Fly.io, Render (container). Vercel serverless is not suitable.
- Set Playwright cache in persistent storage if needed.

Env wiring (backend):
- Set `SCRAPER_URL` in backend to point to this service.

Security:
- Rate-limit by IP and require an internal token if exposing publicly.

