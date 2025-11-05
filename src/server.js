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

// 快取設定
const CACHE_MAX_SIZE = 10000; // 最多快取 10000 個目錄
const directoryCache = new Map(); // { path: { files: [], mtime: number, lastAccess: number } }

// LRU 快取清理：當快取超過限制時，刪除最久未存取的項目
const cleanupCache = () => {
  if (directoryCache.size <= CACHE_MAX_SIZE) return;

  const entries = Array.from(directoryCache.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  const toDelete = entries.slice(0, directoryCache.size - CACHE_MAX_SIZE);
  toDelete.forEach(([key]) => directoryCache.delete(key));

  console.log(`快取清理: 移除 ${toDelete.length} 個項目`);
};

// 取得或更新快取
const getCachedDirectoryListing = async (pathToRead) => {
  try {
    // 取得目錄的 mtime
    const dirStat = await fs.promises.stat(pathToRead);
    const currentMtime = Math.floor(dirStat.mtimeMs);

    // 檢查快取
    const cached = directoryCache.get(pathToRead);
    if (cached && cached.mtime === currentMtime) {
      // 快取命中且未過期
      cached.lastAccess = Date.now();
      console.log(`快取命中: ${pathToRead}`);
      return cached.files;
    }

    // 快取未命中或已過期，重新讀取
    console.log(`快取未命中: ${pathToRead}`);
    const files = await readDirectoryFiles(pathToRead);

    // 更新快取
    directoryCache.set(pathToRead, {
      files,
      mtime: currentMtime,
      lastAccess: Date.now(),
    });

    // 清理過期快取
    cleanupCache();

    return files;
  } catch (err) {
    if (err.code === 'ENOENT') throw new CustomError('Path does not exist');
    throw err;
  }
};

// 實際讀取目錄檔案的函數
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

// 遞迴掃描所有子資料夾並預先載入快取
const prewarmCache = async (dirPath, level = 0) => {
  try {
    // 讀取並快取當前目錄
    await getCachedDirectoryListing(dirPath);

    // 取得子資料夾列表
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const subdirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dirPath, entry.name));

    // 非同步遞迴處理所有子資料夾
    await Promise.all(
      subdirs.map(subdir => prewarmCache(subdir, level + 1))
    );

    if (level === 0) {
      console.log(`\n預載完成！已快取 ${directoryCache.size} 個目錄`);
    }
  } catch (err) {
    // 忽略無法存取的目錄
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`預載錯誤 (${dirPath}):`, err.message);
    }
  }
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

// 快取統計端點
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

fastify.listen(3000, '0.0.0.0', async () => {
  console.log('伺服器已啟動於 port 3000');
  console.log(`資料庫路徑: ${libraryPath}`);
  console.log(`目錄快取已啟用 (最大容量: ${CACHE_MAX_SIZE})`);
  console.log(`快取統計可於此查看: http://localhost:3000/cache-stats`);

  // 啟動時預載所有資料夾到快取（非同步執行，不阻塞伺服器）
  console.log('\n開始預載資料夾快取...');
  const startTime = Date.now();

  prewarmCache(libraryPath).then(() => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`快取預載耗時: ${duration} 秒`);
  }).catch(err => {
    console.error('快取預載失敗:', err.message);
  });
});
