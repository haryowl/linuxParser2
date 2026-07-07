// backend/src/services/parser.js

const EventEmitter = require('events');
const tagDefinitions = require('./tagDefinitions');
const iconv = require('iconv-lite');
const logger = require('../utils/logger');
const config = require('../config');
const PacketTypeHandler = require('./packetTypeHandler');
const TagParser = require('./tagParser');
const { isNewRecordStart } = require('./galileoskyRecordStream');
const { GalileoskyBitBuffer, popcount } = require('./galileoskyBitBuffer');
const { decryptPacketBody } = require('./galileoskyXtea');
const { extractClientIp } = require('../utils/clientAddress');
const { Record, Device } = require('../models');

class GalileoskyParser extends EventEmitter {
    constructor() {
        super();
        this.imeiByConnection = new Map(); // Store IMEI per connection address (for tracking)
        this.connectionByIMEI = new Map(); // Store connection address per IMEI (for reverse lookup)
        this.maxPacketSize = config.parser.maxPacketSize;
        this.validateChecksum = config.parser.validateChecksum;
        this.xteaKey = config.parser.xteaKey;
        this.ackAfterSave = config.parser.ackAfterSave;
        this.maxPendingTelemetryPerConnection = parseInt(process.env.MAX_PENDING_TELEMETRY, 10) || 200;
        this.pendingTelemetryByConnection = new Map();
        this.pendingTelemetryByClientIp = new Map();
        
        // Batch processing configuration
        this.batchSize = 50; // Records per batch
        this.batchTimeout = 2000; // 2 seconds timeout
        this.recordBuffer = []; // Buffer for batch inserts
        this.deviceQueues = new Map(); // Per-device processing queues
        this.batchChain = Promise.resolve(); // Serialize batch writes (prevents flushBuffer spin)
        this.maxConcurrentDevices = 5; // Max devices processing simultaneously
        this.processingDevices = new Set(); // Track devices currently processing
        
        // Initialize caches
        this.tagDefinitionsCache = new Map();
        this.binaryCache = new Map();
        
        this.initializeCaches();
        this.initializeParsers();
        this.startBatchProcessor();
    }


    // Batch processing methods
    startBatchProcessor() {
        // Process batches every 2 seconds
        setInterval(() => {
            if (this.recordBuffer.length > 0) {
                this.scheduleBatch().catch((error) => {
                    logger.error('Scheduled batch processing failed:', error);
                });
            }
        }, this.batchTimeout);
        
        logger.info('Batch processor started with batch size:', this.batchSize);
    }

    scheduleBatch() {
        this.batchChain = this.batchChain
            .then(() => this.runNextBatch())
            .catch((error) => {
                logger.error('Batch chain error:', error);
            });
        return this.batchChain;
    }

    async runNextBatch() {
        if (this.recordBuffer.length === 0) {
            return;
        }

        const batch = this.recordBuffer.splice(0, this.batchSize);
        try {
            if (batch.length > 0) {
                await this.batchSaveToDatabase(batch);
                logger.debug(`Batch processed: ${batch.length} records`);
            }
        } catch (error) {
            this.recordBuffer.unshift(...batch);
            logger.error('Error processing batch:', error);
            throw error;
        }
    }

    async processBatch() {
        return this.scheduleBatch();
    }

    async batchSaveToDatabase(records) {
        const recordsByImei = new Map();
        for (const record of records) {
            const imei = record.deviceImei;
            if (!recordsByImei.has(imei)) {
                recordsByImei.set(imei, []);
            }
            recordsByImei.get(imei).push(record);
        }

        let totalSaved = 0;
        const failures = [];

        for (const [imei, deviceRecords] of recordsByImei.entries()) {
            const outcome = await this.saveDeviceRecords(imei, deviceRecords);
            totalSaved += outcome.saved;
            if (outcome.failed > 0) {
                failures.push({ imei, failed: outcome.failed, total: deviceRecords.length });
            }
        }

        if (failures.length > 0) {
            const summary = failures.map((f) => `${f.imei}:${f.failed}/${f.total}`).join(', ');
            throw new Error(`Database save incomplete (${summary})`);
        }

        if (totalSaved > 0) {
            try {
                const cache = require('../utils/cache');
                cache.delete('dashboard_stats');
                cache.delete('total_records_count');
                cache.delete('recent_records_count');
            } catch (cacheError) {
                logger.warn('Failed to invalidate cache:', cacheError);
            }
        }

        logger.info(`Batch save completed: ${totalSaved} records saved`);
    }

    async saveDeviceRecords(imei, deviceRecords) {
        await this.ensureDeviceExists(imei);

        try {
            await Record.bulkCreate(deviceRecords, {
                ignoreDuplicates: true,
                validate: false
            });
            logger.debug(`Bulk saved ${deviceRecords.length} records for device ${imei}`);
            return { saved: deviceRecords.length, failed: 0 };
        } catch (error) {
            logger.error(`Error bulk saving records for device ${imei}:`, error);

            let saved = 0;
            let failed = 0;
            for (const record of deviceRecords) {
                try {
                    await Record.create(record);
                    saved += 1;
                } catch (individualError) {
                    failed += 1;
                    logger.error(`Failed to save individual record for ${imei}:`, individualError);
                }
            }

            return { saved, failed };
        }
    }

    addRecordToBuffer(recordData) {
        this.recordBuffer.push(recordData);
        
        // Auto-flush if buffer is getting too large
        if (this.recordBuffer.length >= this.batchSize * 2) {
            setImmediate(() => {
                this.scheduleBatch().catch((error) => {
                    logger.error('Auto batch flush failed:', error);
                });
            });
        }
    }

    async flushBuffer() {
        while (this.recordBuffer.length > 0) {
            await this.scheduleBatch();
        }
        await this.batchChain;
    }

    getPendingTelemetryCount(connectionAddress) {
        return this.pendingTelemetryByConnection.get(connectionAddress)?.length || 0;
    }

    resolveImeiForRecord(record, connectionAddress) {
        const tagImei = record?.tags?.['0x03']?.value;
        if (typeof tagImei === 'string' && /^\d{15}$/.test(tagImei)) {
            this.setIMEI(connectionAddress, tagImei);
            return tagImei;
        }
        return this.getIMEI(connectionAddress);
    }

    queuePendingTelemetry(connectionAddress, record) {
        if (!connectionAddress) {
            throw new Error('Cannot queue telemetry without connection address');
        }

        const queue = this.pendingTelemetryByConnection.get(connectionAddress) || [];
        if (queue.length >= this.maxPendingTelemetryPerConnection) {
            throw new Error(
                `Pending telemetry queue full for ${connectionAddress} (max ${this.maxPendingTelemetryPerConnection})`
            );
        }

        queue.push(record);
        this.pendingTelemetryByConnection.set(connectionAddress, queue);

        logger.info('Telemetry queued pending IMEI', {
            connectionAddress,
            queuedCount: queue.length,
            recordTags: Object.keys(record.tags),
            timestamp: new Date().toISOString()
        });
    }

    async flushPendingTelemetry(connectionAddress, imei, result = null) {
        const queue = this.pendingTelemetryByConnection.get(connectionAddress);
        if (!queue || queue.length === 0) {
            return 0;
        }

        const pending = queue.splice(0, queue.length);
        if (queue.length === 0) {
            this.pendingTelemetryByConnection.delete(connectionAddress);
        }

        let flushed = 0;
        for (const record of pending) {
            await this.saveRecordToDatabase(record, imei);
            flushed += 1;
            if (result) {
                result.records.push(record);
                result.flushedPendingTelemetry = (result.flushedPendingTelemetry || 0) + 1;
            }
            this.emit('recordStored', {
                imei,
                timestamp: new Date(),
                tags: record.tags,
                recordNumber: record.tags['0x10']?.value,
                fromPendingQueue: true
            });
        }

        logger.info('Flushed pending telemetry after IMEI became available', {
            connectionAddress,
            imei,
            flushed,
            timestamp: new Date().toISOString()
        });

        return flushed;
    }

    async flushPendingTelemetryIfImeiKnown(connectionAddress, result = null) {
        const imei = this.getIMEI(connectionAddress);
        if (!imei) {
            return 0;
        }
        return this.flushPendingTelemetry(connectionAddress, imei, result);
    }

    /**
     * Ensure all telemetry from this packet is queued/saved before ACK.
     */
    async ensurePacketTelemetryPersisted(connectionAddress) {
        const pending = this.getPendingTelemetryCount(connectionAddress);
        if (pending > 0) {
            throw new Error(
                `Cannot ACK: ${pending} telemetry record(s) still waiting for IMEI on ${connectionAddress}`
            );
        }

        if (this.ackAfterSave !== false) {
            await this.flushBuffer();
        }
    }

    movePendingToClientIp(connectionAddress) {
        const pending = this.pendingTelemetryByConnection.get(connectionAddress);
        if (!pending?.length) {
            return 0;
        }

        const clientIp = extractClientIp(connectionAddress);
        const ipQueue = this.pendingTelemetryByClientIp.get(clientIp) || [];
        ipQueue.push(...pending.splice(0));
        const maxIpQueue = this.maxPendingTelemetryPerConnection * 2;
        if (ipQueue.length > maxIpQueue) {
            ipQueue.splice(0, ipQueue.length - maxIpQueue);
            logger.warn('Trimmed IP pending telemetry queue to max size', {
                clientIp,
                maxIpQueue
            });
        }

        this.pendingTelemetryByClientIp.set(clientIp, ipQueue);
        this.pendingTelemetryByConnection.delete(connectionAddress);

        logger.warn('Moved pending telemetry to client IP hold queue on disconnect', {
            connectionAddress,
            clientIp,
            moved: ipQueue.length,
            timestamp: new Date().toISOString()
        });

        return ipQueue.length;
    }

    adoptIpPendingForConnection(connectionAddress) {
        const clientIp = extractClientIp(connectionAddress);
        const ipQueue = this.pendingTelemetryByClientIp.get(clientIp);
        if (!ipQueue?.length) {
            return 0;
        }

        const connQueue = this.pendingTelemetryByConnection.get(connectionAddress) || [];
        connQueue.push(...ipQueue.splice(0));
        this.pendingTelemetryByClientIp.delete(clientIp);
        this.pendingTelemetryByConnection.set(connectionAddress, connQueue);

        logger.info('Adopted IP-held pending telemetry for new connection', {
            connectionAddress,
            clientIp,
            adopted: connQueue.length,
            timestamp: new Date().toISOString()
        });

        return connQueue.length;
    }

    resetConnectionSession(connectionAddress) {
        this.clearIMEI(connectionAddress);
        this.pendingTelemetryByConnection.delete(connectionAddress);
        return this.adoptIpPendingForConnection(connectionAddress);
    }

    teardownConnection(connectionAddress) {
        this.movePendingToClientIp(connectionAddress);
        this.clearIMEI(connectionAddress);
    }

    clearConnectionState(connectionAddress) {
        this.teardownConnection(connectionAddress);
    }

    getCommandReply(record, connectionAddress) {
        if (!record?.tags) {
            return null;
        }
        const commandNumber = record.tags['0xe0']?.value;
        const replyText = record.tags['0xe1']?.value || null;
        const replyDataHex = record.tags['0xeb']?.value || null;
        const imeiFromTag = record.tags['0x03']?.value;
        const imei = imeiFromTag || this.getIMEI(connectionAddress);
        if (!imei) {
            return null;
        }
        return {
            imei,
            commandNumber: typeof commandNumber === 'number' ? commandNumber : null,
            replyText,
            replyDataHex
        };
    }
    // Method to get IMEI for a specific connection
    getIMEI(connectionAddress) {
        return this.imeiByConnection.get(connectionAddress) || null;
    }

    // Method to set IMEI for a specific connection
    setIMEI(connectionAddress, imei) {
        if (imei && typeof imei === 'string' && /^\d{15}$/.test(imei)) {
            // Check if this IMEI is already connected from a different address
            const existingConnection = this.connectionByIMEI.get(imei);
            if (existingConnection && existingConnection !== connectionAddress) {
                logger.info(`Device reconnection detected: IMEI ${imei} moved from ${existingConnection} to ${connectionAddress}`);
                // Clean up old connection mapping
                this.imeiByConnection.delete(existingConnection);
            }
            
            // Set new mappings
            this.imeiByConnection.set(connectionAddress, imei);
            this.connectionByIMEI.set(imei, connectionAddress);
            
            if (existingConnection && existingConnection !== connectionAddress) {
                logger.info(`IMEI ${imei} successfully reconnected from ${connectionAddress} (was ${existingConnection})`);
            } else {
                logger.info(`IMEI set for connection ${connectionAddress}: ${imei}`);
            }
        } else {
            logger.warn(`Invalid IMEI for connection ${connectionAddress}: ${imei}`);
        }
    }

    // Method to handle device reconnection with IP change
    handleDeviceReconnection(newConnectionAddress, imei) {
        if (!imei || typeof imei !== 'string' || !/^\d{15}$/.test(imei)) {
            logger.warn(`Invalid IMEI for reconnection handling: ${imei}`);
            return false;
        }

        const existingConnection = this.connectionByIMEI.get(imei);
        if (existingConnection && existingConnection !== newConnectionAddress) {
            logger.info(`Handling device reconnection: IMEI ${imei} from ${existingConnection} to ${newConnectionAddress}`);
            
            // Clean up old connection
            this.imeiByConnection.delete(existingConnection);
            
            // Set new connection
            this.imeiByConnection.set(newConnectionAddress, imei);
            this.connectionByIMEI.set(imei, newConnectionAddress);
            
            return true;
        }
        
        return false;
    }

    // Method to clear IMEI for a specific connection
    clearIMEI(connectionAddress) {
        if (!connectionAddress) {
            logger.warn('clearIMEI called without connection address — ignored');
            return;
        }

        const imei = this.imeiByConnection.get(connectionAddress);
        if (imei) {
            this.imeiByConnection.delete(connectionAddress);
            if (this.connectionByIMEI.get(imei) === connectionAddress) {
                this.connectionByIMEI.delete(imei);
            }
            logger.info(`IMEI cleared for connection: ${connectionAddress} (IMEI: ${imei})`);
        } else {
            logger.debug(`No IMEI found for connection: ${connectionAddress}`);
        }
    }

    // Method to get connection address for an IMEI
    getConnectionByIMEI(imei) {
        return this.connectionByIMEI.get(imei) || null;
    }

    // Method to check if IMEI is already connected from a different address
    isIMEIConnectedFromDifferentAddress(imei, currentConnectionAddress) {
        const existingConnection = this.connectionByIMEI.get(imei);
        return existingConnection && existingConnection !== currentConnectionAddress;
    }

    // Method to get connection statistics
    getConnectionStats() {
        return {
            totalConnections: this.imeiByConnection.size,
            totalDevices: this.connectionByIMEI.size,
            connections: Array.from(this.imeiByConnection.entries()).map(([connection, imei]) => ({
                connection,
                imei
            })),
            devices: Array.from(this.connectionByIMEI.entries()).map(([imei, connection]) => ({
                imei,
                connection
            }))
        };
    }

    // Method to check if a connection has a valid IMEI
    hasValidIMEI(connectionAddress) {
        const imei = this.imeiByConnection.get(connectionAddress);
        return imei && typeof imei === 'string' && /^\d{15}$/.test(imei);
    }

    initializeCaches() {
        // Cache tag definitions (normalize to lowercase keys)
        for (const [tag, definition] of Object.entries(tagDefinitions)) {
            this.tagDefinitionsCache.set(String(tag).toLowerCase(), definition);
        }
        
        // Pre-calculate binary strings for 0-65535
        for (let i = 0; i <= 65535; i++) {
            this.binaryCache.set(i, i.toString(2).padStart(16, '0'));
        }
    }

    initializeParsers() {
        // Map packet types according to Galileosky protocol
        this.packetTypes = {
            0x01: this.parseMainPacket,    // Head Packet or Main Packet
            0x08: this.parseCompressedPacket.bind(this),
            0x15: this.parseIgnorablePacket // Ignorable packet (just needs confirmation)
        };
    }

    /**
     * Main parse entry point
     */
    async parse(buffer, connectionAddress = null) {
        try {
            if (!Buffer.isBuffer(buffer)) {
                throw new Error('Input must be a buffer');
            }

            let workBuffer = buffer;
            if (this.xteaKey) {
                workBuffer = decryptPacketBody(buffer, this.xteaKey);
            }

            // Log raw packet (hex in metadata — winston ignores extra string args)
            logger.info('Raw packet received', {
                connectionAddress,
                length: workBuffer.length,
                encrypted: workBuffer !== buffer,
                hex: workBuffer.toString('hex').toUpperCase()
            });

            if (workBuffer.length < 3) { // Minimum packet size (header + length)
                throw new Error('Packet too short');
            }

            const header = workBuffer.readUInt8(0);
            
            // Validate packet structure and checksum
            const { hasUnsentData, actualLength, rawLength } = this.validatePacket(workBuffer);
            
            // Use PacketTypeHandler to determine packet type
            if (PacketTypeHandler.isMainPacket(header)) {
                // This is a Head Packet or Main Packet
                const result = await this.parseMainPacket(workBuffer, 0, actualLength, connectionAddress);
                result.hasUnsentData = hasUnsentData;
                result.actualLength = actualLength;
                result.rawLength = rawLength;
                return result;
            } else if (PacketTypeHandler.isCompressedPacket(header)) {
                const result = await this.parseCompressedPacket(workBuffer, connectionAddress);
                result.hasUnsentData = hasUnsentData;
                result.actualLength = actualLength;
                result.rawLength = rawLength;
                return result;
            } else if (PacketTypeHandler.isPhotoPacket(header)) {
                const result = await this.parsePhotoPacket(workBuffer, connectionAddress);
                result.hasUnsentData = hasUnsentData;
                result.actualLength = actualLength;
                result.rawLength = rawLength;
                return result;
            } else if (PacketTypeHandler.isIgnorablePacket(header)) {
                // This is an ignorable packet, just needs confirmation
                return await this.parseIgnorablePacket(workBuffer);
            } else if (PacketTypeHandler.isExtensionPacket(header)) {
                // Extension packets carry the same tag stream as main packets (different HEAD byte)
                const result = await this.parseMainPacket(workBuffer, 0, actualLength, connectionAddress);
                result.packetType = 'extension';
                result.extensionHeader = header;
                result.hasUnsentData = hasUnsentData;
                result.actualLength = actualLength;
                result.rawLength = rawLength;
                return result;
            } else {
                logger.warn('Unknown packet header, attempting tag-stream parse', {
                    header: `0x${header.toString(16).padStart(2, '0')}`,
                    actualLength
                });
                const result = await this.parseMainPacket(workBuffer, 0, actualLength, connectionAddress);
                result.packetType = 'unknown';
                result.unknownHeader = header;
                return result;
            }
        } catch (error) {
            logger.error('Parsing error:', error);
            throw error;
        }
    }

    /**
     * Validate packet structure and checksum
     */
    validatePacket(buffer) {
        if (buffer.length < 3) {
            throw new Error('Packet too short');
        }

        const header = buffer.readUInt8(0);
        const rawLength = buffer.readUInt16LE(1);
        
        // Extract high-order bit for archive data indicator
        const hasUnsentData = (rawLength & 0x8000) !== 0;
        
        // Extract 15 low-order bits for packet length
        const actualLength = rawLength & 0x7FFF;

        if (actualLength > this.maxPacketSize) {
            throw new Error(`Packet data length ${actualLength} exceeds MAX_PACKET_SIZE ${this.maxPacketSize}`);
        }

        // Check if we have the complete packet (HEAD + LENGTH + DATA + CRC)
        const expectedLength = actualLength + 3;  // Header (1) + Length (2) + Data
        if (buffer.length < expectedLength + 2) {  // +2 for CRC
            throw new Error('Incomplete packet');
        }

        if (this.validateChecksum !== false) {
            const calculatedChecksum = this.calculateCRC16(buffer.slice(0, expectedLength));
            const receivedChecksum = buffer.readUInt16LE(expectedLength);

            if (calculatedChecksum !== receivedChecksum) {
                logger.warn('Checksum mismatch', {
                    calculated: `0x${calculatedChecksum.toString(16).padStart(4, '0')}`,
                    received: `0x${receivedChecksum.toString(16).padStart(4, '0')}`,
                    hex: buffer.toString('hex').toUpperCase()
                });
                if (process.env.VALIDATE_CHECKSUM === 'strict') {
                    throw new Error('Checksum mismatch');
                }
            }
        }

        return {
            hasUnsentData,
            actualLength,
            rawLength
        };
    }

    /**
     * Calculate CRC16 for a packet
     */
    calculateCRC16(buffer) {
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
        return crc;
    }

    /**
     * Parse all records in a packet data section using sequential tag parsing.
     */
    parseAllRecords(buffer, startOffset, endOffset, connectionAddress = null) {
        const records = [];
        let offset = startOffset;
        let guard = 0;
        const maxIterations = 5000;

        while (offset < endOffset && guard++ < maxIterations) {
            const before = offset;
            let record;
            try {
                record = this.parseRecord(buffer, offset, endOffset, connectionAddress);
            } catch (error) {
                logger.warn('Record parse failed, advancing offset', {
                    connectionAddress,
                    offset,
                    endOffset,
                    error: error.message
                });
                offset = before + 1;
                continue;
            }

            const nextOffset = Number.isInteger(record.nextOffset) ? record.nextOffset : endOffset;

            if (Object.keys(record.tags).length > 0) {
                records.push(record);
            }

            if (nextOffset <= before) {
                offset = before + 1;
            } else {
                offset = nextOffset;
            }
        }

        return records;
    }

    async persistParsedRecord(record, connectionAddress, result) {
        if (Object.keys(record.tags).length === 0) {
            return;
        }

        if (record.isCommandReply) {
            const reply = this.getCommandReply(record, connectionAddress);
            if (reply) {
                this.emit('commandReply', reply);
            }
            result.commandReplies = (result.commandReplies || 0) + 1;
            logger.debug('Command reply packet handled (not stored as telemetry record)', {
                connectionAddress,
                commandNumber: record.tags['0xe0']?.value
            });
            return;
        }

        result.records.push(record);

        const imei = this.resolveImeiForRecord(record, connectionAddress);
        if (imei) {
            await this.saveRecordToDatabase(record, imei);
            this.emit('recordStored', {
                imei,
                timestamp: new Date(),
                tags: record.tags,
                recordNumber: record.tags['0x10']?.value
            });
            await this.flushPendingTelemetry(connectionAddress, imei, result);
        } else {
            this.queuePendingTelemetry(connectionAddress, record);
            result.queuedTelemetry = (result.queuedTelemetry || 0) + 1;
        }
    }

    /**
     * Parse main packet (HEAD 0x01) or extension packet data section (tag stream).
     */
    async parseMainPacket(buffer, offset = 0, actualLength, connectionAddress = null) {
        try {
            const result = {
                header: buffer.readUInt8(offset),
                length: actualLength,
                rawLength: actualLength,
                records: [],
                commandReplies: 0
            };

            const dataStart = offset + 3;
            const dataEnd = offset + 3 + actualLength;
            const records = this.parseAllRecords(buffer, dataStart, dataEnd, connectionAddress);

            logger.info('Packet records parsed', {
                connectionAddress,
                packetLength: actualLength,
                recordsFound: records.length,
                timestamp: new Date().toISOString()
            });

            for (const record of records) {
                await this.persistParsedRecord(record, connectionAddress, result);
            }

            await this.flushPendingTelemetryIfImeiKnown(connectionAddress, result);

            return result;
        } catch (error) {
            logger.error('Error parsing main packet:', error);
            throw error;
        }
    }

    /**
     * Parse compressed packet (HEAD 0x08) — bit-packed minimal data set + tag list.
     */
    async parseCompressedPacket(buffer, connectionAddress = null) {
        const actualLength = buffer.readUInt16LE(1) & 0x7fff;
        const dataEnd = 3 + actualLength;
        const result = {
            type: 'compressed',
            header: 0x08,
            length: actualLength,
            records: [],
            commandReplies: 0
        };

        let offset = 3;

        while (offset + 10 < dataEnd) {
            const record = await this.parseCompressedRecord(buffer, offset, dataEnd, connectionAddress);
            if (Object.keys(record.tags).length > 0) {
                await this.persistParsedRecord(record, connectionAddress, result);
            }
            offset = record.nextOffset;
        }

        logger.info('Compressed packet parsed', {
            connectionAddress,
            packetLength: actualLength,
            recordsFound: result.records.length,
            timestamp: new Date().toISOString()
        });

        await this.flushPendingTelemetryIfImeiKnown(connectionAddress, result);

        return result;
    }

    /**
     * Parse one compressed record inside a 0x08 packet.
     */
    async parseCompressedRecord(buffer, offset, dataEnd, connectionAddress = null) {
        const record = {
            tags: {},
            nextOffset: offset
        };

        if (offset + 10 > dataEnd) {
            return record;
        }

        const minimalData = this.parseMinimalDataSet(buffer.slice(offset, offset + 10));
        offset += 10;
        this.applyMinimalDataToRecord(record, minimalData);

        if (offset >= dataEnd) {
            record.nextOffset = offset;
            return record;
        }

        const tagCountByte = buffer.readUInt8(offset);
        offset += 1;
        const tagCount = popcount(tagCountByte);

        if (offset + tagCount > dataEnd) {
            record.nextOffset = offset;
            return record;
        }

        const tagIds = [];
        for (let i = 0; i < tagCount; i++) {
            tagIds.push(buffer.readUInt8(offset + i));
        }
        offset += tagCount;

        for (const tag of tagIds) {
            const tagHex = `0x${tag.toString(16).padStart(2, '0')}`.toLowerCase();

            if (tag === 0xfe) {
                const feResult = this.parseExtendedTagsBlock(buffer, offset, dataEnd, connectionAddress);
                Object.assign(record.tags, feResult.tags);
                offset = feResult.nextOffset;
                continue;
            }

            const { value, newOffset, definition, stopRecord } = this.parseTagValue(
                buffer,
                offset,
                tagHex,
                dataEnd
            );

            if (stopRecord) {
                break;
            }

            if (value !== null && definition) {
                record.tags[tagHex] = {
                    value,
                    type: definition.type,
                    description: definition.description
                };

                if (tagHex === '0x03' && typeof value === 'string' && /^\d{15}$/.test(value) && connectionAddress) {
                    this.setIMEI(connectionAddress, value);
                }
            }

            offset = newOffset;
        }

        record.nextOffset = offset;
        return record;
    }

    applyMinimalDataToRecord(record, minimalData) {
        if (minimalData.timestamp) {
            record.tags['0x20'] = {
                value: minimalData.timestamp,
                type: 'datetime',
                description: 'Date and time from compressed minimal data set'
            };
        }

        record.tags['0x30'] = {
            value: {
                latitude: minimalData.latitude,
                longitude: minimalData.longitude,
                satellites: 0,
                correctness: minimalData.valid ? 0 : 1
            },
            type: 'coordinates',
            description: 'Coordinates from compressed minimal data set'
        };

        if (minimalData.alarm) {
            record.tags['0x40'] = {
                value: 1,
                type: 'status',
                description: 'Alarm flag from compressed minimal data set'
            };
        }

        if (minimalData.userTag !== undefined) {
            record.tags['0x4a'] = {
                value: minimalData.userTag,
                type: 'uint8',
                description: 'User tag from compressed minimal data set'
            };
        }
    }

    /**
     * Parse compressed minimal data set (10 bytes, bit-packed per Galileosky spec).
     */
    parseMinimalDataSet(buffer) {
        const bits = new GalileoskyBitBuffer(buffer);
        bits.readUnsigned(1); // reserved

        const calendar = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1, 0, 0, 0, 0));
        calendar.setUTCSeconds(calendar.getUTCSeconds() + bits.readUnsigned(25));

        const valid = bits.readUnsigned(1) === 0;
        const longitude = (360 * bits.readUnsigned(22) / 4194304) - 180;
        const latitude = (180 * bits.readUnsigned(21) / 2097152) - 90;
        const alarm = bits.readUnsigned(1) > 0;
        const userTag = bits.bitPos < 80 ? bits.readUnsigned(80 - bits.bitPos) : 0;

        return {
            timestamp: calendar,
            valid,
            latitude,
            longitude,
            alarm,
            userTag
        };
    }

    parseExtendedTagsBlock(buffer, offset, endOffset, connectionAddress = null) {
        const tags = {};
        let recordOffset = offset;

        if (!this.hasBytes(buffer, recordOffset, 2, endOffset)) {
            return { tags, nextOffset: recordOffset };
        }

        const extendedBlockLength = buffer.readUInt16LE(recordOffset);
        recordOffset += 2;
        const extendedBlockEnd = recordOffset + extendedBlockLength;

        if (extendedBlockEnd > endOffset) {
            logger.warn('Extended tags block extends beyond record boundary', {
                connectionAddress,
                extendedBlockLength,
                extendedBlockEnd,
                endOffset
            });
            return { tags, nextOffset: endOffset };
        }

        while (recordOffset < extendedBlockEnd) {
            if (recordOffset + 2 > extendedBlockEnd) {
                break;
            }

            const extendedTag = buffer.readUInt16BE(recordOffset);
            recordOffset += 2;
            const tagHex = `0x${extendedTag.toString(16).padStart(4, '0')}`.toLowerCase();
            const { value, newOffset, definition, stopRecord } = this.parseTagValue(
                buffer,
                recordOffset,
                tagHex,
                extendedBlockEnd
            );

            if (stopRecord) {
                break;
            }

            if (value !== null && definition) {
                tags[tagHex] = {
                    value,
                    type: definition.type,
                    description: definition.description
                };
            } else {
                logger.warn('Unknown extended tag encountered', {
                    tagHex,
                    connectionAddress
                });
            }

            recordOffset = newOffset;
        }

        return { tags, nextOffset: extendedBlockEnd };
    }

    /**
     * Parse a tag from the packet
     */
    parseTag(buffer, offset) {
        const tagType = buffer.readUInt8(offset);
        let value;
        let length;

        // Get tag definition
        const tagDef = tagDefinitions[`0x${tagType.toString(16).padStart(2, '0')}`];
        if (!tagDef) {
            logger.warn(`Unknown tag type: 0x${tagType.toString(16)}`);
            return [null, offset + 1];
        }

        // Parse value based on tag definition
        switch (tagDef.type) {
            case 'uint8':
                value = buffer.readUInt8(offset + 1);
                length = 1;
                break;
            case 'uint16':
                value = buffer.readUInt16LE(offset + 1);
                length = 2;
                break;
            case 'uint32':
                value = buffer.readUInt32LE(offset + 1);
                length = 4;
                break;
            case 'uint32_modbus':
                    value = buffer.readUInt32LE(offset + 1)/100;
                length = 4;
                break;
            case 'int8':
                value = buffer.readInt8(offset + 1);
                length = 1;
                break;
            case 'int16':
                value = buffer.readInt16LE(offset + 1);
                length = 2;
                break;
            case 'int32':
                value = buffer.readInt32LE(offset + 1);
                length = 4;
                break;
            case 'string':
                if (tagDef.length) {
                    // Fixed length string (like IMEI)
                    value = buffer.slice(offset + 1, offset + 1 + tagDef.length).toString('ascii');
                    length = tagDef.length;
                } else {
                    // Variable length string
                    length = buffer.readUInt8(offset + 1);
                    value = buffer.slice(offset + 2, offset + 2 + length).toString('ascii');
                    length += 1; // Add 1 for the length byte
                }
                break;
            case 'coordinates':
                const lat = buffer.readInt32LE(offset + 1) / 1000000;
                const lon = buffer.readInt32LE(offset + 5) / 1000000;
                const satellites = buffer.readUInt8(offset + 8);
                value = { latitude: lat, longitude: lon, satellites };
                length = 9;
                break;
            case 'datetime':
                value = new Date(buffer.readUInt32LE(offset + 1) * 1000);
                length = 4;
                break;
            case 'status':
                value = buffer.readUInt16LE(offset + 1);
                length = 2;
                break;
            default:
                logger.warn(`Unsupported tag type: ${tagDef.type}`);
                return [null, offset + 1];
        }

        return [{
            type: tagType,
            value: value,
            definition: tagDef
        }, offset + 1 + length];
    }

    getTagValueByteLength(definition, tagHex) {
        switch (definition.type) {
            case 'uint8':
            case 'int8':
                return 1;
            case 'uint16':
            case 'int16':
            case 'status':
            case 'outputs':
            case 'inputs':
                return 2;
            case 'uint32':
            case 'int32':
            case 'uint32_modbus':
            case 'datetime':
                return 4;
            case 'string':
                return definition.length || null;
            case 'coordinates':
                return 9;
            case 'speedDirection':
                return 4;
            case 'bytes':
                return definition.length || null;
            default:
                return definition.length || null;
        }
    }

    stopTagParse(recordOffset, tagHex, reason, endOffset) {
        logger.warn(`Stopping record at tag ${tagHex}: ${reason}`, {
            tagHex,
            recordOffset,
            endOffset
        });
        return {
            value: null,
            newOffset: recordOffset,
            definition: null,
            stopRecord: true
        };
    }

    hasBytes(buffer, offset, size, endOffset) {
        return offset >= 0 && size >= 0 && offset + size <= endOffset;
    }

    // Synchronous tag value parser
    parseTagValue(buffer, recordOffset, tagHex, endOffset = buffer.length) {
        const definition = this.tagDefinitionsCache.get(String(tagHex).toLowerCase());
        if (!definition) {
            return this.stopTagParse(recordOffset, tagHex, 'unknown tag', endOffset);
        }

        const byteLength = this.getTagValueByteLength(definition, tagHex);
        if (byteLength !== null && !this.hasBytes(buffer, recordOffset, byteLength, endOffset)) {
            return this.stopTagParse(
                recordOffset,
                tagHex,
                `need ${byteLength} bytes, have ${endOffset - recordOffset}`,
                endOffset
            );
        }

        let value;
        let newOffset = recordOffset;

        try {
            switch (definition.type) {
            case 'uint8':
                value = buffer.readUInt8(recordOffset);
                newOffset = recordOffset + 1;
                break;
            case 'uint16':
                value = buffer.readUInt16LE(recordOffset);
                newOffset = recordOffset + 2;
                break;
            case 'uint32':
                value = buffer.readUInt32LE(recordOffset);
                newOffset = recordOffset + 4;
                break;
            case 'uint32_modbus': {
                const modbusBytes = [
                    buffer.readUInt8(recordOffset),
                    buffer.readUInt8(recordOffset + 3),
                    buffer.readUInt8(recordOffset + 2),
                    buffer.readUInt8(recordOffset + 1)
                ];
                value = Buffer.from(modbusBytes).readUInt32BE(0) / 100;
                newOffset = recordOffset + 4;
                break;
            }
            case 'int8':
                value = buffer.readInt8(recordOffset);
                newOffset = recordOffset + 1;
                break;
            case 'int16':
                value = buffer.readInt16LE(recordOffset);
                newOffset = recordOffset + 2;
                break;
            case 'int32':
                value = buffer.readInt32LE(recordOffset);
                newOffset = recordOffset + 4;
                break;
            case 'string':
                if (tagHex === '0x03') {
                    value = buffer.toString('ascii', recordOffset, recordOffset + definition.length);
                    if (value && /^\d{15}$/.test(value.trim())) {
                        value = value.trim();
                    } else {
                        logger.warn(`Invalid IMEI format: ${value}`, {
                            hex: buffer.slice(recordOffset, recordOffset + definition.length).toString('hex'),
                            tagHex
                        });
                        value = null;
                    }
                } else {
                    value = buffer.toString('utf8', recordOffset, recordOffset + definition.length);
                }
                newOffset = recordOffset + definition.length;
                break;
            case 'datetime':
                value = new Date(buffer.readUInt32LE(recordOffset) * 1000);
                newOffset = recordOffset + 4;
                break;
            case 'coordinates': {
                const satellites = buffer.readUInt8(recordOffset) & 0x0F;
                const correctness = (buffer.readUInt8(recordOffset) >> 4) & 0x0F;
                let tempOffset = recordOffset + 1;
                const lat = buffer.readInt32LE(tempOffset) / 1000000;
                tempOffset += 4;
                const lon = buffer.readInt32LE(tempOffset) / 1000000;
                tempOffset += 4;
                value = { latitude: lat, longitude: lon, satellites, correctness };
                newOffset = tempOffset;
                break;
            }
            case 'status':
                value = buffer.readUInt16LE(recordOffset);
                newOffset = recordOffset + 2;
                break;
            case 'outputs': {
                const outputsValue = buffer.readUInt16LE(recordOffset);
                const outputsBinary = this.binaryCache.get(outputsValue);
                value = {
                    raw: outputsValue,
                    binary: outputsBinary,
                    states: {}
                };
                for (let i = 0; i < 16; i++) {
                    value.states[`output${i}`] = outputsBinary[15 - i] === '1';
                }
                newOffset = recordOffset + 2;
                break;
            }
            case 'inputs': {
                const inputsValue = buffer.readUInt16LE(recordOffset);
                const inputsBinary = this.binaryCache.get(inputsValue);
                value = {
                    raw: inputsValue,
                    binary: inputsBinary,
                    states: {}
                };
                for (let i = 0; i < 16; i++) {
                    value.states[`input${i}`] = inputsBinary[15 - i] === '1';
                }
                newOffset = recordOffset + 2;
                break;
            }
            case 'speedDirection': {
                const speedValue = buffer.readUInt16LE(recordOffset);
                const directionValue = buffer.readUInt16LE(recordOffset + 2);
                value = {
                    speed: speedValue / 10,
                    direction: directionValue / 10
                };
                newOffset = recordOffset + 4;
                break;
            }
            case 'bytes':
                if (definition.length) {
                    value = buffer.slice(recordOffset, recordOffset + definition.length).toString('hex').toUpperCase();
                    newOffset = recordOffset + definition.length;
                } else {
                    return this.stopTagParse(recordOffset, tagHex, 'variable bytes tag needs explicit handler', endOffset);
                }
                break;
            default:
                newOffset = recordOffset + (definition.length || 1);
                value = null;
            }
        } catch (error) {
            return this.stopTagParse(recordOffset, tagHex, error.message, endOffset);
        }

        if (newOffset > endOffset) {
            return this.stopTagParse(recordOffset, tagHex, 'parser advanced past record end', endOffset);
        }

        return {
            value,
            newOffset,
            definition,
            stopRecord: false
        };
    }

    /**
     * Parse extended tags block
     */
    async parseExtendedTags(buffer, offset) {
        const result = {};
        let currentOffset = offset;
        
        // Read the length of extended tags block (2 bytes)
        const length = buffer.readUInt16LE(currentOffset);
        currentOffset += 2;
        
        const endOffset = currentOffset + length;
        
        while (currentOffset < endOffset) {
            // Extended tags are 2 bytes each
            const tag = buffer.readUInt16BE(currentOffset);
            currentOffset += 2;
            
            // Look up extended tag definition
            const tagHex = `0x${tag.toString(16).padStart(4, '0')}`;
            const definition = tagDefinitions[tagHex];

            if (!definition) {
                logger.warn(`Unknown extended tag: ${tagHex}`);
                // Skip 4 bytes for unknown extended tags
                currentOffset += 4;
                continue;
            }

            let value;
            switch (definition.type) {
                case 'uint8':
                    value = buffer.readUInt8(currentOffset);
                    currentOffset += 1;
                    break;
                case 'uint16':
                    value = buffer.readUInt16LE(currentOffset);
                    currentOffset += 2;
                    break;
                case 'uint32':
                    value = buffer.readUInt32LE(currentOffset);
                    currentOffset += 4;
                    break;
                case 'uint32_modbus':
                    value = buffer.readUInt32LE(currentOffset)/100;
                    currentOffset += 4;
                    break;
                case 'int8':
                    value = buffer.readInt8(currentOffset);
                    currentOffset += 1;
                    break;
                case 'int16':
                    value = buffer.readInt16LE(currentOffset);
                    currentOffset += 2;
                    break;
                case 'int32':
                    value = buffer.readInt32LE(currentOffset);
                    currentOffset += 4;
                    break;
                default:
                    logger.warn(`Unsupported extended tag type: ${definition.type}`);
                    currentOffset += 4; // Default to 4 bytes
                    value = null;
            }

            result[tagHex] = {
                value: value,
                type: definition.type,
                description: definition.description
            };
        }

        return [result, currentOffset];
    }

    /**
     * Parse coordinates
     */
    async parseCoordinates(buffer, offset) {
        const firstByte = buffer.readUInt8(offset);
        const satellites = firstByte & 0x0F;
        const coordinatesCorrectness = (firstByte >> 4) & 0x0F;
        const latitude = buffer.readInt32LE(offset + 1) / 1000000;
        const longitude = buffer.readInt32LE(offset + 5) / 1000000;
        
        const result = {
            satellites,
            coordinatesCorrectness,
            latitude,
            longitude
        };
        
        logger.info('Coordinates:', {
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6),
            satellites,
            coordinatesCorrectness
        });
        
        return [result, offset + 9];
    }

    /**
     * Parse latitude
     */
    parseLatitude(value) {
        const sign = value & 0x80000000 ? -1 : 1;
        return sign * (value & 0x7FFFFFFF) / 1000000.0;
    }

    /**
     * Parse longitude
     */
    parseLongitude(value) {
        const sign = value & 0x80000000 ? -1 : 1;
        return sign * (value & 0x7FFFFFFF) / 1000000.0;
    }

    /**
     * Parse timestamp
     */
    parseTimestamp(seconds) {
        return new Date(seconds * 1000);
    }

    /**
     * Parse device status
     */
    async parseStatus(buffer, offset) {
        const status = buffer.readUInt16LE(offset);
        return [{
            powerSupply: !!(status & 0x0001),
            gpsValid: !!(status & 0x0002),
            gsmValid: !!(status & 0x0004),
            alarm: !!(status & 0x0008),
            ignition: !!(status & 0x0010),
            movement: !!(status & 0x0020),
            charging: !!(status & 0x0040),
            lowBattery: !!(status & 0x0080),
            gsmSignal: (status & 0x0300) >> 8,
            gpsSignal: (status & 0x0C00) >> 10,
            gsmAntenna: !!(status & 0x1000),
            gpsAntenna: !!(status & 0x2000),
            output1: !!(status & 0x4000),
            output2: !!(status & 0x8000)
        }, offset + 2];
    }

    /**
     * Parse acceleration
     */
    async parseAcceleration(buffer, offset) {
        const value = buffer.readUInt32LE(offset);
        return [{
            x: (value & 0x000000FF) - 128,
            y: ((value & 0x0000FF00) >> 8) - 128,
            z: ((value & 0x00FF0000) >> 16) - 128
        }, offset + 4];
    }

    /**
     * Parse confirmation packet (3 bytes: 0x02 + CRC16)
     */
    parseConfirmationPacket(buffer) {
        if (buffer.length < 3) {
            throw new Error('Confirmation packet too short');
        }

        const header = buffer.readUInt8(0);
        if (header !== 0x02) {
            throw new Error('Invalid confirmation packet header');
        }

        return {
            type: 'confirmation',
            header: header,
            checksum: buffer.readUInt16LE(1)
        };
    }

    /**
     * Parse Garmin FMI packet
     */
    parseGarminPacket(buffer) {
        const length = buffer.readUInt16LE(1);
        return {
            type: 'garmin',
            length: length,
            data: buffer.slice(3, length + 3),
            checksum: buffer.readUInt16LE(length + 1)
        };
    }

    /**
     * Add validation methods
     */
    validatePacket(buffer) {
        if (buffer.length < 3) {
            throw new Error('Packet too short');
        }

        const header = buffer.readUInt8(0);
        const rawLength = buffer.readUInt16LE(1);
        
        // Extract high-order bit for archive data indicator
        const hasUnsentData = (rawLength & 0x8000) !== 0;
        
        // Extract 15 low-order bits for packet length
        const actualLength = rawLength & 0x7FFF;

        if (actualLength > this.maxPacketSize) {
            throw new Error(`Packet data length ${actualLength} exceeds MAX_PACKET_SIZE ${this.maxPacketSize}`);
        }

        // Check if we have the complete packet (HEAD + LENGTH + DATA + CRC)
        const expectedLength = actualLength + 3;  // Header (1) + Length (2) + Data
        if (buffer.length < expectedLength + 2) {  // +2 for CRC
            throw new Error('Incomplete packet');
        }

        if (this.validateChecksum !== false) {
            const calculatedChecksum = this.calculateCRC16(buffer.slice(0, expectedLength));
            const receivedChecksum = buffer.readUInt16LE(expectedLength);

            if (calculatedChecksum !== receivedChecksum) {
                logger.warn('Checksum mismatch', {
                    calculated: `0x${calculatedChecksum.toString(16).padStart(4, '0')}`,
                    received: `0x${receivedChecksum.toString(16).padStart(4, '0')}`,
                    hex: buffer.toString('hex').toUpperCase()
                });
                if (process.env.VALIDATE_CHECKSUM === 'strict') {
                    throw new Error('Checksum mismatch');
                }
            }
        }

        return {
            hasUnsentData,
            actualLength,
            rawLength
        };
    }

    /**
     * Add packet statistics
     */
    getPacketStatistics(parsed) {
        return {
            packetType: parsed.type,
            timestamp: new Date(),
            tagsCount: Object.keys(parsed.tags).length,
            hasExtendedTags: !!parsed.tags.extended,
            validChecksum: parsed.checksumValid,
            rawLength: parsed.raw.length
        };
    }

    /**
     * Parse incoming packet
     */
    async parsePacket(buffer) {
        try {
            // Add buffer to our stream buffer
            if (!this.streamBuffer) {
                this.streamBuffer = Buffer.alloc(0);
            }
            this.streamBuffer = Buffer.concat([this.streamBuffer, buffer]);

            // Process all complete packets in the buffer
            const packets = [];
            while (this.streamBuffer.length > 0) {
                // Check if we have enough data for a header
                if (this.streamBuffer.length < 3) {
                    break;
                }

                // Get packet type and length
                const packetType = this.streamBuffer[0];
                const length = this.streamBuffer.readUInt16LE(1);

                // Check if we have a complete packet
                if (this.streamBuffer.length < length + 3) {
                    break;
                }

                // Extract the complete packet
                const packet = this.streamBuffer.slice(0, length + 3);
                this.streamBuffer = this.streamBuffer.slice(length + 3);

                // Parse the packet
                const parser = this.packetTypes[packetType];
                if (!parser) {
                    throw new Error(`Unknown packet type: 0x${packetType.toString(16)}`);
                }

                const result = await parser.call(this, packet);
                packets.push(result);

                // Send confirmation packet (0x02) with checksum
                const checksum = this.calculateChecksum(packet);
                const confirmationPacket = Buffer.alloc(3);
                confirmationPacket[0] = 0x02;
                confirmationPacket.writeUInt16LE(checksum, 1);
                
                // Send confirmation packet back to the device
                if (this.socket && this.socket.writable) {
                    this.socket.write(confirmationPacket);
                }
            }

            return packets;
        } catch (error) {
            console.error('Error parsing packet:', error);
            throw error;
        }
    }

    /**
     * Calculate checksum for a packet
     */
    calculateChecksum(packet) {
        let sum = 0;
        for (let i = 0; i < packet.length; i++) {
            sum += packet[i];
        }
        return sum & 0xFFFF;
    }

    /**
     * Parse identification data structure
     */
    async parseIdentificationData(buffer, offset) {
        const result = {
            packetId: buffer.readUInt32LE(offset),
            imei: buffer.toString('ascii', offset + 4, offset + 19),
            sessionStatus: buffer.readUInt8(offset + 19),
            emptyField: buffer.readUInt32LE(offset + 20),
            sendingTime: this.parseTimestamp(buffer.readUInt32LE(offset + 24))
        };
        logger.info('Device IMEI:', result.imei);
        return result;
    }

    async handleIncompletePacket(socket, packetInfo) {
        logger.info('Incomplete packet, waiting for more data...', packetInfo);
        
        // Send confirmation packet (023FFA)
        const confirmationPacket = Buffer.from([0x02, 0x3F, 0xFA]);
        socket.write(confirmationPacket);
        logger.info('Sent confirmation packet: 023FFA');
        
        // Store the incomplete packet for later processing
        this.incompletePackets.set(socket, packetInfo);
    }

    /**
     * Parse type 0x33 packet (series of records)
     */
    async parseType33Packet(buffer) {
        try {
            // Validate packet first
            this.validatePacket(buffer);

            const result = {
                type: 'type33',
                header: buffer.readUInt8(0),
                length: buffer.readUInt16LE(1),
                records: [],
                raw: buffer
            };

            let offset = 3; // Skip header and length
            const recordLength = 32;

            while (offset + recordLength <= buffer.length - 2) { // -2 for CRC
                try {
                    const record = {
                        timestamp: new Date(buffer.readUInt32LE(offset) * 1000),
                        coordinates: {
                            latitude: buffer.readInt32LE(offset + 4) / 1000000,
                            longitude: buffer.readInt32LE(offset + 8) / 1000000
                        },
                        speed: buffer.readUInt16LE(offset + 12) / 10,
                        course: buffer.readUInt16LE(offset + 14) / 10,
                        status: buffer.readUInt16LE(offset + 16),
                        flags: {
                            value: buffer.readUInt32LE(offset + 18),
                            hex: buffer.slice(offset + 18, offset + 22).toString('hex').toUpperCase()
                        },
                        raw: buffer.slice(offset, offset + recordLength)
                    };
                    result.records.push(record);
                    offset += recordLength;
                } catch (error) {
                    logger.error('Error parsing type 33 record:', error);
                    break;
                }
            }

            return result;
        } catch (error) {
            logger.error('Error parsing type 33 packet:', error);
            throw error;
        }
    }

    /**
     * Parse photo packet (HEAD 0x07). Image chunks are acknowledged with 0x07 + CRC.
     */
    async parsePhotoPacket(buffer, connectionAddress = null) {
        const actualLength = buffer.readUInt16LE(1) & 0x7fff;
        const partNumber = buffer.length > 3 ? buffer.readUInt8(3) : 0;
        const payloadLength = Math.max(0, actualLength - 1);

        logger.info('Photo packet received', {
            connectionAddress,
            partNumber,
            payloadLength,
            packetLength: actualLength,
            timestamp: new Date().toISOString()
        });

        return {
            type: 'photo',
            header: 0x07,
            length: actualLength,
            partNumber,
            payloadLength,
            records: [],
            commandReplies: 0,
            ackHeader: 0x07
        };
    }

    /**
     * Parse ignorable packet (0x15)
     */
    async parseIgnorablePacket(buffer) {
        return {
            type: 'ignorable',
            header: buffer.readUInt8(0),
            length: buffer.readUInt16LE(1),
            raw: buffer
        };
    }

    async ensureDeviceExists(imei) {
        try {
            // Validate IMEI before database query
            if (!imei || typeof imei !== 'string' || !/^\d{15}$/.test(imei)) {
                logger.error(`Invalid IMEI for device lookup: ${imei}`, {
                    type: typeof imei,
                    length: imei ? imei.length : 0,
                    timestamp: new Date().toISOString()
                });
                throw new Error(`Invalid IMEI for device lookup: ${imei}`);
            }

            const [device, created] = await Device.findOrCreate({
                where: { imei },
                defaults: {
                    name: `Device ${imei}`,
                    status: 'active',
                    lastSeen: new Date()
                }
            });

            // Update lastSeen timestamp for existing devices
            if (!created) {
                await device.update({
                    lastSeen: new Date(),
                    status: 'active'
                });
            }

            // Emit device update event for frontend
            this.emit('deviceUpdated', {
                imei: imei,
                isNew: created,
                lastSeen: new Date(),
                isActive: true
            });

            logger.info(`Device ${created ? 'created' : 'updated'}: ${imei}`);
            return device;
        } catch (error) {
            logger.error(`Error ensuring device exists: ${error.message}`);
            throw error;
        }
    }

    async saveRecordToDatabase(record, imei) {
        try {
            // Validate IMEI before proceeding
            if (!imei || typeof imei !== 'string' || !/^\d{15}$/.test(imei)) {
                logger.error(`Invalid IMEI value, cannot save record: ${imei}`, {
                    type: typeof imei,
                    length: imei ? imei.length : 0,
                    timestamp: new Date().toISOString()
                });
                throw new Error(`Invalid IMEI value: ${imei}`);
            }

            const tags = record.tags || {};
            const getTag = (key) => {
                if (!key) return undefined;
                const lower = key.toLowerCase();
                return tags[lower] || tags[key] || tags[key.toUpperCase().replace('0X', '0x')];
            };

            // Extract input states from the inputs tag
            const inputsTag = getTag('0x46');
            const inputStates = inputsTag?.value?.states || {};

            // Extract output states from the outputs tag
            const outputsTag = getTag('0x45');
            const outputStates = outputsTag?.value?.states || {};

            const recordData = {
                deviceImei: imei,
                timestamp: new Date(), // Server timestamp when record was received
                datetime: getTag('0x20')?.value || null, // Device datetime from tag 0x20
                recordNumber: getTag('0x10')?.value,
                milliseconds: getTag('0x21')?.value,
                latitude: getTag('0x30')?.value?.latitude,
                longitude: getTag('0x30')?.value?.longitude,
                satellites: getTag('0x30')?.value?.satellites,
                coordinateCorrectness: getTag('0x30')?.value?.correctness,
                speed: getTag('0x33')?.value?.speed,
                direction: getTag('0x33')?.value?.direction,
                altitude: getTag('0x34')?.value,
                hdop: getTag('0x35')?.value,
                status: getTag('0x40')?.value,
                supplyVoltage: getTag('0x41')?.value,
                batteryVoltage: getTag('0x42')?.value,
                temperature: getTag('0x43')?.value,
                acceleration: getTag('0x44')?.value,
                outputs: getTag('0x45')?.value,
                inputs: getTag('0x46')?.value,
                ecoDriving: getTag('0x47')?.value,
                expandedStatus: getTag('0x48')?.value,
                transmissionChannel: getTag('0x49')?.value,
                // Input states - map from the inputs tag states
                input0: inputStates.input0 || false,
                input1: inputStates.input1 || false,
                input2: inputStates.input2 || false,
                input3: inputStates.input3 || false,
                // Input voltages
                inputVoltage0: getTag('0x50')?.value,
                inputVoltage1: getTag('0x51')?.value,
                inputVoltage2: getTag('0x52')?.value,
                inputVoltage3: getTag('0x53')?.value,
                inputVoltage4: getTag('0x54')?.value,
                inputVoltage5: getTag('0x55')?.value,
                inputVoltage6: getTag('0x56')?.value,
                // User data
                userData0: getTag('0xe2')?.value?.toString() || null,
                userData1: getTag('0xe3')?.value?.toString() || null,
                userData2: getTag('0xe4')?.value?.toString() || null,
                userData3: getTag('0xe5')?.value?.toString() || null,
                userData4: getTag('0xe6')?.value?.toString() || null,
                userData5: getTag('0xe7')?.value?.toString() || null,
                userData6: getTag('0xe8')?.value?.toString() || null,
                userData7: getTag('0xe9')?.value?.toString() || null,
                // Modbus data
                modbus0: getTag('0x0001')?.value?.toString() || null,
                modbus1: getTag('0x0002')?.value?.toString() || null,
                modbus2: getTag('0x0003')?.value?.toString() || null,
                modbus3: getTag('0x0004')?.value?.toString() || null,
                modbus4: getTag('0x0005')?.value?.toString() || null,
                modbus5: getTag('0x0006')?.value?.toString() || null,
                modbus6: getTag('0x0007')?.value?.toString() || null,
                modbus7: getTag('0x0008')?.value?.toString() || null,
                modbus8: getTag('0x0009')?.value?.toString() || null,
                modbus9: getTag('0x000a')?.value?.toString() || null,
                modbus10: getTag('0x000b')?.value?.toString() || null,
                modbus11: getTag('0x000c')?.value?.toString() || null,
                modbus12: getTag('0x000d')?.value?.toString() || null,
                modbus13: getTag('0x000e')?.value?.toString() || null,
                modbus14: getTag('0x000f')?.value?.toString() || null,
                modbus15: getTag('0x0010')?.value?.toString() || null,
                rawData: JSON.stringify(record.tags)
            };

            // Add to batch buffer instead of saving immediately
            this.addRecordToBuffer(recordData);
            
            logger.debug(`Record queued for batch processing: device ${imei} with ${Object.keys(record.tags).length} tags`);
        } catch (error) {
            logger.error(`Error preparing record for batch processing: ${error.message}`);
            throw error;
        }
    }

    // Optimized record parsing function (synchronous)
    parseRecord(buffer, startOffset, endOffset, connectionAddress = null) {
        const record = { tags: {} };
        let recordOffset = startOffset;
        const parsedTags = [];

        while (recordOffset < endOffset) {
            if (isNewRecordStart(buffer, recordOffset, endOffset, record)) {
                break;
            }

            const tag = buffer.readUInt8(recordOffset);
            recordOffset++;

            if (tag === 0xFE) {
                const feResult = this.parseExtendedTagsBlock(buffer, recordOffset, endOffset, connectionAddress);
                Object.assign(record.tags, feResult.tags);
                parsedTags.push(...Object.keys(feResult.tags));
                recordOffset = feResult.nextOffset;
                continue;
            } else {
                // Handle regular 1-byte tags
                const tagHex = `0x${tag.toString(16).padStart(2, '0')}`.toLowerCase();
                const definition = this.tagDefinitionsCache.get(tagHex);

                // Handle command number tag with variable length (2 or 4 bytes)
                if (tagHex === '0xe0') {
                    const remainingLength = endOffset - recordOffset;
                    if (remainingLength >= 2) {
                        const nextTagAfter2 = remainingLength >= 3 ? buffer.readUInt8(recordOffset + 2) : null;
                        const nextTagAfter4 = remainingLength >= 5 ? buffer.readUInt8(recordOffset + 4) : null;
                        let value;
                        let length;

                        if (nextTagAfter2 === 0xE1 || nextTagAfter2 === 0xEB) {
                            value = buffer.readUInt16LE(recordOffset);
                            length = 2;
                        } else if (nextTagAfter4 === 0xE1 || nextTagAfter4 === 0xEB) {
                            value = buffer.readUInt32LE(recordOffset);
                            length = 4;
                        } else if (remainingLength >= 4) {
                            value = buffer.readUInt32LE(recordOffset);
                            length = 4;
                        } else {
                            value = buffer.readUInt16LE(recordOffset);
                            length = 2;
                        }

                        record.tags[tagHex] = {
                            value,
                            type: definition?.type || (length === 4 ? 'uint32' : 'uint16'),
                            description: definition?.description
                        };
                        parsedTags.push(tagHex);
                        recordOffset += length;
                        continue;
                    }
                }

                // Handle command text tag with length byte (0xE1)
                if (tagHex === '0xe1') {
                    const remainingLength = endOffset - recordOffset;
                    if (remainingLength >= 1) {
                        const textLength = buffer.readUInt8(recordOffset);
                        const available = Math.min(textLength, remainingLength - 1);
                        const textSlice = buffer.slice(recordOffset + 1, recordOffset + 1 + available);
                        const value = iconv.decode(textSlice, 'cp1251');
                        record.tags[tagHex] = {
                            value,
                            type: definition?.type || 'string',
                            description: definition?.description
                        };
                        parsedTags.push(tagHex);
                        recordOffset += 1 + available;
                        continue;
                    }
                }

                // Handle variable-length user data array (0xEA)
                if (tagHex === '0xea') {
                    const remainingLength = endOffset - recordOffset;
                    if (remainingLength >= 1) {
                        const dataLength = buffer.readUInt8(recordOffset);
                        const available = Math.min(dataLength, remainingLength - 1);
                        const dataSlice = buffer.slice(recordOffset + 1, recordOffset + 1 + available);
                        const value = dataSlice.toString('hex').toUpperCase();
                        record.tags[tagHex] = {
                            value,
                            type: definition?.type || 'bytes',
                            description: definition?.description
                        };
                        parsedTags.push(tagHex);
                        recordOffset += 1 + available;
                        continue;
                    }
                }

                // Handle binary reply tag with length byte (0xEB)
                if (tagHex === '0xeb') {
                    const remainingLength = endOffset - recordOffset;
                    if (remainingLength >= 1) {
                        const dataLength = buffer.readUInt8(recordOffset);
                        const available = Math.min(dataLength, remainingLength - 1);
                        const dataSlice = buffer.slice(recordOffset + 1, recordOffset + 1 + available);
                        const value = dataSlice.toString('hex').toUpperCase();
                        record.tags[tagHex] = {
                            value,
                            type: definition?.type || 'bytes',
                            description: definition?.description
                        };
                        parsedTags.push(tagHex);
                        recordOffset += 1 + available;
                        continue;
                    }
                }

                const { value, newOffset, definition: tagDef, stopRecord } = this.parseTagValue(
                    buffer,
                    recordOffset,
                    tagHex,
                    endOffset
                );

                if (stopRecord) {
                    record.nextOffset = recordOffset - 1;
                    break;
                }

                if (value !== null && tagDef) {
                    record.tags[tagHex] = {
                        value: value,
                        type: tagDef.type,
                        description: tagDef.description
                    };
                    parsedTags.push(tagHex);

                    // Extract IMEI from tag 0x03 (like original implementation)
                    if (tagHex === '0x03' && tagDef.type === 'string' && value && connectionAddress) {
                        // Additional validation for IMEI
                        if (typeof value === 'string' && /^\d{15}$/.test(value)) {
                            this.setIMEI(connectionAddress, value);
                        } else {
                            logger.warn(`Invalid IMEI value, not storing: ${value}`, {
                                type: typeof value,
                                length: value ? value.length : 0,
                                connectionAddress,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                }

                // Advance offset by the correct value length (from parseTagValue)
                recordOffset = newOffset;
            }
        }

        // Detect command reply records and mark them
        if (record.tags['0xe0'] && (record.tags['0xe1'] || record.tags['0xeb'])) {
            record.isCommandReply = true;
        }

        record.nextOffset = recordOffset;

        // Log the parsed tags for debugging
        if (parsedTags.length > 0) {
            logger.info('Record parsed successfully:', {
                connectionAddress,
                startOffset,
                endOffset,
                recordLength: endOffset - startOffset,
                tagsFound: parsedTags.length,
                tags: parsedTags,
                timestamp: new Date().toISOString()
            });
        } else {
            logger.warn('Record parsed but no tags found:', {
                connectionAddress,
                startOffset,
                endOffset,
                recordLength: endOffset - startOffset,
                timestamp: new Date().toISOString()
            });
        }

        return record;
    }

}

// Export the class
module.exports = GalileoskyParser;




