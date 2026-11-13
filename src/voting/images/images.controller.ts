import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn } from 'class-validator';
import type { AdminRequest } from '../auth/voting-auth.service';
import { VotingAdminGuard } from '../auth/voting-auth.service';
import { VotingRateGuard } from '../common/voting-rate.guard';
import { ok, VotingExceptionFilter } from '../common/voting';
import { MAX_IMAGE_BYTES, VotingImagesService } from './images.service';
import type { ImageFile, ImagePurpose } from './images.service';

export class UploadVotingImageDto {
  @IsIn(['POLL', 'CANDIDATE']) purpose: ImagePurpose;
}

@Controller('votes/api/admin/images')
@UseFilters(VotingExceptionFilter)
@UseGuards(VotingRateGuard, VotingAdminGuard)
export class VotingImagesController {
  constructor(private readonly images: VotingImagesService) {}
  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      // Busboy emits partsLimit when it reaches the threshold; allow the closing boundary.
      limits: {
        fileSize: MAX_IMAGE_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 16,
        parts: 3,
      },
    }),
  )
  async upload(
    @UploadedFile() file: ImageFile | undefined,
    @Body() body: UploadVotingImageDto,
    @Req() req: AdminRequest,
  ) {
    return ok(
      await this.images.upload(file, body.purpose, req.votingAdminId),
      'Image uploaded',
    );
  }
}
