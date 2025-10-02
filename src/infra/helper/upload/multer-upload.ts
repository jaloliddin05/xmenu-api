import { diskStorage } from 'multer';

export const decodeFilename = (filename: string): string => {
  return Buffer.from(filename, 'latin1').toString('utf8');
};

export const MulterStorage = (dest) =>
  diskStorage({
    destination: dest,
    filename: (req, file, cb) => {
      const randomName = `${new Date().getTime()}`;
      const originalname = decodeFilename(file.originalname);
      return cb(
        null,
        `${originalname.split('.')[0]}${randomName}.${
          originalname.split('.')[originalname.split('.').length - 1]
        }`,
      );
    },
  });