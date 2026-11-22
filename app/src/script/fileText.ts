/** 读取文本文件：自动识别 UTF-8 / GBK(GB18030) / UTF-16，避免中文乱码 */

export function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);

  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  }


  // 没有 BOM 的 UTF-16：靠 0 字节分布判断字节序
  const head = bytes.subarray(0, Math.min(bytes.length, 4096));
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < head.length; i++) {
    if (head[i] !== 0) continue;
    if (i % 2 === 0) evenZero++; else oddZero++;
  }
  if (oddZero > head.length * 0.1 || evenZero > head.length * 0.1) {
    const enc = evenZero > oddZero ? "utf-16be" : "utf-16le";
    return new TextDecoder(enc).decode(bytes).replace(/\u0000/g, "");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    /* 不是合法 UTF-8，继续试 GBK */
  }

  for (const enc of ["gb18030", "gbk"]) {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
      /* 换下一个 */
    }
  }

  return new TextDecoder("utf-8").decode(bytes);
}
