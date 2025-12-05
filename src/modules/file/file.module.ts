import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { FileService } from './file.service';
import { FileController } from './file.controller';

@Global()
@Module({
  imports:[PrismaModule],
  controllers:[FileController],
  providers: [FileService],
  exports:[FileService]
})
export class FileModule {}
