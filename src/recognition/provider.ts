import type { RecognitionResult } from "../shared/messages";

export interface RecognitionProvider {
  readonly name: string;
  recognize(audio: Blob, credential: string): Promise<Omit<RecognitionResult, "provider">>;
}

interface AudDResponse {
  status?: string;
  error?: { error_message?: string };
  result?: { title?: string; artist?: string; album?: string; release_date?: string; song_link?: string } | null;
}

export function parseAudDResponse(payload: AudDResponse): Omit<RecognitionResult, "provider"> {
  if (payload.status !== "success") throw new Error(payload.error?.error_message || "AudD did not recognize this excerpt.");
  if (!payload.result?.title || !payload.result.artist) throw new Error("No matching track was found in this excerpt.");
  return {
    title: payload.result.title,
    artist: payload.result.artist,
    ...(payload.result.album ? { album: payload.result.album } : {}),
    ...(payload.result.release_date ? { releaseDate: payload.result.release_date } : {}),
    ...(payload.result.song_link ? { songUrl: payload.result.song_link } : {}),
  };
}

/** AudD's documented multipart file endpoint; no third-party code or credentials are bundled. */
export class AudDProvider implements RecognitionProvider {
  readonly name = "AudD" as const;
  async recognize(audio: Blob, credential: string): Promise<Omit<RecognitionResult, "provider">> {
    if (!credential.trim()) throw new Error("Add an AudD API token in MixPilot settings first.");
    const form = new FormData();
    form.append("api_token", credential.trim());
    form.append("file", audio, "mixpilot-excerpt.webm");
    const response = await fetch("https://api.audd.io/", { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`AudD could not process the excerpt (HTTP ${response.status}).`);
    return parseAudDResponse(await response.json() as AudDResponse);
  }
}
