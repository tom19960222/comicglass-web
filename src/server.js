const fastify = require('fastify')({ logger: false });
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const fastifyStatic = require('fastify-static');
const winston = require('winston');
const { ResponseItem, CacheItem } = require('./schema');
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

const cachedDirectoryList = new Map();
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

const listAllFilesInDirectory = async (pathToRead) => {
  try {
    const dirMTime = (await fs.promises.stat(pathToRead)).mtimeMs;
    if (cachedDirectoryList.has(pathToRead) && dirMTime <= cachedDirectoryList.get(pathToRead).mtimeMs) {
      logger.info(`pathToRead=${pathToRead} dirMTime=${dirMTime} cacheMTime=${cachedDirectoryList.get(pathToRead).mtimeMs} Returning cache.`);
      return cachedDirectoryList.get(pathToRead).files;
    }
    logger.info(`Cache missed for pathToRead=${pathToRead} begin reading directory.`);
    const files = await fs.promises.readdir(pathToRead, {
      withFileTypes: true,
    });
    const stats = await Promise.all(
      files.map(file => fs.promises.stat(path.join(pathToRead, file.name)))
    );
    const fileStats = [];
    for(let i = 0; i < files.length; i++) { fileStats.push({file: files[i], stat: stats[i]}); }
    const result = fileStats.map(({file, stat}) => {
      if (!stat.isFile() && !stat.isDirectory()) return;
      if (
        stat.isFile() &&
        !allowedFileExtensions.some((ext) =>
          path.extname(file.name).includes(ext),
        )
      ) return;
      logger.info(`Cache missed for pathToRead=${pathToRead} end reading directory.`);

      return new ResponseItem({
        name: file.name,
        path: path.join(pathToRead, file.name),
        modifyTime: Math.floor(stat.mtimeMs / 1000),
        size: stat.size,
        type: stat.isDirectory() ? 'dir' : 'file',
      });
    });
      
    cachedDirectoryList.set(pathToRead, new CacheItem(dirMTime, result));
    return result;
  } catch (err) {
    if (err.code === 'ENOENT') throw new CustomError('Path does not exist');
    throw err;
  }
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

const createInitialCache = async () => {
  await listAllFilesInDirectory(libraryPath);
};

fastify.register(fastifyStatic, { root: libraryPath, prefix: '/' });

fastify.get('/', requestSchema, async (request, reply) => {
  try {
    const pathToRead = path.join(
      libraryPath,
      path.normalize(request.query.path ?? ''),
    );
    const pathToShow = _.isEmpty(request.query.path)
      ? './'
      : encodeURIComponent(path.normalize(request.query.path ?? ''));
    const files = await listAllFilesInDirectory(pathToRead);
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

const main = () => {
  console.log('Creating initial cache...');
  createInitialCache().then(() => {
    console.log('Initial cache created');
  }).catch((err) => {
    console.error(err);
  });
  console.log('Starting server...');
  fastify.listen(3000, '0.0.0.0', () => {
    console.log('Server started on port 3000');
  });
}

main();
