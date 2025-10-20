// Lightweight scraper microservice using Playwright
// Deploy on a container platform (Railway/Fly/Render). Not suitable for Vercel serverless.

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

function normalizePrice(input) {
    if (!input) return null;
    const m = String(input).match(/([€$£])?\s*([0-9]{1,3}(?:[\.,][0-9]{3})*(?:[\.,][0-9]{2})?|[0-9]+(?:[\.,][0-9]{2})?)/);
    if (!m) return null;
    const symbol = m[1] || '$';
    const amount = m[2];
    return `${symbol}${amount.replace(/\s/g, '')}`;
}

async function extractFromDom(page) {
    // Prefer JSON-LD Product
    const jsonLd = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.textContent).filter(Boolean));
    for (const raw of jsonLd) {
        try {
            const data = JSON.parse(raw);
            const asArray = Array.isArray(data) ? data : [data];
            const prod = asArray.find(x => x && x['@type'] && (x['@type'] === 'Product' || (Array.isArray(x['@type']) && x['@type'].includes('Product'))));
            if (prod) {
                const name = prod.name || prod.title;
                const price = (prod.offers && (prod.offers.price || (prod.offers.priceSpecification && prod.offers.priceSpecification.price))) || null;
                const keywords = prod.keywords || (Array.isArray(prod.category) ? prod.category.join(', ') : (prod.category || ''));
                const tags = [keywords, prod.brand && prod.brand.name, prod.sku].filter(Boolean).join(', ');
                return { name, price: price ? String(price) : null, tags };
            }
        } catch (_) {}
    }

    // Meta
    const meta = async (sel) => page.$eval(sel, el => el.getAttribute('content')).catch(() => undefined);
    const ogTitle = await meta('meta[property="og:title"]') || await meta('meta[name="twitter:title"]');
    const priceOg = await meta('meta[property="product:price:amount"]') || await meta('meta[name="price"]') || await meta('meta[name="og:price:amount"]') || await meta('meta[name="twitter:data1"]');
    const kw = await meta('meta[name="keywords"]') || await meta('meta[property="article:tag"]');
    if (ogTitle || priceOg || kw) {
        return { name: ogTitle, price: priceOg, tags: kw };
    }

    // Itemprop price
    const itempropPrice = await page.$eval('[itemprop="price"]', el => el.getAttribute('content') || el.textContent,).catch(() => undefined);
    const h1 = await page.$eval('h1', el => el.textContent.trim()).catch(() => undefined);
    const title = await page.title().catch(() => undefined);

    return { name: h1 || title, price: itempropPrice, tags: '' };
}

app.post('/render', async (req, res) => {
    const { url, proxy } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'Valid url required' });
    }

    let browser;
    try {
        const launchOpts = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ]
        };
        if (proxy && proxy.server) {
            launchOpts.proxy = proxy; // { server: 'http://user:pass@host:port' }
        }
        browser = await chromium.launch(launchOpts);
        const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36' });
        const page = await ctx.newPage();
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!resp || !resp.ok()) {
            // Try network idle for SPAs
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
        // Give some time for client-side renderers
        await page.waitForTimeout(800);

        const raw = await extractFromDom(page);
        const name = (raw.name || '').toString().trim();
        const price = normalizePrice(raw.price);
        const tags = (raw.tags || '').toString();

        res.json({ success: true, data: { name, price, tags } });
    } catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Scraper listening on :${PORT}`);
});


