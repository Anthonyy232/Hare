import http from 'node:http';
import fs from 'node:fs';

// A minute of silent PCM provides deterministic real media events and seeking, offline.
const sampleRate = 8000;
const bytes = sampleRate * 60 * 2;
const wav = Buffer.alloc(44 + bytes);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
const fixture = fs.readFileSync(new URL('./fixtures/video.html', import.meta.url), 'utf8');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:41739');
  if (url.pathname === '/motion.webm') {
    const media = fs.readFileSync(new URL('./fixtures/motion.webm', import.meta.url));
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': media.length });
    res.end(media);
    return;
  }
  if (url.pathname === '/media.wav') {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    if (start > end) { res.writeHead(416).end(); return; }
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}),
    });
    res.end(wav.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fixture);
}).listen(41739, '0.0.0.0');
