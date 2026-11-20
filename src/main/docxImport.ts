import { inflateRawSync } from 'node:zlib';
import { ServiceError } from './errors';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readEntry(buffer: Buffer, name: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new ServiceError(400, 'DOCX 文件不是有效的压缩包', 'DOCX_INVALID');
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < total; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new ServiceError(400, 'DOCX 使用了不支持的压缩方式', 'DOCX_UNSUPPORTED');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

/** 从 DOCX 字节中提取纯文本，按段落换行。依赖标准 WordprocessingML 结构。 */
export function extractDocxText(buffer: Buffer): string {
  const documentXml = readEntry(buffer, 'word/document.xml');
  if (!documentXml) throw new ServiceError(400, 'DOCX 文件缺少 word/document.xml，无法读取正文', 'DOCX_INVALID');
  const xml = documentXml.toString('utf8');
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n');
  const text = withBreaks
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => decodeEntities(line).trimEnd())
    .join('\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
