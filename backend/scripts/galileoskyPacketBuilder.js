'use strict';

/**
 * Build Galileosky main packets (HEAD 0x01) for device simulation / stress tests.
 */

function crc16Modbus(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xFFFF;
}

function wrapMainPacket(data) {
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16LE(data.length, 0);
  const withoutCrc = Buffer.concat([Buffer.from([0x01]), lengthBuf, data]);
  const crcBuf = Buffer.alloc(2);
  crcBuf.writeUInt16LE(crc16Modbus(withoutCrc), 0);
  return Buffer.concat([withoutCrc, crcBuf]);
}

function buildImeiTag(imei) {
  if (!/^\d{15}$/.test(imei)) {
    throw new Error(`IMEI must be 15 digits: ${imei}`);
  }
  return Buffer.concat([Buffer.from([0x03]), Buffer.from(imei, 'ascii')]);
}

/**
 * Build 0xFE extended-tags block.
 * Protocol: FE + uint16LE(length) + repeating [uint16LE(tagId) + value bytes]
 */
function buildExtendedTagsBlock(entries = []) {
  const parts = [];
  for (const entry of entries) {
    const tagId = Number(entry.tagId);
    const value = Buffer.isBuffer(entry.value)
      ? entry.value
      : (() => {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(Number(entry.value) >>> 0, 0);
          return buf;
        })();
    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16LE(tagId & 0xffff, 0);
    parts.push(idBuf, value);
  }

  const payload = Buffer.concat(parts);
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16LE(payload.length, 0);
  return Buffer.concat([Buffer.from([0xfe]), lengthBuf, payload]);
}

function buildDefaultExtendedTags({ recordNumber, deviceIndex }) {
  // Known tags from tagDefinitions: 0x0001 / 0x0002 (uint32_modbus, 4 bytes)
  const modbus0 = 10000 + ((deviceIndex * 100 + recordNumber) % 50000);
  const modbus1 = 20000 + ((deviceIndex * 17 + recordNumber * 3) % 50000);
  return buildExtendedTagsBlock([
    { tagId: 0x0001, value: modbus0 },
    { tagId: 0x0002, value: modbus1 }
  ]);
}

function pushTag(parts, tagByte, valueBuf) {
  parts.push(Buffer.from([tagByte]));
  parts.push(valueBuf);
}

function u8(value) {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(value & 0xff, 0);
  return buf;
}

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value & 0xffff, 0);
  return buf;
}

function i8(value) {
  const buf = Buffer.alloc(1);
  buf.writeInt8(value, 0);
  return buf;
}

function i16(value) {
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(value, 0);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

function buildTelemetryRecord({
  recordNumber,
  timestampSec,
  latitude = -6.2,
  longitude = 106.8,
  speedKmh = 45,
  directionDeg = 180,
  satellites = 8,
  includeExtendedTags = false,
  deviceIndex = 0
}) {
  const parts = [];
  const correctness = 0; // high nibble of first 0x30 byte

  // 0x10 Archive record number
  pushTag(parts, 0x10, u16(recordNumber));

  // 0x20 Date/time (Unix seconds)
  pushTag(parts, 0x20, u32(timestampSec));

  // 0x21 Milliseconds
  pushTag(parts, 0x21, u16((recordNumber * 37) % 1000));

  // 0x30 Coordinates: 1 byte (sat|correctness) + lat int32 + lon int32
  // Parser expects satellites/correctness first, then lat/lon scaled by 1e6
  const coordBuf = Buffer.alloc(9);
  coordBuf.writeUInt8(((correctness & 0x0f) << 4) | (satellites & 0x0f), 0);
  coordBuf.writeInt32LE(Math.round(latitude * 1000000), 1);
  coordBuf.writeInt32LE(Math.round(longitude * 1000000), 5);
  pushTag(parts, 0x30, coordBuf);

  // 0x33 Speed (0.1 km/h) + direction (0.1 deg)
  const motionBuf = Buffer.alloc(4);
  motionBuf.writeUInt16LE(Math.round(speedKmh * 10), 0);
  motionBuf.writeUInt16LE(Math.round(directionDeg * 10), 2);
  pushTag(parts, 0x33, motionBuf);

  // 0x34 Height (m)
  pushTag(parts, 0x34, i16(10 + (recordNumber % 40)));

  // 0x35 HDOP
  pushTag(parts, 0x35, u8(1 + (recordNumber % 8)));

  // 0x40 Status
  pushTag(parts, 0x40, u16(0x0001));

  // 0x41 Supply voltage (mV)
  pushTag(parts, 0x41, u16(12000 + (deviceIndex % 500)));

  // 0x42 Battery voltage (mV)
  pushTag(parts, 0x42, u16(3800 + (recordNumber % 200)));

  // 0x43 Inside temperature (°C)
  pushTag(parts, 0x43, i8(25 + (deviceIndex % 10) - 3));

  // 0x44 Acceleration
  pushTag(parts, 0x44, u32(1000 + (recordNumber % 500)));

  // 0x45 Outputs status
  pushTag(parts, 0x45, u16(0x0000));

  // 0x46 Inputs status
  pushTag(parts, 0x46, u16(recordNumber % 2 === 0 ? 0x0001 : 0x0000));

  // 0x48 Expanded status
  pushTag(parts, 0x48, u16(0x0000));

  // 0x49 Transmission channel
  pushTag(parts, 0x49, u8(1));

  // 0x50–0x53 Input voltages (mV)
  pushTag(parts, 0x50, u16(1000 + (recordNumber % 100)));
  pushTag(parts, 0x51, u16(1100 + (recordNumber % 100)));
  pushTag(parts, 0x52, u16(1200 + (recordNumber % 100)));
  pushTag(parts, 0x53, u16(1300 + (recordNumber % 100)));

  // 0x62 GSM signal (0–31)
  pushTag(parts, 0x62, u8(15 + (deviceIndex % 10)));

  // 0xE2–0xE9 User data 0–7 (uint32)
  pushTag(parts, 0xe2, u32(1000 + recordNumber));
  pushTag(parts, 0xe3, u32(2000 + deviceIndex));
  pushTag(parts, 0xe4, u32(3000 + (recordNumber % 100)));
  pushTag(parts, 0xe5, u32(4000 + ((recordNumber * 3) % 100)));
  pushTag(parts, 0xe6, u32(5000 + deviceIndex * 10));
  pushTag(parts, 0xe7, u32(6000 + (recordNumber % 50)));
  pushTag(parts, 0xe8, u32(7000 + ((deviceIndex + recordNumber) % 200)));
  pushTag(parts, 0xe9, u32(8000 + (recordNumber % 25)));

  // 0xFE Extended tags (optional)
  if (includeExtendedTags) {
    parts.push(buildDefaultExtendedTags({ recordNumber, deviceIndex }));
  }

  return Buffer.concat(parts);
}

function buildImeiRegistrationPacket(imei) {
  return wrapMainPacket(buildImeiTag(imei));
}

function buildMultiRecordPacket({
  maxDataBytes = 1024,
  startRecordNumber = 1,
  baseTimestampSec = Math.floor(Date.now() / 1000),
  deviceIndex = 0,
  includeImei = false,
  imei = null,
  includeExtendedTags = false
}) {
  const chunks = [];

  if (includeImei) {
    chunks.push(buildImeiTag(imei));
  }

  let recordNumber = startRecordNumber;
  let timestampSec = baseTimestampSec;
  const latitude = -6.2 + (deviceIndex * 0.001);
  const longitude = 106.8 + (deviceIndex * 0.001);

  while (true) {
    const record = buildTelemetryRecord({
      recordNumber,
      timestampSec,
      latitude: latitude + (recordNumber * 0.00001),
      longitude: longitude + (recordNumber * 0.00001),
      speedKmh: 30 + (recordNumber % 50),
      directionDeg: (recordNumber * 7) % 360,
      includeExtendedTags,
      deviceIndex
    });

    const nextSize = Buffer.concat(chunks).length + record.length;
    if (nextSize > maxDataBytes) {
      break;
    }

    chunks.push(record);
    recordNumber += 1;
    timestampSec += 1;
  }

  if (chunks.length === 0) {
    throw new Error('Could not fit any telemetry record into packet data budget');
  }

  const data = Buffer.concat(chunks);
  const packet = wrapMainPacket(data);

  return {
    packet,
    recordCount: includeImei ? chunks.length - 1 : chunks.length,
    dataBytes: data.length,
    endRecordNumber: recordNumber - 1,
    includeExtendedTags: !!includeExtendedTags
  };
}

module.exports = {
  crc16Modbus,
  wrapMainPacket,
  buildImeiRegistrationPacket,
  buildMultiRecordPacket,
  buildTelemetryRecord,
  buildExtendedTagsBlock,
  buildDefaultExtendedTags
};
