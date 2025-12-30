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
