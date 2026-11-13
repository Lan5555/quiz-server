export interface CandidateRecord {
  photo_image_id: string | null;
  id: string;
  poll_id: string;
  name: string;
  bio: string;
  photo_url: string | null;
  active: boolean;
}
