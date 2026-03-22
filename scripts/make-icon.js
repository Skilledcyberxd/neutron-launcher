/**
 * Neutron Launcher — Icon Generator
 * Converts assets/icon.svg → assets/icon.ico
 * Run: node scripts/make-icon.js
 */
const path = require('path');
const fs   = require('fs');

async function run() {
  const svgPath = path.join(__dirname, '../assets/icon.svg');
  const pngPath = path.join(__dirname, '../assets/icon.png');
  const icoPath = path.join(__dirname, '../assets/icon.ico');

  if (!fs.existsSync(svgPath)) {
    console.log('assets/icon.svg not found');
    return;
  }

  let sharp;
  try { sharp = require('sharp'); } catch {
    console.log('Run: npm install sharp');
    console.log('Or convert assets/icon.svg manually at https://convertio.co/svg-ico/');
    return;
  }

  // Generate multiple sizes for ICO
  await sharp(svgPath).resize(256, 256).png().toFile(pngPath);
  console.log('icon.png (256x256) generated');

  try {
    const { pngToIco } = require('png-to-ico');
    const ico = await pngToIco([fs.readFileSync(pngPath)]);
    fs.writeFileSync(icoPath, ico);
    console.log('icon.ico generated successfully');
  } catch {
    fs.copyFileSync(pngPath, icoPath);
    console.log('icon.ico copied from png (install png-to-ico for proper .ico)');
  }
}
run().catch(console.error);
