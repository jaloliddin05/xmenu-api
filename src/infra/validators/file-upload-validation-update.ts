import { ParseFilePipeBuilder } from '@nestjs/common';

export const FileUploadValidationForOptional = new ParseFilePipeBuilder()
  // .addFileTypeValidator({
  //   fileType: /(jpg|jpeg|png|pdf|mp3|doc|audio|mpeg)$/,
  // })
  .addMaxSizeValidator({
    maxSize: 20 * 1024 * 1024,
  })
  .build({
    fileIsRequired: false,
  });