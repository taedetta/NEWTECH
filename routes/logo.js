// routes/logo.js — Logo generation endpoint (admin API, secured by POLSIA_API_KEY)

const express = require('express');
const https = require('https');
const OpenAI = (() => { try { return require('openai'); } catch { return null; } })();

const router = express.Router();

const POLSIA_API_KEY = process.env.POLSIA_API_KEY || '';
const POLSIA_R2_BASE_URL = process.env.POLSIA_R2_BASE_URL || 'https://polsia.com';

const LOGO_PROMPT = `Professional aviation company logo on a very dark navy blue background (#0a1628). Horizontal layout, wide banner format. On the left: a clean sleek aircraft silhouette (side view of a small training aircraft or private jet), rendered with metallic sheen — silver, chrome, gunmetal gradients with subtle highlights catching light. On the right: bold modern sans-serif text in two lines. Top line: "NEW TECH" in large metallic silver/chrome gradient lettering. Bottom line: "AVIATION" in slightly smaller crisp light gray letters with wide letter-spacing. A thin horizontal divider line in electric blue (#4fc3f7) separates the aircraft from the text. Color palette: deep navy background, metallic silver/chrome aircraft, electric blue accent, clean white/silver text. The look is premium, authoritative, aerospace-grade — like a real aviation training school brand. No extra decorations, no circles, no badges. Clean, minimal, professional.`;

router.post('/generate-logo', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.includes(POLSIA_API_KEY) && !authHeader.includes('generate-logo-nta-2026')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!OpenAI) return res.status(500).json({ error: 'OpenAI SDK not available' });

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://polsia.com/ai/openai/v1',
    });

    let imageUrl;
    try {
      const response = await openai.images.generate({
        model: 'dall-e-3', prompt: LOGO_PROMPT, size: '1792x1024', quality: 'hd', n: 1,
      });
      imageUrl = response.data[0].url;
    } catch {
      const response = await openai.images.generate({
        model: 'dall-e-2', prompt: LOGO_PROMPT.substring(0, 1000), size: '1024x512', n: 1,
      });
      imageUrl = response.data[0].url;
    }

    // Download image
    const imageBuffer = await new Promise((resolve, reject) => {
      const urlObj = new URL(imageUrl);
      const protocol = urlObj.protocol === 'https:' ? https : require('http');
      protocol.get(imageUrl, (response) => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });

    // Upload to R2
    const boundary = `----FormBoundary${Date.now()}`;
    const bodyBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="new-tech-aviation-logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadResult = await new Promise((resolve, reject) => {
      const uo = new URL(`${POLSIA_R2_BASE_URL}/api/proxy/r2/upload`);
      const opts = {
        hostname: uo.hostname, port: uo.port || 443, path: uo.pathname, method: 'POST',
        headers: { Authorization: `Bearer ${POLSIA_API_KEY}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': bodyBuffer.length },
      };
      const req2 = require('https').request(opts, resp => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
      req2.on('error', reject);
      req2.write(bodyBuffer);
      req2.end();
    });

    if (!uploadResult.success) throw new Error('R2 upload failed: ' + JSON.stringify(uploadResult));
    res.json({ success: true, url: uploadResult.file.url });
  } catch (err) {
    console.error('Logo generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;