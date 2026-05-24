#!/usr/bin/env node
/**
 * Generates the New Tech Aviation logo using DALL-E and uploads to R2.
 * Run: node scripts/generate-logo.js
 */

const OpenAI = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');

const POLSIA_API_KEY = process.env.POLSIA_API_KEY || 'company_96457_38438287bb28c60fe17bb8740cc859f3';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'company_96457_38438287bb28c60fe17bb8740cc859f3';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://polsia.com/ai/openai/v1';
const POLSIA_R2_BASE_URL = process.env.POLSIA_R2_BASE_URL || 'https://polsia.com';

async function generateLogo() {
  console.log('Initializing OpenAI client...');
  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    baseURL: OPENAI_BASE_URL,
  });

  console.log('Generating logo with DALL-E 3...');
  const prompt = `Professional aviation company logo on a pure black (#000000) background.
Horizontal layout. Clean, modern aircraft silhouette viewed from the side-front angle — a sleek commercial or training aircraft with swept wings.
Metallic finish: gradients of silver, chrome, and gunmetal with subtle specular highlights. The aircraft has a polished, brushed-metal look.
To the right of the aircraft icon: bold modern sans-serif text reading "New Tech Aviation" — top line slightly larger "NEW TECH" in metallic silver/chrome gradient, bottom line "AVIATION" in smaller crisp white or light gray caps with wide letter-spacing.
Color palette: deep navy blue (#0a1628) accents, silver and chrome metallics (#C0C0C0, #E8E8E8), subtle sky blue gradient background behind the aircraft.
The overall look is bold, authoritative, premium — like a major airline or aerospace company brand. No gradients on the background except very subtle dark navy vignette.
Logo dimensions: 512x160 pixels, horizontal banner format. Professional vector-like quality.`;

  let imageUrl;
  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      size: '1792x1024',
      quality: 'hd',
      n: 1,
    });
    imageUrl = response.data[0].url;
    console.log('DALL-E 3 image generated:', imageUrl);
  } catch (err) {
    console.error('DALL-E 3 failed, trying DALL-E 2...', err.message);
    const response = await openai.images.generate({
      model: 'dall-e-2',
      prompt: prompt.substring(0, 1000),
      size: '1024x512',
      n: 1,
    });
    imageUrl = response.data[0].url;
    console.log('DALL-E 2 image generated:', imageUrl);
  }

  // Download the generated image
  console.log('Downloading generated image...');
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) {
    throw new Error(`Failed to download image: ${imgResponse.status}`);
  }
  const imageBuffer = await imgResponse.buffer();
  console.log(`Downloaded ${imageBuffer.length} bytes`);

  // Upload to R2
  console.log('Uploading to R2...');
  const formData = new FormData();
  formData.append('file', imageBuffer, {
    filename: 'new-tech-aviation-logo.png',
    contentType: 'image/png',
  });

  const uploadResponse = await fetch(`${POLSIA_R2_BASE_URL}/api/proxy/r2/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${POLSIA_API_KEY}`,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  const uploadResult = await uploadResponse.json();
  if (!uploadResult.success) {
    throw new Error(`R2 upload failed: ${JSON.stringify(uploadResult)}`);
  }

  const logoUrl = uploadResult.file.url;
  console.log('\n✅ Logo uploaded successfully!');
  console.log('Logo URL:', logoUrl);
  console.log('\nUse this URL in the HTML:', logoUrl);
  return logoUrl;
}

generateLogo()
  .then((url) => {
    console.log('\nDone! Logo URL for integration:', url);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
