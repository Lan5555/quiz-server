import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { DataSource, EntityManager } from 'typeorm';
import { fail, VotingConfig } from '../common/voting';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type ImagePurpose = 'POLL' | 'CANDIDATE';
export interface ImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
interface ImageRecord {
  id: string;
  url: string;
  public_id: string;
  purpose: ImagePurpose;
}
interface CloudinaryImage {
  public_id: string;
  secure_url: string;
  resource_type: string;
  type: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export function imageFormat(file: ImageFile): 'jpg' | 'png' | 'webp' {
  if (
    !file.buffer ||
    file.buffer.length !== file.size ||
    file.size < 12 ||
    file.size > MAX_IMAGE_BYTES
  )
    fail(400, 'Choose a non-empty image up to 5 MB');
  const b = file.buffer;
  if (
    file.mimetype === 'image/jpeg' &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255
  )
    return 'jpg';
  if (
    file.mimetype === 'image/png' &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (
    file.mimetype === 'image/webp' &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  fail(400, 'Only JPEG, PNG and WebP images are supported');
}

@Injectable()
export class VotingImagesService {
  constructor(
    private readonly db: DataSource,
    private readonly config: VotingConfig,
  ) {}
  async upload(
    file: ImageFile | undefined,
    purpose: ImagePurpose,
    actor: string,
  ) {
    if (!file) fail(400, 'Choose an image to upload using the file field');
    const format = imageFormat(file);
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET');
    if (!/^[a-zA-Z0-9_-]+$/.test(cloudName) || !apiKey || !apiSecret)
      fail(503, 'Image uploads are not configured');
    const id = randomUUID();
    const publicId = `quiz-server/voting/${purpose === 'POLL' ? 'polls' : 'candidates'}/${id}`;
    // Record before contacting the provider, so absent migrations never create an upload.
    await this.db.query(
      `INSERT INTO voting_images(id,public_id,purpose,uploaded_by) VALUES($1,$2,$3,$4)`,
      [id, publicId, purpose, actor],
    );
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
        `image.${format}`,
      );
      form.append('public_id', publicId);
      form.append('overwrite', 'false');
      form.append('transformation', 'c_limit,w_2000,h_2000');
      const { data: asset } = await axios.post<CloudinaryImage>(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        form,
        {
          auth: { username: apiKey, password: apiSecret },
          timeout: 30000,
          maxRedirects: 0,
          maxBodyLength: MAX_IMAGE_BYTES + 65536,
          maxContentLength: 65536,
        },
      );
      const url = new URL(asset.secure_url);
      if (
        asset.public_id !== publicId ||
        asset.resource_type !== 'image' ||
        asset.type !== 'upload' ||
        !['jpg', 'jpeg', 'png', 'webp'].includes(asset.format) ||
        url.protocol !== 'https:' ||
        url.hostname !== 'res.cloudinary.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith(`/${cloudName}/image/upload/`) ||
        !Number.isSafeInteger(asset.width) ||
        asset.width < 1 ||
        asset.width > 2000 ||
        !Number.isSafeInteger(asset.height) ||
        asset.height < 1 ||
        asset.height > 2000 ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 1 ||
        asset.bytes > MAX_IMAGE_BYTES
      )
        fail(503, 'Image provider returned an invalid image');
      await this.db.transaction(async (m) => {
        await m.query(
          `UPDATE voting_images SET state='READY',url=$2,width=$3,height=$4,bytes=$5,format=$6 WHERE id=$1`,
          [
            id,
            url.toString(),
            asset.width,
            asset.height,
            asset.bytes,
            asset.format,
          ],
        );
        await m.query(
          `INSERT INTO voting_admin_audit(id,actor,action,entity) VALUES($1,$2,'UPLOAD_IMAGE',$3)`,
          [randomUUID(), actor, id],
        );
      });
      return {
        imageId: id,
        url: url.toString(),
        publicId,
        purpose,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        format: asset.format,
      };
    } catch {
      // Never log provider errors: they can contain authorization headers and uploaded bytes.
      await this.db.query(
        `UPDATE voting_images SET state='FAILED' WHERE id=$1 AND state='PENDING'`,
        [id],
      );
      fail(503, 'Image upload could not be completed. Please try again.');
    }
  }
  async resolve(
    id: string | null | undefined,
    purpose: ImagePurpose,
    actor: string,
    manager: EntityManager,
  ) {
    if (id == null) return null;
    const [image] = await manager.query<ImageRecord[]>(
      `SELECT id,url,public_id,purpose FROM voting_images WHERE id=$1 AND purpose=$2 AND uploaded_by=$3 AND state='READY'`,
      [id, purpose, actor],
    );
    if (!image)
      fail(
        400,
        'Image unavailable. Upload an image for this form using your current voting admin account.',
      );
    return image;
  }
}
