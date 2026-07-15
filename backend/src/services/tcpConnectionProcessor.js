const config = require('../config');
const logger = require('../utils/logger');

// Wire LENGTH field is 15 bits (max 32767). Spec recommends ~1000; many devices exceed that.
const maxPacketSize = Math.min(
    Math.max(1, config.parser.maxPacketSize || 32767),
    32767
);

const HTTP_PROBE_PATTERN = /^(GET |POST |PUT |HEAD |OPTIONS |DELETE |PATCH |CONNECT |HTTP\/)/;
const FRAME_HEADERS = new Set([0x01, 0x07, 0x08]);

/**
 * Internet scanners often hit the GPS TCP port with HTTP/TLS/SSH — not Galileosky devices.
 */
function isProbeTraffic(buffer) {
    if (!buffer || buffer.length < 4) {
        return false;
    }

    const preview = buffer.slice(0, Math.min(buffer.length, 24)).toString('ascii');
    if (HTTP_PROBE_PATTERN.test(preview)) {
        return true;
    }
    if (preview.startsWith('SSH-')) {
        return true;
    }
    // TLS Client Hello
    if (buffer[0] === 0x16 && buffer[1] === 0x03) {
        return true;
    }
    return false;
}

function previewAscii(buffer, maxLen = 48) {
    return buffer.slice(0, maxLen).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
}

/**
 * Find next plausible Galileosky frame start after a bad header.
 * Avoids waiting forever for an illegal claimed length (device/server ACK deadlock).
 */
function findNextFrameStart(buffer, from = 1) {
    for (let i = from; i < buffer.length; i++) {
        if (!FRAME_HEADERS.has(buffer[i])) {
            continue;
        }
        if (i + 3 > buffer.length) {
            return i;
        }
        const len = buffer.readUInt16LE(i + 1) & 0x7fff;
        if (len <= maxPacketSize) {
            return i;
        }
    }
    return -1;
}

function buildConfirmation(packet, ackHeader = 0x02) {
    const packetChecksum = packet.readUInt16LE(packet.length - 2);
    return Buffer.from([ackHeader, packetChecksum & 0xff, (packetChecksum >> 8) & 0xff]);
}

function sendConfirmation(socket, packet, clientAddress, ackHeader = 0x02) {
    const confirmation = buildConfirmation(packet, ackHeader);
    socket.write(confirmation);
    logger.info('Confirmation sent', {
        address: clientAddress,
        ackHeader: `0x${ackHeader.toString(16).padStart(2, '0')}`,
        hex: confirmation.toString('hex').toUpperCase(),
        checksum: `0x${confirmation.slice(1).toString('hex').toUpperCase()}`,
        packetLength: packet.length - 5,
        timestamp: new Date().toISOString()
    });
}

function extractPackets(state, incomingData) {
    const packets = [];
    let rejectConnection = false;

    if (state.unsentData.length > 0) {
        state.buffer = Buffer.concat([state.unsentData, incomingData]);
        state.unsentData = Buffer.alloc(0);
    } else if (state.buffer.length > 0) {
        state.buffer = Buffer.concat([state.buffer, incomingData]);
    } else {
        state.buffer = incomingData;
    }

    if (isProbeTraffic(state.buffer)) {
        logger.warn('Rejected non-Galileosky probe on GPS TCP port', {
            preview: previewAscii(state.buffer),
            bufferLength: state.buffer.length
        });
        state.buffer = Buffer.alloc(0);
        state.unsentData = Buffer.alloc(0);
        return { packets, rejectConnection: true };
    }

    while (state.buffer.length >= 3) {
        const packetType = state.buffer.readUInt8(0);
        const rawLength = state.buffer.readUInt16LE(1);
        const actualLength = rawLength & 0x7fff;
        const totalLength = actualLength + 3;

        if (actualLength > maxPacketSize) {
            if (isProbeTraffic(state.buffer)) {
                logger.warn('Rejected non-Galileosky probe on GPS TCP port', {
                    packetType: `0x${packetType.toString(16).padStart(2, '0')}`,
                    preview: previewAscii(state.buffer),
                    bufferLength: state.buffer.length
                });
                state.buffer = Buffer.alloc(0);
                state.unsentData = Buffer.alloc(0);
                return { packets, rejectConnection: true };
            }

            // Do NOT wait for the claimed length and do NOT ACK — waiting caused ACK deadlock.
            // Resync to the next plausible frame header so the TCP stream can continue.
            logger.error('Packet exceeds MAX_PACKET_SIZE, discarding header and resyncing (no ACK)', {
                packetType: `0x${packetType.toString(16).padStart(2, '0')}`,
                actualLength,
                maxPacketSize,
                bufferLength: state.buffer.length
            });
            const next = findNextFrameStart(state.buffer, 1);
            if (next < 0) {
                state.unsentData = Buffer.alloc(0);
                state.buffer = Buffer.alloc(0);
                break;
            }
            state.buffer = state.buffer.slice(next);
            continue;
        }

        // Incomplete frame: keep assembling TCP partials until HEAD+LEN+DATA+CRC arrive, then ACK.
        if (state.buffer.length < totalLength + 2) {
            state.unsentData = Buffer.from(state.buffer);
            state.buffer = Buffer.alloc(0);
            break;
        }

        const packet = state.buffer.slice(0, totalLength + 2);
        state.buffer = state.buffer.slice(totalLength + 2);

        const isIgnorablePacket = packetType === 0x15;
        const isExtensionPacket = packetType !== 0x01 && packetType !== 0x08 && packetType !== 0x07 && !isIgnorablePacket;

        logger.debug('Packet framed', {
            type: `0x${packetType.toString(16).padStart(2, '0')}`,
            packetType: isIgnorablePacket ? 'Ignored' : (isExtensionPacket ? 'Extension' : 'Main Packet'),
            length: actualLength,
            remainingBuffer: state.buffer.length
        });

        packets.push(packet);
    }

    if (state.buffer.length > 0 && state.buffer.length < 3) {
        state.unsentData = Buffer.concat([state.unsentData, state.buffer]);
        state.buffer = Buffer.alloc(0);
    }

    return { packets, rejectConnection };
}

async function processPacket(packet, socket, clientAddress, parser, connectionRegistry) {
    const ingestAuditService = require('./ingestAuditService');
    let imei = parser.getIMEI(clientAddress);
    let parsedData;
    let ackHeader;

    try {
        parsedData = await parser.parse(packet, clientAddress);
        imei = parser.getIMEI(clientAddress);
        ingestAuditService.trackPacketParsed(imei, parsedData?.records?.length || 0);

        if (imei) {
            connectionRegistry.bindImeiToConnection(imei, clientAddress);
            const commandQueue = require('./commandQueue');
            commandQueue.processQueueForImei(imei).catch((error) => {
                logger.warn('Failed to process queued commands after device connect', {
                    imei,
                    error: error.message
                });
            });
        }

        await parser.ensurePacketTelemetryPersisted(clientAddress);

        ackHeader = parsedData?.ackHeader || (packet.readUInt8(0) === 0x07 ? 0x07 : 0x02);
        sendConfirmation(socket, packet, clientAddress, ackHeader);
        ingestAuditService.trackAck(imei);
    } catch (error) {
        ingestAuditService.trackParseError(imei);
        throw error;
    }

    logger.info('Packet parsed successfully', {
        address: clientAddress,
        recordsCount: parsedData?.records?.length || 0,
        commandReplies: parsedData?.commandReplies || 0,
        queuedTelemetry: parsedData?.queuedTelemetry || 0,
        flushedPendingTelemetry: parsedData?.flushedPendingTelemetry || 0,
        packetType: parsedData?.type || parsedData?.packetType || null,
        ackHeader: `0x${ackHeader.toString(16).padStart(2, '0')}`,
        timestamp: new Date().toISOString()
    });

    return parsedData;
}

function createConnectionState() {
    return {
        buffer: Buffer.alloc(0),
        unsentData: Buffer.alloc(0),
        processingChain: Promise.resolve()
    };
}

function attachTcpDataHandler(socket, {
    parser,
    connectionRegistry,
    clientAddress,
    getBufferStats,
    isOverloaded
}) {
    const state = createConnectionState();

    socket.on('data', (data) => {
        state.processingChain = state.processingChain
            .then(async () => {
                if (isOverloaded) {
                    logger.warn('System overloaded, processing TCP data sequentially', {
                        address: clientAddress,
                        bufferStats: getBufferStats()
                    });
                }

                if (isProbeTraffic(data)) {
                    logger.warn('Rejected non-Galileosky probe on GPS TCP port', {
                        address: clientAddress,
                        preview: previewAscii(data),
                        length: data.length
                    });
                    socket.destroy();
                    return;
                }

                logger.info('Raw TCP data received', {
                    address: clientAddress,
                    length: data.length,
                    hex: data.toString('hex').toUpperCase()
                });

                const { packets, rejectConnection } = extractPackets(state, data);
                if (rejectConnection) {
                    socket.destroy();
                    return;
                }

                for (const packet of packets) {
                    try {
                        await processPacket(packet, socket, clientAddress, parser, connectionRegistry);
                    } catch (error) {
                        logger.error('Error processing packet (no ACK sent)', {
                            address: clientAddress,
                            error: error.message,
                            packetHex: packet.toString('hex').toUpperCase(),
                            imei: parser.getIMEI(clientAddress) || null,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            })
            .catch((error) => {
                logger.error('TCP processing chain error', {
                    address: clientAddress,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            });
    });

    return state;
}

module.exports = {
    attachTcpDataHandler,
    buildConfirmation,
    extractPackets,
    processPacket,
    isProbeTraffic
};
