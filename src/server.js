const fastify = require('fastify')({ logger: false });
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const fastifyStatic = require('fastify-static');
const { CustomError } = require('./customError');
const libraryPath =
  process.env.COMICGLASS_LIBRARY_ROOT ?? path.join(__dirname, '..', 'books');
const allowedFileExtensions = [
  'gif',
  'png',
  'jpg',
  'jpeg',
  'tif',
  'tiff',
  'zip',
  'rar',
  'cbz',
  'cbr',
  'bmp',
  'pdf',
  'cgt',
];

// 缓存配置
const CACHE_MAX_SIZE = 10000; // 最多缓存 10000 个目录
const directoryCache = new Map(); // { path: { files: [], mtime: number, lastAccess: number } }

// LRU 缓存清理：当缓存超过限制时，删除最久未访问的条目
const cleanupCache = () => {
  if (directoryCache.size <= CACHE_MAX_SIZE) return;

  const entries = Array.from(directoryCache.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  const toDelete = entries.slice(0, directoryCache.size - CACHE_MAX_SIZE);
  toDelete.forEach(([key]) => directoryCache.delete(key));

  console.log(`Cache cleanup: removed ${toDelete.length} entries`);
};

// 获取或更新缓存
const getCachedDirectoryListing = async (pathToRead) => {
  try {
    // 获取目录的 mtime
    const dirStat = await fs.promises.stat(pathToRead);
    const currentMtime = Math.floor(dirStat.mtimeMs);

    // 检查缓存
    const cached = directoryCache.get(pathToRead);
    if (cached && cached.mtime === currentMtime) {
      // 缓存命中且未过期
      cached.lastAccess = Date.now();
      console.log(`Cache hit: ${pathToRead}`);
      return cached.files;
    }

    // 缓存未命中或已过期，重新读取
    console.log(`Cache miss: ${pathToRead}`);
    const files = await readDirectoryFiles(pathToRead);

    // 更新缓存
    directoryCache.set(pathToRead, {
      files,
      mtime: currentMtime,
      lastAccess: Date.now(),
    });

    // 清理过期缓存
    cleanupCache();

    return files;
  } catch (err) {
    if (err.code === 'ENOENT') throw new CustomError('Path does not exist');
    throw err;
  }
};

// 实际读取目录文件的函数
const readDirectoryFiles = async (pathToRead) => {
  const files = await fs.promises.readdir(pathToRead, {
    withFileTypes: true,
  });
  const result = [];
  for (const file of files) {
    const stats = await fs.promises.stat(path.join(pathToRead, file.name));
    if (!stats.isFile() && !stats.isDirectory()) continue;
    if (
      stats.isFile() &&
      !allowedFileExtensions.some((ext) =>
        path.extname(file.name).includes(ext),
      )
    )
      continue;

    result.push({
      name: file.name,
      path: path.join(pathToRead, file.name),
      modifyTime: Math.floor(stats.mtimeMs / 1000),
      size: stats.size,
      type: stats.isDirectory() ? 'dir' : 'file',
    });
  }
  return result;
};

const requestSchema = {
  schema: {
    querystring: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
    },
  },
};
const removeLibraryPath = (path) => {
  return path.replace(libraryPath, '');
};

const createHTML = (file) => {
  if (!['dir', 'file'].includes(file?.type)) return null;
  return file.type === 'dir'
    ? `<li type="circle">
      <a href="?path=${encodeURIComponent(
        removeLibraryPath(file.path),
      )}" bookdate="${file.modifyTime}">${encodeURIComponent(file.name)}</a>
    </li>`
    : `<li>
      <a href="${encodeURIComponent(
        removeLibraryPath(file.path),
      )}" booktitle="${file.name}" booksize="${file.size}" bookdate="${
        file.modifyTime
      }">${file.name}</a> 
    </li>`;
};

fastify.register(fastifyStatic, { root: libraryPath, prefix: '/' });

// 缓存统计端点
fastify.get('/cache-stats', async (request, reply) => {
  const stats = {
    size: directoryCache.size,
    maxSize: CACHE_MAX_SIZE,
    entries: Array.from(directoryCache.entries()).map(([path, data]) => ({
      path,
      mtime: data.mtime,
      lastAccess: new Date(data.lastAccess).toISOString(),
      fileCount: data.files.length,
    })),
  };
  reply.type('application/json').send(stats);
});

fastify.get('/', requestSchema, async (request, reply) => {
  try {
    const pathToRead = path.join(
      libraryPath,
      path.normalize(request.query.path ?? ''),
    );
    const pathToShow = _.isEmpty(request.query.path)
      ? './'
      : encodeURIComponent(path.normalize(request.query.path ?? ''));
    const files = await getCachedDirectoryListing(pathToRead);
    const html = files.map((file) => createHTML(file)).join('');
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
          <title>${pathToShow}</title>
        </head>
        <body>
          <h3>${pathToShow}</h3>
          <ul>
            ${html}
          </ul>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    if (err instanceof CustomError) reply.code(400).send(err.message);
    else reply.code(500).send(err.message);
  }
});

fastify.listen(3000, '0.0.0.0', () => {
  console.log('Server started on port 3000');
  console.log(`Library path: ${libraryPath}`);
  console.log(`Directory cache enabled (max size: ${CACHE_MAX_SIZE})`);
  console.log(`Cache stats available at: http://localhost:3000/cache-stats`);
});
