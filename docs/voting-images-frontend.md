# Voting images frontend handoff

The backend uploads poll covers and candidate portraits to Cloudinary. The
frontend only needs its existing `NEXT_PUBLIC_DATABASE_LINK`. No Cloudinary key,
secret, cloud name, SDK, upload preset or signature is needed in the browser.

## Deployment

Apply `docs/sql/voting-cloudinary-images.sql` to an existing voting database, or
run the registered TypeORM migrations. The combined
`docs/sql/paid-voting-flutterwave.sql` also includes the image migration and tracks
it in TypeORM's history. The script is safe to rerun with intact migration history.

Configure these settings on the backend and restart it:


## Authentication

Use the token returned by `POST /votes/api/admin/login`, stored separately from
the existing portal session (for example `sessionStorage.votingAdminSession`).
Upload and creation requests require `Authorization: Bearer <voting-admin-token>`.

## Upload an image

`POST /votes/api/admin/images`

Request: `multipart/form-data`, with two fields:

| Field     | Value                                                      |
| --------- | ---------------------------------------------------------- |
| `file`    | One JPEG, PNG or WebP file, at most 5 MiB (5242880 bytes). |
| `purpose` | `POLL` for a cover, or `CANDIDATE` for a portrait.         |

Do not manually set `Content-Type`; the browser supplies its multipart boundary.
The backend checks MIME type and file signatures. Cloudinary decodes the image
and limits its dimensions to 2000 × 2000 while preserving aspect ratio.
SVG, GIF, PDF and video uploads are not supported.

Success status: `201`. Response:

```ts
type UploadedVotingImage = {
  imageId: string;
  url: string;
  publicId: string;
  purpose: 'POLL' | 'CANDIDATE';
  width: number;
  height: number;
  bytes: number;
  format: 'jpg' | 'jpeg' | 'png' | 'webp';
};

type UploadResponse = {
  success: true;
  message: string;
  data: UploadedVotingImage;
};
```

Example helper:

```ts
const VOTES_API = `${process.env.NEXT_PUBLIC_DATABASE_LINK}/votes/api`;

async function uploadVotingImage(
  file: File,
  purpose: 'POLL' | 'CANDIDATE',
  votingAdminToken: string,
): Promise<UploadedVotingImage> {
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', file);

  const response = await fetch(`${VOTES_API}/admin/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${votingAdminToken}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    const message = Array.isArray(result.message)
      ? result.message.join(', ')
      : result.message || 'Image upload failed';
    throw new Error(message);
  }
  return result.data;
}
```

Use `data.url` for the preview. Retain `data.imageId` in form state. Wait for upload
success before enabling form submission. A failed upload must not be treated as
a saved image. Upload retries create a new asset; this endpoint is not idempotent.

## Create a poll with a cover

Upload with `purpose=POLL`, then call the existing `POST /votes/api/admin/polls`
using JSON and the returned `imageId`:

```json
{
  "title": "Student Awards",
  "description": "Support your preferred candidate.",
  "currency": "NGN",
  "votePriceMinor": 10000,
  "maxVotesPerPurchase": 1000,
  "opensAt": "2026-12-01T08:00:00.000Z",
  "closesAt": "2026-12-10T20:00:00.000Z",
  "resultsVisible": true,
  "imageId": "<imageId returned from a POLL upload>"
}
```

For a poll without a cover, omit `imageId` or send `null`. Do not submit `imageUrl`,
`url` or `publicId`; the backend resolves the saved URL from the image record.

## Register a candidate with a portrait

Upload with `purpose=CANDIDATE`, then call the existing
`POST /votes/api/admin/polls/:pollId/candidates` using JSON:

```json
{
  "name": "Candidate name",
  "bio": "Candidate biography",
  "photoImageId": "<imageId returned from a CANDIDATE upload>"
}
```

For a candidate without a portrait, omit `photoImageId` or send `null`.
The legacy `photoUrl` input still accepts HTTPS URLs on configured
`VOTING_IMAGE_HOSTS`. If using an upload ID, omit `photoUrl` or set it to `null`;
sending both non-null fields returns `400`.

## Read/display changes

The existing poll type gains:

```ts
imageId: string | null;
imageUrl: string | null;
```

The candidate type gains:

```ts
photoImageId: string | null;
```

Its existing `photoUrl: string | null` contains the canonical Cloudinary URL for
uploaded portraits. These fields are returned on creation and on existing public
and admin poll list/detail endpoints. Candidate fields are in detail responses.

Render `poll.imageUrl` on poll cards/detail banners and `candidate.photoUrl` on
candidate cards. Show an empty state or initials when a URL is null. If using
Next.js `Image`, configure `images.remotePatterns` to allow HTTPS
`res.cloudinary.com` paths under your cloud name. Images use public Cloudinary
delivery URLs; do not upload private identity documents or other private data.

Only images uploaded by the currently authenticated voting administrator and for
the matching purpose can be attached. Polls are created as drafts, candidate
registration is draft-only, and configuration remains locked after publication.
No image editing/deletion endpoints are added by this change.

## Errors and operations

| Status        | Meaning                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `400`         | Missing file, unsupported/mismatched image type, invalid purpose/image ID, or conflicting candidate photo fields. |
| `401` / `403` | Missing, expired, revoked or unauthorized voting admin session.                                                   |
| `409`         | Candidate registration attempted after draft publication/closure.                                                 |
| `413`         | File exceeds 5 MiB.                                                                                               |
| `429`         | Shared voting admin mutation rate limit reached.                                                                  |
| `503`         | Cloudinary settings unavailable, provider failure/timeout, or database unavailable.                               |

The provider timeout is 30 seconds; the sample frontend request allows 60 seconds
for transfer plus processing. Reverse-proxy limits must permit a multipart body
slightly larger than 5 MiB and a request lasting at least 60 seconds. Never log
upload request bodies, credentials or provider request/response errors.

An upload abandoned before form submission remains an unattached asset. A network
or database failure after Cloudinary receives a file can also leave an orphan.
The backend tracks pending/failed records and uses a UUID public ID under
`quiz-server/voting/polls/` or `quiz-server/voting/candidates/`. Clean up abandoned
assets through Cloudinary after checking that no poll/candidate references them.
There is no automatic deletion worker in this change.

Local tests mock Cloudinary while exercising actual PostgreSQL migrations, image
ownership, poll/candidate URL persistence, file validation and multipart HTTP.
They do not prove configured Cloudinary credentials, a live upload, browser
rendering or Next.js image configuration. Validate one real upload and its public
delivery URL before deployment. The backend follows Cloudinary's
[server-side Upload API](https://cloudinary.com/documentation/upload_images).
