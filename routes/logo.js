// routes/logo.js — Logo generation endpoint (admin API, secured by LOGO_API_SECRET)

const express = require('express');
const https = require('https');
const OpenAI = (() => { try { return require('openai'); } catch { return null; } })();
const { uploadBuffer } = require('../lib/r2-storage');
const { isStaging } = require('../lib/app-env');

const router = express.Router();

const LOGO_API_SECRET = process.env.LOGO_API_SECRET || '';

const LOGO_PROMPT = `Professional aviation company logo on a very dark navy blue background (#0a1628). Horizontal layout, wide banner format. On the left: a clean sleek aircraft silhouette (side view of a small training aircraft or private jet), rendered with metallic sheen — silver, chrome, gunmetal gradients with subtle highlights catching light. On the right: bold modern sans-serif text in two lines. Top line: "NEW TECH" in large metallic silver/chrome gradient lettering. Bottom line: "AVIATION" in slightly smaller crisp light gray letters with wide letter-spacing. A thin horizontal divider line in electric blue (#4fc3f7) separates the aircraft from the text. Color palette: deep navy background, metallic silver/chrome aircraft, electric blue accent, clean white/silver text. The look is premium, authoritative, aerospace-grade — like a real aviation training school brand. No extra decorations, no circles, no badges. Clean, minimal, professional.`;

router.post('/generate-logo', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!LOGO_API_SECRET || !authHeader.includes(LOGO_API_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!OpenAI) return res.status(500).json({ error: 'OpenAI SDK not available' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    const url = await uploadBuffer(imageBuffer, 'new-tech-aviation-logo.png', {
      folder: 'images',
      contentType: 'image/png',
      allowLocalFallback: isStaging(),
    });
    if (!url) throw new Error('R2 upload failed');
    res.json({ success: true, url });
  } catch (err) {
    console.error('Logo generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
