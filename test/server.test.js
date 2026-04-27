const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { createServer } = require('../src/server');

const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const createLibrary = () => {
  const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comicglass-web-'));
  const dirPath = path.join(libraryRoot, 'aaa');
  fs.mkdirSync(dirPath);
  fs.writeFileSync(path.join(dirPath, '1.jpg'), png1x1);
  return libraryRoot;
};

const createMixedFileLibrary = () => {
  const libraryRoot = createLibrary();
  fs.writeFileSync(path.join(libraryRoot, 'aaa', 'notes.txt'), 'not an image');
  fs.writeFileSync(path.join(libraryRoot, 'aaa', 'book.zip'), 'not an image');
  return libraryRoot;
};

const createWideImageLibrary = async () => {
  const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comicglass-web-'));
  const dirPath = path.join(libraryRoot, 'aaa');
  fs.mkdirSync(dirPath);
  await sharp({
    create: {
      width: 2000,
      height: 1000,
      channels: 3,
      background: '#ffffff',
    },
  }).jpeg().toFile(path.join(dirPath, 'wide.jpg'));
  return libraryRoot;
};

test('directory HTML output remains byte-for-byte identical', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const dirStat = fs.statSync(path.join(libraryRoot, 'aaa'));
  const expectedModifyTime = Math.floor(dirStat.mtimeMs / 1000);
  const response = await server.inject({
    method: 'GET',
    url: '/',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <title>./</title>
        </head>
        <body>
          <h3>./</h3>
          <ul>
            <li type="circle">
      <a href="?path=%2Fresized" bookdate="0">resized</a>
    </li><li type="circle">
      <a href="?path=%2Faaa" bookdate="${expectedModifyTime}">aaa</a>
    </li>
          </ul>
        </body>
      </html>
    `);
});

test('resized root is the first item in GET /', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<ul>\s*<li type="circle">\s*<a href="\?path=%2Fresized" bookdate="0">resized<\/a>/);
});

test('resized directory listing mirrors the real root', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const dirStat = fs.statSync(path.join(libraryRoot, 'aaa'));
  const expectedModifyTime = Math.floor(dirStat.mtimeMs / 1000);
  const response = await server.inject({
    method: 'GET',
    url: '/?path=%2Fresized',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <title>%2Fresized</title>
        </head>
        <body>
          <h3>%2Fresized</h3>
          <ul>
            <li type="circle">
      <a href="?path=%2Fresized%2Faaa" bookdate="${expectedModifyTime}">aaa</a>
    </li>
          </ul>
        </body>
      </html>
    `);
});

test('file HTML output remains byte-for-byte identical', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const filePath = path.join(libraryRoot, 'aaa', '1.jpg');
  const fileStat = fs.statSync(filePath);
  const expectedModifyTime = Math.floor(fileStat.mtimeMs / 1000);
  const response = await server.inject({
    method: 'GET',
    url: '/?path=%2Faaa',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <title>%2Faaa</title>
        </head>
        <body>
          <h3>%2Faaa</h3>
          <ul>
            <li>
      <a href="%2Faaa%2F1.jpg" booktitle="1.jpg" booksize="${fileStat.size}" bookdate="${expectedModifyTime}">1.jpg</a> 
    </li>
          </ul>
        </body>
      </html>
    `);
});

test('resized file listing points image links at webp resized responses', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const filePath = path.join(libraryRoot, 'aaa', '1.jpg');
  const fileStat = fs.statSync(filePath);
  const expectedModifyTime = Math.floor(fileStat.mtimeMs / 1000);
  const response = await server.inject({
    method: 'GET',
    url: '/?path=%2Fresized%2Faaa',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <title>%2Fresized%2Faaa</title>
        </head>
        <body>
          <h3>%2Fresized%2Faaa</h3>
          <ul>
            <li>
      <a href="%2Fresized%2Faaa%2F1.webp" booktitle="1.webp" booksize="${fileStat.size}" bookdate="${expectedModifyTime}">1.webp</a>${' '}
    </li>
          </ul>
        </body>
      </html>
    `);
});

test('resized file listing omits non-image files', async (t) => {
  const libraryRoot = createMixedFileLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/?path=%2Fresized%2Faaa',
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /1\.webp/);
  assert.doesNotMatch(response.body, /book\.webp|book\.zip|notes\.webp|notes\.txt/);
});

test('resized image route returns a webp version of the matching original image', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/resized/aaa/1.webp',
  });
  const body = response.rawPayload;

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/webp');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(body.subarray(0, 4).toString('utf8'), 'RIFF');
  assert.equal(body.subarray(8, 12).toString('utf8'), 'WEBP');
});

test('resized image route accepts an encoded leading slash path', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/%2Fresized%2Faaa%2F1.webp',
  });
  const body = response.rawPayload;

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/webp');
  assert.equal(body.subarray(0, 4).toString('utf8'), 'RIFF');
  assert.equal(body.subarray(8, 12).toString('utf8'), 'WEBP');
});

test('resized image route does not enlarge images below the max edge', async (t) => {
  const libraryRoot = createLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/resized/aaa/1.webp',
  });
  const metadata = await sharp(response.rawPayload).metadata();

  assert.equal(response.statusCode, 200);
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
});

test('resized image route limits the long edge to 1440px', async (t) => {
  const libraryRoot = await createWideImageLibrary();
  const server = createServer({ libraryPath: libraryRoot });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/resized/aaa/wide.webp',
  });
  const metadata = await sharp(response.rawPayload).metadata();

  assert.equal(response.statusCode, 200);
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1440);
  assert.equal(metadata.height, 720);
});

test('resized image max edge can be adjusted per server instance', async (t) => {
  const libraryRoot = await createWideImageLibrary();
  const server = createServer({
    libraryPath: libraryRoot,
    resizedImageMaxEdge: 100,
  });
  t.after(() => server.close());
  await server.ready();

  const response = await server.inject({
    method: 'GET',
    url: '/resized/aaa/wide.webp',
  });
  const metadata = await sharp(response.rawPayload).metadata();

  assert.equal(response.statusCode, 200);
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 100);
  assert.equal(metadata.height, 50);
});
