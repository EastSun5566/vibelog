export interface ApiPayload {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
  pollUrl?: string;
  progress?: {
    kind?: string;
    value?: number;
    max?: number;
  };
  status?: string;
  successUrl?: string;
}

export async function readPayload(response: Response): Promise<ApiPayload> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === 'object' ? payload as ApiPayload : {};
  } catch {
    return {};
  }
}
