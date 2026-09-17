/**
 * Transcribes an audio/video file's audio track using OpenAI Whisper.
 * Accepts video containers (MP4, MOV, WebM) and common audio formats.
 */
export async function transcribeWithWhisper(
  fileName: string,
  fileBytes: ArrayBuffer,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('xxxxx')) {
    throw new Error(
      'Transcription not configured: set OPENAI_API_KEY in your environment'
    );
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([fileBytes], { type: mimeType || 'application/octet-stream' }),
    fileName
  );
  form.append('model', 'whisper-1');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new Error('Could not reach the transcription service');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.message)) ||
      `Transcription request failed with status ${res.status}`;
    throw new Error(`Transcription error: ${message}`);
  }

  if (!data || !data.text || typeof data.text !== 'string') {
    throw new Error('Transcription service returned no text');
  }

  return data.text;
}