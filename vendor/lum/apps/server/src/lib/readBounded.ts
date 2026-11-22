export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, message: string) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Object.assign(new Error(message), { status: 413 });
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); }
}
