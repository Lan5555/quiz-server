export interface PollRecord {
  image_id: string | null;
  image_url: string | null;
  id: string;
  slug: string;
  title: string;
  description: string;
  state: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  currency: 'NGN';
  price: string;
  max_quantity: number;
  opens_at: Date;
  closes_at: Date;
  results_visible: boolean;
}
