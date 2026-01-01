export interface NetResponse {
  success: boolean;
  message: string;
  data: Record<string, any> | null;
}

export interface CodeStat {
  code: string;
  attempts: number;
  uses: number;
}

export interface Review {
  question: string;
  picked: string;
  correct: string;
}
