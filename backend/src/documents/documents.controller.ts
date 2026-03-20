import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.csv'];

function isAllowedFile(mimetype: string, originalname: string): boolean {
  const ext = originalname.toLowerCase().slice(originalname.lastIndexOf('.'));
  return (
    ALLOWED_MIME_TYPES.includes(mimetype) &&
    ALLOWED_EXTENSIONS.includes(ext)
  );
}

@Controller('documents')
@UseGuards(AuthGuard('jwt'))
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
      fileFilter: (_req, file, cb) => {
        if (!isAllowedFile(file.mimetype, file.originalname)) {
          cb(
            new BadRequestException(
              'Invalid file type. Allowed: PDF, PNG, JPG, JPEG, CSV.',
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  upload(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.upload(req.user.id, dto, file);
  }

  @Get()
  findAll(
    @Req() req: any,
    @Query('accountId') accountId?: string,
  ) {
    const accountIdNum = accountId ? parseInt(accountId, 10) : undefined;
    return this.documentsService.findAllByUser(
      req.user.id,
      accountIdNum != null && !isNaN(accountIdNum) ? accountIdNum : undefined,
    );
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.documentsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDocumentDto) {
    return this.documentsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.documentsService.remove(id, req.user.id);
  }
}
