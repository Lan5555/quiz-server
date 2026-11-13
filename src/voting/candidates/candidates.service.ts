import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CreateCandidateDto } from '../common/voting.dto';
import { fail, VotingConfig } from '../common/voting';
import { audit } from '../polls/polls.service';
import { VotingImagesService } from '../images/images.service';
@Injectable()
export class CandidatesService {
  constructor(
    private readonly db: DataSource,
    private readonly config: VotingConfig,
    private readonly images: VotingImagesService,
  ) {}
  async create(pollId: string, body: CreateCandidateDto, actor: string) {
    if (body.photoImageId != null && body.photoUrl != null)
      fail(400, 'Supply photoImageId or photoUrl, not both');
    if (body.photoUrl != null) {
      let url: URL;
      try {
        url = new URL(body.photoUrl);
      } catch {
        fail(400, 'Candidate photo must be an HTTPS URL');
      }
      const hosts = this.config
        .get('VOTING_IMAGE_HOSTS')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !hosts.includes(url.hostname)
      )
        fail(400, 'Candidate photo host is not allowed');
    }
    return this.db.transaction(async (m) => {
      const [p] = await m.query<{ state: string }[]>(
        `SELECT state FROM voting_polls WHERE id=$1 FOR UPDATE`,
        [pollId],
      );
      if (!p) fail(404, 'Poll unavailable');
      if (p.state !== 'DRAFT')
        fail(409, 'Candidates can only be registered for drafts');
      const image = await this.images.resolve(
        body.photoImageId,
        'CANDIDATE',
        actor,
        m,
      );
      const id = randomUUID();
      await m.query(
        `INSERT INTO voting_candidates(id,poll_id,name,bio,photo_url,photo_image_id) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          pollId,
          body.name,
          body.bio,
          image?.url ?? body.photoUrl ?? null,
          image?.id ?? null,
        ],
      );
      await audit(m, actor, 'REGISTER_CANDIDATE', id);
      return {
        id,
        name: body.name,
        bio: body.bio,
        photoUrl: image?.url ?? body.photoUrl ?? null,
        photoImageId: image?.id ?? null,
        active: true,
        voteCount: 0,
      };
    });
  }
}
