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

const listAllFilesInDirectory = async (pathToRead) => {
  try {
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

fastify.listen(3000, '0.0.0.0', () => {
  console.log('Server started on port 3000');
});
