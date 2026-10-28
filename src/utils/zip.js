// Minimal .zip extractor (stored + deflate, no ZIP64) so the bot can unpack yt-dlp without extra packages.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function extractZip(buffer, destDir) {
  const root = path.resolve(destDir);
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 is not supported');

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const mode = buffer.readUInt32LE(p + 38) >>> 16;
    const localHeader = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;

    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`unsafe path in zip: ${name}`);
    if (name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (buffer.readUInt32LE(localHeader) !== 0x04034b50) throw new Error('corrupt zip entry');
    const start = localHeader + 30 + buffer.readUInt16LE(localHeader + 26) + buffer.readUInt16LE(localHeader + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`unsupported zip compression ${method}`);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    if ((mode & 0o170000) === 0o120000) fs.symlinkSync(data.toString('utf8'), target);
    else fs.writeFileSync(target, data, { mode: mode & 0o777 || 0o644 });
  }
}
