import { gunzipSync, inflateRawSync } from 'node:zlib';

const TAR_BLOCK_BYTES = 512;
const MAX_EXTRACTED_MEMBER_BYTES = 32 * 1024 * 1024;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

/** Extracts only exact, manifest-pinned members; archive paths never reach the filesystem. */
export function extractArchiveMembers(archive, format, requestedMembers) {
  const requested = new Set(requestedMembers);
  if (format === 'tar.gz') return extractTarMembers(gunzipSync(archive), requested);
  if (format === 'zip') return extractZipMembers(archive, requested);
  throw new Error(`Unsupported ripgrep archive format: ${format}`);
}

function extractTarMembers(tar, requested) {
  const extracted = new Map();
  let offset = 0;

  while (offset + TAR_BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) break;

    const name = tarPath(header);
    const size = tarOctal(header.subarray(124, 136));
    const type = header[156];
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`Truncated tar member: ${name}`);
    if (size > MAX_EXTRACTED_MEMBER_BYTES) throw new Error(`Tar member is too large: ${name}`);

    if (requested.has(name)) {
      if (type !== 0 && type !== 0x30) throw new Error(`Ripgrep archive member is not a regular file: ${name}`);
      extracted.set(name, Buffer.from(tar.subarray(dataStart, dataEnd)));
    }

    offset = dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }

  assertEveryMemberExtracted(requested, extracted);
  return extracted;
}

function extractZipMembers(zip, requested) {
  const extracted = new Map();
  const endOffset = findZipEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  const centralDirectoryOffset = zip.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('Zip64 ripgrep archives are not supported.');
  }

  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid ripgrep zip central directory.');
    }
    const flags = zip.readUInt16LE(offset + 8);
    const compression = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > zip.length) throw new Error('Truncated ripgrep zip entry name.');
    const name = zip.subarray(nameStart, nameEnd).toString('utf8');

    if (requested.has(name)) {
      if (flags & 0x1) throw new Error(`Encrypted zip member is not supported: ${name}`);
      if (uncompressedSize > MAX_EXTRACTED_MEMBER_BYTES) throw new Error(`Zip member is too large: ${name}`);
      extracted.set(name, readZipMember(zip, {
        compressedSize,
        compression,
        localHeaderOffset,
        name,
        uncompressedSize,
      }));
    }

    offset = nameEnd + extraLength + commentLength;
  }

  assertEveryMemberExtracted(requested, extracted);
  return extracted;
}

function readZipMember(zip, entry) {
  const { compressedSize, compression, localHeaderOffset, name, uncompressedSize } = entry;
  if (localHeaderOffset + 30 > zip.length || zip.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid local zip header for: ${name}`);
  }
  const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
  const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > zip.length) throw new Error(`Truncated zip member: ${name}`);
  const compressed = zip.subarray(dataStart, dataEnd);
  const content = compression === 0
    ? Buffer.from(compressed)
    : compression === 8
      ? inflateRawSync(compressed)
      : null;
  if (!content) throw new Error(`Unsupported zip compression method ${compression} for: ${name}`);
  if (content.length !== uncompressedSize) throw new Error(`Zip member size mismatch for: ${name}`);
  return content;
}

function findZipEndOfCentralDirectory(zip) {
  const minimumOffset = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new Error('Ripgrep zip end-of-central-directory record was not found.');
}

function tarPath(header) {
  const name = nullTerminatedText(header.subarray(0, 100));
  const prefix = nullTerminatedText(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function tarOctal(bytes) {
  const value = nullTerminatedText(bytes).trim().replace(/^0+/, '');
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error(`Invalid tar size field: ${JSON.stringify(value)}`);
  return Number.parseInt(value, 8);
}

function nullTerminatedText(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
}

function assertEveryMemberExtracted(requested, extracted) {
  const missing = [...requested].filter((member) => !extracted.has(member));
  if (missing.length) throw new Error(`Ripgrep archive is missing required members: ${missing.join(', ')}`);
}
