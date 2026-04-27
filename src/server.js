const buildFastify = require('fastify');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const fastifyStatic = require('fastify-static');
const sharp = require('sharp');
const winston = require('winston');
const { LRUCache } = require('lru-cache')
const { ResponseItem } = require('./schema');
const { CustomError } = require('./customError');
const defaultLibraryPath =
  process.env.COMICGLASS_LIBRARY_ROOT ?? path.join(__dirname, '..', 'books');
const defaultResizedImageMaxEdge = Number.parseInt(
  process.env.COMICGLASS_RESIZED_IMAGE_MAX_EDGE ?? '1440',
  10,
);
const resizedRootPath = '/resized';
const imageFileExtensions = [
  'gif',
  'png',
  'jpg',
  'jpeg',
  'tif',
  'tiff',
  'bmp',
  'webp',
];
const allowedFileExtensions = [
  ...imageFileExtensions,
  'zip',
  'rar',
  'cbz',
  'cbr',
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

const cachedDirectoryList = new LRUCache({
  max: 20000,
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} ${level}: ${message} ${stack ? `\n${stack}` : ''}`;
    }),
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

const statPathWithCache = async (pathToRead) => {
  if (cachedDirectoryList.has(pathToRead)) {
    return cachedDirectoryList.get(pathToRead);
  }

  const result = await fs.promises.stat(pathToRead);
  // 資料夾和檔案建了基本上就不會變動了
  cachedDirectoryList.set(pathToRead, result);
  return result;
}


const listAllFilesInDirectory = async (pathToRead) => {
  try {
    const files = await fs.promises.readdir(pathToRead, {
      withFileTypes: true,
    });
    const stats = await Promise.all(
      files.map(file => statPathWithCache(path.join(pathToRead, file.name)))
    );
    const fileStats = [];
    for (let i = 0; i < files.length; i++) { fileStats.push({ file: files[i], stat: stats[i] }); }
    const result = fileStats.map(({ file, stat }) => {
      if (!stat.isFile() && !stat.isDirectory()) return;
      if (
        stat.isFile() &&
        !allowedFileExtensions.some((ext) =>
          path.extname(file.name).includes(ext),
        )
      ) return;

      return new ResponseItem({
        name: file.name,
        path: path.join(pathToRead, file.name),
        modifyTime: Math.floor(stat.mtimeMs / 1000),
        size: stat.size,
        type: stat.isDirectory() ? 'dir' : 'file',
      });
    });

    return result;
  } catch (err) {
    if (err.code === 'ENOENT') throw new CustomError('Path does not exist');
    throw err;
  }
};

const isImageFile = (fileName) => {
  return imageFileExtensions.includes(path.extname(fileName).slice(1).toLowerCase());
};

const filterResizedListingFiles = (files) => {
  return files.filter((file) => file && (file.type === 'dir' || isImageFile(file.name)));
};

const removeLibraryPath = (path, libraryPath) => {
  return path.replace(libraryPath, '');
};

const createResizedPath = (libraryRelativePath) => {
  return `${resizedRootPath}${libraryRelativePath}`.replace(/\.[^/.]+$/, '.webp');
};

const createResizedName = (name) => {
  return name.replace(/\.[^/.]+$/, '.webp');
};

const createHTML = (file, libraryPath, { resizedListing = false } = {}) => {
  if (!['dir', 'file'].includes(file?.type)) return null;
  const libraryRelativePath = removeLibraryPath(file.path, libraryPath);
  const hrefPath = resizedListing
    ? `${resizedRootPath}${libraryRelativePath}`
    : libraryRelativePath;
  const fileHrefPath = resizedListing
    ? createResizedPath(libraryRelativePath)
    : libraryRelativePath;
  const fileName = resizedListing
    ? createResizedName(file.name)
    : file.name;

  return file.type === 'dir'
    ? `<li type="circle">
      <a href="?path=${encodeURIComponent(
      hrefPath,
    )}" bookdate="${file.modifyTime}">${encodeURIComponent(file.name)}</a>
    </li>`
    : `<li>
      <a href="${encodeURIComponent(
      fileHrefPath,
    )}" booktitle="${fileName}" booksize="${file.size}" bookdate="${file.modifyTime
    }">${fileName}</a>${' '}
    </li>`;
};

const createInitialCache = async (libraryPath) => {
  await listAllFilesInDirectory(libraryPath);
};

const createResizedRootItem = (libraryPath) => {
  return new ResponseItem({
    name: resizedRootPath.slice(1),
    path: path.join(libraryPath, resizedRootPath),
    modifyTime: 0,
    size: 0,
    type: 'dir',
  });
};

const createListingContext = (libraryPath, requestedPath) => {
  const normalizedPath = path.normalize(requestedPath ?? '');
  const resizedListing =
    normalizedPath === resizedRootPath ||
    normalizedPath.startsWith(`${resizedRootPath}${path.sep}`);
  const libraryListingPath = resizedListing
    ? normalizedPath.slice(resizedRootPath.length)
    : normalizedPath;

  return {
    normalizedPath,
    resizedListing,
    pathToRead: path.join(libraryPath, libraryListingPath),
  };
};

const isInsideLibrary = (libraryPath, pathToCheck) => {
  const relativePath = path.relative(libraryPath, pathToCheck);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
};

const resolveResizedSourcePath = async (libraryPath, requestedPath) => {
  if (path.extname(requestedPath).toLowerCase() !== '.webp') {
    throw new CustomError('Path does not exist', 404);
  }

  const sourcePathWithoutExtension = path.resolve(
    libraryPath,
    requestedPath.slice(0, -path.extname(requestedPath).length),
  );

  if (!isInsideLibrary(libraryPath, sourcePathWithoutExtension)) {
    throw new CustomError('Path does not exist', 404);
  }

  for (const extension of imageFileExtensions) {
    const sourcePath = `${sourcePathWithoutExtension}.${extension}`;
    try {
      const stat = await statPathWithCache(sourcePath);
      if (stat.isFile()) return sourcePath;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  throw new CustomError('Path does not exist', 404);
};

const createResizedImage = async (sourcePath, resizedImageMaxEdge) => {
  return sharp(sourcePath)
    .rotate()
    .resize({
      width: resizedImageMaxEdge,
      height: resizedImageMaxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp()
    .toBuffer();
};

const sendResizedImage = async (reply, libraryPath, requestedPath, resizedImageMaxEdge) => {
  try {
    const sourcePath = await resolveResizedSourcePath(libraryPath, requestedPath);
    const resizedImage = await createResizedImage(sourcePath, resizedImageMaxEdge);
    reply.type('image/webp').header('Cache-Control', 'no-store').send(resizedImage);
  } catch (err) {
    if (err instanceof CustomError) reply.code(err.code ?? 400).send(err.message);
    else reply.code(500).send(err.message);
  }
};

const getEncodedLeadingSlashResizedPath = (rawUrl) => {
  const decodedPath = decodeURIComponent(rawUrl.split('?')[0]);
  if (!decodedPath.startsWith(`/${resizedRootPath}/`)) return null;
  return decodedPath.slice(`/${resizedRootPath}/`.length);
};

const createServer = ({
  libraryPath = defaultLibraryPath,
  resizedImageMaxEdge = defaultResizedImageMaxEdge,
} = {}) => {
  const fastify = buildFastify({ logger: false });

  fastify.get('/resized/*', async (request, reply) => {
    await sendResizedImage(reply, libraryPath, request.params['*'], resizedImageMaxEdge);
  });

  fastify.register(fastifyStatic, { root: libraryPath, prefix: '/' });

  fastify.setNotFoundHandler(async (request, reply) => {
    const requestedPath = getEncodedLeadingSlashResizedPath(request.raw.url);
    if (requestedPath === null) {
      reply.code(404).send({
        message: `Route ${request.method}:${request.raw.url} not found`,
        error: 'Not Found',
        statusCode: 404,
      });
      return;
    }

    await sendResizedImage(reply, libraryPath, requestedPath, resizedImageMaxEdge);
  });

  fastify.get('/', requestSchema, async (request, reply) => {
    try {
      const { normalizedPath, resizedListing, pathToRead } = createListingContext(
        libraryPath,
        request.query.path,
      );
      const pathToShow = _.isEmpty(request.query.path)
        ? './'
        : encodeURIComponent(normalizedPath);
      const files = await listAllFilesInDirectory(pathToRead);
      const listingFiles = resizedListing
        ? filterResizedListingFiles(files)
        : files;
      const filesToRender = _.isEmpty(request.query.path)
        ? [createResizedRootItem(libraryPath), ...listingFiles]
        : listingFiles;
      const html = filesToRender.map((file) => createHTML(file, libraryPath, {
        resizedListing,
      })).join('');
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

  return fastify;
};

const main = () => {
  const fastify = createServer();
  console.log('Creating initial cache...');
  createInitialCache(defaultLibraryPath).then(() => {
    console.log('Initial cache created');
  }).catch((err) => {
    console.error(err);
  });
  console.log('Starting server...');
  fastify.listen(3000, '0.0.0.0', (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log('Server started on port 3000');
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  createServer,
};
