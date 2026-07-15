// backend/src/services/commandPacketBuilder.js

const iconv = require('iconv-lite');

function crc16Modbus(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc = crc >> 1;
            }
        }
    }
    return crc & 0xFFFF;
}

function buildCommandPacket({ imei, deviceNumber = 0, commandNumber, commandText }) {
    if (!imei || !/^\d{15}$/.test(imei)) {
        throw new Error('Invalid IMEI for command packet');
    }

    const effectiveCommandNumber = Number.isFinite(commandNumber)
        ? (commandNumber >>> 0)
        : Math.floor(Math.random() * 0x7FFFFFFF);

    const parts = [];
    const imeiBytes = Buffer.from(imei, 'ascii');
    parts.push(Buffer.from([0x03]));
    parts.push(imeiBytes);

    const deviceNumberBuf = Buffer.alloc(2);
    deviceNumberBuf.writeUInt16LE(deviceNumber, 0);
    parts.push(Buffer.from([0x04]));
    parts.push(deviceNumberBuf);

    const commandNumberBuf = Buffer.alloc(4);
    commandNumberBuf.writeUInt32LE(effectiveCommandNumber >>> 0, 0);
    parts.push(Buffer.from([0xE0]));
    parts.push(commandNumberBuf);

    if (commandText && typeof commandText === 'string') {
        const textBytes = iconv.encode(commandText, 'cp1251');
        const lengthByte = Buffer.from([Math.min(textBytes.length, 255)]);
        const payloadBytes = textBytes.slice(0, lengthByte[0]);
        parts.push(Buffer.from([0xE1]));
        parts.push(lengthByte);
        parts.push(payloadBytes);
    }

    const data = Buffer.concat(parts);
    const lengthBuf = Buffer.alloc(2);
    lengthBuf.writeUInt16LE(data.length, 0);
    const header = Buffer.from([0x01]);
    const packetWithoutCrc = Buffer.concat([header, lengthBuf, data]);
    const crc = crc16Modbus(packetWithoutCrc);
    const crcBuf = Buffer.alloc(2);
    crcBuf.writeUInt16LE(crc, 0);
    const packet = Buffer.concat([packetWithoutCrc, crcBuf]);

    return {
        packet,
        packetHex: packet.toString('hex').toUpperCase(),
        commandNumber: effectiveCommandNumber,
        dataLength: data.length
    };
}

module.exports = {
    buildCommandPacket
};
