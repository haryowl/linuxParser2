const config = require('../config');
const logger = require('../utils/logger');

const maxPacketSize = config.parser.maxPacketSize || 1024;

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

    if (state.unsentData.length > 0) {
        state.buffer = Buffer.concat([state.unsentData, incomingData]);
        state.unsentData = Buffer.alloc(0);
    } else if (state.buffer.length > 0) {
        state.buffer = Buffer.concat([state.buffer, incomingData]);
    } else {
        state.buffer = incomingData;
    }

    while (state.buffer.length >= 3) {
        const packetType = state.buffer.readUInt8(0);
        const rawLength = state.buffer.readUInt16LE(1);
        const actualLength = rawLength & 0x7fff;
        const totalLength = actualLength + 3;

        if (actualLength > maxPacketSize) {
            logger.error('Packet exceeds MAX_PACKET_SIZE, discarding frame without ACK', {
                packetType: `0x${packetType.toString(16).padStart(2, '0')}`,
                actualLength,
                maxPacketSize
            });
            if (state.buffer.length < totalLength + 2) {
                state.unsentData = Buffer.from(state.buffer);
                state.buffer = Buffer.alloc(0);
                break;
            }
            state.buffer = state.buffer.slice(totalLength + 2);
            continue;
        }

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

    return packets;
}

async function processPacket(packet, socket, clientAddress, parser, connectionRegistry) {
    const parsedData = await parser.parse(packet, clientAddress);
    const imei = parser.getIMEI(clientAddress);
    if (imei) {
        connectionRegistry.bindImeiToConnection(imei, clientAddress);
    }

    await parser.ensurePacketTelemetryPersisted(clientAddress);

    const ackHeader = parsedData?.ackHeader || (packet.readUInt8(0) === 0x07 ? 0x07 : 0x02);
    sendConfirmation(socket, packet, clientAddress, ackHeader);

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

                logger.info('Raw TCP data received', {
                    address: clientAddress,
                    length: data.length,
                    hex: data.toString('hex').toUpperCase()
                });

                const packets = extractPackets(state, data);

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
    processPacket
};
