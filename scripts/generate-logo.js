#!/usr/bin/env node
/**
 * Generates the New Tech Aviation logo using DALL-E and uploads to R2.
 * Run: OPENAI_API_KEY=... node scripts/generate-logo.js
 */
'use strict';

const OpenAI = require('openai');
const fetch = require('node-fetch');
const { uploadBuffer, isConfigured } = require('../lib/r2-storage');

async function generateLogo() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  if (!isConfigured()) throw new Error('R2_* env vars required');

  console.log('Initializing OpenAI client...');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `Professional aviation company logo on a pure black (#000000) background.
Horizontal layout. Clean, modern aircraft silhouette viewed from the side-front angle — a sleek commercial or training aircraft with swept wings.
Metallic finish: gradients of silver, chrome, and gunmetal with subtle specular highlights. The aircraft has a polished, brushed-metal look.
To the right of the aircraft icon: bold modern sans-serif text reading "New Tech Aviation" — top line slightly larger "NEW TECH" in metallic silver/chrome gradient, bottom line "AVIATION" in smaller crisp white or light gray caps with wide letter-spacing.
Color palette: deep navy blue (#0a1628) accents, silver and chrome metallics (#C0C0C0, #E8E8E8), subtle sky blue gradient background behind the aircraft.
The overall look is bold, authoritative, premium — like a major airline or aerospace company brand. No gradients on the background except very subtle dark navy vignette.
Logo dimensions: 512x160 pixels, horizontal banner format. Professional vector-like quality.`;

  console.log('Generating logo with DALL-E 3...');
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
  } catch (err) {
    console.error('DALL-E 3 failed, trying DALL-E 2...', err.message);
    const response = await openai.images.generate({
      model: 'dall-e-2',
      prompt: prompt.substring(0, 1000),
      size: '1024x512',
      n: 1,
    });
    imageUrl = response.data[0].url;
  }

  console.log('Downloading generated image...');
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) throw new Error(`Failed to download image: ${imgResponse.status}`);
  const imageBuffer = await imgResponse.buffer();

  console.log('Uploading to R2...');
  const logoUrl = await uploadBuffer(imageBuffer, 'new-tech-aviation-logo.png', { folder: 'images', contentType: 'image/png' });
  if (!logoUrl) throw new Error('R2 upload failed');

  console.log('\nLogo uploaded:', logoUrl);
  return logoUrl;
}

generateLogo()
  .then((url) => {
    console.log('\nDone! Logo URL:', url);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
