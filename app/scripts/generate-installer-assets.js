const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');
const iconPath = path.join(buildDir, 'icon.png');
const sidebarPath = path.join(buildDir, 'installerSidebar.bmp');
const uninstallerSidebarPath = path.join(buildDir, 'uninstallerSidebar.bmp');
const headerPath = path.join(buildDir, 'installerHeader.bmp');
const installerIconPath = path.join(buildDir, 'installerIcon.ico');
const uninstallerIconPath = path.join(buildDir, 'uninstallerIcon.ico');
const installerHeaderIconPath = path.join(buildDir, 'installerHeaderIcon.ico');

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function writeBmp(targetPath, width, height, paintPixel) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelDataSize, 34);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { r, g, b } = paintPixel(x, height - 1 - y, width, height);
      const pixelOffset = 54 + (y * rowStride) + (x * 3);
      buffer[pixelOffset] = clamp(b);
      buffer[pixelOffset + 1] = clamp(g);
      buffer[pixelOffset + 2] = clamp(r);
    }
  }

  fs.writeFileSync(targetPath, buffer);
}

function lerp(start, end, amount) {
  return start + ((end - start) * amount);
}

function mixColor(start, end, amount) {
  return {
    r: lerp(start.r, end.r, amount),
    g: lerp(start.g, end.g, amount),
    b: lerp(start.b, end.b, amount),
  };
}

function makeBrandPixel(x, y, width, height) {
  const topColor = { r: 7, g: 13, b: 28 };
  const bottomColor = { r: 17, g: 68, b: 126 };
  const accentColor = { r: 101, g: 181, b: 255 };
  const glowColor = { r: 38, g: 132, b: 255 };
  const diagonal = (x / width) * 0.6 + (y / height) * 0.4;
  const base = mixColor(topColor, bottomColor, diagonal);

  const glowCenterX = width * 0.82;
  const glowCenterY = height * 0.12;
  const glowDistance = Math.hypot(x - glowCenterX, y - glowCenterY);
  const glowStrength = Math.max(0, 1 - (glowDistance / (width * 0.72)));

  const ribbon = Math.max(0, 1 - Math.abs((x - (width * 0.24)) - (y * 0.48)) / (width * 0.14));
  const accent = mixColor(base, glowColor, glowStrength * 0.42);
  const finalColor = mixColor(accent, accentColor, ribbon * 0.28);

  return {
    r: finalColor.r,
    g: finalColor.g,
    b: finalColor.b,
  };
}

function writeInstallerArtwork() {
  writeBmp(sidebarPath, 164, 314, makeBrandPixel);
  writeBmp(uninstallerSidebarPath, 164, 314, (x, y, width, height) => {
    const mirrored = makeBrandPixel(width - x, y, width, height);
    return {
      r: mirrored.r * 0.92,
      g: mirrored.g * 0.94,
      b: mirrored.b,
    };
  });
  writeBmp(headerPath, 150, 57, makeBrandPixel);
}

function createIcoFromPng(pngBuffer) {
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  const iconDir = Buffer.alloc(22);

  iconDir.writeUInt16LE(0, 0);
  iconDir.writeUInt16LE(1, 2);
  iconDir.writeUInt16LE(1, 4);
  iconDir.writeUInt8(width >= 256 ? 0 : width, 6);
  iconDir.writeUInt8(height >= 256 ? 0 : height, 7);
  iconDir.writeUInt8(0, 8);
  iconDir.writeUInt8(0, 9);
  iconDir.writeUInt16LE(1, 10);
  iconDir.writeUInt16LE(32, 12);
  iconDir.writeUInt32LE(pngBuffer.length, 14);
  iconDir.writeUInt32LE(22, 18);

  return Buffer.concat([iconDir, pngBuffer]);
}

function writeInstallerIcons() {
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing icon source: ${iconPath}`);
  }

  const pngBuffer = fs.readFileSync(iconPath);
  const icoBuffer = createIcoFromPng(pngBuffer);

  fs.writeFileSync(installerIconPath, icoBuffer);
  fs.writeFileSync(uninstallerIconPath, icoBuffer);
  fs.writeFileSync(installerHeaderIconPath, icoBuffer);
}

function main() {
  ensureDir(buildDir);
  writeInstallerArtwork();
  writeInstallerIcons();
  console.log('Installer assets generated successfully.');
}

main();
