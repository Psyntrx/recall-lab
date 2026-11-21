/**
 * Pure TypeScript ZIP archive builder (PKZip 2.0 Store format).
 * Zero external dependencies. Works in both browser and Node.js environments.
 */

export type ZipEntry = {
  name: string;
  data: Uint8Array | string;
  lastModified?: Date;
};

// Standard IEEE 802.3 CRC-32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { time: dosTime, date: dosDate };
}

/**
 * Creates a standard uncompressed (STORE) ZIP archive from an array of entries.
 */
export function createZipArchive(entries: ZipEntry[]): Uint8Array {
  const textEncoder = new TextEncoder();
  const normalizedEntries = entries.map((entry) => {
    const rawData =
      typeof entry.data === "string"
        ? textEncoder.encode(entry.data)
        : entry.data;

    // Clean normalized filename with forward slashes
    const cleanName = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBytes = textEncoder.encode(cleanName);
    const modDate = entry.lastModified || new Date();
    const { time, date } = dateToDosTime(modDate);
    const checksum = crc32(rawData);

    return {
      name: cleanName,
      nameBytes,
      data: rawData,
      dosTime: time,
      dosDate: date,
      crc: checksum,
      size: rawData.length,
    };
  });

  // Calculate total buffer size
  let localHeadersSize = 0;
  for (const entry of normalizedEntries) {
    // 30 bytes fixed local header + nameBytes.length + data.length
    localHeadersSize += 30 + entry.nameBytes.length + entry.data.length;
  }

  let centralDirSize = 0;
  for (const entry of normalizedEntries) {
    // 46 bytes fixed central directory header + nameBytes.length
    centralDirSize += 46 + entry.nameBytes.length;
  }

  // EOCD size: 22 bytes
  const eocdSize = 22;
  const totalZipSize = localHeadersSize + centralDirSize + eocdSize;
  const buffer = new Uint8Array(totalZipSize);
  const view = new DataView(buffer.buffer);

  let offset = 0;
  const localHeaderOffsets: number[] = [];

  // Write Local File Headers and Data
  for (const entry of normalizedEntries) {
    localHeaderOffsets.push(offset);

    // Signature: 0x04034b50 ("PK\x03\x04")
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true); // Version needed (2.0)
    view.setUint16(offset + 6, 0x0800, true); // Flags (UTF-8)
    view.setUint16(offset + 8, 0, true); // Compression (STORE = 0)
    view.setUint16(offset + 10, entry.dosTime, true);
    view.setUint16(offset + 12, entry.dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.size, true); // Compressed size
    view.setUint32(offset + 22, entry.size, true); // Uncompressed size
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true); // Extra field length

    offset += 30;
    buffer.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;

    buffer.set(entry.data, offset);
    offset += entry.data.length;
  }

  // Write Central Directory Headers
  const centralDirStartOffset = offset;
  for (let i = 0; i < normalizedEntries.length; i++) {
    const entry = normalizedEntries[i];
    const localOffset = localHeaderOffsets[i];

    // Signature: 0x02014b50 ("PK\x01\x02")
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true); // Version made by
    view.setUint16(offset + 6, 20, true); // Version needed
    view.setUint16(offset + 8, 0x0800, true); // Flags (UTF-8)
    view.setUint16(offset + 10, 0, true); // Compression (STORE)
    view.setUint16(offset + 12, entry.dosTime, true);
    view.setUint16(offset + 14, entry.dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.size, true); // Compressed size
    view.setUint32(offset + 24, entry.size, true); // Uncompressed size
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true); // Extra field length
    view.setUint16(offset + 32, 0, true); // Comment length
    view.setUint16(offset + 34, 0, true); // Disk start
    view.setUint16(offset + 36, 0, true); // Internal attributes
    view.setUint32(offset + 38, 0, true); // External attributes
    view.setUint32(offset + 42, localOffset, true); // Local header offset

    offset += 46;
    buffer.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  }

  // Write End of Central Directory Record (EOCD)
  // Signature: 0x06054b50 ("PK\x05\x06")
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true); // Disk number
  view.setUint16(offset + 6, 0, true); // Disk with central dir
  view.setUint16(offset + 8, normalizedEntries.length, true); // Entries on this disk
  view.setUint16(offset + 10, normalizedEntries.length, true); // Total entries
  view.setUint32(offset + 12, centralDirSize, true); // Central directory size
  view.setUint32(offset + 16, centralDirStartOffset, true); // Offset of central directory
  view.setUint16(offset + 20, 0, true); // Comment length

  return buffer;
}
